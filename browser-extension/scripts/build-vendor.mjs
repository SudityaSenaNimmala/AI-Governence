#!/usr/bin/env node
// Copy the UMD/browser builds of pdf.js, mammoth, xlsx, jszip, tesseract.js and
// the rrweb recorder into vendor/ so the extension can load them as classic
// content scripts.

import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extRoot = join(here, '..');

await mkdir(join(extRoot, 'vendor'), { recursive: true });
await mkdir(join(extRoot, 'vendor/tesseract'), { recursive: true });

const targets = [
  // pdf.js
  { src: 'node_modules/pdfjs-dist/legacy/build/pdf.js',         dest: 'vendor/pdf.js' },
  { src: 'node_modules/pdfjs-dist/legacy/build/pdf.worker.js',  dest: 'vendor/pdf.worker.js' },
  // mammoth (Word)
  { src: 'node_modules/mammoth/mammoth.browser.min.js',         dest: 'vendor/mammoth.min.js' },
  // SheetJS (Excel)
  { src: 'node_modules/xlsx/dist/xlsx.full.min.js',             dest: 'vendor/xlsx.min.js' },
  // JSZip
  { src: 'node_modules/jszip/dist/jszip.min.js',                dest: 'vendor/jszip.min.js' },
  // Tesseract.js (OCR for images) — main script + worker + WASM core
  { src: 'node_modules/tesseract.js/dist/tesseract.min.js',     dest: 'vendor/tesseract/tesseract.min.js' },
  { src: 'node_modules/tesseract.js/dist/worker.min.js',        dest: 'vendor/tesseract/worker.min.js' },
  { src: 'node_modules/tesseract.js-core/tesseract-core.wasm',  dest: 'vendor/tesseract/tesseract-core.wasm' },
  { src: 'node_modules/tesseract.js-core/tesseract-core.wasm.js', dest: 'vendor/tesseract/tesseract-core.wasm.js' },
  { src: 'node_modules/tesseract.js-core/tesseract-core-simd.wasm', dest: 'vendor/tesseract/tesseract-core-simd.wasm' },
  { src: 'node_modules/tesseract.js-core/tesseract-core-simd.wasm.js', dest: 'vendor/tesseract/tesseract-core-simd.wasm.js' },
  // LSTM variants — these are what tesseract.js v5 actually loads by default for OCR.
  { src: 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm', dest: 'vendor/tesseract/tesseract-core-lstm.wasm' },
  { src: 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', dest: 'vendor/tesseract/tesseract-core-lstm.wasm.js' },
  { src: 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', dest: 'vendor/tesseract/tesseract-core-simd-lstm.wasm' },
  { src: 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', dest: 'vendor/tesseract/tesseract-core-simd-lstm.wasm.js' },
  // rrweb RECORDER ONLY (@rrweb/record, not the `rrweb` package — that one also
  // carries the player, which the extension must never ship). The UMD build
  // assigns window.rrweb, which content/replay.js reads. stripSourceMap because
  // the sibling .map is ~800 KB of dead weight in the packed extension and a
  // missing map file logs a devtools warning on every page.
  {
    src: 'node_modules/@rrweb/record/dist/record.umd.min.cjs',
    dest: 'vendor/rrweb-record.js',
    stripSourceMap: true,
    versionCheck: {
      pkg: 'node_modules/@rrweb/record/package.json',
      pinnedIn: 'content/replay.js',
      re: /RRWEB_VERSION\s*=\s*'([^']+)'/,
    },
  },
];

let copied = 0;
for (const { src, dest, stripSourceMap, versionCheck } of targets) {
  try {
    await stat(join(extRoot, src));
  } catch {
    console.warn(`  SKIP: ${src} not found`);
    continue;
  }
  if (versionCheck) await warnOnVersionDrift(versionCheck);
  if (stripSourceMap) {
    // Same copy, minus the trailing sourceMappingURL comment.
    const text = await readFile(join(extRoot, src), 'utf8');
    await writeFile(join(extRoot, dest), text.replace(/\r?\n?\/\/#\s*sourceMappingURL=.*\s*$/, '\n'), 'utf8');
  } else {
    await copyFile(join(extRoot, src), join(extRoot, dest));
  }
  const s = await stat(join(extRoot, dest));
  console.log(`  ${dest}  (${(s.size / 1024).toFixed(0)} KB)`);
  copied++;
}

/**
 * The recorder version is ALSO hardcoded in the extension source (content/replay.js
 * sends it to the server as `recorder`, which is what tells a future player which
 * event schema it is looking at). A silent drift between the npm pin and that
 * constant would mislabel every stored run, so say so out loud — but warn, never
 * throw: `npm run vendor` must still produce a working bundle.
 */
async function warnOnVersionDrift({ pkg, pinnedIn, re }) {
  try {
    const installed = JSON.parse(await readFile(join(extRoot, pkg), 'utf8')).version;
    const declared = (await readFile(join(extRoot, pinnedIn), 'utf8')).match(re)?.[1];
    if (!declared) {
      console.warn(`  WARN: could not find the version constant in ${pinnedIn}`);
    } else if (declared !== installed) {
      console.warn(`  WARN: ${pkg} is ${installed} but ${pinnedIn} declares ${declared} —` +
                   ' stored runs would be labelled with the wrong recorder version');
    }
  } catch (e) {
    console.warn(`  WARN: version drift check failed: ${e?.message || e}`);
  }
}
console.log(`\nCopied ${copied}/${targets.length} files.`);
console.log(`Now run: node scripts/fetch-tessdata.mjs   (downloads English OCR model ~10MB)`);
