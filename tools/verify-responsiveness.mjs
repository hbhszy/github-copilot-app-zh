// Explicit development check. --restart-companion restarts only our companion.
// Does not quit/reload Copilot, select a theme, submit tasks, or read user drafts.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {CDP,getTargets,isAppTarget} from '../src/cdp.mjs';
import {appProcesses,validateEndpoint} from '../src/windows.mjs';
const run=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const state=()=>readFile('.local/state.json','utf8').then(JSON.parse);
const before=await state();
const expectedVersion=JSON.parse(await readFile('locales/zh-CN.json','utf8')).version;
const pids=async()=> (await appProcesses()).filter(p=>p.ExecutablePath?.toLowerCase()===before.app.path.toLowerCase()).map(p=>p.ProcessId).sort();
const originalPids=await pids();
assert.ok(originalPids.length,'Keep the original app running for this non-disruptive check');
const report={date:new Date().toISOString(),mode:process.argv.includes('--restart-companion')?'companion-restart':'read-only'};
if(process.argv.includes('--restart-companion')) {
  let start=performance.now();
  await run(process.execPath,['src/launcher.mjs','--stop'],{windowsHide:true,timeout:45000});
  report.stopMs=Math.round(performance.now()-start);
  start=performance.now();
  await new Promise((resolve,reject)=>{
    const p=spawn('.local/CopilotZh.exe',[],{windowsHide:true,stdio:'ignore'});
    p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(Error('GUI entry exit '+code)));
  });
  report.entryReturnMs=Math.round(performance.now()-start);
  for(let i=0;i<300;i++) {
    const current=await state().catch(()=>null);
    if(current?.pid!==before.pid && current?.phase==='ready')break;
    await sleep(200);
  }
  report.readyAfterEntryMs=Math.round(performance.now()-start);
}
let current=await state();
assert.equal(current.phase,'ready');
if(report.mode==='companion-restart')assert.notEqual(current.pid,before.pid);
assert.deepEqual(await pids(),originalPids,'Original Copilot process changed during the check');
report.originalAppUnchanged=true;
await validateEndpoint(current.port,current.app.path);
const target=(await getTargets(current.port)).find(isAppTarget);
assert.ok(target);
const cdp=await CDP.connect(target.webSocketDebuggerUrl);
const errors=[];
cdp.socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text)});
try {
  await cdp.send('Runtime.enable');
  report.overlay=await cdp.evaluate('window.__copilotChinese.status()');
  assert.equal(report.overlay.version,expectedVersion);assert.equal(report.overlay.ready,true);
  // Allow an overlapping prewarm to finish; fixed UI is already available.
  for(let i=0;i<100;i++) {
    current=await state();
    if(['ready','idle','unavailable'].includes(current.machineTranslation?.state))break;
    await sleep(200);
  }
  report.startupTimings=current.timings;
  report.engine=current.machineTranslation;
  report.beforeIdle=await cdp.evaluate('window.__copilotChinese.status()');
  await sleep(2000);
  report.afterIdle=await cdp.evaluate('window.__copilotChinese.status()');
  report.runtimeExceptions=errors.length;
  assert.equal(errors.length,0);
  await writeFile('.local/responsiveness-verification.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {cdp.close()}
