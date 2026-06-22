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
