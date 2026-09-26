param([string]$AppPath, [switch]$SkipTranslator, [switch]$PrepareTranslator)
$ErrorActionPreference = 'Stop'
# Windows PowerShell must decode the Node discovery JSON as UTF-8, including
# paths containing Chinese characters. Do not change the user's global policy.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
. (Join-Path $PSScriptRoot 'src\install-support.ps1')
if ($SkipTranslator -and $PrepareTranslator) { throw 'Use either -SkipTranslator or -PrepareTranslator, not both.' }
Write-Host '[1/4] Checking Node.js and discovering GitHub Copilot...'
$node = Get-InstallNodeRuntime -Root $PSScriptRoot
$nodePath = $node.path
$detectArgs = @((Join-Path $PSScriptRoot 'tools\detect-app.mjs'))
if ($PSBoundParameters.ContainsKey('AppPath')) {
    if (-not $AppPath) { throw '-AppPath must specify github.exe or its installation directory.' }
    $detectArgs += (Resolve-Path -LiteralPath $AppPath).Path
}
$detectedJson = & $nodePath @detectArgs
if ($LASTEXITCODE -ne 0) { throw 'GitHub Copilot discovery failed. No shortcuts were changed. See the diagnostic above.' }
$app = ($detectedJson | Out-String) | ConvertFrom-Json
if (-not $app.path) { throw 'Application discovery returned no path.' }
Write-Host "Copilot $($app.version): $($app.path) [$($app.source)]"
$configPath = Join-Path $PSScriptRoot 'config.json'
$config = if (Test-Path -LiteralPath $configPath) { Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { [pscustomobject]@{} }
$localDir = Join-Path $PSScriptRoot '.local'
New-Item -ItemType Directory -Path $localDir -Force | Out-Null
$installationId = Get-CopilotInstallationId -LocalDir $localDir
$shortcutOptions = @{ Root = $PSScriptRoot; LocalDir = $localDir; AppPath = $app.path; InstallationId = $installationId }
Update-CopilotShortcuts @shortcutOptions -CheckOnly
Write-Host '[2/4] Building the windowless launcher and saving local settings...'
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
$config | Add-Member -NotePropertyName appPath -NotePropertyValue $app.path -Force
Write-InstallJson $configPath $config
Write-InstallJson (Join-Path $localDir 'runtime.json') @{ node = $nodePath }
Write-Host '[3/4] Installing desktop and Start menu shortcuts...'
$created = @(Update-CopilotShortcuts @shortcutOptions)
$created
Write-Host '[4/4] Preparing optional local translation components...'
$translatorStatus = 'skipped'
if (-not $SkipTranslator -and ($config.machineTranslation.enabled -ne $false -or $PrepareTranslator)) {
    try {
        $setupArgs = @((Join-Path $PSScriptRoot 'tools\setup-translator.mjs'))
        if (-not $PrepareTranslator) { $setupArgs += '--if-needed' }
        & $nodePath @setupArgs
        if ($LASTEXITCODE -ne 0) { throw 'Translator preparation did not complete.' }
        $translatorStatus = 'ready'
    } catch {
        $translatorStatus = 'incomplete'
        Write-Warning 'Shortcuts are installed and dictionary mode is available, but automatic translation is not ready. Stop the Chinese overlay and run install.cmd again to retry. See the diagnostic above.'
    }
} else {
    Write-Host 'Translator preparation skipped; existing translation settings were preserved.'
}
Write-InstallJson (Join-Path $localDir 'install-result.json') @{
    installedAt = [DateTime]::UtcNow.ToString('o'); app = $app; node = $node
    shortcuts = $created; translator = $translatorStatus
}
Write-Host "Installation complete ($($node.version)); translator: $translatorStatus. Original app and shortcuts were not modified."
Write-Host 'Open the GitHub Copilot Chinese shortcut on your desktop. You do not need to run start.ps1.'
Write-Host 'If the original Copilot is running, save your work and quit it normally with Ctrl+Q before using the Chinese entry.'
# Optional translator failures are reported above and in install-result.json;
# they must not turn a usable dictionary-only installation into a failed one.
exit 0
