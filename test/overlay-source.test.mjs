import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadOverlaySource, overlaySourceFunctions } from '../src/overlay-source.mjs';

test('browser overlay bundle is generated from self-contained modular factories', () => {
  const source = loadOverlaySource();
  assert.equal(overlaySourceFunctions().length, 6);
  assert.ok(source.includes('function installCopilotChinese'));
  assert.ok(source.includes('function createOverlayClassifier'));
  assert.doesNotMatch(source, /^\s*(?:import|export)\s/m);
  assert.doesNotThrow(() => new Function(source));
});

test('generated overlay bundle installs without a build artifact', async () => {
  const dom = new JSDOM('<button>Settings</button>', { runScripts:'outside-only', url:'http://tauri.localhost/' });
  dom.window.eval(loadOverlaySource());
  const dictionary = { version:'test', common:{Settings:'设置'}, settings:{}, pages:{} };
  dom.window.installCopilotChinese(dictionary,dom.window.document,{test:true});
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(dom.window.document.querySelector('button').textContent,'设置');
  assert.equal(dom.window.__copilotChinese.status().ready,true);
  dom.window.close();
});
