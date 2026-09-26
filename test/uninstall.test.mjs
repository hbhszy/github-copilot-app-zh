import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const windows = { skip: process.platform !== 'win32', timeout: 60000 };
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const installSupport = fileURLToPath(new URL('../src/install-support.ps1', import.meta.url));
const uninstallSupport = fileURLToPath(new URL('../src/uninstall-support.ps1', import.meta.url));
const runPS = script => promisify(execFile)('powershell.exe', [
  '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
  Buffer.from(`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); . ${quote(installSupport)}; . ${quote(uninstallSupport)};\n${script}`, 'utf16le').toString('base64'),
], { windowsHide: true, timeout: 45000, maxBuffer: 1024 * 1024 });
const fixture = async () => realpath(await mkdtemp(join(tmpdir(), "copilot-zh-uninstall 中文 🚀 & '! ")));
const clean = root => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

test('uninstall double-click entry is local, preserves errors and does not bypass system policy', async () => {
  const cmd = await readFile(new URL('../uninstall.cmd', import.meta.url), 'utf8');
  assert.match(cmd, /setlocal DisableDelayedExpansion/i);
  assert.match(cmd, /-File "%~dp0uninstall\.ps1" %\*/);
  assert.match(cmd, /-ExecutionPolicy RemoteSigned/);
  assert.match(cmd, /set "result=%ERRORLEVEL%"/i);
  assert.match(cmd, /pause[\r\n]+exit \/b %result%/i);
  assert.doesNotMatch(cmd, /ExecutionPolicy Bypass|taskkill|runas|rmdir|\bdel\b/i);
});

test('uninstall scripts parse in Windows PowerShell and cmd works from another directory with the original exit code', windows, async () => {
  const root = await fixture();
  try {
    const script = fileURLToPath(new URL('../uninstall.ps1', import.meta.url));
    await runPS(`
      foreach ($path in @(${quote(script)}, ${quote(uninstallSupport)})) {
        $tokens=$null; $errors=$null
        [void][Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
        if ($errors.Count) { throw ($errors | Out-String) }
      }
    `);
    const batch = join(root, 'uninstall.cmd');
    await copyFile(new URL('../uninstall.cmd', import.meta.url), batch);
    // Exercise the real batch wrapper with an isolated inert payload, never the
    // real uninstaller or the user's desktop/start-menu locations.
    for (const code of [0, 7]) {
      await writeFile(join(root, 'uninstall.ps1'), `[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'called.txt'), 'called'); exit ${code}\r\n`);
      // Pass the CMD command line verbatim; routing it through PowerShell's
      // native argument serializer adds another, incompatible quote layer.
      let result;
      try {
        result = { ...await promisify(execFile)(process.env.ComSpec, ['/d', '/v:off', '/s', '/c', `""${batch}" <nul"`], {
          cwd: process.env.SystemRoot, windowsHide: true, windowsVerbatimArguments: true, timeout: 15000,
        }), code: 0 };
      } catch (error) {
        if (typeof error.code !== 'number') throw error;
        result = error;
      }
      const { stdout, stderr } = result;
      assert.equal(result.code, code, stdout + '\n' + stderr);
      assert.equal(await readFile(join(root, 'called.txt'), 'utf8'), 'called');
      if (code) assert.match(stdout, /Uninstall failed/);
      else assert.doesNotMatch(stdout, /Uninstall failed/);
    }
  } finally { await clean(root); }
});

