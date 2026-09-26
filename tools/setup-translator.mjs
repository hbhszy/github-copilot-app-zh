// Explicit one-time download/update. Daily translation runs with networking blocked.
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EdgeTranslator, edgeInstallation } from '../src/edge-translator.mjs';
const local=resolve(dirname(fileURLToPath(import.meta.url)),'../.local');
await mkdir(local,{recursive:true});
const host=new EdgeTranslator(local,await edgeInstallation(local),{allowDownload:true});
try {
  console.log('正在准备微软本地英中翻译组件，首次可能需要下载数百 MB…');
  console.log(await host.translate('The local translation engine is ready.'));
} finally {await host.close()}
