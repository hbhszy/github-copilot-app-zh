import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

test('native GUI entry has no console and exits while its companion remains alive',{skip:process.platform!=='win32'},async()=>{
  const root=await mkdtemp(join(tmpdir(),'copilot-zh-bootstrap-'));
  let childPid;
  try{
    await mkdir(join(root,'.local'));await mkdir(join(root,'src'));
    const exe=join(root,'.local','CopilotZh.exe');
    const quote=s=>"'"+s.replaceAll("'","''")+"'";
    const compile=`$ErrorActionPreference='Stop';Add-Type -Path ${quote(fileURLToPath(new URL('../src/bootstrap.cs',import.meta.url)))} -OutputAssembly ${quote(exe)} -OutputType WindowsApplication -ReferencedAssemblies System.dll,System.Web.Extensions.dll,System.Windows.Forms.dll`;
    await promisify(execFile)('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(compile,'utf16le').toString('base64')],{windowsHide:true,timeout:20000});
    const binary=await readFile(exe);
    assert.equal(binary.readUInt16LE(binary.readUInt32LE(0x3c)+24+68),2,'Entry must use the GUI subsystem, not a console subsystem');
    await writeFile(join(root,'.local','runtime.json'),JSON.stringify({node:process.execPath}));
    // Isolated fixture only; never launches or stops the user's Copilot.
    await writeFile(join(root,'src','launcher.mjs'),`import{writeFileSync}from'node:fs';writeFileSync('started.json',JSON.stringify({pid:process.pid}));setTimeout(()=>{},4000);`);
    const launch=args=>new Promise((resolve,reject)=>{
      const p=spawn(exe,args,{stdio:'ignore',windowsHide:true});p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(Error('GUI entry exit '+code)));
    });
    await launch(['--check']);assert.equal(JSON.parse(await readFile(join(root,'.local','bootstrap-check.json'),'utf8')).noConsole,true);
    await launch([]);
    for(let i=0;i<30;i++) {
      try{childPid=JSON.parse(await readFile(join(root,'started.json'),'utf8')).pid;break}catch{await new Promise(r=>setTimeout(r,50));}
    }
    assert.ok(childPid,'Fixture child did not start');
    assert.doesNotThrow(()=>process.kill(childPid,0),'GUI entry waited for the companion to exit');
  }finally{
    if(childPid){try{process.kill(childPid)}catch{}}
    await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
