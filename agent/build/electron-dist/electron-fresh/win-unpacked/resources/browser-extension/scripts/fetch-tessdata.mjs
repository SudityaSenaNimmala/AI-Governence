#!/usr/bin/env node
// Download the Tesseract English language model (eng.traineddata.gz, ~10 MB)
// into vendor/tesseract/ so the OCR runs fully offline. Run once after `npm install`.

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'vendor', 'tesseract', 'eng.traineddata.gz');

await mkdir(dirname(target), { recursive: true });

try {
  const s = await stat(target);
  if (s.size > 1024 * 1024) {
    console.log(`eng.traineddata.gz already present (${(s.size / 1024 / 1024).toFixed(1)} MB) — skipping`);
    process.exit(0);
  }
} catch {}

console.log('Downloading eng.traineddata.gz from tessdata.projectnaptha.com ...');
const url = 'https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz';
const res = await fetch(url);
if (!res.ok) {
  console.error(`Download failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
await writeFile(target, buf);
console.log(`  wrote ${target}  (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
