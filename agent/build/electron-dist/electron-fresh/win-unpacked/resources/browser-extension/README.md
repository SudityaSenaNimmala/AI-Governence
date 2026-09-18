# CloudFuze AI Governance — browser extension

A Chrome / Edge / Brave MV3 extension that watches text users paste or submit
into AI services and reports metadata (pattern hits, length buckets) to the
internal governance server.

## What it does

- Injects a content script on AI service domains (ChatGPT, Claude, Gemini,
  Perplexity, Copilot, Poe, etc.).
- Scans the prompt input for secrets and PII patterns on every paste and on
  every submit (Enter without Shift).
- Sends only **metadata** to the governance server. Never the prompt content.

## What it does NOT do

- Read prompt content.
- Send anything to third parties.
- Run on non-AI websites.

## Local development

```bash
# 1. Load as unpacked extension
#    chrome://extensions → Developer mode → Load unpacked → select this folder
# 2. Click the extension's options page
# 3. Enter server URL (e.g. http://localhost:8787) and enrollment secret
# 4. Visit chatgpt.com / claude.ai / etc. and try pasting a fake API key
```

## Production deployment

- Package via `chrome.cli` or `zip` into a `.crx` / `.zip`.
- Sign with the CloudFuze enterprise extension key.
- Push via Microsoft Intune (Edge) or Google Admin Console (Chrome).
  - Force-install policy: `ExtensionInstallForcelist`
  - Lock options via managed storage `chrome.storage.managed` (TODO)

## Files

- `manifest.json` — MV3 manifest, host permissions, scripts
- `content/patterns.js` — secret + PII regex catalog (Luhn-validated for cards)
- `content/content.js` — DOM observation, paste/submit hooks, in-page toast
- `content/content.css` — toast styles
- `background/service-worker.js` — batching queue, enrollment, periodic flush
- `options/*` — settings UI (server URL + enroll secret)
