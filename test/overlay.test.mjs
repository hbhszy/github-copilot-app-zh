import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { isAppTarget } from '../src/cdp.mjs';
import { createMachinePolicy } from '../src/machine-policy.mjs';
import { loadOverlaySource } from '../src/overlay-source.mjs';
const code = loadOverlaySource();
const dictionary = JSON.parse(readFileSync(new URL('../locales/zh-CN.json', import.meta.url), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fixture(body, options = {}) {
  const dom = new JSDOM(body, { runScripts: 'outside-only', url: options.url || 'http://tauri.localhost/' });
  dom.window.eval(code);
  dom.window.installCopilotChinese(options.dictionary ?? dictionary, dom.window.document, { test: true, ...options });
  await sleep(100);
  return dom;
}
test('only the actual Copilot app origin/type/title are admitted', () => {
  const base = { type: 'page', title: 'GitHub Copilot', url: 'http://tauri.localhost/' };
  assert.equal(isAppTarget(base), true);
  for (const bad of [{ url: 'https://evil.test/' }, { url: 'http://tauri.localhost.evil.test/' }, { type: 'worker' }, { title: 'Canvas' }, { url: 'http://tauri.localhost:3000/' }]) assert.equal(isAppTarget({ ...base, ...bad }), false);
});
test('UI translated without changing content, input values, file names or project names', async () => {
  const dom = await fixture(`<button id="ui">Settings</button>
  <button id="shortcut" aria-label="Settings, Ctrl + Comma"></button>
  <div role="dialog" aria-label="Settings"><h2>Storage location</h2><p>Where repositories are stored.</p>
  <input id="input" value="Settings" placeholder="Search settings…"><textarea id="area">Settings</textarea>
  <nav><ul><li><button>General</button></li></ul><ul><li><button id="project">General</button></li></ul></nav>
  <pre><code id="code">Settings</code></pre></div>
  <div role="region" aria-label="Conversation transcript"><p id="message">Settings</p><button id="msgbutton">Save</button></div>
  <div class="xterm"><span id="terminal">Settings</span></div>
  <div class="monaco-editor"><span id="editor">Settings</span></div>
  <div contenteditable="true" id="draft" aria-label="Message">Settings</div>
  <li role="treeitem"><button id="repo">Settings</button></li>
  <button role="tab" id="file">Settings</button>`);
  const d = dom.window.document;
  assert.equal(d.querySelector('#ui').textContent, '设置');
  assert.equal(d.querySelector('#shortcut').getAttribute('aria-label'), '设置, Ctrl + Comma');
  assert.equal(d.querySelector('h2').textContent, '存储位置');
  assert.equal(d.querySelector('#input').value, 'Settings');
  assert.equal(d.querySelector('#input').placeholder, '搜索设置…');
  assert.equal(d.querySelector('#draft').getAttribute('aria-label'), '消息');
  for (const id of ['area','code','message','terminal','editor','draft','repo','file']) assert.equal(d.getElementById(id).textContent, 'Settings', id);
  assert.equal(d.querySelector('#project').textContent, 'General');
  assert.equal(d.querySelector('#msgbutton').textContent, 'Save');
  dom.window.close();
});
test('incremental rerenders and streaming are stable; no self-triggering observer loop', async () => {
  const dom = await fixture('<button id="ui">Save</button><div aria-label="Conversation transcript"><span id="stream">Settings</span></div>');
  const d = dom.window.document, api = dom.window.__copilotChinese;
  const text = d.querySelector('#ui').firstChild;
  text.nodeValue = 'Cancel';
  d.querySelector('#stream').textContent += ' Save Cancel';
  const nested = d.createElement('div'); nested.innerHTML = '<button>New chat</button>'; d.body.append(nested);
  await sleep(100);
  assert.equal(text.nodeValue, '取消');
  assert.equal(nested.textContent, '新建聊天');
  assert.equal(d.querySelector('#stream').textContent, 'Settings Save Cancel');
  const passes = api.status().passes;
  await sleep(150);
  assert.equal(api.status().passes, passes);
  api.dispose();
  assert.equal(text.nodeValue, 'Cancel');
  assert.equal(nested.textContent, 'New chat');
  dom.window.close();
});
test('dispose preserves newer host edits; duplicate install and reinjection are safe', async () => {
  const dom = await fixture('<button id="ui" title="Settings">Save</button>');
  const d = dom.window.document, first = dom.window.__copilotChinese;
  dom.window.installCopilotChinese(dictionary, d, { test: true });
  assert.equal(dom.window.__copilotChinese, first);
  d.querySelector('#ui').firstChild.nodeValue = 'New user data';
  first.dispose();
  assert.equal(d.querySelector('#ui').textContent, 'New user data');
  assert.equal(d.querySelector('#ui').title, 'Settings');
  dom.window.installCopilotChinese(dictionary, d, { test: true });
  await sleep(100);
  assert.equal(d.querySelector('#ui').title, '设置');
  dom.window.close();
});
test('dynamic counts restricted to settings; unknown strings and keyboard glyphs preserved', async () => {
  const dom = await fixture('<button id="outside">10 seconds</button><div role="dialog" aria-label="Settings"><p id="inside">10 seconds</p><kbd>Home</kbd><p id="unknown">Unknown future setting</p></div>');
  const d = dom.window.document;
  assert.equal(d.querySelector('#outside').textContent, '10 seconds');
  assert.equal(d.querySelector('#inside').textContent, '10 秒');
  assert.equal(d.querySelector('kbd').textContent, 'Home');
  assert.equal(d.querySelector('#unknown').textContent, 'Unknown future setting');
  dom.window.close();
});
test('shortcut dialogs are one structural surface: commands translate automatically while keycaps stay exact', async () => {
  const dom = await fixture(`<div role="dialog" aria-label="Keyboard shortcuts">
    <div role="tablist"><button role="tab" id="all">All shortcuts</button><button role="tab" id="view">Current view</button></div>
    <h2>General</h2>
    <div class="row"><span id="known">Find in file</span><span>Ctrl</span><span>F</span></div>
    <div class="row"><span id="future">Focus next work item</span><span>Ctrl</span><span>G</span></div>
    <div class="row"><span>Find previous match</span><span>Ctrl</span><span>Shift</span><span>G</span></div>
    <h2>Navigation</h2>
  </div>`,{machine:true,machinePolicy:createMachinePolicy()});
  const d=dom.window.document,api=dom.window.__copilotChinese;
  assert.equal(d.querySelector('#known').textContent,'在文件中查找');
  assert.match(d.querySelector('[role="dialog"]').textContent,/查找上一个匹配项/);
  assert.match(d.querySelector('[role="dialog"]').textContent,/导航/);
  const batch=api.drainMachine(16);
  assert.deepEqual(Array.from(batch,r=>r.text),['Focus next work item']);
  assert.ok(batch.every(r=>r.context==='dialog:shortcut-v1:#text'));
  assert.ok(!batch.some(r=>['Ctrl','Shift','F','G'].includes(r.text)));
  dom.window.close();
});
test('compact keyboard-shortcuts dialog without tabs is the same structural surface', async () => {
  const dom=await fixture(`<div role="dialog"><div class="titlebar"><h2>Keyboard shortcuts</h2><button aria-label="Shortcut settings"></button></div>
    <h3>General</h3>
    <div><span id="known">Command palette</span><span>Ctrl</span><span>K</span><span>or</span><span>Ctrl</span><span>Shift</span><span>P</span></div>
    <div><span id="future">Focus diagnostics panel</span><span>Ctrl</span><span>G</span></div>
    <h3>Navigation</h3><div><span>Go back</span><span>Ctrl</span><span>[</span></div>
  </div>`,{machine:true,machinePolicy:createMachinePolicy()});
  const d=dom.window.document,api=dom.window.__copilotChinese;
  assert.equal(d.querySelector('h2').textContent,'键盘快捷键');
  assert.equal(d.querySelector('#known').textContent,'命令面板');
  assert.match(d.querySelector('[role="dialog"]').textContent,/导航/);
  const batch=api.drainMachine(16);
  assert.ok(batch.some(r=>r.text==='Focus diagnostics panel'));
  assert.ok(!batch.some(r=>['Ctrl','Shift','K','P','G','['].includes(r.text)));
  assert.ok(batch.every(r=>r.context==='dialog:shortcut-v1:#text' || r.context==='dialog:shortcut-v1:aria-label'));
  dom.window.close();
});
test('settings form chrome translates by control structure without exposing provider values', async () => {
  const dom = await fixture(`<div role="dialog" aria-label="Settings"><div class="provider-editor">
    <div id="provider-title">Edit example-provider</div><div id="models-count">Models (3)</div>
    <div class="field"><div id="display-label">Display name</div><input value="example-provider"></div>
    <div class="field"><div id="base-label">Base URL</div><input value="http://private.invalid/v1"><p id="help">Include the OpenAI-compatible root, e.g. "https://api.openai.com/v1".</p></div>
    <div class="field"><div id="wire-label">Wire API</div><button role="combobox">responses</button></div>
    <div class="field"><div id="key-label">API key (optional)</div><input placeholder="Replace key" value="secret-value"></div>
    <div class="field"><div id="headers-label">Custom headers (JSON) (optional)</div><input value="{}"><p id="headers-help">Object of additional HTTP headers, e.g. {"X-Org": "acme"}.</p></div>
    <div class="field"><div id="effort-label">Reasoning effort (optional)</div><div><input type="checkbox"><span>None</span><input type="checkbox"><span>Minimal</span><input type="checkbox"><span>Low</span><input type="checkbox"><span>High</span><input type="checkbox"><span>Extra High</span><input type="checkbox"><span>Max</span></div></div>
    <div class="actions"><button>Cancel</button><button id="save">Save changes</button></div>
    <div id="provider-name">example-provider</div><div id="model-name">example-model-1</div><div role="option">Private model alias</div>
  </div></div>`,{machine:true,machinePolicy:createMachinePolicy()});
  const d=dom.window.document,api=dom.window.__copilotChinese,batch=api.drainMachine(32);
  const texts=batch.map(r=>r.text);
  assert.equal(d.querySelector('#provider-title').textContent,'编辑 example-provider');
  assert.equal(d.querySelector('#models-count').textContent,'模型 (3)');
  for(const text of ['Display name','Base URL','Include the OpenAI-compatible root, e.g. "https://api.openai.com/v1".','Wire API','API key (optional)','Replace key','Custom headers (JSON) (optional)','Object of additional HTTP headers, e.g. {"X-Org": "acme"}.','Reasoning effort (optional)','None','Minimal','Max','Save changes']) assert.ok(texts.includes(text),text);
  assert.equal([...d.querySelectorAll('#effort-label + div span')].find(e=>e.textContent==='极高')?.textContent,'极高');
  assert.ok(batch.filter(r=>r.context.startsWith('settings:form-chrome-v2:')).length>=13);
  for(const value of ['example-provider','example-model-1','http://private.invalid/v1','secret-value','responses','Private model alias']) assert.ok(!texts.includes(value),value);
  const help=batch.find(r=>r.text.startsWith('Include the OpenAI-compatible root'));
  assert.equal(api.applyMachine({...help,translation:'包含 OpenAI 兼容的根地址，例如 "https://api.openai.com/v1"。'}),true);
  assert.match(d.querySelector('#help').textContent,/https:\/\/api\.openai\.com\/v1/);
  const headersHelp=batch.find(r=>r.text.startsWith('Object of additional HTTP headers'));
  assert.equal(api.applyMachine({...headersHelp,translation:'附加 HTTP 标头对象，例如 {"X-Org": "acme"}。'}),true);
  assert.match(d.querySelector('#headers-help').textContent,/\{"X-Org": "acme"\}/);
  assert.equal(d.querySelector('input').value,'example-provider');
  assert.equal(d.querySelector('button[role="combobox"]').textContent,'responses');
  dom.window.close();
});
test('provider/model settings use generic picker chrome and dynamic wrappers without translating identities', async () => {
  const dom=await fixture(`<div role="dialog" aria-label="Settings"><section data-section-id="model-providers-custom">
    <button role="combobox" id="add"><span>Add provider</span></button>
    <div><span id="provider">example-provider</span><button id="edit" aria-label="Edit example-provider"></button><button id="remove" aria-label="Remove example-provider"></button><button id="connected" aria-label="Connected, example-provider"></button></div>
    <button role="combobox" id="browse" aria-label="Browse catalog"></button><button id="custom" aria-label="Add model by ID"></button>
    <button role="combobox" id="wire">responses</button><div role="option" id="model">gpt-5.6-terra</div>
  </section></div>`,{machine:true,machinePolicy:createMachinePolicy()});
  const d=dom.window.document,api=dom.window.__copilotChinese;
  assert.equal(d.querySelector('#add').textContent,'添加提供商');
  assert.equal(d.querySelector('#edit').getAttribute('aria-label'),'编辑 example-provider');
  assert.equal(d.querySelector('#remove').getAttribute('aria-label'),'移除 example-provider');
  assert.equal(d.querySelector('#connected').getAttribute('aria-label'),'已连接，example-provider');
  assert.equal(d.querySelector('#wire').textContent,'responses');
  assert.equal(d.querySelector('#model').textContent,'gpt-5.6-terra');
  const batch=api.drainMachine(16);
  assert.deepEqual(Array.from(batch,r=>r.text).sort(),['Add model by ID','Browse catalog'].sort());
  assert.ok(batch.every(r=>r.context==='settings:form-chrome-v2:aria-label'));
  assert.ok(!batch.some(r=>/example-provider|responses|gpt-5\.6-terra/.test(r.text)));
  dom.window.close();
});
test('command palette translates chrome/actions but preserves recent session and project data', async()=>{
  const dom=await fixture(`<div role="dialog" aria-label="Command palette">
    <input aria-label="Search sessions, repos, PRs, issues, or paste a URL…" placeholder="Search sessions, repos, PRs, issues, or paste a URL…">
    <div role="listbox"><div role="group" aria-labelledby="recent"><div id="recent">Recent</div><div role="option"><span id="session">Project assessment</span><span id="project">github-copilot-app-zh</span></div></div>
    <div role="group" aria-labelledby="actions"><div id="actions">Actions</div><div role="option" id="future">Open diagnostics center</div><div role="option" id="known-action">New session</div></div></div>
  </div>`,{machine:true,machinePolicy:createMachinePolicy()});
  const d=dom.window.document,api=dom.window.__copilotChinese;
  assert.equal(d.querySelector('#recent').textContent,'最近');
  assert.equal(d.querySelector('#session').textContent,'Project assessment');
  assert.equal(d.querySelector('#project').textContent,'github-copilot-app-zh');
  assert.equal(d.querySelector('#known-action').textContent,'新建会话');
  assert.match(d.querySelector('input').placeholder,/搜索会话/);
  const batch=api.drainMachine(16);
  assert.ok(batch.some(r=>r.text==='Open diagnostics center'));
  assert.ok(batch.every(r=>r.context.startsWith('dialog:command-palette-v1:')));
  assert.ok(!batch.some(r=>/Project assessment|github-copilot-app-zh/.test(r.text)));
  dom.window.close();
});
test('workspace/session menus are structural popup families and keep selected repository data out', async()=>{
  const dom=await fixture(`<button id="workspace" aria-label="Workspace: Local">Local</button>
    <div role="menu" aria-labelledby="workspace"><div role="group"><div role="presentation">Where to run this session</div>
      <div role="menuitemradio"><span>New worktree</span><span data-menu-description>Creates a separate copy for this session</span></div>
      <div role="menuitemradio"><span>Local repository</span><span data-menu-description>Works in the repository already on your machine</span></div>
      <div role="menuitemradio"><span>Cloud</span><span data-menu-description>Runs in a cloud sandbox</span></div>
      <div role="menuitemradio"><span>Temporary sandbox</span><span data-menu-description>Creates an isolated disposable environment</span></div>
    </div></div>`,{machine:true,machinePolicy:createMachinePolicy()});
  const d=dom.window.document,api=dom.window.__copilotChinese,batch=api.drainMachine(16);
  assert.match(d.querySelector('[role="presentation"]').textContent,/在哪里运行/);
  assert.match(d.querySelector('[role="menu"]').textContent,/新工作树/);
  assert.ok(batch.some(r=>r.text==='Temporary sandbox'));
  assert.ok(batch.some(r=>r.text==='Creates an isolated disposable environment'));
  assert.ok(batch.every(r=>r.context.startsWith('popup:workspace-location:')));
  dom.window.close();
});
test('generic chrome controls accept new app-owned button labels but not project/workspace/model data controls', async()=>{
  const dom=await fixture(`<main><button id="copy">Copy all</button><button id="export">Export diagnostics</button>
    <button id="project" aria-label="Project: private-project">private-project</button>
    <button id="workspace" aria-label="Workspace: Local">Local</button>
    <button id="model" aria-label="secret-model Extra High, model and reasoning">secret-model</button>
    <div class="prose"><button id="message">Private response action</button></div></main>`,{machine:true,machinePolicy:createMachinePolicy()});
  const batch=dom.window.__copilotChinese.drainMachine(16),texts=batch.map(r=>r.text);
  assert.ok(texts.includes('Copy all'));assert.ok(texts.includes('Export diagnostics'));
  for(const value of ['private-project','Local','secret-model','Private response action'])assert.ok(!texts.includes(value),value);
  assert.ok(batch.every(r=>r.context.startsWith('control:chrome-v1:')));
  dom.window.close();
});
test('repository new-session action translates only its fixed wrapper',async()=>{
  const dom=await fixture(`<aside><li role="treeitem"><button data-testid="repository-group-new-workspace-action" aria-label="New session in private-repo"></button></li></aside>`);
  assert.equal(dom.window.document.querySelector('button').getAttribute('aria-label'),'在 private-repo 中新建会话');
  dom.window.close();
});
test('session information dialog translates chrome and counters while preserving branch, path, project and session data',async()=>{
  const dom=await fixture(`<button id="session-trigger" aria-controls="session-info" aria-label="Project assessment · github-copilot-app-zh/main, session information">Project assessment · github-copilot-app-zh/main</button>
    <div id="session-info" role="dialog" aria-labelledby="session-info-title"><div><h3 id="session-info-title">Session information</h3>
      <div><button id="branch" aria-label="Copy branch, main"><span>main</span></button><span id="from">from</span><span>origin/main</span></div>
      <dl><div><dt>Remote control</dt><dd>Not enabled</dd></div><div><dt>Path</dt><dd><button aria-label="Copy path, D:\\projects\\sample-app">D:\\projects\\sample-app</button></dd></div>
        <div><dt>Project</dt><dd>github-copilot-app-zh</dd></div><div><dt>Session name</dt><dd><button aria-label="Copy session name, Project assessment">Project assessment</button></dd></div><div><dt>Session ID</dt><dd><button aria-label="Copy session ID, 08bf-private-id">08bf-private-id</button></dd></div></dl>
      <dl><div><dt>Changes</dt><dd>55 Untracked</dd></div></dl>
      <dl><div><dt>Tokens</dt><dd><span>Sent to model</span><span>3.1M</span><span>(3.0M <span>cached)</span></span><span>Received from model</span><span>30.5K</span><span>(20.0K <span>reasoning)</span></span></dd></div><div><dt>Context</dt><dd>9%</dd></div></dl>
      <div><button>Enable remote control</button><button>Rename session</button><button>View session insights</button><button>Share as secret gist</button><button>Archive session</button></div>
    </div></div>`,{machine:true,machinePolicy:createMachinePolicy()});
  const d=dom.window.document,api=dom.window.__copilotChinese;
  assert.equal(d.querySelector('h3').textContent,'会话信息');
  assert.equal(d.querySelector('#branch span').textContent,'main');
  assert.equal(d.querySelector('#branch').getAttribute('aria-label'),'复制分支，main');
  assert.equal(d.querySelector('#from').textContent,'来自');
  assert.deepEqual([...d.querySelectorAll('dt')].map(e=>e.textContent),['远程控制','路径','项目','会话名称','会话 ID','更改','令牌','上下文']);
  assert.match(d.querySelectorAll('dd')[0].textContent,/未启用/);
  assert.equal(d.querySelectorAll('dd')[1].textContent,'D:\\projects\\sample-app');
  assert.equal(d.querySelectorAll('dd')[2].textContent,'github-copilot-app-zh');
  assert.equal(d.querySelectorAll('dd')[3].textContent,'Project assessment');
  assert.equal(d.querySelectorAll('dd')[3].querySelector('button').getAttribute('aria-label'),'复制会话名称，Project assessment');
  assert.match(d.querySelectorAll('dd')[5].textContent,/55 未跟踪/);
  assert.match(d.querySelectorAll('dd')[6].textContent,/发送给模型/);
  assert.match(d.querySelectorAll('dd')[6].textContent,/\(3.0M 已缓存\)/);
  assert.match(d.querySelectorAll('dd')[6].textContent,/模型返回/);
  assert.match(d.querySelectorAll('dd')[6].textContent,/\(20.0K 推理\)/);
  assert.deepEqual([...d.querySelectorAll('[role="dialog"] > div > div:last-child button')].map(e=>e.textContent),['启用远程控制','重命名会话','查看会话见解','分享为私密 Gist','存档会话']);
  assert.equal(api.drainMachine(16).length,0);
  dom.window.close();
});
test('message chrome inside protected transcript translates without touching response text',async()=>{
  const dom=await fixture(`<div data-message-id="assistant"><div class="prose"><p id="body">Private assistant response text.</p>
    <button data-testid="assistant-reasoning-toggle"><span>Thought for 41s</span></button>
    <button id="copy" data-base-ui-tooltip-trigger aria-label="Copy assistant message"></button>
    <button id="fork" data-base-ui-tooltip-trigger aria-label="Fork session from response"></button></div></div>
    <div id="tip" role="tooltip">Copy response</div>`,{machine:true,machinePolicy:createMachinePolicy()});
  const d=dom.window.document;
  assert.equal(d.querySelector('#body').textContent,'Private assistant response text.');
  assert.equal(d.querySelector('[data-testid="assistant-reasoning-toggle"]').textContent,'思考了 41 秒');
  assert.equal(d.querySelector('#copy').getAttribute('aria-label'),'复制回复');
  assert.equal(d.querySelector('#fork').getAttribute('aria-label'),'从此回复派生会话');
  assert.equal(d.querySelector('#tip').textContent,'复制回复');
  dom.window.close();
});
test('run-options menu preserves script names and translates only fixed chrome after separator',async()=>{
  const dom=await fixture(`<button id="run-options" aria-label="Run options"></button>
    <div role="menu" aria-labelledby="run-options"><div role="none"><div role="menuitem" id="script">start</div></div><div role="none" data-menu-separator></div><div role="menuitem" id="configure">Configure scripts</div></div>`,{machine:true,machinePolicy:createMachinePolicy()});
  const d=dom.window.document,api=dom.window.__copilotChinese;
  assert.equal(d.querySelector('#run-options').getAttribute('aria-label'),'运行选项');
  assert.equal(d.querySelector('#script').textContent,'start');
  assert.equal(d.querySelector('#configure').textContent,'配置脚本');
  assert.equal(api.drainMachine(16).length,0);
  dom.window.close();
});
test('session ordering submenu follows composite trigger ownership and translates all fixed sort choices',async()=>{
  const dom=await fixture(`<button id="configure" aria-label="Configure sessions"></button>
    <div id="root-menu" role="menu" aria-labelledby="configure"><div id="ordering" role="menuitem" aria-haspopup="menu" aria-controls="sort-menu" aria-label="Ordering, Updated"><span>Ordering</span><span>Updated</span></div></div>
    <div id="sort-menu" role="menu" aria-labelledby="ordering"><div role="menuitemradio">Updated</div><div role="menuitemradio">Created</div><div role="menuitemradio">Status</div><div role="menuitemradio">Name (A-Z)</div><div role="menuitemradio">Name (Z-A)</div></div>`,{machine:true,machinePolicy:createMachinePolicy()});
  const d=dom.window.document,api=dom.window.__copilotChinese;
  assert.equal(d.querySelector('#ordering').getAttribute('aria-label'),'排序，更新时间');
  assert.deepEqual([...d.querySelectorAll('#sort-menu [role="menuitemradio"]')].map(e=>e.textContent),['更新时间','创建时间','状态','名称（A-Z）','名称（Z-A）']);
  assert.equal(api.drainMachine(16).length,0);
  dom.window.close();
});
test('workspace add-tab menu translates built-in tools and group chrome while preserving related issue identities',async()=>{
  const dom=await fixture(`<button id="add-tab" aria-label="Add tab, Ctrl + T"></button>
    <div role="menu" aria-labelledby="add-tab">
      <div role="menuitem"><span>Changes</span></div><div role="menuitem"><span>Terminal</span></div><div role="menuitem"><span>Browser</span></div>
      <div role="menuitem"><span>Files</span></div><div role="menuitem"><span>Side chat</span></div><div role="menuitem"><span>Insights</span></div>
      <div role="group"><div role="presentation">Relevant from session</div>
        <div role="menuitem" aria-label="#1789, github/app, issue"><span>#1789</span><span id="repo">github/app</span><span id="issue">, issue</span></div>
      </div><div role="menuitem"><span>Canvas</span></div>
    </div>`,{machine:true,machinePolicy:createMachinePolicy()});
  const d=dom.window.document,api=dom.window.__copilotChinese;
  assert.equal(d.querySelector('#add-tab').getAttribute('aria-label'),'添加标签页, Ctrl + T');
  assert.deepEqual([...d.querySelectorAll('[role="menu"] > [role="menuitem"]')].map(e=>e.textContent),['更改','终端','浏览器','文件','侧边聊天','洞察','画布']);
  assert.equal(d.querySelector('[role="presentation"]').textContent,'会话相关');
  assert.equal(d.querySelector('#repo').textContent,'github/app');
  assert.equal(d.querySelector('#issue').textContent,'，议题');
  assert.equal(d.querySelector('[aria-label^="#1789"]').getAttribute('aria-label'),'#1789, github/app, issue');
  assert.equal(api.drainMachine(16).length,0);
  dom.window.close();
});
test('browser workspace tab and built-in empty state translate without touching URL values or shortcut keys',async()=>{
  const dom=await fixture(`<div data-testid="workspace-right-panel-content"><section><h2>Workspace</h2>
    <div data-testid="tab-shell-tab-actions"><div data-testid="tab-shell-tab-strip-scroll"><div role="tablist"><div role="tab" aria-label="Browser"><span>Browser</span></div></div></div></div>
    <div role="tabpanel" aria-label="Browser"><div>
      <button aria-label="Back"></button><button aria-label="Forward"></button><button aria-label="Refresh"></button>
      <input aria-label="URL" placeholder="Enter a URL" value="http://127.0.0.1:3000">
      <button data-testid="browser-shared-with-agent-toggle" aria-label="Share browser tab with agent"></button>
      <div role="radiogroup" aria-label="Preview color scheme"><button role="radio" aria-label="Light preview theme"><span>Light preview theme</span></button><button role="radio" aria-label="Dark preview theme"><span>Dark preview theme</span></button></div>
      <button data-testid="browser-inspect-button" aria-label="Pick & Polish, Ctrl + Shift + C"><span>Pick & Polish</span></button>
      <div><p>Use Pick & Polish to refine your frontend</p><p>Enter a local dev URL, then press <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>C</kbd> to pick elements and polish them live.</p></div>
    </div></div>
  </section></div>`,{machine:true,machinePolicy:createMachinePolicy()});
  const d=dom.window.document,api=dom.window.__copilotChinese;
  assert.equal(d.querySelector('h2').textContent,'工作区');
  const tab=d.querySelector('[role="tab"]');
  assert.equal(tab.textContent,'浏览器');assert.equal(tab.getAttribute('aria-label'),'浏览器');
  const input=d.querySelector('input');assert.equal(input.placeholder,'输入 URL');assert.equal(input.value,'http://127.0.0.1:3000');
  assert.equal(d.querySelector('[data-testid="browser-shared-with-agent-toggle"]').getAttribute('aria-label'),'与代理共享浏览器标签页');
  assert.deepEqual([...d.querySelectorAll('[role="radio"]')].map(e=>e.textContent),['浅色预览主题','深色预览主题']);
  assert.equal(d.querySelector('[role="radiogroup"]').getAttribute('aria-label'),'Preview color scheme','Structural group label remains stable');
  assert.equal(d.querySelector('[data-testid="browser-inspect-button"] span').textContent,'选取并润色');
  assert.equal(d.querySelector('[data-testid="browser-inspect-button"]').getAttribute('aria-label'),'选取并润色, Ctrl + Shift + C');
  const paragraphs=[...d.querySelectorAll('p')];
  assert.equal(paragraphs[0].textContent,'使用“选取并润色”优化前端');
  assert.match(paragraphs[1].textContent,/输入本地开发 URL，然后按/);assert.match(paragraphs[1].textContent,/即可选取元素并实时润色。/);
  assert.deepEqual([...d.querySelectorAll('kbd')].map(e=>e.textContent),['Ctrl','Shift','C']);
  assert.equal(api.drainMachine(16).length,0);
  dom.window.close();
});
test('page-specific text does not translate ordinary user content matching a common UI key', async () => {
  const dom = await fixture('<main><p id="name">Settings</p><p id="fixed">GitHub Copilot uses AI. Check for mistakes.</p></main>');
  assert.equal(dom.window.document.querySelector('#name').textContent, 'Settings');
  assert.equal(dom.window.document.querySelector('#fixed').textContent, 'GitHub Copilot 使用 AI，请核查结果。');
  dom.window.close();
});

test('machine candidates exclude user data; dictionary wins and late results cannot overwrite host edits', async () => {
  const dom=await fixture(`<div role="dialog" aria-label="Settings">
    <section data-section-id="general-new-feature"><div><h2 data-section-heading="true">Future display preferences</h2><p id="good">Automatically hide inactive panels.</p></div>
      <button id="known">Save</button><button aria-haspopup="listbox">Private Workspace Name</button>
      <p id="data">Private Workspace Name</p><input value="Never translate this draft"><pre>Some English source code</pre>
    </section>
    <section data-section-id="accounts-new"><div><h2 data-section-heading="true">Private Account Name</h2><p>Private account biography</p></div></section>
  </div><div aria-label="Conversation transcript"><p>Automatically hide inactive panels.</p></div>`,{machine:true,machinePolicy:createMachinePolicy()});
  const d=dom.window.document, api=dom.window.__copilotChinese;
  const batch=api.drainMachine();
  assert.equal(batch.length,2);
  assert.equal(d.querySelector('#known').textContent,'保存');
  assert.equal(d.querySelector('#data').textContent,'Private Workspace Name');
  const req=batch.find(r=>r.text==='Automatically hide inactive panels.');
  assert.equal(api.applyMachine({...req,translation:'自动隐藏非活动面板。'}),true);
  assert.equal(d.querySelector('#good').textContent,'自动隐藏非活动面板。');
  const heading=batch.find(r=>r.id!==req.id);
  d.querySelector('h2').firstChild.nodeValue='New host value';
  assert.equal(api.applyMachine({...heading,translation:'未来显示偏好'}),false);
  api.dispose();
  assert.equal(d.querySelector('#good').textContent,'Automatically hide inactive panels.');
  assert.equal(d.querySelector('h2').textContent,'New host value');
  assert.equal(api.applyMachine({...req,translation:'不应出现'}),false);
  dom.window.close();
});

test('machine replies are rejected after a node moves into protected content or belongs to an old page instance', async()=>{
  const dom=await fixture('<div role="dialog" aria-label="Settings"><section data-section-id="general-test"><h2 data-section-heading="true">Future display preferences</h2></section></div><div id="chat" class="prose"></div>',{machine:true,machinePolicy:createMachinePolicy()});
  const d=dom.window.document,api=dom.window.__copilotChinese,req=api.drainMachine()[0];
  assert.equal(api.applyMachine({...req,instance:'old-instance',translation:'未来显示偏好'}),false);
  d.querySelector('#chat').append(d.querySelector('section'));
  assert.equal(api.applyMachine({...req,translation:'未来显示偏好'}),false);
  assert.equal(d.querySelector('h2').textContent,'Future display preferences');
  dom.window.close();
});

test('sidebar fixed menu omissions are translated while project names remain intact',async()=>{
  const dom=await fixture('<div role="menu"><div>Start session in</div><div role="menuitem">Clone repository</div><div role="menuitem">Open folder</div><div role="menuitem">example-project</div></div><aside><div id="sidebar-group-example"><div>No sessions yet</div></div></aside>');
  assert.match(dom.window.document.body.textContent,/克隆仓库/);
  assert.match(dom.window.document.body.textContent,/打开文件夹/);
  assert.match(dom.window.document.body.textContent,/在以下项目中开始会话/);
  assert.match(dom.window.document.body.textContent,/暂无会话/);
  assert.match(dom.window.document.body.textContent,/example-project/);
  dom.window.close();
});

test('theme card names and selected values never enter automatic translation',async()=>{
  const dom=await fixture('<div role="dialog" aria-label="Settings"><section data-section-id="themes-gallery"><div><h2 data-section-heading="true">Browse installed themes</h2><p>Choose a comfortable color scheme.</p></div><button title="Rainglow Crisp"><span data-component="label">Rainglow Crisp</span></button><button aria-pressed="true">Shades of Purple</button></section><section data-section-id="general-tools"><button aria-pressed="true" title="Private Tool Name"><span data-component="label">Private Tool Name</span></button></section></div>',{machine:true,machinePolicy:createMachinePolicy()});
  const requests=dom.window.__copilotChinese.drainMachine();
  assert.equal(requests.length,2);
  assert.ok(requests.every(r=>!r.text.includes('Rainglow')&&!r.text.includes('Purple')&&!r.text.includes('Private')));
  dom.window.close();
});

test('project branches stay pruned but their dedicated empty-state leaf is translated',async()=>{
  const dom=await fixture('<aside><li role="treeitem"><button>Settings</button><ul data-testid="repository-group-children-example"><li role="treeitem" aria-disabled="true">No sessions yet</li></ul></li></aside><div role="menuitem" data-testid="project-menu-item">Clone repository</div>');
  assert.equal(dom.window.document.querySelector('button').textContent,'Settings');
  assert.equal(dom.window.document.querySelector('[aria-disabled]').textContent,'暂无会话');
  assert.equal(dom.window.document.querySelector('[data-testid="project-menu-item"]').textContent,'Clone repository');
  dom.window.close();
});

test('portalled fixed dropdowns translate and queue new labels, while data pickers stay intact',async()=>{
  const dom=await fixture(`<button id="model" aria-label="Auto · Balance, model and reasoning">Auto · Balance</button>
    <div role="menu" aria-labelledby="model"><div role="menuitemcheckbox">Auto</div>
      <div role="listbox" aria-label="Auto optimization"><div role="group"><div>Optimized for</div>
        <div role="option" data-auto-tier-id="efficiency" aria-selected="false">Efficiency</div>
        <div role="option" data-auto-tier-id="balance" aria-selected="true">Balance</div>
        <div role="option">Intelligence</div><div role="option" id="future">Thorough</div>
      </div></div><div role="listbox" aria-label="Models"><div role="option" id="model-name">Intelligence</div></div>
    </div><div role="listbox" aria-label="Projects"><div role="option" id="project-name">Efficiency</div></div>
    <div data-testid="project-menu-item">Thorough</div>`,{machine:true,machinePolicy:createMachinePolicy()});
  const d=dom.window.document,api=dom.window.__copilotChinese;
  assert.equal(d.querySelector('[role="menuitemcheckbox"]').textContent,'自动');
  assert.equal(d.querySelector('[data-auto-tier-id="efficiency"]').textContent,'效率优先');
  assert.equal(d.querySelector('[aria-selected="true"]').textContent,'均衡');
  assert.equal(d.querySelector('[aria-selected="true"]').getAttribute('data-auto-tier-id'),'balance');
  assert.equal(d.querySelector('#model-name').textContent,'Intelligence');
  assert.equal(d.querySelector('#project-name').textContent,'Efficiency');
  assert.match(d.querySelector('[role="group"]').textContent,/优化目标/);
  const batch=api.drainMachine();assert.equal(batch.length,1);assert.equal(batch[0].text,'Thorough');
  assert.equal(api.applyMachine({...batch[0],translation:'深入'}),true);
  assert.equal(d.querySelector('#future').textContent,'深入');
  api.dispose();assert.equal(d.querySelector('[data-auto-tier-id="balance"]').textContent,'Balance');
  assert.equal(d.querySelector('#future').textContent,'Thorough');dom.window.close();
});

test('menus mounted after startup and reopened menus queue descriptions without exposing nested data',async()=>{
  const dom=await fixture('<button id="mode" aria-label="Mode: Interactive, Ctrl + Shift + M">Interactive</button>',{machine:true,machinePolicy:createMachinePolicy()});
  const d=dom.window.document,api=dom.window.__copilotChinese,menu=d.createElement('div');
  menu.setAttribute('role','menu');menu.setAttribute('aria-labelledby','mode');menu.setAttribute('data-closed','');
  menu.innerHTML='<div role="presentation">Mode</div><div role="menuitemradio">Plan<span data-menu-description>Plan first, execute when ready</span></div><div role="listbox" aria-label="Files"><div role="option">Private Source Name</div></div><div class="prose">Private Message Content</div>';
  d.body.append(menu);await sleep(50);assert.equal(api.drainMachine().length,0);
  menu.removeAttribute('data-closed');menu.setAttribute('data-open','');await sleep(50);
  const batch=api.drainMachine();assert.equal(batch.length,1);assert.equal(batch[0].text,'Plan first, execute when ready');
  assert.equal(menu.querySelector('[role="presentation"]').textContent,'模式');
  menu.setAttribute('data-closed','');
  assert.equal(api.applyMachine({...batch[0],translation:'先规划，准备好后执行'}),false);
  menu.removeAttribute('data-closed');await sleep(50);
  const reopened=api.drainMachine();assert.equal(reopened.length,1,'Closing during translation must not permanently suppress a reused popup');
  assert.equal(api.applyMachine({...reopened[0],translation:'先规划，准备好后执行'}),true);
  assert.equal(menu.querySelector('[role="option"]').textContent,'Private Source Name');dom.window.close();
});

test('built-in workflow gallery is automatic but user workflows and skills are excluded',async()=>{
  const dom=await fixture(`<main><div><div>Set up automations</div><div id="intro"></div><button>Start automating</button></div>
    <div role="button" data-testid="workflow-gallery-card"><div>Issue triage</div><span>Daily</span><p>Review the latest GitHub issues and propose priorities and owners.</p></div>
    <div data-testid="user-workflow"><p>Review confidential release notes.</p></div><div data-testid="skill-card">Analyze private project data</div>
    <input placeholder="Search 0 skills…" value="Private skill query"></main>`,{url:'http://tauri.localhost/workflows',machine:true,machinePolicy:createMachinePolicy()});
  const d=dom.window.document,api=dom.window.__copilotChinese;
  d.querySelector('#intro').append(d.createTextNode('Use agents to handle recurring work on a cadence you choose or triggered by events.'),d.createTextNode(' You can start from scratch or turn an existing agent skill into an automation.'));
  await sleep(50);
  assert.match(d.querySelector('#intro').textContent,/让代理按指定周期/);
  assert.match(d.querySelector('#intro').textContent,/可以从零创建/);
  assert.equal(d.querySelector('[data-testid="workflow-gallery-card"] span').textContent,'每天');
  assert.equal(d.querySelector('input').placeholder,'搜索 0 项技能…');assert.equal(d.querySelector('input').value,'Private skill query');
  const requests=api.drainMachine();assert.equal(requests.length,1);assert.equal(requests[0].context,'page:workflow-gallery:#text');
  assert.equal(api.applyMachine({...requests[0],translation:'审查最新的 GitHub 议题并建议优先级和负责人。'}),true);
  assert.equal(d.querySelector('[data-testid="user-workflow"]').textContent,'Review confidential release notes.');dom.window.close();
});

test('starter cards use dictionary then automatic fallback without translating ordinary page content',async()=>{
  const dom=await fixture('<main><button class="group/card" aria-label="Find performance bottlenecks and optimize them."><p>Find performance bottlenecks and optimize them.</p></button><button class="group/card" aria-label="Explore future architecture options."><p>Explore future architecture options.</p></button><p>Explore private architecture options.</p></main>',{machine:true,machinePolicy:createMachinePolicy()});
  assert.equal(dom.window.document.querySelector('button p').textContent,'查找性能瓶颈并进行优化。');
  const requests=dom.window.__copilotChinese.drainMachine();assert.equal(requests.length,2);
  assert.ok(requests.every(r=>r.text==='Explore future architecture options.'));dom.window.close();
});

test('roleless tooltips translate only when matched to a known fixed control',async()=>{
  const dom=await fixture('<button aria-label="Add context" data-base-ui-tooltip-trigger data-popup-open></button><div role="presentation" class="pointer-events-none"><div data-base-ui-focusable data-side="top" tabindex="-1"><span>Add context</span></div></div><div role="presentation" class="pointer-events-none"><div data-base-ui-focusable data-side="top" tabindex="-1"><span>Private project name</span></div></div>');
  const spans=dom.window.document.querySelectorAll('span');assert.equal(spans[0].textContent,'添加上下文');assert.equal(spans[1].textContent,'Private project name');dom.window.close();
});

test('roleless message-action tooltips accept shorter fixed copy and direct portal surfaces',async()=>{
  const dom=await fixture(`<div data-message-id="assistant"><div class="prose"><button id="share" data-base-ui-tooltip-trigger data-popup-open aria-label="Share reply as secret gist"></button></div></div>
    <div data-base-ui-focusable data-side="top" tabindex="-1"><span id="tip">Share as secret gist</span></div>`);
  try {
    const d=dom.window.document;
    assert.equal(d.querySelector('#share').getAttribute('aria-label'),'将回复分享为私密 Gist');
    assert.equal(d.querySelector('#tip').textContent,'分享为私密 Gist');
  } finally { dom.window.close(); }
});

test('a single trusted open tooltip trigger can machine-translate new roleless tooltip copy',async()=>{
  const dom=await fixture('<button aria-label="Add context" data-base-ui-tooltip-trigger data-popup-open></button><div data-base-ui-focusable data-side="bottom" tabindex="-1"><span>Attach something new</span></div>',{machine:true,machinePolicy:createMachinePolicy()});
  try {
    const requests=dom.window.__copilotChinese.drainMachine(16);
    assert.equal(requests.length,1);
    assert.equal(requests[0].text,'Attach something new');
    assert.equal(requests[0].context,'tooltip:fixed-control:#text');
  } finally { dom.window.close(); }
});

test('model reasoning chrome translates effort labels without translating model identity',async()=>{
  const dom=await fixture(`<button id="model" aria-haspopup="menu" aria-label="example-model (example-provider) Extra High, model and reasoning"><span id="model-name">example-model (example-provider)</span><span id="effort-value">Extra High</span></button>
    <div id="root" role="menu" aria-labelledby="model"><div role="menuitem" id="effort" aria-haspopup="menu" aria-controls="effort-menu" aria-label="Effort, Extra High"><span id="effort-label">Effort</span><span id="effort-current">Extra High</span></div></div>
    <div id="effort-menu" role="menu" aria-labelledby="effort"><div role="menuitemradio">Low</div><div role="menuitemradio">Medium</div><div role="menuitemradio">High</div><div role="menuitemradio">Extra High</div><div role="menuitemradio" id="future-effort">Extreme</div></div>` ,{machine:true,machinePolicy:createMachinePolicy()});
  try {
    const d=dom.window.document,api=dom.window.__copilotChinese;
    assert.equal(d.querySelector('#model').getAttribute('aria-label'),'example-model (example-provider) 极高，模型与推理');
    assert.equal(d.querySelector('#model-name').textContent,'example-model (example-provider)');
    assert.equal(d.querySelector('#effort-value').textContent,'极高');
    assert.equal(d.querySelector('#effort').getAttribute('aria-label'),'推理强度，极高');
    assert.equal(d.querySelector('#effort-label').textContent,'推理强度');
    assert.equal(d.querySelector('#effort-current').textContent,'极高');
    assert.deepEqual([...d.querySelectorAll('#effort-menu [role="menuitemradio"]')].slice(0,4).map(e=>e.textContent),['低','中','高','极高']);
    const requests=api.drainMachine(16);
    assert.equal(requests.length,1);
    assert.equal(requests[0].text,'Extreme');
    assert.equal(requests[0].context,'popup:reasoning-effort:#text');
  } finally { dom.window.close(); }
});

test('dynamic quota and model screen-reader chrome translate only the fixed shell',async()=>{
  const dom=await fixture(`<button id="quota" aria-haspopup="dialog" aria-label="Chat messages quota: 1% used"></button>
    <div id="js-global-screen-reader-notice" aria-live="polite">Model: private-model. Effort: Extra High. AI credits: N/A. Context: N/A.</div>`);
  try {
    const d=dom.window.document;
    assert.equal(d.querySelector('#quota').getAttribute('aria-label'),'聊天消息配额：已用 1%');
    assert.equal(d.querySelector('#js-global-screen-reader-notice').textContent,'模型：private-model。推理强度：极高。AI 点数：N/A。上下文：N/A。');
  } finally { dom.window.close(); }
});

test('protected rich-text composer translates only its fixed placeholder and keeps draft text untouched',async()=>{
  const dom=await fixture(`<div class="prose"><div id="composer" role="textbox" contenteditable="true" data-lexical-editor="true"
    aria-placeholder="Ask anything. Use / for commands, @ files, & sessions, # issues...">Private unsent draft</div></div>`);
  try {
    const d=dom.window.document,composer=d.querySelector('#composer');
    assert.equal(composer.getAttribute('aria-placeholder'),'输入问题。使用 / 调用命令，@ 引用文件，& 引用会话，# 引用议题…');
    assert.equal(composer.textContent,'Private unsent draft');
    composer.setAttribute('aria-placeholder','Ask anything or paste a URL. Use / for commands, & sessions, # issues…');
    await sleep(30);
    assert.equal(composer.getAttribute('aria-placeholder'),'输入问题或粘贴链接。使用 / 调用命令，& 引用会话，# 引用议题…');
    assert.equal(composer.textContent,'Private unsent draft');
  } finally { dom.window.close(); }
});

test('approved settings navigation, single-word headings and inline help do not need dictionary entries',async()=>{
  const dom=await fixture(`<div role="dialog" aria-label="Settings"><nav><ul><li><button>Diagnostics</button></li></ul><ul><li><button id="name">Diagnostics</button></li></ul></nav>
    <section data-section-id="general-diagnostics"><div><h2 data-section-heading>Diagnostics</h2><p>Inspect background activity. <a href="https://example.test/help">Understand background processing.</a></p></div>
    <button><span data-component="label">Inspect diagnostics</span></button></section></div>`,{machine:true,machinePolicy:createMachinePolicy()});
  try {
    const requests=dom.window.__copilotChinese.drainMachine(16);
    assert.equal(requests.length,5);
    assert.equal(requests.filter(r=>r.text==='Diagnostics').length,2);
    assert.ok(requests.some(r=>r.text==='Understand background processing.'));
    assert.equal(dom.window.document.querySelector('#name').textContent,'Diagnostics');
    assert.equal(dom.window.document.querySelector('a').href,'https://example.test/help');
  } finally { dom.window.close(); }
});

test('real settings navigation data-selected flags do not hide any of the eight fixed labels',async()=>{
  const labels=['General','Accounts','Sessions','Themes','Accessibility','Customize','Model providers','Experimental'];
  // Copilot 1.1.23 uses ul > div > button, including data-selected="false"
  // on every inactive navigation button. Do not simplify these flags away.
  const dom=await fixture(`<div role="dialog" aria-label="Settings"><nav><ul>${labels.map((label,i)=>
    `<div><button type="button" data-selected="${i===0}" ${i===0?'aria-current="true"':''}><span data-component="label">${label}</span></button></div>`).join('')}</ul>
    <h3>Projects</h3><ul><div><button data-selected="false" id="project">General</button></div></ul></nav>
    <section data-section-id="general-tools"><button data-selected="false" id="value">Settings</button></section></div>`,{machine:true,machinePolicy:createMachinePolicy()});
  try {
    const d=dom.window.document,api=dom.window.__copilotChinese,buttons=[...d.querySelector('nav ul').querySelectorAll('button')];
    assert.deepEqual(buttons.map(b=>b.textContent),labels.map(label=>dictionary.common[label]));
    assert.deepEqual(buttons.map(b=>b.getAttribute('data-selected')),labels.map((_,i)=>String(i===0)));
    assert.equal(buttons[0].getAttribute('aria-current'),'true');
    assert.equal(d.querySelector('#project').textContent,'General');
    assert.equal(d.querySelector('#value').textContent,'Settings');
    assert.equal(api.drainMachine(16).length,0,'Existing dictionary entries must not need the translation engine');
    api.dispose();
    assert.deepEqual(buttons.map(b=>b.textContent),labels);
  } finally { dom.window.close(); }
});

test('selected settings navigation still queues unknown labels without admitting project or theme values',async()=>{
  const dom=await fixture(`<div role="dialog" aria-label="Settings"><nav><ul>
    <div><button data-selected="false" id="new">Diagnostics</button></div>
    <li aria-pressed="true"><button>Display diagnostics</button></li>
    </ul><ul><li><button data-selected="true" id="project">Diagnostics</button></li></ul></nav>
    <section data-section-id="themes-gallery"><button data-selected="false">Diagnostics</button></section>
    <section data-section-id="general-tools"><button aria-pressed="false">Diagnostics</button></section></div>`,{machine:true,machinePolicy:createMachinePolicy()});
  try {
    const d=dom.window.document,api=dom.window.__copilotChinese,requests=api.drainMachine(16);
    assert.deepEqual(Array.from(requests,r=>r.text),['Diagnostics','Display diagnostics']);
    assert.ok(requests.every(r=>r.context==='settings:navigation:#text'));
    for(const request of requests)assert.equal(api.applyMachine({...request,translation:'诊断'}),true);
    assert.equal(d.querySelector('#new').textContent,'诊断');
    assert.equal(d.querySelector('#project').textContent,'Diagnostics');
    assert.ok([...d.querySelectorAll('section button')].every(b=>b.textContent==='Diagnostics'));
  } finally { dom.window.close(); }
});

test('settings navigation selection changes and remounts preserve translations, protection and host attributes',async()=>{
  const dom=await fixture('<div role="dialog" aria-label="Settings"><nav><ul><div><button id="general" data-selected="true" aria-current="true">General</button></div><div><button id="accounts" data-selected="false">Accounts</button></div></ul><ul id="projects"></ul></nav></div>',{machine:true,machinePolicy:createMachinePolicy()});
  try {
    const d=dom.window.document,api=dom.window.__copilotChinese,general=d.querySelector('#general'),accounts=d.querySelector('#accounts');
    assert.equal(general.textContent,'常规');
    general.setAttribute('data-selected','false');general.removeAttribute('aria-current');
    accounts.setAttribute('data-selected','true');accounts.setAttribute('aria-current','true');
    general.firstChild.nodeValue='General';accounts.firstChild.nodeValue='Accounts';
    await sleep(30);
    assert.equal(general.textContent,'常规');assert.equal(accounts.textContent,'账户');
    const navList=d.querySelector('nav ul');
    d.querySelector('#projects').append(general.parentElement);
    await sleep(30);assert.equal(general.textContent,'General','Reused project names must be restored');
    navList.prepend(general.parentElement);
    await sleep(30);assert.equal(general.textContent,'常规');
    const dialog=d.querySelector('[role="dialog"]');dialog.remove();d.body.append(dialog);await sleep(30);
    assert.equal(general.textContent,'常规');assert.equal(accounts.textContent,'账户');
    const passes=api.status().passes;await sleep(40);assert.equal(api.status().passes,passes);
    api.dispose();
    assert.equal(general.textContent,'General');assert.equal(accounts.textContent,'Accounts');
    assert.equal(general.getAttribute('data-selected'),'false');assert.equal(accounts.getAttribute('data-selected'),'true');
    assert.equal(accounts.getAttribute('aria-current'),'true');assert.equal(general.hasAttribute('aria-current'),false);
  } finally { dom.window.close(); }
});

test('fixed popup ownership supports IDREF lists and aria-controls but not protected triggers',async()=>{
  const dom=await fixture(`<button id="mode" aria-label="Mode: Interactive" aria-controls="popup"></button><span id="caption">Choose</span>
    <div id="popup" role="menu" aria-labelledby="caption mode"><div role="menuitemradio">Thorough</div><p>Inspect changes before execution.</p></div>
    <div class="prose"><button id="unsafe" aria-label="Mode: Interactive" aria-controls="private-popup"></button></div>
    <div id="private-popup" role="menu" aria-labelledby="unsafe"><p>Private task instructions.</p></div>`,{machine:true,machinePolicy:createMachinePolicy()});
  try {
    const api=dom.window.__copilotChinese,d=dom.window.document;
    let requests=api.drainMachine(16);
    assert.deepEqual(Array.from(requests,r=>r.text).sort(),['Inspect changes before execution.','Thorough']);
    for(const req of requests)api.applyMachine({...req,translation:'检查设置'});
    d.querySelector('#popup').removeAttribute('aria-labelledby');
    d.querySelector('#popup p').textContent='Review execution options.';
    await sleep(30);
    requests=api.drainMachine(16);
    assert.ok(requests.some(r=>r.text==='Review execution options.'));
    assert.ok(requests.every(r=>!r.text.includes('Private')));
  } finally { dom.window.close(); }
});

test('new tooltip copy is automatic only with a trusted control relationship',async()=>{
  const dom=await fixture(`<button aria-label="Add context" aria-describedby="hint details"></button><span id="hint"></span>
    <div id="details" role="tooltip">Attach additional context for this session.</div>
    <div role="tooltip">Private project description.</div>
    <div class="prose"><button aria-label="Add context" aria-describedby="private-tip"></button></div>
    <div id="private-tip" role="tooltip">Confidential project description.</div>`,{machine:true,machinePolicy:createMachinePolicy()});
  try {
    const requests=dom.window.__copilotChinese.drainMachine(16);
    assert.equal(requests.length,1);
    assert.equal(requests[0].text,'Attach additional context for this session.');
  } finally { dom.window.close(); }
});

test('explicit identity dictionary entries suppress MT and late dictionary corrections are applied immediately',async()=>{
  const custom=structuredClone(dictionary);
  custom.settings['Preserve this exact label']='Preserve this exact label';
  const dom=await fixture('<div role="dialog" aria-label="Settings"><section data-section-id="general-test"><h2 data-section-heading>Preserve this exact label</h2><h2 id="late" data-section-heading>Future display preferences</h2></section></div>',{dictionary:custom,machine:true,machinePolicy:createMachinePolicy()});
  try {
    const api=dom.window.__copilotChinese,requests=api.drainMachine(16);
    assert.equal(requests.length,1);
    custom.settings['Future display preferences']='人工修订的显示偏好';
    assert.equal(api.applyMachine({...requests[0],translation:'机器显示偏好'}),false);
    assert.equal(dom.window.document.querySelector('#late').textContent,'人工修订的显示偏好');
    api.dispose();
    assert.equal(dom.window.document.querySelector('#late').textContent,'Future display preferences');
  } finally { dom.window.close(); }
});

test('data-picker and theme names are protected from dictionary collisions as well as MT',async()=>{
  const dom=await fixture(`<div role="dialog" aria-label="Settings"><section data-section-id="themes-gallery"><h2 data-section-heading>Browse installed themes</h2>
    <button title="Settings"><span data-component="label">Settings</span></button><button aria-pressed="true">Plan</button></section>
    <section data-section-id="accounts-list"><div role="listbox"><div role="option">General</div></div></section>
    <section data-section-id="general-tools"><button aria-pressed="true" title="Settings"><span data-component="label">Settings</span></button></section></div>
    <main><div data-testid="user-workflow"><button>Settings</button></div><div data-testid="skill-card"><button>Save</button></div></main>`,{machine:true,machinePolicy:createMachinePolicy()});
  try {
    const d=dom.window.document;
    assert.deepEqual([...d.querySelectorAll('button')].map(el=>el.textContent),['Settings','Plan','Settings','Settings','Save']);
    assert.equal(d.querySelector('[role="option"]').textContent,'General');
    assert.equal(d.querySelector('[title]').title,'Settings');
    assert.ok(dom.window.__copilotChinese.drainMachine(16).every(r=>r.text==='Browse installed themes'));
  } finally { dom.window.close(); }
});

test('editable attribute exceptions cannot bypass translate=no or protected ancestors',async()=>{
  const dom=await fixture('<input translate="no" placeholder="Settings" value="Settings"><div class="prose"><textarea placeholder="Settings">Settings</textarea></div><input id="allowed" placeholder="Search settings…">');
  try {
    const d=dom.window.document;
    assert.equal(d.querySelector('input').placeholder,'Settings');
    assert.equal(d.querySelector('textarea').placeholder,'Settings');
    assert.equal(d.querySelector('#allowed').placeholder,'搜索设置…');
  } finally { dom.window.close(); }
});

test('rich composer translates placeholder variants in both aria chrome and visual placeholder without touching draft text',async()=>{
  const dom=await fixture(`<main><div data-rich-composer-content-wrapper="true">
    <div id="composer" aria-label="Message" aria-multiline="true" class="prose" contenteditable="true" role="textbox" data-lexical-editor="true"
      aria-placeholder="Ask anything. Use / for commands, @ files, & sessions, # issues...">Private draft</div>
    <div aria-hidden="true"><div id="placeholder" data-rich-composer-placeholder="true">Ask anything. Use / for commands, @ files, & sessions, # issues...</div></div>
  </div></main>`);
  try {
    const d=dom.window.document,composer=d.querySelector('#composer');
    assert.equal(composer.textContent,'Private draft');
    assert.equal(composer.getAttribute('aria-placeholder'),'输入问题。使用 / 调用命令，@ 引用文件，& 引用会话，# 引用议题…');
    assert.equal(d.querySelector('#placeholder').textContent,'输入问题。使用 / 调用命令，@ 引用文件，& 引用会话，# 引用议题…');
  } finally { dom.window.close(); }
});

test('already translated nodes are restored on protected moves and can translate after returning',async()=>{
  const dom=await fixture('<div role="dialog" aria-label="Settings"><section data-section-id="general-test"><h2 data-section-heading>Future display preferences</h2></section></div><div id="chat" class="prose"></div>',{machine:true,machinePolicy:createMachinePolicy()});
  try {
    const d=dom.window.document,api=dom.window.__copilotChinese,section=d.querySelector('section'),heading=d.querySelector('h2');
    assert.equal(api.applyMachine({...api.drainMachine()[0],translation:'未来显示偏好'}),true);
    d.querySelector('#chat').append(section);
    await sleep(30);
    assert.equal(heading.textContent,'Future display preferences');
    assert.equal(api.originalText(heading.firstChild),'Future display preferences');
    d.querySelector('[role="dialog"]').append(section);
    await sleep(30);
    assert.equal(api.drainMachine().length,1);
  } finally { dom.window.close(); }
});

test('protection-marker changes restore only overlay-owned values, never newer host text',async()=>{
  const dom=await fixture('<div id="container"><button>Save</button><button>Settings</button></div>');
  try {
    const d=dom.window.document,buttons=d.querySelectorAll('button');
    buttons[1].firstChild.nodeValue='Fresh user content';
    d.querySelector('#container').classList.add('prose');
    await sleep(30);
    assert.equal(buttons[0].textContent,'Save');
    assert.equal(buttons[1].textContent,'Fresh user content');
    d.querySelector('#container').classList.remove('prose');
    await sleep(30);
    assert.equal(buttons[0].textContent,'保存');
  } finally { dom.window.close(); }
});

test('bounded MT queue refills after saturation without requiring a DOM mutation',async()=>{
  const body='<div role="dialog" aria-label="Settings"><section data-section-id="general-many">'+Array.from({length:150},(_,i)=>`<h2 data-section-heading>Future preference ${i}</h2>`).join('')+'</section></div>';
  const dom=await fixture(body,{machine:true,machinePolicy:createMachinePolicy()});
  try {
    const api=dom.window.__copilotChinese;
    assert.equal(api.status().machine.queued,128);
    let applied=0;
    for(let i=0;i<30;i++) {
      const batch=api.drainMachine(16);
      if(!batch.length)break;
      for(const request of batch) {
        assert.equal(api.applyMachine({...request,translation:'未来偏好 '+request.text.match(/\d+$/)[0]}),true);
        applied++;
      }
      assert.ok(api.status().machine.queued<=128);
    }
    assert.equal(applied,150);
    assert.equal(api.status().machine.queued,0);
    assert.ok([...dom.window.document.querySelectorAll('h2')].every(el=>el.textContent.startsWith('未来偏好')));
  } finally { dom.window.close(); }
});

test('lost in-flight responses expire and retry with a fresh request ID',async()=>{
  const dom=await fixture('<div role="dialog" aria-label="Settings"><section data-section-id="general-test"><h2 data-section-heading>Future display preferences</h2></section></div>',{machine:true,machinePolicy:createMachinePolicy()});
  try {
    const api=dom.window.__copilotChinese;
    let now=Date.now();dom.window.Date.now=()=>now;
    const first=api.drainMachine()[0];
    assert.equal(api.drainMachine().length,0);
    now+=120001;
    const retried=api.drainMachine();
    assert.equal(retried.length,1);
    assert.notEqual(retried[0].id,first.id);
    assert.equal(api.applyMachine({...first,translation:'过期结果'}),false);
    assert.equal(api.applyMachine({...retried[0],translation:'未来显示偏好'}),true);
  } finally { dom.window.close(); }
});

test('same-node host rerenders can reuse cached machine translations',async()=>{
  const dom=await fixture('<div role="dialog" aria-label="Settings"><section data-section-id="general-test"><h2 data-section-heading>Future display preferences</h2></section></div>',{machine:true,machinePolicy:createMachinePolicy()});
  try {
    const api=dom.window.__copilotChinese,node=dom.window.document.querySelector('h2').firstChild;
    api.applyMachine({...api.drainMachine()[0],translation:'未来显示偏好'});
    node.nodeValue='Future display preferences';
    await sleep(30);
    const again=api.drainMachine();
    assert.equal(again.length,1);
    assert.equal(api.applyMachine({...again[0],translation:'未来显示偏好'}),true);
    api.dispose();assert.equal(node.nodeValue,'Future display preferences');
  } finally { dom.window.close(); }
});

test('model names that match short dictionary labels stay unchanged',async()=>{
  const dom=await fixture('<button id="model" aria-label="Auto · Balance, model and reasoning"></button><div role="menu" aria-labelledby="model"><div role="menuitemcheckbox" id="name">High</div><div role="menuitemcheckbox" id="auto">Auto</div><div role="menuitemradio">Low</div></div>',{machine:true,machinePolicy:createMachinePolicy()});
  try {
    const d=dom.window.document;
    assert.equal(d.querySelector('#name').textContent,'High');
    assert.equal(d.querySelector('#auto').textContent,'自动');
    assert.equal(d.querySelector('[role="menuitemradio"]').textContent,'低');
    assert.equal(dom.window.__copilotChinese.drainMachine().length,0);
  } finally { dom.window.close(); }
});

test('dialog title relationships and tooltips on new settings actions remain dictionary-independent',async()=>{
  const dom=await fixture(`<div role="dialog" aria-labelledby="settings-title"><h1 id="settings-title">Settings</h1>
    <section data-section-id="general-diagnostics"><h2 data-section-heading>Diagnostics</h2><button aria-label="Inspect diagnostics" aria-describedby="new-tip"><span data-component="label">Inspect diagnostics</span></button></section></div>
    <div id="new-tip" role="tooltip">Inspect pending background operations.</div>
    <div role="dialog" aria-labelledby="feedback-title"><h1 id="feedback-title">Share feedback</h1><p>Describe the interface problem.</p><textarea>Private feedback draft.</textarea></div>`,{machine:true,machinePolicy:createMachinePolicy()});
  try {
    const d=dom.window.document,api=dom.window.__copilotChinese,requests=api.drainMachine(16);
    assert.equal(d.querySelector('#settings-title').textContent,'设置');
    assert.equal(requests.length,5);
    assert.ok(requests.some(r=>r.text==='Inspect pending background operations.'));
    assert.ok(requests.some(r=>r.text==='Describe the interface problem.'));
    assert.equal(d.querySelector('textarea').value,'Private feedback draft.');
  } finally { dom.window.close(); }
});

test('dictionary corrections win over failed machine replies too',async()=>{
  const custom=structuredClone(dictionary);
  const dom=await fixture('<div role="dialog" aria-label="Settings"><section data-section-id="general-test"><h2 data-section-heading>Future display preferences</h2></section></div>',{dictionary:custom,machine:true,machinePolicy:createMachinePolicy()});
  try {
    const api=dom.window.__copilotChinese,request=api.drainMachine()[0];
    custom.settings[request.text]='人工显示偏好';
    assert.equal(api.applyMachine({...request,translation:null}),false);
    assert.equal(dom.window.document.querySelector('h2').textContent,'人工显示偏好');
    assert.equal(api.status().machine.queued,0);
  } finally { dom.window.close(); }
});

test('protected streaming and animation-only class changes do not rescan stable UI',async()=>{
  const dom=await fixture('<button id="ui">Save</button><div class="prose"><span>Private response</span></div>');
  try {
    const d=dom.window.document,api=dom.window.__copilotChinese,passes=api.status().passes;
    d.querySelector('span').firstChild.nodeValue+=' with more tokens';
    d.querySelector('#ui').classList.add('animate-pulse','opacity-50');
    await sleep(30);
    assert.equal(api.status().passes,passes);
    assert.equal(d.querySelector('span').textContent,'Private response with more tokens');
  } finally { dom.window.close(); }
});

test('portalled theme submenus follow menuitem ownership and translate new copy, not account identities',async()=>{
  const dom=await fixture(`<button id="user" aria-label="Settings, open user menu" aria-controls="account"></button>
    <div id="account" role="menu" aria-labelledby="user">
      <div role="menuitem" aria-label="Settings, Chat messages used: 1%"><span data-component="Avatar"></span><span id="name">Settings</span><span id="usage">Chat messages used: 1%</span></div>
      <div id="theme" role="menuitem" aria-haspopup="menu" aria-controls="appearance"><span>Theme</span></div>
      <div role="menuitem" id="future-action">Inspect background activity</div>
    </div><div id="appearance" role="menu" aria-labelledby="theme">
      <div role="menuitemradio" aria-checked="true">System</div><div role="menuitemradio" aria-checked="false">Light</div>
      <div role="menuitemradio" aria-checked="false">Dark</div><div role="menuitem">Make it yours</div><div role="menuitemradio">Dimmed</div>
    </div>`,{machine:true,machinePolicy:createMachinePolicy()});
  try {
    const d=dom.window.document,api=dom.window.__copilotChinese;
    assert.deepEqual([...d.querySelector('#appearance').children].map(x=>x.textContent),['跟随系统','浅色','深色','个性化设置','Dimmed']);
    assert.equal(d.querySelector('[aria-checked]').getAttribute('aria-checked'),'true');
    assert.equal(d.querySelector('#name').textContent,'Settings');
    assert.equal(d.querySelector('#usage').textContent,'聊天消息已用：1%');
    assert.equal(d.querySelector('#user').getAttribute('aria-label'),'Settings, open user menu');
    const requests=api.drainMachine(16);
    assert.deepEqual(Array.from(requests,r=>r.text).sort(),['Dimmed','Inspect background activity']);
    assert.ok(requests.some(r=>r.context==='popup:color-scheme:#text'));
    assert.equal(api.explain(d.querySelector('#future-action')).route,'machine');
    assert.equal(api.explain(d.querySelector('#name')).route,'account-template-only');
    api.dispose();assert.equal(d.querySelector('#usage').textContent,'Chat messages used: 1%');
    assert.equal(d.querySelector('#appearance').firstElementChild.textContent,'System');
  }finally{dom.window.close();}
});

test('submenu ownership loss rejects late replies, cyclic or protected owners never admit new copy',async()=>{
  const dom=await fixture(`<button id="user" aria-label="Private, open user menu"></button><div role="menu" aria-labelledby="user"><div id="theme" role="menuitem" aria-haspopup="menu">Theme</div></div>
    <div role="menu" aria-labelledby="theme"><div id="choice" role="menuitemradio">Dimmed</div></div><div class="prose" id="chat"></div>
    <div role="menu" aria-labelledby="loop"><div id="loop" role="menuitem" aria-haspopup="menu">Unrecognized choice</div></div>`,{machine:true,machinePolicy:createMachinePolicy()});
  try{
    const d=dom.window.document,api=dom.window.__copilotChinese,requests=api.drainMachine(16);
    assert.equal(requests.length,1);
    d.querySelector('#chat').append(d.querySelector('#user'));
    assert.equal(api.applyMachine({...requests[0],translation:'柔和'}),false);
    assert.equal(d.querySelector('#choice').textContent,'Dimmed');
    assert.equal(api.explain(d.querySelector('#loop')).route,'unclassified');
  }finally{dom.window.close();}
});

test('machine work signals once per DOM batch without disclosing text or causing an idle loop',async()=>{
  let signals=0;
  const dom=await fixture('<div role="dialog" aria-label="Settings"><section data-section-id="general-test"><h2 data-section-heading>Future diagnostics</h2><h2 data-section-heading>Background operations</h2></section></div>',{
    machine:true,machinePolicy:createMachinePolicy(),onMachinePending:(...args)=>{assert.equal(args.length,0);signals++;}
  });
  try{
    assert.equal(signals,1);
    for(const req of dom.window.__copilotChinese.drainMachine())dom.window.__copilotChinese.applyMachine({...req,translation:'诊断设置'});
    await sleep(30);assert.equal(signals,1);
  }finally{dom.window.close();}
});
