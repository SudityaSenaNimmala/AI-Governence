// Desktop file-attachment scanning parity with the browser extension
// (browser-extension/content/content.js extractTextFromFile / scanFileContents):
//   * 25 MB content-scan cap, 8 MB OCR cap
//   * new extractors: .pptx/.pptm/.ppsx, .docm/.dotx, .odt/.odp, .xlsb/.xlsm/.ods,
//     .eml, .rtf, and .tif/.tiff images
//   * encrypted containers -> reason 'encrypted'
//   * ONE warm OCR thread on bundled language data (no CDN, no cwd cache)
//   * the content_scan.reason contract the enforcement side keys on
//
// Every fixture is generated in-test (tests/helpers/office-fixtures.mjs,
// tests/helpers/text-image.mjs), so this runs unchanged on the Linux CI runner.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildFileUploadEvent, SCAN_FAILURE_REASONS, SUSPICIOUS_REASONS, stripContentScanNames, TEXT_STREAM_MAX_BYTES,
} from '../src/os_monitor/file-handler.js';
import {
  CONTENT_SCAN_MAX_BYTES, OCR_MAX_BYTES, isBinaryParseable, isImage, isDocumentLikeFormat,
} from '../src/os_monitor/classifier.js';
import {
  rtfToText, emlToText, drawingMlText, odfText, isCfbEncryptedContainer, cfbKind, isDecompressionBomb,
} from '../src/os_monitor/binary-extractors.js';
import {
  ocrImageFile, ocrImageBuffer, cancelOcrGroup, ocrStats, shutdownOcr, resolveTessdataDir, tessdataCandidates,
  OCR_LANG_FILE, OCR_LANG_SHA256,
} from '../src/os_monitor/ocr-service.js';
import {
  wordPackage, presentationPackage, odfPackage, workbook, plainPdf, passwordPdf, emlMessage,
  encryptedOoxml, legacyCfb, zipBomb, nestedZip, emlWithAttachments,
} from './helpers/office-fixtures.mjs';
import { textPng, textTiff } from './helpers/text-image.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(HERE, '..');
const REPO = join(AGENT_DIR, '..');
const SSN = '123-45-6789';               // us-ssn, critical
const PHONE_IMG = '222-444-6666';        // us-phone, high -- reads cleanly off the bitmap font
const log = { warn() {}, info() {}, error() {} };

