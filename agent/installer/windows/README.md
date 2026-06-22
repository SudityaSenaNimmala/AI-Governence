# Windows installation

## Quick install (current user, no MSI)

```powershell
# From an elevated PowerShell:
.\install.ps1 `
  -ServerUrl 'https://aigov.cloudfuze.com' `
  -EnrollSecret '<secret-from-IT>' `
  -Binary '.\ai-gov-agent.exe' `
  -RunDaily '09:00'
```

The script:
1. Copies `ai-gov-agent.exe` to `%ProgramFiles%\CloudFuze\AIGovAgent\`.
2. Writes config to `%ProgramData%\CloudFuze\AIGovAgent\config.json`.
3. Performs one-time enrollment against `ServerUrl` using `EnrollSecret`,
   storing the resulting per-machine JWT in `%USERPROFILE%\.cloudfuze-aigov\credentials.json`.
4. Registers a daily scheduled task that runs the agent.

## Uninstall

```powershell
.\uninstall.ps1
```

## Production: MSI via WiX (for MDM push)

`aigov.wxs` is the WiX v4 source. To build:

```powershell
# Install WiX once
dotnet tool install --global wix

# Build
wix build aigov.wxs -arch x64 -o ai-gov-agent.msi

# Sign (EV code-signing certificate required)
signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a ai-gov-agent.msi
```

Push via Intune:

```
msiexec /i ai-gov-agent.msi /qn ^
  SERVERURL=https://aigov.cloudfuze.com ^
  ENROLLSECRET=<MDM-distributed-secret> ^
  RUNDAILY=09:00
```

The MSI invokes `install.ps1` under the hood for the post-install steps.
