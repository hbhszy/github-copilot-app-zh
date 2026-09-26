// Hover the fixed fork-chat action only. Never clicks, types, scrolls, or reads
// conversation/draft text. The first pointer move reveals a hidden action bar.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {CDP,getTargets,isAppTarget} from '../src/cdp.mjs';
import {validateEndpoint} from '../src/windows.mjs';
const state=JSON.parse(await readFile('.local/state.json','utf8'));
assert.ok(state.active&&state.phase==='ready');
await validateEndpoint(state.port,state.app.path);
const target=(await getTargets(state.port)).find(isAppTarget);assert.ok(target);
const cdp=await CDP.connect(target.webSocketDebuggerUrl),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={date:new Date().toISOString(),scope:'Fixed fork-chat button hover only; no clicks, typing, scrolling, or transcript reads'};
try {
  const point=await cdp.evaluate(`(()=>{
    const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.closest('[hidden],[inert],[aria-hidden="true"],[data-closed]')&&getComputedStyle(e).visibility==='visible';};
    if([...document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"]')].some(visible))throw Error('Leave existing dialogs and menus untouched');
    const api=window.__copilotChinese;
    const button=[...document.querySelectorAll('button[data-base-ui-tooltip-trigger]')].find(e=>api.originalAttribute(e,'aria-label')==='Fork chat from response'&&visible(e));
    if(!button)throw Error('No visible fork-chat action is available');
    const r=button.getBoundingClientRect();
    if(r.x<0||r.y<0||r.right>innerWidth||r.bottom>innerHeight)throw Error('The action is outside the viewport');
    return {x:r.x+r.width/2,y:r.y+r.height/2,localized:button.getAttribute('aria-label')==='从此回复派生聊天'};
  })()`);
  report.buttonLocalized=point.localized;
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});await sleep(180);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+1,y:point.y});await sleep(1000);
  report.tooltipLocalized=await cdp.evaluate(`(()=>{
    return [...document.querySelectorAll('[role="tooltip"],[data-base-ui-focusable][data-side][tabindex="-1"]')].some(e=>{
      const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.closest('[hidden],[inert],[aria-hidden="true"],[data-closed]')&&e.textContent.trim()==='从此回复派生聊天';
    });
  })()`);
  assert.equal(report.buttonLocalized,true,'Fork-chat action is not localized');
  assert.equal(report.tooltipLocalized,true,'The hovered fork-chat tooltip is not localized');
} catch(error) {report.error=error.message;process.exitCode=1;}
finally {
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2}).catch(()=>{});cdp.close();
  await writeFile('.local/message-tooltip-verification.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
