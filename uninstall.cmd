@echo off
setlocal DisableDelayedExpansion
rem RemoteSigned applies only to this process and does not override Group Policy.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0uninstall.ps1" %*
set "result=%ERRORLEVEL%"
echo.
if not "%result%"=="0" echo Uninstall failed. Review the error above, fix it, and run uninstall.cmd again.
pause
exit /b %result%
