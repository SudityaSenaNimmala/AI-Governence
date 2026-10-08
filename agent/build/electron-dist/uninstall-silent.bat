@echo off
REM Silent uninstall for Intune/SCCM/GPO.

set "INSTALL_DIR=C:\Program Files\CloudFuze\AI Governance"

REM -- Stop agent --
taskkill /IM "CloudFuze AI Governance.exe" /F >nul 2>&1
timeout /t 3 /nobreak >nul 2>&1

REM -- Remove scheduled task --
schtasks /Delete /TN "CloudFuzeAIGovernance" /F >nul 2>&1

REM -- Remove install directory --
if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%" >nul 2>&1

REM -- Clean up all user profiles --
powershell -NoProfile -Command ^
  "Get-CimInstance Win32_UserProfile | Where-Object { -not $_.Special } | ForEach-Object {" ^
  "  $dir = Join-Path $_.LocalPath '.cloudfuze-aigov';" ^
  "  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue }" ^
  "};" ^
  "reg delete 'HKCU\Software\Classes\AppUserModelId\CloudFuze.AIGovernance' /f 2>$null;" >nul 2>&1

exit /b 0
