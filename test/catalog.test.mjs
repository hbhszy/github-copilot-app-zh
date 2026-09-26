import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createMachinePolicy } from '../src/machine-policy.mjs';
import { loadOverlaySource } from '../src/overlay-source.mjs';
const code = loadOverlaySource();
const dictionary = JSON.parse(readFileSync(new URL('../locales/zh-CN.json', import.meta.url), 'utf8'));
const wait = () => new Promise(resolve => setTimeout(resolve, 30));
const tab = text => `<button role="tab" aria-selected="false"><span><span aria-hidden="true" class="invisible">${text}</span><span>${text}</span></span></button>`;
const row = (id, name, description) => `<li><div class="group/row"><button aria-label="${name}, view details" aria-describedby="${id}"><p><span class="name">${name}</span><span class="stars">49.7k</span></p><p id="${id}">${description}</p></button><button aria-label="Add server, ${name}"><span data-component="label">Add server</span></button></div></li>`;
const card = (name, description) => `<li data-carousel-card aria-hidden="false"><div><button aria-label="${name}"></button><div><p class="name">${name}</p><p class="description">${description}</p></div><button aria-label="Install skill: ${name}"><span data-component="label">Install skill</span></button></div></li>`;
const section = (id, body, intro = '') => `<section aria-labelledby="${id}"><div><h2 id="${id}">Featured</h2><p>${intro}</p></div><ul role="list" aria-labelledby="${id}">${body}</ul></section>`;
const header = (search='MCP servers') => `<header><div data-customize-category-header-row><div role="tablist" aria-label="Extension categories">${tab('Featured')}${tab('MCP')}</div><input placeholder="Search ${search}…" aria-label="Search ${search}" value="Private search query"></div></header>`;
const panel = (name, body) => `<div role="tabpanel" aria-label="${name}">${body}</div>`;
const page = (rows=row('entry-description', 'Settings', 'Explore future deployment options.')) => `<main>${header()}${panel('MCP', section('featured-mcp-heading',card('Intelligence','Review service activity and metrics.'),'Popular MCP servers to help you get started.') + `<section aria-labelledby="mcp-available-heading"><div><h2 id="mcp-available-heading">Available</h2><p>Browse MCP servers by category.</p></div><div role="tablist" aria-label="Filter available MCP servers by category">${['Development','Infrastructure','Databases','Intelligence','Web','Productivity','Observability','Commerce'].map(tab).join('')}</div><ul role="list" aria-labelledby="mcp-available-heading">${rows}</ul></section>`)}</main><div class="prose">Explore future deployment options.</div>`;
async function fixture(body=page(), options={}) {
  const dom = new JSDOM(body,{runScripts:'outside-only',url:options.url||'http://tauri.localhost/extensions'});
  dom.window.eval(code);
  dom.window.installCopilotChinese(options.dictionary||dictionary,dom.window.document,{test:true,machine:options.machine!==false,machinePolicy:createMachinePolicy()});
  await wait();return dom;
}

test('catalog chrome and summaries translate while identities, input values and counts remain intact',async()=>{
  const dom=await fixture();
  try {
    const d=dom.window.document,api=dom.window.__copilotChinese;
    assert.equal(d.querySelector('input').placeholder,'搜索 MCP 服务器…');
    assert.equal(d.querySelector('input').value,'Private search query');
    assert.equal(d.querySelector('#mcp-available-heading').textContent,'可用项目');
    assert.deepEqual([...d.querySelectorAll('.name')].map(e=>e.textContent),['Intelligence','Settings']);
    assert.equal(d.querySelector('.stars').textContent,'49.7k');
    assert.equal(d.querySelector('[aria-describedby]').getAttribute('aria-label'),'Settings，查看详情');
    assert.equal(d.querySelector('[data-carousel-card] button').getAttribute('aria-label'),'Intelligence');
    assert.ok([...d.querySelectorAll('button')].some(e=>e.getAttribute('aria-label')==='添加服务器：Settings'));
    const requests=api.drainMachine(16);
    assert.deepEqual(Array.from(requests,r=>r.text).sort(),['Explore future deployment options.','Review service activity and metrics.']);
    for(const req of requests)assert.equal(api.applyMachine({...req,translation:'探索服务部署与运行选项。'}),true);
    assert.equal(d.querySelector('#entry-description').textContent,'探索服务部署与运行选项。');
    assert.equal(d.querySelector('.prose').textContent,'Explore future deployment options.');
    api.dispose();
    assert.equal(d.querySelector('#entry-description').textContent,'Explore future deployment options.');
    assert.equal(d.querySelector('[aria-describedby]').getAttribute('aria-label'),'Settings, view details');
    assert.equal(d.querySelector('input').placeholder,'Search MCP servers…');
  } finally {dom.window.close();}
});

