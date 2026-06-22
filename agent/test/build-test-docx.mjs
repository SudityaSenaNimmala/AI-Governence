// Builds a valid .docx with three secrets in its body, then runs the
// shared file-handler to verify content_scan extracts and matches them.
//
// Avoids the PowerShell ZipFile.CreateFromDirectory path-separator issue
// by building the zip with JSZip (forward-slash entries, spec-correct).

import JSZip from 'jszip';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildFileUploadEvent } from '../src/os_monitor/file-handler.js';

const dir = join(tmpdir(), 'cfai-docx-test');
await mkdir(dir, { recursive: true });
const docxPath = join(dir, 'Customer_Credentials_Q4.docx');

const zip = new JSZip();

zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);

zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Q4 customer onboarding credentials - confidential</w:t></w:r></w:p>
    <w:p><w:r><w:t>Production OpenAI API key: sk-proj-test1234567890abcdefghijklmnopqrst</w:t></w:r></w:p>
    <w:p><w:r><w:t>AWS access for customer S3 bucket: AKIAIOSFODNN7EXAMPLE</w:t></w:r></w:p>
    <w:p><w:r><w:t>Primary administrator SSN on file: 555-12-3456</w:t></w:r></w:p>
  </w:body>
</w:document>`);

const buf = await zip.generateAsync({ type: 'nodebuffer' });
await writeFile(docxPath, buf);
console.log(`Wrote ${buf.length} bytes to ${docxPath}`);

// Run our actual file-handler against it — same code path as the OS monitor
const ev = await buildFileUploadEvent({
  path: docxPath,
  via: 'clipboard_file_copy',
  service: 'Cursor',
  vendor: 'Anysphere',
  processName: 'Cursor',
  windowTitle: 'test',
  log: { warn: console.warn, info: console.log },
});

console.log('\n=== File upload event built by file-handler ===');
console.log(JSON.stringify(ev, null, 2));
