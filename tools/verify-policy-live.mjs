// Read-only smoke check of the current page. Never navigates, clicks, refreshes,
// submits messages or reads input/chat text. Writes only aggregate local metrics.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDP, getTargets, isAppTarget } from '../src/cdp.mjs';
import { validateEndpoint } from '../src/windows.mjs';
import { createMachinePolicy } from '../src/machine-policy.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const local = join(root, '.local');
const state = JSON.parse(await readFile(join(local, 'state.json'), 'utf8'));
const dictionary = JSON.parse(await readFile(join(root, 'locales', 'zh-CN.json'), 'utf8'));
assert.ok(state.active && state.phase === 'ready', 'Start the Chinese launcher and wait until ready');
process.kill(state.pid, 0); // Liveness probe only; signal 0 does not terminate.
await validateEndpoint(state.port, state.app.path);
const target = (await getTargets(state.port)).find(isAppTarget);
assert.ok(target, 'No verified Copilot main page found');
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
let exceptions = 0;
const onMessage = event => {
  if (JSON.parse(event.data).method === 'Runtime.exceptionThrown') exceptions++;
};
cdp.socket.addEventListener('message', onMessage);
try {
  await cdp.send('Runtime.enable');
  const before = await cdp.evaluate('window.__copilotChinese?.status()');
  await new Promise(resolve => setTimeout(resolve, 2000));
  const after = await cdp.evaluate('window.__copilotChinese?.status()');
  assert.ok(before?.enabled && before.ready && after?.enabled && after.ready, 'Overlay is not ready');
  assert.equal(after.version, dictionary.version, 'The running overlay is not the current version');
  const latest = JSON.parse(await readFile(join(local, 'state.json'), 'utf8'));
  const report = {
    date: new Date().toISOString(), appVersion: state.app.version,
    policyVersion: createMachinePolicy().version, before, after,
    idleStable: before.passes === after.passes && before.workMs === after.workMs,
    runtimeExceptions: exceptions, engine: latest.machineTranslation,
    scope: 'Current page only; no navigation, refresh, input or task submission'
  };
  await writeFile(join(local, 'policy-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.equal(exceptions, 0, 'Runtime exceptions were observed; review locally before release');
} finally {
  cdp.socket.removeEventListener('message', onMessage);
  cdp.close();
}