let dir;
let cwdBefore;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cfai-file-scan-'));
  // OCR runs with this as the working directory: the old code path wrote
  // eng.traineddata here after downloading it, and nothing may do that now.
  cwdBefore = process.cwd();
  process.chdir(dir);
});
after(async () => {
  shutdownOcr();
  process.chdir(cwdBefore);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

async function fixture(name, bytes) {
  const p = join(dir, name);
  await writeFile(p, bytes);
  return p;
}
function event(path, extra = {}) {
  return buildFileUploadEvent({
    path, via: 'composer_census', service: 'Microsoft 365 Copilot', vendor: 'Microsoft',
    processName: 'ms-teams', windowTitle: '', log, ...extra,
  });
}
const patterns = (ev) => (ev.content_scan.matches || []).map((m) => m.pattern);

// ── caps & classification ────────────────────────────────────────────────────

test('caps match the browser extension: 25 MB content scan, 8 MB OCR', async () => {
  assert.equal(CONTENT_SCAN_MAX_BYTES, 25 * 1024 * 1024);
  assert.equal(OCR_MAX_BYTES, 8 * 1024 * 1024);
  const content = await readFile(join(REPO, 'browser-extension', 'content', 'content.js'), 'utf8');
  assert.match(content, /const CONTENT_SCAN_MAX_BYTES = 25 \* 1024 \* 1024;/);
  assert.match(content, /const OCR_MAX_BYTES = 8 \* 1024 \* 1024;/);
});

test('new formats are routed to an extractor; legacy .doc/.ppt/.msg stay unsupported but unverified', () => {
  for (const n of ['a.pptx', 'a.pptm', 'a.ppsx', 'a.docm', 'a.dotx', 'a.odt', 'a.odp', 'a.xlsb', 'a.xlsm', 'a.ods', 'a.eml', 'a.rtf']) {
    assert.equal(isBinaryParseable(n), true, n);
    assert.equal(isDocumentLikeFormat(n), true, n);
  }
  for (const n of ['a.tif', 'a.tiff']) assert.equal(isImage(n), true, n);
  for (const n of ['a.doc', 'a.ppt', 'a.msg']) {
    assert.equal(isBinaryParseable(n), false, n);
    assert.equal(isDocumentLikeFormat(n), true, `${n} must still fail closed`);
  }
});

// ── new extractors, end to end through buildFileUploadEvent ──────────────────

for (const ext of ['.pptx', '.pptm', '.ppsx']) {
  test(`${ext}: slide runs and speaker notes are scanned (in-process and isolated)`, async () => {
    const buf = await presentationPackage({
      slides: [[['Quarterly ', 'review']], [['Nothing ', 'here']]],
      notes: [[['Customer SSN ', '123-45-', '6789']]],   // split across runs
    });
    const p = await fixture(`deck${ext}`, buf);
    for (const isolate of [false, true]) {
      const ev = await event(p, { isolate });
      assert.equal(ev.content_scan.scanned, true, JSON.stringify(ev.content_scan));
      assert.equal(ev.content_scan.via, 'jszip-pptx');
      assert.equal(ev.content_scan.pages, 2);
      assert.ok(patterns(ev).includes('us-ssn'), `isolate=${isolate}: ${patterns(ev)}`);
      assert.equal(ev.severity, 'critical');
    }
  });
}

for (const [ext, mainType] of [
  ['.docm', 'application/vnd.ms-word.document.macroEnabled.main+xml'],
  ['.dotx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml'],
]) {
  test(`${ext}: read by mammoth`, async () => {
    const p = await fixture(`memo${ext}`, await wordPackage(`Employee SSN ${SSN}`, { mainType }));
    const ev = await event(p, { isolate: true });
    assert.equal(ev.content_scan.scanned, true, JSON.stringify(ev.content_scan));
    assert.equal(ev.content_scan.via, 'mammoth');
    assert.ok(patterns(ev).includes('us-ssn'));
  });
}

for (const [ext, mimetype] of [
  ['.odt', 'application/vnd.oasis.opendocument.text'],
  ['.odp', 'application/vnd.oasis.opendocument.presentation'],
]) {
  test(`${ext}: content.xml text (text:s spacing restored) is scanned`, async () => {
    const p = await fixture(`notes${ext}`, await odfPackage(['Hello', `SSN ${SSN}`], { mimetype }));
    const ev = await event(p);
    assert.equal(ev.content_scan.scanned, true, JSON.stringify(ev.content_scan));
    assert.equal(ev.content_scan.via, 'jszip-odf');
    assert.ok(patterns(ev).includes('us-ssn'));
  });
}

for (const ext of ['xlsb', 'xlsm', 'ods']) {
  test(`.${ext}: read by SheetJS`, async () => {
    const p = await fixture(`book.${ext}`, workbook([['name', 'ssn'], ['Ann', SSN]], ext));
    const ev = await event(p, { isolate: true });
    assert.equal(ev.content_scan.scanned, true, JSON.stringify(ev.content_scan));
    assert.equal(ev.content_scan.via, 'sheetjs');
    assert.ok(patterns(ev).includes('us-ssn'));
  });
}

test('.eml: headers and base64 / quoted-printable text parts are scanned', async () => {
  const p = await fixture('fwd.eml', emlMessage({
    subject: 'payroll', textBody: `see SSN ${SSN}`, htmlBody: '<p style="x">key AKIAIOSFODNN7EXAMPLE</p>',
  }));
  const ev = await event(p);
  assert.equal(ev.content_scan.scanned, true, JSON.stringify(ev.content_scan));
  assert.equal(ev.content_scan.via, 'mime');
  assert.ok(patterns(ev).includes('us-ssn'));
  assert.ok(patterns(ev).includes('aws-access-key'), 'the QP html part is decoded too');
  const text = emlToText(emlMessage({ subject: '=?utf-8?B?SGVsbG8=?=', textBody: 'a', htmlBody: '<b>b</b>' }).toString('latin1'));
  assert.match(text, /subject: Hello/);
});

test('.rtf: control words stripped, tables skipped, \\u and \\\'hh decoded', async () => {
  const BS = String.fromCharCode(92);   // a backslash, kept out of any escape processing
  const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Times 123-45-0000;}}{\colortbl;\red0\green0\blue0;}` +
    String.raw`{\*\generator Riched20 999-99-9999;}\pard Caf\'e9 SSN \b 123-45-6789\b0\par ` +
    String.raw`{\header Head}\uc1` + BS + 'u8364?5' + BS + 'par}';   // U+20AC (euro), then '?' = the uc1 fallback char, which must be skipped
  const text = rtfToText(rtf);
  assert.match(text, /Café SSN 123-45-6789\n/);
  assert.match(text, /Head€5/);
  assert.doesNotMatch(text, /123-45-0000|999-99-9999|Times|Riched/, 'font table / \\* destinations are not text');
  const p = await fixture('letter.rtf', Buffer.from(rtf, 'latin1'));
  const ev = await event(p);
  assert.equal(ev.content_scan.scanned, true, JSON.stringify(ev.content_scan));
  assert.equal(ev.content_scan.via, 'rtf');
  assert.equal(ev.content_scan.matchCount, 1, 'only the body SSN, not the ones in skipped destinations');
});

