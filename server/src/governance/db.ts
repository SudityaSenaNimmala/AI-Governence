import { getMongo } from '../db/mongodb.js';

export function getDb() {
  return getMongo();
}
