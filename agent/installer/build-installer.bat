@echo off
echo ============================================
echo   CloudFuze Agent — Building Installer
echo ============================================
echo.

REM Configuration — set these before building
if "%CLOUDFUZE_SERVER_URL%"=="" set CLOUDFUZE_SERVER_URL=http://localhost:8787
if "%CLOUDFUZE_ENROLL_SECRET%"=="" set CLOUDFUZE_ENROLL_SECRET=dev-enroll-secret-change-me

echo Server URL: %CLOUDFUZE_SERVER_URL%
echo Enroll Secret: %CLOUDFUZE_ENROLL_SECRET%
echo.

REM Create build staging directory
set BUILD_DIR=%~dp0build
if exist "%BUILD_DIR%" rmdir /s /q "%BUILD_DIR%"
mkdir "%BUILD_DIR%"
mkdir "%BUILD_DIR%\agent"
mkdir "%BUILD_DIR%\node"

echo [1/5] Copying agent source...
xcopy /s /e /q /y "%~dp0..\src" "%BUILD_DIR%\agent\src\" >nul
copy /y "%~dp0..\package.json" "%BUILD_DIR%\agent\" >nul
echo [OK] Agent source copied

echo [2/5] Downloading portable Node.js...
powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.15.0/node-v22.15.0-win-x64.zip' -OutFile '%BUILD_DIR%\node.zip'"
if not exist "%BUILD_DIR%\node.zip" (
  echo [ERROR] Failed to download Node.js
  pause
  exit /b 1
)
echo [OK] Node.js downloaded

echo [3/5] Extracting Node.js...
powershell -NoProfile -Command "Expand-Archive -Path '%BUILD_DIR%\node.zip' -DestinationPath '%BUILD_DIR%' -Force"
xcopy /s /e /q /y "%BUILD_DIR%\node-v22.15.0-win-x64\*" "%BUILD_DIR%\node\" >nul
rmdir /s /q "%BUILD_DIR%\node-v22.15.0-win-x64"
del "%BUILD_DIR%\node.zip"
echo [OK] Node.js extracted

echo [4/5] Writing NSIS config...
REM Create a header file with the baked values
echo !define SERVER_URL "%CLOUDFUZE_SERVER_URL%" > "%BUILD_DIR%\config.nsh"
echo !define ENROLL_SECRET "%CLOUDFUZE_ENROLL_SECRET%" >> "%BUILD_DIR%\config.nsh"
echo [OK] Config written

echo [5/5] Building installer...
REM Find NSIS
set NSIS_PATH=C:\Program Files (x86)\NSIS\makensis.exe
if not exist "%NSIS_PATH%" set NSIS_PATH=C:\Program Files\NSIS\makensis.exe
if not exist "%NSIS_PATH%" (
  echo [ERROR] NSIS not found! Install from nsis.sourceforge.io
  pause
  exit /b 1
)

"%NSIS_PATH%" //DSERVER_URL="%CLOUDFUZE_SERVER_URL%" //DENROLL_SECRET="%CLOUDFUZE_ENROLL_SECRET%" //DBUILD_DIR="%BUILD_DIR%" "%~dp0cloudfuze-agent.nsi"

if %ERRORLEVEL% neq 0 (
  echo [ERROR] NSIS build failed
  pause
  exit /b 1
)

echo.
echo ============================================
echo   Installer built: CloudFuze-Agent-Setup.exe
echo ============================================
echo.
pause