test('taxonomy overrides model-menu meanings and translates both visible and width-measuring labels',async()=>{
  const dom=await fixture(page()+'<div role="listbox" aria-label="Auto optimization"><div role="option">Intelligence</div></div>');
  try {
    const d=dom.window.document;
    assert.deepEqual([...d.querySelectorAll('section [role="tab"]')].map(e=>e.lastElementChild.lastElementChild.textContent),['开发','基础设施','数据库','智能','网页','效率工具','可观测性','商务']);
    for(const e of d.querySelectorAll('section [role="tab"]'))assert.equal(e.querySelector('[aria-hidden]').textContent,e.lastElementChild.lastElementChild.textContent);
    assert.equal(d.querySelector('[role="option"]').textContent,'能力优先');
    assert.equal(d.querySelector('section [role="tab"]').getAttribute('aria-selected'),'false');
  } finally {dom.window.close();}
});

test('new categories, virtualized rows and all curated card families accept unknown copy without new dictionary entries',async()=>{
  const dom=await fixture(page('')+'<main>'+panel('Plugins','<section><div><h2>Available<span>185</span></h2><p>Install packaged capabilities from your marketplaces.</p></div><ul role="list" aria-label="Available plugins" data-testid="virtualized-available-plugins"></ul></section>')+'</main>');
  try {
    const d=dom.window.document,api=dom.window.__copilotChinese;
    d.querySelector('section [role="tablist"]').insertAdjacentHTML('beforeend',tab('Diagnostics'));
    d.querySelector('[data-testid="virtualized-available-plugins"]').insertAdjacentHTML('beforeend',row('future','Future Service','Inspect future background operations.'));
    await wait();
    const requests=api.drainMachine(16);
    assert.equal(requests.filter(r=>r.text==='Diagnostics').length,2);
    assert.equal(requests.filter(r=>r.text==='Inspect future background operations.').length,1);
    assert.ok(requests.every(r=>r.text!=='Future Service'));
    for(const req of requests)assert.equal(api.applyMachine({...req,translation:req.text==='Diagnostics'?'诊断':'检查未来的后台操作。'}),true);
    await wait();const passes=api.status().passes;await wait();assert.equal(api.status().passes,passes);
  } finally {dom.window.close();}
  for(const [name,id] of [['Featured','featured-editors-picks-heading'],['Plugins','featured-plugins-heading'],['Skills','featured-skills-heading'],['Canvas','featured-canvas-heading']]) {
    const dom=await fixture('<main>'+panel(name,section(id,card('Settings','Future catalog description.')))+'</main>');
    try {const requests=dom.window.__copilotChinese.drainMachine(16);assert.deepEqual(Array.from(requests,r=>r.text),['Future catalog description.'],name);} finally {dom.window.close();}
  }
});

test('all seven search fields and fixed empty states work without a translation engine',async()=>{
  for(const [label,search,expected] of [['Featured','featured extensions','精选扩展'],['MCP','MCP servers','MCP 服务器'],['Plugins','plugins','插件'],['Skills','skills','技能'],['Extensions','extensions','扩展'],['Canvas','canvas','画布'],['Installed','installed','已安装项目']]) {
    const dom=await fixture('<main>'+header(search)+panel(label,'<div data-size="medium"><div><h2>No extensions installed</h2><div>Extensions added directly or through plugins will appear here.</div><button><span data-component="label">Browse plugins</span></button></div></div>')+'</main>',{machine:false});
    try {const d=dom.window.document;assert.equal(d.querySelector('input').placeholder,'搜索'+(label==='MCP'?' ':'')+expected+'…',label);assert.equal(d.querySelector('h2').textContent,'尚未安装扩展');assert.equal(d.querySelector('[data-component="label"]').textContent,'浏览插件');} finally {dom.window.close();}
  }
});

