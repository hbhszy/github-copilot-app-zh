import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { discoverUntranslated } from '../src/discovery.mjs';
import { loadOverlaySource } from '../src/overlay-source.mjs';

const overlayCode = loadOverlaySource();
const dictionary = JSON.parse(readFileSync(new URL('../locales/zh-CN.json', import.meta.url), 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(html) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://tauri.localhost/settings' });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 20 });
  dom.window.eval(overlayCode);
  dom.window.installCopilotChinese(dictionary, dom.window.document, { test: true });
  await sleep(20);
  return dom;
}

test('discovery defaults to metadata only and skips protected user content', async () => {
  const dom = await fixture(`<main><section><h2>Future privacy section</h2><p>New explanation for this setting.</p></section></main>
    <div data-message-id="chat"><p>PRIVATE CHAT SENTENCE</p></div><pre>SECRET CODE</pre>
    <textarea>PRIVATE DRAFT</textarea><input value="PRIVATE VALUE" placeholder="Find a project">`);
  const { document } = dom.window;
  const result = discoverUntranslated(document, dom.window.__copilotChinese);
  const serialized = JSON.stringify(result);
  assert.equal(result.includeText, false);
  assert.equal(result.routeGroup, 'other');
  assert.ok(result.candidates.some(item => item.field === '#text' && item.route === 'unclassified'));
  assert.ok(!serialized.includes('Future privacy section'));
  assert.ok(!serialized.includes('PRIVATE CHAT SENTENCE'));
  assert.ok(!serialized.includes('SECRET CODE'));
  assert.ok(!serialized.includes('PRIVATE DRAFT'));
  assert.ok(!serialized.includes('PRIVATE VALUE'));
  assert.ok(result.candidates.every(item => !Object.hasOwn(item, 'source')));
  dom.window.close();
});

test('source text appears only when explicitly requested and candidate count is bounded', async () => {
  const dom = await fixture('<main><p>Future setting explanation</p><p>Another untranslated note</p></main>');
  const result = discoverUntranslated(dom.window.document, dom.window.__copilotChinese, { includeText: true, limit: 1 });
  assert.equal(result.includeText, true);
  assert.ok(result.candidates.length <= 1);
  assert.ok(result.candidates.every(item => typeof item.source === 'string'));
  assert.equal(result.truncated, true);
  dom.window.close();
});

test('discovery classifies each text node rather than a composite label containing model data', async () => {
  const dom = await fixture(`<button aria-haspopup="menu" aria-label="private-model High, model and reasoning"><span>private-model · <!-- effort -->High</span></button>
    <main><p>Still untranslated explanation</p></main>`);
  try {
    const { document } = dom.window;
    assert.equal(document.querySelector('button span').textContent, 'private-model · 高');
    const result = discoverUntranslated(document, dom.window.__copilotChinese, { includeText: true });
    assert.ok(!result.candidates.some(item => item.source === 'High'), 'an already translated effort is not a missing translation');
    assert.ok(result.candidates.some(item => item.source === 'Still untranslated explanation'));
  } finally { dom.window.close(); }
});
