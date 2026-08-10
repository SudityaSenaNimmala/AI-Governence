// Installations — generate pre-configured browser extension and agent downloads.
//
// The extension zip has serverUrl + enrollSecret baked into a config.json file
// so employees install it and it auto-enrolls — zero configuration needed.
// The agent command has the same values pre-filled.

import { a } from '../util.js';
import { ENROLL_SECRET } from '../auth.js';
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
      windows: `@echo off\r\necho Installing CloudFuze Desktop Agent...\r\ncd /d "%~dp0"\r\ncall npm install --production 2>nul\r\nif not exist "%USERPROFILE%\\.cloudfuze-aigov" mkdir "%USERPROFILE%\\.cloudfuze-aigov"\r\necho {"serverUrl":"${serverUrl}","enrollSecret":"${ENROLL_SECRET}"}> "%USERPROFILE%\\.cloudfuze-aigov\\auto-config.json"\r\nnode src/index.js --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --output NUL\r\necho.\r\necho Agent installed and enrolled!\r\necho To start monitoring: node src/index.js --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --monitor\r\npause\r\n`,
      macos: `#!/bin/bash\nset -e\necho "Installing CloudFuze Desktop Agent..."\ncd "$(dirname "$0")"\nnpm install --production 2>/dev/null\nmkdir -p ~/.cloudfuze-aigov\necho '{"serverUrl":"${serverUrl}","enrollSecret":"${ENROLL_SECRET}"}' > ~/.cloudfuze-aigov/auto-config.json\nnode src/index.js --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --output /dev/null\necho ""\necho "Agent installed and enrolled!"\necho "To start monitoring: node src/index.js --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --monitor"\n`,
      linux: `#!/bin/bash\nset -e\necho "Installing CloudFuze Desktop Agent..."\ncd "$(dirname "$0")"\nnpm install --production 2>/dev/null\nmkdir -p ~/.cloudfuze-aigov\necho '{"serverUrl":"${serverUrl}","enrollSecret":"${ENROLL_SECRET}"}' > ~/.cloudfuze-aigov/auto-config.json\nnode src/index.js --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --output /dev/null\necho ""\necho "Agent installed and enrolled!"\necho "To start monitoring: node src/index.js --server ${serverUrl} --enroll-secret ${ENROLL_SECRET} --monitor"\n`,
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
