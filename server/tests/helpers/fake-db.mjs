// Minimal in-memory stand-in for the Mongo `Db` handle the routes receive.
// Implements only the operations the DLP ingest and Session Replay read paths
// use: insertOne, findOne, updateOne (with $set / $setOnInsert / $inc / $min /
// $max / $addToSet + upsert), a find() chain, countDocuments, distinct,
// deleteMany, and a small aggregate() pipeline interpreter.
//
// It deliberately enforces one real MongoDB constraint that is easy to violate
// by accident: a field may not appear in two update operators at once. Mongo
// rejects that with "Updating the path ... would create a conflict", so the
// fake throws too and the test catches it instead of production.
//
// Anything the interpreters do not understand throws rather than silently
// returning a plausible-but-wrong answer — a stub that quietly disagrees with
// the real server is worse than no stub.

function matchesValue(actual, expected) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
    const ops = Object.keys(expected);
    if (ops.some((k) => k.startsWith('$'))) {
      for (const [op, operand] of Object.entries(expected)) {
        switch (op) {
          // Against an array field Mongo asks whether the array and the operand
          // list intersect, not whether the whole array is one of the values.
          case '$in':     if (!includesAny(operand, actual)) return false; break;
          case '$nin':    if (includesAny(operand, actual)) return false; break;
          case '$ne':     if (eq(actual, operand)) return false; break;
          case '$gt':     if (!(cmp(actual, operand) > 0)) return false; break;
          case '$gte':    if (!(cmp(actual, operand) >= 0)) return false; break;
          case '$lt':     if (!(cmp(actual, operand) < 0)) return false; break;
          case '$lte':    if (!(cmp(actual, operand) <= 0)) return false; break;
          case '$exists': if ((actual !== undefined) !== operand) return false; break;
          default: throw new Error(`fake-db: unsupported query operator ${op}`);
        }
      }
      return true;
    }
  }
  return eq(actual, expected);
}

function includesAny(operand, actual) {
  const list = Array.isArray(operand) ? operand : [operand];
  if (Array.isArray(actual)) return actual.some((v) => list.some((x) => eq(v, x)));
  return list.some((x) => eq(actual, x));
}

function eq(a, b) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  // Mongo treats a missing field and an explicit null as equal for `field: null`.
  if (b === null) return a === null || a === undefined;
  // Array containment: `{ tags: 'x' }` matches a document whose `tags` array
  // holds 'x'. Real Mongo semantics, and what the session_recordings.session_ids
  // lookups rely on — without it those queries would silently return nothing.
  if (Array.isArray(a) && !Array.isArray(b)) return a.some((v) => eq(v, b));
  return a === b;
}

function cmp(a, b) {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av === undefined || av === null) return -1;
  return av > bv ? 1 : av < bv ? -1 : 0;
}

function matches(doc, filter = {}) {
  for (const [k, v] of Object.entries(filter)) {
    if (!matchesValue(doc[k], v)) return false;
  }
  return true;
}

// Mongo's own ordering for a multi-key sort spec, key by key.
function sortDocs(rows, spec) {
  const keys = Object.entries(spec);
  return [...rows].sort((a, b) => {
    for (const [key, dir] of keys) {
      const c = cmp(a[key], b[key]);
      if (c !== 0) return c * dir;
    }
    return 0;
  });
}

// Mongo rejects an update that touches the same path from two operators, not
// just $set/$setOnInsert. Check every pair the fake supports.
const SUPPORTED_UPDATE_OPS = ['$set', '$setOnInsert', '$inc', '$min', '$max', '$addToSet'];

function assertNoConflict(update) {
  const unsupported = Object.keys(update).filter((k) => !SUPPORTED_UPDATE_OPS.includes(k));
  if (unsupported.length) {
    throw new Error(`fake-db: unsupported update operator ${unsupported.join(', ')}`);
  }
  const ops = SUPPORTED_UPDATE_OPS.map((op) => [op, update[op] ?? {}]);
  for (let i = 0; i < ops.length; i++) {
    for (let j = i + 1; j < ops.length; j++) {
      for (const k of Object.keys(ops[j][1])) {
        if (k in ops[i][1]) {
          throw new Error(`update conflict: '${k}' is in both ${ops[i][0]} and ${ops[j][0]}`);
        }
      }
    }
  }
}

// '$field' → doc.field, anything else → the literal.
function resolve(expr, doc) {
  if (typeof expr === 'string' && expr.startsWith('$')) return doc[expr.slice(1)];
  return expr;
}

