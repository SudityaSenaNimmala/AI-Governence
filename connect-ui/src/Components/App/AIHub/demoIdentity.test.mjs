// Pure tests for the AI Hub display-only identity aliasing.
// Run: node --test src/Components/App/AIHub/demoIdentity.test.mjs   (from connect-ui/)
//
// Regression (2026-10-01): the Access Requests page DROPPED every request from a
// device outside the three demo people, so a real, pending request from
// LAPTOP-FCRNKB4 never reached the only page that can approve it — while the
// SideNav badge (raw route) still counted it. Report routes keep dropping;
// the actionable queues keep the row.
import test from "node:test";
import assert from "node:assert/strict";
import { aliasResponse } from "./demoIdentity.js";

const machines = [
  { id: "m-emily", hostname: "EMILY", user: "EmilyRodriguez" },
  { id: "m-laptop", hostname: "LAPTOP-FCRNKB4" },
];
const fetchRaw = async (p) => (p === "/machines" ? machines : []);

const rows = [
  { id: "r1", machine_id: "m-emily", hostname: "Pravallika", employee_name: "Pravallika", tool_host: "claude.ai", status: "pending" },
  { id: "r2", machine_id: "m-laptop", hostname: "LAPTOP-FCRNKB4", employee_name: "LAPTOP-FCRNKB4", user: null, tool_host: "chatgpt.com", status: "pending" },
];

test("access requests from a non-demo device stay in the review queue", async () => {
  const out = await aliasResponse("/access-requests", structuredClone(rows), fetchRaw);
  assert.deepEqual(out.map((r) => r.id), ["r1", "r2"]);
  // The demo person is still aliased…
  assert.equal(out[0].employee_name, "Emily Rodriguez");
  // …and the other row is passed through untouched rather than mis-attributed.
  assert.equal(out[1].employee_name, "LAPTOP-FCRNKB4");
  assert.equal(out[1].status, "pending");
});

test("query strings do not change the route match", async () => {
  const out = await aliasResponse("/access-requests?status=pending", structuredClone(rows), fetchRaw);
  assert.equal(out.length, 2);
});

test("active exceptions are kept too, so every live grant stays revocable", async () => {
  const ex = [{ request_id: "r2", machine_id: "m-laptop", hostname: "LAPTOP-FCRNKB4", employee_name: "LAPTOP-FCRNKB4", tool_host: "chatgpt.com" }];
  const out = await aliasResponse("/access-exceptions", ex, fetchRaw);
  assert.equal(out.length, 1);
});

test("report routes still show only the three demo people", async () => {
  const dlp = [
    { id: "d1", machine_id: "m-emily", hostname: "EMILY", user: "EmilyRodriguez" },
    { id: "d2", machine_id: "m-laptop", hostname: "LAPTOP-FCRNKB4" },
  ];
  const out = await aliasResponse("/dlp", dlp, fetchRaw);
  assert.deepEqual(out.map((r) => r.id), ["d1"]);
});
