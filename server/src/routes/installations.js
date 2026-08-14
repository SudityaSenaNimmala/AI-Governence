// Installations — generate pre-configured browser extension and agent downloads.
//
// The extension zip has serverUrl + enrollSecret baked into a config.json file
// so employees install it and it auto-enrolls — zero configuration needed.
// The agent command has the same values pre-filled.

import { a } from '../util.js';
import { createZip } from '../lib/zip.js';
import { ENROLL_SECRET } from '../auth.js';
import crypto from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PORT = process.env.PORT || '8787';

// Build the API server URL from the request. Uses the request's hostname
// but the server's own PORT — not the frontend port the request may have
// arrived through (nginx on 3000 proxies /api to here on 8787).
function apiServerUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const rawHost = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  // Strip any port from the host (could be frontend port 3000 or missing entirely)
  const hostname = rawHost.replace(/:\d+$/, '');
  return `${proto}://${hostname}:${SERVER_PORT}`;
}

export function mountInstallations(app, db) {

  // ── Installation info (what to show in the UI) ──

  app.get('/api/v1/installations/info', a(async (req, res) => {
    // Determine the server's external URL from the request
    const serverUrl = apiServerUrl(req);

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
    const serverUrl = apiServerUrl(req);

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

  // ── Build + serve Windows .exe installer (NSIS, on-the-fly) ──

  let _exeCache = { serverUrl: null, hash: null, path: null };

  app.get('/api/v1/installations/agent-installer-exe', a(async (req, res) => {
    const serverUrl = apiServerUrl(req);

    const root = join(__dirname, '..', '..', '..');
    const installerDir = join(root, 'agent', 'installer');
    const nsiScript = join(installerDir, 'cloudfuze-agent.nsi');
    const buildDir = join(installerDir, 'build');
    const outExe = join(installerDir, 'CloudFuze-Agent-Installer.exe');

    // Compute source hash to know if we need to rebuild
    const agentDir = join(root, 'agent');
    const srcHash = crypto.createHash('sha256');
    srcHash.update(serverUrl + ':' + ENROLL_SECRET);
    const SKIP = new Set(['node_modules', 'tests', '.git', 'package-lock.json', 'build', 'electron', 'browser-extension', 'installer']);
    function walkHash(dir) {
      for (const entry of readdirSync(dir).sort()) {
        if (SKIP.has(entry)) continue;
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) walkHash(full);
        else if (stat.size < 2 * 1024 * 1024) {
          srcHash.update(entry + ':' + stat.size + ':' + stat.mtimeMs + '\n');
        }
      }
    }
    walkHash(agentDir);
    const currentHash = srcHash.digest('hex').slice(0, 16);

    // Serve cached .exe if source + serverUrl haven't changed
    if (_exeCache.hash === currentHash && _exeCache.serverUrl === serverUrl && _exeCache.path && existsSync(_exeCache.path)) {
      const stat = statSync(_exeCache.path);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="CloudFuze-Agent-Setup.exe"');
      res.setHeader('Content-Length', stat.size);
      return res.send(readFileSync(_exeCache.path));
    }

    // Find NSIS
    const nsisLocations = [
      'C:\\Program Files (x86)\\NSIS\\makensis.exe',
      'C:\\Program Files\\NSIS\\makensis.exe',
    ];
    const nsisPath = nsisLocations.find(p => existsSync(p));
    if (!nsisPath) {
      return res.status(501).json({
        error: 'NSIS not installed on this machine',
        help: 'Install NSIS from https://nsis.sourceforge.io to enable .exe builds. Or use the zip download instead.',
      });
    }

    if (!existsSync(nsiScript)) {
      return res.status(500).json({ error: 'NSIS script not found (agent/installer/cloudfuze-agent.nsi)' });
    }

    // Prepare build directory with agent source
    mkdirSync(join(buildDir, 'agent', 'src'), { recursive: true });
    cpSync(join(agentDir, 'src'), join(buildDir, 'agent', 'src'), { recursive: true, force: true });
    cpSync(join(agentDir, 'package.json'), join(buildDir, 'agent', 'package.json'), { force: true });

    // Download portable Node.js if not already cached.
    // Uses Node's own fetch rather than shelling out to Invoke-WebRequest —
    // spawning powershell/cmd.exe here has been observed to fail with
    // "spawnSync cmd.exe ENOENT" depending on the parent process's inherited
    // environment, which a plain HTTP download doesn't depend on.
    const bundledNode = join(buildDir, 'node', 'node.exe');
    if (!existsSync(bundledNode)) {
      const zipPath = join(buildDir, 'node.zip');
      const extractedDir = join(buildDir, 'node-v22.15.0-win-x64');
      try {
        const nodeZipUrl = 'https://nodejs.org/dist/v22.15.0/node-v22.15.0-win-x64.zip';
        const resp = await fetch(nodeZipUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${nodeZipUrl}`);
        writeFileSync(zipPath, Buffer.from(await resp.arrayBuffer()));

        execSync(
          `powershell -NoProfile -Command "Expand-Archive -Path 'node.zip' -DestinationPath '.' -Force"`,
          { cwd: buildDir, stdio: 'pipe', timeout: 60000 },
        );
        mkdirSync(join(buildDir, 'node'), { recursive: true });
        cpSync(extractedDir, join(buildDir, 'node'), { recursive: true, force: true });
        rmSync(extractedDir, { recursive: true, force: true });
        rmSync(zipPath, { force: true });
      } catch (e) {
        return res.status(500).json({ error: 'Failed to download portable Node.js for bundling', detail: e.message });
      }
    }

    // Run NSIS — needs native Windows paths (backslashes)
    const winPath = p => p.replace(/\//g, '\\');
    const result = spawnSync(nsisPath, [
      `-DSERVER_URL=${serverUrl}`,
      `-DENROLL_SECRET=${ENROLL_SECRET}`,
      `-DBUILD_DIR=${winPath(buildDir)}`,
      winPath(nsiScript),
    ], { cwd: installerDir, stdio: 'pipe', timeout: 120000 });

    if (result.status !== 0) {
      const detail = [result.stdout, result.stderr].filter(Boolean).map(b => b.toString()).join('\n').slice(0, 500);
      return res.status(500).json({ error: 'NSIS build failed', detail });
    }

    if (!existsSync(outExe)) {
      return res.status(500).json({ error: 'NSIS produced no output .exe' });
    }

    // Cache for next request
    _exeCache = { serverUrl, hash: currentHash, path: outExe };

    const stat = statSync(outExe);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="CloudFuze-Agent-Setup.exe"');
    res.setHeader('Content-Length', stat.size);
    res.send(readFileSync(outExe));
  }));

  // ── Download pre-configured desktop agent package ──

  app.get('/api/v1/installations/agent-installer', a(async (req, res) => {
    const platform = req.query.platform || 'windows';
    const serverUrl = apiServerUrl(req);

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
        'setlocal enabledelayedexpansion',
        'title CloudFuze Desktop Agent',
        'echo ============================================',
        'echo    CloudFuze Desktop Agent - Install',
        'echo ============================================',
        'echo.',
        '',
        'REM -- Find Node.js --',
        'set "NODE="',
        'set "NPM="',
        '',
        'REM 1. Bundled Node.js (from a previous install)',
        'if exist "%~dp0node\\node.exe" (',
        '  set "NODE=%~dp0node\\node.exe"',
        '  set "NPM=%~dp0node\\npm.cmd"',
        '  echo [OK] Using bundled Node.js',
        '  goto :node_ready',
        ')',
        '',
        'REM 2. System Node.js',
        'where node >nul 2>&1',
        'if !ERRORLEVEL! equ 0 (',
        '  set "NODE=node"',
        '  set "NPM=npm"',
        '  echo [OK] Using system Node.js',
        '  goto :node_ready',
        ')',
        '',
        'REM 3. Download portable Node.js',
        'echo [..] Node.js not found - downloading portable version...',
        'echo     This is a one-time download (~30 MB)...',
        'powershell -NoProfile -Command "Invoke-WebRequest -Uri \'https://nodejs.org/dist/v22.15.0/node-v22.15.0-win-x64.zip\' -OutFile \'%~dp0node.zip\'"',
        'if not exist "%~dp0node.zip" (',
        '  echo.',
        '  echo [ERROR] Failed to download Node.js.',
        '  echo Please install Node.js from https://nodejs.org and try again.',
        '  echo.',
        '  pause',
        '  exit /b 1',
        ')',
        'echo [..] Extracting...',
        'powershell -NoProfile -Command "Expand-Archive -Path \'%~dp0node.zip\' -DestinationPath \'%~dp0\' -Force"',
        'if exist "%~dp0node-v22.15.0-win-x64" ren "%~dp0node-v22.15.0-win-x64" node',
        'del "%~dp0node.zip" 2>nul',
        'if exist "%~dp0node\\node.exe" (',
        '  set "NODE=%~dp0node\\node.exe"',
        '  set "NPM=%~dp0node\\npm.cmd"',
        '  echo [OK] Node.js ready',
        ') else (',
        '  echo [ERROR] Node.js extraction failed.',
        '  pause',
        '  exit /b 1',
        ')',
        '',
        ':node_ready',
        'echo.',
        '',
        'REM -- Stop old agent if running --',
        'if exist "%USERPROFILE%\\.cloudfuze-aigov\\monitor.lock" (',
        '  set /p OLD_PID=<"%USERPROFILE%\\.cloudfuze-aigov\\monitor.lock"',
        '  echo [..] Stopping previous agent...',
        '  taskkill /PID !OLD_PID! /F >nul 2>&1',
        '  del "%USERPROFILE%\\.cloudfuze-aigov\\monitor.lock" >nul 2>&1',
        '  timeout /t 2 /nobreak >nul',
        '  echo [OK] Previous agent stopped',
        ')',
        '',
        'REM -- Check agent source --',
        'if not exist "%~dp0agent\\src\\index.js" (',
        '  echo [ERROR] Agent source files not found!',
        '  echo Expected: %~dp0agent\\src\\index.js',
        '  pause',
        '  exit /b 1',
        ')',
        '',
        'REM -- Install dependencies --',
        'echo [..] Installing dependencies (this may take a minute)...',
        'cd /d "%~dp0agent"',
        'call "!NPM!" install --production 2>nul',
        'echo [OK] Dependencies installed',
        'echo.',
        '',
        'REM -- Save config and enroll --',
        'if not exist "%USERPROFILE%\\.cloudfuze-aigov" mkdir "%USERPROFILE%\\.cloudfuze-aigov"',
        `echo {"serverUrl":"${serverUrl}","enrollSecret":"${ENROLL_SECRET}"}> "%USERPROFILE%\\.cloudfuze-aigov\\auto-config.json"`,
        '',
        `echo [..] Enrolling with server (${serverUrl})...`,
        `"!NODE!" src/index.js --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --output NUL`,
        'if !ERRORLEVEL! neq 0 (',
        '  echo [WARNING] Enrollment had issues but continuing...',
        ')',
        'echo [OK] Enrolled',
        'echo.',
        '',
        'REM -- Start agent in background --',
        'echo [..] Starting agent...',
        `start "" /B "!NODE!" src/index.js --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --monitor`,
        'echo.',
        'echo ============================================',
        'echo    CloudFuze agent is installed and running!',
        'echo ============================================',
        'echo.',
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

// The ZIP writer this used to define inline now lives in ../lib/zip.js — the same
// implementation was duplicated verbatim in routes/connections.js. Imported at the
// top of this file.