test('inactive or absent installation does not need Node or runtime.json; unconfirmed startup fails closed', windows, async () => {
  const root = await fixture();
  try {
    await runPS(`
      $root=${quote(root)}
      function Get-InstallNodeRuntime { throw 'Node must not be used for an inactive installation' }
      Stop-CopilotForUninstall $root
      if (Test-Path (Join-Path $root '.local')) { throw 'Never-installed uninstall created runtime data' }
      $local=Join-Path $root '.local'
      New-Item -ItemType Directory -Path $local | Out-Null
      [IO.File]::WriteAllText((Join-Path $local 'runtime.json'), 'broken old runtime')
      Write-InstallJson (Join-Path $local 'state.json') @{ active=$false; pid=$PID }
      Stop-CopilotForUninstall $root
      Stop-CopilotForUninstall $root
      Write-InstallJson (Join-Path $local 'state.json') @{ active=$true; pid=[int]::MaxValue }
      Stop-CopilotForUninstall $root
      Write-InstallJson (Join-Path $local 'state.json') @{ active=$false; pid=$PID }
      $lock=Join-Path $local 'launcher.lock'
      New-Item -ItemType Directory -Path $lock | Out-Null
      $rejected=$false
      try { Stop-CopilotForUninstall $root } catch { $rejected=$_.Exception.Message.Contains('not ready') }
      if (-not $rejected) { throw 'Unpublished startup lock was ignored' }
      Write-InstallJson (Join-Path $lock 'owner.json') @{ pid=$PID }
      $rejected=$false
      try { Stop-CopilotForUninstall $root } catch { $rejected=$_.Exception.Message.Contains('starting or cleaning up') }
      if (-not $rejected) { throw 'Live startup owner was ignored' }
      Write-InstallJson (Join-Path $local 'state.json') @{ active=$true; pid=$PID }
      $rejected=$false
      try { Stop-CopilotForUninstall $root } catch { $rejected=$_.Exception.Message.Contains('Cannot find Node.js') }
      if (-not $rejected) { throw 'Active overlay without Node was silently accepted' }
      Remove-Item -LiteralPath (Join-Path $lock 'owner.json')
      Remove-Item -LiteralPath $lock
      [IO.File]::WriteAllText((Join-Path $local 'state.json'), '{broken')
      $rejected=$false
      try { Stop-CopilotForUninstall $root } catch { $rejected=$_.Exception.Message.Contains('Cannot read local state') }
      if (-not $rejected) { throw 'Corrupt active state was silently ignored' }
    `);
  } finally { await clean(root); }
});

test('uninstall removes only owned shortcuts, repeats safely, retains data and supports missing manifests and moved roots', windows, async () => {
  const root = await fixture();
  try {
    await runPS(`
      $root=${quote(root)}; $local=Join-Path $root '.local'
      New-Item -ItemType Directory -Path $local | Out-Null
      $id=Get-CopilotInstallationId $local
      $options=@{ Root=$root; LocalDir=$local; AppPath=(Join-Path $root 'github.exe'); InstallationId=$id;
        Desktop=(Join-Path $root 'desktop'); Programs=(Join-Path $root 'programs') }
      $remove=@{ Root=$root; Desktop=$options.Desktop; Programs=$options.Programs }
      $links=@(Update-CopilotShortcuts @options)
      & {
        # Same title, but a different tool with a legacy-looking substring.
        $foreign=Get-CopilotShortcut $links[2]
        $foreign.TargetPath=Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'
        $foreign.Arguments='-File "' + (Join-Path $root 'start.ps1.bak') + '"'
        $foreign.Description='not this installation'; $foreign.Save()
        $before=[Convert]::ToBase64String([IO.File]::ReadAllBytes($links[2]))
        [IO.File]::WriteAllText((Join-Path $root 'config.json'), 'keep-config')
        [IO.File]::WriteAllText((Join-Path $local 'model.bin'), 'keep-model')
        $removed=@(Remove-CopilotShortcuts @remove 3>$null)
        if ($removed.Count -ne 2) { throw 'Expected only two owned links to be removed' }
        if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($links[2])) -ne $before) { throw 'Foreign shortcut changed' }
        if (@(Remove-CopilotShortcuts @remove 3>$null).Count -ne 0) { throw 'Repeated uninstall was not a no-op' }
        foreach ($path in @((Join-Path $root 'config.json'), (Join-Path $local 'model.bin'), (Join-Path $local 'installation-id'))) {
          if (-not (Test-Path -LiteralPath $path)) { throw 'Uninstall removed retained data' }
        }
        Remove-Item -LiteralPath $links[2]
        Update-CopilotShortcuts @options | Out-Null
        Remove-Item -LiteralPath (Join-Path $local 'shortcuts.json')
        if (@(Remove-CopilotShortcuts @remove).Count -ne 3) { throw 'Missing-manifest recovery failed' }
        Update-CopilotShortcuts @options | Out-Null
        $moved=Join-Path $root 'moved project'; $movedLocal=Join-Path $moved '.local'
        New-Item -ItemType Directory -Path $movedLocal -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $local 'installation-id') -Destination $movedLocal
        Copy-Item -LiteralPath (Join-Path $local 'shortcuts.json') -Destination $movedLocal
        $remove.Root=$moved
        if (@(Remove-CopilotShortcuts @remove).Count -ne 3) { throw 'Moved installation lost shortcut ownership' }
      }
    `);
    assert.equal(await readFile(join(root, 'config.json'), 'utf8'), 'keep-config');
    assert.equal(await readFile(join(root, '.local', 'model.bin'), 'utf8'), 'keep-model');
  } finally { await clean(root); }
});

