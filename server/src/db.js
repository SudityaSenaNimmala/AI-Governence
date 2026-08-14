// Backwards-compatible facade. The real impl lives in ./db/ subdirectory.
export { openDb, applyInitialSchema, ensureAnalyticsIndexes, toolKeyFor } from './db/index.js';