test('installed views translate UI and action templates but never local names, metadata, switches or secrets',async()=>{
  const dom=await fixture('<main>'+panel('Installed',`<section aria-labelledby="installed-skill-heading"><div><h2 id="installed-skill-heading">Skills<span>2</span></h2><p>Task-specific guidance that changes how Copilot works.</p></div><ul role="list" aria-labelledby="installed-skill-heading">${row('builtin','Settings','Built-in')}${row('private','Private Skill','Read private project instructions.')}</ul></section>`)+panel('Skills','<section aria-labelledby="skills-all-heading"><div><h2 id="skills-all-heading">Installed</h2><p>Guide how Copilot approaches specialized tasks.</p></div><div><p>Built-in</p><div class="group/row"><button aria-label="Terminal, view details"><p><span class="name">Terminal</span></p></button><div><button role="switch" aria-checked="true"><span role="presentation">Disable Terminal</span></button></div></div></div></section>')+'</main>');
  try {
    const d=dom.window.document;
    assert.deepEqual([...d.querySelectorAll('.name')].map(e=>e.textContent),['Settings','Private Skill','Terminal']);
    assert.equal(d.querySelector('#builtin').textContent,'内置');
    assert.equal(d.querySelector('#private').textContent,'Read private project instructions.');
    assert.equal(d.querySelector('[role="switch"]').textContent,'停用 Terminal');
    assert.equal(d.querySelector('[role="switch"]').getAttribute('aria-checked'),'true');
    assert.equal(dom.window.__copilotChinese.drainMachine(16).length,0);
  } finally {dom.window.close();}
});

test('catalog ownership checks IDREFs and rejects late replies after nodes turn into local data',async()=>{
  const dom=await fixture(page(row('good','Settings','Inspect background tasks.')+'<li><button aria-label="Settings, view details" aria-describedby="external"><p>Settings</p></button><p>Private row notes.</p></li>')+'<p id="external">Private external description.</p>');
  try {
    const d=dom.window.document,api=dom.window.__copilotChinese,requests=api.drainMachine(16);
    assert.ok(requests.every(r=>!r.text.includes('Private')));
    const req=requests.find(r=>r.text==='Inspect background tasks.');assert.ok(req);
    d.querySelector('[aria-describedby="good"]').setAttribute('aria-describedby','external');
    assert.equal(api.applyMachine({...req,translation:'检查后台任务。'}),false);
    d.querySelector('[aria-describedby="external"]').setAttribute('aria-describedby','good');await wait();
    const again=api.drainMachine(16).find(r=>r.text==='Inspect background tasks.');assert.ok(again);
    assert.equal(api.applyMachine({...again,translation:'检查后台任务。'}),true);
    d.querySelector('[role="tabpanel"]').setAttribute('aria-label','Installed');await wait();
    assert.equal(d.querySelector('#good').textContent,'Inspect background tasks.');
    assert.equal(d.querySelector('#external').textContent,'Private external description.');
  } finally {dom.window.close();}
});

test('catalog rules do not bypass protected text, unknown panels, code or data-picker values',async()=>{
  const dom=await fixture('<main>'+panel('Plugins',`<section><div><h2>Available</h2><p>Install packaged capabilities from your marketplaces.</p><button role="combobox" aria-label="Filter by marketplace"><span>Settings</span></button></div><ul data-testid="virtualized-available-plugins" role="list" aria-label="Available plugins">${row('code','Settings','<code>Never translate this code.</code>')}${row('optout','Settings','<span translate="no">Never translate this prose.</span>')}</ul></section>`)+panel('Private Projects',section('featured-mcp-heading',card('Settings','Private project notes.')))+'<div data-testid="skill-card">Private skill body.</div></main>');
  try {const d=dom.window.document;assert.equal(d.querySelector('[role="combobox"] span').textContent,'Settings');assert.equal(d.querySelector('[aria-label="Private Projects"] .name').textContent,'Settings');assert.equal(d.querySelector('code').textContent,'Never translate this code.');assert.equal(dom.window.__copilotChinese.drainMachine(16).length,0);} finally {dom.window.close();}
});

test('late-mounted catalog owners rescan their existing description siblings',async()=>{
  const dom=await fixture('<main>'+panel('Featured',section('featured-editors-picks-heading','<li><div id="late-card"><div><p class="name">Future Service</p><p id="late-description">Inspect future background work.</p></div></div></li>'))+'</main>');
  try {
    const d=dom.window.document,api=dom.window.__copilotChinese;
    assert.equal(api.drainMachine(16).length,0);
    d.querySelector('#late-card').insertAdjacentHTML('afterbegin','<button aria-label="Future Service"></button>');
    await wait();
    const request=api.drainMachine(16).find(r=>r.text==='Inspect future background work.');
    assert.ok(request,'A late owner must not leave its already-mounted description untranslated');
    assert.equal(api.applyMachine({...request,translation:'检查未来的后台工作。'}),true);
    await wait();const passes=api.status().passes;await wait();assert.equal(api.status().passes,passes);
    assert.equal(d.querySelector('.name').textContent,'Future Service');
  } finally {dom.window.close();}
});
