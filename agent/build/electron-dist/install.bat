@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  CloudFuze AI Governance — Silent Installer
REM  Intune / SCCM / GPO / manual. Exits with exit /b 0.
REM ============================================================

set "INSTALL_DIR=C:\Program Files\CloudFuze\AI Governance"
set "SOURCE_DIR=%~dp0win-unpacked"

REM -- Verify source --
if not exist "%SOURCE_DIR%\CloudFuze AI Governance.exe" exit /b 1

REM -- Stop running agent and its child processes --
taskkill /IM "CloudFuze AI Governance.exe" /F >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'monitor-runner|enforcer-watchdog' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -match 'enforcer-win' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 3 /nobreak >nul 2>&1

REM -- Remove old scheduled task --
schtasks /Delete /TN "CloudFuzeAIGovernance" /F >nul 2>&1

REM -- Copy to permanent location --
if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%" >nul 2>&1
timeout /t 1 /nobreak >nul 2>&1
REM -- Retry rmdir if dir survived (AV lock, slow handle release) --
if exist "%INSTALL_DIR%" (
    timeout /t 2 /nobreak >nul 2>&1
    rmdir /s /q "%INSTALL_DIR%" >nul 2>&1
)
if exist "%INSTALL_DIR%" exit /b 1
mkdir "%INSTALL_DIR%" >nul 2>&1
xcopy "%SOURCE_DIR%\*" "%INSTALL_DIR%\" /E /I /H /Y /Q >nul 2>&1
if errorlevel 1 exit /b 1

REM -- Configure: create scheduled task, write settings, start agent --
REM -- Uses a .ps1 file to avoid batch-to-PowerShell escaping issues --
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0configure.ps1"
if errorlevel 1 exit /b 1

exit /b 0
