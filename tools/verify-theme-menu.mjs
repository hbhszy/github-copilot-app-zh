// Opens only the user menu and its Theme submenu. Never selects a theme or sends
// a message. Refuses to dismiss an open dialog to get to the menu.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {CDP,getTargets,isAppTarget} from '../src/cdp.mjs';
import {validateEndpoint} from '../src/windows.mjs';
const state=JSON.parse(await readFile('.local/state.json','utf8'));
await validateEndpoint(state.port,state.app.path);
const target=(await getTargets(state.port)).find(isAppTarget);
const cdp=await CDP.connect(target.webSocketDebuggerUrl);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function clickPoint(point) {
  if(!point)return;
  const [x,y]=point;
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});
}
try {
  await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});
  const version=await cdp.evaluate('window.__copilotChinese?.version');
  assert.equal(version,'0.2.5');
  await clickPoint(await cdp.evaluate(`(()=>{
    if([...document.querySelectorAll('[role="dialog"]')].some(e=>e.checkVisibility()&&!e.hasAttribute('data-closed')))throw Error('Close the open dialog before this menu check');
    const button=[...document.querySelectorAll('button[aria-label]')].find(e=>e.checkVisibility()&&e.getAttribute('aria-label').endsWith(', open user menu'));
    if(!button)throw Error('User-menu control not found');
    if(button.getAttribute('aria-expanded')==='true')return null;
    const r=button.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];
  })()`));
  for(let i=0;i<30;i++) {
    if(await cdp.evaluate(`[...document.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')].some(e=>e.checkVisibility()&&['Theme','主题'].includes(e.textContent.trim()))`))break;
    await sleep(100);
  }
  await clickPoint(await cdp.evaluate(`(()=>{
    const item=[...document.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')].find(e=>['Theme','主题'].includes(e.textContent.trim()));
    if(!item)throw Error('Theme control not found');
    if(item.getAttribute('aria-expanded')==='true')return null;
    const r=item.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];
  })()`));
  await sleep(200);
  const menu=await cdp.evaluate(`(()=>{
    const trigger=[...document.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')].find(e=>['Theme','主题'].includes(e.textContent.trim()));
    const popup=trigger && document.getElementById(trigger.getAttribute('aria-controls'));
    if(!popup||!popup.checkVisibility())throw Error('Theme submenu not open');
    return [...popup.querySelectorAll('[role^="menuitem"]')].map(e=>({label:e.textContent.trim(),checked:e.getAttribute('aria-checked'),route:window.__copilotChinese.explain(e).route}));
  })()`);
  assert.deepEqual(menu.map(e=>e.label),['跟随系统','浅色','深色','个性化设置']);
  assert.equal(menu.filter(e=>e.checked==='true').length,1);
  const image=await cdp.send('Page.captureScreenshot',{format:'png'});
  await writeFile('.local/theme-menu-zh.png',Buffer.from(image.data,'base64'));
  const report={date:new Date().toISOString(),version,menu,scope:'Opened menu/submenu only; no theme selection or task submission'};
  await writeFile('.local/theme-menu-verification.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{});cdp.close()}
