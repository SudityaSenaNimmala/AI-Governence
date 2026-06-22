# Deployment Plan

## Rollout phases

### Phase 0 — Internal alpha (IT + AI Governance team only)
- Goal: shake out bugs, confirm no false positives, confirm AV/EDR doesn't flag.
- Size: 5–10 machines.
- Duration: 2 weeks.

### Phase 1 — Engineering pilot
- Goal: real-world data from the heaviest AI users in the company.
- Size: ~30 engineers, opt-in.
- Duration: 3 weeks.
- Exit criteria: 0 P1 bugs, dashboard usable, employee feedback addressed.

### Phase 2 — Org-wide rollout
- Goal: full coverage.
- Method: MDM push (Intune for Windows/Mac, manual for Linux).
- Communication: all-hands announcement + HR email + Slack pin.

## Distribution

### Windows
- MSI installer signed with EV code-signing cert.
- Installs as a per-user scheduled task that runs once per day.
- System tray icon shows scanner status.
- Pushed via Microsoft Intune.

### macOS
- Signed + notarized `.pkg`.
- LaunchAgent runs once per day.
- Menu bar icon.
- Pushed via Jamf or Intune (whichever IT uses).

### Linux
- `.deb` and `.rpm` for the major distros.
- systemd user unit with daily timer.
- Pushed via Ansible / config management.

## Code signing

- **Windows:** EV code-signing certificate (DigiCert / Sectigo). Required to avoid
  SmartScreen warnings and reduce AV false positives.
- **macOS:** Apple Developer ID certificate + notarization.
- **Linux:** GPG-signed packages.

## Pre-deployment checklist

- [ ] HR notice (`EMPLOYEE_DISCLOSURE.md`) finalized and approved by Legal
- [ ] Acceptable Use Policy updated and signed by all employees
- [ ] Works council / employee representatives notified (if applicable)
- [ ] EV code-signing certs obtained
- [ ] Backend running with TLS in production
- [ ] Backup and retention policy implemented
- [ ] Incident response runbook written
- [ ] Uninstall path tested (employees must be able to uninstall — pushing back
      via MDM is fine, but no rootkit-style persistence)
- [ ] Penetration test of the backend
- [ ] Privacy Impact Assessment (PIA) signed off

## Rollback plan

If anything goes wrong:

1. MDM-push an empty config that disables all detectors.
2. If worse, MDM-push the uninstaller.
3. Incident review within 48 hours.
