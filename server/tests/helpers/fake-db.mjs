// Minimal in-memory stand-in for the Mongo `Db` handle the routes receive.
// Implements only the operations this codebase's read and write paths use:
// insertOne, insertMany, findOne, updateOne (with $set / $setOnInsert / $inc /
// $min / $max / $addToSet + upsert), updateMany, bulkWrite (updateOne ops only),
// a find() chain, countDocuments, distinct, deleteOne, deleteMany, and a small aggregate()
// pipeline interpreter.
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
// Dotted field paths, so a second $group stage can key on '$_id.machine_id' the
// way the aggregation framework does. Without this, `doc['_id.machine_id']` is
// undefined and every document collapses into one group keyed on undefined —
// silently wrong, which is exactly what this file promises not to do.
function getPath(doc, path) {
  return path.split('.').reduce((v, k) => (v === null || v === undefined ? undefined : v[k]), doc);
}

function resolve(expr, doc) {
  if (typeof expr === 'string' && expr.startsWith('$')) return getPath(doc, expr.slice(1));

  if (expr && typeof expr === 'object' && !Array.isArray(expr) && !(expr instanceof Date)) {
    const keys = Object.keys(expr);
    const ops = keys.filter((k) => k.startsWith('$'));
    if (ops.length > 0) {
      if (keys.length > 1) throw new Error(`fake-db: mixed operator/literal expression {${keys.join(', ')}}`);
      return applyExprOperator(ops[0], expr[ops[0]], doc);
    }
    // A literal document of sub-expressions — how a compound $group _id is
    // written, e.g. { machine_id: '$machine_id', tool_key: '$tool_key' }. This
    // used to fall through to `return expr`, so the group key was the SPEC rather
    // than the values and every document landed in a single group.
    return Object.fromEntries(keys.map((k) => [k, resolve(expr[k], doc)]));
  }

  return expr;
}

