// Loads the REAL Office/ODF extraction region out of content/content.js, so the
// extractors are tested against shipped code rather than a paraphrase.
//
// WHY A SLICE AND NOT AN IMPORT. Same reason as the other load-*.mjs loaders:
// content.js is one classic-script IIFE that touches document/chrome/window at
// load time and cannot be evaluated whole in Node. This region is pure: it takes
// a JSZip instance or bytes and has no free browser globals, which new Function
// would surface as a ReferenceError.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const START = '// ── Office/ODF text extraction (pure) ─';
const END = '// ── end Office/ODF text extraction ─';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CONTENT_SRC = readFileSync(path.join(here, '..', 'content', 'content.js'), 'utf8');

function region() {
  const from = CONTENT_SRC.indexOf(START);
  const to = CONTENT_SRC.indexOf(END);
  if (from < 0) throw new Error(`content.js sentinel not found: ${START}`);
  if (to < 0) throw new Error(`content.js sentinel not found: ${END}`);
  if (to <= from) throw new Error('content.js office-extract sentinels are out of order');
  return CONTENT_SRC.slice(from, to);
}

export function loadOfficeExtract() {
  const body = region() + `
  return {
    OOXML_SLIDE_EXTENSIONS, ODF_TEXT_EXTENSIONS, ZIP_CONTAINER_EXTENSIONS,
    isCfbEncryptedContainer, cfbKind, LEGACY_SHEET_EXTENSIONS, decodeXmlEntities, drawingMlText, odfText,
    pptxTextFromZip, odfTextFromZip, fileBlockingMatches,
  };`;
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}