test('DrawingML / ODF text helpers keep paragraph breaks and entities', () => {
  assert.equal(drawingMlText('<a:p><a:r><a:t>A&amp;</a:t></a:r><a:r><a:t>B</a:t></a:r></a:p><a:p><a:r><a:t>C</a:t></a:r></a:p>'), 'A&B\nC\n');
  assert.equal(odfText('<office:body><text:p>a<text:s text:c="3"/>b<text:tab/>c</text:p></office:body>'), 'a   b\tc\n');
});

// ── encrypted ────────────────────────────────────────────────────────────────

test('encrypted OOXML/ODF: a CFB container WITH EncryptionInfo/EncryptedPackage -> reason encrypted', async () => {
  for (const ext of ['.docx', '.xlsx', '.pptx', '.odt']) {
    const p = await fixture(`locked${ext}`, encryptedOoxml());
    for (const isolate of [false, true]) {
      const ev = await event(p, { isolate });
      assert.equal(ev.content_scan.scanned, false);
      assert.equal(ev.content_scan.reason, 'encrypted', `${ext} isolate=${isolate}: ${JSON.stringify(ev.content_scan)}`);
      assert.equal(ev.content_scan.unverified, true);
      assert.equal(ev.content_scan.suspicious, undefined, 'encrypted is a reason, not a suspicious cause');
    }
  }
  assert.equal(await cfbKind(encryptedOoxml()), 'encrypted');
  assert.equal(await cfbKind(legacyCfb()), 'legacy');
  // The magic alone is only a hint, and never on a native CFB extension.
  assert.equal(isCfbEncryptedContainer(encryptedOoxml(), '.xls'), false);
});

test('M1: CFB WITHOUT encryption streams is legacy: .xls-under-.xlsx is read by SheetJS, .doc-under-.docx is unsupported_format', async () => {
  const xls = workbook([['ssn'], [SSN]], 'xls');
  assert.equal(await cfbKind(xls), 'legacy');
  const renamed = await event(await fixture('old-book.xlsx', xls), { isolate: true });
  assert.equal(renamed.content_scan.scanned, true, JSON.stringify(renamed.content_scan));
  assert.ok(patterns(renamed).includes('us-ssn'));
  for (const ext of ['.docx', '.pptx']) {
    const ev = await event(await fixture(`old${ext}`, legacyCfb()), { isolate: true });
    assert.equal(ev.content_scan.reason, 'unsupported_format', `${ext}: ${JSON.stringify(ev.content_scan)}`);
    assert.equal(ev.content_scan.suspicious, undefined);
  }
});

