// Uses the production process/profile lock. Stop the Chinese launcher before probing.
import { mkdir,writeFile } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EdgeTranslator,edgeInstallation } from '../src/edge-translator.mjs';
const local=resolve(dirname(fileURLToPath(import.meta.url)),'../.local');
await mkdir(local,{recursive:true});
const offline=process.argv.includes('--offline');
const index=process.argv.indexOf('--text');
if(index>=0 && !process.argv[index+1])throw Error('--text requires a string');
const samples=index>=0?[process.argv[index+1]]:['Choose where new sessions start.','Create a new worktree','Stage all changes','Branch','Open {count} files after 30 seconds.'];
const host=new EdgeTranslator(local,await edgeInstallation(local),{allowDownload:!offline});
const report={date:new Date().toISOString(),headless:true,offline,samples:[]};
try {
  const start=performance.now();await host.start();report.createMs=performance.now()-start;
  report.environment=await host.cdp.evaluate('({ua:navigator.userAgent,secure:isSecureContext,online:navigator.onLine})');
  for(const source of samples){const begin=performance.now();const result=await host.translate(source);report.samples.push({source,result,ms:performance.now()-begin});}
  await writeFile(resolve(local,`edge-translator-report-headless${offline?'-offline':''}${index>=0?'-custom':''}.json`),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await host.close()}
