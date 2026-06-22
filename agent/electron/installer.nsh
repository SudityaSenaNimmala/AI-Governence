; Custom NSIS installer script for CloudFuze AI Governance
; Adds optional "Start on boot" checkbox during install

!macro customInstall
  ; Add to Windows startup via registry
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" \
    "CloudFuzeAIGovernance" '"$INSTDIR\CloudFuze AI Governance.exe" --hidden'
!macroend

!macro customUnInstall
  ; Remove startup entry on uninstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CloudFuzeAIGovernance"
!macroend
