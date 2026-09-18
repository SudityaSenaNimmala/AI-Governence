// Linux adapter for the OS-level AI monitor.
//
// Pure-Node poller (no companion script — Linux distros vary too much for a
// single shell script). Spawns short-lived xdotool/xclip/wl-paste calls each
// 500ms tick. There's no kernel-level clipboard "sequence number" on Linux,
// so we detect changes by hashing the clipboard text.
//
// Coverage:
//   - X11:     full (foreground + clipboard text + clipboard files) via xdotool + xclip
//   - Wayland: clipboard text + files via wl-paste; no portable foreground watcher.
//              (GNOME/KDE/Sway each expose this differently — punted to v1.1.)
//
// Required packages by distro:
//   Debian/Ubuntu: apt install xdotool xclip wl-clipboard libnotify-bin
//   Fedora/RHEL:   dnf install xdotool xclip wl-clipboard libnotify
//   Arch:          pacman -S xdotool xclip wl-clipboard libnotify

import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

export class LinuxPoller extends EventEmitter {
  constructor({ log }) {
    super();
    this.log = log;
    this.timer = null;
    this.stopRequested = false;
    this.isWayland = !!process.env.WAYLAND_DISPLAY;
    this.tools = this.#probeTools();
    this.lastClipHash = null;
    this.lastFocusKey = null;
    this.tick = 0;
  }

  #probeTools() {
    const has = (cmd) => {
      try {
        const r = spawnSync('command', ['-v', cmd], { shell: '/bin/sh' });
        return r.status === 0;
      } catch { return false; }
    };
    return {
      xdotool:    has('xdotool'),
      xclip:      has('xclip'),
      wlPaste:    has('wl-paste'),
      notifySend: has('notify-send'),
    };
  }

  start() {
    if (process.platform !== 'linux') return;
    if (this.timer) return;

    this.log?.info(
      `os_monitor: starting Linux poller ` +
      `(session=${this.isWayland ? 'Wayland' : 'X11'}, ` +
      `tools=${Object.entries(this.tools).filter(([,v]) => v).map(([k]) => k).join(',') || 'none'})`
    );

    if (this.isWayland) {
      this.log?.warn('os_monitor: Wayland session — foreground watcher unavailable, clipboard-only mode.');
      if (!this.tools.wlPaste) {
        this.log?.error('os_monitor: wl-paste missing — install wl-clipboard for clipboard monitoring.');
      }
    } else {
      if (!this.tools.xdotool) this.log?.warn('os_monitor: xdotool missing — foreground watcher disabled. apt install xdotool');
      if (!this.tools.xclip)   this.log?.warn('os_monitor: xclip missing — clipboard monitoring disabled. apt install xclip');
    }

    this.emit('ready', {
      kind: 'ready', platform: 'linux',
      pid: process.pid,
      wayland: this.isWayland,
      tools: this.tools,
    });

    this.timer = setInterval(() => this.#tick(), 500);
    this.timer.unref?.();
  }

  stop() {
    this.stopRequested = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  #tick() {
    this.tick++;
    try {
      const fg = this.#readForeground();
      const focusKey = fg ? `${fg.pid}|${fg.process}` : null;
      const focusChanged = focusKey !== this.lastFocusKey;

      if (focusChanged && fg) {
        this.emit('focus', {
          kind: 'focus', pid: fg.pid, process: fg.process, title: fg.title || '',
        });
      }

      const clipText = this.#readClipboardText();
      const clipHash = clipText
        ? crypto.createHash('sha1').update(clipText).digest('hex').slice(0, 16)
        : null;
      const clipChanged = clipHash !== this.lastClipHash;

      if ((clipChanged || focusChanged) && fg) {
        if (clipText && clipText.length >= 4) {
          this.emit('clipboard', {
            kind: 'clipboard',
            pid: fg.pid, process: fg.process, title: fg.title || '',
            seq: clipHash || 0,
            text: clipText,
            len: clipText.length,
            cause: clipChanged ? 'seq_change' : 'focus_change',
          });
        } else {
          const files = this.#readClipboardFiles();
          if (files.length > 0) {
            this.emit('clipboard_files', {
              kind: 'clipboard_files',
              pid: fg.pid, process: fg.process, title: fg.title || '',
              seq: clipHash || 'files',
              paths: files,
              count: files.length,
              cause: clipChanged ? 'seq_change' : 'focus_change',
            });
          }
        }
      }

      this.lastClipHash = clipHash;
      this.lastFocusKey = focusKey;

      // Heartbeat every ~30s (60 ticks × 500ms)
      if (this.tick % 60 === 0) {
        this.emit('heartbeat', { kind: 'heartbeat', tick: this.tick });
      }
    } catch (e) {
      this.log?.warn('os_monitor: linux tick failed: ' + (e?.message || e));
      this.emit('poller-error', { kind: 'error', message: String(e?.message || e) });
    }
  }

  #readForeground() {
    if (this.isWayland) return null;
    if (!this.tools.xdotool) return null;
    // Single xdotool invocation chains getactivewindow with getwindowname +
    // getwindowpid — two stdout lines.
    const r = spawnSync(
      'xdotool',
      ['getactivewindow', 'getwindowname', 'getactivewindow', 'getwindowpid'],
      { encoding: 'utf8', timeout: 1000 }
    );
    if (r.status !== 0 || !r.stdout) return null;
    const lines = r.stdout.split('\n').filter(Boolean);
    if (lines.length < 2) return null;
    const title = lines[0];
    const pid = parseInt(lines[1], 10);
    if (!pid) return null;
    return { pid, process: this.#procName(pid), title };
  }

  #procName(pid) {
    try {
      // Read /proc/<pid>/comm directly — cheaper than ps and always available on Linux.
      const r = spawnSync('cat', [`/proc/${pid}/comm`], { encoding: 'utf8', timeout: 500 });
      if (r.status === 0) return r.stdout.trim();
    } catch {}
    return 'unknown';
  }

  #readClipboardText() {
    let cmd, args;
    if (this.isWayland) {
      if (!this.tools.wlPaste) return null;
      cmd = 'wl-paste'; args = ['-n', '-t', 'text/plain'];
    } else {
      if (!this.tools.xclip) return null;
      cmd = 'xclip'; args = ['-selection', 'clipboard', '-o', '-t', 'UTF8_STRING'];
    }
    try {
      const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 1500 });
      if (r.status === 0 && r.stdout) return r.stdout;
    } catch {}
    return null;
  }

  #readClipboardFiles() {
    let cmd, args;
    if (this.isWayland) {
      if (!this.tools.wlPaste) return [];
      cmd = 'wl-paste'; args = ['-t', 'text/uri-list'];
    } else {
      if (!this.tools.xclip) return [];
      cmd = 'xclip'; args = ['-selection', 'clipboard', '-t', 'text/uri-list', '-o'];
    }
    try {
      const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 1500 });
      if (r.status === 0 && r.stdout) {
        return r.stdout.split('\n')
          .map((s) => s.trim())
          .filter((s) => s.startsWith('file://'))
          .map((s) => {
            try { return decodeURIComponent(s.slice('file://'.length)); }
            catch { return null; }
          })
          .filter(Boolean);
      }
    } catch {}
    return [];
  }
}
