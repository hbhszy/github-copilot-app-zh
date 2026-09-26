import { CDP, getTargets, isAppTarget } from '../src/cdp.mjs';
import { readFile } from 'node:fs/promises';
let currentState; try { currentState = JSON.parse(await readFile('.local/state.json', 'utf8')); } catch {}
const port = Number(process.env.COPILOT_ZH_PORT || currentState?.port || 49371);
const target = (await getTargets(port)).find(isAppTarget);
if (!target) throw new Error('Copilot main page not found');
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
try {
  const expression = process.argv[2] === '--file' ? await readFile(process.argv[3], 'utf8') : process.argv[2];
  console.log(JSON.stringify(await cdp.evaluate(expression || `({url:location.href,buttons:[...document.querySelectorAll('button')].map(e=>({text:e.textContent,label:e.getAttribute('aria-label')}))})`), null, 2));
} finally { cdp.close(); }
