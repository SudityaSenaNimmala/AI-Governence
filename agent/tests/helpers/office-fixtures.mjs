// In-test fixture builders for the document formats the desktop scanner reads.
// Everything is generated from scratch (JSZip / SheetJS / plain bytes) so the
// suite needs no binary fixtures checked in and runs the same on the Linux CI
// runner as on a Windows desktop.
import JSZip from 'jszip';
import * as XLSXNs from 'xlsx';

const XLSX = XLSXNs.default || XLSXNs;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A .docx-shaped package; `mainType` lets it pose as .docm / .dotx. */
export async function wordPackage(text, {
  mainType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
} = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="${mainType}"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${esc(text)}</w:t></w:r></w:p></w:body>
</w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
function slideXml(runs) {
  // Each inner array is one paragraph; each string one run (split mid-word on
  // purpose -- Office does that, and the extractor must re-join them).
  const paras = runs.map((p) => `<a:p>${p.map((r) => `<a:r><a:t>${esc(r)}</a:t></a:r>`).join('')}</a:p>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${A}><p:cSld><p:spTree><p:sp><p:txBody>${paras}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
}

/** .pptx / .pptm / .ppsx: slides[i] and notes[i] are arrays of paragraphs of runs. */
export async function presentationPackage({ slides = [], notes = [] } = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  // Numbered past 9 on purpose so a lexical sort would put slide10 before slide2.
  slides.forEach((s, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, slideXml(s)));
  notes.forEach((n, i) => zip.file(`ppt/notesSlides/notesSlide${i + 1}.xml`, slideXml(n)));
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** .odt / .odp: content.xml with text:p, text:s and text:tab. */
export async function odfPackage(paragraphs, { mimetype = 'application/vnd.oasis.opendocument.text' } = {}) {
  const zip = new JSZip();
  zip.file('mimetype', mimetype);
  const body = paragraphs.map((p) => `<text:p>${esc(p).replace(/ /g, '<text:s/>')}</text:p>`).join('');
  zip.file('content.xml', `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body><office:text>${body}</office:text></office:body>
</office:document-content>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** SheetJS workbook in any bookType it can write (xlsb, xlsm, ods, ...). */
export function workbook(rows, bookType) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Data');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType }));
}

/**
 * What Office writes for a password-protected .docx/.xlsx/.pptx: an OLE2
 * Compound File (magic D0 CF 11 E0 A1 B1 1A E1) holding EncryptionInfo +
 * EncryptedPackage, not a ZIP. Only the header matters to the detector.
 */
export function cfbEncryptedPackage(size = 4096) {
  const buf = Buffer.alloc(size, 0);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buf, 0);
  if (size >= 0x1e) { buf.writeUInt16LE(0x003e, 0x18); buf.writeUInt16LE(0x0003, 0x1a); buf.writeUInt16LE(0xfffe, 0x1c); }
  return buf;
}

/**
 * A REAL Compound File with the EncryptionInfo + EncryptedPackage streams
 * Office writes for a password-protected .docx/.xlsx/.pptx.
 */
export function encryptedOoxml() {
  const cfb = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(cfb, '/EncryptionInfo', Buffer.from([4, 0, 4, 0, 0x40, 0, 0, 0]));
  XLSX.CFB.utils.cfb_add(cfb, '/EncryptedPackage', Buffer.alloc(4096, 0x5a));
  return Buffer.from(XLSX.CFB.write(cfb, { type: 'buffer' }));
}

/** A legacy CFB file with NO encryption streams (a renamed .doc). */
export function legacyCfb(stream = '/WordDocument') {
  const cfb = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(cfb, stream, Buffer.alloc(2048, 0x11));
  return Buffer.from(XLSX.CFB.write(cfb, { type: 'buffer' }));
}

/** A zip whose members inflate far past their compressed size. */
export async function zipBomb(expandedMb = 60) {
  const zip = new JSZip();
  zip.file('a.txt', Buffer.alloc(expandedMb * 1024 * 1024, 0x41));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

/** A zip nested `depth` levels deep, the innermost holding `text` in a .txt. */
export async function nestedZip(depth, text) {
  let inner = new JSZip();
  inner.file('secret.txt', text);
  let buf = await inner.generateAsync({ type: 'nodebuffer' });
  for (let i = 1; i < depth; i++) {
    inner = new JSZip();
    inner.file(`level${i}.zip`, buf);
    buf = await inner.generateAsync({ type: 'nodebuffer' });
  }
  return buf;
}

/** .eml with base64 attachments: [{ filename, bytes, type }]. */
export function emlWithAttachments(body, attachments) {
  const lines = [
    'From: a@example.com', 'To: b@example.com', 'Subject: files', 'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="mix"', '', '--mix',
    'Content-Type: text/plain; charset=utf-8', '', body,
  ];
  for (const a of attachments) {
    lines.push('--mix', `Content-Type: ${a.type || 'application/octet-stream'}; name="${a.filename}"`,
      'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${a.filename}"`, '',
      Buffer.from(a.bytes).toString('base64').replace(/.{76}/g, '$&\r\n'));
  }
  lines.push('--mix--', '');
  return Buffer.from(lines.join('\r\n'), 'latin1');
}

function pdfFrom(objects, trailerExtra = '') {
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** A one-page PDF with `text` in a content stream. */
export function plainPdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${String(text).replace(/[()\\]/g, '\\$&')}) Tj ET`;
  return pdfFrom([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

/**
 * A PDF protected by a USER password (Standard security handler, RC4 40-bit).
 * The /U entry is not the one the empty password produces, so a reader that
 * tries the empty password -- as pdf-parse does -- is refused and must ask for a
 * password. That is the case the scanner reports as 'encrypted'.
 */
export function passwordPdf() {
  const hex32 = (b) => `<${Buffer.alloc(32, b).toString('hex')}>`;
  return pdfFrom([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
    `<< /Filter /Standard /V 1 /R 2 /O ${hex32(0x41)} /U ${hex32(0x42)} /P -4 >>`,
  ], `/Encrypt 4 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>] `);
}

/** multipart/alternative .eml with a base64 text part and a QP html part. */
export function emlMessage({ subject, textBody, htmlBody }) {
  const b64 = Buffer.from(textBody, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  const qp = htmlBody.replace(/=/g, '=3D');
  return Buffer.from([
    'From: Alice <alice@example.com>',
    'To: Bob <bob@example.com>',
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64,
    '--b1',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    qp,
    '--b1--',
    '',
  ].join('\r\n'), 'utf8');
}
