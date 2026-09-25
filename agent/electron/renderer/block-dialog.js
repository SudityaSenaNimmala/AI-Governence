// Block popup — shown when the enforcer blocks a send/paste. Matches the
// browser extension's showBlockPopup/showCfaiPopup with the same title/body
// logic for guardrails vs DLP vs mixed.

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// Guardrail pattern prefixes — same classification as browser extension
const GUARDRAIL_PREFIXES = ['injection-', 'jailbreak-', 'toxicity-', 'bias-'];
function isGuardrail(name) { return GUARDRAIL_PREFIXES.some(p => name.startsWith(p)); }

// Human-readable category labels for guardrail chips
const CATEGORY_LABELS = {
  'injection': 'Prompt Injection',
  'jailbreak': 'Jailbreak Attempt',
  'toxicity': 'Harmful Content',
  'bias': 'Bias / Discrimination',
};
function categoryFor(name) {
  for (const [prefix, label] of Object.entries(CATEGORY_LABELS)) {
    if (name.startsWith(prefix)) return label;
  }
  return name;
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
  const patternNames = (ev.patterns || '').split(',').map(s => s.trim()).filter(Boolean);
  const guardrailPatterns = patternNames.filter(isGuardrail);
  const dlpPatterns = patternNames.filter(p => !isGuardrail(p));
  const hasGuardrail = guardrailPatterns.length > 0;
  const hasDlp = dlpPatterns.length > 0;

  // Title and body — matches browser extension's showBlockPopup exactly
  let title, body;
  if (isAttachment) {
    title = "This attachment can't be sent";
    body = `CloudFuze AI Governance blocked an attached file in <strong>${escapeHtml(ev.app || 'this app')}</strong>:`;
  } else if (hasGuardrail && !hasDlp) {
    title = 'Unsafe prompt blocked';
    body = `CloudFuze AI Governance blocked this message in <strong>${escapeHtml(ev.app || 'this app')}</strong> because it contains a security or safety violation:`;
  } else if (hasGuardrail && hasDlp) {
    title = "This prompt can't be sent";
    body = `CloudFuze AI Governance blocked this message in <strong>${escapeHtml(ev.app || 'this app')}</strong> — it contains sensitive data and a safety violation:`;
  } else {
    title = "This prompt can't be sent";
    body = `CloudFuze AI Governance blocked this message in <strong>${escapeHtml(ev.app || 'this app')}</strong> because it contains sensitive data:`;
  }

  // Icon — shield for guardrails, warning for DLP
  const icon = hasGuardrail && !hasDlp ? '🛡️' : '⚠️';

  // Pattern chips — group guardrails by category, show DLP pattern names
  const chips = [];
  const seenCategories = new Set();
  for (const p of guardrailPatterns) {
    const cat = categoryFor(p);
    if (!seenCategories.has(cat)) { seenCategories.add(cat); chips.push(`<span class="pattern-chip guardrail-chip">${escapeHtml(cat)}</span>`); }
  }
  for (const p of dlpPatterns) {
    chips.push(`<span class="pattern-chip">${escapeHtml(p)}</span>`);
  }
  const chipsHtml = chips.join(' ');

  // Actions
  const actionsHtml = ev.rewritable
    ? `<button type="button" class="btn-tokenize" id="btn-tokenize">Tokenize &amp; Send</button>
       <button type="button" class="btn-dismiss" id="btn-dismiss">Edit manually</button>`
    : `<button type="button" class="btn-dismiss" id="btn-dismiss">Got it</button>`;

  // Preview box
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

  // Hint text
  let hint;
  if (ev.rewritable) {
    hint = 'Tokenize &amp; Send replaces each detected value with a fixed label before sending. The original values are never sent, and cannot be recovered from the label.';
  } else if (isAttachment) {
    hint = 'Remove the attachment to send this message. If the app already uploaded the file when you attached it, this only stops it from being used in the conversation — it does not undo an upload that already happened.';
  } else if (hasGuardrail && !hasDlp) {
    hint = 'Remove the flagged content from your prompt to continue.';
  } else {
    hint = 'Remove the flagged content yourself and send again — this one could not be masked automatically.';
  }

  $root.innerHTML = `
    <div class="block-dialog-icon">${icon}</div>
    <h3>${title}</h3>
    <p>${body}</p>
    <div class="pattern-chips">${chipsHtml}</div>
    ${previewHtml}
    <p>${hint}</p>
    <div class="actions">${actionsHtml}</div>
    <div class="footnote">This event was reported to the security team.</div>`;

  const tokenizeBtn = document.getElementById('btn-tokenize');
  if (tokenizeBtn) {
    tokenizeBtn.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      tokenizeBtn.disabled = true;
      tokenizeBtn.textContent = 'Masking…';
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
  if (ev.result === 'ok' || ev.reason === 'not_submitted') { dismiss(); return; }
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
