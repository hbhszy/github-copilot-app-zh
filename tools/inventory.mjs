import { CDP, getTargets, isAppTarget } from '../src/cdp.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const state = JSON.parse(await readFile('.local/state.json', 'utf8'));
const cdp = await CDP.connect((await getTargets(state.port)).find(isAppTarget).webSocketDebuggerUrl);
const inventory = {};
try {
  for (const label of ['General', 'Sessions', 'Themes', 'Accessibility', 'Customize', 'Model providers', 'Experimental']) {
    await cdp.evaluate(`(()=>{const d=document.querySelector('[role="dialog"][aria-label="Settings"]');const b=[...d.querySelectorAll('nav button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing navigation');b.click()})()`);
    await new Promise(r => setTimeout(r, 250));
    inventory[label] = await cdp.evaluate(`(()=>{const d=document.querySelector('[role="dialog"][aria-label="Settings"]'); const w=document.createTreeWalker(d,NodeFilter.SHOW_TEXT);const a=[];while(w.nextNode()){const n=w.currentNode; if(n.textContent.trim()&&!n.parentElement.closest('script,style,input,textarea,[contenteditable="true"],code,pre'))a.push(n.textContent.trim());}return [...new Set(a)]})()`);
  }
  await mkdir('.local', { recursive: true });
  await writeFile('.local/inventory.json', JSON.stringify(inventory, null, 2));
  console.log(JSON.stringify(inventory, null, 2));
} finally { cdp.close(); }
