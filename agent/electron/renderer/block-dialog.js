// Tokenize & Send popup — a dedicated, non-activating window (see
// showBlockDialogWindow() in main.js for why it's separate from the main app
// window). Only ever receives {app, patterns, block_id, rewritable, preview,
// why_not, reason, filename} — no prompt content beyond the already-masked
// preview, and for an attachment block, only the FILENAME, never its content.

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

const $root = document.getElementById('dialog-root');
let currentBlockId = null;

function render(ev) {
  currentBlockId = ev.block_id || null;
  const isAttachment = ev.reason === 'attachment';

  const actionsHtml = ev.rewritable
    ? `<button type="button" class="btn-tokenize" id="btn-tokenize">Tokenize &amp; Send</button>
       <button type="button" class="btn-dismiss" id="btn-dismiss">Edit manually</button>`
    : `<button type="button" class="btn-dismiss" id="btn-dismiss">Got it</button>`;

  const previewHtml = ev.rewritable
    ? `<div class="preview-box">
         <div class="preview-label">This is what gets sent</div>
         <div class="preview-text">${escapeHtml(ev.preview)}</div>
       </div>`
    : isAttachment
    ? `<div class="preview-box">
         <div class="preview-label">Flagged attachment</div>
         <div class="preview-text">${escapeHtml(ev.filename || 'attached file')}</div>
       </div>`
    : '';

  // Honest framing, matching the design decision behind this feature: this
  // stops the MESSAGE from sending. It does NOT promise the file's bytes
  // never reached the app's vendor — several chat apps upload an attached
  // file to their backend the instant it's attached, well before Send. Never
  // word this as "upload blocked" or "file never left your machine."
  const hint = ev.rewritable
    ? 'Tokenize &amp; Send replaces each detected value with a fixed label before sending. The original values are never sent, and cannot be recovered from the label.'
    : isAttachment
    ? 'Remove the attachment to send this message. If the app already uploaded the file when you attached it, this only stops it from being used in the conversation — it does not undo an upload that already happened.'
    : 'Remove the flagged content yourself and send again — this one could not be masked automatically.';

  const title = isAttachment ? "This attachment can't be sent" : "This prompt can't be sent";
  const bodyVerb = isAttachment ? 'an attached file in' : 'this message in';

  $root.innerHTML = `
    <div class="block-dialog-icon">⚠️</div>
    <h3>${title}</h3>
    <p>CloudFuze AI Governance blocked ${bodyVerb} <strong>${escapeHtml(ev.app || 'this app')}</strong> because it contains sensitive data:</p>
    <div class="pattern-chip">${escapeHtml(ev.patterns || 'sensitive data')}</div>
    ${previewHtml}
    <p>${hint}</p>
    <div class="actions">${actionsHtml}</div>
    <div class="footnote">This event was reported to the security team.</div>`;

  const tokenizeBtn = document.getElementById('btn-tokenize');
  if (tokenizeBtn) {
    tokenizeBtn.addEventListener('click', async () => {
      tokenizeBtn.disabled = true;
      tokenizeBtn.textContent = 'Masking…';
      const result = await window.api.tokenizeBlock(ev.block_id);
      if (!result?.sent) {
        tokenizeBtn.disabled = false;
        tokenizeBtn.textContent = 'Tokenize & Send';
      }
      // On real success the main process closes this window itself (it's
      // the one that knows the rewrite actually landed) — see 'rewrite-result'
      // below for the failure/timeout paths, which stay open.
    });
  }
  const dismissBtn = document.getElementById('btn-dismiss');
  if (dismissBtn) dismissBtn.addEventListener('click', () => window.close());
}

window.api.onBlockDialog((ev) => render(ev));

window.api.onRewriteResult((ev) => {
  if (ev.block_id !== currentBlockId) return;  // stale/unrelated result
  if (ev.result === 'ok') return;  // main process closes the window on success
  const tokenizeBtn = document.getElementById('btn-tokenize');
  if (tokenizeBtn) {
    tokenizeBtn.disabled = false;
    tokenizeBtn.textContent = 'Tokenize & Send';
  }
  const footnote = document.querySelector('.footnote');
  if (footnote) {
    footnote.textContent = `Could not confirm the prompt was masked (${ev.reason || ev.result}) — nothing was sent. Edit it manually instead.`;
    footnote.style.color = 'var(--danger)';
  }
});

// A 15s-old dialog is answering an offer that has already expired on the
// enforcer side (see REWRITE_TTL) — closing it here avoids a stale "Tokenize
// & Send" that would just silently no-op if clicked.
setTimeout(() => window.close(), 16000);
