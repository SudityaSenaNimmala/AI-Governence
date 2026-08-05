// Batch-join the enrolled person onto rows that only carry a machine_id.
//
// DLP events, findings, agents, etc. are keyed by machine_id (a device hash),
// but the friendly identity (OS username for the desktop agent, signed-in
// email for the browser extension) lives on the `machines` collection. This
// helper attaches `user` + `hostname` so the dashboard can show "who", not a
// hash. A row's own user/hostname (stamped at ingest) always wins over the
// machine lookup, which also correctly covers shared machines.

export async function attachMachineIdentity(db, rows, idKey = 'machine_id') {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const ids = [...new Set(rows.map((r) => r?.[idKey]).filter(Boolean))];
  if (ids.length === 0) return rows;

  const machines = await db.collection('machines')
    .find({ id: { $in: ids } })
    .project({ _id: 0, id: 1, user: 1, hostname: 1 })
    .toArray();
  const map = new Map(machines.map((m) => [m.id, m]));

  for (const r of rows) {
    const m = map.get(r?.[idKey]);
    if (r.user == null) r.user = m?.user ?? null;
    if (r.hostname == null) r.hostname = m?.hostname ?? null;
  }
  return rows;
}

// Resolve the enrolled identity for a single machine id (used at ingest so the
// person is stored on each event, not just resolved at read time).
export async function machineIdentity(db, machineId) {
  if (!machineId) return { user: null, hostname: null };
  const m = await db.collection('machines').findOne(
    { id: machineId },
    { projection: { _id: 0, user: 1, hostname: 1 } },
  );
  return { user: m?.user ?? null, hostname: m?.hostname ?? null };
}
