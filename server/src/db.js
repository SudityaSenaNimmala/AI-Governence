// Backwards-compatible facade. The real impl lives in ./db/ subdirectory.
export { openDb, applyInitialSchema, toolKeyFor } from './db/index.js';
