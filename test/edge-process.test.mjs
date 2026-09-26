import test from 'node:test';
import assert from 'node:assert/strict';
import {windowsArguments,isDedicatedEdge,resolveEdgeListener} from '../src/edge-process-policy.mjs';
const info={exe:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',profile:'D:\\AI Projects\\copilot-zh\\.local\\edge-translator'};
const url='http://127.0.0.1:1208/unique-bootstrap';
const process={ProcessId:28108,ParentProcessId:30796,ExecutablePath:info.exe,CommandLine:`"${info.exe}" --headless=new --user-data-dir="${info.profile}" --remote-debugging-port=0 --remote-debugging-address=127.0.0.1 --edge-skip-compat-layer-relaunch ${url}`};
test('quoted profile switches identify the relaunched browser, not its exited launcher',()=>{
  assert.ok(windowsArguments(process.CommandLine).includes('--user-data-dir='+info.profile));
  assert.equal(isDedicatedEdge(process,info,url),true);
  assert.equal(resolveEdgeListener(1210,[{address:'127.0.0.1:1210',pid:28108}],[process],info,url).ProcessId,28108);
  assert.equal(isDedicatedEdge({...process,CommandLine:process.CommandLine.replace(`--user-data-dir="${info.profile}"`,`"--user-data-dir=${info.profile}"`)},info,url),true);
});
test('normal browsers, renderers, prefix-similar profiles and unrelated bootstrap URLs are not owned',()=>{
  for(const command of [process.CommandLine.replace('--headless=new',''),process.CommandLine+' --type=renderer',process.CommandLine.replace(info.profile,info.profile+'-other'),process.CommandLine.replace(url,url+'-other'),process.CommandLine+' --user-data-dir=Z:\\other'])assert.equal(isDedicatedEdge({...process,CommandLine:command},info,url),false,command);
  assert.equal(isDedicatedEdge({...process,ExecutablePath:'C:\\unrelated.exe'},info,url),false);
});
test('loopback, exact dedicated root and unique ownership are all mandatory',()=>{
  for(const listeners of [[],[{address:'0.0.0.0:1210',pid:28108}],[{address:'127.0.0.1:1210',pid:30796}],[{address:'127.0.0.1:1210',pid:28108},{address:'[::1]:1210',pid:30796}]])assert.throws(()=>resolveEdgeListener(1210,listeners,[process],info,url));
});
