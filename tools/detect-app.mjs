// Read-only installer bridge. stdout contains JSON only; errors go to stderr.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { findApp } from '../src/app-discovery.mjs';

try {
  if (process.platform !== 'win32') throw new Error('此版本仅支持 Windows。');
  if (process.argv.length > 3) throw new Error('Usage: node tools/detect-app.mjs [appPath]');
  let config = {};
  try {
    config = JSON.parse((await readFile(fileURLToPath(new URL('../config.json', import.meta.url)), 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('config.json 必须是 JSON 对象。');
  console.log(JSON.stringify(await findApp({ config, appPath: process.argv[2] })));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
