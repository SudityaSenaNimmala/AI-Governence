import dotenv from 'dotenv';
dotenv.config();
import { MongoClient } from 'mongodb';

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db();

const machines = await db.collection('machines').find({}).project({ id: 1, hostname: 1, _id: 0 }).toArray();
console.log(`Machines (${machines.length}):`);
machines.forEach(m => console.log(`  ${m.id} - ${m.hostname}`));

const dlp = await db.collection('dlp_events').countDocuments();
console.log(`\nDLP events total: ${dlp}`);

const recent = await db.collection('dlp_events').find().sort({ occurred_at: -1 }).limit(3).project({ event_kind: 1, ai_service: 1, occurred_at: 1, _id: 0 }).toArray();
console.log('Recent DLP:');
recent.forEach(e => console.log(`  ${e.event_kind} | ${e.ai_service} | ${e.occurred_at}`));

const collections = await db.listCollections().toArray();
console.log(`\nAll collections (${collections.length}):`);
for (const col of collections.sort((a, b) => a.name.localeCompare(b.name))) {
  const count = await db.collection(col.name).countDocuments();
  console.log(`  ${col.name}: ${count}`);
}

await c.close();