function runPipeline(docs, pipeline) {
  let rows = docs.map((d) => ({ ...d }));

  for (const stage of pipeline) {
    const [op] = Object.keys(stage);
    const spec = stage[op];

    switch (op) {
      case '$match':
        rows = rows.filter((d) => matches(d, spec));
        break;

      case '$sort':
        rows = sortDocs(rows, spec);
        break;

      case '$limit':
        rows = rows.slice(0, spec);
        break;

      case '$count':
        rows = rows.length ? [{ [spec]: rows.length }] : [];
        break;

      case '$group': {
        const groups = new Map();
        for (const d of rows) {
          const idVal = spec._id === null ? null : resolve(spec._id, d);
          const key = JSON.stringify(idVal ?? null);
          if (!groups.has(key)) groups.set(key, { _id: idVal ?? null, _docs: [] });
          groups.get(key)._docs.push(d);
        }
        rows = [...groups.values()].map(({ _id, _docs }) => {
          const out = { _id };
          for (const [field, acc] of Object.entries(spec)) {
            if (field === '_id') continue;
            const [accOp] = Object.keys(acc);
            const arg = acc[accOp];
            switch (accOp) {
              case '$sum':
                out[field] = _docs.reduce((t, d) => t + (Number(resolve(arg, d)) || 0), 0);
                break;
              case '$addToSet':
                out[field] = [...new Set(_docs.map((d) => resolve(arg, d)))];
                break;
              case '$min':
                out[field] = _docs.reduce((m, d) => (m === undefined || cmp(resolve(arg, d), m) < 0 ? resolve(arg, d) : m), undefined);
                break;
              case '$max':
                out[field] = _docs.reduce((m, d) => (m === undefined || cmp(resolve(arg, d), m) > 0 ? resolve(arg, d) : m), undefined);
                break;
              default:
                throw new Error(`fake-db: unsupported accumulator ${accOp}`);
            }
          }
          return out;
        });
        break;
      }

      case '$project':
        rows = rows.map((d) => {
          const out = {};
          for (const [field, rule] of Object.entries(spec)) {
            if (rule === 0 || rule === false) continue;
            if (rule === 1 || rule === true) {
              if (field in d) out[field] = d[field];
            } else if (typeof rule === 'string' && rule.startsWith('$')) {
              out[field] = resolve(rule, d);
            } else if (rule && typeof rule === 'object' && '$size' in rule) {
              out[field] = (resolve(rule.$size, d) ?? []).length;
            } else {
              throw new Error(`fake-db: unsupported $project rule for '${field}'`);
            }
          }
          // Mongo keeps _id unless it is explicitly excluded.
          if (!('_id' in spec) && '_id' in d) out._id = d._id;
          return out;
        });
        break;

      default:
        throw new Error(`fake-db: unsupported aggregation stage ${op}`);
    }
  }

  return rows;
}

// $addToSet: append only values the array does not already hold. Supports the
// { $each: [...] } form. Mongo creates the array when the field is absent.
function applyAddToSet(doc, addToSet) {
  for (const [field, spec] of Object.entries(addToSet)) {
    const values = spec && typeof spec === 'object' && !Array.isArray(spec) && '$each' in spec
      ? spec.$each
      : [spec];
    const current = Array.isArray(doc[field]) ? doc[field] : (doc[field] === undefined ? [] : [doc[field]]);
    for (const v of values) {
      if (!current.some((x) => eq(x, v))) current.push(v);
    }
    doc[field] = current;
  }
}

// Mongo's duplicate-key error, close enough for a caller that branches on
// err.code === 11000. The fake only enforces indexes declared via createIndex
// with { unique: true } — so a test that wants the constraint has to declare it,
// the same as production does in applyInitialSchema.
function duplicateKeyError(keys) {
  const err = new Error(`E11000 duplicate key error collection: index: ${keys.join('_1_')}_1 dup key`);
  err.code = 11000;
  return err;
}

class FakeCollection {
  constructor(docs, uniqueIndexes) {
    this.docs = docs;
    this.uniqueIndexes = uniqueIndexes;
  }

  assertUnique(doc, ignore = null) {
    for (const keys of this.uniqueIndexes) {
      const filter = {};
      for (const k of keys) filter[k] = doc[k] ?? null;
      const clash = this.docs.find((d) => d !== ignore && matches(d, filter));
      if (clash) throw duplicateKeyError(keys);
    }
  }

  async insertOne(doc) {
    this.assertUnique(doc);
    this.docs.push({ ...doc });
    return { acknowledged: true, insertedId: doc.id ?? this.docs.length };
  }

