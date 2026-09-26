// Explicit, reversible UI audit. Opens menus, hovers controls and switches fixed
// navigation tabs; never selects menu values, types, submits, installs or deletes.
// Reports may contain local UI strings only when --include-text is supplied.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {CDP,getTargets,isAppTarget} from '../src/cdp.mjs';
import {validateEndpoint} from '../src/windows.mjs';
const currentOnly=process.argv.includes('--current-only');
assert.ok(currentOnly||process.argv.includes('--interact'),'Pass --interact for navigation, or --current-only for read-only inspection');
const includeText=process.argv.includes('--include-text');
if(includeText)console.warn('Candidate strings may contain private identities; keep the report local and review before sharing.');
const tag=currentOnly?'current':process.argv.includes('--after')?'after':'before';
const state=JSON.parse(await readFile('.local/state.json','utf8'));
assert.ok(state.active&&state.phase==='ready','Start the Chinese companion first');
await validateEndpoint(state.port,state.app.path);
const target=(await getTargets(state.port)).find(isAppTarget);assert.ok(target);
const cdp=await CDP.connect(target.webSocketDebuggerUrl),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={date:new Date().toISOString(),mode:currentOnly?'read-only':'interact',appVersion:state.app.version,includeText,steps:[],runtimeExceptions:0};
cdp.socket.addEventListener('message',event=>{if(JSON.parse(event.data).method==='Runtime.exceptionThrown')report.runtimeExceptions++;});
// This helper never returns editor contents or input values.
function inPage(action,args={}) {
  const api=window.__copilotChinese;
  const original=e=>[...e.childNodes].map(n=>n.nodeType===3?api.originalText(n):n.nodeType===1?original(n):'').join('');
  const visible=e=>{
    if(!e.checkVisibility()||e.closest('[hidden],[inert],[aria-hidden="true"],[data-closed]'))return false;
    const style=getComputedStyle(e);
    if(style.visibility!=='visible'||Number(style.opacity)===0)return false;
    // Copilot retains zero-size listboxes after dismissing them. checkVisibility
    // alone reports them as visible; they must not block or receive UI actions.
    if(e.matches('button,[role^="menuitem"],[role="menu"],[role="listbox"],[role="dialog"]')) {
      const rect=e.getBoundingClientRect();if(rect.width<=0||rect.height<=0)return false;
    }
    return true;
  };
  const label=e=>(api.originalAttribute(e,'aria-label')||original(e)).trim();
  const settings=()=>document.querySelector('[role="dialog"][aria-label="Settings"][data-open]');
  const modalCount=()=>[...document.querySelectorAll('[role="menu"],[role="listbox"],[role="dialog"]')].filter(e=>visible(e)&&e!==settings()).length;
  const scope=args.scope==='settings'?settings():args.scope==='popups'?document:document;
  const protectedText='script,style,svg,code,pre,kbd,samp,input,textarea,[contenteditable],[data-lexical-editor],.prose,.markdown-body,.xterm,.monaco-editor,.cm-editor,[data-message-id],[data-message-role],[data-file-path],[data-diff],[data-selectable="true"],[translate="no"],[role="treeitem"],[aria-label="Conversation transcript"],[aria-label="对话记录"]';
  if(action==='state')return {path:location.pathname,modals:modalCount(),settings:Boolean(settings()),
    selected:settings()?[...settings().querySelector('nav ul').querySelectorAll('button')].find(e=>e.getAttribute('data-selected')==='true')?.textContent:null,
    searchBusy:Boolean(settings()?.querySelector('nav input')?.value.length),
    editorBusy:[...document.querySelectorAll('[contenteditable="true"],textarea')].some(e=>visible(e)&&(e.matches('textarea')?e.value.length:e.textContent.length)>0)};
  if(action==='settings-tab') {
    const button=[...settings().querySelector('nav ul').querySelectorAll('button')].find(e=>original(e).trim()===args.name||e.textContent.trim()===args.name);
    if(!button)return false;button.click();return true;
  }
  if(action==='settings-toggle') {
    const button=args.open?[...document.querySelectorAll('button')].find(e=>/^Settings,/.test(label(e))):[...settings()?.querySelectorAll('button')||[]].find(e=>label(e)==='Close dialog');
    if(!button)return false;button.click();return true;
  }
  if(action==='navigate') {
    const button=[...document.querySelectorAll('button')].find(e=>visible(e)&&!e.closest('main,[role="dialog"],[role="menu"],[role="treeitem"]')&&label(e)===args.name);
    if(!button)return false;button.click();return true;
  }
  if(action==='menu-buttons') {
    const elements=[...scope.querySelectorAll(args.nested?'[role="menuitem"][aria-haspopup="menu"]':'button[aria-haspopup="menu"],button[aria-haspopup="listbox"]')]
      .filter(e=>visible(e)&&!e.closest(protectedText)&&(args.nested||args.scope==='settings'||!e.closest('[role="dialog"],[role="menu"]')));
    return elements.slice(0,24).map(e=>({id:e.id,selectorIndex:[...document.querySelectorAll('button,[role="menuitem"]')].indexOf(e),
      // Root chrome names are used only to recognize the fixed view families.
      label:args.scope==='settings'?undefined:label(e)}));
  }
  if(action==='click-index') {
    const button=[...document.querySelectorAll('button,[role="menuitem"]')][args.index];
    if(!button||!visible(button)||button.disabled||!['menu','listbox'].includes(button.getAttribute('aria-haspopup')))return false;
    button.click();return true;
  }
  if(action==='hover-targets')return [...document.querySelectorAll('button[data-base-ui-tooltip-trigger]')]
    .filter(e=>visible(e)&&(!e.closest(protectedText)||/^(Copy user message|Edit message|Bookmark to timeline|Share reply as secret gist|Copy assistant message|Fork (chat|session) from response)$/.test(label(e))))
    .filter(e=>!e.closest('[role="treeitem"]')).slice(0,40).map(e=>({id:e.id,index:[...document.querySelectorAll('button')].indexOf(e)}));
  if(action==='hover-rect') {
    const e=[...document.querySelectorAll('button')][args.index];if(!e||!visible(e))return null;
    const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    if(x<0||y<0||x>=innerWidth||y>=innerHeight||!e.contains(document.elementFromPoint(x,y)))return null;
    return {x,y};
  }
  if(action==='snapshot') {
    const roots=args.scope==='settings'?[settings()].filter(Boolean):args.scope==='popups'?[...document.querySelectorAll('[role="menu"],[role="listbox"],[role="dialog"],[role="tooltip"],[data-base-ui-focusable][data-side][tabindex="-1"]')].filter(e=>visible(e)&&e!==settings()):[document.body];
    const rows=[],seen=new Set();
    const add=(node,name)=>{
      const e=node.nodeType===3?node.parentElement:node;if(!visible(e))return;
      const decision=api.explain(node,name);
      if(['protected','data','catalog-data','account-template-only'].includes(decision.route))return;
      const text=name==='#text'?api.originalText(node):api.originalAttribute(node,name);
      const shown=name==='#text'?node.nodeValue:node.getAttribute(name);
      if(!text?.trim()||text.length>480||!/[A-Za-z]{2}/.test(text))return;
      const key=name+'\n'+text+'\n'+decision.route;if(seen.has(key))return;seen.add(key);
      const changed=text!==shown;
      const row={tag:e.tagName.toLowerCase(),field:name,route:decision.route,context:decision.context,changed};
      if(args.includeText){row.source=text.trim();row.display=shown?.trim();}
      rows.push(row);
    };
    for(const root of roots) {
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{acceptNode:n=>n.nodeType===1&&(n.matches(protectedText)||!visible(n))?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
      let n;while((n=walker.nextNode())&&rows.length<500)if(n.nodeType===3)add(n,'#text');
      for(const e of root.querySelectorAll('button,input,textarea,[role="textbox"],[role="menuitem"]')) {
        if(e.closest(protectedText)&&!e.matches('input,textarea,[role="textbox"]')&&!/^(Copy user message|Edit message|Bookmark to timeline|Share reply as secret gist|Copy assistant message|Fork (chat|session) from response)$/.test(label(e)))continue;
        for(const name of ['aria-label','title','placeholder','aria-placeholder'])if(e.hasAttribute(name))add(e,name);
      }
    }
    return {path:location.pathname,rows,overlay:api.status(),modals:modalCount()};
  }
}
const page=(action,args)=>cdp.evaluate(`(${inPage.toString()})(${JSON.stringify(action)},${JSON.stringify(args||{})})`);
async function capture(name,scope) {
  const snapshot=await page('snapshot',{scope,includeText});report.steps.push({name,...snapshot});
  console.log(JSON.stringify({name,fields:snapshot.rows.length,remaining:snapshot.rows.filter(r=>!r.changed&&r.route!=='dictionary').length}));
}
async function escapeTo(count) {
  for(let i=0;i<8&&(await page('state')).modals>count;i++) {
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(300);
  }
  await sleep(300);
  assert.ok((await page('state')).modals<=count,'A popup did not close; stopping instead of clicking unrelated UI');
}
async function menus(name,scope) {
  const buttons=await page('menu-buttons',{scope});
  for(let i=0;i<buttons.length;i++) {
    // Re-resolve indices after React closes/remounts menus.
    const fresh=(await page('menu-buttons',{scope}))[i];if(!fresh)continue;
    const count=(await page('state')).modals;
    if(!await page('click-index',{index:fresh.selectorIndex}))continue;
    await sleep(450);
    if((await page('state')).modals===count){report.steps.push({name:`${name}:menu-${i}`,skipped:'did-not-open'});continue;}
    try {
      await capture(`${name}:menu-${i}`,'popups');
      const children=await page('menu-buttons',{scope:'popups',nested:true});
      for(let j=0;j<children.length;j++) {
        const child=(await page('menu-buttons',{scope:'popups',nested:true}))[j];if(!child)continue;
        const parentCount=(await page('state')).modals;
        if(await page('click-index',{index:child.selectorIndex})) {
          await sleep(350);await capture(`${name}:menu-${i}:submenu-${j}`,'popups');await escapeTo(parentCount);
        }
      }
    } finally {await escapeTo(count);}
  }
}
let before;
try {
  await cdp.send('Runtime.enable');if(!currentOnly)await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});
  before=await page('state');report.before=before;
  if(currentOnly) {
    await capture('current-page-readonly','page');
  } else {
  assert.equal(before.searchBusy,false,'Settings search has a query; leave it untouched');
  assert.equal(before.editorBusy,false,'A visible editor contains a draft; leave navigation to the user');
  assert.equal(before.modals,0,'Close existing menus/dialogs before the reversible audit');
  if(!before.settings){assert.ok(await page('settings-toggle',{open:true}));await sleep(300);}
  for(const name of ['General','Accounts','Sessions','Themes','Accessibility','Customize','Model providers','Experimental']) {
    assert.equal((await page('state')).path,before.path,'The user navigated; stop the audit');
    if(!await page('settings-tab',{name})){report.steps.push({name:`settings:${name}`,skipped:'navigation-unavailable'});continue;}
    await sleep(450);await capture(`settings:${name}`,'settings');await menus(`settings:${name}`,'settings');
  }
  if(before.selected)await page('settings-tab',{name:before.selected});
  await page('settings-toggle',{open:false});await sleep(250);
  await capture('current-page','page');await menus('current-page','page');
  const hover=await page('hover-targets');
  for(let i=0;i<hover.length;i++) {
    const position=await page('hover-rect',{index:hover[i].index});if(!position){report.steps.push({name:`hover:${i}`,skipped:'offscreen-or-obscured'});continue;}
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...position});await sleep(750);
    await capture(`hover:${i}`,'popups');
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2});await sleep(120);
  }
  for(const [name,path] of [['My work','/mywork'],['Automations','/workflows'],['Customize','/extensions']]) {
    if(before.path===path)continue;
    if(!await page('navigate',{name})){report.steps.push({name,skipped:'navigation-unavailable'});continue;}
    await sleep(1400);assert.equal((await page('state')).path,path,'Unexpected navigation; stop');
    try {await capture(name,'page');await menus(name,'page');}
    finally {
      // A popup can add history state without changing its pathname.
      for(let i=0;i<3&&(await page('state')).path===path;i++){await cdp.evaluate('history.back()');await sleep(600);}
    }
    assert.equal((await page('state')).path,before.path,'Could not restore original route');
  }
  }
} catch(error) {report.error=error.message;console.error(error.message);process.exitCode=1;}
finally {
  if(before&&!currentOnly) {
    const current=await page('state').catch(()=>null);
    if(current?.path===before.path&&current.modals===0) {
      if(before.settings&&!current.settings){await page('settings-toggle',{open:true});await sleep(200);}
      if(before.settings&&before.selected)await page('settings-tab',{name:before.selected});
      if(!before.settings&&current.settings)await page('settings-toggle',{open:false});
    }
    report.after=await page('state').catch(()=>null);
  }
  if(currentOnly)report.after=await page('state').catch(()=>null);
  if(!currentOnly)await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{});cdp.close();
  const redactRoute=(key,value)=>key==='path'&&typeof value==='string'?value.replace(/^\/(chats|workspaces)\/[^/]+/,'/$1/[redacted]'):value;
  await mkdir('.local',{recursive:true});await writeFile(`.local/interaction-audit-${tag}.json`,JSON.stringify(report,redactRoute,2));
  console.log(JSON.stringify({report:`.local/interaction-audit-${tag}.json`,steps:report.steps.length,runtimeExceptions:report.runtimeExceptions,error:report.error||null}));
}
