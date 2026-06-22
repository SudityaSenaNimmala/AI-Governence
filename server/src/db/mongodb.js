/**
 * Shared MongoDB connection module.
 * Used by both main app routes and governance routes.
 */
import { MongoClient } from 'mongodb';

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

export async function closeMongo() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