test('password-protected PDF -> reason encrypted; a plain PDF still scans', async () => {
  const locked = await fixture('locked.pdf', passwordPdf());
  for (const isolate of [false, true]) {
    const ev = await event(locked, { isolate });
    assert.equal(ev.content_scan.scanned, false);
    assert.equal(ev.content_scan.reason, 'encrypted', `isolate=${isolate}: ${JSON.stringify(ev.content_scan)}`);
    assert.equal(ev.content_scan.unverified, true);
  }
  const plain = await fixture('plain.pdf', plainPdf(`SSN ${SSN}`));
  const ev = await event(plain, { isolate: true });
  assert.equal(ev.content_scan.scanned, true, JSON.stringify(ev.content_scan));
  assert.ok(patterns(ev).includes('us-ssn'));
});

// ── the reason / suspicious contracts ────────────────────────────────────────

test('content_scan.reason for an unscanned file is always one of the five contract values', async () => {
  assert.deepEqual([...SCAN_FAILURE_REASONS].sort(),
    ['encrypted', 'extraction_failed', 'extraction_timeout', 'too_large', 'unsupported_format']);
  const cases = [
    ['legacy.doc', Buffer.from('doc bytes'), 'unsupported_format'],
    ['legacy.ppt', Buffer.from('ppt bytes'), 'unsupported_format'],
    ['mail.msg', Buffer.from('msg bytes'), 'unsupported_format'],
    ['broken.pptx', Buffer.from('not a zip'), 'extraction_failed'],
    ['broken.odt', Buffer.from('not a zip'), 'extraction_failed'],
    ['broken.zip', Buffer.from('not a zip'), 'extraction_failed'],       // was 'zip_failed'
    ['huge.png', Buffer.alloc(OCR_MAX_BYTES + 1, 0x42), 'too_large'],
  ];
  for (const [name, bytes, want] of cases) {
    const ev = await event(await fixture(name, bytes));
    assert.equal(ev.content_scan.scanned, false, name);
    assert.equal(ev.content_scan.reason, want, `${name}: ${JSON.stringify(ev.content_scan)}`);
  }
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'file-handler.js'), 'utf8');
  const produced = new Set([...src.matchAll(/scanned: false, reason: '([a-z_]+)'/g)].map((m) => m[1]));
  for (const r of produced) assert.ok(SCAN_FAILURE_REASONS.includes(r), `stray reason '${r}'`);
  assert.doesNotMatch(src, /unbound_name_match|metadataOnly/, 'the metadata-only branch is gone');
  assert.match(src, /isolate = true, quiet = false,/, 'worker isolation is the default for every caller');
});

test('suspicious vocabulary is exactly the five agreed reasons, and unsupported types never carry it', async () => {
  assert.deepEqual([...SUSPICIOUS_REASONS].sort(),
    ['container_truncated', 'decompression_ratio', 'oom', 'oversize_unscanned_tail', 'self_timeout']);
  for (const name of ['a.doc', 'clip.mp4', 'thing.unknownext']) {
    const ev = await event(await fixture(name, Buffer.from('x')));
    assert.equal(ev.content_scan.suspicious, undefined, name);
  }
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'file-handler.js'), 'utf8');
  assert.match(src, /\{ failed: 'too_large', suspicious: 'oom' \}/, 'worker OOM -> oom');
});

test('an image over the 8 MB OCR cap is too_large + oversize_unscanned_tail, without ever starting OCR', async () => {
  const before = ocrStats().jobs;
  const ev = await event(await fixture('big-shot.tif', Buffer.alloc(OCR_MAX_BYTES + 10, 0)));
  assert.equal(ev.content_scan.reason, 'too_large');
  assert.equal(ev.content_scan.capBytes, OCR_MAX_BYTES);
  assert.equal(ev.content_scan.suspicious, true);
  assert.equal(ev.content_scan.suspicious_reason, 'oversize_unscanned_tail');
  assert.equal(ev.content_scan.unverified, false, 'images stay out of `unverified`, as before');
  assert.equal(ocrStats().jobs, before, 'no OCR job was queued');
});

