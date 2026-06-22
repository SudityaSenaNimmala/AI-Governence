# Alpha Rollout Runbook

> Audience: Satya + the IT/Security teammate(s) coordinating the alpha.

## Cohort

5–10 internal volunteers, ideally from engineering + sales (the two heaviest
AI-tool user populations). Get explicit written opt-in even though Legal has
already approved the program — this is an alpha, not the org rollout.

## Pre-flight checklist

- [ ] Server stood up at `https://aigov-alpha.cloudfuze.com` (or pick a name)
- [ ] DNS + TLS cert in place
- [ ] `JWT_SECRET`, `ENROLL_SECRET`, `ADMIN_TOKEN` set as env vars (NOT in code)
- [ ] Database backups configured (SQLite WAL + nightly copy; or Postgres if already migrated)
- [ ] Dashboard reachable, restricted to AI Governance team members
- [ ] Employee disclosure (`docs/EMPLOYEE_DISCLOSURE.md`) signed off by Legal in **final** form
- [ ] Slack channel `#ai-gov-alpha` created with the cohort + you
- [ ] Feedback form (Google Form / Typeform) link pinned in the channel

## Day-of communication template

```
Hi <name>,

You've opted in to the AI Governance alpha. Here's what to expect:

1. WHAT YOU'LL INSTALL
   • A small endpoint scanner (visible system tray icon)
   • A browser extension for ChatGPT / Claude / Gemini / Perplexity / Copilot

2. WHAT IT DOES
   • Scans for AI tools and agents on your machine, once a day
   • Watches AI service prompt inputs for secrets / PII patterns
   • Reports METADATA ONLY (tool names, pattern hits) — never your prompt content

3. INSTALL INSTRUCTIONS
   <link to platform-specific instructions>

4. ENROLLMENT SECRET (one-time, expires in 7 days)
   <secret> ← give each user a unique secret if possible

5. FEEDBACK
   • #ai-gov-alpha in Slack
   • <feedback form link>

Thanks for helping us build this.

— Satya
```

## Per-user install (Windows / macOS / Linux)

### Windows
```powershell
# From elevated PowerShell:
cd C:\path\to\agent-win32-x64
.\install.ps1 `
  -ServerUrl 'https://aigov-alpha.cloudfuze.com' `
  -EnrollSecret '<from-IT>' `
  -Binary '.\ai-gov-agent.exe'
```

### macOS
```bash
sudo ./install.sh \
  --server https://aigov-alpha.cloudfuze.com \
  --enroll-secret <from-IT> \
  --binary ./ai-gov-agent
```

### Linux
```bash
sudo ./install.sh \
  --server https://aigov-alpha.cloudfuze.com \
  --enroll-secret <from-IT> \
  --binary ./ai-gov-agent
```

### Browser extension
1. Unzip `browser-extension.zip`.
2. Chrome / Edge → `chrome://extensions` → Developer mode → Load unpacked → select unzipped folder.
3. Click the extension icon → Settings → enter server URL + enrollment secret → Save.

## Daily operations

| Time   | Activity |
|--------|----------|
| 09:00  | Scheduled scan fires on each alpha machine |
| 09:15  | Check the dashboard overview — confirm all alpha machines reported in |
| 09:30  | Review yesterday's DLP events (severity high + critical) |
| 17:00  | Quick Slack ping: any false positives? regressions? performance complaints? |

## Health metrics to track

Pull these queries against the SQLite DB or Postgres:

```sql
-- Cohort health
SELECT COUNT(*) AS cohort_size FROM machines;
SELECT COUNT(*) AS reporting_today
  FROM machines WHERE last_seen > datetime('now', '-1 day');

-- Findings velocity
SELECT date(received_at) AS day, COUNT(*) AS scans, SUM(findings_count) AS findings
  FROM scans WHERE received_at > datetime('now', '-14 day')
  GROUP BY day ORDER BY day;

-- Top tools across the alpha
SELECT vendor || ':' || product AS tool, COUNT(DISTINCT machine_id) AS users
  FROM findings GROUP BY tool ORDER BY users DESC LIMIT 25;

-- DLP signal
SELECT date(occurred_at) AS day, secret_class, COUNT(*) AS events
  FROM dlp_events WHERE occurred_at > datetime('now', '-14 day')
  GROUP BY day, secret_class ORDER BY day;
```

## Exit criteria for graduating from alpha → broader pilot

- [ ] All alpha machines reporting for ≥7 consecutive days
- [ ] 0 P1 bugs in the last 7 days (P1 = breaks user workflow OR leaks data)
- [ ] ≥3 useful insights surfaced (e.g. unknown tool found, key in plaintext, MCP server with DB scope)
- [ ] False-positive rate on DLP < 5%
- [ ] No AV / EDR false positives
- [ ] Average agent runtime < 30s per scan
- [ ] Employee NPS ≥ 0 (asked via feedback form)

## Rollback procedures

### Disable the agent for one user
SSH the user, run the platform's uninstall script. Or push an empty
`config.json` that disables scans.

### Disable extension for one user
Tell them to disable in `chrome://extensions`. Or remove the extension's
managed-install policy if MDM-installed.

### Kill the whole alpha
1. Rotate `ENROLL_SECRET` — no new enrollments possible.
2. Push uninstall script to all cohort machines.
3. Send Slack note with reason + next-steps timeline.
4. Schedule post-mortem within 48 hours.

## Open issues / next-up

Track in `#ai-gov-alpha` and on the dashboard's Shadow AI page. When the alpha
exits successfully, write a v0.2 plan covering:
- True production code-signing (EV cert procurement)
- Postgres migration
- MDM-pushed install (Intune integration)
- Browser extension force-install policy
- SSO for the dashboard (Entra ID)
