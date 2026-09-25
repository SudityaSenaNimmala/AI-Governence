// Latency wrapper over the in-memory fake Db (helpers/fake-db.mjs).
//
// The response-budget work is entirely about WAITING: a route that issues six
// round trips sequentially is slow for a reason no amount of seeded data
// reproduces — fake-db answers everything in microseconds, so a sequential route
// and a Promise.all one measure identically against it. This wrapper puts a real
// delay in front of each terminal database operation, which is what makes
// "6 round trips" and "1 round trip's worth of wall time" distinguishable in a
// test.
//
// TERMINAL OPERATIONS ONLY. The delay is attached to the call that actually
// reaches the database (toArray, countDocuments, distinct, findOne, the writes)
// and NOT to query-builder chaining (find().sort().limit().project()), which in
// the driver costs nothing and issues nothing. Delaying the builder would make a
// route look slow in proportion to how it spells its query rather than to how
// many times it talks to the database, which is the opposite of what these tests
// are measuring.
//
// It also records concurrency, so a test can assert the round trips actually
// OVERLAPPED rather than inferring it from wall-clock arithmetic alone:
//   db.__latency.calls           terminal operations issued
//   db.__latency.maxConcurrent   most operations in flight at once
// A sequential route pins maxConcurrent at 1 however fast the machine is, which
// makes the assertion immune to CI timing noise in a way a pure duration check
// is not.

const TERMINAL_OPS = new Set([
  'insertOne', 'insertMany', 'findOne', 'countDocuments', 'distinct',
  'updateOne', 'updateMany', 'bulkWrite', 'deleteOne', 'deleteMany',
  'createIndex', 'indexes', 'drop',
]);

const CURSOR_FACTORIES = new Set(['find', 'aggregate']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {object} db      a createFakeDb() handle
 * @param {number} ms      latency added to every terminal operation
 * @returns {object}       the same handle, with latency and call accounting
 */
export function withLatency(db, ms) {
  const stats = { calls: 0, inFlight: 0, maxConcurrent: 0, byCollection: new Map() };

  const timed = async (collectionName, run) => {
    stats.calls += 1;
    stats.byCollection.set(collectionName, (stats.byCollection.get(collectionName) ?? 0) + 1);
    stats.inFlight += 1;
    if (stats.inFlight > stats.maxConcurrent) stats.maxConcurrent = stats.inFlight;
    try {
      await sleep(ms);
      return await run();
    } finally {
      stats.inFlight -= 1;
    }
  };

  // A cursor's chaining methods return the cursor itself in both the driver and
  // the fake, so re-wrap whatever comes back when it is the same object; only
  // toArray() pays the latency.
  const wrapCursor = (collectionName, cursor) => {
    const proxy = new Proxy(cursor, {
      get(target, prop) {
        const value = target[prop];
        if (typeof value !== 'function') return value;
        if (prop === 'toArray') {
          return (...args) => timed(collectionName, () => value.apply(target, args));
        }
        return (...args) => {
          const out = value.apply(target, args);
          return out === target ? proxy : out;
        };
      },
    });
    return proxy;
  };

  const wrapCollection = (name, collection) => new Proxy(collection, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function') return value;
      if (TERMINAL_OPS.has(prop)) {
        return (...args) => timed(name, () => value.apply(target, args));
      }
      if (CURSOR_FACTORIES.has(prop)) {
        return (...args) => wrapCursor(name, value.apply(target, args));
      }
      return (...args) => value.apply(target, args);
    },
  });

  return new Proxy(db, {
    get(target, prop) {
      if (prop === '__latency') return stats;
      if (prop === 'collection') {
        return (name) => wrapCollection(name, target.collection(name));
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
