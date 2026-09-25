# Building the agent

The agent is distributed as a small folder per platform:

```
ai-gov-agent[.exe]      # Node 22 SEA-bundled single executable
better_sqlite3.node     # native SQLite binding (loaded at runtime)
README.txt
```
## Local build (host platform only)
```bash
npm install
npm run build           # bundles JS + builds SEA binary for current platform
```
Output: `build/<platform>-<arch>/`

Node SEA does **not** cross-compile. To produce binaries for all three
platforms, run the build on each platform (or use a CI matrix:
`macos-latest` / `ubuntu-latest` / `windows-latest`).

## What the build does

1. **esbuild** bundles `src/index.js` → `build/agent.bundle.js` (CJS, Node target).
   - `better-sqlite3` is kept external because it's a native `.node` module.
2. **`node --experimental-sea-config`** generates the SEA blob from the bundle.
3. **postject** injects the blob into a copy of the host's `node` executable.
4. The `better_sqlite3.node` native binding is copied next to the binary.

## Signing

### Windows
```powershell
signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a `
  build\win32-x64\ai-gov-agent.exe
```
Requires an EV code-signing certificate (DigiCert / Sectigo).

### macOS
```bash
codesign --sign "Developer ID Application: CloudFuze, Inc." \
  --options runtime --entitlements entitlements.plist \
  build/darwin-arm64/ai-gov-agent
xcrun notarytool submit build/darwin-arm64/ai-gov-agent --keychain-profile aigov --wait
```

### Linux
GPG-sign the `.deb` / `.rpm` produced by the distro packaging step
(not yet implemented — see TODO in `installer/linux/`).

## Electron desktop app (Windows)

A separate build from the SEA binary above — this is the full Electron app
(banner/popup/dialog UI, system tray) that `server/src/routes/installations.js`'s
`/api/v1/installations/desktop-app` route serves. It reads a **pre-built**
snapshot at `agent/build/electron-dist/win-unpacked/` rather than building live,
so that snapshot has to be regenerated and re-committed (it's tracked via Git
LFS) whenever `agent/src/` or `browser-extension/` changes and someone needs
the desktop-app download to reflect it — the production server is Linux and
cannot run `electron-builder` for a Windows target itself.

```powershell
cd agent/electron
npm run dist:win
```
Output: `agent/build/electron-dist/win-unpacked/`.

### One-time Windows prerequisite: symbolic-link privilege

The first time this runs on a given machine/account, it fails partway through
with:
```
ERROR: Cannot create symbolic link : A required privilege is not held by the client.
```
`electron-builder` downloads a bundled toolset (`winCodeSign`) that contains
macOS `.dylib` files stored as symlinks, and extracting those requires a
privilege a standard Windows account doesn't have by default — this happens
even for a Windows-only (`--win`) build, and is unrelated to code-signing
actually being configured (signing is skipped either way with no cert
configured). Fix with either:
- **Enable Developer Mode** (Settings → Privacy & security → For developers →
  Developer Mode). One-time per machine; every future build on that account
  just works afterward.
- Run the build from an **elevated** (Administrator) terminal instead, if you'd
  rather not change that setting.

### `assets/icon.png` must be at least 256×256

`electron-builder` needs at least a 256×256 source image to generate the
Windows `.ico`; a smaller one fails the build with
`image ... must be at least 256x256` before it gets anywhere near packaging.

## CI build matrix (sketch — GitHub Actions)

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
runs-on: ${{ matrix.os }}
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with: { node-version: '22' }
  - run: npm ci --prefix agent
  - run: npm run build --prefix agent
  - uses: actions/upload-artifact@v4
    with:
      name: agent-${{ matrix.os }}
      path: agent/build/
```
