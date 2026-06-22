// macOS notifier — uses `osascript -e 'display notification ...'`.
//
// We don't keep a persistent helper child here: each osascript invocation
// is ~80-150ms cold which is well within "notification latency" budget,
// and the simpler per-call spawn avoids the AppleScript event-loop hazards.
//
// Title/message are sanitized to prevent AppleScript string-injection: we
// reject embedded double quotes and backslashes rather than try to escape.

import { spawn } from 'node:child_process';

export class MacNotifier {
  constructor({ log }) {
    this.log = log;
    this.ready = false;
  }

  start() {
    if (process.platform !== 'darwin') return;
    this.ready = true;
    this.log?.info('notify: macOS osascript notifier ready');
  }

  stop() {
    this.ready = false;
  }

  show({ title, message }) {
    if (process.platform !== 'darwin' || !this.ready) return;
    const safeTitle   = sanitize(title);
    const safeMessage = sanitize(message);
    const script =
      `display notification "${safeMessage}" with title "${safeTitle}" subtitle "CloudFuze AI Governance"`;
    try {
      const child = spawn('osascript', ['-e', script], { stdio: ['ignore', 'ignore', 'pipe'] });
      child.stderr.on('data', (d) => {
        const s = String(d).trim();
        if (s) this.log?.warn('notify mac stderr: ' + s.slice(0, 200));
      });
      child.on('error', (err) => this.log?.warn('notify mac spawn error: ' + err.message));
    } catch (err) {
      this.log?.warn('notify mac failed: ' + err.message);
    }
  }
}

function sanitize(s) {
  return String(s ?? '')
    .replace(/[\\"]/g, '')       // strip backslashes + double quotes
    .replace(/[\r\n]+/g, ' — ')  // newlines break AppleScript strings
    .slice(0, 500);              // sane cap
}
