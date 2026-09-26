import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { CDP, getTargets, isAppTarget } from '../src/cdp.mjs';
const state = JSON.parse(await readFile('.local/state.json', 'utf8'));
const port = Number(process.env.COPILOT_ZH_PORT || state.port);
const cdp = await CDP.connect((await getTargets(port)).find(isAppTarget).webSocketDebuggerUrl);
const errors = [];
cdp.socket.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { date: new Date().toISOString(), checks: [] };
try {
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await cdp.evaluate('window.__copilotChinese?.enabled && window.__copilotChinese?.status().ready')) break;
    await sleep(250);
  }
  assert.equal(await cdp.evaluate('window.__copilotChinese.enabled'), true);
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const label of ['常规','会话','主题','辅助功能','自定义','模型提供商','实验功能']) {
      if (!await cdp.evaluate(`!!document.querySelector('[role="dialog"][aria-label="Settings"][data-open]')`)) {
        await cdp.evaluate(`document.querySelector('button[aria-label^="设置,"]').click()`);
        await sleep(200);
      }
      for (let attempt = 0; attempt < 20; attempt++) {
        if (await cdp.evaluate(`[...document.querySelectorAll('[role="dialog"][aria-label="Settings"] nav button')].some(e=>e.textContent.trim()===${JSON.stringify(label)})`)) break;
        await sleep(100);
      }
      await cdp.evaluate(`(()=>{const d=document.querySelector('[role="dialog"][aria-label="Settings"]');const b=[...d.querySelectorAll('nav button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing tab');b.click()})()`);
      await sleep(1200);
      const visible = await cdp.evaluate(`(()=>{const d=document.querySelector('[role="dialog"][aria-label="Settings"]')||document;return [...d.querySelectorAll('h1,h2')].filter(e=>e.checkVisibility()).map(e=>e.textContent)})()`);
      assert.ok(visible.some(t => t.includes(label)) || label === '自定义' || label === '模型提供商', `Visible tab ${label}: ${visible}`);
    }
  }
  report.checks.push('21 settings tab navigations without renderer exception');
  const before = await cdp.evaluate('window.__copilotChinese.status()');
  await sleep(1200);
  const after = await cdp.evaluate('window.__copilotChinese.status()');
  assert.ok(after.passes - before.passes <= 4, 'Observer unexpectedly busy at idle');
  report.idle = { before, after };
  report.checks.push('Idle observer has no self-trigger loop');
  await cdp.evaluate(`(()=>{const d=document.querySelector('[role="dialog"][aria-label="Settings"]');[...d.querySelectorAll('nav button')].find(e=>e.textContent.trim()==='常规').click()})()`);
  await sleep(250);
  await mkdir('.local', { recursive: true });
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile('.local/settings-zh.png', Buffer.from(screenshot.data, 'base64'));
  const setSearch = value => cdp.evaluate(`(()=>{const e=document.querySelector('[role="dialog"][aria-label="Settings"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return e.value})()`);
  assert.equal(await setSearch('Storage'), 'Storage');
  await sleep(1200);
  assert.equal(await cdp.evaluate(`document.querySelector('[role="dialog"][aria-label="Settings"] input').value`), 'Storage');
  await setSearch('');
  report.checks.push('Real settings search input retains its original English value');
  report.errors = errors;
  assert.equal(errors.length, 0, 'Runtime exceptions');
  await writeFile('.local/smoke.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{}); cdp.close(); }
