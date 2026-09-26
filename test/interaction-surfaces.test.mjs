import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {loadOverlaySource} from '../src/overlay-source.mjs';
import {createMachinePolicy} from '../src/machine-policy.mjs';
const dictionary=JSON.parse(readFileSync(new URL('../locales/zh-CN.json',import.meta.url),'utf8'));
const code=loadOverlaySource(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(body,options={}) {
  const dom=new JSDOM(body,{runScripts:'outside-only',url:'http://tauri.localhost/chats/example'});
  dom.window.eval(code);
  dom.window.installCopilotChinese(dictionary,dom.window.document,{test:true,machine:true,machinePolicy:createMachinePolicy(),...options});
  await sleep(60);
  return dom;
}
// Observed account layout: the pane has a settings header and an account list,
// not section[data-section-id]. Names and plan values are separate data fields.
const accounts=`<div role="dialog" aria-label="Settings"><div id="accounts">
  <div data-settings-header="true"><div><h2>Connected accounts</h2><p id="account-help">Projects use the default account unless changed in project settings.</p></div><div><button aria-haspopup="menu"><span data-component="label">Add account</span></button></div></div>
  <ul role="list"><li><div><div><div id="identity"><span data-component="Avatar"></span><div><div><p id="name">Plan</p><span id="default">Default</span></div><p id="handle">@private · private.example</p></div><div><button aria-haspopup="menu" aria-label="Account options"></button></div></div>
  <hr><div id="billing"><div></div><div><div><h3>Upgrade Copilot</h3><p id="upgrade-help">Upgrade your Copilot plan for higher usage limits, premium models, AI reviews and more.</p></div><button>Upgrade plan</button></div><hr>
  <section><h3 id="plan-label">Plan</h3><p id="plan-name">Plan</p><div><div><div><span><span id="meter-label">Chat messages</span></span><span id="usage">1%</span></div><div role="progressbar" aria-valuenow="1" aria-valuemax="100"></div></div></div><p id="quota-help">Resets monthly. Each request costs its model’s multiplier toward your allowance. <a href="https://example.test/help">Learn more</a></p></section></div></div></div></li></ul>
</div></div><button id="plan-mode">Plan</button>`;
test('account settings translate fixed billing fields without translating identities or plan values',async()=>{
  const dom=await fixture(accounts);try {
    const d=dom.window.document,api=dom.window.__copilotChinese;
    assert.equal(d.querySelector('h2').textContent,'已连接账户');
    assert.equal(d.querySelector('#plan-label').textContent,'套餐');
    assert.equal(d.querySelector('#plan-mode').textContent,dictionary.common.Plan);
    assert.equal(d.querySelector('#meter-label').textContent,'聊天消息');
    assert.match(d.querySelector('#account-help').textContent,/默认账户/);
    assert.match(d.querySelector('#upgrade-help').textContent,/升级/);
    assert.match(d.querySelector('#quota-help').textContent,/每月重置/);
    for(const id of ['name','plan-name'])assert.equal(d.getElementById(id).textContent,'Plan',id);
    assert.equal(d.querySelector('#handle').textContent,'@private · private.example');
    assert.equal(d.querySelector('#usage').textContent,'1%');
    assert.equal(d.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'),'1');
    assert.equal(d.querySelector('a').href,'https://example.test/help');
    assert.equal(api.drainMachine(16).length,0,'Common account copy should not wait for the engine');
    api.dispose();assert.equal(d.querySelector('#plan-label').textContent,'Plan');
    assert.equal(d.querySelector('#account-help').textContent,'Projects use the default account unless changed in project settings.');
  }finally{dom.window.close();}
});
test('new account help and quota labels queue by field, and lose ownership after moving into account data',async()=>{
  const dom=await fixture(accounts.replace('Projects use the default account unless changed in project settings.','Future account help').replace('Chat messages','Advanced request allowance'));try {
    const d=dom.window.document,api=dom.window.__copilotChinese,batch=api.drainMachine(16);
    assert.deepEqual(Array.from(batch,r=>r.text).sort(),['Advanced request allowance','Future account help']);
    assert.ok(batch.every(r=>r.context==='settings:account-chrome-v1:#text'));
    const quota=batch.find(r=>r.text==='Advanced request allowance');
    d.querySelector('#identity').append(d.querySelector('#meter-label'));
    assert.equal(api.applyMachine({...quota,translation:'高级请求配额'}),false);
    const help=batch.find(r=>r.text==='Future account help');
    assert.equal(api.applyMachine({...help,translation:'新的账户说明'}),true);
    d.querySelector('#identity').append(d.querySelector('#account-help'));
    await sleep(40);
    assert.equal(d.querySelector('#account-help').textContent,'Future account help');
  }finally{dom.window.close();}
});
test('late account header ownership rescans its sibling account list and preserves data collisions',async()=>{
  const dom=await fixture(accounts.replace('data-settings-header="true"','id="late-header"'));try {
    const d=dom.window.document,api=dom.window.__copilotChinese;
    d.querySelector('#late-header').setAttribute('data-settings-header','true');await sleep(40);
    assert.equal(d.querySelector('#plan-label').textContent,'套餐');
    assert.equal(d.querySelector('#plan-name').textContent,'Plan');
    d.querySelector('#quota-help').firstChild.nodeValue='Another quota explanation';await sleep(40);
    const request=api.drainMachine(16).find(r=>r.text==='Another quota explanation');assert.ok(request);
    d.querySelector('#late-header h2').firstChild.nodeValue='Private account profile';
    assert.equal(api.applyMachine({...request,translation:'另一条配额说明'}),false);
  }finally{dom.window.close();}
});
test('fork-chat action and its tooltip translate, never the adjacent transcript or an opted-out button',async()=>{
  const dom=await fixture(`<div aria-label="Conversation transcript"><p id="reply">Fork chat from response</p><button id="fork" data-base-ui-tooltip-trigger data-popup-open aria-label="Fork chat from response"></button><button id="off" translate="no" data-base-ui-tooltip-trigger aria-label="Fork chat from response"></button></div><div data-base-ui-focusable data-side="top" tabindex="-1"><span id="tip">Fork chat from response</span></div>`);try {
    const d=dom.window.document,api=dom.window.__copilotChinese;
    assert.equal(d.querySelector('#fork').getAttribute('aria-label'),'从此回复派生聊天');
    assert.equal(d.querySelector('#tip').textContent,'从此回复派生聊天');
    assert.equal(d.querySelector('#reply').textContent,'Fork chat from response');
    assert.equal(d.querySelector('#off').getAttribute('aria-label'),'Fork chat from response');
    api.dispose();assert.equal(d.querySelector('#tip').textContent,'Fork chat from response');
  }finally{dom.window.close();}
});
test('chat composer supports or/for placeholder variants but never edits matching draft text',async()=>{
  const source='Ask anything. Use / for commands or & for sessions…';
  const dom=await fixture(`<div data-rich-composer-content-wrapper="true"><div id="editor" role="textbox" contenteditable="true" data-lexical-editor="true" aria-placeholder="${source}">${source}</div><div id="placeholder" data-rich-composer-placeholder="true">${source}</div></div>`);try {
    const d=dom.window.document,api=dom.window.__copilotChinese,editor=d.querySelector('#editor');
    const expected='输入问题。使用 / 调用命令，& 引用会话…';
    assert.equal(editor.getAttribute('aria-placeholder'),expected);
    assert.equal(d.querySelector('#placeholder').textContent,expected);
    assert.equal(editor.textContent,source);
    editor.replaceChildren(d.createTextNode(source));await sleep(40);assert.equal(editor.textContent,source);
    d.querySelector('#placeholder').textContent='Ask anything. Use / for private secrets…';await sleep(40);
    assert.equal(d.querySelector('#placeholder').textContent,'Ask anything. Use / for private secrets…');
    assert.ok(!api.drainMachine(16).some(r=>r.text.includes('private secrets')));
    api.dispose();assert.equal(editor.getAttribute('aria-placeholder'),source);
  }finally{dom.window.close();}
});

test('portalled fixed settings choices inherit their control, including durations and new option copy',async()=>{
  const dom=await fixture(`<div role="dialog" aria-label="Settings"><section data-section-id="accessibility-notices"><button id="duration" aria-haspopup="menu" aria-label="Error duration, 10 seconds">10 seconds</button></section></div>
    <div role="menu" aria-labelledby="duration"><div role="menuitemradio" aria-checked="true">10 seconds</div><div role="menuitemradio">1 minute</div><div role="menuitemradio">Indefinite</div><div role="menuitemradio" id="future">Until reviewed</div></div><div class="prose" id="private"></div>`);try {
    const d=dom.window.document,api=dom.window.__copilotChinese;
    assert.match(d.querySelector('#duration').getAttribute('aria-label'),/10 秒/);
    assert.match(d.querySelector('[role="menu"]').textContent,/1 分钟/);
    assert.match(d.querySelector('[role="menu"]').textContent,/不限时长/);
    assert.equal(d.querySelector('[aria-checked]').getAttribute('aria-checked'),'true');
    const request=api.drainMachine(16).find(r=>r.text==='Until reviewed');assert.ok(request);
    d.querySelector('#private').append(d.querySelector('#duration'));
    assert.equal(api.applyMachine({...request,translation:'直到查看后'}),false);
    await sleep(40);assert.equal(d.querySelector('#future').textContent,'Until reviewed');
  }finally{dom.window.close();}
});
test('audio popup translates its file-open action but never audio filenames or selected sound names',async()=>{
  const dom=await fixture(`<div role="dialog" aria-label="Settings"><section data-section-id="general-notification-sound"><button id="sound" aria-haspopup="menu" aria-label="Session complete sound, Save">Save</button></section></div>
    <div role="menu" aria-labelledby="sound"><div role="menuitem">Open audio file…</div><div role="menuitemradio">Private ringtone</div><div role="menuitemradio">Save</div></div>`);try {
    const d=dom.window.document,api=dom.window.__copilotChinese;
    assert.equal(d.querySelector('[role="menuitem"]').textContent,'打开音频文件…');
    assert.equal(d.querySelectorAll('[role="menuitemradio"]')[1].textContent,'Save');
    assert.equal(d.querySelector('#sound').textContent,'Save');
    assert.match(d.querySelector('#sound').getAttribute('aria-label'),/，Save$/);
    assert.ok(!api.drainMachine(16).some(r=>/Private ringtone|Save/.test(r.text)));
    api.dispose();assert.equal(d.querySelector('[role="menuitem"]').textContent,'Open audio file…');
  }finally{dom.window.close();}
});
test('account menus translate descriptions and plan actions while retaining product identifiers',async()=>{
  const dom=await fixture(accounts.replace('<button aria-haspopup="menu"><span','<button id="add-account" aria-haspopup="menu"><span').replace('aria-label="Account options"','id="account-actions" aria-label="Account actions"')+
    `<div role="menu" aria-labelledby="add-account"><div role="menuitem" aria-label="GitHub.com, Personal and enterprise accounts"><span>GitHub.com</span><span>Personal and enterprise accounts</span></div><div role="menuitem"><span>GitHub Enterprise Cloud</span><span>Accounts on your company’s ghe.com domain</span></div></div>
    <div role="menu" aria-labelledby="account-actions"><div role="menuitem">Manage plan</div><div role="menuitem">Remove account</div><div role="menuitem">Future account action</div></div>`);try {
    const d=dom.window.document,api=dom.window.__copilotChinese;
    assert.match(d.querySelector('[aria-labelledby="add-account"]').textContent,/GitHub.com个人和企业账户/);
    assert.match(d.querySelector('[aria-labelledby="account-actions"]').textContent,/管理套餐移除账户/);
    assert.equal(d.querySelector('#account-actions').getAttribute('aria-label'),'账户操作');
    const request=api.drainMachine(16).find(r=>r.text==='Future account action');assert.ok(request);
    d.querySelector('#accounts [data-settings-header]').remove();
    assert.equal(api.applyMachine({...request,translation:'新的账户操作'}),false);
  }finally{dom.window.close();}
});
test('chat information menu translates metrics and copy wrappers, not same-named session data',async()=>{
  const dom=await fixture(`<header><button id="session" aria-haspopup="menu" aria-label="Save, session options">Save</button></header><div role="menu" aria-labelledby="session">
    <div role="menuitem" id="copy-name" aria-label="Copy session name, Session name"><span>Session name</span><span id="session-value">Session name</span></div>
    <div role="menuitem" aria-label="Copy session ID, Save"><span>Session ID</span><span id="id-value">Save</span></div>
    <dl><dt>Tokens</dt><dd><span>Sent to model</span><span>1.2M</span><span>(1.0M <span>cached)</span></span></dd><dt>Context</dt><dd>3%</dd></dl><div role="menuitem">Delete session</div><p id="unknown">Private menu payload</p></div>`);try {
    const d=dom.window.document,api=dom.window.__copilotChinese;
    assert.equal(d.querySelector('dt').textContent,'令牌');
    assert.equal(d.querySelector('#session').textContent,'Save');
    assert.equal(d.querySelector('#session').getAttribute('aria-label'),'Save，会话选项');
    assert.equal(d.querySelector('#copy-name').getAttribute('aria-label'),'复制会话名称，Session name');
    assert.equal(d.querySelector('#copy-name span').textContent,'会话名称');
    assert.equal(d.querySelector('#session-value').textContent,'Session name');
    assert.equal(d.querySelector('#id-value').textContent,'Save');
    assert.ok(!api.drainMachine(16).some(r=>r.text==='Private menu payload'));
    api.dispose();assert.equal(d.querySelector('dt').textContent,'Tokens');
  }finally{dom.window.close();}
});
