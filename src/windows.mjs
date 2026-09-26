import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
const run = promisify(execFile);
export async function powershell(script) {
  const encoded = Buffer.from("$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); " + script, 'utf16le').toString('base64');
  const environment = { ...process.env, PSModulePath: `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\Modules;${process.env.ProgramFiles}\\WindowsPowerShell\\Modules` };
  try {
    return (await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { env: environment, windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
  } catch (error) {
    throw new Error('Windows 检查失败：' + (error.stderr || error.code || 'unknown error').slice(0,1800));
  }
}
export const psQuote = value => "'" + value.replaceAll("'", "''") + "'";
export async function appProcesses() {
  const raw = await powershell(`$p=@(Get-CimInstance Win32_Process -Filter "Name='github.exe'" | Select-Object ProcessId,ExecutablePath); ConvertTo-Json -InputObject $p -Compress`);
  return JSON.parse(raw || '[]');
}
export async function inspectExe(path, {includeHash=true}={}) {
  return JSON.parse(await powershell(`$f=Get-Item -LiteralPath ${psQuote(path)}; $s=Get-AuthenticodeSignature -LiteralPath $f.FullName; @{path=$f.FullName;version=$f.VersionInfo.ProductVersion;signature=[string]$s.Status;signer=$s.SignerCertificate.Subject;hash=${includeHash?'(Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash':'$null'}} | ConvertTo-Json -Compress`));
}
export async function hashExe(path) {
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path))hash.update(chunk);
  return hash.digest('hex').toUpperCase();
}
export async function validateEndpoint(port, appPath) {
  const raw = await powershell(`$lines=@(netstat -ano -p tcp); $listeners=@(); foreach($line in $lines){$v=$line.Trim() -split '\\s+'; if($v.Length -ge 5 -and $v[0] -eq 'TCP' -and $v[1] -match ':${port}$' -and $v[3] -eq 'LISTENING'){$listeners+=@{address=$v[1];pid=[int]$v[4]}}}; $processes=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath); @{listeners=$listeners;processes=$processes} | ConvertTo-Json -Depth 4 -Compress`);
  const { listeners, processes } = JSON.parse(raw);
  if (!listeners.length || listeners.some(l => ![`127.0.0.1:${port}`, `[::1]:${port}`].includes(l.address))) throw new Error('调试端口不是仅回环监听，已停止连接。');
  const byId = new Map(processes.map(p => [p.ProcessId, p]));
  for (const listener of listeners) {
    let process = byId.get(listener.pid), matched = false;
    if (process?.Name?.toLowerCase() !== 'msedgewebview2.exe') throw new Error('调试端口不属于 WebView2。');
    for (let i = 0; process && i < 8; i++) {
      if (process.ExecutablePath?.toLowerCase() === appPath.toLowerCase()) { matched = true; break; }
      process = byId.get(process.ParentProcessId);
    }
    if (!matched) throw new Error('调试端口不属于指定的 GitHub Copilot 进程。');
  }
  return listeners.map(l => l.address);
}
export async function notify(message) {
  await powershell(`Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(${psQuote(message)}, 'GitHub Copilot 中文界面') | Out-Null`).catch(() => {});
}
