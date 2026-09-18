const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger({ verbose = false, prefix = '' } = {}) {
  const minLevel = verbose ? LEVELS.debug : LEVELS.info;

  function log(level, ...args) {
    if (LEVELS[level] < minLevel) return;
    const ts = new Date().toISOString();
    const tag = prefix ? `[${prefix}]` : '';
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stderr;
    stream.write(`${ts} ${level.toUpperCase().padEnd(5)} ${tag} ${args.map(stringify).join(' ')}\n`);
  }

  return {
    debug: (...a) => log('debug', ...a),
    info: (...a) => log('info', ...a),
    warn: (...a) => log('warn', ...a),
    error: (...a) => log('error', ...a),
    child: (childPrefix) => createLogger({ verbose, prefix: prefix ? `${prefix}/${childPrefix}` : childPrefix }),
  };
}

function stringify(v) {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.stack || v.message;
  try { return JSON.stringify(v); } catch { return String(v); }
}
