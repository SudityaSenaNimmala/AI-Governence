// Block popup — shown when the enforcer blocks a send/paste. Matches the
// browser extension's showBlockPopup/showCfaiPopup with the same title/body
// logic for guardrails vs DLP vs mixed.

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// ── Guardrail detection ───────────────────────────────────────────────────────
// The enforcer reports pattern NAMES — DLP patterns are admin-defined labels
// like "SSN", "Credit Card"; guardrail patterns are the built-in safety rules
// the model-router and prompt-scanner enforce. Distinguishing them lets the
// dialog show a contextual explanation instead of a generic "sensitive data"
// message.
const GUARDRAIL_PREFIXES = [
  'prompt_injection', 'jailbreak', 'harmful_content', 'violence',
  'hate_speech', 'sexual_content', 'self_harm', 'illegal_activity',
  'guardrail', 'safety', 'toxicity', 'bias',
];

function isGuardrail(patternName) {
  const lower = (patternName || '').toLowerCase().replace(/[\s-]+/g, '_');
  return GUARDRAIL_PREFIXES.some(prefix => lower.startsWith(prefix) || lower === prefix);
}

const CATEGORY_LABELS = {
  prompt_injection: 'Prompt Injection',
  jailbreak: 'Jailbreak Attempt',
  harmful_content: 'Harmful Content',
  violence: 'Violence',
  hate_speech: 'Hate Speech',
  sexual_content: 'Sexual Content',
  self_harm: 'Self-Harm',
  illegal_activity: 'Illegal Activity',
  guardrail: 'Safety Guardrail',
  safety: 'Safety Guardrail',
  toxicity: 'Toxicity',
  bias: 'Bias',
};

function categoryFor(patternName) {
  const lower = (patternName || '').toLowerCase().replace(/[\s-]+/g, '_');
  for (const [prefix, label] of Object.entries(CATEGORY_LABELS)) {
    if (lower.startsWith(prefix)) return label;
  }
  return patternName || 'Safety Guardrail';
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
      tokenizeBtn.textContent = 'Masking\u2026';
      // Wait 300ms for the mouse button to fully release — the enforcer's
      // mouse hook aborts any in-progress rewrite on a real LBUTTONUP, and
      // the UP from this click arrives after the rewrite starts.
      await new Promise(r => setTimeout(r, 300));
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
  if (ev.result === 'ok' || ev.result === 'not_submitted') { dismiss(); return; }
  const tokenizeBtn = document.getElementById('btn-tokenize');
  if (tokenizeBtn) {
    tokenizeBtn.disabled = false;
    tokenizeBtn.textContent = 'Tokenize & Send';
  }
  const footnote = document.querySelector('.footnote');
  if (footnote) {
    footnote.textContent = `Could not confirm the prompt was masked (${ev.reason || ev.result}) \u2014 nothing was sent. Edit it manually instead.`;
    footnote.style.color = 'var(--danger)';
  }
});
