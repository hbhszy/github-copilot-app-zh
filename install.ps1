param([string]$AppPath, [switch]$PrepareTranslator)
$ErrorActionPreference = 'Stop'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$nodeVersion = (& $nodePath --version).Trim()
if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 22) { throw 'Node.js 22 or newer is required.' }
$localDir = Join-Path $PSScriptRoot '.local'
New-Item -ItemType Directory -Path $localDir -Force | Out-Null
@{ node = $nodePath } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $localDir 'runtime.json') -Encoding UTF8
if ($AppPath) {
    $resolvedApp = (Resolve-Path -LiteralPath $AppPath).Path
    $configPath = Join-Path $PSScriptRoot 'config.json'
    $config = if (Test-Path -LiteralPath $configPath) { Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { [pscustomobject]@{} }
    $config | Add-Member -NotePropertyName appPath -NotePropertyValue $resolvedApp -Force
    $config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8
}
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$programs = [Environment]::GetFolderPath('Programs')
$title = 'GitHub Copilot ' + [char]0x4E2D + [char]0x6587
$stopTitle = [char]0x505C + [string][char]0x7528 + [char]0x6C49 + [char]0x5316 + ' - GitHub Copilot'
$startScript = Join-Path $PSScriptRoot 'start.ps1'
$bootstrap = Join-Path $localDir 'CopilotZh.exe'
$bootstrapSource = Join-Path $PSScriptRoot 'src\bootstrap.cs'
$sha = [Security.Cryptography.SHA256]::Create()
try { $sourceHash = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($bootstrapSource))).Replace('-', '') }
finally { $sha.Dispose() }
$hashPath = Join-Path $localDir 'bootstrap-source.sha256'
if (-not (Test-Path -LiteralPath $bootstrap) -or -not (Test-Path -LiteralPath $hashPath) -or (Get-Content -LiteralPath $hashPath -Raw).Trim() -ne $sourceHash) {
    $temporary = Join-Path $localDir ('CopilotZh-' + [guid]::NewGuid().ToString('N') + '.exe')
    try {
        Add-Type -Path $bootstrapSource -OutputAssembly $temporary -OutputType WindowsApplication -ReferencedAssemblies System.dll,System.Web.Extensions.dll,System.Windows.Forms.dll
        Move-Item -LiteralPath $temporary -Destination $bootstrap -Force
        Set-Content -LiteralPath $hashPath -Value $sourceHash -Encoding ASCII
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
}
function Test-OwnedShortcut($shortcut) {
    return ($shortcut.TargetPath -eq $bootstrap) -or ($shortcut.Arguments.Contains($startScript))
}
$iconPath = if ($AppPath) { $resolvedApp } else { $nodePath }
$created = @()
foreach ($folder in @($desktop, $programs)) {
    $linkPath = Join-Path $folder "$title.lnk"
    if (Test-Path -LiteralPath $linkPath) {
        $existing = $shell.CreateShortcut($linkPath)
        if (-not (Test-OwnedShortcut $existing)) { throw "Shortcut belongs to another installation: $linkPath" }
    }
    $link = $shell.CreateShortcut($linkPath)
    $link.TargetPath = $bootstrap
    $link.Arguments = ''
    $link.WorkingDirectory = $PSScriptRoot
    $link.IconLocation = "$iconPath,0"
    $link.Description = 'Local Chinese UI overlay; original GitHub Copilot installation stays unchanged.'
    $link.Save()
    $created += $linkPath
}
$stopPath = Join-Path $programs "$stopTitle.lnk"
if (Test-Path -LiteralPath $stopPath) {
    if (-not (Test-OwnedShortcut ($shell.CreateShortcut($stopPath)))) { throw "Shortcut belongs to another installation: $stopPath" }
}
$link = $shell.CreateShortcut($stopPath)
$link.TargetPath = $bootstrap
$link.Arguments = '--stop'
$link.WorkingDirectory = $PSScriptRoot
$link.IconLocation = "$iconPath,0"
$link.Save()
$created += $stopPath
$created | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $localDir 'shortcuts.json') -Encoding UTF8
Write-Output "Installed with $nodeVersion. Original shortcuts were not modified."
$created
if ($PrepareTranslator) {
    & $nodePath (Join-Path $PSScriptRoot 'tools\setup-translator.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Translator setup failed. Dictionary mode still works; retry npm run setup:translator after stopping the Chinese launcher.' }
}
