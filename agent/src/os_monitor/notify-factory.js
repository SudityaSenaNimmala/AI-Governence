// Platform factory for native notifications.
//
// All backends share the same surface: { start(), stop(), show({title, message}) }.
//   - Windows: persistent STA PowerShell helper (toast-helper.ps1), custom AUMID
//   - macOS:   per-call `osascript display notification`
//   - Linux:   per-call `notify-send` (libnotify, freedesktop D-Bus)

import { ToastService } from './notify.js';
import { MacNotifier } from './notify-mac.js';
import { LinuxNotifier } from './notify-linux.js';

export function createNotifier({ log }) {
  switch (process.platform) {
    case 'win32':  return new ToastService({ log });
    case 'darwin': return new MacNotifier({ log });
    case 'linux':  return new LinuxNotifier({ log });
    default:
      log?.warn(`notify: no notifier for platform ${process.platform}`);
      return new NoopNotifier();
  }
}

class NoopNotifier {
  start() {} stop() {} show() {}
}
