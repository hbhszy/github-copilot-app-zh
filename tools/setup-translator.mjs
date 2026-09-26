// Explicit one-time download/update. Daily translation runs with networking blocked.
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EdgeTranslator, edgeInstallation } from '../src/edge-translator.mjs';
const local=resolve(dirname(fileURLToPath(import.meta.url)),'../.local');
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--if-needed')) throw new Error('Usage: node tools/setup-translator.mjs [--if-needed]');
  await mkdir(local,{recursive:true});
  const installation = await edgeInstallation(local);
  if (args.includes('--if-needed') && installation.modelReady) {
    console.log('本地翻译组件已存在，保留现有模型，无需重复下载。');
    return;
  }
  // Do not compete with a live companion, even while its Edge engine is idle.
  // Neither installation nor model preparation may stop the user's Copilot.
  let owner;
  try { owner = JSON.parse(await readFile(resolve(local, 'launcher.lock/owner.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (Number.isInteger(owner?.pid) && owner.pid > 0) {
    let active = true;
    try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') active = false; }
    if (active) throw new Error('汉化伴随进程正在运行。请先使用开始菜单的“停用汉化”，再双击 install.cmd 重试；不会关闭 Copilot。');
  }
  const host=new EdgeTranslator(local,installation,{allowDownload:true});
  try {
    console.log('正在准备微软本地英中翻译组件，首次可能需要下载数百 MB…');
    console.log(await host.translate('The local translation engine is ready.'));
  } finally {await host.close()}
}
try { await main(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
