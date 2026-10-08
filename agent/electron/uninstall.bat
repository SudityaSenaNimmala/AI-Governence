@echo off
setlocal enabledelayedexpansion

echo.
echo  ============================================
echo     CloudFuze Desktop Agent - Uninstall
echo  ============================================
echo.

REM -- Stop the running agent and its child processes --
echo  [..] Stopping agent...
taskkill /IM "CloudFuze AI Governance.exe" /F >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'monitor-runner|enforcer-watchdog' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -match 'enforcer-win' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

REM -- Wait for processes to exit --
timeout /t 5 /nobreak >nul 2>&1

REM -- Remove auto-start entries --
echo  [..] Removing auto-start...
schtasks /Delete /TN "CloudFuzeAIGovernance" /F >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v CloudFuzeAIGovernance /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v CloudFuzeAgent /f >nul 2>&1
echo  [OK] Auto-start removed

REM -- Remove monitor lock and pid files --
if exist "%USERPROFILE%\.cloudfuze-aigov\monitor.lock" del "%USERPROFILE%\.cloudfuze-aigov\monitor.lock" >nul 2>&1
if exist "%USERPROFILE%\.cloudfuze-aigov\enforcer.pid" del "%USERPROFILE%\.cloudfuze-aigov\enforcer.pid" >nul 2>&1
if exist "%USERPROFILE%\.cloudfuze-aigov\enforcer.parent" del "%USERPROFILE%\.cloudfuze-aigov\enforcer.parent" >nul 2>&1

REM -- Remove AUMID registration (toast attribution) --
reg delete "HKCU\Software\Classes\AppUserModelId\CloudFuze.AIGovernance" /f >nul 2>&1

REM -- Ask about data cleanup --
echo.
choice /C YN /M "  Remove agent data (credentials, settings, logs)? "
if errorlevel 2 goto SKIP_DATA
if errorlevel 1 (
    echo  [..] Removing agent data...
    if exist "%USERPROFILE%\.cloudfuze-aigov" rmdir /s /q "%USERPROFILE%\.cloudfuze-aigov" >nul 2>&1
    echo  [OK] Agent data removed
)
:SKIP_DATA

REM -- Remove app directories --
echo.
REM Remove the installed copy in Program Files
if exist "C:\Program Files\CloudFuze\AI Governance" (
    echo  [..] Removing installed application...
    rmdir /s /q "C:\Program Files\CloudFuze\AI Governance" >nul 2>&1
    rmdir "C:\Program Files\CloudFuze" >nul 2>&1
    echo  [OK] Installed application removed
)
REM Remove the source copy next to this script
set "APPDIR=%~dp0win-unpacked"
if exist "%APPDIR%" (
    echo  [..] Removing source application files...
    rmdir /s /q "%APPDIR%" >nul 2>&1
    echo  [OK] Source files removed
)

echo.
echo  ============================================
echo     Uninstall complete
echo  ============================================
echo.
echo  The CloudFuze AI Governance agent has been
echo  removed from this machine.
echo.
echo  Press any key to close this window...
pause >nul
exit
