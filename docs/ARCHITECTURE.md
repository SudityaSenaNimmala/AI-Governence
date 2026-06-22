# Architecture

## System overview

Three components, all Node.js / JavaScript:

| Component | Role | Tech |
|-----------|------|------|
| `agent/` | Endpoint scanner; runs on each employee PC | Node 22, packaged as single binary via Node SEA |
| `server/` | Ingest API + storage | Node 22, Express, SQLite (v0) → Postgres (prod) |
| `dashboard/` | Governance UI | Vite + React + Tailwind + Recharts |

## Data model

### Top-level entities

- **Machine** — one row per enrolled PC. Identified by a stable hash of MAC + hostname.
- **Scan** — one run of the agent on a machine. Has a timestamp, agent version, OS info.
- **Finding** — one detected signal in a scan. Polymorphic — type tells you what.
- **Tool** — derived catalog entry. The dashboard groups findings into tools.
- **Sanction** — admin-set status: `approved`, `restricted`, `blocked`, `unknown`.

### Finding types (v0)

| Type | Source detector | Example payload |
|------|----------------|-----------------|
| `desktop_app` | OS install registry | `{name, version, installDate, path}` |
| `running_process` | Process list | `{name, pid, cmd}` |
| `browser_ai_visit` | Browser history SQLite | `{browser, domain, visitCount, lastVisit}` |
| `ide_extension` | VS Code / Cursor / JetBrains | `{ide, id, version, name}` |
| `agent_config` | `.cursor`, `.claude`, etc. | `{kind, path, lastModified}` |
| `mcp_server` | Claude Desktop / Cursor MCP configs | `{client, name, command, args, scopes}` |
| `local_llm` | Ollama / LM Studio | `{runtime, models[]}` |
| `api_key` | `.env`, dotfiles, shell profiles | `{provider, fingerprint, location}` (no key value) |
| `agent_project` | Repo scan | `{path, frameworks[], lastActivity}` |

## Detector framework

Each detector lives in `agent/src/detectors/<name>.js` and exports:

```js
export const name = 'desktop_apps';
export const description = '...';
export const platforms = ['win32', 'darwin', 'linux'];  // which OSes it runs on

export async function detect(ctx) {
  // ctx: { platform, paths, log, abortSignal }
  return {
    findings: [ /* array of {type, ...payload} */ ],
    errors: [ /* {message, recoverable} */ ],
    stats: { itemsScanned: 123, durationMs: 456 }
  };
}
```

The scanner runtime:
1. Loads all detectors matching the current platform.
2. Runs them concurrently with a per-detector timeout.
3. Combines findings into a single report.
4. POSTs to the backend (or writes JSON locally if `--output`).

## Privacy & safety guarantees enforced in code

- **API keys:** only the first 6 chars + length + provider — never the full key.
- **Browser history:** only AI-related domains. Other domains are filtered before
  the data ever leaves the detector function.
- **File contents:** never read. Only paths, sizes, and modification times.
- **Folder scan:** only walks well-known AI-related paths. There is an explicit
  allowlist, not a blocklist. We do NOT walk `Documents`, `Desktop`, etc.

These rules are enforced by code in each detector and by the report-validator
on the server side.

## Auth & transport

- Agent authenticates with a per-machine enrollment JWT signed by the server during
  install.
- All transport is HTTPS with mTLS (production) or HTTPS + JWT (v0).
- Reports are signed by the agent's key so the server can verify they weren't
  tampered with in flight.

## Storage

**v0:** SQLite single file at `server/data/governance.db`. Easy to back up, easy
to inspect.

**Production:** Postgres on Azure (CloudFuze's cloud). Migration is straightforward
because we use a thin DAL (no ORM coupling).

## Phases (see project plan)

1. **Phase 1 — Discovery (current):** scanner + ingest + read-only dashboard.
2. **Phase 2 — Agent governance deep-scan:** MCP server inspection, agent capability
   inventory.
3. **Phase 3 — Inventory & risk classification:** sanctioning workflow, shadow AI
   reports.
4. **Phase 4 — Policy & DLP:** browser extension or network proxy for data-flow
   visibility (this is the heaviest piece).
