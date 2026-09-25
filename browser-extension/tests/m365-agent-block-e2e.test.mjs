// Does the SHIPPED panel reader + isBlockedAgentActive actually block a real
// blocked agent on a real M365 host? Driven with the exact selectors the server
// serves and the exact row shape /api/lifecycle/blocked-agents returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPanelAgentLabel, loadBlockedAgentActive, el, doc } from './load-panel-agent-label.mjs';

// Exactly what GET /api/v1/ai-surfaces serves today for teams.microsoft.com.
const SERVED = {
  embedded: {
    'teams.microsoft.com': {
      product: 'Teams Copilot',
      selectors: ['[aria-label*="Copilot" i]', '[data-tid*="copilot" i]'],
      agentLabelSelectors: [
        '.fai-CopilotMessage__accessibleHeading',
        '.fai-AiGeneratedDisclaimer',
        '[aria-selected="true"][role="option"]',
        '[role="combobox"][aria-expanded]',
      ],
    },
  },
};

// The real row, as the extension receives it from the server.
const BLOCKED = [{
  agent_id: '44ba298c-c12d-f111-88b4-6045bd08b5e6',
  agent_name: 'IT Help Desk Agent',
  platform: 'copilot_studio',
  agent_scope: 'agent',
}];

const heading = (text) =>
  el({ tag: 'div', className: 'fai-CopilotMessage__accessibleHeading', text });

function teamsDom(labelText) {
  const composer = el({ tag: 'div', id: 'panel-composer', attrs: { role: 'textbox' } });
  const kids = labelText == null ? [composer] : [heading(labelText), composer];
  const panel = el({
    tag: 'div', id: 'copilot-panel', visible: true,
    attrs: { 'aria-label': 'Copilot chat' },
    children: kids,
  });
  return { panel, document: doc([panel]) };
}

const run = (labelText, flagOn = true) => {
  const f = teamsDom(labelText);
  const reader = loadPanelAgentLabel({
    host: 'teams.microsoft.com', document: f.document, synced: SERVED, flagOn,
  });
  const api = loadBlockedAgentActive({
    host: 'teams.microsoft.com',
    blockedList: BLOCKED,
    // The header does NOT name the agent on M365 — this is the whole problem.
    headerText: 'Chat | Microsoft 365 Copilot',
    panelLabels: () => reader.openPanelAgentLabels(),
  });
  return { reader, api, panels: reader.aiPanels().length };
};

test('the pane resolves and the reader finds the agent name (bare name)', () => {
  const r = run('IT Help Desk Agent');
  console.log('  panels:', r.panels, '| labels:', JSON.stringify(r.reader.openPanelAgentLabels()));
  assert.ok(r.panels > 0, 'the Copilot pane must resolve');
  assert.ok(r.reader.openPanelAgentLabels().length > 0);
});

test('END TO END: blocked agent open in the Teams Copilot pane IS matched', () => {
  const r = run('IT Help Desk Agent');
  const hit = r.api.isBlockedAgentActive();
  console.log('  isBlockedAgentActive ->', hit ? hit.agent_name : 'null');
  assert.ok(hit, 'header cannot see it — the panel read must');
  assert.equal(hit.agent_name, 'IT Help Desk Agent');
});

test('LIVE-MEASURED SHAPE: heading is "<Agent> said:" — must still match', () => {
  // This is what was actually measured on the Teams client, not a bare name.
  const r = run('IT Help Desk Agent said:');
  const labels = r.reader.openPanelAgentLabels();
  const hit = r.api.isBlockedAgentActive();
  console.log('  labels:', JSON.stringify(labels), '| blocked:', hit ? 'YES' : 'NO');
  assert.ok(hit, 'the real heading shape carries a " said:" suffix and must still match');
});

test('FLAG OFF reproduces exactly what the user saw — no block', () => {
  const r = run('IT Help Desk Agent', false);
  console.log('  flag off -> labels', JSON.stringify(r.reader.openPanelAgentLabels()),
              '| blocked:', r.api.isBlockedAgentActive() ? 'YES' : 'NO');
  assert.equal(r.api.isBlockedAgentActive(), null);
});

test('a DIFFERENT agent open in the pane is NOT blocked', () => {
  const r = run('Finance Approvals Bot said:');
  console.log('  other agent ->', JSON.stringify(r.reader.openPanelAgentLabels()),
              '| blocked:', r.api.isBlockedAgentActive() ? 'YES' : 'NO');
  assert.equal(r.api.isBlockedAgentActive(), null, 'only the blocked agent may match');
});

test('NO pane open — nothing is blocked, the standing invariant', () => {
  const r = run(null);
  console.log('  empty pane ->', JSON.stringify(r.reader.openPanelAgentLabels()),
              '| blocked:', r.api.isBlockedAgentActive() ? 'YES' : 'NO');
  assert.equal(r.api.isBlockedAgentActive(), null);
});
