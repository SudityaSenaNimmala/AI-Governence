// Tokenize & Send popup — shown when the enforcer blocks a send/paste
// containing sensitive data. Uses pointerdown events (not click) because
// the window is focusable:false and click events can be unreliable on
// WS_EX_NOACTIVATE windows.

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

const $root = document.getElementById('dialog-root');
let currentBlockId = null;
let autoCloseTimer = null;

function dismiss() {
  window.api.dismissDialog();
}

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

  // Use pointerdown — fires earlier than click and works reliably on
  // non-focusable (WS_EX_NOACTIVATE) windows where click can be swallowed.
  const tokenizeBtn = document.getElementById('btn-tokenize');
  if (tokenizeBtn) {
    tokenizeBtn.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      tokenizeBtn.disabled = true;
      tokenizeBtn.textContent = 'Masking…';
      // Wait 500ms for the mouse button to fully release and any window
      // focus transitions to settle — the enforcer aborts if it sees a real
      // mouse event or a foreground window change during the rewrite.
      await new Promise(r => setTimeout(r, 500));
      const result = await window.api.tokenizeBlock(ev.block_id);
      if (!result?.sent) {
        tokenizeBtn.disabled = false;
        tokenizeBtn.textContent = 'Tokenize & Send';
      }
    });
  }
  document.getElementById('btn-dismiss')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dismiss();
  });

  if (autoCloseTimer) clearTimeout(autoCloseTimer);
  autoCloseTimer = setTimeout(dismiss, 16000);
}

window.api.onBlockDialog((ev) => render(ev));

window.api.onRewriteResult((ev) => {
  if (ev.block_id !== currentBlockId) return;
  if (ev.result === 'ok') { dismiss(); return; }
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
