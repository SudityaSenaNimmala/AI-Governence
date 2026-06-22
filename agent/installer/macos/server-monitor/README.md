# CloudFuze server-monitor — macOS deployment

Same role as the Linux + Windows daemons: intercepts outbound LLM API calls and reports attribution + token cost to the governance dashboard.

## Requirements

- macOS 11+ (Big Sur or later — earlier versions ship older Bash 3.2 and may need tweaks)
- `sudo` access
- Governance server reachable from this host
- Recommended: the bundled binary is **signed + notarized** with a Developer ID. Unsigned binaries work but Gatekeeper will prompt and may require `xattr -d com.apple.quarantine` to clear.

## Install

```bash
sudo ./install.sh \
  --server https://aigov.cloudfuze.com \
  --enroll-secret <your-enroll-secret> \
  --binary ./ai-gov-server-monitor
```

The installer:

1. Drops the binary into `/usr/local/cloudfuze/server-monitor/`
2. Boots the daemon briefly so it generates `/var/root/.cloudfuze-aigov/ca/ca.crt` and enrolls with the governance server (token at `/etc/cloudfuze/server-monitor.token.json`)
3. Adds the CA to the **System keychain** with SSL trust (`security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain`)
4. Sets `HTTPS_PROXY` system-wide via `launchctl setenv` (current session) + appends export lines to `/etc/zshenv` and `/etc/bashrc` (persists across reboots)
5. Installs `/Library/LaunchDaemons/com.cloudfuze.server-monitor.plist` and loads it via `launchctl load -w`

## Verify

```bash
sudo launchctl list | grep com.cloudfuze.server-monitor
tail -f /var/log/cloudfuze-server-monitor.log
```

Then run an LLM API call from a fresh terminal — it should appear in the dashboard within ~10 seconds.

## Attribution on macOS — what you get

| Field | Source | Notes |
|---|---|---|
| User | `ps -o user=` | shell user, no sudo-survival (no `loginuid` equivalent) |
| Command line | `ps -o args=` | full argv |
| Working directory | `lsof -d cwd` | works without SIP override |
| Parent chain | iterated `ps -o ppid=` walk up to 8 levels | |
| Trigger source | first match in chain | `launchd` (LaunchDaemon/Agent), `cron`, `ssh`, `login`, `interactive_shell`, `interactive_terminal` (Terminal.app, iTerm2, Alacritty, kitty…), `ci`, `container` |
| Real-human-across-sudo | n/a | macOS audit subsystem exposes session IDs but the API is brittle and SIP-restricted. v1 captures the process owner. |

## Uninstall

```bash
sudo ./uninstall.sh           # keep enrollment + CA on disk for re-install
sudo ./uninstall.sh --purge   # remove everything
```

## Notes / gotchas

- **Existing processes don't pick up the new proxy.** Any agent or GUI app already running stays untouched until it restarts. For full coverage on a workstation, log out + back in.
- **GUI apps launched from Finder** inherit env from launchd, so `launchctl setenv` reaches them on first launch — but apps already open at install time won't notice.
- **VPN clients with their own proxy settings** (Cisco AnyConnect, Zscaler) can override `HTTPS_PROXY`. If a client uses one of these, document the interaction or skip endpoint governance for that traffic.
- **System Integrity Protection (SIP)** is *not* required to be disabled for this install. We don't touch anything SIP-protected.

## Coverage caveats — same as Linux + Windows

This is **Tier 1**. Catches standard SDK calls to OpenAI / Anthropic / Google / Azure / AWS Bedrock from any cooperative agent that respects `HTTPS_PROXY`. Misses TLS-pinned binaries (Tier 2: eBPF on Linux / DTrace on macOS), local model servers (Tier 2: localhost intercept), and in-process inference (Tier 3: library shims).
