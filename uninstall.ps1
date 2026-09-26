$ErrorActionPreference = 'Stop'
$runtime = Get-Content -LiteralPath (Join-Path $PSScriptRoot '.local\runtime.json') -Raw -Encoding UTF8 | ConvertFrom-Json
& $runtime.node (Join-Path $PSScriptRoot 'src\launcher.mjs') --stop
if ($LASTEXITCODE -ne 0) { throw 'Stop failed. Quit Copilot normally, then retry.' }
$shell = New-Object -ComObject WScript.Shell
$manifest = Join-Path $PSScriptRoot '.local\shortcuts.json'
$allowedFolders = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
if (Test-Path -LiteralPath $manifest) {
    $links = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($path in $links) {
        $absolute = [IO.Path]::GetFullPath($path)
        if ([IO.Path]::GetDirectoryName($absolute) -notin $allowedFolders -or [IO.Path]::GetExtension($absolute) -ne '.lnk') { throw 'Invalid shortcut manifest path.' }
        if (Test-Path -LiteralPath $absolute) {
            $link = $shell.CreateShortcut($absolute)
            if ($link.TargetPath -eq (Join-Path $PSScriptRoot '.local\CopilotZh.exe') -or $link.Arguments.Contains((Join-Path $PSScriptRoot 'start.ps1'))) { Remove-Item -LiteralPath $absolute }
        }
    }
}
Write-Output 'Overlay stopped and its shortcuts removed. Project files retained. Quit Copilot normally and reopen the original shortcut to close the debug port.'
