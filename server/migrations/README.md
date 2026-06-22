# Migrations

Two parallel sets of migrations are maintained — one for SQLite (dev / v0) and one
for Postgres (production).

## Running SQLite migrations

Done automatically on server startup. Manual:

```bash
sqlite3 server/data/governance.db < server/migrations/001_init.sqlite.sql
```

## Running Postgres migrations

```bash
DATABASE_URL=postgres://user:pass@host:5432/aigov psql "$DATABASE_URL" \
  -f server/migrations/001_init.postgres.sql
```

## Switching from SQLite to Postgres

1. Stand up a Postgres database (Azure Database for PostgreSQL flexible server, RDS, etc.).
2. Run `001_init.postgres.sql` against it.
3. Export SQLite data:
   ```bash
   sqlite3 server/data/governance.db .dump > sqlite-dump.sql
   ```
4. Massage the dump (drop `PRAGMA`, replace `INSERT INTO ... VALUES` to be
   Postgres-compatible). Alternately, write a small `migrate-sqlite-to-pg.js`
   script that reads SQLite via better-sqlite3 and inserts via `pg`.
5. Set `DATABASE_URL=postgres://...` and start the server.
6. The DAL auto-selects Postgres when `DATABASE_URL` is set.

## SQL dialect notes

The codebase intentionally uses portable SQL where possible. Differences handled
inside `src/db/`:

| Concern | SQLite | Postgres |
|---|---|---|
| Placeholders | `?` | `$1`, `$2`, …  (translated by adapter) |
| Auto-increment | `INTEGER PRIMARY KEY AUTOINCREMENT` | `BIGSERIAL` |
| Last insert ID | `lastInsertRowid` | `RETURNING id` |
| Now() | `datetime('now')` | `NOW()` (translated by adapter) |
| JSON | `TEXT` + `json_*` functions | `JSONB` + native operators |
| JSON aggregation | `json_group_array` | `jsonb_agg` (route-level switch) |

The DAL exposes a small async API: `db.run / db.get / db.all / db.exec / db.tx`.
Routes write `?` placeholders and `datetime('now')` — the adapter translates for
Postgres.
