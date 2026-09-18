// An agent-scoped block must offer Request Access, the same way a whole-host
// block always has.
//
// THE GAP THIS CLOSES. content.js has had two block UI paths for a while:
//   showPlatformBlockPopup()  → whole HOST blocked (all of claude.ai). Renders
//                               showCfaiPopup's requestAccess branch: a reason
//                               textarea and a Submit button wired to
//                               chrome.runtime.sendMessage({kind:'access_request'}).
//   enforceBlockedAgent()     → ONE named agent blocked inside a host app the
//                               employee still needs (a Copilot Studio agent in
//                               Teams). Raised showWarning() — a dismiss-only
//                               toast with no button at all.
// So the narrower, more common block was the one with no way to ask for access,
// and nothing on screen suggested asking was even possible.
//
// TWO PROPERTIES THIS FILE EXISTS TO HOLD:
//  1. The request names the ONE agent, so an approval can be narrowed to it.
//     Sent host-only it reads as "please unblock all of Teams", which is both
//     wrong and the sort of thing an approver says yes to too quickly.
//  2. The agent identity comes from the ADMIN-TYPED blocklist row and from
//     nowhere else. isBlockedAgentActive() scrapes the page header to decide
//     WHETHER a row matched (getHeaderAgentText), and none of that scraped text
//     may ride out in the payload — the desktop enforcer holds the same line for
//     foreground window titles.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadAgentBlockRequest, blockedRow } from './load-agent-block-request.mjs';

const CONTENT = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content', 'content.js'),
  'utf8',
);

// ── The popup itself ────────────────────────────────────────────────────────

test('a send attempt on a blocked agent opens the reason box, not a bare toast', () => {
  const ui = loadAgentBlockRequest();
  ui.showBlockedAgentPopup(blockedRow());

  assert.equal(ui.warnings.length, 0, 'the dismiss-only toast is no longer the whole response');
  assert.equal(ui.popups.length, 1);
  const opts = ui.popups[0];
  assert.equal(opts.hardBlock, true, 'it stays up until the user acts');
  assert.deepEqual(opts.matches, [], 'no DLP chips — nothing was scanned, the agent is disallowed');
  assert.ok(opts.requestAccess, 'the Request Access branch of showCfaiPopup is what renders the textarea');
});

test('the popup names the SPECIFIC agent, not just the app', () => {
  const ui = loadAgentBlockRequest({ hostname: 'teams.microsoft.com' });
  ui.showBlockedAgentPopup(blockedRow({ agent_name: 'Finance Approvals Bot' }));

  const opts = ui.popups[0];
  assert.match(opts.title, /Finance Approvals Bot/, 'the employee must be told WHICH agent is blocked');
  assert.doesNotMatch(opts.title, /teams\.microsoft\.com/, 'the host app is not what was blocked');
  // And it must say so, because the input fields are visibly disabled and the
  // obvious reading of that is "Teams is broken".
  assert.match(opts.body, /rest of this app are unaffected/i);
});

test('the request is agent-scoped and carries the agent identity', () => {
  const ui = loadAgentBlockRequest({ hostname: 'teams.microsoft.com' });
  ui.showBlockedAgentPopup(blockedRow({ agent_id: 'agt-7f3c', agent_name: 'IT Help Desk Agent' }));

  const req = ui.popups[0].requestAccess;
  assert.equal(req.block_scope, 'agent');
  assert.equal(req.agent_id, 'agt-7f3c');
  assert.equal(req.agent_name, 'IT Help Desk Agent');
  // tool_host is the host app the agent is published into — what an approved
  // exception is granted against, and what the server pairs with agent_name for
  // "IT Help Desk Agent (teams.microsoft.com)" in the approval queue.
  assert.equal(req.tool_host, 'teams.microsoft.com');
  // agent_key is server-derived and ignored if sent; sending one would look like
  // the client had a say in the match key.
  assert.equal('agent_key' in req, false);
});

test('a row with only a name still asks — agent_name alone satisfies the server', () => {
  const ui = loadAgentBlockRequest();
  ui.showBlockedAgentPopup(blockedRow({ agent_id: '', agent_name: 'Gemini Conversation Agent 1' }));

  const req = ui.popups[0].requestAccess;
  assert.equal(req.block_scope, 'agent');
  assert.equal(req.agent_name, 'Gemini Conversation Agent 1');
  assert.equal(req.agent_id, null, 'absent, not an empty string');
});

