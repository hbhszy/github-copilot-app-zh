import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('double-click entry uses its own directory and does not run a second manual startup step', async () => {
  const cmd = await readFile(new URL('../install.cmd', import.meta.url), 'utf8');
  assert.match(cmd, /-File "%~dp0install\.ps1" %\*/);
  assert.match(cmd, /-ExecutionPolicy RemoteSigned/);
  assert.doesNotMatch(cmd, /ExecutionPolicy Bypass|start\.ps1|npm install/i);
  assert.match(cmd, /exit \/b %result%/i);
});

test('Windows shortcut deployment is idempotent, preflights conflicts and repairs a moved installation', { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'copilot-zh-install 中文 🚀 & ')));
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const support = fileURLToPath(new URL('../src/install-support.ps1', import.meta.url));
  const script = `
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    . ${quote(support)}
    $root = ${quote(root)}
    $local = Join-Path $root '.local'
    New-Item -ItemType Directory -Path $local -Force | Out-Null
    $id = Get-CopilotInstallationId $local
    if ((Get-CopilotInstallationId $local) -ne $id) { throw 'Installation ID changed on reinstall' }
    $node = Get-InstallNodeRuntime -Root $root -Candidates @('Z:\\missing\\node.exe', ${quote(process.execPath)})
    if ($node.path -ne ${quote(process.execPath)}) { throw 'Node discovery failed' }
    $missingFailed = $false
    try { Get-InstallNodeRuntime -Root $root -Candidates @('Z:\\missing\\node.exe') | Out-Null } catch { $missingFailed = $true }
    if (-not $missingFailed) { throw 'Missing Node must fail clearly' }
    $options = @{ Root = $root; LocalDir = $local; AppPath = (Join-Path $root 'original app\\github.exe'); InstallationId = $id;
      Desktop = (Join-Path $root 'redirected desktop'); Programs = (Join-Path $root 'start menu') }
    Update-CopilotShortcuts @options -CheckOnly
    if (Test-Path -LiteralPath $options.Desktop) { throw 'Preflight created shortcuts' }
    $links = @(Update-CopilotShortcuts @options)
    if ($links.Count -ne 3) { throw 'Expected desktop start, menu start and menu stop shortcuts' }
    if (@(Update-CopilotShortcuts @options).Count -ne 3) { throw 'Reinstall failed' }
    & {
      foreach ($path in $links) {
        $link = Get-CopilotShortcut $path
        if ($link.TargetPath -ne (Join-Path $local 'CopilotZh.exe')) { throw 'Wrong shortcut target' }
        if ($link.WorkingDirectory -ne $root) { throw 'Wrong working directory' }
        if ($link.IconLocation -ne ($options.AppPath + ',0')) { throw 'Icon does not use the detected app' }
      }
      if ((Get-CopilotShortcut $links[2]).Arguments -ne '--stop') { throw 'Stop argument lost' }
      $original = [Convert]::ToBase64String([IO.File]::ReadAllBytes($links[0]))
      $foreign = Get-CopilotShortcut $links[2]
      $foreign.TargetPath = ${quote(process.execPath)}
      $foreign.Description = 'belongs to a different tool'
      $foreign.Save()
      $rejected = $false
      try { Update-CopilotShortcuts @options | Out-Null } catch { $rejected = $_.Exception.Message.Contains('another installation') }
      if (-not $rejected) { throw 'Foreign shortcut was not rejected' }
      if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($links[0])) -ne $original) { throw 'Preflight failure partially rewrote shortcuts' }
      if ((Get-CopilotShortcut $links[2]).TargetPath -ne ${quote(process.execPath)}) { throw 'Foreign target was overwritten' }
      # Restore only this isolated fixture, never a real desktop shortcut.
      $foreign.TargetPath = Join-Path $local 'CopilotZh.exe'
      $foreign.Save()
      Update-CopilotShortcuts @options | Out-Null
      $moved = Join-Path $root 'moved checkout'
      $movedLocal = Join-Path $moved '.local'
      New-Item -ItemType Directory -Path $movedLocal -Force | Out-Null
      Copy-Item -LiteralPath (Join-Path $local 'installation-id') -Destination $movedLocal
      $options.Root = $moved; $options.LocalDir = $movedLocal
      $options.InstallationId = Get-CopilotInstallationId $movedLocal
      Update-CopilotShortcuts @options | Out-Null
      if ((Get-CopilotShortcut $links[0]).TargetPath -ne (Join-Path $movedLocal 'CopilotZh.exe')) { throw 'Moved installation was not repaired' }
      $options.Root = Join-Path $root 'different checkout'; $options.InstallationId = [guid]::NewGuid().ToString('N')
      $rejected = $false
      try { Update-CopilotShortcuts @options -CheckOnly } catch { $rejected = $true }
      if (-not $rejected) { throw 'Different installation claimed another checkout' }
      $legacy = [pscustomobject]@{ TargetPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'; Arguments = '-NoProfile -File "' + (Join-Path $root 'start.ps1') + '"'; Description = '' }
      if (-not (Test-CopilotShortcutOwned $legacy $root '')) { throw 'Legacy link was not recognized' }
      $legacy.Arguments = $legacy.Arguments.Replace('start.ps1"', 'start.ps1.bak"')
      if (Test-CopilotShortcutOwned $legacy $root '') { throw 'Legacy substring falsely claimed an unrelated script' }
    }
    Write-InstallJson (Join-Path $local 'settings.json') @{ appPath = 'D:\\中文\\github.exe'; machineTranslation = @{ enabled = $false; idleSeconds = 300 }; custom = @{ keep = 'unchanged' } }
    @{ count = $links.Count; moved = $true; conflictsPreserved = $true; node = $node.version } | ConvertTo-Json -Compress
  `;
  try {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 50000, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(stdout.trim());
    assert.equal(result.count, 3);
    assert.equal(result.moved, true);
    assert.equal(result.conflictsPreserved, true);
    const config = JSON.parse(await readFile(join(root, '.local', 'settings.json'), 'utf8'));
    assert.equal(config.appPath, 'D:\\中文\\github.exe');
    assert.equal(config.machineTranslation.enabled, false);
    assert.equal(config.custom.keep, 'unchanged');
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test('native Unicode shortcuts round-trip all fields and read legacy links without changing them', { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'copilot-zh-shortcut 中文 🚀 & ')));
  const legacyRoot = await mkdtemp(join(tmpdir(), 'copilot-zh-legacy-'));
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const support = fileURLToPath(new URL('../src/install-support.ps1', import.meta.url));
  const script = `
    $ErrorActionPreference='Stop'
    . ${quote(support)}
    $root=${quote(root)}
    $path=Join-Path $root 'entry.lnk'
    $link=Get-CopilotShortcut $path
    if (Test-Path -LiteralPath $path) { throw 'Reading an absent link created a file' }
    $link.TargetPath=Join-Path $root 'missing app\\github.exe'
    $link.WorkingDirectory=$root
    $link.Arguments=${quote('--label "中文 🚀 & $value"')}
    $link.Description=${quote('快捷方式 🚀')}
    $link.IconLocation=(Join-Path $root 'icon, extra.dll') + ',-7'
    $link.Save()
    $bytes=[Convert]::ToBase64String([IO.File]::ReadAllBytes($path))
    $read=Get-CopilotShortcut $path
    foreach ($field in @('TargetPath','WorkingDirectory','Arguments','Description','IconLocation')) {
      if ($read.$field -cne $link.$field) { throw ('Unicode shortcut field changed: ' + $field) }
    }
    if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($path)) -ne $bytes) { throw 'Reading rewrote a shortcut' }
    $shell=New-Object -ComObject WScript.Shell
    try {
      # WScript cannot even save a link file below an emoji directory. Create
      # the legacy fixture in an ASCII path, then move it before native reading.
      $originalPath=${quote(join(legacyRoot, 'legacy.lnk'))}
      $old=$shell.CreateShortcut($originalPath)
      $old.TargetPath=${quote(process.execPath)}
      $old.Arguments='--legacy'; $old.Description='existing installation'; $old.Save()
      $oldPath=Join-Path $root 'legacy.lnk'
      Move-Item -LiteralPath $originalPath -Destination $oldPath
      $before=[Convert]::ToBase64String([IO.File]::ReadAllBytes($oldPath))
      $legacy=Get-CopilotShortcut $oldPath
      if ($legacy.TargetPath -ne ${quote(process.execPath)} -or $legacy.Arguments -ne '--legacy' -or $legacy.Description -ne 'existing installation') {
        throw 'Existing WScript shortcut was not read correctly'
      }
      if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($oldPath)) -ne $before) { throw 'Reading rewrote a legacy shortcut' }
    } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
  `;
  try {
    await promisify(execFile)('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 50000, maxBuffer: 1024 * 1024 });
  } finally {
    for (const path of [root, legacyRoot]) await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
