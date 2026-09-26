# Internal helpers; normal users only need uninstall.cmd.
function Read-CopilotUninstallJson {
    param([string]$Path)
    if (Test-Path -LiteralPath $Path) {
        try { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
        catch { throw "Cannot read local state: $Path. No shortcuts were removed. Restore the file before retrying uninstall.cmd." }
    }
    return $null
}

function Test-CopilotUninstallProcess {
    param($ProcessId)
    $number = 0
    if (-not [int]::TryParse([string]$ProcessId, [ref]$number) -or $number -le 0) {
        throw 'Invalid companion process ID. No shortcuts were removed.'
    }
    return $null -ne (Get-Process -Id $number -ErrorAction SilentlyContinue)
}

function Stop-CopilotForUninstall {
    param([string]$Root)
    $local = Join-Path $Root '.local'
    $statePath = Join-Path $local 'state.json'
    $lock = Join-Path $local 'launcher.lock'
    $state = Read-CopilotUninstallJson $statePath
    $owner = Read-CopilotUninstallJson (Join-Path $lock 'owner.json')
    # A starting companion may not have published its state yet. Never report
    # success and remove its entry points while shutdown cannot be confirmed.
    if ((Test-Path -LiteralPath $lock) -and -not $owner) {
        throw 'Companion startup state is not ready. Wait for startup to finish, then retry uninstall.cmd. No shortcuts were removed.'
    }
    $active = $state -and $state.active -and (Test-CopilotUninstallProcess $state.pid)
    $liveOwner = $owner -and (Test-CopilotUninstallProcess $owner.pid)
    if ($liveOwner -and (-not $active -or $owner.pid -ne $state.pid)) {
        throw 'Companion is starting or cleaning up. Retry uninstall.cmd after it finishes. No shortcuts were removed.'
    }
    # Never installed, already stopped, or a stale state after a reboot: no
    # Node/runtime.json dependency and no new local files are needed.
    if (-not $active) { return }
    try { $runtime = Get-InstallNodeRuntime -Root $Root }
    catch {
        throw 'Cannot find Node.js 22+ to stop the active overlay. Quit Copilot normally with Ctrl+Q, then retry uninstall.cmd after the companion exits. No shortcuts were removed.'
    }
    & $runtime.path (Join-Path $Root 'src\launcher.mjs') --stop
    if ($LASTEXITCODE -ne 0) {
        throw 'Stop failed. Quit Copilot normally, then retry uninstall.cmd. No shortcuts were removed.'
    }
    $remaining = Read-CopilotUninstallJson $statePath
    if ($remaining -and $remaining.active -and (Test-CopilotUninstallProcess $remaining.pid)) {
        throw 'Companion shutdown was not confirmed. No shortcuts were removed; retry uninstall.cmd after it stops.'
    }
}

function Remove-CopilotShortcuts {
    param(
        [string]$Root,
        [string]$Desktop = [Environment]::GetFolderPath('Desktop'),
        [string]$Programs = [Environment]::GetFolderPath('Programs')
    )
    if (-not $Desktop -or -not $Programs) { throw 'The current user desktop/start-menu folders are unavailable.' }
    $Root = [IO.Path]::GetFullPath($Root)
    $allowedFolders = @([IO.Path]::GetFullPath($Desktop), [IO.Path]::GetFullPath($Programs))
    $local = Join-Path $Root '.local'
    $installationId = ''
    $idPath = Join-Path $local 'installation-id'
    if (Test-Path -LiteralPath $idPath) {
        $installationId = (Get-Content -LiteralPath $idPath -Raw).Trim()
        if ($installationId -notmatch '^[0-9a-f]{32}$') { throw 'Invalid installation ID. No shortcuts were removed.' }
    }
    $title = 'GitHub Copilot ' + [char]0x4E2D + [char]0x6587
    $stopTitle = [char]0x505C + [string][char]0x7528 + [char]0x6C49 + [char]0x5316 + ' - GitHub Copilot'
    # Fixed names also recover an interrupted install with no shortcut manifest.
    $paths = @(
        (Join-Path $Desktop "$title.lnk"),
        (Join-Path $Programs "$title.lnk"),
        (Join-Path $Programs "$stopTitle.lnk")
    )
    $manifest = Join-Path $local 'shortcuts.json'
    if (Test-Path -LiteralPath $manifest) {
        $links = Read-CopilotUninstallJson $manifest
        if ($null -eq $links) { throw 'Invalid shortcut manifest. No shortcuts were removed.' }
        # Validate the entire manifest before deleting even the first link.
        foreach ($path in $links) {
            if ($path -isnot [string] -or -not [IO.Path]::IsPathRooted($path)) { throw 'Invalid shortcut manifest path. No shortcuts were removed.' }
            $absolute = [IO.Path]::GetFullPath($path)
            if ([IO.Path]::GetDirectoryName($absolute) -notin $allowedFolders -or [IO.Path]::GetExtension($absolute) -ne '.lnk') {
                throw 'Invalid shortcut manifest path. No shortcuts were removed.'
            }
            $paths += $absolute
        }
    }
    $shell = New-Object -ComObject WScript.Shell
    try {
        foreach ($path in @($paths | Select-Object -Unique)) {
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
            $link = $shell.CreateShortcut($path)
            if (Test-CopilotShortcutOwned $link $Root $installationId) {
                Remove-Item -LiteralPath $path
                Write-Output $path
            } else { Write-Warning "Kept shortcut belonging to another installation or tool: $path" }
        }
    } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
}
