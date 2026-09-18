// Linux notifier — uses `notify-send` from libnotify.
//
// Works on every freedesktop-compatible desktop (GNOME, KDE, XFCE, Sway,
// Cinnamon, etc.) via the org.freedesktop.Notifications D-Bus interface.
// notify-send spawns and exits in <50ms, so no persistent helper needed.
//
// Required: `notify-send` (Debian/Ubuntu: libnotify-bin; Fedora/Arch: libnotify).

import { spawn, spawnSync } from 'node:child_process';

export class LinuxNotifier {
  constructor({ log }) {
    this.log = log;
    this.available = false;
  }

  start() {
    if (process.platform !== 'linux') return;
    const probe = spawnSync('command', ['-v', 'notify-send'], { shell: '/bin/sh' });
    this.available = probe.status === 0;
    if (!this.available) {
      this.log?.warn('notify: notify-send missing — install libnotify-bin (Debian/Ubuntu) or libnotify (Fedora/Arch) for native toasts.');
    } else {
      this.log?.info('notify: Linux notify-send ready');
    }
  }

  stop() {
    this.available = false;
  }

  show({ title, message }) {
    if (process.platform !== 'linux' || !this.available) return;
    const safeTitle   = String(title ?? '').slice(0, 200);
    const safeMessage = String(message ?? '').slice(0, 500);
    try {
      const child = spawn('notify-send', [
        '--app-name', 'CloudFuze AI Governance',
        '--urgency', 'critical',
        '--icon', 'dialog-warning',
        safeTitle,
        safeMessage,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      child.stderr.on('data', (d) => {
        const s = String(d).trim();
        if (s) this.log?.warn('notify-send stderr: ' + s.slice(0, 200));
      });
      child.on('error', (err) => this.log?.warn('notify-send spawn error: ' + err.message));
    } catch (err) {
      this.log?.warn('notify linux failed: ' + err.message);
    }
  }
}
