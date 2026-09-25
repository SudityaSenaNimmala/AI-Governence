/**
 * Shared MongoDB connection module.
 * Used by both main app routes and governance routes.
 */
import dns from 'dns';
import { MongoClient } from 'mongodb';

// Some networks' default DNS server answers plain A/AAAA lookups fine but
// refuses SRV/TXT queries outright (ECONNREFUSED) — exactly the two record
// types a `mongodb+srv://` URI needs to find its replica set members and
// connection options. The OS-level resolver (what curl/nslookup use) can
// still work in that same environment, which is why the connection failing
// here looks like "the network is fine" from everywhere else. Pointing
// Node's own resolver at a normal public DNS server fixes it without
// changing the URI or requiring a non-SRV connection string. Public
// resolvers only, so this never breaks resolution of an internal/private
// hostname — this app has none to resolve (Atlas, webhooks, SIEM
// destinations are all public internet hosts).
dns.setServers(['8.8.8.8', '1.1.1.1']);

let client = null;
let db = null;

export async function connectMongo(uri) {
  if (db) return db;
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(); // uses the database name from the URI
  console.log(`MongoDB connected: ${db.databaseName}`);
  return db;
}

export function getMongo() {
  if (!db) throw new Error('MongoDB not connected. Call connectMongo() first.');
  return db;
}

/**
 * TEST SEAM ONLY. The governance routers resolve their handle through getMongo()
 * at request time rather than taking an injected db, so without this they cannot
 * be mounted against tests/helpers/fake-db.mjs and their auth/validation can only
 * be pinned by reading source. Pass null to reset. Refused in production so no
 * runtime path can swap the live connection out.
 */
export function setMongoForTests(fakeDb) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('setMongoForTests is not available in production');
  }
  db = fakeDb ?? null;
}

export async function closeMongo() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
