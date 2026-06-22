// Postgres adapter — implements the same {run, get, all, exec, tx} interface
// as the SQLite adapter. Translates SQLite-flavored SQL written by routes
// (? placeholders, `datetime('now')`) into Postgres syntax.

let pgImported = null;

async function importPg() {
  if (!pgImported) pgImported = await import('pg');
  return pgImported.default || pgImported;
}

export async function createPostgresDb(url) {
  const pg = await importPg();
  const pool = new pg.Pool({ connectionString: url, max: 10 });

  function makeFacade(executor) {
    return {
      kind: 'postgres',
      run: async (sql, ...params) => {
        const r = await executor.query(translate(sql, true), params);
        const lastID = r.rows?.[0]?.id ?? null;
        return { lastID, changes: r.rowCount };
      },
      get: async (sql, ...params) => {
        const r = await executor.query(translate(sql, false), params);
        return r.rows[0];
      },
      all: async (sql, ...params) => {
        const r = await executor.query(translate(sql, false), params);
        return r.rows;
      },
      exec: async (sql) => {
        // No placeholder translation for exec — used for raw schema DDL.
        await executor.query(sql);
      },
      tx: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const txDb = makeFacade(client);
          const result = await fn(txDb);
          await client.query('COMMIT');
          return result;
        } catch (err) {
          try { await client.query('ROLLBACK'); } catch {}
          throw err;
        } finally {
          client.release();
        }
      },
      raw: pool,
    };
  }

  return makeFacade(pool);
}

// Translate SQLite-flavored SQL to Postgres.
// Cheap textual translation — works for our query set. NOT a real parser.
function translate(sql, wantsReturning) {
  let out = sql;

  // ? placeholders -> $1, $2, ...
  let n = 0;
  out = out.replace(/\?/g, () => `$${++n}`);

  // datetime('now') -> NOW()
  out = out.replace(/datetime\('now'\)/gi, 'NOW()');

  // SQLite's `INSERT OR IGNORE` -> `INSERT ... ON CONFLICT DO NOTHING`
  out = out.replace(/INSERT OR IGNORE INTO/gi, 'INSERT INTO');
  if (/INSERT OR IGNORE/i.test(sql) && !/ON CONFLICT/i.test(out)) {
    out += ' ON CONFLICT DO NOTHING';
  }

  // For INSERT ... we add RETURNING id so lastID works on Postgres.
  if (wantsReturning && /^\s*INSERT INTO/i.test(out) && !/RETURNING\b/i.test(out)) {
    out += ' RETURNING id';
  }

  // payload_json is a TEXT column in SQLite, JSONB in Postgres — route code
  // already serializes via JSON.stringify, which Postgres accepts for JSONB.
  // No translation needed for that.

  return out;
}
