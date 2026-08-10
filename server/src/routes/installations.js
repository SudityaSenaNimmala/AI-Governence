// Installations — generate pre-configured browser extension and agent downloads.
//
// The extension zip has serverUrl + enrollSecret baked into a config.json file
// so employees install it and it auto-enrolls — zero configuration needed.
// The agent command has the same values pre-filled.

import { a } from '../util.js';
import { ENROLL_SECRET } from '../auth.js';
import crypto from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function mountInstallations(app, db) {

  // ── Installation info (what to show in the UI) ──

  app.get('/api/v1/installations/info', a(async (req, res) => {
    // Determine the server's external URL from the request
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const serverUrl = `${proto}://${host}`;

    res.json({
      server_url: serverUrl,
      enroll_secret: ENROLL_SECRET,
      agent_command: `node src/index.js --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --monitor`,
      agent_command_scan: `node src/index.js --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --output report.json`,
    });
  }));

  // ── Agent version check (for auto-updater) ──

  let _agentVersionCache = { hash: null, computedAt: 0 };

  app.get('/api/v1/installations/agent-version', a(async (req, res) => {
    const agentDir = join(__dirname, '..', '..', '..', 'agent');
    if (!existsSync(agentDir)) return res.status(500).json({ error: 'Agent source not found' });

    // Cache the hash for 60 seconds — avoid re-hashing on every poll
    if (Date.now() - _agentVersionCache.computedAt < 60000 && _agentVersionCache.hash) {
      return res.json({ version: _agentVersionCache.hash });
    }

    // Hash all agent source files to create a version fingerprint
    const hash = crypto.createHash('sha256');
    const SKIP = new Set(['node_modules', 'tests', '.git', 'package-lock.json', 'build', 'electron', 'browser-extension']);
    function walkHash(dir) {
      for (const entry of readdirSync(dir).sort()) {
        if (SKIP.has(entry)) continue;
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) walkHash(full);
        else if (stat.size < 2 * 1024 * 1024) {
          hash.update(entry + ':' + stat.size + ':' + stat.mtimeMs + '\n');
        }
      }
    }
    walkHash(agentDir);
    const version = hash.digest('hex').slice(0, 16);
    _agentVersionCache = { hash: version, computedAt: Date.now() };
    res.json({ version });
  }));

  // ── Download pre-configured browser extension zip ──

  app.get('/api/v1/installations/extension-package', a(async (req, res) => {
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const serverUrl = `${proto}://${host}`;

    // The extension source lives at ../../browser-extension relative to server/src/routes
    const extDir = join(__dirname, '..', '..', '..', 'browser-extension');
    if (!existsSync(extDir)) {
      return res.status(500).json({ error: 'Browser extension source not found on server' });
    }

    // Build a pre-configured config that the extension reads on first boot
    const preConfig = JSON.stringify({
      serverUrl,
      enrollSecret: ENROLL_SECRET,
      preConfigured: true,
    });

    // Build zip containing the extension files + baked config
    const files = [];

    // Add the pre-baked config file
    files.push({ name: 'cfai-config.json', data: Buffer.from(preConfig, 'utf8') });

    // Add extension source files (skip node_modules, tests, .git)
    const SKIP = new Set(['node_modules', 'tests', '.git', 'package-lock.json']);
    function walk(dir, prefix) {
      for (const entry of readdirSync(dir)) {
        if (SKIP.has(entry)) continue;
        const full = join(dir, entry);
        const rel = prefix ? prefix + '/' + entry : entry;
        const stat = statSync(full);
        if (stat.isDirectory()) walk(full, rel);
        else if (stat.size < 5 * 1024 * 1024) { // skip files > 5MB
          files.push({ name: rel, data: readFileSync(full) });
        }
      }
    }
    walk(extDir, '');

    const zipBuffer = createZip(files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="CloudFuze-Browser-Extension.zip"');
    res.send(zipBuffer);
  }));

  // ── Download pre-built Windows installer (.exe) if available ──

  app.get('/api/v1/installations/agent-installer-exe', a(async (req, res) => {
    const exePath = join(__dirname, '..', '..', '..', 'agent', 'installer', 'CloudFuze-Agent-Setup.exe');
    if (!existsSync(exePath)) {
      return res.status(404).json({ error: 'Installer not built yet. Run agent/installer/build-installer.bat first.' });
    }
    const stat = statSync(exePath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="CloudFuze-Agent-Setup.exe"');
    res.setHeader('Content-Length', stat.size);
    const data = readFileSync(exePath);
    res.send(data);
  }));

  // ── Download pre-configured desktop agent package ──

  app.get('/api/v1/installations/agent-installer', a(async (req, res) => {
    const platform = req.query.platform || 'windows';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const serverUrl = `${proto}://${host}`;

    const agentDir = join(__dirname, '..', '..', '..', 'agent');
    if (!existsSync(agentDir)) {
      return res.status(500).json({ error: 'Agent source not found on server' });
    }

    // Baked config so the agent auto-enrolls on first run
    const agentConfig = JSON.stringify({ serverUrl, enrollSecret: ENROLL_SECRET }, null, 2);

    // Install script per platform
    const installScripts = {
      windows: [
        '@echo off',
        'title CloudFuze Desktop Agent',
        'echo ============================================',
        'echo    CloudFuze Desktop Agent — Install',
        'echo ============================================',
        'echo.',
        '',
        'REM Use bundled Node.js if available, otherwise fall back to system Node',
        'set "BUNDLED_NODE=%~dp0node\\node.exe"',
        'set "BUNDLED_NPM=%~dp0node\\npm.cmd"',
        'if exist "%BUNDLED_NODE%" (',
        '  set "NODE=%BUNDLED_NODE%"',
        '  set "NPM=%BUNDLED_NPM%"',
        '  echo [OK] Using bundled Node.js',
        ') else (',
        '  where node >nul 2>&1',
        '  if %ERRORLEVEL% neq 0 (',
        '    echo [..] Node.js not found — downloading portable version...',
        '    powershell -NoProfile -Command "Invoke-WebRequest -Uri \'https://nodejs.org/dist/v22.15.0/node-v22.15.0-win-x64.zip\' -OutFile \'%~dp0node.zip\'"',
        '    if not exist "%~dp0node.zip" (',
        '      echo [ERROR] Failed to download Node.js.',
        '      echo Please install Node.js manually from https://nodejs.org',
        '      pause',
        '      exit /b 1',
        '    )',
        '    echo [..] Extracting Node.js...',
        '    powershell -NoProfile -Command "Expand-Archive -Path \'%~dp0node.zip\' -DestinationPath \'%~dp0\' -Force"',
        '    ren "%~dp0node-v22.15.0-win-x64" node',
        '    del "%~dp0node.zip"',
        '    set "NODE=%~dp0node\\node.exe"',
        '    set "NPM=%~dp0node\\npm.cmd"',
        '    echo [OK] Node.js downloaded and ready',
        '  ) else (',
        '    set "NODE=node"',
        '    set "NPM=npm"',
        '    echo [OK] Using system Node.js',
        '  )',
        ')',
        'echo.',
        '',
        'REM Stop old agent if running',
        'if exist "%USERPROFILE%\\.cloudfuze-aigov\\monitor.lock" (',
        '  set /p OLD_PID=<"%USERPROFILE%\\.cloudfuze-aigov\\monitor.lock"',
        '  echo [..] Stopping previous agent...',
        '  taskkill /PID %OLD_PID% /F >nul 2>&1',
        '  del "%USERPROFILE%\\.cloudfuze-aigov\\monitor.lock" >nul 2>&1',
        '  timeout /t 2 /nobreak >nul',
        '  echo [OK] Previous agent stopped',
        ')',
        'echo.',
        '',
        'REM Navigate to agent folder',
        'cd /d "%~dp0\\agent"',
        'if not exist "src\\index.js" (',
        '  echo [ERROR] Agent source files not found!',
        '  echo Expected: %~dp0\\agent\\src\\index.js',
        '  echo.',
        '  pause',
        '  exit /b 1',
        ')',
        '',
        'echo [..] Installing dependencies (this may take a minute)...',
        'call %NPM% install --production 2>nul',
        'echo [OK] Dependencies installed',
        'echo.',
        '',
        'if not exist "%USERPROFILE%\\.cloudfuze-aigov" mkdir "%USERPROFILE%\\.cloudfuze-aigov"',
        `echo {"serverUrl":"${serverUrl}","enrollSecret":"${ENROLL_SECRET}"}> "%USERPROFILE%\\.cloudfuze-aigov\\auto-config.json"`,
        '',
        `echo [..] Enrolling with server (${serverUrl})...`,
        `%NODE% src/index.js --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --output NUL`,
        'if %ERRORLEVEL% neq 0 (',
        '  echo [WARNING] Enrollment had issues but continuing...',
        ')',
        'echo [OK] Enrolled',
        'echo.',
        '',
        'echo [..] Starting agent in background...',
        `start "" /B %NODE% src/index.js --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --monitor`,
        'echo.',
        'echo ============================================',
        'echo    CloudFuze agent is installed and running!',
        'echo ============================================',
        'echo.',
        'echo The agent runs in the background and will',
        'echo auto-update when new versions are available.',
        'echo You can close this window.',
        'echo.',
        'pause',
      ].join('\r\n'),
      macos: [
        '#!/bin/bash',
        'set -e',
        'echo "============================================"',
        'echo "   CloudFuze Desktop Agent — Install"',
        'echo "============================================"',
        'echo ""',
        '# Use bundled or system Node',
        'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
        'if [ -f "$SCRIPT_DIR/node/bin/node" ]; then',
        '  NODE="$SCRIPT_DIR/node/bin/node"',
        '  NPM="$SCRIPT_DIR/node/bin/npm"',
        '  echo "[OK] Using bundled Node.js"',
        'elif command -v node >/dev/null 2>&1; then',
        '  NODE=node; NPM=npm',
        '  echo "[OK] Using system Node.js"',
        'else',
        '  echo "[..] Node.js not found — downloading..."',
        '  curl -sL https://nodejs.org/dist/v22.15.0/node-v22.15.0-darwin-arm64.tar.gz -o "$SCRIPT_DIR/node.tar.gz"',
        '  tar xzf "$SCRIPT_DIR/node.tar.gz" -C "$SCRIPT_DIR"',
        '  mv "$SCRIPT_DIR/node-v22.15.0-darwin-arm64" "$SCRIPT_DIR/node"',
        '  rm "$SCRIPT_DIR/node.tar.gz"',
        '  NODE="$SCRIPT_DIR/node/bin/node"; NPM="$SCRIPT_DIR/node/bin/npm"',
        '  echo "[OK] Node.js downloaded"',
        'fi',
        '# Stop old agent',
        'if [ -f ~/.cloudfuze-aigov/monitor.lock ]; then',
        '  OLD_PID=$(cat ~/.cloudfuze-aigov/monitor.lock)',
        '  echo "[..] Stopping previous agent (PID $OLD_PID)..."',
        '  kill "$OLD_PID" 2>/dev/null || true',
        '  rm -f ~/.cloudfuze-aigov/monitor.lock; sleep 2',
        '  echo "[OK] Previous agent stopped"',
        'fi',
        'cd "$SCRIPT_DIR/agent"',
        'echo "[..] Installing dependencies..."',
        '"$NPM" install --production 2>/dev/null',
        'echo "[OK] Dependencies installed"',
        'mkdir -p ~/.cloudfuze-aigov',
        `echo '{"serverUrl":"${serverUrl}","enrollSecret":"${ENROLL_SECRET}"}' > ~/.cloudfuze-aigov/auto-config.json`,
        `echo "[..] Enrolling with server (${serverUrl})..."`,
        `"$NODE" src/index.js --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --output /dev/null || echo "[WARNING] Enrollment issue"`,
        'echo "[OK] Enrolled"',
        'echo "[..] Starting agent..."',
        `nohup "$NODE" src/index.js --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --monitor > /dev/null 2>&1 &`,
        'echo ""',
        'echo "============================================"',
        'echo "   CloudFuze agent is installed and running!"',
        'echo "============================================"',
        'echo ""',
        'echo "Auto-updates are enabled. You can close this window."',
      ].join('\n'),
      linux: [
        '#!/bin/bash',
        'set -e',
        'echo "============================================"',
        'echo "   CloudFuze Desktop Agent — Install"',
        'echo "============================================"',
        'echo ""',
        'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
        'if [ -f "$SCRIPT_DIR/node/bin/node" ]; then',
        '  NODE="$SCRIPT_DIR/node/bin/node"',
        '  NPM="$SCRIPT_DIR/node/bin/npm"',
        '  echo "[OK] Using bundled Node.js"',
        'elif command -v node >/dev/null 2>&1; then',
        '  NODE=node; NPM=npm',
        '  echo "[OK] Using system Node.js"',
        'else',
        '  echo "[..] Node.js not found — downloading..."',
        '  curl -sL https://nodejs.org/dist/v22.15.0/node-v22.15.0-linux-x64.tar.gz -o "$SCRIPT_DIR/node.tar.gz"',
        '  tar xzf "$SCRIPT_DIR/node.tar.gz" -C "$SCRIPT_DIR"',
        '  mv "$SCRIPT_DIR/node-v22.15.0-linux-x64" "$SCRIPT_DIR/node"',
        '  rm "$SCRIPT_DIR/node.tar.gz"',
        '  NODE="$SCRIPT_DIR/node/bin/node"; NPM="$SCRIPT_DIR/node/bin/npm"',
        '  echo "[OK] Node.js downloaded"',
        'fi',
        'if [ -f ~/.cloudfuze-aigov/monitor.lock ]; then',
        '  OLD_PID=$(cat ~/.cloudfuze-aigov/monitor.lock)',
        '  echo "[..] Stopping previous agent..."',
        '  kill "$OLD_PID" 2>/dev/null || true',
        '  rm -f ~/.cloudfuze-aigov/monitor.lock; sleep 2',
        '  echo "[OK] Previous agent stopped"',
        'fi',
        'cd "$SCRIPT_DIR/agent"',
        'echo "[..] Installing dependencies..."',
        '"$NPM" install --production 2>/dev/null',
        'echo "[OK] Dependencies installed"',
        'mkdir -p ~/.cloudfuze-aigov',
        `echo '{"serverUrl":"${serverUrl}","enrollSecret":"${ENROLL_SECRET}"}' > ~/.cloudfuze-aigov/auto-config.json`,
        `echo "[..] Enrolling with server (${serverUrl})..."`,
        `"$NODE" src/index.js --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --output /dev/null || echo "[WARNING] Enrollment issue"`,
        'echo "[OK] Enrolled"',
        'echo "[..] Starting agent..."',
        `nohup "$NODE" src/index.js --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --monitor > /dev/null 2>&1 &`,
        'echo ""',
        'echo "============================================"',
        'echo "   CloudFuze agent is installed and running!"',
        'echo "============================================"',
        'echo ""',
        'echo "Auto-updates are enabled. You can close this terminal."',
      ].join('\n'),
    };

    const files = [];

    // Add install script
    const scriptName = platform === 'windows' ? 'install.bat' : 'install.sh';
    files.push({ name: scriptName, data: Buffer.from(installScripts[platform] || installScripts.windows, 'utf8') });

    // Add baked credentials
    files.push({ name: 'cloudfuze-config.json', data: Buffer.from(agentConfig, 'utf8') });

    // Add agent source (skip heavy/unnecessary dirs)
    const SKIP = new Set(['node_modules', 'tests', '.git', 'package-lock.json', 'build', 'electron', 'browser-extension']);
    function walk(dir, prefix) {
      for (const entry of readdirSync(dir)) {
        if (SKIP.has(entry)) continue;
        const full = join(dir, entry);
        const rel = prefix ? prefix + '/' + entry : entry;
        const stat = statSync(full);
        if (stat.isDirectory()) walk(full, rel);
        else if (stat.size < 2 * 1024 * 1024) {
          files.push({ name: 'agent/' + rel, data: readFileSync(full) });
        }
      }
    }
    walk(agentDir, '');

    const ext = { windows: 'zip', macos: 'zip', linux: 'zip' };
    const zipBuffer = createZip(files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="CloudFuze-Desktop-Agent-${platform}.${ext[platform] || 'zip'}"`);
    res.send(zipBuffer);
  }));
}

// Minimal ZIP builder (STORE, no compression) — same as connections.js
function createZip(files) {
  const parts = [];
  const centralDir = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const data = file.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centralDir.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }

  const centralDirBuf = Buffer.concat(centralDir);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralDirBuf, eocd]);
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
