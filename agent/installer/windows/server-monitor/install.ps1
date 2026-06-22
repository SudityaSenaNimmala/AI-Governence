# Install CloudFuze server-monitor on Windows Server.
#
# What this does:
#   1. Copies the bundled daemon binary to %ProgramFiles%\CloudFuze\server-monitor\
#   2. Boots the daemon briefly so it generates the CA + enrolls.
#   3. Installs the CA into the LocalMachine Root store (system-wide trust).
#   4. Sets HTTPS_PROXY, HTTP_PROXY, NO_PROXY as Machine-scope env vars
#      (visible to every new process via the standard env block).
#   5. Registers the daemon as a Windows Service (via sc.exe).
#
# Run as Administrator. Requires PowerShell 5.1+ (default on Win10/Server 2016+).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 `
#     -Server "https://aigov.cloudfuze.com" `
#     -EnrollSecret "<secret>" `
#     -Binary ".\ai-gov-server-monitor.exe"

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)] [string] $Server,
  [Parameter(Mandatory=$true)] [string] $EnrollSecret,
  [Parameter(Mandatory=$true)] [string] $Binary,
  [string] $ListenHost = "127.0.0.1",
  [int]    $ListenPort = 8443
)

$ErrorActionPreference = 'Stop'

# Must be admin — service install + Machine env vars + LocalMachine cert store.
$id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$pri = New-Object System.Security.Principal.WindowsPrincipal($id)
if (-not $pri.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "install.ps1 must be run as Administrator."
}

$InstallDir = "$env:ProgramFiles\CloudFuze\server-monitor"
$TokenDir   = "$env:ProgramData\CloudFuze"
$CaPath     = Join-Path $env:USERPROFILE ".cloudfuze-aigov\ca\ca.crt"
$ServiceName= "CloudFuzeServerMonitor"

Write-Host "[1/5] Installing daemon to $InstallDir..."
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
New-Item -ItemType Directory -Path $TokenDir   -Force | Out-Null
Copy-Item -Path $Binary -Destination (Join-Path $InstallDir "ai-gov-server-monitor.exe") -Force

Write-Host "[2/5] First-run: generating CA + enrolling..."
$env:GOV_SERVER_URL      = $Server
$env:GOV_ENROLL_SECRET   = $EnrollSecret
$env:PROXY_LISTEN_HOST   = $ListenHost
$env:PROXY_LISTEN_PORT   = "$ListenPort"
$env:TOKEN_FILE          = Join-Path $TokenDir "server-monitor.token.json"
$bootProc = Start-Process -FilePath (Join-Path $InstallDir "ai-gov-server-monitor.exe") -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 4
try { Stop-Process -Id $bootProc.Id -Force -ErrorAction SilentlyContinue } catch {}

if (-not (Test-Path $CaPath)) {
  throw "CA was not generated at $CaPath. Aborting."
}

Write-Host "[3/5] Installing CA into LocalMachine\Root store..."
$cert = Import-Certificate -FilePath $CaPath -CertStoreLocation 'Cert:\LocalMachine\Root'
Write-Host "    Thumbprint: $($cert.Thumbprint)"

Write-Host "[4/5] Setting HTTPS_PROXY / HTTP_PROXY / NO_PROXY (Machine scope)..."
$proxyUrl = "http://$ListenHost`:$ListenPort"
[Environment]::SetEnvironmentVariable("HTTPS_PROXY", $proxyUrl, "Machine")
[Environment]::SetEnvironmentVariable("HTTP_PROXY",  $proxyUrl, "Machine")
# NO_PROXY intentionally excludes only the proxy itself, NOT localhost,
# because we govern local model servers (ollama / vLLM / llama.cpp) on Tier 2.
# Non-LLM localhost traffic is bridged untouched at the socket layer.
[Environment]::SetEnvironmentVariable("NO_PROXY",    "$ListenHost`:$ListenPort", "Machine")

Write-Host "[5/5] Registering Windows Service '$ServiceName'..."
# Use sc.exe — it ships with every Windows. The service runs as LocalSystem
# so it can read other users' process metadata via WMI (Win32_Process.GetOwner
# requires admin on cross-user lookups).
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Stop-Service $ServiceName -ErrorAction SilentlyContinue
  & sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Seconds 1
}
$binPath = "`"$InstallDir\ai-gov-server-monitor.exe`""
& sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= "CloudFuze AI Governance — Server Monitor" obj= "LocalSystem" | Out-Null
& sc.exe description $ServiceName "Captures and reports outbound LLM API calls from agents on this host." | Out-Null
# Set the service's environment via the registry (sc.exe doesn't support
# arbitrary env vars; we write them under the service's ImagePath sibling).
$envBlock = @(
  "GOV_SERVER_URL=$Server",
  "GOV_ENROLL_SECRET=$EnrollSecret",
  "PROXY_LISTEN_HOST=$ListenHost",
  "PROXY_LISTEN_PORT=$ListenPort",
  "TOKEN_FILE=$($env:TOKEN_FILE)"
)
$serviceRegPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName"
New-ItemProperty -Path $serviceRegPath -Name 'Environment' -PropertyType MultiString -Value $envBlock -Force | Out-Null

Start-Service $ServiceName
Write-Host ""
Write-Host "OK Installation complete."
Write-Host "    Service:  Get-Service $ServiceName  /  Restart-Service $ServiceName"
Write-Host "    Logs:     Event Viewer -> Application (filter source: $ServiceName)"
Write-Host "              or stdout: %ProgramData%\CloudFuze\server-monitor.log if redirected"
Write-Host "    Proxy:    $ListenHost`:$ListenPort  (HTTPS_PROXY now Machine-scope)"
Write-Host "    Dashboard: $Server  ->  Server agents"
Write-Host ""
Write-Host "IMPORTANT: existing processes (services started before this install,"
Write-Host "scheduled tasks already queued, signed-in user sessions) will NOT pick"
Write-Host "up the new HTTPS_PROXY until they restart or the machine is logged out."
