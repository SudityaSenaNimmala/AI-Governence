// Browser-side Office/ODF extraction and the file-block threshold.
//
// Desktop parity (agent/src/os_monitor/binary-extractors.js): .pptx/.pptm/.ppsx
// slide + notes text, .docm via mammoth, .odt/.odp content.xml, password-
// protected containers reported as 'encrypted', and a file only BLOCKS on a
// high/critical content match -- the same rule as the prompt text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import * as XLSXNs from 'xlsx';
import { loadOfficeExtract, CONTENT_SRC } from './load-office-extract.mjs';

const X = loadOfficeExtract();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function slide(paras) {
  const body = paras.map((p) => `<a:p>${p.map((r) => `<a:r><a:t>${esc(r)}</a:t></a:r>`).join('')}</a:p>`).join('');
  return `<p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
}

test('the region is pure: it evaluates with no browser globals', () => {
  assert.equal(typeof X.pptxTextFromZip, 'function');
  assert.equal(typeof X.fileBlockingMatches, 'function');
});

test('pptx: slides in NUMERIC order, then notes; runs split mid-value are re-joined', async () => {
  const zip = new JSZip();
  // slide10 would sort before slide2 lexically.
  for (let i = 1; i <= 10; i++) zip.file(`ppt/slides/slide${i}.xml`, slide([[`S${i}`]]));
  zip.file('ppt/notesSlides/notesSlide1.xml', slide([['SSN ', '123-45-', '6789']]));
  const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
  const r = await X.pptxTextFromZip(loaded);
  assert.equal(r.via, 'jszip-pptx');
  assert.equal(r.pages, 10);
  const lines = r.text.split('\n').filter(Boolean);
  assert.deepEqual(lines.slice(0, 10), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10']);
  assert.match(r.text, /SSN 123-45-6789/);
});

test('odt/odp: content.xml text with text:s / text:tab / entities restored', async () => {
  const zip = new JSZip();
  zip.file('content.xml', '<office:document-content><office:body><office:text>'
    + '<text:p>Tom<text:s/>&amp;<text:s text:c="2"/>Jerry</text:p><text:h>SSN<text:tab/>123-45-6789</text:h>'
    + '</office:text></office:body></office:document-content>');
  const r = await X.odfTextFromZip(await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' })));
  assert.equal(r.via, 'jszip-odf');
  assert.equal(r.text, 'Tom &  Jerry\nSSN\t123-45-6789\n');
  await assert.rejects(X.odfTextFromZip(await JSZip.loadAsync(await new JSZip().generateAsync({ type: 'uint8array' }))), /odf_missing_content/);
});

test('encrypted: CFB magic under an OOXML/ODF name, never for a native CFB .xls', () => {
  const cfb = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const zipHead = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  for (const ext of ['.docx', '.docm', '.xlsx', '.pptx', '.pptm', '.ppsx', '.odt', '.odp']) {
    assert.equal(X.isCfbEncryptedContainer(cfb, ext), true, ext);
    assert.equal(X.isCfbEncryptedContainer(zipHead, ext), false, ext);
  }
  assert.equal(X.isCfbEncryptedContainer(cfb, '.xls'), false, 'a legacy .xls is CFB by design');
  assert.equal(X.isCfbEncryptedContainer(new Uint8Array(2), '.docx'), false, 'short file');
});

test('file block threshold is high/critical only (matches the prompt-text rule)', () => {
  const BLOCK = new Set(['high', 'critical']);
  const cs = { matchCount: 4, matches: [
    { pattern: 'internal-jira-key', severity: 'low', count: 2 },
    { pattern: 'x', severity: 'moderate', count: 1 },
    { pattern: 'us-ssn', severity: 'critical', count: 1 },
  ] };
  assert.deepEqual(X.fileBlockingMatches(cs, BLOCK).map((m) => m.pattern), ['us-ssn']);
  assert.deepEqual(X.fileBlockingMatches({ matches: [{ pattern: 'internal-jira-key', severity: 'low', count: 3 }] }, BLOCK), []);
  assert.deepEqual(X.fileBlockingMatches(null, BLOCK), []);
});

test('content.js wiring: new formats routed, rule applied in emitFileUpload, honest privacy comment', () => {
  const bp = CONTENT_SRC.match(/const BINARY_PARSEABLE = new Set\(\[([\s\S]*?)\]\);/)[1];
  for (const ext of ['.pptx', '.pptm', '.ppsx', '.docm', '.odt', '.odp']) assert.ok(bp.includes(`'${ext}'`), ext);
  assert.match(CONTENT_SRC, /if \(ext === '\.docx' \|\| ext === '\.docm'\) \{/);
  assert.match(CONTENT_SRC, /OOXML_SLIDE_EXTENSIONS\.has\(ext\) \? pptxTextFromZip\(zip\) : odfTextFromZip\(zip\)/);
  assert.match(CONTENT_SRC, /const kind = cfbKind\(new Uint8Array\(await file\.arrayBuffer\(\)\), window\.XLSX && window\.XLSX\.CFB\);/);
  assert.match(CONTENT_SRC, /if \(kind === 'encrypted'\) return \{ error: 'encrypted' \};/);
  assert.match(CONTENT_SRC, /if \(!LEGACY_SHEET_EXTENSIONS\.has\(ext\)\) return \{ error: 'unsupported_format', extension: ext \};/);
  // The block decision uses the filtered matches, and no longer "any match".
  assert.match(CONTENT_SRC, /const blockingMatches = fileBlockingMatches\(contentScan, BLOCK_SEVERITIES\);/);
  assert.doesNotMatch(CONTENT_SRC, /const hasContentMatches = contentScan\?\.matchCount > 0;/);
  assert.match(CONTENT_SRC, /const filenameWasRisky = BLOCK_SEVERITIES\.has\(r\.severity\);/);
  // The file IS forwarded (content_text / content_base64): the comment may not claim otherwise.
  assert.doesNotMatch(CONTENT_SRC, /file bytes never leave the user's machine/);
});

test('M1: CFB is "encrypted" only with EncryptionInfo/EncryptedPackage; otherwise a legacy file', () => {
  const XLSX = XLSXNs.default || XLSXNs;
  const enc = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(enc, '/EncryptionInfo', new Uint8Array(8));
  XLSX.CFB.utils.cfb_add(enc, '/EncryptedPackage', new Uint8Array(4096));
  const encBytes = new Uint8Array(XLSX.CFB.write(enc, { type: 'array' }));
  assert.equal(X.cfbKind(encBytes, XLSX.CFB), 'encrypted');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['123-45-6789']]), 'S');
  const xls = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xls' }));
  assert.equal(X.isCfbEncryptedContainer(xls, '.xlsx'), true, 'the magic alone is only a hint');
  assert.equal(X.cfbKind(xls, XLSX.CFB), 'legacy');
  assert.ok(X.LEGACY_SHEET_EXTENSIONS.has('.xlsx') && !X.LEGACY_SHEET_EXTENSIONS.has('.docx'));
  assert.equal(X.cfbKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2]), XLSX.CFB), 'invalid');
  assert.equal(X.cfbKind(encBytes, undefined), 'unknown');
});
