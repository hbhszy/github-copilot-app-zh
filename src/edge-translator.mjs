import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, readdir, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { CDP, getTargets } from './cdp.mjs';
import { inspectExe, powershell, psQuote } from './windows.mjs';
import { isDedicatedEdge, resolveEdgeListener } from './edge-process-policy.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
export async function edgeInstallation(local) {
  const exe = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
    .filter(Boolean).map(base => join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find(existsSync);
  if (!exe) throw new Error('未找到 Microsoft Edge');
  const info = await inspectExe(exe,{includeHash:false});
  if (info.signature !== 'Valid' || !/Microsoft Corporation/.test(info.signer || '')) throw new Error('Edge 签名校验失败');
  const profile = join(local, 'edge-translator');
  const versions = async path => (await readdir(path, {withFileTypes:true}).catch(()=>[])).filter(x=>x.isDirectory()).map(x=>x.name).sort().join(',');
  const model = await versions(join(profile, 'EdgeTranslateKitLanguagePack', 'en-zh'));
  const runtime = await versions(join(profile, 'EdgeLLMRuntime'));
  return { exe, profile, fingerprint: `${info.version}|${model}|${runtime}`, modelReady: Boolean(model && runtime) };
}

// Owns a separate headless Edge profile. HTTP serves only an empty bootstrap page;
// all text travels via loopback CDP, never through an HTTP translation endpoint.
export class EdgeTranslator {
  constructor(local, installation, { allowDownload = false } = {}) {
    this.local = local; this.installation = installation; this.allowDownload = allowDownload;
    this.lock = join(local, 'edge-translator.lock');
    this.stopping = false;
  }
  check() { if (this.stopping) throw new Error('翻译服务已停止'); }
  async processSnapshot(port = 0) {
    const raw=await powershell(`$p=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object {$_.CommandLine -and $_.CommandLine.Contains(${psQuote(this.installation.profile)})} | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine); $listeners=@(); if(${Number(port)} -gt 0){foreach($line in @(netstat -ano -p tcp)){$v=$line.Trim() -split '\\s+';if($v.Length -ge 5 -and $v[0] -eq 'TCP' -and $v[1] -match ':${Number(port)}$' -and $v[3] -eq 'LISTENING'){$listeners+=@{address=$v[1];pid=[int]$v[4]}}}}; @{processes=$p;listeners=$listeners} | ConvertTo-Json -Depth 4 -Compress`);
    return JSON.parse(raw);
  }
  async stopVerified(process) {
    if(!isDedicatedEdge(process,this.installation))return;
    // Recheck the exact command (which includes a unique bootstrap URL) before
    // stopping it, rather than trusting a potentially recycled numeric PID.
    await powershell(`$p=Get-CimInstance Win32_Process -Filter "ProcessId=${Number(process.ProcessId)}";if($p -and $p.ExecutablePath -eq ${psQuote(process.ExecutablePath)} -and $p.CommandLine -eq ${psQuote(process.CommandLine)}){Stop-Process -Id $p.ProcessId -ErrorAction SilentlyContinue}`);
  }
  async killOwned(pid) {
    if (!pid) return;
    const snapshot=await this.processSnapshot();
    const process=snapshot.processes.find(p=>p.ProcessId===pid);
    if(process)await this.stopVerified(process);
  }
  async acquire() {
    await mkdir(this.installation.profile, {recursive:true});
    try { await mkdir(this.lock); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = JSON.parse(await readFile(join(this.lock, 'owner.json'), 'utf8')); } catch { throw new Error('翻译配置目录正在初始化'); }
      if (alive(owner.pid)) throw new Error('本地翻译配置正在使用中');
      await rm(join(this.lock, 'owner.json'), {force:true}); await rmdir(this.lock);
      await mkdir(this.lock);
    }
    this.ownsLock = true;
    await this.saveOwner();
    // Edge can relaunch itself and leave a browser whose PID differs from the
    // original spawn handle. With our exclusive profile lock held, recover only
    // exact dedicated headless roots; never touch normal Edge or WebView2.
    const snapshot=await this.processSnapshot();
    for(const process of snapshot.processes)if(isDedicatedEdge(process,this.installation))await this.stopVerified(process);
    await rm(join(this.installation.profile,'DevToolsActivePort'),{force:true});
  }
  async saveOwner() {
    await writeFile(join(this.lock, 'owner.json'), JSON.stringify({pid:process.pid, browserPid:this.browserPid ?? null}));
  }
  start() {
    this.starting ??= this._start();
    return this.starting;
  }
  async _start() {
    const started=performance.now();
    this.timings={};
    this.check();
    if (!this.allowDownload && !this.installation.modelReady) throw new Error('本地模型缺失，请运行 npm run setup:translator');
    await this.acquire(); this.check();
    const route = '/' + randomUUID();
    this.server = createServer((req,res) => {
      if (req.url !== route || req.headers.host !== `127.0.0.1:${this.server.address()?.port}`) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store', 'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"});
      res.end('<!doctype html><meta charset="utf-8"><title>Copilot local translator</title>');
    });
    await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,'127.0.0.1',resolve)});
    this.url = `http://127.0.0.1:${this.server.address().port}${route}`;
    const {exe, profile} = this.installation;
    const args = ['--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'];
    if (!this.allowDownload) args.push('--proxy-server=http://127.0.0.1:9', '--disable-quic');
    args.push(this.url);
    this.check();
    // Node starts our dedicated headless browser directly; no extra PowerShell
    // process or quoting round-trip on every engine cold start.
    this.child=spawn(exe,args,{windowsHide:true,stdio:'ignore'});
    await new Promise((resolve,reject)=>{this.child.once('spawn',resolve);this.child.once('error',reject)});
    this.browserPid=this.child.pid;
    await this.saveOwner();
    let target, port;
    for (let i=0;i<80;i++) {
      this.check();
      try {
        port = Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);
        target = (await getTargets(port)).find(t=>t.type==='page' && t.url===this.url);
        if (target) break;
      } catch {}
      await sleep(250);
    }
    if (!target) throw new Error('翻译用 Edge 启动超时');
    this.timings.browserReadyMs=Math.round(performance.now()-started);
    this.check();
    const snapshot=await this.processSnapshot(port);
    const owner=resolveEdgeListener(port,snapshot.listeners,snapshot.processes,this.installation,this.url);
    this.timings.relaunched=owner.ProcessId!==this.browserPid;
    this.browserPid=owner.ProcessId;await this.saveOwner();
    this.timings.validatedMs=Math.round(performance.now()-started);
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`, {signal:AbortSignal.timeout(3000)})).json();
    this.check();
    this.browser = await CDP.connect(version.webSocketDebuggerUrl);
    this.cdp = await CDP.connect(target.webSocketDebuggerUrl);
    for(let i=0;i<30;i++) {
      this.check();
      if(await this.cdp.evaluate(`location.href===${JSON.stringify(this.url)} && document.readyState==='complete'`)) break;
      await sleep(100);
    }
    if (!this.allowDownload) {
      await this.cdp.send('Network.enable');
      await this.cdp.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    }
    this.check();
    const modelStarted=performance.now();
    const result = await this.cdp.send('Runtime.evaluate', {
      userGesture:true, awaitPromise:true, returnByValue:true,
      expression:`(async()=>{if(typeof Translator==='undefined')throw Error('Translator API unavailable');globalThis.localTranslator=await Translator.create({sourceLanguage:'en',targetLanguage:'zh'});return true})()`
    }, this.allowDownload ? 240000 : 30000);
    if (result.exceptionDetails) throw new Error('Edge 无法加载英中翻译模型');
    this.timings.modelLoadMs=Math.round(performance.now()-modelStarted);
    this.timings.totalMs=Math.round(performance.now()-started);
    this.check(); this.ready=true;
  }
  async translate(text) {
    await this.start(); this.check();
    const result = await this.cdp.send('Runtime.evaluate', {awaitPromise:true,returnByValue:true,
      expression:`localTranslator.translate(${JSON.stringify(text)})`},15000);
    if (result.exceptionDetails || typeof result.result?.value !== 'string') throw new Error('本地翻译失败');
    return result.result.value;
  }
  async close() {
    if(this.closing) return this.closing;
    this.stopping=true;
    this.cdp?.close(); // Interrupt any pending create/translate immediately.
    this.closing=(async()=>{
      await this.starting?.catch(()=>{});
      if(this.browser) { await this.browser.send('Browser.close',{},3000).catch(()=>{}); this.browser.close(); }
      if(this.child && this.child.exitCode===null) {
        await new Promise(resolve=>{const timer=setTimeout(resolve,1000);this.child.once('exit',()=>{clearTimeout(timer);resolve()})});
        // This handle belongs to the child we spawned, not an arbitrary PID.
        if(this.child.exitCode===null)this.child.kill();
      }
      if(this.ownsLock && this.url) {
        const snapshot=await this.processSnapshot();
        for(const process of snapshot.processes)if(isDedicatedEdge(process,this.installation,this.url))await this.stopVerified(process);
      }
      this.server?.closeAllConnections();
      if(this.server?.listening) await new Promise(r=>this.server.close(r));
      if(this.ownsLock) { await rm(join(this.lock,'owner.json'),{force:true}); await rmdir(this.lock).catch(()=>{}); this.ownsLock=false; }
      this.ready=false;
    })();
    return this.closing;
  }
}
