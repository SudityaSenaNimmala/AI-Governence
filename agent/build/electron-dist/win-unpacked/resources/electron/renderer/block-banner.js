// The standing "this app is blocked" bar. See showBlockBanner() in main.js.
//
// This renderer receives EXACTLY ONE field: { name }. There is no prompt text,
// no pattern list, no preview and no block_id on this channel — the bar states a
// policy decision, it does not describe a message. Do not add a second field
// here without re-reading the PII notes on EmitBlockState in enforcer-win.ps1.
//
// It is also inert by construction: no buttons, no inputs, no IPC calls out. The
// window is non-focusable and click-through, so nothing here could be interacted
// with even if it were added.

const $bar = document.getElementById('bar');

// The name is admin-supplied (it comes from the blocklist an administrator
// typed), but by the time it reaches a BrowserWindow it is untrusted input all
// the same. textContent is used rather than innerHTML so there is no markup
// path at all — the same choice the extension's own banner makes.
function render(name) {
  $bar.textContent = `\u{1F512} ${name} is blocked by CloudFuze AI Governance — `
    + 'prompts cannot be sent here. Request access from the CloudFuze tray icon.';
}

render('This AI platform');

if (window.api?.onBlockBanner) {
  window.api.onBlockBanner((data) => {
    const name = String(data?.name || '').trim();
    render(name || 'This AI platform');
  });
}
