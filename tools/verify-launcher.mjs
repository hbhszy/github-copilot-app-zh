// Development test: wake the existing app and briefly dispose only our overlay.
// Does not quit/reload Copilot or submit any user data.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {CDP,getTargets,isAppTarget} from '../src/cdp.mjs';
const before=JSON.parse(await readFile('.local/state.json','utf8'));
assert.equal(before.phase,'ready','Wait for a translated Copilot instance first');
const {stdout}=await promisify(execFile)(process.execPath,['src/launcher.mjs'],{windowsHide:true,timeout:30000});
const after=JSON.parse(await readFile('.local/state.json','utf8'));
assert.equal(after.pid,before.pid,'A duplicate supervisor was created');
assert.equal(after.port,before.port);
const cdp=await CDP.connect((await getTargets(after.port)).find(isAppTarget).webSocketDebuggerUrl);
try{
  assert.equal(await cdp.evaluate('window.__copilotChinese?.status().ready'),true);
  await cdp.evaluate('window.__copilotChinese.dispose()');
  let recovered;
  for(let i=0;i<50;i++){
    await new Promise(r=>setTimeout(r,200));
    recovered=await cdp.evaluate('window.__copilotChinese?.status()');
    if(recovered?.enabled && recovered.ready)break;
  }
  assert.ok(recovered?.enabled && recovered.ready,'Overlay did not self-repair');
  const report={date:new Date().toISOString(),pid:after.pid,port:after.port,duplicate:stdout.trim(),recovered};
  await writeFile('.local/launcher-verification.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{cdp.close()}
