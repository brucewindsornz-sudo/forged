// Forged — remove metadata from exported images (PNG, JPEG, WebP).
// Only the data needed to show the picture is kept: no EXIF, XMP, IPTC, comments,
// text chunks, timestamps, software tags, DPI or embedded colour profiles.

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);

function stripPng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return buf;
  const parts = [PNG_SIG];
  let p = 8;
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), end = p + 12 + len;
    if (end > buf.length) break;
    if (PNG_KEEP.has(type)) parts.push(buf.subarray(p, end));
    p = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(parts);
}

function stripJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const parts = [buf.subarray(0, 2)];
  let p = 2;
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff) return buf; // unexpected layout; leave untouched rather than corrupt it
    const m = buf[p + 1];
    if (m === 0xff) { p++; continue; } // fill byte
    if (m === 0xd9) { parts.push(buf.subarray(p, p + 2)); p += 2; break; }
    const len = buf.readUInt16BE(p + 2), end = p + 2 + len;
    if (end > buf.length) return buf;
    const isApp = m >= 0xe0 && m <= 0xef, isCom = m === 0xfe;
    if (!isApp && !isCom) parts.push(buf.subarray(p, end));
    if (m === 0xda) { parts.push(buf.subarray(end)); return Buffer.concat(parts); } // start of scan: image data follows
    p = end;
  }
  return Buffer.concat(parts);
}

function stripWebp(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return buf;
  const parts = []; let p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.toString('latin1', p, p + 4), len = buf.readUInt32LE(p + 4), end = p + 8 + len + (len & 1);
    if (end > buf.length + 1) break;
    let chunk = buf.subarray(p, Math.min(end, buf.length));
    if (id === 'EXIF' || id === 'XMP ' || id === 'ICCP') { p = end; continue; }
    if (id === 'VP8X') { chunk = Buffer.from(chunk); chunk[8] &= ~(0x20 | 0x08 | 0x04); } // clear ICC, EXIF, XMP flags
    parts.push(chunk); p = end;
  }
  const body = Buffer.concat(parts), head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(body.length + 4, 4); head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

function stripImage(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return stripPng(buf);
  if (buf[0] === 0xff && buf[1] === 0xd8) return stripJpeg(buf);
  if (buf.toString('latin1', 0, 4) === 'RIFF') return stripWebp(buf);
  return buf;
}

module.exports = { stripImage, stripPng, stripJpeg, stripWebp };
