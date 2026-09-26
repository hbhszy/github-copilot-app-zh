// Read-only verification of the already-open settings navigation. No clicks,
// refresh, input writes or task submission. Private values are stored as hashes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { CDP, getTargets, isAppTarget } from '../src/cdp.mjs';
import { validateEndpoint } from '../src/windows.mjs';

const state = JSON.parse(await readFile('.local/state.json', 'utf8'));
const dictionary = JSON.parse(await readFile('locales/zh-CN.json', 'utf8'));
const labels = ['General','Accounts','Sessions','Themes','Accessibility','Customize','Model providers','Experimental'];
const baselineFile = '.local/settings-navigation-baseline.json';
await validateEndpoint(state.port, state.app.path);
const target = (await getTargets(state.port)).find(isAppTarget);
assert.ok(target, 'No verified Copilot page is available');
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
try {
  const snapshot = await cdp.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Settings"]');
    if (!dialog || !dialog.checkVisibility() || dialog.hasAttribute('data-closed')) throw Error('Keep settings open for this read-only check');
    const nav = dialog.querySelector('nav'), list = nav?.querySelector('ul');
    if (!list) throw Error('Unsupported settings navigation structure');
    const original = el => [...el.childNodes].map(n => n.nodeType === 3 ? window.__copilotChinese.originalText(n) : n.nodeType === 1 ? original(n) : '').join('');
    const rect = list.getBoundingClientRect();
    return {
      status: window.__copilotChinese.status(),
      fixed: [...list.querySelectorAll('button')].map(b => ({source: original(b).trim(), text: b.textContent.trim(), selected: b.getAttribute('data-selected'), current: b.getAttribute('aria-current'), pressed: b.getAttribute('aria-pressed')})),
      projects: [...nav.querySelectorAll('ul')].slice(1).map(l => l.textContent),
      fields: [...dialog.querySelectorAll('input,textarea')].map(e => [e.type,e.value,e.checked]),
      clip: {x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height, scale: 1}
    };
  })()`);
  assert.deepEqual(snapshot.fixed.map(b => b.source), labels, 'Settings navigation structure changed');
  const hash = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
  snapshot.projectDigest = hash(snapshot.projects);
  snapshot.fieldDigest = hash(snapshot.fields);
  delete snapshot.projects; delete snapshot.fields;
  snapshot.date = new Date().toISOString();
  if (process.argv.includes('--baseline')) {
    await writeFile(baselineFile, JSON.stringify(snapshot, null, 2));
    console.log(JSON.stringify({baseline: baselineFile, version: snapshot.status.version, labels: snapshot.fixed.map(b => b.text)}, null, 2));
  } else {
    const baseline = JSON.parse(await readFile(baselineFile, 'utf8'));
    assert.equal(snapshot.status.version, dictionary.version);
    assert.ok(snapshot.status.enabled && snapshot.status.ready);
    assert.deepEqual(snapshot.fixed.map(b => b.text), labels.map(label => dictionary.common[label]));
    const selection = data => data.fixed.map(({source,selected,current,pressed}) => ({source,selected,current,pressed}));
    assert.deepEqual(selection(snapshot), selection(baseline), 'Selection changed since baseline');
    assert.equal(snapshot.projectDigest, baseline.projectDigest, 'Project labels changed since baseline');
    assert.equal(snapshot.fieldDigest, baseline.fieldDigest, 'Input values changed since baseline');
    const screenshot = await cdp.send('Page.captureScreenshot', {format:'png', clip:snapshot.clip});
    await writeFile('.local/settings-navigation-zh.png', Buffer.from(screenshot.data, 'base64'));
    const report = {date:snapshot.date, version:snapshot.status.version, labels:snapshot.fixed, selectionUnchanged:true, projectLabelsUnchanged:true, inputValuesUnchanged:true, scope:'Already-open settings only; no clicks, reload, input writes or task submission'};
    await writeFile('.local/settings-navigation-verification.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
} finally { cdp.close(); }
