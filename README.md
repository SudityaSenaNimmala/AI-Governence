# CloudFuze AI & Agent Governance Platform

An internal platform to discover, inventory, and govern the AI tools and AI agents
employees use across the organization.

> **Status:** v0 / in development. CEO-mandated, legal sign-off obtained.
> **Owner:** Satya Pinniti.

## What this does

Three pillars in one platform:

1. **Discovery** — endpoint agent scans each PC for AI tools (ChatGPT, Gemini,
   Claude, Copilot, Perplexity, ...), AI coding agents (Cursor, Claude Code, Aider,
   Continue, Codeium, ...), MCP servers, local LLMs (Ollama, LM Studio), AI API keys,
   browser usage of AI services, and AI-agent project folders.
2. **Inventory & risk classification** — central catalog of every AI tool/agent
   detected, sanctioned vs shadow, risk-tagged by data sensitivity.
3. **Data-flow visibility** — agent-level view of what each AI agent can read/write
   (MCP server connections, API keys, repo access) and where data egresses to.

## Architecture

```
+----------------------+        +----------------------+        +----------------------+
|  Endpoint agent (JS) |        |  Backend ingest API  |        |  React dashboard     |
|  - Windows / macOS / | -----> |  - Node.js + Express | <----- |  - Vite + React +    |
|    Linux             |  JSON  |  - SQLite (v0)       |   API  |    Tailwind +        |
|  - Daily scan        |  HTTPS |  - Postgres (prod)   |        |    Recharts          |
|  - Visible tray icon |        |                      |        |                      |
+----------------------+        +----------------------+        +----------------------+
```

Single language end-to-end (JavaScript / Node 22). Agent ships as a signed
single-executable per platform via Node SEA.

## Repo layout

```
agent/        Node.js endpoint scanner (cross-platform)
server/       Node.js ingest API + SQLite store
dashboard/    React + Vite governance dashboard
docs/         Architecture, employee disclosure, deployment runbooks
```

## Quick start (developer)

```bash
# 1. Run a local scan against your own machine (no server needed yet)
cd agent
npm install
node src/index.js --output ./report.json

# 2. Start the backend
cd ../server
npm install
npm run dev   # listens on http://localhost:8787

# 3. Start the dashboard
cd ../dashboard
npm install
npm run dev   # opens http://localhost:8080
```

## Important — read this before deploying

- **Transparency:** the agent is visible (system tray icon, opt-in install where
  possible) and ships with the employee disclosure in `docs/EMPLOYEE_DISCLOSURE.md`.
- **What the agent NEVER does:**
  - Read prompt/message content from AI services
  - Exfiltrate API key values (only fingerprints / prefix hashes)
  - Read user files outside well-known AI-related paths
  - Touch keystrokes, screenshots, microphone, or webcam
- **Legal:** CloudFuze legal has approved this collection scope. Any expansion of
  scope MUST re-trigger legal review before deployment.

See `docs/ARCHITECTURE.md` for the full data model, `docs/EMPLOYEE_DISCLOSURE.md`
for the employee-facing notice, and `docs/DEPLOYMENT.md` for the rollout plan.
