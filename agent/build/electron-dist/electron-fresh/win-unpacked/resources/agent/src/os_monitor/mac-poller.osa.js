// CloudFuze AI Governance — macOS poller (JXA / osascript -l JavaScript).
//
// Long-running process. Emits NDJSON on stdout (same schema as win-poller.ps1):
//   {kind:'ready', pid, platform}
//   {kind:'focus', pid, process, title}
//   {kind:'clipboard', pid, process, title, seq, text, len, cause}
//   {kind:'clipboard_files', pid, process, title, seq, paths, count, cause}
//   {kind:'heartbeat', tick}
//   {kind:'error', message, where}
//
// Polls every 500ms. NSPasteboard.changeCount is our cheap change signal —
// only when it bumps (or focus moves) do we actually read clipboard contents.
//
// Window title requires Accessibility permission (System Settings → Privacy
// & Security → Accessibility → enable the parent terminal/agent binary).
// Without it, focus events still fire with title: ''. Clipboard scanning
// works either way — that's the critical path.

ObjC.import('AppKit');
ObjC.import('Foundation');

const pb     = $.NSPasteboard.generalPasteboard;
const ws     = $.NSWorkspace.sharedWorkspace;
const stdout = $.NSFileHandle.fileHandleWithStandardOutput;

function emit(obj) {
  const line = JSON.stringify(obj) + '\n';
  const data = $.NSString.alloc.initWithUTF8String(line)
    .dataUsingEncoding($.NSUTF8StringEncoding);
  stdout.writeData(data);
}

function nowIso() {
  return $.NSISO8601DateFormatter.alloc.init
    .stringFromDate($.NSDate.date).js;
}

function getFront() {
  const app = ws.frontmostApplication;
  if (!app || app.isNil) return null;
  const name = ObjC.unwrap(app.localizedName) || ObjC.unwrap(app.bundleIdentifier) || 'unknown';
  return { pid: app.processIdentifier, process: name };
}

// Best-effort window title via System Events. Requires Accessibility entitlement.
// Returns '' on failure rather than throwing — clipboard monitoring must keep working.
function getFrontWindowTitle() {
  try {
    const SE = Application('System Events');
    SE.includeStandardAdditions = false;
    const procs = SE.processes.whose({ frontmost: true });
    if (procs.length === 0) return '';
    const wins = procs[0].windows;
    if (wins.length === 0) return '';
    return wins[0].title() || '';
  } catch (e) {
    return '';
  }
}

function readClipText() {
  try {
    const types = pb.types;
    if (!types || types.isNil) return null;
    const count = types.count;
    let hasText = false;
    for (let i = 0; i < count; i++) {
      const t = ObjC.unwrap(types.objectAtIndex(i));
      if (t === 'public.utf8-plain-text' || t === 'public.plain-text' ||
          t === 'NSStringPboardType' || t === 'NSPasteboardTypeString') {
        hasText = true;
        break;
      }
    }
    if (!hasText) return null;
    const s = pb.stringForType($.NSPasteboardTypeString);
    if (!s || s.isNil) return null;
    return ObjC.unwrap(s);
  } catch (e) {
    return null;
  }
}

// Read all file paths from the clipboard. Mac stores file copies as
// pasteboard items with type 'public.file-url' (value = "file:///abs/path").
function readClipFiles() {
  try {
    const items = pb.pasteboardItems;
    if (!items || items.isNil) return [];
    const out = [];
    const count = items.count;
    for (let i = 0; i < count; i++) {
      const item = items.objectAtIndex(i);
      const urlStr = item.stringForType('public.file-url');
      if (!urlStr || urlStr.isNil) continue;
      const url = $.NSURL.URLWithString(urlStr);
      if (!url || url.isNil) continue;
      const path = ObjC.unwrap(url.path);
      if (path) out.push(path);
    }
    return out;
  } catch (e) {
    return [];
  }
}

let lastSeq      = pb.changeCount;
let lastFocusKey = null;
let tick = 0;

emit({
  t: nowIso(), kind: 'ready', platform: 'darwin',
  pid: $.NSProcessInfo.processInfo.processIdentifier,
});

while (true) {
  tick++;
  try {
    const fg = getFront();
    const focusKey = fg ? `${fg.pid}|${fg.process}` : null;
    const seq = pb.changeCount;

    const focusChanged = (focusKey !== lastFocusKey);
    const seqChanged   = (seq !== lastSeq);

    if (focusChanged && fg) {
      const title = getFrontWindowTitle();
      emit({
        t: nowIso(), kind: 'focus',
        pid: fg.pid, process: fg.process, title,
      });
    }

    if ((seqChanged || focusChanged) && fg) {
      const title = getFrontWindowTitle();
      const text = readClipText();
      if (text && text.length >= 4) {
        emit({
          t: nowIso(), kind: 'clipboard',
          pid: fg.pid, process: fg.process, title,
          seq, text, len: text.length,
          cause: seqChanged ? 'seq_change' : 'focus_change',
        });
      } else {
        const files = readClipFiles();
        if (files.length > 0) {
          emit({
            t: nowIso(), kind: 'clipboard_files',
            pid: fg.pid, process: fg.process, title,
            seq, paths: files, count: files.length,
            cause: seqChanged ? 'seq_change' : 'focus_change',
          });
        }
      }
    }

    lastSeq      = seq;
    lastFocusKey = focusKey;

    // Heartbeat every ~30s (60 ticks x 500ms)
    if (tick % 60 === 0) {
      emit({ t: nowIso(), kind: 'heartbeat', tick });
    }
  } catch (e) {
    emit({
      t: nowIso(), kind: 'error',
      message: String(e && e.message ? e.message : e),
      where: 'main_loop',
    });
  }
  delay(0.5);
}
