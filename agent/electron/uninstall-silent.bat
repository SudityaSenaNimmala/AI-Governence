@echo off
REM Silent uninstall for Intune/SCCM/GPO deployment.
REM No prompts, no pauses. Removes everything including agent data.

taskkill /IM "CloudFuze AI Governance.exe" /F >nul 2>&1
timeout /t 2 /nobreak >nul 2>&1
schtasks /Delete /TN "CloudFuzeAIGovernance" /F >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v CloudFuzeAIGovernance /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v CloudFuzeAgent /f >nul 2>&1
reg delete "HKCU\Software\Classes\AppUserModelId\CloudFuze.AIGovernance" /f >nul 2>&1
if exist "%USERPROFILE%\.cloudfuze-aigov" rmdir /s /q "%USERPROFILE%\.cloudfuze-aigov" >nul 2>&1
if exist "%~dp0win-unpacked" rmdir /s /q "%~dp0win-unpacked" >nul 2>&1
exit /b 0
