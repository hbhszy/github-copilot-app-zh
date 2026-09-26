import test from 'node:test';
import assert from 'node:assert/strict';
import { disconnectShouldStop } from '../src/launcher-lifecycle.mjs';
test('confirmed app exit releases reconnect grace immediately; live or unknown apps retain it',()=>{
  assert.equal(disconnectShouldStop(false,0),true);
  assert.equal(disconnectShouldStop(true,2000),false);
  assert.equal(disconnectShouldStop(undefined,2000),false);
  assert.equal(disconnectShouldStop(undefined,15000),true);
});
import { duplicateAction, appLaunchOptions, overlayNeedsRepair } from '../src/launcher-lifecycle.mjs';
import { CDP } from '../src/cdp.mjs';

test('rapid reopen waits during startup/disconnection/cleanup, never starts a plain app',()=>{
  const owner={pid:42};
  for(const phase of ['starting','connecting','reconnecting','stopping','stopped',undefined]) {
    assert.equal(duplicateAction(owner,{pid:42,active:true,phase},true),'wait',String(phase));
  }
  assert.equal(duplicateAction(owner,{pid:40,active:true,phase:'ready'},true),'wait');
  assert.equal(duplicateAction(owner,{pid:42,active:false,phase:'ready'},true),'wait');
  assert.equal(duplicateAction(owner,{pid:42,active:true,phase:'ready'},true),'request-wake');
  assert.equal(duplicateAction(owner,{pid:42,active:true,phase:'waiting-for-app-exit'},true),'waiting-for-app-exit');
  assert.equal(duplicateAction(owner,{pid:42,active:false,phase:'stopped'},false),'acquire');
});

test('both initial launch and wake use scoped debugging arguments and preserve the parent environment',()=>{
  const environment={PATH:'original',WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'old'};
  const options=appLaunchOptions(12345,environment);
  assert.equal(options.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,'--remote-debugging-port=12345 --remote-debugging-address=127.0.0.1');
  assert.equal(environment.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,'old');
  assert.equal(options.env.PATH,'original');
  assert.throws(()=>appLaunchOptions(null));
});

test('missing or disabled overlays are repaired; a still-initializing overlay is allowed to finish',()=>{
  assert.equal(overlayNeedsRepair(undefined),true);
  assert.equal(overlayNeedsRepair({enabled:false}),true);
  assert.equal(overlayNeedsRepair({enabled:true,ready:false}),false);
  assert.equal(overlayNeedsRepair({enabled:true,ready:true}),false);
});

test('cleanup of a closed CDP socket fails immediately without queuing a timed request',async()=>{
  const socket={readyState:WebSocket.CLOSED,addEventListener(){},send(){throw Error('should not send')}};
  const cdp=new CDP(socket);
  await assert.rejects(cdp.send('Page.removeScriptToEvaluateOnNewDocument'),/disconnected/);
  assert.equal(cdp.pending.size,0);
});
