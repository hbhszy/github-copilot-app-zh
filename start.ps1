param([switch]$Stop, [switch]$Console)
$ErrorActionPreference = 'Stop'
try {
    if (-not $Console) {
        $bootstrap = Join-Path $PSScriptRoot '.local\CopilotZh.exe'
        if (-not (Test-Path -LiteralPath $bootstrap)) { throw 'Run install.ps1 to build the windowless entry point, or use -Console for diagnostics.' }
        $start = [System.Diagnostics.ProcessStartInfo]::new()
        $start.FileName = $bootstrap
        $start.UseShellExecute = $true
        if ($Stop) { $start.Arguments = '--stop' }
        [System.Diagnostics.Process]::Start($start).Dispose()
        exit 0
    }
    $runtimePath = Join-Path $PSScriptRoot '.local\runtime.json'
    $nodePath = $null
    if (Test-Path -LiteralPath $runtimePath) {
        $runtime = Get-Content -LiteralPath $runtimePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if (Test-Path -LiteralPath $runtime.node) { $nodePath = $runtime.node }
    }
    if (-not $nodePath) { $nodePath = (Get-Command node.exe -ErrorAction Stop).Source }
    $launchArgs = @((Join-Path $PSScriptRoot 'src\launcher.mjs'))
    if ($Stop) { $launchArgs += '--stop' }
    & $nodePath @launchArgs
    exit $LASTEXITCODE
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Unable to start Copilot Chinese UI. Install Node.js 22 or newer and run install.ps1.`n$($_.Exception.Message)", 'Copilot Chinese UI') | Out-Null
    exit 1
}
