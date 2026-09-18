// Extract SNI (Server Name Indication) hostname from a raw TLS ClientHello.
//
// When iptables REDIRECT sends traffic to us, the client thinks it's talking
// to api.openai.com:443. We receive raw TLS bytes (not HTTP CONNECT). The SNI
// extension in the ClientHello tells us which host the client intended.
//
// TLS record structure:
//   byte 0:     content type (0x16 = Handshake)
//   bytes 1-2:  TLS version
//   bytes 3-4:  record length
//   byte 5:     handshake type (0x01 = ClientHello)
//   ...
//   extensions contain SNI (type 0x0000)

export function extractSni(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 6) return null;

  // Must be TLS Handshake record
  if (buf[0] !== 0x16) return null;

  // Skip TLS record header (5 bytes) to reach handshake message
  let pos = 5;

  // Handshake type must be ClientHello (0x01)
  if (buf[pos] !== 0x01) return null;
  pos += 1;

  // Handshake length (3 bytes) — skip
  pos += 3;

  // Client version (2 bytes) — skip
  pos += 2;

  // Client random (32 bytes) — skip
  pos += 32;

  // Session ID (variable length)
  if (pos >= buf.length) return null;
  const sessionIdLen = buf[pos];
  pos += 1 + sessionIdLen;

  // Cipher suites (2-byte length prefix)
  if (pos + 2 > buf.length) return null;
  const cipherLen = buf.readUInt16BE(pos);
  pos += 2 + cipherLen;

  // Compression methods (1-byte length prefix)
  if (pos + 1 > buf.length) return null;
  const compLen = buf[pos];
  pos += 1 + compLen;

  // Extensions (2-byte length prefix)
  if (pos + 2 > buf.length) return null;
  const extTotalLen = buf.readUInt16BE(pos);
  pos += 2;
  const extEnd = pos + extTotalLen;

  while (pos + 4 <= extEnd && pos + 4 <= buf.length) {
    const extType = buf.readUInt16BE(pos);
    const extLen = buf.readUInt16BE(pos + 2);
    pos += 4;

    if (extType === 0x0000) {
      // SNI extension found
      // SNI list length (2 bytes)
      if (pos + 2 > buf.length) return null;
      // const sniListLen = buf.readUInt16BE(pos);
      pos += 2;

      // SNI entry: type (1 byte) + name length (2 bytes) + name
      if (pos + 3 > buf.length) return null;
      const nameType = buf[pos];
      const nameLen = buf.readUInt16BE(pos + 1);
      pos += 3;

      if (nameType === 0x00 && pos + nameLen <= buf.length) {
        return buf.slice(pos, pos + nameLen).toString('ascii').toLowerCase();
      }
      return null;
    }

    pos += extLen;
  }

  return null;
}
