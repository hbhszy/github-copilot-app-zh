// Development survey: navigate only Customize tabs; never install, enable or edit.
// Local output can contain catalog metadata and must not be published.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { CDP, getTargets, isAppTarget } from '../src/cdp.mjs';
import { validateEndpoint } from '../src/windows.mjs';
const state = JSON.parse(await readFile('.local/state.json', 'utf8'));
await validateEndpoint(state.port, state.app.path);
const target = (await getTargets(state.port)).find(isAppTarget);
assert.ok(target, 'Open Copilot first');
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tabs = `document.querySelectorAll('main [role="tablist"][aria-label="Extension categories"] [role="tab"]')`;
let original, last;
const report = { date: new Date().toISOString(), tabs: [] };
try {
  original = await cdp.evaluate(`(()=>{if(location.pathname!=='/extensions')throw Error('Keep Customize open');if(document.querySelector('[role="dialog"][data-open]'))throw Error('Close dialog before surveying');if([...document.querySelectorAll('main [data-customize-category-header-row] input')].some(e=>e.value))throw Error('Keep the catalog search empty');return [...${tabs}].findIndex(e=>e.getAttribute('aria-selected')==='true')})()`);
  const count = await cdp.evaluate(`${tabs}.length`);
  for (let index = 0; index < count; index++) {
    await cdp.evaluate(`${tabs}[${index}].click()`); last = index;
    await sleep(900);
    const data = await cdp.evaluate(`(()=>{
      const selected=[...${tabs}].findIndex(e=>e.getAttribute('aria-selected')==='true');if(selected!==${index})throw Error('Tab changed during survey');
      const main=document.querySelector('main'), copy=main.cloneNode(true);
      for(const el of copy.querySelectorAll('script,style,svg,img,header'))el.remove();
      for(const list of copy.querySelectorAll('ul')){const items=[...list.children].filter(e=>e.tagName==='LI');for(const item of items.slice(0,-2))item.remove();}
      for(const el of copy.querySelectorAll('*'))for(const attr of [...el.attributes])if(['class','style','src','value'].includes(attr.name))el.removeAttribute(attr.name);
      return {index:${index},label:${tabs}[${index}].innerText,headings:[...main.querySelectorAll('h2,h3')].map(e=>({id:e.id,text:e.textContent,section:e.closest('section')?.getAttribute('aria-labelledby')})),inputs:[...main.querySelectorAll('input')].map(e=>({type:e.type,label:e.getAttribute('aria-label'),placeholder:e.getAttribute('placeholder')})),html:copy.outerHTML};
    })()`);
    report.tabs.push(data);
  }
  await mkdir('.local', {recursive:true});
  await writeFile('.local/customize-survey.json', JSON.stringify(report,null,2));
  console.log(JSON.stringify(report.tabs.map(({index,label,headings,inputs})=>({index,label,headings,inputs})),null,2));
} finally {
  if (original >= 0 && last != null) await cdp.evaluate(`(()=>{const t=[...${tabs}];if(location.pathname==='/extensions'&&t[${last}]?.getAttribute('aria-selected')==='true')t[${original}]?.click()})()`).catch(()=>{});
  cdp.close();
}
