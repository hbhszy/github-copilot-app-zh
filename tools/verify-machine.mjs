import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {CDP,getTargets,isAppTarget} from '../src/cdp.mjs';
const state=JSON.parse(await readFile('.local/state.json','utf8'));
const cdp=await CDP.connect((await getTargets(state.port)).find(isAppTarget).webSocketDebuggerUrl);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function escape(){await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(300)}
try{
  await cdp.send('Page.bringToFront');
  await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});
  for(let i=0;i<100;i++){if(await cdp.evaluate('window.__copilotChinese?.enabled && window.__copilotChinese?.status().ready'))break;await sleep(300)}
  assert.equal(await cdp.evaluate(`Array.from(document.querySelectorAll('[contenteditable="true"],textarea')).some(e=>e.value?.trim()||e.textContent?.trim())`),false,'Unsent draft present');
  await escape();await escape();
  await cdp.evaluate(`document.querySelector('button[aria-label="新建项目或会话"]').focus()`);
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  for(let i=0;i<30;i++){if(await cdp.evaluate(`!!document.querySelector('[role="menu"][data-open]')`))break;await sleep(100)}
  const menu=await cdp.evaluate(`document.querySelector('[role="menu"][data-open]')?.textContent`);
  for(const label of ['克隆仓库','打开文件夹','在以下项目中开始会话'])assert.ok(menu?.includes(label),label);
  const names=await cdp.evaluate(`[...document.querySelectorAll('[role="menu"] [data-testid="project-menu-item"]')].map(e=>e.textContent)`);
  assert.ok(names.length>0);
  assert.ok(await cdp.evaluate(`[...document.querySelectorAll('[data-testid^="repository-group-children-"]>[aria-disabled="true"]')].filter(e=>!e.getAttribute('data-roving-key')?.includes('quick-chats')).every(e=>e.textContent==='暂无会话')`));
  await writeFile('.local/menu-zh.png',Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await escape();
  await cdp.evaluate(`document.querySelector('button[aria-label="反馈意见"]').click()`);
  const selector='[role="dialog"][aria-label="Share feedback"][data-open]';
  let feedback;
  for(let i=0;i<100;i++){
    feedback=await cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e?{label:e.querySelector('label')?.textContent,notice:e.querySelector('p')?.textContent,value:e.querySelector('textarea')?.value}:null})()`);
    if(feedback && /[\u3400-\u9fff]/.test(feedback.label) && /[\u3400-\u9fff]/.test(feedback.notice))break;
    await sleep(300);
  }
  assert.ok(feedback && /[\u3400-\u9fff]/.test(feedback.label),'Real unknown feedback label translated');
  assert.ok(/[\u3400-\u9fff]/.test(feedback.notice),'Real unknown feedback notice translated');
  assert.equal(feedback.value,'','No feedback entered or sent');
  const status=await cdp.evaluate('window.__copilotChinese.status()');
  assert.ok(status.machine.applied>0);
  await writeFile('.local/feedback-zh.png',Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await writeFile('.local/machine-integration.json',JSON.stringify({date:new Date().toISOString(),menuLabels:['克隆仓库','打开文件夹','在以下项目中开始会话'],projectNamesUnchanged:names.length>0,feedback,status},null,2));
  console.log(JSON.stringify({feedback,status},null,2));
  await escape();
}finally{await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{});cdp.close()}