test('a row with NO identity at all falls back to the notice — never a button that 400s', () => {
  // POST /api/v1/access-requests refuses block_scope:'agent' with neither
  // agent_id nor agent_name (it would grant the whole app on approval). Offering
  // Submit here would be offering a guaranteed failure.
  const ui = loadAgentBlockRequest();
  ui.showBlockedAgentPopup(blockedRow({ agent_id: '', agent_name: '' }));

  assert.equal(ui.popups.length, 0);
  assert.equal(ui.warnings.length, 1, 'the user is still told the send was refused');
  assert.match(ui.warnings[0].title, /blocked by organization policy/i);
});

test('with access_requests disabled on the server, the block degrades to the old toast', () => {
  const ui = loadAgentBlockRequest({ features: { access_requests: false } });
  ui.showBlockedAgentPopup(blockedRow());

  assert.equal(ui.popups.length, 0, 'a disabled feature must not render its UI');
  assert.equal(ui.warnings.length, 1);
});

// ── One popup per block session ─────────────────────────────────────────────

test('a second send attempt does not tear down a popup the user is typing in', () => {
  const ui = loadAgentBlockRequest();
  ui.showBlockedAgentPopup(blockedRow());
  assert.equal(ui.popups.length, 1);

  ui.state.modalOpen = true;           // existingCfaiModal() now finds ours
  ui.showBlockedAgentPopup(blockedRow());
  ui.showBlockedAgentPopup(blockedRow());

  assert.equal(ui.popups.length, 1, 'these handlers fire per Enter press — re-rendering would eat the reason text');
  assert.equal(ui.warnings.length, 0, 'and it must not stack a toast on top of the open modal either');
});

test('once a request is filed for that agent, later attempts show the notice instead of the form', () => {
  const ui = loadAgentBlockRequest();
  const row = blockedRow();
  ui.showBlockedAgentPopup(row);
  ui.popups[0].requestAccess.onSubmitted();      // what the Submit handler calls on 201

  ui.showBlockedAgentPopup(row);
  assert.equal(ui.popups.length, 1, 're-offering the form would only earn a 409');
  assert.equal(ui.warnings.length, 1);
});

test('a pending request for agent A does not gag the ask about agent B on the same host', () => {
  // The server keys pending/cooldown on agent_key for exactly this reason, so the
  // client-side pre-check must be keyed the same way or it re-introduces the bug.
  const ui = loadAgentBlockRequest();
  ui.showBlockedAgentPopup(blockedRow({ agent_id: 'agt-A', agent_name: 'Agent A' }));
  ui.popups[0].requestAccess.onSubmitted();

  ui.showBlockedAgentPopup(blockedRow({ agent_id: 'agt-B', agent_name: 'Agent B' }));
  assert.equal(ui.popups.length, 2);
  assert.equal(ui.popups[1].requestAccess.agent_id, 'agt-B');
});

test('the pending key is per agent identity, and name matching is case-insensitive', () => {
  const ui = loadAgentBlockRequest();
  assert.equal(ui.agentBlockKey({ agent_id: 'agt-1', agent_name: 'X' }), 'id:agt-1',
    'the id wins when there is one — display names get renamed');
  assert.equal(ui.agentBlockKey({ agent_id: '', agent_name: '  IT Help Desk  ' }), 'name:it help desk');
  assert.equal(ui.agentBlockKey({ agent_id: '', agent_name: 'IT HELP DESK' }), 'name:it help desk');
  assert.equal(ui.agentBlockKey({}), '', 'no identity ⇒ no key, which is what routes to the notice');
});

// ── The message the popup ends up sending ───────────────────────────────────