test('a readable file over 25 MB on a non-partial route is too_large + oversize_unscanned_tail', async () => {
  const p = await fixture('huge.docx', Buffer.alloc(CONTENT_SCAN_MAX_BYTES + 1, 0));
  const ev = await event(p);
  assert.equal(ev.content_scan.reason, 'too_large');
  assert.equal(ev.content_scan.suspicious_reason, 'oversize_unscanned_tail');
});

// ── H3: decompression bombs, zip truncation ──────────────────────────────────

test('decompression bomb: not inflated; too_large + decompression_ratio (document and archive)', async () => {
  const bomb = await zipBomb(60);
  assert.ok(bomb.length < 1024 * 1024, 'fixture really is a high-ratio zip');
  assert.equal(isDecompressionBomb({ expanded: 60 * 1024 * 1024, compressed: 100 * 1024 }), true);
  assert.equal(isDecompressionBomb({ expanded: 60 * 1024 * 1024, compressed: 30 * 1024 * 1024 }), false, 'a large but ordinary archive');
  for (const name of ['bomb.docx', 'bomb.xlsx', 'bomb.pptx', 'bomb.zip']) {
    for (const isolate of [false, true]) {
      const ev = await event(await fixture(name, bomb), { isolate });
      assert.equal(ev.content_scan.scanned, false, `${name} ${isolate}: ${JSON.stringify(ev.content_scan)}`);
      assert.equal(ev.content_scan.reason, 'too_large');
      assert.equal(ev.content_scan.suspicious_reason, 'decompression_ratio', name);
    }
  }
});

test('M2: a zip past max depth is NOT clean: container_truncated, partial; a shallow one still finds the secret', async () => {
  const shallow = await event(await fixture('two.zip', await nestedZip(2, `SSN ${SSN}`)));
  assert.equal(shallow.content_scan.scanned, true);
  assert.ok(patterns(shallow).includes('us-ssn'));
  assert.equal(shallow.content_scan.suspicious, undefined);
  for (const isolate of [false, true]) {
    const deep = await event(await fixture('deep.zip', await nestedZip(5, `SSN ${SSN}`)), { isolate });
    assert.equal(deep.content_scan.scanned, true);
    assert.equal(deep.content_scan.matchCount, 0, 'the secret sits below the depth cap');
    assert.equal(deep.content_scan.partial, true);
    assert.equal(deep.content_scan.suspicious, true);
    assert.equal(deep.content_scan.suspicious_reason, 'container_truncated');
    assert.ok(deep.content_scan.entryBreakdown.some((e) => e.skipped === 'max_depth'));
  }
});

test('M2: encrypted / document-like-unsupported entries truncate the zip; media entries do not', async () => {
  const JSZip = (await import('jszip')).default;
  const z = new JSZip();
  z.file('notes.txt', 'hello');
  z.file('locked.docx', encryptedOoxml());
  const ev = await event(await fixture('mixed.zip', await z.generateAsync({ type: 'nodebuffer' })));
  assert.equal(ev.content_scan.suspicious_reason, 'container_truncated');
  assert.ok(ev.content_scan.entryBreakdown.some((e) => e.skipped === 'encrypted'));
  const m = new JSZip();
  m.file('notes.txt', 'hello');
  m.file('clip.mp4', Buffer.alloc(100));
  const media = await event(await fixture('media.zip', await m.generateAsync({ type: 'nodebuffer' })));
  assert.equal(media.content_scan.suspicious, undefined, 'a video in a zip is skipped, not suspicious');
  const legacy = new JSZip();
  legacy.file('old.doc', Buffer.alloc(100));
  const lg = await event(await fixture('legacy.zip', await legacy.generateAsync({ type: 'nodebuffer' })));
  assert.equal(lg.content_scan.suspicious_reason, 'container_truncated', 'a .doc we cannot read makes it incomplete');
});

