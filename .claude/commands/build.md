---
description: Build the CloudFuze AI Governance Docker images (agent + server). Args: (none|both) build both, agent only, server only.
argument-hint: [agent|server|both]
allowed-tools: Bash
---

You are running the `/build` command. Argument: `$ARGUMENTS`

Build Docker images directly. Do NOT explain `BUILD.md` or the Node SEA build — this command is the container path.

## Images

Both built from the **repo root** as context (server depends on agent via `file:../agent`):

| Image                          | Dockerfile         | Tag                                |
|--------------------------------|--------------------|------------------------------------|
| Agent (endpoint scanner)       | `agent/Dockerfile` | `cloudfuze/ai-gov-agent:dev`       |
| Server (ingest API + storage)  | `server/Dockerfile`| `cloudfuze/ai-gov-server:dev`      |

## Argument

- empty or `both` → build both, agent first then server.
- `agent` → agent only.
- `server` → server only.
- anything else → list valid args and stop.

## Steps

1. `docker version` (preflight). If it fails, surface the error and stop — do not try to install Docker. On Windows, the most likely cause is Docker Desktop not running; say so plainly.
2. For each selected image, run from the repo root via Bash (cross-platform):
   - Agent: `docker build -f agent/Dockerfile -t cloudfuze/ai-gov-agent:dev .`
   - Server: `docker build -f server/Dockerfile -t cloudfuze/ai-gov-server:dev .`
3. After all builds succeed, list the resulting images once:
   `docker images --filter reference=cloudfuze/ai-gov-*:dev --format "{{.Repository}}:{{.Tag}}  {{.Size}}  {{.CreatedSince}}"`
4. If any build fails, stop. Do not push, retag, or clean up.

## Do not

- Do not push. Tags are local-only by design.
- Do not modify the Dockerfiles unless the user asks.
- Do not run `docker system prune` or any cleanup.
- Do not summarize `BUILD.md`.

## Notes

- First build is slow (native deps: `better-sqlite3`, `tesseract.js`). Subsequent builds reuse the layer cache when `package.json` is unchanged.
