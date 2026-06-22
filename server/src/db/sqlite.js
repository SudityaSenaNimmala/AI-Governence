import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// better-sqlite3 is synchronous. We wrap it in Promise.resolve to give it the
// same async-shaped interface as the Postgres adapter — callers can use
// `await db.run(...)` regardless of which DB is in use.

export function createSqliteDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  const raw = new Database(path);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');

  const prepared = new Map();
  const prep = (sql) => {
    let s = prepared.get(sql);
    if (!s) { s = raw.prepare(sql); prepared.set(sql, s); }
    return s;
  };

  function makeFacade(executor) {
    return {
      kind: 'sqlite',
      run: async (sql, ...params) => {
        const r = executor(sql).run(...params);
        return { lastID: r.lastInsertRowid, changes: r.changes };
      },
      get: async (sql, ...params) => executor(sql).get(...params),
      all: async (sql, ...params) => executor(sql).all(...params),
      exec: async (sql) => { raw.exec(sql); },
      tx: async (fn) => {
        const trx = raw.transaction((arg) => {
          // We use a sync transaction; fn must complete synchronously inside it.
          // To call an async fn here, we resolve it first outside the tx wrapper.
          throw new Error('tx requires sync execution; use runTx instead');
        });
        return runAsyncTx(raw, fn);
      },
      raw,
    };
  }

  return makeFacade((sql) => prep(sql));
}

// Run an async-style transaction. We use raw.exec for BEGIN/COMMIT/ROLLBACK
// because better-sqlite3's `transaction()` helper requires a sync function.
async function runAsyncTx(raw, fn) {
  raw.exec('BEGIN');
  try {
    const txDb = makeTxFacade(raw);
    const result = await fn(txDb);
    raw.exec('COMMIT');
    return result;
  } catch (err) {
    try { raw.exec('ROLLBACK'); } catch {}
    throw err;
  }
}

function makeTxFacade(raw) {
  const prep = (sql) => raw.prepare(sql);
  return {
    kind: 'sqlite',
    run: async (sql, ...params) => {
      const r = prep(sql).run(...params);
      return { lastID: r.lastInsertRowid, changes: r.changes };
    },
    get: async (sql, ...params) => prep(sql).get(...params),
    all: async (sql, ...params) => prep(sql).all(...params),
    exec: async (sql) => { raw.exec(sql); },
  };
}