test('invalid shortcut manifest is rejected before any owned link is removed', windows, async () => {
  const root = await fixture();
  try {
    await runPS(`
      $root=${quote(root)}; $local=Join-Path $root '.local'
      New-Item -ItemType Directory -Path $local | Out-Null
      $options=@{ Root=$root; LocalDir=$local; AppPath=(Join-Path $root 'github.exe'); InstallationId=(Get-CopilotInstallationId $local);
        Desktop=(Join-Path $root 'desktop'); Programs=(Join-Path $root 'programs') }
      $links=@(Update-CopilotShortcuts @options)
      $bad=@($links[0], (Join-Path $root 'outside.lnk'))
      Write-InstallJson (Join-Path $local 'shortcuts.json') $bad
      $rejected=$false
      try { Remove-CopilotShortcuts -Root $root -Desktop $options.Desktop -Programs $options.Programs | Out-Null }
      catch { $rejected=$_.Exception.Message.Contains('Invalid shortcut manifest path') }
      if (-not $rejected) { throw 'Invalid manifest accepted' }
      foreach ($link in $links) { if (-not (Test-Path -LiteralPath $link)) { throw 'Failure partially deleted shortcuts' } }
    `);
  } finally { await clean(root); }
});

for (const failStop of [false, true]) {
  test(`active companion uses rediscovered Node; ${failStop ? 'failed stop preserves shortcuts' : 'successful stop precedes shortcut removal'}`, windows, async () => {
    const root = await fixture();
    let child, exited;
    try {
      await mkdir(join(root, '.local', 'launcher.lock'), { recursive: true });
      await mkdir(join(root, 'src'));
      await writeFile(join(root, '.local', 'runtime.json'), JSON.stringify({ node: 'Z:\\missing-old-pc\\node.exe' }));
      const launcher = join(root, 'src', 'launcher.mjs');
      // This fixture only uses its temporary root. No real Copilot is involved.
      await writeFile(launcher, `
        import {existsSync,readFileSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
        import {fileURLToPath} from 'node:url';
        process.chdir(fileURLToPath(new URL('..',import.meta.url)));
        const state='.local/state.json', lock='.local/launcher.lock';
        if(process.argv.includes('--stop')) {
          writeFileSync('.local/stop-called','yes');
          if(${failStop}) process.exit(7);
          writeFileSync('.local/stop','stop');
          for(let i=0;i<100;i++) {
            if(!JSON.parse(readFileSync(state,'utf8')).active) process.exit(0);
            await new Promise(r=>setTimeout(r,25));
          }
          process.exit(8);
        }
        writeFileSync(lock+'/owner.json',JSON.stringify({pid:process.pid}));
        writeFileSync(state,JSON.stringify({pid:process.pid,active:true}));
        const timer=setInterval(()=>{
          if(!existsSync('.local/stop'))return;
          writeFileSync(state,JSON.stringify({pid:process.pid,active:false}));
          unlinkSync(lock+'/owner.json');rmdirSync(lock);clearInterval(timer);
        },25);
      `);
      child = spawn(process.execPath, [launcher], { cwd: root, windowsHide: true, stdio: 'ignore' });
      exited = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try { ready = JSON.parse(await readFile(join(root, '.local', 'state.json'), 'utf8')).active; } catch { }
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.equal(ready, true, 'Fixture failed to start');
      await runPS(`
        $root=${quote(root)}; $local=Join-Path $root '.local'
        $options=@{ Root=$root; LocalDir=$local; AppPath=(Join-Path $root 'github.exe'); InstallationId=(Get-CopilotInstallationId $local);
          Desktop=(Join-Path $root 'desktop'); Programs=(Join-Path $root 'programs') }
        $links=@(Update-CopilotShortcuts @options)
        $failed=$false
        try {
          Stop-CopilotForUninstall $root
          Remove-CopilotShortcuts -Root $root -Desktop $options.Desktop -Programs $options.Programs | Out-Null
        } catch { if (-not $_.Exception.Message.Contains('Stop failed')) { throw }; $failed=$true }
        if ($failed -ne $${failStop}) { throw 'Incorrect stop outcome' }
        foreach ($link in $links) {
          if ((Test-Path -LiteralPath $link) -ne $${failStop}) { throw 'Shortcut removal did not honor shutdown result' }
        }
      `);
      assert.equal(await readFile(join(root, '.local', 'stop-called'), 'utf8'), 'yes');
      if (!failStop) assert.equal(await exited, 0);
    } finally {
      if (child && child.exitCode === null) { child.kill(); await exited; }
      await clean(root);
    }
  });
}
