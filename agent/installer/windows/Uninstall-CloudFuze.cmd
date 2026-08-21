@echo off
REM CloudFuze AI-Governance — remove the all-users install from this PC.
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo Requesting administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo Removing CloudFuze Claude Usage Tracker...
"%~dp0CloudFuzeClaudeTracker.exe" --uninstall-system
echo.
echo Done. The logon task is removed. Files remain under %ProgramData%\CloudFuze.
echo.
pause
endlocal