test('zip entry names can be stripped for a weak match (stripContentScanNames)', async () => {
  const ev = await event(await fixture('named.zip', await nestedZip(1, `SSN ${SSN}`)));
  assert.ok(ev.content_scan.entryBreakdown.some((e) => e.name === 'secret.txt'));
  stripContentScanNames(ev.content_scan);
  assert.ok(ev.content_scan.entryBreakdown.length > 0);
  assert.ok(ev.content_scan.entryBreakdown.every((e) => !('name' in e)));
  assert.equal(ev.content_scan.matchCount, 1, 'counts are kept');
});

test('M2: .eml attachments go through the extractors; an unreadable document attachment truncates it', async () => {
  const docx = await wordPackage(`Employee SSN ${SSN}`);
  const ok = await event(await fixture('with-doc.eml', emlWithAttachments('see attached', [{ filename: 'hr.docx', bytes: docx }])), { isolate: true });
  assert.equal(ok.content_scan.scanned, true, JSON.stringify(ok.content_scan));
  assert.ok(patterns(ok).includes('us-ssn'), 'the SSN is inside the attached .docx');
  assert.equal(ok.content_scan.suspicious, undefined);
  const bad = await event(await fixture('with-legacy.eml', emlWithAttachments('see attached', [{ filename: 'old.doc', bytes: Buffer.alloc(64) }])));
  assert.equal(bad.content_scan.scanned, true);
  assert.equal(bad.content_scan.partial, true);
  assert.equal(bad.content_scan.suspicious_reason, 'container_truncated');
});

test('text with a UTF-16LE BOM is decoded before scanning', async () => {
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`SSN ${SSN}\n`, 'utf16le')]);
  const ev = await event(await fixture('export.csv', utf16));
  assert.ok(patterns(ev).includes('us-ssn'), JSON.stringify(ev.content_scan));
});

// ── H4: text over the scan cap ───────────────────────────────────────────────

test('H4: a >25 MB text file is stream-scanned end to end: a secret at the END is found, nothing unscanned', async () => {
  const pad = 'x'.repeat(1023) + '\n';
  const body = pad.repeat(Math.ceil((CONTENT_SCAN_MAX_BYTES + 2 * 1024 * 1024) / 1024));
  const p = await fixture('long.log', `${body}tail SSN ${SSN}\n`);
  const ev = await event(p, { partialScan: true });
  assert.equal(ev.content_scan.scanned, true);
  assert.equal(ev.content_scan.partial, true);
  assert.equal(ev.content_scan.bytesUnscanned, 0);
  assert.ok(patterns(ev).includes('us-ssn'), 'the tail secret is scanned');
  assert.equal(ev.content_scan.suspicious, undefined);
});

test('H4: beyond TEXT_STREAM_MAX_BYTES the head and TAIL are scanned and the skipped middle is suspicious', async () => {
  const { open: fopen } = await import('node:fs/promises');
  const p = join(dir, 'giant.log');
  const size = TEXT_STREAM_MAX_BYTES + 4 * 1024 * 1024;
  const fh = await fopen(p, 'w');
  try {
    const line = Buffer.from('y'.repeat(1023) + '\n');
    const block = Buffer.concat(Array(1024).fill(line));   // 1 MB
    for (let off = 0; off < size; off += block.length) await fh.write(block, 0, Math.min(block.length, size - off), off);
    const mid = Buffer.from('\nmiddle AKIAIOSFODNN7EXAMPLE\n');
    await fh.write(mid, 0, mid.length, TEXT_STREAM_MAX_BYTES - 6 * 1024 * 1024);   // between head (92 MB) and tail (last 8 MB)
    const tail = Buffer.from(`\ntail SSN ${SSN}\n`);
    await fh.write(tail, 0, tail.length, size - tail.length);
  } finally { await fh.close(); }
  const ev = await event(p, { partialScan: true });
  assert.equal(ev.content_scan.scanned, true);
  assert.ok(patterns(ev).includes('us-ssn'), 'the tail is scanned');
  assert.equal(patterns(ev).includes('aws-access-key'), false, 'the middle really is skipped');
  assert.ok(ev.content_scan.bytesUnscanned > 0);
  assert.equal(ev.content_scan.suspicious_reason, 'oversize_unscanned_tail');
});

