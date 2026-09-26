// Navigate Customize tabs only. No installation, switch changes, search edits,
// conversation reads, page reloads or task submissions. Reports remain local.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { CDP, getTargets, isAppTarget } from '../src/cdp.mjs';
import { validateEndpoint } from '../src/windows.mjs';
const state=JSON.parse(await readFile('.local/state.json','utf8'));
await validateEndpoint(state.port,state.app.path);
const target=(await getTargets(state.port)).find(isAppTarget);assert.ok(target);
const cdp=await CDP.connect(target.webSocketDebuggerUrl);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const tabs=`document.querySelectorAll('main [role="tablist"][aria-label="Extension categories"] [role="tab"]')`;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const report={date:new Date().toISOString(),version:null,tabs:[],runtimeExceptions:0,scope:'Tab navigation only; no install, enable, configuration change, reload or task submission'};
let original,last;
cdp.socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.exceptionThrown')report.runtimeExceptions++;});
const sample=()=>cdp.evaluate(`(()=>{
  const api=window.__copilotChinese,main=document.querySelector('main'),panel=main.querySelector('[role="tabpanel"]');
  const original=el=>[...el.childNodes].map(n=>n.nodeType===3?api.originalText(n):n.nodeType===1?original(n):'').join('');
  const rows=[...panel.querySelectorAll('[class~="group/row"],li')].filter(e=>!e.querySelector('[class~="group/row"]'));
  const names=rows.map(row=>row.querySelector('p')).filter(Boolean).map(p=>p.firstElementChild?.tagName==='SPAN'?p.firstElementChild:p).map(e=>({source:original(e),display:e.textContent}));
  const leaves=[],walker=document.createTreeWalker(main,4);let n;
  while(n=walker.nextNode()){
    if(!n.nodeValue.trim()||n.parentElement.closest('script,style,svg,textarea,input,[contenteditable]'))continue;
    const source=api.originalText(n);if(!/[A-Za-z]{2}/.test(source))continue;
    const decision=api.explain(n),catalog=decision.context?.startsWith('page:catalog-');
    if(catalog)leaves.push({source,display:n.nodeValue,route:decision.route,context:decision.context,visible:!n.parentElement.closest('[aria-hidden="true"],[hidden],[inert]')});
  }
  return {status:api.status(),label:[...${tabs}].find(e=>e.getAttribute('aria-selected')==='true')?.innerText,
    names,leaves,headings:[...panel.querySelectorAll('h2,h3')].map(e=>e.textContent),
    fields:[...main.querySelectorAll('input,textarea')].map(e=>({id:e.id,value:e.value})),
    switches:[...panel.querySelectorAll('[aria-checked],[aria-selected]')].map(e=>({id:e.id,role:e.getAttribute('role'),checked:e.getAttribute('aria-checked'),selected:e.getAttribute('aria-selected')})),
    search:[...main.querySelectorAll('[data-customize-category-header-row] input')].map(e=>({placeholder:e.getAttribute('placeholder'),label:e.getAttribute('aria-label')}))};
})()`);
try {
  await cdp.send('Runtime.enable');
  original=await cdp.evaluate(`(()=>{if(location.pathname!=='/extensions'||document.querySelector('[role="dialog"][data-open]'))throw Error('Keep Customize open without a dialog');if([...document.querySelectorAll('main [data-customize-category-header-row] input')].some(e=>e.value))throw Error('Keep the search empty');return [...${tabs}].findIndex(e=>e.getAttribute('aria-selected')==='true')})()`);
  await mkdir('.local',{recursive:true});
  for(let index=0;index<7;index++) {
    await cdp.evaluate(`${tabs}[${index}].click()`);last=index;await sleep(650);
    const before=await sample();let after=before;
    const until=Date.now()+45000;
    while(after.status.machine.queued && Date.now()<until) {
      const current=JSON.parse(await readFile('.local/state.json','utf8'));
      if(current.machineTranslation?.state==='unavailable')throw Error('Translator unavailable: '+current.machineTranslation.error);
      await sleep(700);after=await sample();
    }
    assert.equal(after.label,before.label,'Tab changed during verification');
    const namesIntact=after.names.every(n=>n.source===n.display);
    const inputsIntact=digest(before.fields)===digest(after.fields);
    const switchesIntact=digest(before.switches)===digest(after.switches);
    const visible=after.leaves.filter(e=>e.visible);
    const remaining=visible.filter(e=>!/[\u3400-\u9fff]/.test(e.display));
    const descriptions=visible.filter(e=>e.context.includes('catalog-description'));
    const summary={index,label:after.label,headings:after.headings,search:after.search,namesChecked:after.names.length,namesIntact,inputsIntact,switchesIntact,
      descriptions:descriptions.length,translatedDescriptions:descriptions.filter(e=>/[\u3400-\u9fff]/.test(e.display)).length,remaining,queue:after.status.machine.queued,
      examples:descriptions.slice(0,3),status:after.status};
    report.tabs.push(summary);report.version=after.status.version;
    await writeFile('.local/customize-verification.json',JSON.stringify(report,null,2));
    if (process.argv.includes('--screenshots')) try {
      const screenshot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},2000);
      await writeFile('.local/customize-tab-'+index+'-zh.png',Buffer.from(screenshot.data,'base64'));
    } catch(error) { summary.screenshotError=error.message; }
    assert.ok(namesIntact,'Catalog identity was translated');assert.ok(inputsIntact,'Input value changed');assert.ok(switchesIntact,'Switch/selection state changed');
    assert.ok(after.search.every(e=>e.placeholder.startsWith('搜索')),'Search hint untranslated');
    assert.equal(remaining.filter(e=>e.route==='machine').length,0,'Eligible catalog copy has not finished translating');
    console.log(JSON.stringify(summary));
  }
  report.runtimeExceptionsObserved=report.runtimeExceptions;
  assert.equal(report.runtimeExceptions,0);
  await writeFile('.local/customize-verification.json',JSON.stringify(report,null,2));
} catch(error) {
  report.error=error.message;await writeFile('.local/customize-verification.json',JSON.stringify(report,null,2));throw error;
} finally {
  if(original>=0&&last!=null)await cdp.evaluate(`(()=>{const t=[...${tabs}];if(location.pathname==='/extensions'&&t[${last}]?.getAttribute('aria-selected')==='true')t[${original}]?.click()})()`).catch(()=>{});
  cdp.close();
}
