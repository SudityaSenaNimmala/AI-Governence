@echo off
REM CloudFuze AI-Governance — one-click silent install (all users on this PC).
REM Double-click this. It asks for admin once (UAC), then installs with no window
REM and starts tracking for every user at logon. Nothing else to do.

setlocal
cd /d "%~dp0"

REM Already elevated? If not, relaunch this script elevated via UAC and exit.
net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo Requesting administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo Installing CloudFuze Claude Usage Tracker for all users...
"%~dp0CloudFuzeClaudeTracker.exe" --install-system
set RC=%errorlevel%
echo.
if "%RC%"=="0" (
  echo Done. Tracking is installed and will start for every user at logon.
) else (
  echo Install FAILED with code %RC%. Send this window's text to IT.
)
echo.
pause
endlocal
