import { readFile, writeFile, mkdir, rm, stat, appendFile, rename, readdir, rmdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { CDP, getTargets, isAppTarget } from './cdp.mjs';
import { appProcesses, inspectExe, hashExe, validateEndpoint, powershell, notify } from './windows.mjs';
import { MachineTranslator } from './machine-translator.mjs';
import { loadOverlaySource } from './overlay-source.mjs';
import { randomUUID } from 'node:crypto';
import { duplicateAction, appLaunchOptions, overlayNeedsRepair, disconnectShouldStop } from './launcher-lifecycle.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = join(root, '.local');
const stateFile = join(local, 'state.json');
const lock = join(local, 'launcher.lock');
const stopFile = join(local, 'stop');
const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ownsLock = false, stopping = false;
let machine;
let runState;
const launchStarted=performance.now();
const queueBinding='__copilotChineseQueueReady';
const sessions = new Map();
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function log(message) {
  if(!quiet) console.log(message);
  await appendFile(join(local, 'launcher.log'), `${new Date().toISOString()} ${message}\n`);
}
async function readState() { try { return JSON.parse(await readFile(stateFile, 'utf8')); } catch { return null; } }
async function saveState(state) {
  const temporary = stateFile + '.tmp';
  await writeFile(temporary, JSON.stringify(state, null, 2));
  // AV/indexer readers can briefly hold the destination open on Windows.
  for(let attempt=0;;attempt++) {
    try {await rename(temporary,stateFile);break;}
    catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=3)throw error;await sleep(30*(attempt+1));}
  }
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function findApp(processes) {
  const config = existsSync(join(root, 'config.json')) ? JSON.parse((await readFile(join(root, 'config.json'), 'utf8')).replace(/^\uFEFF/, '')) : {};
  const candidates = [config.appPath,
    join(process.env.LOCALAPPDATA || '', 'Programs', 'GitHub Copilot', 'github.exe'),
    join(process.env.ProgramFiles || '', 'GitHub Copilot', 'github.exe'),
    join(process.env['ProgramFiles(x86)'] || '', 'GitHub Copilot', 'github.exe')];
  if (!candidates.some(p => p && existsSync(p))) candidates.push(...(await processes).map(p=>p.ExecutablePath));
  if (!candidates.some(p => p && existsSync(p))) {
    const found = await powershell(`$roots=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); Get-ItemProperty $roots -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -eq 'GitHub Copilot'} | ForEach-Object {if($_.InstallLocation){Join-Path $_.InstallLocation 'github.exe'}}`);
    candidates.push(...found.split(/\r?\n/));
  }
  const path = candidates.find(p => p && existsSync(p));
  if (!path) throw new Error('未找到 GitHub Copilot。请在 config.json 中设置 appPath。');
  const info = await inspectExe(path,{includeHash:false});
  if (info.signature !== 'Valid' || !/GitHub, Inc\./i.test(info.signer || '')) throw new Error('应用不是具有有效 GitHub 签名的原版程序。');
  return info;
}
function pumpMachine(session) {
  if(stopping || !machine?.enabled || session.machineTask)return;
  session.machineTask=(async()=>{
    // Drain continuously instead of adding one health-poll delay to every batch.
    while(!stopping && session.cdp.socket.readyState===WebSocket.OPEN) {
      const requests=await session.cdp.evaluate('window.__copilotChinese?.drainMachine(8) ?? []');
      if(!requests.length)break;
      await Promise.all(requests.map(async request=>{
        if(stopping)return;
        const translation=await machine.translate(request.text,request.context);
        if(stopping)return;
        await session.cdp.evaluate(`window.__copilotChinese?.applyMachine(${JSON.stringify({instance:request.instance,id:request.id,translation})})`);
      }));
    }
  })().catch(()=>{}).finally(()=>{session.machineTask=null});
}
async function cleanup() {
  stopping = true;
  if(ownsLock && runState) {
    runState.phase='stopping';
    await saveState(runState);
  }
  for (const { cdp, identifier } of sessions.values()) {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {});
    await cdp.evaluate('window.__copilotChinese?.dispose()').catch(() => {});
    await cdp.send('Runtime.removeBinding',{name:queueBinding}).catch(()=>{});
    cdp.close();
  }
  await machine?.close();
  await Promise.allSettled([...sessions.values()].map(s=>s.machineTask));
  sessions.clear();
  if (ownsLock) {
    const state = await readState();
    if (state?.pid === process.pid) await saveState({ ...state, phase:'stopped', machineTranslation:machine?.status(), active: false, stoppedAt: new Date().toISOString() });
    // Only this project's fixed, verified lock directory is removed, never app data.
    await rm(join(lock, 'owner.json'), { force: true });
    for(const file of await readdir(lock).catch(()=>[])) if(/^wake-[0-9a-f-]+\.json$/.test(file)) await rm(join(lock,file),{force:true});
    await rmdir(lock).catch(() => {});
  }
}
async function main() {
  if (process.platform !== 'win32') throw new Error('此版本仅支持 Windows。');
  await mkdir(local, { recursive: true });
  if (args.includes('--status')) { if(!quiet)console.log(JSON.stringify(await readState(), null, 2)); return; }
  if (args.includes('--stop')) {
    const state = await readState();
    if (!state?.active || !alive(state.pid)) { if(!quiet)console.log('汉化伴随进程未运行。'); return; }
    await writeFile(stopFile, String(state.pid));
    for (let i = 0; i < 120; i++) { await sleep(250); if (!(await readState())?.active) { if(!quiet)console.log('已恢复英文界面。正常退出并重开原版应用可关闭调试端口。'); return; } }
    throw new Error('停用超时。请正常退出 Copilot 后从原版入口重新打开。');
  }
  let wakeFile, waitLogged=false;
  const waitStarted=Date.now();
  while(!ownsLock) {
    try { await mkdir(lock); ownsLock = true; break; }
    catch(error) { if(error.code!=='EEXIST')throw error; }
    let owner;
    try { owner = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8')); } catch {
      if(Date.now()-waitStarted>90000)throw new Error('启动锁长时间未就绪，请查看日志。');
      await sleep(250);continue;
    }
    if (alive(owner.pid)) {
      const current = await readState();
      const action=duplicateAction(owner,current,true);
      if(action==='waiting-for-app-exit') {
        await log('正在等待未带汉化参数的 Copilot 正常退出，退出后会自动从中文入口接续启动。');
        return;
      }
      if(action==='request-wake') {
        if(wakeFile && !existsSync(wakeFile)) {await log('现有汉化连接已确认，已唤起应用。');return;}
        if(!wakeFile) {
          wakeFile=join(lock,`wake-${randomUUID()}.json`);
          await writeFile(wakeFile,JSON.stringify({requestedAt:new Date().toISOString()})).catch(()=>{});
        }
      }
      if(!waitLogged){await log('等待已有汉化进程完成启动或退出清理…');waitLogged=true;}
      if(Date.now()-waitStarted>90000)throw new Error('汉化进程尚未就绪，请查看 --status 和日志。');
      await sleep(250);continue;
    }
    await rm(join(lock, 'owner.json'), { force: true });
    for(const file of await readdir(lock).catch(()=>[])) if(/^wake-[0-9a-f-]+\.json$/.test(file)) await rm(join(lock,file),{force:true});
    await rmdir(lock).catch(()=>{});
    wakeFile=null;
  }
  await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }));
  const previousState=await readState();
  await rm(stopFile, { force: true });
  const logPath = join(local, 'launcher.log');
  if (existsSync(logPath) && (await stat(logPath)).size > 1024 * 1024) await rename(logPath, logPath + '.previous').catch(() => {});
  const config = existsSync(join(root, 'config.json')) ? JSON.parse((await readFile(join(root, 'config.json'), 'utf8')).replace(/^\uFEFF/, '')) : {};
  const machineEnabled = config.machineTranslation?.enabled !== false;
  const idleSeconds = Math.min(600, Math.max(30, Number(config.machineTranslation?.idleSeconds) || 180));
  machine = new MachineTranslator(local, {enabled:machineEnabled, idleMs:idleSeconds*1000});
  // The independent engine performs its own signature/ownership checks. Warm it
  // in parallel with app verification, never instead of app verification.
  if(machineEnabled) {
    if(config.machineTranslation?.warmup!==false)void machine.warmup();
    else void machine.init().catch(()=>{});
  }
  const processesPromise=appProcesses();
  const [processes,info]=await Promise.all([processesPromise,findApp(processesPromise)]);
  runState={pid:process.pid,active:true,phase:'starting',startedAt:new Date().toISOString(),app:info,port:null,
    timings:{appValidatedMs:Math.round(performance.now()-launchStarted)}};
  await saveState(runState);
  let port;
  const attach = args.indexOf('--attach');
  if (attach !== -1) {
    port = Number(args[attach + 1]);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('无效端口');
  } else if (processes.some(p => p.ExecutablePath?.toLowerCase() === info.path.toLowerCase())) {
    const old = previousState;
    if (old?.port && old?.app?.path?.toLowerCase() === info.path.toLowerCase()) {
      // Discovery sends no application content. Ownership is verified below,
      // once, immediately before the first CDP connection/injection.
      try { if((await getTargets(old.port)).some(isAppTarget))port=old.port; } catch {}
    }
    if (!port) {
      runState.phase='waiting-for-app-exit';await saveState(runState);
      await log('已有 Copilot 未带汉化参数。等待正常退出后自动接续启动；不会强制终止应用。');
      while((await appProcesses()).some(p=>p.ExecutablePath?.toLowerCase()===info.path.toLowerCase())) {
        if(stopping || existsSync(stopFile))return;
        await sleep(1500);
      }
    }
  }
  if(!port) {
    if(stopping || existsSync(stopFile))return;
    runState.phase='starting';await saveState(runState);
    port = await freePort();
    const child = spawn(info.path, [], appLaunchOptions(port));
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  }
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if(stopping || existsSync(stopFile))return;
    try { if ((await getTargets(port)).some(isAppTarget)) { ready = true; break; } } catch {}
    await sleep(300);
  }
  if (!ready) throw new Error('未发现 Copilot 主界面调试端点。原版应用未被修改；请查看日志并使用原版入口。');
  runState.timings.endpointReadyMs=Math.round(performance.now()-launchStarted);
  const listeners = await validateEndpoint(port, info.path);
  const initialEndpointValidatedAt=performance.now();
  runState.timings.endpointValidatedMs=Math.round(performance.now()-launchStarted);
  const state = Object.assign(runState,{port,phase:'connecting',listeners,dictionary:null});
  await saveState(state);
  await log(`已验证 Copilot ${info.version}，仅回环连接 ${listeners.join(', ')}。`);
  const dictionary = JSON.parse(await readFile(join(root, 'locales', 'zh-CN.json'), 'utf8'));
  if (!dictionary.common || !dictionary.settings || typeof dictionary.version !== 'string') throw new Error('词典格式错误');
  const engine = loadOverlaySource();
  const policy = (await readFile(join(root,'src','machine-policy.mjs'),'utf8')).replace('export function','function');
  const script = `(()=>{if(window.top!==window || !['http://tauri.localhost','https://tauri.localhost'].includes(location.origin))return;${policy}\n${engine}\nreturn installCopilotChinese(${JSON.stringify(dictionary)},document,{machine:${machineEnabled},machinePolicy:createMachinePolicy(),onMachinePending:()=>window.${queueBinding}?.('')});})()`;
  state.dictionary = dictionary.version;
  await saveState(state);
  let failures = 0, disconnectedAt = null;
  let initialEndpointValidation=true;
  while (!stopping) {
    if (existsSync(stopFile)) { await rm(stopFile, { force: true }); break; }
    try {
      const targets = (await getTargets(port)).filter(isAppTarget);
      for (const [id, session] of sessions) if (!targets.some(t => t.id === id) || session.cdp.socket.readyState !== WebSocket.OPEN) {
        session.cdp.close(); sessions.delete(id);
      }
      for (const target of targets) {
        if (sessions.has(target.id)) continue;
        if(!initialEndpointValidation || performance.now()-initialEndpointValidatedAt>2000)await validateEndpoint(port, info.path);
        initialEndpointValidation=false;
        const cdp = await CDP.connect(target.webSocketDebuggerUrl);
        let identifier;
        try {
          await cdp.send('Runtime.addBinding',{name:queueBinding});
          await cdp.send('Runtime.enable');
          await cdp.send('Page.enable');
          ({ identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: script }));
          const session={cdp,identifier,machineTask:null};
          sessions.set(target.id,session);
          cdp.socket.addEventListener('message',event=>{
            const message=JSON.parse(event.data);
            if(message.method==='Runtime.bindingCalled' && message.params?.name===queueBinding)pumpMachine(session);
          });
          await cdp.evaluate(script);
          await log('主界面汉化已加载。');
        } catch (error) {
          if (identifier) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {});
          await cdp.evaluate('window.__copilotChinese?.dispose()').catch(() => {});
          cdp.close(); sessions.delete(target.id); throw error;
        }
      }
      let readyCount=0;
      for(const session of sessions.values()) {
        let status=await session.cdp.evaluate('window.__copilotChinese?.status()');
        if(overlayNeedsRepair(status)) {
          await session.cdp.evaluate(script);
          status=await session.cdp.evaluate('window.__copilotChinese?.status()');
          await log('检测到汉化层未就绪，已重新注入。');
        }
        if(status?.enabled && status.ready)readyCount++;
      }
      state.phase=readyCount?'ready':'connecting';
      if(readyCount) {
        if(state.timings.readyMs==null) {
          state.timings.readyMs=Math.round(performance.now()-launchStarted);
          // Diagnostic digest is not a second prerequisite for signed-app trust.
          void hashExe(info.path).then(hash=>{info.hash=hash}).catch(()=>{});
        }
        const wakeFiles=(await readdir(lock)).filter(file=>/^wake-[0-9a-f-]+\.json$/.test(file));
        if(wakeFiles.length) {
          // Only the owner can wake the app; even a quit/reopen race retains CDP args.
          const child=spawn(info.path,[],appLaunchOptions(port));
          await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.unref();
          for(const file of wakeFiles)await rm(join(lock,file),{force:true});
        }
      }
      state.lastHealthAt=new Date().toISOString();
      if(machineEnabled) for(const session of sessions.values())pumpMachine(session);
      const machineState=machine.status();
      if(JSON.stringify(state.machineTranslation)!==JSON.stringify(machineState)) {
        if(machineState.state==='unavailable' && state.machineTranslation?.error!==machineState.error) await log('自动翻译暂不可用，保留词典与英文：'+machineState.error);
        state.machineTranslation=machineState;
      }
      await saveState(state);
      failures = 0;
      disconnectedAt=null;
    } catch (error) {
      failures++;
      disconnectedAt ??= Date.now();
      state.phase='reconnecting';await saveState(state);
      if (failures === 1) await log('等待应用连接恢复：' + error.message);
      let appRunning;
      try {appRunning=(await appProcesses()).some(p=>p.ExecutablePath?.toLowerCase()===info.path.toLowerCase());} catch {}
      if (disconnectShouldStop(appRunning,Date.now()-disconnectedAt)) { await log('应用已退出或连接不可用；汉化伴随进程结束。'); break; }
    }
    await sleep(1500);
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });
try { await main(); }
catch (error) {
  if(!quiet) console.error(error.message);
  await mkdir(local, { recursive: true }); await log('错误：' + error.message);
  if (quiet) await notify(error.message);
  process.exitCode = 1;
} finally { await cleanup(); }
