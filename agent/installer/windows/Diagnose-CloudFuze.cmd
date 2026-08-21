@echo off
REM CloudFuze AI-Governance — diagnostics. Run this on the machine under test and
REM send the whole window's text back. It checks the install, the task, the log,
REM the identity beacon, and whether the server is reachable.

setlocal
cd /d "%~dp0"
echo ============================================================
echo  CloudFuze diagnostics  -  %DATE% %TIME%
echo  Computer: %COMPUTERNAME%   User: %USERNAME%
echo ============================================================
echo.

echo [1] Tracker --status
"%~dp0CloudFuzeClaudeTracker.exe" --status
echo.

echo [2] Is the process running?
tasklist /FI "IMAGENAME eq CloudFuzeClaudeTracker.exe"
echo.

echo [3] Scheduled task (all-users logon)
schtasks /Query /TN "CloudFuze\ClaudeTracker" /V /FO LIST 2>&1 | findstr /I "TaskName Status Run Author Logon Next Last"
echo.

echo [4] Identity beacon (should return JSON with hostname/user)
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 http://127.0.0.1:19532/cfai/identity).Content } catch { 'beacon NOT responding: ' + $_.Exception.Message }"
echo.

echo [5] Last 15 log lines
if exist "%ProgramData%\CloudFuze\ClaudeTracker\tracker.log" (
  powershell -NoProfile -Command "Get-Content '%ProgramData%\CloudFuze\ClaudeTracker\tracker.log' -Tail 15"
) else (
  echo    no tracker.log at %ProgramData%\CloudFuze\ClaudeTracker
)
echo.

echo [6] Can this PC reach the governance server?
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 https://agentgovernence.cftools.live/api/v1/health; 'server OK: ' + $r.Content } catch { 'server UNREACHABLE: ' + $_.Exception.Message }"
echo.

echo ============================================================
echo  Done. Copy everything above and send it back.
echo ============================================================
pause
endlocal
