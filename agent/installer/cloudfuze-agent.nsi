; CloudFuze Desktop Agent — NSIS Installer
;
; Build with: build-installer.bat
; Output: CloudFuze-Agent-Setup.exe
;
; Employee experience: double-click → Next → Next → Done.
; Agent is installed, enrolled, running, and auto-starts on boot.

!include "MUI2.nsh"

; ── Build-time variables (passed via //D from build script) ──
!ifndef SERVER_URL
  !define SERVER_URL "http://localhost:8787"
!endif
!ifndef ENROLL_SECRET
  !define ENROLL_SECRET "dev-enroll-secret-change-me"
!endif
!ifndef BUILD_DIR
  !define BUILD_DIR "build"
!endif

; ── Metadata ──
Name "CloudFuze Desktop Agent"
OutFile "CloudFuze-Agent-Installer.exe"
InstallDir "C:\CloudFuze\Agent"
InstallDirRegKey HKLM "Software\CloudFuze\Agent" "InstallDir"
RequestExecutionLevel admin
BrandingText "CloudFuze AI Governance"

; ── UI ──
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to CloudFuze"
!define MUI_WELCOMEPAGE_TEXT "This will install the CloudFuze Desktop Agent.$\r$\n$\r$\nThe agent runs silently in the background:$\r$\n  • Scans for AI tools and sensitive data$\r$\n  • Links with the browser extension$\r$\n  • Auto-updates when new versions are available$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_TITLE "CloudFuze is Running"
!define MUI_FINISHPAGE_TEXT "The agent is installed and monitoring.$\r$\n$\r$\nIt starts automatically on boot.$\r$\nNo further action is needed.$\r$\n$\r$\nYou can close this window."
!define MUI_FINISHPAGE_NOAUTOCLOSE

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ── Install ──
Section "Install"
  SetOutPath $INSTDIR

  ; Stop old agent if running
  DetailPrint "Checking for existing installation..."
  IfFileExists "$PROFILE\.cloudfuze-aigov\monitor.lock" 0 +3
    nsExec::ExecToLog 'cmd /c "set /p PID=<"$PROFILE\.cloudfuze-aigov\monitor.lock" & taskkill /PID %PID% /F"'
    Delete "$PROFILE\.cloudfuze-aigov\monitor.lock"

  ; Copy agent source
  DetailPrint "Installing agent files..."
  SetOutPath "$INSTDIR\src"
  File /r "${BUILD_DIR}\agent\src\*.*"
  SetOutPath $INSTDIR
  File "${BUILD_DIR}\agent\package.json"

  ; Copy bundled Node.js
  DetailPrint "Installing Node.js runtime..."
  SetOutPath "$INSTDIR\node"
  File /r "${BUILD_DIR}\node\*.*"
  SetOutPath $INSTDIR

  ; Write server config
  DetailPrint "Configuring server connection..."
  CreateDirectory "$PROFILE\.cloudfuze-aigov"
  FileOpen $0 "$PROFILE\.cloudfuze-aigov\auto-config.json" w
  FileWrite $0 '{"serverUrl":"${SERVER_URL}","enrollSecret":"${ENROLL_SECRET}"}'
  FileClose $0

  ; Install npm dependencies — run from $INSTDIR so package.json is found
  DetailPrint "Installing dependencies (please wait)..."
  SetOutPath $INSTDIR
  nsExec::ExecToLog '"$INSTDIR\node\node.exe" "$INSTDIR\node\node_modules\npm\bin\npm-cli.js" install --production --no-optional 2>&1"'
  Pop $0
  DetailPrint "npm exit code: $0"

  ; Enroll with server — skip heavy scans for fast install
  DetailPrint "Enrolling with governance server..."
  nsExec::ExecToLog '"$INSTDIR\node\node.exe" "$INSTDIR\src\index.js" --server "${SERVER_URL}" --enroll-secret "${ENROLL_SECRET}" --skip deep_filesystem,browser_history --output NUL"'
  Pop $0
  DetailPrint "Enroll exit code: $0"

  ; Register auto-start — uses VBS launcher for hidden window
  DetailPrint "Setting up auto-start..."
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "CloudFuzeAgent" '"wscript.exe" "$INSTDIR\start-agent.vbs"'

  ; Uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\CloudFuzeAgent" "DisplayName" "CloudFuze Desktop Agent"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\CloudFuzeAgent" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\CloudFuzeAgent" "Publisher" "CloudFuze"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\CloudFuzeAgent" "DisplayVersion" "1.0.0"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\CloudFuzeAgent" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\CloudFuzeAgent" "NoRepair" 1
  WriteRegStr HKLM "Software\CloudFuze\Agent" "InstallDir" "$INSTDIR"

  ; Create a hidden launcher so the agent runs without a visible terminal window
  FileOpen $0 "$INSTDIR\start-agent.vbs" w
  FileWrite $0 'Set ws = CreateObject("WScript.Shell")$\r$\n'
  FileWrite $0 'ws.Run """$INSTDIR\node\node.exe"" ""$INSTDIR\src\index.js"" --server ${SERVER_URL} --enroll-secret ${ENROLL_SECRET} --monitor", 0, False$\r$\n'
  FileClose $0

  ; Start agent now — hidden, no terminal window
  DetailPrint "Starting agent..."
  Exec '"wscript.exe" "$INSTDIR\start-agent.vbs"'

  DetailPrint "Done!"
SectionEnd

; ── Uninstall ──
Section "Uninstall"
  ; Stop agent
  IfFileExists "$PROFILE\.cloudfuze-aigov\monitor.lock" 0 +3
    nsExec::ExecToLog 'cmd /c "set /p PID=<"$PROFILE\.cloudfuze-aigov\monitor.lock" & taskkill /PID %PID% /F"'
    Delete "$PROFILE\.cloudfuze-aigov\monitor.lock"

  ; Remove auto-start
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "CloudFuzeAgent"

  ; Remove registry
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\CloudFuzeAgent"
  DeleteRegKey HKLM "Software\CloudFuze\Agent"

  ; Remove files
  RMDir /r "$INSTDIR"

  DetailPrint "CloudFuze agent has been uninstalled."
SectionEnd
