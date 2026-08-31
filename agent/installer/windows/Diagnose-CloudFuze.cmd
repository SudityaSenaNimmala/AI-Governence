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

REM PROBES ALL FIVE PORTS, not just 19532. The beacon falls through to 19533+ when
REM something already holds 19532 — which on a machine that was in the pilot is an
REM old per-user tracker. Checking only 19532 reported 'NOT responding' in exactly
REM that case: the beacon was fine, and the real fault (a squatter defining this
REM machine's identity) went unseen. The extension takes the FIRST port that answers,
REM so which port replies is the diagnosis, not a detail.
echo [4] Identity beacon - 'user' must be the CORPORATE EMAIL, not the OS account name
powershell -NoProfile -Command "$ok=0; foreach ($p in 19532..19536) { try { $c=(Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 ('http://127.0.0.1:'+$p+'/cfai/identity')).Content; if ($ok -eq 0 -and $p -ne 19532) { Write-Output '   WARNING: 19532 is held by something else. The extension takes the FIRST port that answers, so that other process defines this machine identity - check [1] for a stale per-user install.' }; $ok=1; Write-Output ('   port '+$p+': '+$c) } catch { Write-Output ('   port '+$p+': no answer') } }; if ($ok -eq 0) { Write-Output '   beacon NOT responding on any port 19532-19536' }"
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
