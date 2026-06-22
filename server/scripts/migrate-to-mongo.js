/**
 * One-time migration script: SQLite + PostgreSQL → MongoDB
 *
 * Reads all data from:
 *   1. SQLite (data/governance.db) — main app tables
 *   2. PostgreSQL (Neon) — governance tables
 * And inserts into MongoDB Atlas.
 *
 * Usage: npx tsx scripts/migrate-to-mongo.js
 */
import dotenv from 'dotenv';
dotenv.config();

import Database from 'better-sqlite3';
import pg from 'pg';
import { MongoClient } from 'mongodb';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MONGODB_URI = process.env.MONGODB_URI;
const PG_URL = 'postgresql://neondb_owner:npg_kC0do8MUnLXQ@ep-cold-leaf-anquedxy-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require';
const SQLITE_PATH = join(__dirname, '..', 'data', 'governance.db');

if (!MONGODB_URI) { console.error('MONGODB_URI not set in .env'); process.exit(1); }

async function migrateSQLite(mongo) {
  console.log('\n=== Migrating SQLite data ===');
  let raw;
  try {
    raw = new Database(SQLITE_PATH, { readonly: true });
  } catch (err) {
    console.log('  SQLite file not found or unreadable, skipping.');
    return;
  }

  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  console.log(`  Found ${tables.length} tables: ${tables.map(t => t.name).join(', ')}`);

  for (const { name } of tables) {
    try {
      const rows = raw.prepare(`SELECT * FROM "${name}"`).all();
      if (rows.length === 0) {
        console.log(`  ${name}: 0 rows, skipping`);
        continue;
      }
      // Drop _id if exists to avoid conflicts
      const docs = rows.map(r => {
        const doc = { ...r };
        delete doc._id;
        // Parse JSON strings stored in SQLite
        for (const [key, val] of Object.entries(doc)) {
          if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
            try { doc[key] = JSON.parse(val); } catch { /* keep as string */ }
          }
        }
        return doc;
      });

      const col = mongo.collection(name);
      try {
        const result = await col.insertMany(docs, { ordered: false });
        console.log(`  ${name}: ${result.insertedCount}/${rows.length} rows migrated`);
      } catch (err) {
        // BulkWriteError — some duplicates, count what did insert
        if (err.code === 11000 || err.insertedCount !== undefined) {
          console.log(`  ${name}: ${err.insertedCount || 0}/${rows.length} rows migrated (${rows.length - (err.insertedCount || 0)} duplicates skipped)`);
        } else {
          console.error(`  ${name}: ERROR — ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`  ${name}: ERROR — ${err.message}`);
    }
  }
  raw.close();
}

async function migratePostgres(mongo) {
  console.log('\n=== Migrating PostgreSQL (Neon) data ===');
  const pool = new pg.Pool({
    connectionString: PG_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 15000,
  });

  try {
    await pool.query('SELECT 1');
    console.log('  Connected to PostgreSQL');
  } catch (err) {
    console.log(`  Could not connect to PostgreSQL: ${err.message}, skipping.`);
    return;
  }

  const pgTables = [
    'oauth_keys', 'tokens', 'policies', 'policy_violations',
    'governance_audit_log', 'agent_registry', 'alerts',
    'cost_records', 'alert_config', 'agent_sensitivity',
    'prompt_flags', 'recertification_campaigns', 'agent_metadata',
  ];

  for (const table of pgTables) {
    try {
      const result = await pool.query(`SELECT * FROM ${table}`);
      const rows = result.rows;
      if (rows.length === 0) {
        console.log(`  ${table}: 0 rows, skipping`);
        continue;
      }

      // Clean up rows — remove any _id field
      const docs = rows.map(r => {
        const doc = { ...r };
        delete doc._id;
        return doc;
      });

      const col = mongo.collection(table);
      try {
        const insertResult = await col.insertMany(docs, { ordered: false });
        console.log(`  ${table}: ${insertResult.insertedCount}/${rows.length} rows migrated`);
      } catch (err) {
        if (err.code === 11000 || err.insertedCount !== undefined) {
          console.log(`  ${table}: ${err.insertedCount || 0}/${rows.length} rows migrated (${rows.length - (err.insertedCount || 0)} duplicates skipped)`);
        } else {
          console.error(`  ${table}: ERROR — ${err.message}`);
        }
      }
    } catch (err) {
      // Table might not exist
      if (err.message.includes('does not exist')) {
        console.log(`  ${table}: table does not exist, skipping`);
      } else {
        console.error(`  ${table}: ERROR — ${err.message}`);
      }
    }
  }

  await pool.end();
}

async function main() {
  console.log('Connecting to MongoDB...');
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const mongo = client.db();
  console.log(`Connected to MongoDB: ${mongo.databaseName}`);

  await migrateSQLite(mongo);
  await migratePostgres(mongo);

  console.log('\n=== Migration complete! ===');
  await client.close();
}

main().catch(err => { console.error('Migration failed:', err); process.exit(1); });
