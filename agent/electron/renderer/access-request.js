// Request Access dialog — shown when the organization has blocked this AI
// desktop app OUTRIGHT (a platform block), not because of anything in the
// message. See showAccessRequestWindow() in main.js for why this window, unlike
// the Tokenize & Send popup, is allowed to take focus.
//
// It only ever receives the block's identity: {app, tool_host, tool_name,
// tool_vendor, blocked_agent, blocked_platform, agent_id, process_name}. No
// prompt content, no preview, no filename — a platform block never inspected
// the message, so there is nothing about it to show.
//
// The reason the user types here is passed to the main process and goes straight
// into the POST body. It is never scanned by the DLP watchers (this is a normal
// Electron window and the Electron app is not in AI_PROCESSES, so the enforcer's
// keystroke capture — gated on _fgIsAi — and the clipboard watcher both ignore
// it), never logged, and never written anywhere except the offline queue file.

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// Mirrors REASON_MAX in main.js and the server's own cap. Enforced three times
// on purpose: the textarea attribute stops typing past it, the slice below
// stops a paste from exceeding it, and the server does not trust either.
const REASON_MAX = 500;

const $root = document.getElementById('dialog-root');
let current = null;

function relTime(value) {
  const t = Date.parse(value || '');
  if (!Number.isFinite(t)) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function shell(bodyHtml) {
  const name = current?.tool_name || current?.blocked_agent || current?.app || 'This AI app';
  return `
    <div class="block-dialog-icon">🚫</div>
    <h3>${escapeHtml(name)} is blocked</h3>
    <p>Your organization has disallowed this AI app on this device. Nothing you type here can be sent.</p>
    <div class="pattern-chip">${escapeHtml(current?.blocked_agent || name)}</div>
    ${bodyHtml}`;
}

function renderForm(note) {
  $root.innerHTML = shell(`
    ${note ? `<p class="ar-note">${escapeHtml(note)}</p>` : ''}
    <div class="ar-field">
      <label class="ar-label" for="reason">Why do you need access? (optional)</label>
      <textarea id="reason" class="ar-textarea" maxlength="${REASON_MAX}"
        placeholder="e.g. Drafting the customer migration runbook — no customer data involved."></textarea>
      <div class="ar-counter" id="counter">0 / ${REASON_MAX}</div>
    </div>
    <div class="actions">
      <button type="button" class="btn-tokenize" id="btn-submit">Request access</button>
      <button type="button" class="btn-dismiss" id="btn-cancel">Not now</button>
    </div>
    <div class="footnote" id="footnote">Your administrator decides, and any access they grant expires automatically.</div>`);

  const $reason = document.getElementById('reason');
  const $counter = document.getElementById('counter');
  $reason.addEventListener('input', () => {
    if ($reason.value.length > REASON_MAX) $reason.value = $reason.value.slice(0, REASON_MAX);
    $counter.textContent = `${$reason.value.length} / ${REASON_MAX}`;
  });
  $reason.focus();

  document.getElementById('btn-cancel').addEventListener('click', () => window.close());
  document.getElementById('btn-submit').addEventListener('click', async () => {
    const btn = document.getElementById('btn-submit');
    const $footnote = document.getElementById('footnote');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    const res = await window.api.submitAccessRequest({
      tool_host: current?.tool_host,
      tool_name: current?.tool_name || current?.app,
      tool_vendor: current?.tool_vendor,
      platform: current?.blocked_platform,
      process_name: current?.process_name,
      agent_id: current?.agent_id,
      reason: $reason.value.slice(0, REASON_MAX),
    });

    if (res?.ok) { renderSubmitted(res.queued === true); return; }

    btn.disabled = false;
    btn.textContent = 'Request access';
    $footnote.textContent = res?.error || 'Could not submit the request.';
    $footnote.style.color = 'var(--danger)';
    // A rejected-within-24h answer is final for now, so stop offering Submit.
    if (res?.code === 'recently_rejected' || res?.code === 'pending') {
      btn.style.display = 'none';
      document.getElementById('btn-cancel').textContent = 'Close';
    }
  });
}

function renderSubmitted(queued) {
  $root.innerHTML = shell(`
    <p>${queued
      ? 'Saved. This device is offline, so the request will be sent automatically as soon as it can reach the server.'
      : 'Request sent. Your administrator will review it.'}</p>
    <div class="actions">
      <button type="button" class="btn-dismiss" id="btn-close">Close</button>
    </div>
    <div class="footnote">If it is approved you will get access for a limited time, and this app unblocks itself within a minute.</div>`);
  document.getElementById('btn-close').addEventListener('click', () => window.close());
}

function renderPending(row, queued) {
  $root.innerHTML = shell(`
    <p>You already asked for access to this app${row?.submitted_at ? ` ${escapeHtml(relTime(row.submitted_at))}` : ''}. It is waiting on your administrator${queued ? ', and one more submission is still queued on this device' : ''}.</p>
    <div class="actions">
      <button type="button" class="btn-dismiss" id="btn-close">Close</button>
    </div>
    <div class="footnote">Asking again will not speed it up — a duplicate request is refused.</div>`);
  document.getElementById('btn-close').addEventListener('click', () => window.close());
}

window.api.onAccessRequestDialog(async (ev) => {
  current = ev || {};
  // Render the form first so the dialog is never blank while the status check
  // is in flight; swap to the pending view only if there is one.
  renderForm(current.tool_host ? null : 'This app could not be matched to a known AI platform, so the request may need extra detail.');

  const status = await window.api.getAccessRequestStatus(current.tool_host);
  if (status?.ok && (status.pending || status.queued)) {
    renderPending(status.pending, status.queued === true);
    return;
  }
  if (status?.code === 'reenroll' || status?.code === 'not_enrolled') {
    const $footnote = document.getElementById('footnote');
    if ($footnote) {
      $footnote.textContent = 'This device needs to re-enroll before it can request access. Open CloudFuze AI Governance → Settings.';
      $footnote.style.color = 'var(--danger)';
    }
  }
});
