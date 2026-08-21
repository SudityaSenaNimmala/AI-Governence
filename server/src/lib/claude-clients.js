// Which CLIENT a Claude Code prompt came from — the VS Code / Cursor extension,
// or a plain terminal.
//
// Claude Code reports this as the OTel attribute `terminal.type`. It is the ONLY
// place the information exists: the local transcripts carry an `entrypoint`
// field, but it reads "cli" for every line including sessions running inside the
// IDE extension, so it cannot be used for this. Checked against real data before
// the design was built on it.
//
// Shared by otel.js (ingest), dlp.js (transcript-derived ingest),
// claude-usage.js (the rollup) and scripts/backfill-terminal.mjs, because four
// copies of a mapping like this drift and then two screens disagree about the
// same number.

// Canonical surface name. Claude Code in an IDE extension is the SAME product as
// Claude Code in a terminal — same binary, same account, same billing — so it
// belongs in one surface with the client shown underneath, not split into a
// fourth top-level surface that would double the places a person appears.
export const CLAUDE_CODE_SURFACE = 'Claude Code (CLI/extension)';

// The name this surface had before IDE clients were broken out. Still emitted as
// an alias in `by_surface` so anything already reading that key keeps working;
// see claude-usage.js.
export const CLAUDE_CODE_SURFACE_LEGACY = 'Claude Code (CLI)';

// Ordered: first match wins. Anchored on the values Claude Code actually emits,
// verified against production data (vscode, cursor, xterm-256color).
const CLIENT_PATTERNS = [
  { match: /^vscode$|^visual[\s-]?studio[\s-]?code$/i, label: 'VS Code' },
  { match: /^cursor$/i, label: 'Cursor' },
  { match: /^windsurf$/i, label: 'Windsurf' },
  { match: /^(jetbrains|intellij|pycharm|webstorm|goland|rider|phpstorm)$/i, label: 'JetBrains' },
  // Everything a shell reports for itself. Deliberately a pattern rather than a
  // list: terminfo names are open-ended (xterm-256color, xterm-kitty, screen-256color,
  // tmux-256color, vt100, linux, dumb), and a new one must read as "Terminal"
  // rather than inventing a client nobody installed.
  { match: /^(xterm|screen|tmux|rxvt|vt\d|linux|dumb|ansi|konsole|alacritty|kitty|ghostty|wezterm)/i, label: 'Terminal' },
  { match: /^(apple_terminal|iterm\.app|iterm2|windows[\s-]?terminal|powershell|cmd\.exe|conemu|hyper|warp)$/i, label: 'Terminal' },
];

// An IDE extension, as opposed to a shell. Used for the "is this the extension?"
// question directly, so callers do not re-derive it from the label string.
const IDE_LABELS = new Set(['VS Code', 'Cursor', 'Windsurf', 'JetBrains']);

// What a row shows when no OTel event ever arrived for its session. Named rather
// than blank, because a blank cell reads as "no client" — which is not a thing
// that can happen — while "Unknown" reads as what it is: not reported.
export const UNKNOWN_CLIENT = 'Unknown';

export function classifyClient(terminalType) {
  const raw = String(terminalType ?? '').trim();
  if (!raw) return UNKNOWN_CLIENT;
  for (const p of CLIENT_PATTERNS) if (p.match.test(raw)) return p.label;
  // An unrecognised value is passed through rather than mapped to Unknown: a new
  // editor should show its own name and prompt someone to add it here, not hide
  // inside the same bucket as "we never heard".
  return raw;
}

export function isIdeClient(label) {
  return IDE_LABELS.has(label);
}

// Display order for the per-client breakdown: IDEs first (that is the question
// being asked), then Terminal, then anything unrecognised, with Unknown last so
// unlabelled rows collect at the bottom instead of interrupting the real ones.
export function clientSortKey(label) {
  if (isIdeClient(label)) return 0;
  if (label === 'Terminal') return 1;
  if (label === UNKNOWN_CLIENT) return 3;
  return 2;
}