  async findOne(filter = {}) {
    return this.docs.find((d) => matches(d, filter)) ?? null;
  }

  async countDocuments(filter = {}) {
    return this.docs.filter((d) => matches(d, filter)).length;
  }

  // Mongo's distinct(): the set of values a field takes across the matching docs.
  // An absent field contributes nothing (it is not a `null` entry).
  async distinct(field, filter = {}) {
    const out = [];
    for (const d of this.docs) {
      if (!matches(d, filter)) continue;
      const v = d[field];
      if (v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) {
        if (!out.some((x) => eq(x, item))) out.push(item);
      }
    }
    return out;
  }

  async updateOne(filter, update, options = {}) {
    const set = update.$set ?? {};
    const setOnInsert = update.$setOnInsert ?? {};
    const inc = update.$inc ?? {};
    const min = update.$min ?? {};
    const max = update.$max ?? {};
    const addToSet = update.$addToSet ?? {};
    assertNoConflict(update);

    const existing = this.docs.find((d) => matches(d, filter));
    if (existing) {
      Object.assign(existing, set);
      applyAddToSet(existing, addToSet);
      for (const [k, delta] of Object.entries(inc)) existing[k] = (existing[k] ?? 0) + delta;
      // $max only writes when the new value is greater; a missing field is
      // always replaced, matching Mongo.
      for (const [k, v] of Object.entries(max)) {
        if (existing[k] === undefined || existing[k] === null || cmp(v, existing[k]) > 0) existing[k] = v;
      }
      // $min mirrors Mongo exactly, including the trap that makes it worth
      // modelling: an ABSENT field is set, but a field holding null is NOT
      // replaced by a number, because null sorts below every number in BSON
      // ordering. Code that initialises a $min target to null (rather than
      // leaving it out) pins it to null forever, and this fake reproduces that
      // rather than hiding it.
      for (const [k, v] of Object.entries(min)) {
        if (existing[k] === undefined || cmp(v, existing[k]) < 0) existing[k] = v;
      }
      this.assertUnique(existing, existing);
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    }
    if (!options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };

    // Only equality clauses in the filter seed the inserted doc — an operator
    // clause like { field: { $ne: x } } contributes nothing, as in Mongo.
    const seed = {};
    for (const [k, v] of Object.entries(filter)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
          && Object.keys(v).some((op) => op.startsWith('$'))) continue;
      seed[k] = v;
    }
    const doc = { ...seed, ...setOnInsert, ...set };
    applyAddToSet(doc, addToSet);
    for (const [k, delta] of Object.entries(inc)) doc[k] = (doc[k] ?? 0) + delta;
    // $max / $min on a field that does not exist yet just set it.
    for (const [k, v] of Object.entries(max)) doc[k] = v;
    for (const [k, v] of Object.entries(min)) doc[k] = v;
    this.assertUnique(doc);
    this.docs.push(doc);
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
  }

  async deleteMany(filter = {}) {
    const keep = this.docs.filter((d) => !matches(d, filter));
    const deletedCount = this.docs.length - keep.length;
    // Mutate in place — callers hold a reference to this same array.
    this.docs.length = 0;
    this.docs.push(...keep);
    return { acknowledged: true, deletedCount };
  }

  find(filter = {}) {
    let rows = this.docs.filter((d) => matches(d, filter));
    const chain = {
      sort(spec) { rows = sortDocs(rows, spec); return chain; },
      limit(n) { rows = rows.slice(0, n); return chain; },
      project() { return chain; },
      async toArray() { return rows.map((r) => ({ ...r })); },
    };
    return chain;
  }

  aggregate(pipeline = []) {
    const docs = this.docs;
    return {
      async toArray() { return runPipeline(docs, pipeline); },
    };
  }

  // Only { unique: true } is modelled; ordinary indexes change nothing an
  // in-memory array can observe.
  async createIndex(spec = {}, options = {}) {
    if (options.unique) {
      const keys = Object.keys(spec);
      const already = this.uniqueIndexes.some((k) => k.join(',') === keys.join(','));
      if (!already) this.uniqueIndexes.push(keys);
    }
    return 'ok';
  }
}

export function createFakeDb() {
  const store = new Map();
  const indexes = new Map();
  return {
    collection(name) {
      if (!store.has(name)) store.set(name, []);
      if (!indexes.has(name)) indexes.set(name, []);
      return new FakeCollection(store.get(name), indexes.get(name));
    },
    // test-only escape hatch
    _rows(name) { return store.get(name) ?? []; },
  };
}