test('showCfaiPopup forwards the agent fields on the SAME message channel', () => {
  // Pinned on source: the send lives inside showCfaiPopup's Submit handler,
  // behind chrome.runtime.sendMessage and a live DOM, which is not sliceable.
  // What matters is that no second channel was invented for agent requests.
  const at = CONTENT.indexOf("kind: 'access_request'");
  assert.ok(at > 0, 'the access_request message must still be built in content.js');
  const block = CONTENT.slice(at, at + 1400);
  assert.match(block, /message\.block_scope = opts\.requestAccess\.block_scope/);
  assert.match(block, /message\.agent_id = opts\.requestAccess\.agent_id/);
  assert.match(block, /message\.agent_name = opts\.requestAccess\.agent_name/);
  assert.equal(
    (CONTENT.match(/chrome\.runtime\.sendMessage\(message,/g) || []).length, 1,
    'one send site, shared by the host block and the agent block',
  );
});

test('each new field is conditional, so a whole-host request keeps its exact shape', () => {
  // showPlatformBlockPopup() passes no block_scope / agent_id / agent_name, and
  // an `agent_id: undefined` key in the JSON body is not the same thing as no key
  // at all once anything downstream starts reading Object.keys.
  const at = CONTENT.indexOf("kind: 'access_request'");
  const block = CONTENT.slice(at, at + 1400);
  for (const field of ['block_scope', 'agent_id', 'agent_name']) {
    assert.match(
      block,
      new RegExp(`if \\(opts\\.requestAccess\\.${field}\\) message\\.${field} =`),
      `${field} must only be set when the caller supplied it`,
    );
  }
});

// ── Nothing scraped from the page may leave ────────────────────────────────

test('the popup reads the blocklist row and never the live page header', () => {
  const from = CONTENT.indexOf('// ── Agent-block Request Access ─');
  const to = CONTENT.indexOf('// ── end agent-block Request Access ─');
  // CODE ONLY. The region's own commentary explains why it must not read the
  // page, and naming the forbidden calls there would otherwise fail this test.
  const code = CONTENT.slice(from, to).replace(/^\s*\/\/.*$/gm, '');

  // getHeaderAgentText() is how isBlockedAgentActive() decides WHETHER a row
  // matched. Its output is a lowercased concatenation of document.title and
  // whatever strings sit in the customer's top bar — uploading that would be
  // shipping page content to the governance server under a policy field's name.
  assert.doesNotMatch(code, /getHeaderAgentText/);
  assert.doesNotMatch(code, /document\.(title|querySelector)/);
  assert.doesNotMatch(code, /textContent|innerText/);
});

test('the two send-attempt handlers route to the popup, and only they were touched', () => {
  // Deliberately still ONE call site each (Enter, send-button click) — this
  // feature adds no new detection, it re-uses the handlers the block already
  // installs.
  assert.equal((CONTENT.match(/showBlockedAgentPopup\(activeBlocked\)/g) || []).length, 2,
    'the Enter handler and the send-button handler');
  const from = CONTENT.indexOf('function enforceBlockedAgent()');
  const to = CONTENT.indexOf('// Load blocked list from cache IMMEDIATELY');
  const enforcer = CONTENT.slice(from, to);
  assert.doesNotMatch(enforcer, /showWarning\(/,
    'the blocked-agent handlers go through showBlockedAgentPopup, which falls back to showWarning itself');
});

test("our own modal's clicks and Enter presses are not treated as send attempts", () => {
  // The reason box lives inside the same document as the agent whose input is
  // being blocked, and both handlers are capture-phase on `document`. Without
  // this guard, Enter in the textarea and the click on Submit are cancelled by
  // the very block the form exists to appeal.
  const from = CONTENT.indexOf('// Block Enter key at capture phase');
  const to = CONTENT.indexOf('} else {\n      // Restore inputs when not on a blocked agent');
  const handlers = CONTENT.slice(from, to > from ? to : from + 3000);
  assert.equal((handlers.match(/isCfaiOwnUiEvent\(e\)/g) || []).length, 2,
    'both the keydown and the click handler must exempt our own UI');
});

test('the 500ms input disabler skips our own UI', () => {
  // The disabler's selector ('textarea, [contenteditable="true"], …') matches the
  // reason textarea too, and it re-runs twice a second — in the light-DOM modal
  // fallback it would set pointer-events:none on the box the user was just
  // invited to type into.
  const from = CONTENT.indexOf('function enforceBlockedAgent()');
  const block = CONTENT.slice(from, from + 2000);
  assert.match(block, /closest\(MODAL_HOST_SELECTOR \+ ', \.cfai-toast'\)/);
});