function applyExprOperator(op, arg, doc) {
  switch (op) {
    case '$ifNull': {
      const [value, fallback] = arg;
      const v = resolve(value, doc);
      return v === null || v === undefined ? resolve(fallback, doc) : v;
    }
    // Numeric coercion with explicit onError/onNull, which is how the analytics
    // rollups sum fields that have occasionally been stored as strings.
    case '$convert': {
      const v = resolve(arg.input, doc);
      const onError = () => {
        if ('onError' in arg) return resolve(arg.onError, doc);
        throw new Error(`fake-db: $convert to '${arg.to}' failed and no onError was given`);
      };
      if (v === null || v === undefined) {
        return 'onNull' in arg ? resolve(arg.onNull, doc) : null;
      }
      if (['double', 'decimal', 'int', 'long'].includes(arg.to)) {
        // Mongo errors on a non-numeric string; JS Number('') would say 0.
        if (typeof v === 'string' && v.trim() === '') return onError();
        const n = Number(v);
        if (!Number.isFinite(n)) return onError();
        return arg.to === 'int' || arg.to === 'long' ? Math.trunc(n) : n;
      }
      if (arg.to === 'string') return String(v);
      throw new Error(`fake-db: unsupported $convert target '${arg.to}'`);
    }
    // Branching + comparison. Needed by a $group that counts a SUBSET of the
    // matched documents ($sum with $cond) — the shape that lets one aggregation
    // replace several countDocuments calls, so a route can stop issuing one query
    // per row. Ordering comes from the same cmp() the query side uses.
    case '$cond': {
      // Both spellings: [if, then, else] and { if, then, else }.
      const [ifExpr, thenExpr, elseExpr] = Array.isArray(arg)
        ? arg
        : [arg.if, arg.then, arg.else];
      return resolve(ifExpr, doc) ? resolve(thenExpr, doc) : resolve(elseExpr, doc);
    }
    case '$eq':  return eq(resolve(arg[0], doc), resolve(arg[1], doc));
    case '$ne':  return !eq(resolve(arg[0], doc), resolve(arg[1], doc));
    case '$gt':  return cmp(resolve(arg[0], doc), resolve(arg[1], doc)) > 0;
    case '$gte': return cmp(resolve(arg[0], doc), resolve(arg[1], doc)) >= 0;
    case '$lt':  return cmp(resolve(arg[0], doc), resolve(arg[1], doc)) < 0;
    case '$lte': return cmp(resolve(arg[0], doc), resolve(arg[1], doc)) <= 0;
    // $in as an EXPRESSION: is operand 0 a member of the array in operand 1.
    // Deliberately NOT the query operator of the same name — that one asks the
    // mirror-image question about an array FIELD and lives in matchesValue().
    // Conflating the two is exactly the silent-wrong-answer this file refuses.
    case '$in': {
      const needle = resolve(arg[0], doc);
      const haystack = resolve(arg[1], doc);
      if (!Array.isArray(haystack)) {
        throw new Error('fake-db: the $in expression needs an array as its second operand');
      }
      return haystack.some((v) => eq(needle, v));
    }
    default:
      throw new Error(`fake-db: unsupported aggregation operator ${op}`);
  }
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

// Mongo's default index name: each key joined with its direction, e.g.
// { machine_id: 1, occurred_at: -1 } → 'machine_id_1_occurred_at_-1'.
function indexName(spec) {
  return Object.entries(spec).map(([k, dir]) => `${k}_${dir}`).join('_');
}

class FakeCollection {
  constructor(docs, uniqueIndexes, indexSpecs, onDrop = () => {}) {
    this.docs = docs;
    this.uniqueIndexes = uniqueIndexes;
    this.indexSpecs = indexSpecs;
    this.onDrop = onDrop;
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

  // Real insertMany rejects an empty list rather than no-op'ing, and so does this
  // one: a caller that has to guard the empty case should fail its test if the
  // guard is ever dropped, not pass quietly.
  async insertMany(docs) {
    if (!Array.isArray(docs) || docs.length === 0) {
      throw new Error('fake-db: insertMany needs a non-empty document list');
    }
    for (const doc of docs) {
      this.assertUnique(doc);
      this.docs.push({ ...doc });
    }
    return { acknowledged: true, insertedCount: docs.length };
  }

  // Only the updateOne form, which is the one this codebase writes. Anything else
  // throws rather than being quietly skipped — a bulkWrite that silently ignored
  // half its operations would look like a successful write.
  async bulkWrite(ops) {
    if (!Array.isArray(ops) || ops.length === 0) {
      throw new Error('fake-db: bulkWrite needs a non-empty operation list');
    }
    let matchedCount = 0, modifiedCount = 0, upsertedCount = 0;
    for (const op of ops) {
      const kinds = Object.keys(op);
      if (kinds.length !== 1) {
        throw new Error(`fake-db: each bulkWrite op needs exactly one verb, got ${kinds.join(', ') || 'none'}`);
      }
      if (kinds[0] !== 'updateOne') {
        throw new Error(`fake-db: bulkWrite supports updateOne only, got ${kinds[0]}`);
      }
      const { filter, update, upsert } = op.updateOne;
      const r = await this.updateOne(filter, update, { upsert: !!upsert });
      matchedCount += r.matchedCount;
      modifiedCount += r.modifiedCount;
      upsertedCount += r.upsertedCount;
    }
    return { matchedCount, modifiedCount, upsertedCount };
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

  // Every matching doc, no upsert (Mongo's updateMany can upsert, but nothing in
  // this codebase asks it to and modelling a shape no caller uses would only
  // invite a test to rely on it). Deliberately narrower than updateOne: only the
  // operators a caller actually reaches for here are supported, and anything
  // else throws rather than quietly doing nothing.
  async updateMany(filter = {}, update = {}) {
    assertNoConflict(update);
    const unsupported = Object.keys(update).filter((k) => k !== '$set');
    if (unsupported.length) {
      throw new Error(`fake-db: updateMany supports $set only, got ${unsupported.join(', ')}`);
    }
    const set = update.$set ?? {};
    const hits = this.docs.filter((d) => matches(d, filter));
    for (const d of hits) Object.assign(d, set);
    for (const d of hits) this.assertUnique(d, d);
    return { matchedCount: hits.length, modifiedCount: hits.length, upsertedCount: 0 };
  }

  // First match only, like the driver. Its absence was a real gap: the routing
  // routes and the routing seeder both delete by id, so any test touching them
  // failed with "deleteOne is not a function" rather than exercising the code.
  async deleteOne(filter = {}) {
    const i = this.docs.findIndex((d) => matches(d, filter));
    if (i < 0) return { acknowledged: true, deletedCount: 0 };
    this.docs.splice(i, 1);
    return { acknowledged: true, deletedCount: 1 };
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

  // Only { unique: true } is modelled behaviourally; ordinary indexes change
  // nothing an in-memory array can observe. Every declaration is still RECORDED
  // so indexes() can answer "was this index declared", which is the only thing a
  // schema test can meaningfully assert about a non-unique index.
  async createIndex(spec = {}, options = {}) {
    if (options.unique) {
      const keys = Object.keys(spec);
      const already = this.uniqueIndexes.some((k) => k.join(',') === keys.join(','));
      if (!already) this.uniqueIndexes.push(keys);
    }
    const name = options.name || indexName(spec);
    if (!this.indexSpecs.some((i) => i.name === name)) {
      this.indexSpecs.push({ v: 2, key: { ...spec }, name, ...(options.unique ? { unique: true } : {}) });
    }
    return name;
  }

  // Shaped like the driver's: the implicit _id_ index first, then the declared
  // ones in declaration order.
  async indexes() {
    return [{ v: 2, key: { _id: 1 }, name: '_id_' }, ...this.indexSpecs.map((i) => ({ ...i }))];
  }

  // Real drop() removes the collection itself, not just its documents — a
  // subsequent listCollections() must not report it.
  async drop() {
    this.docs.length = 0;
    this.indexSpecs.length = 0;
    this.uniqueIndexes.length = 0;
    this.onDrop();
    return true;
  }
}

export function createFakeDb() {
  const store = new Map();
  const indexes = new Map();
  const indexSpecs = new Map();
  const db = {
    collection(name) {
      if (!store.has(name)) store.set(name, []);
      if (!indexes.has(name)) indexes.set(name, []);
      if (!indexSpecs.has(name)) indexSpecs.set(name, []);
      return new FakeCollection(
        store.get(name), indexes.get(name), indexSpecs.get(name),
        () => { store.delete(name); indexes.delete(name); indexSpecs.delete(name); },
      );
    },
    // Only the { nameOnly: true } shape any caller in this repo uses.
    listCollections() {
      return { async toArray() { return [...store.keys()].map((name) => ({ name })); } };
    },
    // test-only escape hatch
    _rows(name) { return store.get(name) ?? []; },
  };
  return db;
}
