// Unit-style test for the two new extraction paths:
//   1. ZIP recursive: a zip containing a .env and a .docx, both with secrets
//   2. Image OCR:     a PNG generated with text containing a fake API key
//
// Asserts the file-handler produces the expected content_scan results.

import JSZip from 'jszip';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildFileUploadEvent } from '../src/os_monitor/file-handler.js';

const log = { warn: console.warn, info: () => {} };

const workDir = join(tmpdir(), 'cfai-zip-image-test');
await mkdir(workDir, { recursive: true });

// =====================================================================
// 1. ZIP recursive test
// =====================================================================
console.log('=== Test 1: ZIP with nested .env and .docx, both with secrets ===');

// Build inner .docx
const innerDocx = new JSZip();
innerDocx.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
innerDocx.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
innerDocx.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Quarterly report - AWS access key for production: AKIAIOSFODNN7EXAMPLE</w:t></w:r></w:p>
  </w:body>
</w:document>`);
const docxBuf = await innerDocx.generateAsync({ type: 'nodebuffer' });

// Build outer zip containing .env + the .docx
const zip = new JSZip();
zip.file('.env.production', `OPENAI_API_KEY=sk-proj-test1234567890abcdefghijklmnopqrstuv
DB_PASSWORD=super-secret`);
zip.file('readme.md', '# Quarterly leak audit\n\nNothing to see here.');
zip.file('admin-secrets.docx', docxBuf);
const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
const zipPath = join(workDir, 'Q4_archive.zip');
await writeFile(zipPath, zipBuf);
console.log(`Wrote ${zipBuf.length} bytes to ${zipPath}`);

const zipEvent = await buildFileUploadEvent({
  path: zipPath,
  via: 'clipboard_file_copy',
  service: 'Cursor',
  vendor: 'Anysphere',
  processName: 'Cursor',
  windowTitle: 'test',
  log,
});
console.log('zip event content_scan:');
console.log(JSON.stringify(zipEvent.content_scan, null, 2));

// Quick assertions
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else       { console.log('OK:  ', msg); }
}
assert(zipEvent.content_scan.scanned, 'zip scanned=true');
assert(zipEvent.content_scan.via === 'jszip', 'via=jszip');
assert(zipEvent.content_scan.entries >= 3, 'all 3 entries seen');
const patterns = (zipEvent.content_scan.matches || []).map((m) => m.pattern).sort();
assert(patterns.includes('openai-api-key'), 'found openai-api-key in .env entry');
assert(patterns.includes('aws-access-key'), 'found aws-access-key in nested .docx entry');
assert(zipEvent.content_scan.contentSeverity === 'critical', 'overall severity=critical');

// =====================================================================
// 2. Image OCR test — generate a PNG with rendered text via SVG-to-PNG
// =====================================================================
console.log('\n=== Test 2: image OCR finds an API key rendered in a PNG ===');
console.log('(this takes ~5-10s on first run while tesseract loads the eng model)');

// Use a known-good PNG generated from SVG. Node doesn't have a built-in
// rasterizer, so we craft a tiny BMP with monospace ASCII text instead —
// Tesseract can OCR BMPs too. To avoid pulling in a canvas dep, we'll just
// skip this test if no test image is provided AND we don't have one to generate.
//
// Workaround: write a minimal text image by leveraging the system's
// PowerShell + System.Drawing to render text to PNG, which IS available
// on Windows. Spawn it.
import { spawnSync } from 'node:child_process';
const pngPath = join(workDir, 'leaked-screenshot.png');
const ps = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 700,180
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font('Consolas',18,[System.Drawing.FontStyle]::Bold)
$brush = [System.Drawing.Brushes]::Black
$g.DrawString('Production API key:', $font, $brush, 10, 10)
$g.DrawString('sk-proj-abcdefghijklmnopqrstuvwxyz12345', $font, $brush, 10, 50)
$g.DrawString('Employee SSN: 222-33-4444', $font, $brush, 10, 100)
$g.Dispose()
$bmp.Save('${pngPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
`;
const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
if (r.status !== 0) { console.error('PNG generation failed:', r.stderr); process.exit(1); }
console.log(`Generated PNG: ${pngPath}`);

const imgEvent = await buildFileUploadEvent({
  path: pngPath,
  via: 'clipboard_file_copy',
  service: 'Cursor',
  vendor: 'Anysphere',
  processName: 'Cursor',
  windowTitle: 'test',
  log,
});
console.log('image event content_scan:');
console.log(JSON.stringify(imgEvent.content_scan, null, 2));

if (imgEvent.content_scan.scanned) {
  assert(imgEvent.content_scan.via === 'tesseract', 'via=tesseract');
  const imgPatterns = (imgEvent.content_scan.matches || []).map((m) => m.pattern).sort();
  // OCR may not be perfect — accept if it found at least one of the two expected patterns
  const found = imgPatterns.filter((p) => p === 'openai-api-key' || p === 'us-ssn');
  assert(found.length >= 1, `OCR found at least one secret pattern (got: ${imgPatterns.join(',') || 'none'})`);
} else {
  console.log('OCR fail reason:', imgEvent.content_scan);
  process.exitCode = 1;
}

console.log('\nAll tests complete.');
process.exit(process.exitCode || 0);
