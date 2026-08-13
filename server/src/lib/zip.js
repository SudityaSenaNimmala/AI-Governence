// Minimal ZIP writer — STORE method (no compression), zero dependencies.
//
// WHY THIS EXISTS INSTEAD OF `archiver`
// -------------------------------------
// Every zip this server produces is a handful of small source/config files
// (a browser-extension package, a Teams manifest, the agent bundle, the JS SDK).
// A dependency-free ~60 line writer covers that entirely, and keeps a
// download endpoint from pulling ~40 transitive packages into an image that
// already ships to customer infrastructure.
//
// This code was previously duplicated verbatim in routes/connections.js and
// routes/installations.js. It now lives here once; both import it.
//
// LIMITS, stated so nobody discovers them the hard way:
//   • No compression. Output size == sum of input sizes. Fine for KBs of text,
//     wrong choice for anything large.
//   • No ZIP64. Individual files and the archive must stay under 4 GB, and
//     under 65535 entries.
//   • Buffers the whole archive in memory. Callers must therefore only feed it
//     content they are willing to hold in RAM twice.
//   • No explicit directory entries — parent paths are implied by the "/"
//     separators in entry names, which every extractor handles.

// Entry names inside a zip are always forward-slash separated, per APPNOTE
// 4.4.17.1, regardless of the host OS. On Windows a path built with node's
// `join` arrives here with backslashes, which would otherwise produce one file
// literally named "src\index.js" instead of a src/ directory.
export function toZipEntryName(name) {
  return String(name).replace(/\\/g, '/');
}

// MS-DOS date/time (APPNOTE 4.4.6). Entries used to be written with 0 here,
// which decodes to an impossible "day 0 of month 0 of 1980" and makes stricter
// extractors (and anything that turns the field into a real date) unhappy.
function dosDateTime(when) {
  const d = when instanceof Date && !Number.isNaN(when.getTime()) ? when : new Date();
  // 1980 is the DOS epoch; there is no way to represent anything earlier.
  const year = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xffff, date: date & 0xffff };
}

/**
 * Build a ZIP archive in memory.
 *
 * @param {Array<{name: string, data: Buffer, mtime?: Date}>} files
 * @returns {Buffer} the complete .zip
 */
export function createZip(files) {
  const parts = [];
  const centralDir = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(toZipEntryName(file.name), 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data ?? '');
    const crc = crc32(data);
    const { time, date } = dosDateTime(file.mtime);

    // Local file header (30 bytes + name + data)
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // signature
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0x0800, 6);        // flags: bit 11 = names/comments are UTF-8
    local.writeUInt16LE(0, 8);             // compression: STORE
    local.writeUInt16LE(time, 10);         // mod time
    local.writeUInt16LE(date, 12);         // mod date
    local.writeUInt32LE(crc, 14);          // CRC-32
    local.writeUInt32LE(data.length, 18);  // compressed size
    local.writeUInt32LE(data.length, 22);  // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26); // name length
    local.writeUInt16LE(0, 28);            // extra length

    parts.push(local, nameBuf, data);

    // Central directory entry (46 bytes + name)
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);  // signature
    central.writeUInt16LE(20, 4);           // version made by
    central.writeUInt16LE(20, 6);           // version needed
    central.writeUInt16LE(0x0800, 8);       // flags: UTF-8 names
    central.writeUInt16LE(0, 10);           // compression
    central.writeUInt16LE(time, 12);        // mod time
    central.writeUInt16LE(date, 14);        // mod date
    central.writeUInt32LE(crc, 16);         // CRC-32
    central.writeUInt32LE(data.length, 20); // compressed size
    central.writeUInt32LE(data.length, 24); // uncompressed size
    central.writeUInt16LE(nameBuf.length, 28); // name length
    central.writeUInt16LE(0, 30);           // extra length
    central.writeUInt16LE(0, 32);           // comment length
    central.writeUInt16LE(0, 34);           // disk start
    central.writeUInt16LE(0, 36);           // internal attrs
    central.writeUInt32LE(0, 38);           // external attrs
    central.writeUInt32LE(offset, 42);      // local header offset

    centralDir.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }

  const centralDirBuf = Buffer.concat(centralDir);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);           // signature
  eocd.writeUInt16LE(0, 4);                     // disk number
  eocd.writeUInt16LE(0, 6);                     // central dir disk
  eocd.writeUInt16LE(files.length, 8);          // entries on disk
  eocd.writeUInt16LE(files.length, 10);         // total entries
  eocd.writeUInt32LE(centralDirBuf.length, 12); // central dir size
  eocd.writeUInt32LE(offset, 16);               // central dir offset
  eocd.writeUInt16LE(0, 20);                    // comment length

  return Buffer.concat([...parts, centralDirBuf, eocd]);
}

// CRC-32 lookup table (IEEE 802.3 polynomial, reflected).
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

export function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
