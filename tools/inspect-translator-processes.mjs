// Diagnose only the dedicated translator profile, never normal browser tabs.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { powershell, psQuote } from '../src/windows.mjs';
const profile=resolve('.local/edge-translator');
const portFile=await readFile('.local/edge-translator/DevToolsActivePort','utf8').catch(()=>null);
const owner=await readFile('.local/edge-translator.lock/owner.json','utf8').catch(()=>null);
const processes=JSON.parse(await powershell(`$p=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object {$_.CommandLine -and $_.CommandLine.Contains(${psQuote(profile)})} | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine); ConvertTo-Json -InputObject $p -Compress`));
const listeners=portFile?await powershell(`netstat -ano -p tcp | Select-String ':${Number(portFile.split('\n')[0])} '`):null;
const report={date:new Date().toISOString(),portFile,owner,processes,listeners};
await writeFile('.local/translator-processes.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
