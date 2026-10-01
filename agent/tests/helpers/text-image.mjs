// Renders a short line of text into a raster image WITHOUT a canvas dependency,
// so the OCR tests can generate their own fixtures on any CI box (the Windows-
// only System.Drawing trick in test/test-zip-and-image.mjs does not run on the
// Linux runner). A 5x7 bitmap font, scaled up, black on white: clean enough for
// tesseract's LSTM model to read reliably.
import { deflateSync } from 'node:zlib';

const FONT = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  'S': ['01110', '10001', '10000', '01110', '00001', '10001', '01110'],
  'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
};

/** @returns {{ width:number, height:number, gray:Uint8Array }} 8-bit grayscale, 0=black */
export function rasterize(text, { scale = 6, margin = 24 } = {}) {
  const cw = 7 * scale;                    // 5 columns + 2 spacing columns
  const width = margin * 2 + text.length * cw;
  const height = margin * 2 + 7 * scale;
  const gray = new Uint8Array(width * height).fill(255);
  [...text].forEach((ch, i) => {
    const g = FONT[ch];
    if (!g) throw new Error(`no glyph for ${JSON.stringify(ch)}`);
    for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
      if (g[gy][gx] !== '1') continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        gray[(margin + gy * scale + dy) * width + margin + i * cw + gx * scale + dx] = 0;
      }
    }
  });
  return { width, height, gray };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function textPng(text, opts) {
  const { width, height, gray } = rasterize(text, opts);
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;   // filter: none
    Buffer.from(gray.buffer, y * width, width).copy(raw, y * (width + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Baseline little-endian TIFF, uncompressed 8-bit grayscale, one strip.
export function textTiff(text, opts) {
  const { width, height, gray } = rasterize(text, opts);
  const entries = [
    [256, 4, 1, width],          // ImageWidth
    [257, 4, 1, height],         // ImageLength
    [258, 3, 1, 8],              // BitsPerSample
    [259, 3, 1, 1],              // Compression: none
    [262, 3, 1, 1],              // Photometric: BlackIsZero
    [273, 4, 1, 0],              // StripOffsets (patched below)
    [277, 3, 1, 1],              // SamplesPerPixel
    [278, 4, 1, height],         // RowsPerStrip
    [279, 4, 1, gray.length],    // StripByteCounts
  ];
  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  const dataOffset = ifdOffset + ifdSize;
  entries[5][3] = dataOffset;
  const head = Buffer.alloc(dataOffset);
  head.write('II', 0, 'ascii'); head.writeUInt16LE(42, 2); head.writeUInt32LE(ifdOffset, 4);
  head.writeUInt16LE(entries.length, ifdOffset);
  entries.forEach(([tag, type, count, value], i) => {
    const o = ifdOffset + 2 + i * 12;
    head.writeUInt16LE(tag, o); head.writeUInt16LE(type, o + 2); head.writeUInt32LE(count, o + 4);
    if (type === 3) head.writeUInt16LE(value, o + 8); else head.writeUInt32LE(value, o + 8);
  });
  head.writeUInt32LE(0, ifdOffset + 2 + entries.length * 12);
  return Buffer.concat([head, Buffer.from(gray)]);
}
