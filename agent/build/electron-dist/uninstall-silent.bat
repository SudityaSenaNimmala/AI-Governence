@echo off
REM Silent uninstall for Intune/SCCM/GPO.

REM -- Stop agent and its child processes --
taskkill /IM "CloudFuze AI Governance.exe" /F >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'monitor-runner|enforcer-watchdog' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -match 'enforcer-win' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 5 /nobreak >nul 2>&1

REM -- Remove scheduled task --
schtasks /Delete /TN "CloudFuzeAIGovernance" /F >nul 2>&1

REM -- Remove install directory --
if exist "C:\Program Files\CloudFuze\AI Governance" rmdir /s /q "C:\Program Files\CloudFuze\AI Governance" >nul 2>&1
if exist "C:\Program Files\CloudFuze" rmdir "C:\Program Files\CloudFuze" >nul 2>&1

REM -- Clean up all user profiles and registry entries --
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
 "Get-CimInstance Win32_UserProfile | Where-Object { -not $_.Special } | ForEach-Object {" ^
 "  $dir = Join-Path $_.LocalPath '.cloudfuze-aigov';" ^
 "  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue }" ^
 "};" ^
 "# Clean Run key entries from all user registry hives (legacy installs)" ^
 "Get-ChildItem 'Registry::HKEY_USERS' -ErrorAction SilentlyContinue | ForEach-Object {" ^
 "  $run = Join-Path $_.PSPath 'Software\\Microsoft\\Windows\\CurrentVersion\\Run';" ^
 "  if (Test-Path $run) {" ^
 "    Remove-ItemProperty -Path $run -Name 'CloudFuzeAIGovernance' -Force -ErrorAction SilentlyContinue;" ^
 "    Remove-ItemProperty -Path $run -Name 'CloudFuzeAgent' -Force -ErrorAction SilentlyContinue;" ^
 "  }" ^
 "  $aumid = Join-Path $_.PSPath 'Software\\Classes\\AppUserModelId\\CloudFuze.AIGovernance';" ^
 "  if (Test-Path $aumid) { Remove-Item $aumid -Force -ErrorAction SilentlyContinue }" ^
 "};"

exit /b 0
