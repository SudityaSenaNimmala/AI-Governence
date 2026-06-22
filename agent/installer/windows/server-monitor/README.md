# CloudFuze server-monitor — Windows deployment

Same role as the Linux daemon: intercepts outbound LLM API calls from agents
running on this host and reports attribution + token cost to the governance
dashboard.

## Requirements

- Windows Server 2016+ / Windows 10+ (PowerShell 5.1 is fine — no PS7 required)
- Administrator rights (CA install, Machine-scope env vars, service install)
- Governance server reachable from this host

## Install

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 `
  -Server "https://aigov.cloudfuze.com" `
  -EnrollSecret "<your-enroll-secret>" `
  -Binary ".\ai-gov-server-monitor.exe"
```

The installer:

1. Drops the binary into `C:\Program Files\CloudFuze\server-monitor\`
2. Boots the daemon briefly so it generates `%USERPROFILE%\.cloudfuze-aigov\ca\ca.crt` and enrolls with the governance server (token stored at `C:\ProgramData\CloudFuze\server-monitor.token.json`)
3. Imports the CA into the **LocalMachine\Root** store (system-wide trust)
4. Sets `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` as **Machine-scope** environment variables
5. Registers `CloudFuzeServerMonitor` as a Windows Service (LocalSystem) and starts it

## Verify

```powershell
Get-Service CloudFuzeServerMonitor
# Status   Name                DisplayName
# ------   ----                -----------
# Running  CloudFuzeServerM... CloudFuze AI Governance — Server Monitor
```

Then make a test LLM call from any new PowerShell window or service process on this host — it should appear in the dashboard under **Monitor → Server agents** within ~10 seconds.

## Important: existing processes

`HTTPS_PROXY` is picked up at process start. Agents and services that were **already running** when you installed will not be governed until they restart. For long-lived agents, restart explicitly:

```powershell
Restart-Service your-agent-service
```

Signed-in user sessions need a logout+login (or a reboot) before their interactive shells see the new env vars.

## Attribution on Windows — what you get

| Field | Source | Notes |
|---|---|---|
| User | `Win32_Process.GetOwner()` | `DOMAIN\username` form |
| Command line | `Win32_Process.CommandLine` | full argv |
| Executable | `Win32_Process.ExecutablePath` | |
| Parent chain | walk `Win32_Process.ParentProcessId` up to 8 levels | |
| Trigger source | first match in parent chain | `service`, `scheduled_task`, `interactive_desktop`, `interactive_shell`, `ssh`, `ci`, `container` |
| Working directory | n/a | Win32_Process doesn't expose it; PEB reads are unreliable across builds |
| Real-human-across-elevation | n/a | Windows has no `loginuid` equivalent. The Windows user IS preserved across UAC elevation (only integrity level changes), so attribution is correct for normal use. |

## Uninstall

```powershell
# Default: keep enrollment token + CA on disk in case of reinstall
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1

# Full purge
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -Purge
```

## Performance notes

The current v1 attribution path spawns `powershell.exe` once per intercepted API call (~3-5s cold cost on the test rig). The dashboard event therefore arrives a few seconds after the API call ends. The proxy itself does NOT block — the agent gets its response with normal latency.

A long-lived PowerShell helper (already used by the desktop process resolver) is the natural v2 optimization and will bring attribution latency under 100ms.

## Coverage caveats — same as Linux

This is **Tier 1**. Catches any standard SDK call to OpenAI / Anthropic / Google / Azure OpenAI / AWS Bedrock from any cooperative agent. Misses TLS-pinned binaries, local model servers (Tier 2), and in-process inference (Tier 3).