// ── OCR: bundled + pinned data, one warm thread, budgets ─────────────────────

test('OCR language data resolves to a LOCAL bundled file whose SHA-256 is pinned', async () => {
  for (const c of tessdataCandidates({})) {
    assert.ok(isAbsolute(c), c);
    assert.doesNotMatch(c, /^[a-z]+:\/\//i);
  }
  const d = resolveTessdataDir({});
  assert.equal(resolve(d), resolve(REPO, 'browser-extension', 'vendor', 'tesseract'));
  assert.ok(existsSync(join(d, OCR_LANG_FILE)));
  // M4: an override pointing at a tampered copy is ignored.
  const evil = join(dir, 'evil-tessdata');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(evil, { recursive: true });
  await writeFile(join(evil, OCR_LANG_FILE), Buffer.from('not the model'));
  assert.equal(resolve(resolveTessdataDir({ CFAI_TESSDATA_DIR: evil })), resolve(d), 'a hash mismatch is skipped');
  assert.equal(OCR_LANG_SHA256.length, 64);
});

test('the OCR worker never touches the network or a cwd cache, and re-checks the hash itself', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'ocr-worker.js'), 'utf8');
  assert.match(src, /cacheMethod: 'none'/);
  assert.match(src, /ocr_lang_hash_mismatch/);
  const svc = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'ocr-service.js'), 'utf8');
  assert.doesNotMatch(svc.replace(/\/\/.*$/gm, ''), /https?:\/\//, 'no URL anywhere in the OCR service code');
  const be = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'binary-extractors.js'), 'utf8');
  assert.doesNotMatch(be, /createWorker\(/, 'no per-extraction tesseract worker left in binary-extractors');
  assert.doesNotMatch(be, /writeFile|cfai-entry-/, 'zip entries are no longer spooled to disk');
});

test('png and tif screenshots are OCR-scanned on ONE warm thread', async () => {
  const png = await fixture('shot.png', textPng(PHONE_IMG, { scale: 8 }));
  const tif = await fixture('scan.tif', textTiff(PHONE_IMG, { scale: 8 }));
  const first = await event(png);
  assert.equal(first.content_scan.scanned, true, JSON.stringify(first.content_scan));
  assert.equal(first.content_scan.via, 'tesseract');
  assert.ok(patterns(first).includes('us-phone'), `png OCR patterns: ${patterns(first)}`);
  assert.equal(first.content_scan.contentSeverity, 'high', 'content severity is carried on content_scan');
  const s0 = ocrStats();
  assert.equal(s0.ready, true);
  const second = await event(tif);
  assert.ok(patterns(second).includes('us-phone'), `tif OCR patterns: ${patterns(second)}`);
  const s1 = ocrStats();
  assert.equal(s1.spawns, s0.spawns, 'the second image reused the running engine');
  assert.equal(s1.ready, true);
  const leftovers = (await readdir(dir)).filter((n) => /traineddata/i.test(n));
  assert.deepEqual(leftovers, [], 'nothing downloaded / cached into the working directory');
});

test('an image inside a zip is OCR-scanned through the parent, from the isolated worker', async () => {
  const JSZip = (await import('jszip')).default;
  const z = new JSZip();
  z.file('screens/shot.png', textPng(PHONE_IMG, { scale: 8 }));
  const ev = await event(await fixture('shots.zip', await z.generateAsync({ type: 'nodebuffer' })), { isolate: true });
  assert.equal(ev.content_scan.scanned, true, JSON.stringify(ev.content_scan));
  assert.ok(patterns(ev).includes('us-phone'), JSON.stringify(ev.content_scan));
  assert.equal(ev.content_scan.suspicious, undefined);
});

