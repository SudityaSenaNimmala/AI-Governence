// Batch-join the enrolled person onto rows that only carry a machine_id.
//
// DLP events, findings, agents, etc. are keyed by machine_id (a device hash),
// but the friendly identity (OS username for the desktop agent, signed-in
// email for the browser extension) lives on the `machines` collection. This
// helper attaches `user` + `hostname` so the dashboard can show "who", not a
// hash. A row's own user/hostname (stamped at ingest) always wins over the
// machine lookup, which also correctly covers shared machines.
//
// It also attaches `employee_name` from `employee_profiles.display_name` — the
// same admin-curated identity access-requests already renders. A raw OS
// username like "Pravallikapunumalli" has no case or delimiter boundary a
// client can split on ("SudityaNimmala" only works because of the camelCase
// hint); the curated profile name, built from the person's email when one is
// on file, is the reliable source for "Pravallika Punumalli" instead.

export async function attachMachineIdentity(db, rows, idKey = 'machine_id') {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const ids = [...new Set(rows.map((r) => r?.[idKey]).filter(Boolean))];
  if (ids.length === 0) return rows;

  const [machines, profiles] = await Promise.all([
    db.collection('machines')
      .find({ id: { $in: ids } })
      .project({ _id: 0, id: 1, user: 1, hostname: 1 })
      .toArray(),
    db.collection('employee_profiles')
      .find({ machine_ids: { $in: ids } })
      .project({ _id: 0, machine_ids: 1, display_name: 1 })
      .toArray(),
  ]);
  const machineMap = new Map(machines.map((m) => [m.id, m]));
  const nameMap = new Map();
  for (const p of profiles) {
    if (!p.display_name) continue;
    for (const mid of p.machine_ids || []) nameMap.set(mid, p.display_name);
  }

  for (const r of rows) {
    const m = machineMap.get(r?.[idKey]);
    if (r.user == null) r.user = m?.user ?? null;
    if (r.hostname == null) r.hostname = m?.hostname ?? null;
    const name = nameMap.get(r?.[idKey]);
    if (name && r.employee_name == null) r.employee_name = name;
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
