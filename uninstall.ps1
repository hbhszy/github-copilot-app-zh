$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'src\install-support.ps1')
. (Join-Path $PSScriptRoot 'src\uninstall-support.ps1')
Write-Output '[1/2] Stopping the overlay companion...'
Stop-CopilotForUninstall -Root $PSScriptRoot
Write-Output '[2/2] Removing this installation''s desktop and Start menu shortcuts...'
Remove-CopilotShortcuts -Root $PSScriptRoot
Write-Output 'Uninstall complete. Owned shortcuts removed; project files, translation models and Copilot data retained.'
Write-Output 'Quit Copilot normally and reopen the original shortcut to close the debug port. You may then remove this project directory yourself.'
