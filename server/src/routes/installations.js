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

// The address a downloaded extension or tracker will call home on. Baked into
// every installer at download time, so getting it wrong produces a package that
// installs cleanly and reports nowhere.
//
// PUBLIC_SERVER_URL wins whenever it is set, because derivation cannot get this
// right behind a TLS terminator. On the cftools.live deployment the dashboard is
// served at https://agentgovernence.cftools.live/CloudFuze/ and nginx proxies
// /api to the API — but the rule below appends the API's own port, producing
// https://<domain>:8787, and 8787 speaks plain HTTP. Verified: that URL fails to
// connect while https://<domain>/api/v1/health and a POST to /api/v1/enroll both
// answer through the proxy. Setting PUBLIC_SERVER_URL=https://<domain> is what
// makes installers use the proxied origin, with TLS and no extra port to open.
const PUBLIC_SERVER_URL = (process.env.PUBLIC_SERVER_URL || '').trim().replace(/\/+$/, '');

// Falls back to the request's hostname with the server's own PORT — not the
// frontend port the request may have arrived through (nginx proxies /api here).
function apiServerUrl(req) {
  if (PUBLIC_SERVER_URL) return PUBLIC_SERVER_URL;
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
          hash.update(readFileSync(full));
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

    // ?flavour=claude — a Claude-only build.
    //
    // The narrowing is done in the MANIFEST, not in configuration or a runtime flag,
    // because the point is an extension that CANNOT read anything but Claude. Chrome
    // enforces host_permissions and content_script matches; a setting the background
    // worker consults could be changed later, and an admin who told colleagues "this
    // only watches Claude" would have been made to say something untrue.
    //
    // Three things have to change together — missing any one leaves the build able to
    // see every site:
    //   host_permissions       — drop <all_urls> and every non-Claude origin
    //   content_scripts        — including the SECOND block, which injects
    //                            fingerprint.js on <all_urls>
    //   web_accessible_resources — its matches are <all_urls> too
    if (String(req.query.flavour || '') === 'claude') {
      const CLAUDE = 'https://claude.ai/*';
      const mi = files.findIndex((f) => f.name === 'manifest.json');
      if (mi === -1) {
        return res.status(500).json({ error: 'Extension manifest.json not found in source' });
      }
      const m = JSON.parse(files[mi].data.toString('utf8'));

      // The service worker POSTs captures to the server, and an MV3 worker needs the
      // target origin permitted. Derived from this request rather than hardcoded, so
      // a build downloaded from the deployed host reaches that host.
      let serverOrigin = null;
      try { serverOrigin = new URL(serverUrl).origin + '/*'; } catch { /* leave null */ }

      m.name = 'CloudFuze Claude Usage Tracker';
      m.description = 'Tracks Claude usage only. Reads claude.ai and nothing else.';
      m.host_permissions = [CLAUDE, ...(serverOrigin ? [serverOrigin] : [])];

      m.content_scripts = (m.content_scripts || [])
        .map((cs) => ({ ...cs, matches: (cs.matches || []).includes(CLAUDE) || (cs.matches || []).includes('<all_urls>') ? [CLAUDE] : [] }))
        .filter((cs) => cs.matches.length > 0);

      m.web_accessible_resources = (m.web_accessible_resources || [])
        .map((war) => ({ ...war, matches: [CLAUDE] }));

      files[mi] = { name: 'manifest.json', data: Buffer.from(JSON.stringify(m, null, 2), 'utf8') };
    }

    const claudeOnly = String(req.query.flavour || '') === 'claude';
    const zipBuffer = createZip(files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${claudeOnly ? 'CloudFuze-Claude-Extension.zip' : 'CloudFuze-Browser-Extension.zip'}"`);
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

  // ── Claude Usage Tracker (.exe) ─────────────────────────────────────────────
  //
  // A separate download from the desktop agent, and deliberately so. The agent
  // scans for every AI tool and monitors clipboard and prompts across all of them;
  // this tracker watches Claude only — agent/src/claude_tracker/config.js pins
  // DESKTOP_PROCESSES to ['Claude']. An admin deploying it to colleagues is asking
  // for far narrower consent than the full agent needs, so the two must not be
  // reachable through one button.
  //
  // Serves the prebuilt artifact rather than building on demand: the binary is a
  // ~85 MB Node SEA and postject injection takes minutes, which is not something to
  // do inside a request. `npm run build:claude-tracker` in agent/ produces it.
  app.get('/api/v1/installations/claude-tracker', a(async (req, res) => {
    const agentDir = join(__dirname, '..', '..', '..', 'agent');

    // The TARGET machine's platform, not this server's.
    //
    // This used to resolve `process.platform`, which is the platform the API runs
    // on — linux-x64 in the container. The tracker is for employees' Windows
    // desktops, so the server would look for a linux build that has no reason to
    // exist and 501 even with the .exe sitting right there. Defaults to Windows
    // because that is what the Setup button offers; ?target= serves another build.
    const target = String(req.query.target || 'win32-x64');
    if (!/^[a-z0-9]+-[a-z0-9]+$/i.test(target)) {
      return res.status(400).json({ error: `invalid target "${target}" — expected <platform>-<arch>, e.g. win32-x64` });
    }

    // prebuilt/ is what a deploy ships (scripts/deploy.mjs stages it there because
    // build/ is excluded from both the deploy tar and .dockerignore). build/ is
    // where a local `npm run build:claude-tracker` writes, so a developer's own
    // build still serves without any staging step.
    const candidates = [
      join(agentDir, 'prebuilt', `claude-tracker-${target}`),
      join(agentDir, 'build', `claude-tracker-${target}`),
    ];
    const buildDir = candidates.find((d) => existsSync(d));

    if (!buildDir) {
      // 501, not 500: nothing is broken, the artifact simply has not been built for
      // this target on this host. Says which command produces it, where it looked,
      // and which targets ARE present — the last one turns "it doesn't work" into
      // "it was built for the wrong platform" without a support round trip.
      // `detail` as well as `help`: the UI's download() shows error + detail in its
      // alert and ignores every other field, so guidance placed only in `help` would
      // never reach the admin who needs it.
      const available = [];
      for (const dir of [join(agentDir, 'prebuilt'), join(agentDir, 'build')]) {
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir)) {
          const m = /^claude-tracker-(.+)$/.exec(name);
          if (m && statSync(join(dir, name)).isDirectory()) available.push(m[1]);
        }
      }
      const guidance = 'Deploy from a Windows machine (scripts/deploy.mjs builds and ships it), or run "npm run build:claude-tracker" in agent/ with CFAI_SERVER_URL and CFAI_ENROLL_SECRET set so the binary points at this server.';
      return res.status(501).json({
        error: `Claude Usage Tracker has not been built for ${target} on this server`,
        detail: available.length
          ? `${guidance} Available targets: ${[...new Set(available)].join(', ')}.`
          : guidance,
        help: guidance,
        expected_path: candidates[0],
        available_targets: [...new Set(available)],
      });
    }

    // prompt-watcher.ps1 is not optional — findWatcherScript() in the tracker looks
    // for it beside the executable and exits if it is absent. Shipping the exe alone
    // produces a tracker that dies on launch, so a missing script is a hard error
    // rather than a partial zip.
    const files = [];
    let sawExe = false;
    let sawWatcher = false;
    for (const name of readdirSync(buildDir)) {
      const full = join(buildDir, name);
      if (!statSync(full).isFile()) continue;
      if (/\.exe$/i.test(name)) sawExe = true;
      if (/^prompt-watcher\.ps1$/i.test(name)) sawWatcher = true;
      files.push({ name, data: readFileSync(full), mtime: statSync(full).mtime });
    }

    if (!sawExe || !sawWatcher) {
      return res.status(500).json({
        error: 'Claude Usage Tracker build is incomplete',
        detail: `${sawExe ? '' : 'missing the .exe; '}${sawWatcher ? '' : 'missing prompt-watcher.ps1, which the tracker requires beside the executable'}`.trim(),
        help: 'Rebuild with "npm run build:claude-tracker" in agent/.',
      });
    }

    const zip = createZip(files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="CloudFuze-Claude-Usage-Tracker.zip"');
    res.setHeader('Content-Length', zip.length);
    res.send(zip);
  }));

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
      windows: `@echo off
title CloudFuze Desktop Agent - Installing...
echo.
echo  ============================================
echo     CloudFuze Desktop Agent - Install
echo  ============================================
echo.
echo  Please wait...
echo.

REM -- Find Node.js --
set "NODE="
set "NPM="
if exist "%~dp0node\\node.exe" set "NODE=%~dp0node\\node.exe" & set "NPM=%~dp0node\\npm.cmd" & echo  [OK] Using bundled Node.js & goto FOUND_NODE
where node >nul 2>&1 && set "NODE=node" & set "NPM=npm" & echo  [OK] Using system Node.js & goto FOUND_NODE
echo  [..] Node.js not found - downloading (~30 MB)...
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.15.0/node-v22.15.0-win-x64.zip' -OutFile '%~dp0node.zip'"
if not exist "%~dp0node.zip" echo  [ERROR] Download failed. Install Node.js from nodejs.org & goto DONE
echo  [..] Extracting...
powershell -NoProfile -Command "Expand-Archive -Path '%~dp0node.zip' -DestinationPath '%~dp0' -Force"
if exist "%~dp0node-v22.15.0-win-x64" ren "%~dp0node-v22.15.0-win-x64" node
del "%~dp0node.zip" 2>nul
if not exist "%~dp0node\\node.exe" echo  [ERROR] Extraction failed. & goto DONE
set "NODE=%~dp0node\\node.exe"
set "NPM=%~dp0node\\npm.cmd"
echo  [OK] Node.js ready

:FOUND_NODE
echo.

REM -- Check source --
if not exist "%~dp0agent\\src\\index.js" echo  [ERROR] Agent source not found! & goto DONE

REM -- Stop old agent --
taskkill /IM node.exe /FI "WINDOWTITLE eq CloudFuze*" /F >nul 2>&1
if exist "%USERPROFILE%\\.cloudfuze-aigov\\monitor.lock" del "%USERPROFILE%\\.cloudfuze-aigov\\monitor.lock" >nul 2>&1

REM -- Install dependencies --
echo  [..] Installing dependencies (may take a minute)...
cd /d "%~dp0agent"
call "%NPM%" install --production >nul 2>&1
echo  [OK] Dependencies installed

REM -- Save config --
if not exist "%USERPROFILE%\\.cloudfuze-aigov" mkdir "%USERPROFILE%\\.cloudfuze-aigov"
> "%USERPROFILE%\\.cloudfuze-aigov\\auto-config.json" echo {"serverUrl":"${serverUrl}","enrollSecret":"${ENROLL_SECRET}"}

REM -- Enroll --
echo  [..] Enrolling with server...
"%NODE%" src/index.js --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --output NUL 2>nul
echo  [OK] Enrolled

REM -- Create hidden launcher --
> "%~dp0agent\\start-agent.vbs" echo Set ws = CreateObject("WScript.Shell")
>> "%~dp0agent\\start-agent.vbs" echo ws.Run """%NODE%"" ""%~dp0agent\\src\\index.js"" --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --monitor", 0, False

REM -- Auto-start on boot --
reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v CloudFuzeAgent /d "wscript.exe \\"%~dp0agent\\start-agent.vbs\\"" /f >nul 2>&1
echo  [OK] Auto-start registered

REM -- Start now --
echo  [..] Starting agent...
start "" wscript.exe "%~dp0agent\\start-agent.vbs"
echo.
echo  ============================================
echo     Installation complete!
echo  ============================================
echo.

:DONE
echo.
echo  Press any key to close this window...
pause >nul
`.replace(/\n/g, '\r\n'),
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
        '# Register auto-start on boot (macOS LaunchAgent)',
        'PLIST=~/Library/LaunchAgents/com.cloudfuze.agent.plist',
        'mkdir -p ~/Library/LaunchAgents',
        `cat > "$PLIST" << PLISTEOF`,
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0"><dict>',
        '  <key>Label</key><string>com.cloudfuze.agent</string>',
        `  <key>ProgramArguments</key><array><string>$NODE</string><string>$SCRIPT_DIR/agent/src/index.js</string><string>--server</string><string>${serverUrl}</string><string>--enroll-secret</string><string>${ENROLL_SECRET}</string><string>--monitor</string></array>`,
        `  <key>WorkingDirectory</key><string>$SCRIPT_DIR/agent</string>`,
        '  <key>RunAtLoad</key><true/>',
        '  <key>KeepAlive</key><true/>',
        '  <key>StandardOutPath</key><string>/tmp/cloudfuze-agent.log</string>',
        '  <key>StandardErrorPath</key><string>/tmp/cloudfuze-agent.log</string>',
        '</dict></plist>',
        'PLISTEOF',
        'launchctl unload "$PLIST" 2>/dev/null || true',
        'launchctl load "$PLIST"',
        'echo "[OK] Auto-start registered"',
        'echo ""',
        'echo "============================================"',
        'echo "   CloudFuze agent is installed and running!"',
        'echo "============================================"',
        'echo ""',
        'echo "Agent starts automatically on boot."',
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
        '# Register auto-start on boot (crontab @reboot)',
        `CRON_CMD="@reboot cd $SCRIPT_DIR/agent && $NODE src/index.js --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --monitor > /dev/null 2>&1"`,
        '(crontab -l 2>/dev/null | grep -v cloudfuze; echo "$CRON_CMD # cloudfuze") | crontab -',
        'echo "[OK] Auto-start registered"',
        'echo "[..] Starting agent..."',
        `nohup "$NODE" src/index.js --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --monitor > /dev/null 2>&1 &`,
        'echo ""',
        'echo "============================================"',
        'echo "   CloudFuze agent is installed and running!"',
        'echo "============================================"',
        'echo ""',
        'echo "Agent starts automatically on boot."',
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