test('H3: the OCR run budget starts when the image RUNS; expiry = selfTimeout, killed, respawned eagerly', async () => {
  const png = await fixture('slow.png', textPng(PHONE_IMG, { scale: 8 }));
  shutdownOcr();
  // Cold engine + a 2 s run budget: start-up time must not count against it.
  const cold = await ocrImageFile(png, { budgetMs: 2000, queueMaxMs: 60_000 });
  assert.equal(cold.ok, true, `cold start must not eat the run budget: ${JSON.stringify(cold)}`);
  const s0 = ocrStats();
  const r = await ocrImageFile(png, { budgetMs: 1 });
  assert.deepEqual(r, { ok: false, reason: 'extraction_timeout', selfTimeout: true });
  const s1 = ocrStats();
  assert.equal(s1.kills, s0.kills + 1, 'the stuck recognize() was terminated');
  assert.equal(s1.runTimeouts, s0.runTimeouts + 1);
  assert.equal(s1.spawns, s0.spawns + 1, 'a fresh thread was started at once, outside any budget');
  const again = await ocrImageFile(png, { budgetMs: 8000, queueMaxMs: 60_000 });
  assert.equal(again.ok, true);
  assert.equal(ocrStats().spawns, s1.spawns, 'the next image used the eagerly respawned thread');
});

test('H3: a queue-ceiling expiry is extraction_timeout but NOT selfTimeout', async () => {
  const png = await fixture('queued.png', textPng(PHONE_IMG, { scale: 8 }));
  shutdownOcr();
  const r = await ocrImageFile(png, { queueMaxMs: 1 });   // the engine cannot even start in 1 ms
  assert.deepEqual(r, { ok: false, reason: 'extraction_timeout', selfTimeout: false });
});

test('S6: interactive images run before queued background ones; cancelOcrGroup drains a group', async () => {
  const bytes = textPng(PHONE_IMG, { scale: 8 });
  await ocrImageBuffer(bytes, { queueMaxMs: 60_000 });   // warm
  const order = [];
  const group = {};
  const a = ocrImageBuffer(bytes, { priority: 'background' }).then(() => order.push('a-running'));
  const b = ocrImageBuffer(bytes, { priority: 'background', group }).then((x) => order.push(`b:${x.ok ? 'ok' : x.error}`));
  const c = ocrImageBuffer(bytes, { priority: 'background', group }).then((x) => order.push(`c:${x.ok ? 'ok' : x.error}`));
  const i = ocrImageBuffer(bytes, { priority: 'interactive' }).then(() => order.push('interactive'));
  assert.equal(cancelOcrGroup(group), 2);
  await Promise.all([a, b, c, i]);
  assert.deepEqual(order.slice(0, 2).sort(), ['b:ocr_cancelled', 'c:ocr_cancelled']);
  assert.deepEqual(order.slice(2), ['a-running', 'interactive']);
  // Priority: with the engine busy, a later interactive job overtakes earlier background ones.
  const order2 = [];
  const busy = ocrImageBuffer(bytes, { priority: 'background' }).then(() => order2.push('busy'));
  const bg = ocrImageBuffer(bytes, { priority: 'background' }).then(() => order2.push('bg'));
  const fg = ocrImageBuffer(bytes, { priority: 'interactive' }).then(() => order2.push('fg'));
  await Promise.all([busy, bg, fg]);
  assert.deepEqual(order2, ['busy', 'fg', 'bg']);
});

test('the zip budget pauses while its images wait on OCR, and a zip that runs out is self_timeout', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'file-handler.js'), 'utf8');
  assert.match(src, /if \(outstanding\+\+ === 0\) pause\(\);/);
  assert.match(src, /if \(--outstanding === 0\) resume\(\);/);
  assert.match(src, /cancelOcrGroup\(group\);/);
  assert.match(src, /hard = setTimeout\(\(\) => finish\(TIMED_OUT\), EXTRACTION_HARD_MAX_MS\);/);
  assert.match(src, /'self_timeout'\)/);
});
