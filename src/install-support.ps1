# Internal installer helpers. Users only need the root install.cmd entry point.
function Write-InstallJson {
    param([string]$Path, $Value)
    $temporary = $Path + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllText($temporary, (ConvertTo-Json -InputObject $Value -Depth 100), [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $temporary -Destination $Path -Force
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}

function Get-InstallNodeRuntime {
    param([string]$Root, [string[]]$Candidates)
    if (-not $PSBoundParameters.ContainsKey('Candidates')) {
        $Candidates = @((Get-Command node.exe -CommandType Application -All -ErrorAction SilentlyContinue).Source)
        foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
            if ($base) { $Candidates += Join-Path $base 'nodejs\node.exe' }
        }
        if ($env:LOCALAPPDATA) { $Candidates += Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe' }
        foreach ($base in @($env:NVM_SYMLINK, $env:VOLTA_HOME)) {
            if ($base) {
                $Candidates += Join-Path $base 'node.exe'
                $Candidates += Join-Path $base 'bin\node.exe'
            }
        }
        if ($env:USERPROFILE) {
            foreach ($relative in @('scoop\apps\nodejs-lts\current\node.exe', 'scoop\apps\nodejs\current\node.exe', '.volta\bin\node.exe')) {
                $Candidates += Join-Path $env:USERPROFILE $relative
            }
        }
        $runtimePath = Join-Path $Root '.local\runtime.json'
        if (Test-Path -LiteralPath $runtimePath) {
            try { $Candidates += (Get-Content -LiteralPath $runtimePath -Raw -Encoding UTF8 | ConvertFrom-Json).node } catch { }
        }
    }
    foreach ($candidate in @($Candidates | Where-Object { $_ } | Select-Object -Unique)) {
        if (-not [IO.Path]::IsPathRooted($candidate) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        try {
            $version = (& $candidate --version 2>$null | Out-String).Trim()
            if ($LASTEXITCODE -eq 0 -and $version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 22) {
                return [pscustomobject]@{ path = $candidate; version = $version }
            }
        } catch { }
    }
    throw 'Node.js 22+ was not found. Install a supported Node.js LTS runtime, then double-click install.cmd again. No system software was installed.'
}

function Get-CopilotInstallationId {
    param([string]$LocalDir)
    $path = Join-Path $LocalDir 'installation-id'
    if (Test-Path -LiteralPath $path) {
        $id = (Get-Content -LiteralPath $path -Raw).Trim()
        if ($id -notmatch '^[0-9a-f]{32}$') { throw 'Invalid .local/installation-id. Restore the original file before repairing shortcuts.' }
        return $id
    }
    $id = [guid]::NewGuid().ToString('N')
    [IO.File]::WriteAllText($path, $id, [Text.Encoding]::ASCII)
    return $id
}

function Test-CopilotShortcutOwned {
    param($Shortcut, [string]$Root, [string]$InstallationId)
    $bootstrap = Join-Path $Root '.local\CopilotZh.exe'
    if ($Shortcut.TargetPath -eq $bootstrap) { return $true }
    # A stable ID allows repair after moving this same installation, without
    # claiming links belonging to a separate live checkout or another tool.
    if ($InstallationId -and $Shortcut.Description -eq "GitHub Copilot Chinese UI overlay [$InstallationId]") { return $true }
    $startScript = Join-Path $Root 'start.ps1'
    $legacyArguments = '(?:^|\s)-File\s+"' + [regex]::Escape($startScript) + '"(?:\s|$)'
    return $Shortcut.TargetPath -match '\\(?:powershell|pwsh)\.exe$' -and $Shortcut.Arguments -match $legacyArguments
}

function Update-CopilotShortcuts {
    param(
        [string]$Root, [string]$LocalDir, [string]$AppPath, [string]$InstallationId,
        [string]$Desktop = [Environment]::GetFolderPath('Desktop'),
        [string]$Programs = [Environment]::GetFolderPath('Programs'),
        [switch]$CheckOnly
    )
    if (-not $Desktop -or -not $Programs) { throw 'The current user desktop/start-menu folders are unavailable.' }
    $title = 'GitHub Copilot ' + [char]0x4E2D + [char]0x6587
    $stopTitle = [char]0x505C + [string][char]0x7528 + [char]0x6C49 + [char]0x5316 + ' - GitHub Copilot'
    $plan = @(
        [pscustomobject]@{ path = Join-Path $Desktop "$title.lnk"; arguments = '' },
        [pscustomobject]@{ path = Join-Path $Programs "$title.lnk"; arguments = '' },
        [pscustomobject]@{ path = Join-Path $Programs "$stopTitle.lnk"; arguments = '--stop' }
    )
    $shell = New-Object -ComObject WScript.Shell
    try {
        # Check the entire plan before changing even the first shortcut.
        foreach ($item in $plan) {
            if (Test-Path -LiteralPath $item.path) {
                $existing = $shell.CreateShortcut($item.path)
                if (-not (Test-CopilotShortcutOwned $existing $Root $InstallationId)) {
                    throw "Shortcut belongs to another installation: $($item.path). Rename or remove that shortcut yourself before retrying."
                }
            }
        }
        if ($CheckOnly) { return }
        foreach ($item in $plan) {
            New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($item.path)) -Force | Out-Null
            $link = $shell.CreateShortcut($item.path)
            $link.TargetPath = Join-Path $LocalDir 'CopilotZh.exe'
            $link.Arguments = $item.arguments
            $link.WorkingDirectory = $Root
            $link.IconLocation = "$AppPath,0"
            $link.Description = "GitHub Copilot Chinese UI overlay [$InstallationId]"
            $link.Save()
        }
        $created = @($plan | ForEach-Object { $_.path })
        Write-InstallJson (Join-Path $LocalDir 'shortcuts.json') $created
        return $created
    } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
}
