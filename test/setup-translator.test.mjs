import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('installer translation setup reuses models and refuses to compete with a live companion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'copilot-zh-setup-'));
  const run = promisify(execFile);
  try {
    for (const directory of ['tools', 'src', '.local/launcher.lock']) await mkdir(join(root, directory), { recursive: true });
    await writeFile(join(root, 'tools/setup-translator.mjs'), await readFile(new URL('../tools/setup-translator.mjs', import.meta.url)));
    // Isolated engine double: never launches Edge, downloads models or touches
    // the user's real translation profile. Only the setup orchestration runs.
    await writeFile(join(root, 'src/edge-translator.mjs'), `
      import { appendFileSync } from 'node:fs';
      export async function edgeInstallation() { return { modelReady: process.env.TEST_MODEL_READY === '1' }; }
      export class EdgeTranslator {
        async translate() { appendFileSync('trace', 'translate\\n'); return 'ready'; }
        async close() { appendFileSync('trace', 'close\\n'); }
      }
    `);
    const options = ready => ({ cwd: root, windowsHide: true, timeout: 10000, env: { ...process.env, TEST_MODEL_READY: ready ? '1' : '0' } });
    const owner = join(root, '.local/launcher.lock/owner.json');
    await writeFile(owner, JSON.stringify({ pid: process.pid }));
    const reused = await run(process.execPath, ['tools/setup-translator.mjs', '--if-needed'], options(true));
    assert.match(reused.stdout, /无需重复下载/);
    await assert.rejects(readFile(join(root, 'trace')), { code: 'ENOENT' });
    for (const args of [['--if-needed'], []]) {
      await assert.rejects(run(process.execPath, ['tools/setup-translator.mjs', ...args], options(false)), error => error.code === 1 && /停用汉化/.test(error.stderr));
    }
    await assert.rejects(readFile(join(root, 'trace')), { code: 'ENOENT' });
    await rm(owner);
    await run(process.execPath, ['tools/setup-translator.mjs', '--if-needed'], options(false));
    assert.equal(await readFile(join(root, 'trace'), 'utf8'), 'translate\nclose\n');
    await assert.rejects(run(process.execPath, ['tools/setup-translator.mjs', '--invalid'], options(true)), error => error.code === 1 && /Usage:/.test(error.stderr));
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
