import { existsSync } from 'node:fs';
import { win32 as path } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appProcesses, inspectExe, powershell, psQuote } from './windows.mjs';

// Normalize only paths, never commands (in particular, never execute an
// uninstall string or a shortcut's arguments). Accept an EXE or its directory.
export function appCandidatePath(value, env = process.env) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const variables = new Map(Object.entries(env).map(([key, value]) => [key.toLowerCase(), value]));
  let candidate = value.trim().replace(/%([^%]+)%/g, (match, key) => variables.get(key.toLowerCase()) ?? match);
  candidate = candidate.replace(/,\s*-?\d+\s*$/, '').replace(/^"(.*)"$/, '$1');
  if (!path.isAbsolute(candidate)) return null;
  if (!/\.exe$/i.test(candidate)) candidate = path.join(candidate, 'github.exe');
  if (path.basename(candidate).toLowerCase() !== 'github.exe') return null;
  return path.normalize(candidate);
}

export function commonAppCandidates(env = process.env) {
  return [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'GitHub Copilot', 'github.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'GitHub Copilot', 'github.exe'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'GitHub Copilot', 'github.exe'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'GitHub Copilot', 'github.exe'),
  ].filter(Boolean).map(value => ({ path: value, source: 'common-directory' }));
}

export async function registeredAppCandidates() {
  const raw = await powershell(`
    $found = @()
    $roots = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKCU:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')
    foreach ($entry in @(Get-ItemProperty $roots -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'GitHub Copilot' })) {
      foreach ($value in @($entry.InstallLocation, $entry.DisplayIcon)) {
        if ($value) { $found += @{path=[string]$value; source='uninstall-registry'} }
      }
    }
    foreach ($hive in @('HKCU:', 'HKLM:')) {
      foreach ($key in @('Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\github.exe',
        'Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\github.exe')) {
        $entry = Get-Item -LiteralPath ($hive + '\\' + $key) -ErrorAction SilentlyContinue
        if ($entry) {
          $value = $entry.GetValue('')
          if ($value) { $found += @{path=[string]$value; source='app-paths-registry'} }
        }
      }
    }
    try {
      . ${psQuote(fileURLToPath(new URL('./install-support.ps1', import.meta.url)))}
      foreach ($name in @('Desktop', 'CommonDesktopDirectory', 'Programs', 'CommonPrograms')) {
        $folder = [Environment]::GetFolderPath($name)
        if (-not $folder -or -not (Test-Path -LiteralPath $folder)) { continue }
        foreach ($file in @(Get-ChildItem -LiteralPath $folder -Filter '*Copilot*.lnk' -File -Recurse -ErrorAction SilentlyContinue)) {
          try {
            $link = Get-CopilotShortcut $file.FullName
            if ($link.TargetPath) { $found += @{path=[string]$link.TargetPath; source='shortcut'} }
          } catch { }
        }
      }
    } catch { }
    ConvertTo-Json -InputObject @($found) -Depth 3 -Compress
  `);
  return JSON.parse(raw || '[]');
}

// Shared by the installer and launcher. Dependency injection keeps discovery
// tests isolated from the user's registry, running applications and shortcuts.
export async function findApp({
  appPath, config = {}, processes, env = process.env,
  exists = existsSync, inspect = value => inspectExe(value, { includeHash: false }),
  running = appProcesses, registered = registeredAppCandidates,
} = {}) {
  const seen = new Set();
  const failures = [];
  async function check(candidate, required = false) {
    const value = appCandidatePath(candidate.path, env);
    if (!value || !exists(value)) {
      if (required) throw new Error('指定的 GitHub Copilot 路径不存在或不是 github.exe：' + candidate.path);
      return null;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    try {
      const info = await inspect(value);
      if (info.signature !== 'Valid' || !/GitHub, Inc\./i.test(info.signer || '')) {
        throw new Error('应用不是具有有效 GitHub 签名的原版程序：' + value);
      }
      return { ...info, path: info.path || value, source: candidate.source };
    } catch (error) {
      if (required) throw error;
      failures.push(error.message);
      return null;
    }
  }
  // An explicit override must fail clearly rather than silently picking a
  // different app. A stale saved setting, however, must not block migration.
  if (appPath !== undefined) return check({ path: appPath, source: 'argument' }, true);
  const configured = await check({ path: config.appPath, source: 'config' });
  if (configured) return configured;
  let active = [];
  try { active = await (processes ?? running()); } catch (error) { failures.push(error.message); }
  for (const candidate of [
    ...active.map(process => ({ path: process.ExecutablePath, source: 'running-process' })),
    ...commonAppCandidates(env),
  ]) {
    const info = await check(candidate);
    if (info) return info;
  }
  let installed = [];
  try { installed = await registered(); } catch (error) { failures.push(error.message); }
  for (const candidate of installed) {
    const info = await check(candidate);
    if (info) return info;
  }
  const detail = failures.length ? '\n检查详情：' + failures.join('\n') : '';
  throw new Error('未找到有效的 GitHub Copilot。请先安装原版应用；自定义位置可用 install.ps1 -AppPath 指定 github.exe 或安装目录。' + detail);
}
