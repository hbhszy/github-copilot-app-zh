import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { CDP, getTargets, isAppTarget } from '../src/cdp.mjs';
const state = JSON.parse(await readFile('.local/state.json', 'utf8'));
const cdp = await CDP.connect((await getTargets(state.port)).find(isAppTarget).webSocketDebuggerUrl);
const expectChinese = !process.argv.includes('--english');
try {
  // Development validation only. Run only on an idle page with no unsent draft.
  const drafts = await cdp.evaluate(`Array.from(document.querySelectorAll('[contenteditable="true"],textarea')).some(e=>e.value?.trim()||e.textContent?.trim())`);
  assert.equal(drafts, false, 'Refusing to reload a page containing a draft');
  await cdp.send('Page.reload');
  let result;
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(r => setTimeout(r, 200));
    result = await cdp.evaluate(`({ready:!!document.querySelector('#sidebar-heading'),enabled:window.__copilotChinese?.enabled||false,label:[...document.querySelectorAll('button[aria-label]')].map(e=>e.getAttribute('aria-label')).find(v=>v.startsWith('Settings,')||v.startsWith('设置,'))})`).catch(() => null);
    if (result?.ready && result.enabled === expectChinese && result.label?.startsWith(expectChinese ? '设置,' : 'Settings,')) break;
  }
  assert.equal(result.enabled, expectChinese);
  assert.ok(result.label.startsWith(expectChinese ? '设置,' : 'Settings,'));
  console.log(JSON.stringify(result, null, 2));
  await writeFile(`.local/reload-${expectChinese ? 'zh' : 'en'}.json`, JSON.stringify(result, null, 2));
} finally { cdp.close(); }
