@echo off
setlocal DisableDelayedExpansion
rem RemoteSigned applies only to this process and does not override Group Policy.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0install.ps1" %*
set "result=%ERRORLEVEL%"
echo.
if not "%result%"=="0" echo Installation failed. Review the error above, fix it, and run install.cmd again.
pause
exit /b %result%
