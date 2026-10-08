@echo off
REM Silent uninstall for Intune/SCCM/GPO deployment.
REM No prompts, no pauses. Removes everything.

set "INSTALL_DIR=C:\Program Files\CloudFuze\AI Governance"
set "TASK_NAME=CloudFuzeAIGovernance"

REM -- Stop the agent --
taskkill /IM "CloudFuze AI Governance.exe" /F >nul 2>&1
timeout /t 3 /nobreak >nul 2>&1

REM -- Remove scheduled task --
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1

REM -- Remove registry entries --
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v CloudFuzeAIGovernance /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v CloudFuzeAgent /f >nul 2>&1
reg delete "HKCU\Software\Classes\AppUserModelId\CloudFuze.AIGovernance" /f >nul 2>&1

REM -- Remove agent data --
if exist "%USERPROFILE%\.cloudfuze-aigov" rmdir /s /q "%USERPROFILE%\.cloudfuze-aigov" >nul 2>&1

REM -- Remove install directory --
if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%" >nul 2>&1

exit /b 0
