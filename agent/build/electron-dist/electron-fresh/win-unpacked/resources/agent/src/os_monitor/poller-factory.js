// Platform factory for the OS-level AI monitor poller.
//
// Every adapter is an EventEmitter that emits the same NDJSON-like events:
//   - 'ready'            { pid, ... }
//   - 'heartbeat'        { tick }
//   - 'focus'            { pid, process, title }
//   - 'clipboard'        { pid, process, title, seq, text, len, cause }
//   - 'clipboard_files'  { pid, process, title, seq, paths, count, cause }
//   - 'poller-error'     { message }
//
// `cause` is 'seq_change' (clipboard contents changed) or 'focus_change'
// (focus moved to a different process — clipboard contents may already be
// sensitive from a prior copy).
//
// Per the universal-coverage rule: clipboard text + foreground + notifications
// is the baseline that must work on Windows, macOS, and Linux. Anything
// involving in-process UI introspection (UIA file-dialog watcher, attachment
// chip watcher) is a Windows-first enhancement and is owned by separate
// watcher modules — not this factory.

import { WinPoller } from './poller.js';
import { MacPoller } from './poller-mac.js';
import { LinuxPoller } from './poller-linux.js';

export function createPoller({ log }) {
  switch (process.platform) {
    case 'win32':  return new WinPoller({ log });
    case 'darwin': return new MacPoller({ log });
    case 'linux':  return new LinuxPoller({ log });
    default:
      log?.warn(`os_monitor: no poller for platform ${process.platform} — monitor will be inert`);
      return new NoopPoller({ log });
  }
}

import { EventEmitter } from 'node:events';
class NoopPoller extends EventEmitter {
  constructor({ log }) { super(); this.log = log; }
  start() { this.log?.warn('os_monitor: NoopPoller started (unsupported platform)'); }
  stop()  {}
}
