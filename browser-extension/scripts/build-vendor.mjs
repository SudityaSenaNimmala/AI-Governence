#!/usr/bin/env node
// Copy the UMD/browser builds of pdf.js, mammoth, xlsx, jszip, tesseract.js
// into vendor/ so the extension can load them as classic content scripts.

import { copyFile, mkdir, stat } from 'node:fs/promises';
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
];

let copied = 0;
for (const { src, dest } of targets) {
  try {
    await stat(join(extRoot, src));
  } catch {
    console.warn(`  SKIP: ${src} not found`);
    continue;
  }
  await copyFile(join(extRoot, src), join(extRoot, dest));
  const s = await stat(join(extRoot, dest));
  console.log(`  ${dest}  (${(s.size / 1024).toFixed(0)} KB)`);
  copied++;
}
console.log(`\nCopied ${copied}/${targets.length} files.`);
console.log(`Now run: node scripts/fetch-tessdata.mjs   (downloads English OCR model ~10MB)`);
