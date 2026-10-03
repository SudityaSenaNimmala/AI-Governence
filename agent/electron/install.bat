@echo off
setlocal enabledelayedexpansion

echo.
echo  ============================================
echo     CloudFuze Desktop Agent - Install
echo  ============================================
echo.
echo  Please wait...

REM -- Find the exe --
set "APPDIR=%~dp0win-unpacked"
set "EXE=%APPDIR%\CloudFuze AI Governance.exe"
if not exist "%EXE%" (
    echo  [ERROR] CloudFuze AI Governance.exe not found!
    echo  Make sure you extracted the full zip.
    goto DONE
)
echo  [OK] Found application

REM -- Remove "Mark of the Web" so Windows stops showing security warnings --
REM    Files extracted from a downloaded zip are flagged as internet files.
REM    Unblock-File removes this flag so the exe starts silently on boot.
powershell -NoProfile -Command "Get-ChildItem -Path '%APPDIR%' -Recurse | Unblock-File -ErrorAction SilentlyContinue" >nul 2>&1
powershell -NoProfile -Command "Unblock-File -Path '%~f0' -ErrorAction SilentlyContinue" >nul 2>&1
echo  [OK] Security flags cleared

REM -- Stop old agent (both bare and electron) --
taskkill /IM "CloudFuze AI Governance.exe" /F >nul 2>&1
taskkill /IM node.exe /FI "WINDOWTITLE eq CloudFuze*" /F >nul 2>&1
if exist "%USERPROFILE%\.cloudfuze-aigov\monitor.lock" del "%USERPROFILE%\.cloudfuze-aigov\monitor.lock" >nul 2>&1

REM -- Remove old auto-start entries --
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v CloudFuzeAgent /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v CloudFuzeAIGovernance /f >nul 2>&1
schtasks /Delete /TN "CloudFuzeAIGovernance" /F >nul 2>&1

REM -- Create config directory --
if not exist "%USERPROFILE%\.cloudfuze-aigov" mkdir "%USERPROFILE%\.cloudfuze-aigov" >nul 2>&1

REM -- Read baked config (server URL + enroll secret) --
set "BAKED_CONFIG=%APPDIR%\resources\cfai-config.json"
set "SERVER_URL="
set "ENROLL_SECRET="
if exist "%BAKED_CONFIG%" (
    for /f "tokens=*" %%i in ('powershell -NoProfile -Command "(Get-Content '%BAKED_CONFIG%' | ConvertFrom-Json).serverUrl"') do set "SERVER_URL=%%i"
    for /f "tokens=*" %%i in ('powershell -NoProfile -Command "(Get-Content '%BAKED_CONFIG%' | ConvertFrom-Json).enrollSecret"') do set "ENROLL_SECRET=%%i"
)
if "%SERVER_URL%"=="" set "SERVER_URL=http://localhost:8787"

REM -- Delete old credentials if server URL changed (forces re-enrollment) --
set "OLD_URL="
if exist "%USERPROFILE%\.cloudfuze-aigov\credentials.json" (
    for /f "tokens=*" %%i in ('powershell -NoProfile -Command "try{(Get-Content '%USERPROFILE%\.cloudfuze-aigov\credentials.json' | ConvertFrom-Json).serverUrl}catch{}"') do set "OLD_URL=%%i"
)
if not "%OLD_URL%"=="" if not "%OLD_URL%"=="%SERVER_URL%" (
    echo  [..] Server URL changed from %OLD_URL% — re-enrolling...
    del "%USERPROFILE%\.cloudfuze-aigov\credentials.json" >nul 2>&1
    del "%USERPROFILE%\.cloudfuze-aigov\blocked-agents.json" >nul 2>&1
    del "%USERPROFILE%\.cloudfuze-aigov\agent-version" >nul 2>&1
)

REM -- Write Electron settings --
echo {"serverUrl":"%SERVER_URL%","enrollSecret":"%ENROLL_SECRET%","autoStart":true,"monitorClipboard":true,"monitorFileDialogs":true,"monitorTypedPrompts":true,"monitorAttachments":true,"monitorEnforcer":true,"startMonitorOnLaunch":true} > "%USERPROFILE%\.cloudfuze-aigov\electron-settings.json"
echo  [OK] Settings configured (%SERVER_URL%)

REM -- Enrollment happens automatically when the app starts with saved settings --
echo  [OK] Will auto-enroll on first launch

REM -- Auto-start via Task Scheduler + Registry (both for reliability) --
powershell -NoProfile -Command "schtasks /Create /TN 'CloudFuzeAIGovernance' /TR ('\"' + '%EXE%' + '\" --hidden') /SC ONLOGON /RL LIMITED /F" >nul 2>&1
powershell -NoProfile -Command "Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'CloudFuzeAIGovernance' -Value ('\"' + '%EXE%' + '\" --hidden') -ErrorAction SilentlyContinue" >nul 2>&1
echo  [OK] Auto-start registered

REM -- Start now (hidden) --
echo  [..] Starting agent...
powershell -NoProfile -Command "Start-Process -FilePath '%EXE%' -ArgumentList '--hidden'"

echo.
echo  ============================================
echo     Installation complete!
echo  ============================================
echo.
echo  The CloudFuze AI Governance agent is now
echo  running in the background (system tray).
echo  It will start automatically on boot.
echo.

:DONE
echo.
echo  Press any key to close this window...
pause >nul
exit
