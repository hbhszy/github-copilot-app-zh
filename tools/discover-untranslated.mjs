// Read-only inventory of untranslated UI-looking text on the current page.
// Original strings are omitted unless --include-text is explicitly supplied.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDP, getTargets, isAppTarget } from '../src/cdp.mjs';
import { validateEndpoint } from '../src/windows.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const local = join(root, '.local');
const state = JSON.parse(await readFile(join(local, 'state.json'), 'utf8'));
assert.ok(state.active && state.phase === 'ready', 'Start the Chinese launcher and wait until ready');
process.kill(state.pid, 0);
await validateEndpoint(state.port, state.app.path);
const target = (await getTargets(state.port)).find(isAppTarget);
assert.ok(target, 'No verified Copilot main page found');
const includeText = process.argv.includes('--include-text');
if (includeText) console.warn('WARNING: the report may contain user-visible text. Keep it local and review before sharing.');
const discoverySource = (await readFile(join(root, 'src', 'discovery.mjs'), 'utf8'))
  .replace(/^export function discoverUntranslated/m, 'function discoverUntranslated');
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
try {
  const overlay = await cdp.evaluate('window.__copilotChinese?.status()');
  assert.ok(overlay?.enabled && overlay.ready, 'The translation overlay is not ready');
  const scan = await cdp.evaluate(`(()=>{${discoverySource}\nreturn discoverUntranslated(document,window.__copilotChinese,${JSON.stringify({ includeText, limit: 300 })});})()`);
  const groups = {};
  for (const candidate of scan.candidates) {
    const key = `${candidate.route} | ${candidate.context || '(none)'}`;
    groups[key] = (groups[key] || 0) + candidate.occurrences;
  }
  const report = {
    date: new Date().toISOString(),
    appVersion: state.app.version,
    overlayVersion: overlay.version,
    scope: 'Current visible page only; no navigation, clicking, refresh, input-value reads, or task submission',
    privacy: includeText ? 'Original strings explicitly included by --include-text; do not share without review' : 'Original strings omitted; report contains structural locations, route classifications and counts only',
    ...scan,
    groups
  };
  await mkdir(local, { recursive: true });
  const reportPath = join(local, 'untranslated-discovery.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ reportPath, appVersion: report.appVersion, routeGroup: report.routeGroup, inspected: report.inspected,
    candidates: report.candidates.length, groups: report.groups, truncated: report.truncated, includeText }, null, 2));
} finally {
  cdp.close();
}
