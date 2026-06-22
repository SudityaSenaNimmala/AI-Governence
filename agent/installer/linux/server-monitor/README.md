# CloudFuze server-monitor — Linux deployment

Governs **server-side AI agents** (CLI / cron / systemd / CI) by intercepting
their outbound LLM API calls and reporting attribution + token cost back to
the governance dashboard.

## What it captures

For each LLM API call from any agent on the host:

| Field | Example |
|---|---|
| User (real human, survives sudo) | `alice` (from `/proc/<pid>/loginuid`) |
| Agent | `python /opt/bots/triage.py --queue urgent` |
| Trigger source | `cron`, `interactive_shell`, `systemd`, `ssh`, `ci` |
| Provider + model | `anthropic` + `claude-sonnet-4-6-20260101` |
| Tokens + cost | `12,418 in / 3,201 out → $0.087` |
| Prompt + response text | full content, capped at 5 MB per side |
| Duration + status | `1,840 ms`, HTTP 200 |

## Requirements

- Linux with systemd (Ubuntu 20.04+, Debian 11+, RHEL 8+, Amazon Linux 2/2023)
- `update-ca-certificates` available (Debian/Ubuntu) or equivalent
- Node.js **not required** at runtime — the daemon ships as a single binary
- Root on first install (writes CA, systemd unit, `/etc/environment`)
- Governance server reachable from the host

## Install

```bash
sudo ./install.sh \
  --server https://aigov.cloudfuze.com \
  --enroll-secret <your-enroll-secret> \
  --binary ./ai-gov-server-monitor
```

The installer:

1. Drops the binary into `/opt/cloudfuze/server-monitor/`
2. Boots the daemon briefly to generate `~/.cloudfuze-aigov/ca/ca.crt` and
   enroll with the governance server (stores the JWT in
   `/etc/cloudfuze/server-monitor.token.json`)
3. Copies the CA into `/usr/local/share/ca-certificates/cloudfuze-aigov.crt`
   and runs `update-ca-certificates`
4. Writes `/etc/profile.d/cloudfuze-proxy.sh` and appends `HTTPS_PROXY` /
   `HTTP_PROXY` / `NO_PROXY` lines to `/etc/environment`
5. Installs `cloudfuze-server-monitor.service` and starts it

After install:

```bash
systemctl status cloudfuze-server-monitor
journalctl -u cloudfuze-server-monitor -f
```

Open the dashboard → **Monitor → Server agents** to confirm the host is
reporting.

## Important: existing processes

`HTTPS_PROXY` is picked up at process start. Agents that are **already running**
when you install will not be governed until they restart. For long-lived
service agents, restart the unit explicitly:

```bash
systemctl restart your-agent.service
```

## Verifying coverage

From the host, run a quick test against a known provider:

```bash
# Should appear in the dashboard within ~5 seconds.
curl -sS https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":50,"messages":[{"role":"user","content":"say hi"}]}'
```

The proxy intercepts because the CA is trusted system-wide and `HTTPS_PROXY` is
set. The dashboard will show the call with attribution = your shell user,
trigger_source = `interactive_shell`.

## Uninstall

```bash
sudo ./uninstall.sh           # keep enrollment token + CA on disk
sudo ./uninstall.sh --purge   # also remove /etc/cloudfuze and the CA dir
```

## Coverage caveats

This is the **Tier 1** build. Honest scope:

| Catches | Misses |
|---|---|
| Standard SDK calls to OpenAI, Anthropic, Google, Azure OpenAI, AWS Bedrock | TLS-pinned binaries that reject the CloudFuze CA |
| Any CLI/cron/systemd/SSH-triggered agent (Node, Python, Go, Rust — anything that respects `HTTPS_PROXY`) | Agents that explicitly set `GODEBUG=httpproxyfromenv=0` or override the proxy in code |
| Cost attribution per real human via `loginuid` | Service-account workloads with no human originator (loginuid = -1) — captured but `user` is null |
| Token + USD cost via the response `usage` field | Local models running entirely on-host (ollama, vLLM, llama.cpp) — these need Tier 2 |
| Streaming SSE responses | In-process inference (Python loads a `.gguf` and runs locally) — Tier 3 |

Tier 2 (eBPF + localhost intercept) and Tier 3 (library shims + GPU watch)
are on the roadmap.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Dashboard shows zero calls after install | Agent is already running and hasn't picked up `HTTPS_PROXY` — restart it. |
| Agent fails with `SSL certificate problem: self-signed cert in chain` | Agent uses its own CA bundle (e.g. Python `certifi`). Set `REQUESTS_CA_BUNDLE` / `NODE_EXTRA_CA_CERTS` / `SSL_CERT_FILE` to `/etc/ssl/certs/ca-certificates.crt`. |
| `loginuid` always null | Kernel built without `CONFIG_AUDITSYSCALL` or auditd is disabled. Attribution still works via `uid`, just without sudo-survival. |
| Daemon exits with EADDRINUSE | Port 8443 in use. Pass `--listen-port 18443` to the installer. |
| systemd service running but no calls appearing | Check `journalctl -u cloudfuze-server-monitor` — likely an enrollment failure or unreachable governance server. |
