// Probe the test docx via mammoth and inspect its zip structure.
import mammoth from 'mammoth';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const docxPath = join(tmpdir(), 'cfai-docx-test', 'Customer_Credentials_Q4.docx');
console.log('Probing:', docxPath);

// Mammoth attempt
try {
  const r = await mammoth.extractRawText({ path: docxPath });
  console.log('mammoth text:', JSON.stringify(r.value));
  console.log('mammoth messages:', r.messages);
} catch (err) {
  console.log('mammoth threw:', err.message);
}

// Inspect zip entry names directly via @electron/asar isn't right — use a raw zip read.
// Tiny manual zip entry scan: read central-directory entries (signature 0x02014b50).
const buf = await readFile(docxPath);
console.log('\nzip entry names:');
let i = 0;
while (i < buf.length - 4) {
  if (buf.readUInt32LE(i) === 0x02014b50) {
    // central directory file header
    const nameLen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 46, i + 46 + nameLen).toString('utf8');
    console.log('  ', JSON.stringify(name));
    const extraLen = buf.readUInt16LE(i + 30);
    const commentLen = buf.readUInt16LE(i + 32);
    i += 46 + nameLen + extraLen + commentLen;
  } else {
    i++;
  }
}
