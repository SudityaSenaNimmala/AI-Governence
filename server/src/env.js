// Loads .env BEFORE any other module is evaluated.
//
// Why this file exists: ESM hoists and evaluates every `import` before it runs
// any statement in the importing module. So this, in index.js, does NOT work:
//
//     import dotenv from 'dotenv';
//     dotenv.config();               // <- a statement; runs LAST
//     import { JWT_SECRET } from './auth.js';   // <- evaluated FIRST
//
// auth.js would read process.env.JWT_SECRET before .env had been loaded, fall
// back to a random per-process secret, and invalidate every machine token on
// each restart (agents got "invalid token: invalid signature" and 401s).
//
// Importing this module first makes the load a side effect of module evaluation,
// which is ordered — so env vars exist by the time auth.js is evaluated.
import dotenv from 'dotenv';

dotenv.config();
