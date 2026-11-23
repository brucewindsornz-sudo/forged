// Forged — local font scanner (main process)
// Reads the name and OS/2 tables of every installed font file so the Type tool can list
// and render all of the user's fonts, grouped by family with their styles.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const EXT = new Set(['.ttf', '.otf', '.ttc', '.otc', '.dfont']);

function fontDirs() {
  const h = os.homedir();
  if (process.platform === 'darwin') {
    return [
      '/System/Library/Fonts', '/Library/Fonts', path.join(h, 'Library/Fonts'), '/Network/Library/Fonts',
      // fonts downloaded on demand by macOS (Font Book "Download")
      '/System/Library/AssetsV2/com_apple_MobileAsset_Font7', '/System/Library/AssetsV2/com_apple_MobileAsset_Font6',
      '/System/Library/Assets/com_apple_MobileAsset_Font6', '/System/Library/Assets/com_apple_MobileAsset_Font5',
      // Adobe Fonts activated through Creative Cloud
      path.join(h, 'Library/Application Support/Adobe/CoreSync/plugins/livetype'),
      // fonts managed by common font managers
      path.join(h, 'Library/Application Support/FontBase'), path.join(h, 'Library/Application Support/RightFont'),
    ];
  }
  if (process.platform === 'win32') {
    const w = process.env.WINDIR || 'C:\\Windows', la = process.env.LOCALAPPDATA || path.join(h, 'AppData/Local');
    return [path.join(w, 'Fonts'), path.join(la, 'Microsoft/Windows/Fonts')];
  }
  return ['/usr/share/fonts', '/usr/local/share/fonts', path.join(h, '.fonts'), path.join(h, '.local/share/fonts')];
}

function walk(dir, out, depth = 0) {
  if (depth > 8) return;
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else if ((e.isFile() || e.isSymbolicLink()) && EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
}

// ---------- binary helpers (positional reads, so large fonts are never fully loaded) ----------
function reader(fd) {
  return (pos, len) => { const b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, pos); return n === len ? b : b.subarray(0, n); };
}

const MAC_ROMAN_HI = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';
function macRoman(b) { let s = ''; for (const c of b) s += c < 128 ? String.fromCharCode(c) : MAC_ROMAN_HI[c - 128] || '?'; return s; }
function utf16be(b) { let s = ''; for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b.readUInt16BE(i)); return s; }

// Parse one sfnt face starting at `base` (offset of its table directory)
function parseFace(rd, base) {
  const hdr = rd(base, 12); if (hdr.length < 12) return null;
  const numTables = hdr.readUInt16BE(4); if (!numTables || numTables > 200) return null;
  const dir = rd(base + 12, numTables * 16); const tables = {};
  for (let i = 0; i < numTables; i++) { const o = i * 16; if (o + 16 > dir.length) break; tables[dir.toString('latin1', o, o + 4)] = { off: dir.readUInt32BE(o + 8), len: dir.readUInt32BE(o + 12) }; }
  if (!tables.name) return null;
  const nt = rd(tables.name.off, Math.min(tables.name.len, 1 << 20));
  const count = nt.readUInt16BE(2), strOff = nt.readUInt16BE(4);
  const best = {}; // nameID -> {score, value}
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 12; if (o + 12 > nt.length) break;
    const plat = nt.readUInt16BE(o), enc = nt.readUInt16BE(o + 2), lang = nt.readUInt16BE(o + 4), id = nt.readUInt16BE(o + 6), len = nt.readUInt16BE(o + 8), off = nt.readUInt16BE(o + 10);
    if (![1, 2, 4, 6, 16, 17].includes(id)) continue;
    let score = 0, val = null; const s = nt.subarray(strOff + off, strOff + off + len);
    if (plat === 3 && (enc === 1 || enc === 10 || enc === 0)) { score = lang === 0x409 ? 4 : 2; val = utf16be(s); }
    else if (plat === 0) { score = 3; val = utf16be(s); }
    else if (plat === 1 && enc === 0) { score = lang === 0 ? 3.5 : 1; val = macRoman(s); }
    if (val && (!best[id] || score > best[id].score)) best[id] = { score, value: val.replace(/\0/g, '').trim() };
  }
  const g = (id) => (best[id] ? best[id].value : '');
  let weight = 400, italic = false;
  if (tables['OS/2'] && tables['OS/2'].len >= 64) {
    const t = rd(tables['OS/2'].off, 64); weight = t.readUInt16BE(4) || 400; italic = !!(t.readUInt16BE(62) & 1);
    if (weight < 100) weight *= 100; // some old fonts store 1..9
    weight = Math.max(100, Math.min(950, weight));
  }
  const style = g(17) || g(2) || 'Regular';
  if (/italic|oblique/i.test(style)) italic = true;
  const family = g(16) || g(1);
  if (!family) return null;
  return { family, style, full: g(4) || `${family} ${style}`, ps: g(6), weight, italic };
}

function parseFile(file) {
  let fd; try { fd = fs.openSync(file, 'r'); } catch (e) { return []; }
  try {
    const rd = reader(fd); const head = rd(0, 16); if (head.length < 12) return [];
    const tag = head.toString('latin1', 0, 4);
    if (tag === 'ttcf') {
      const n = Math.min(head.readUInt32BE(8), 256); const offs = rd(12, n * 4); const faces = [];
      for (let i = 0; i < n; i++) { const f = parseFace(rd, offs.readUInt32BE(i * 4)); if (f) faces.push(Object.assign(f, { index: i, collection: true })); }
      return faces;
    }
    if (tag === '\0\x01\0\0' || tag === 'OTTO' || tag === 'true' || tag === 'typ1') { const f = parseFace(rd, 0); return f ? [Object.assign(f, { index: 0, collection: false })] : []; }
    if (path.extname(file).toLowerCase() === '.dfont') return parseDfont(rd);
    return [];
  } catch (e) { return []; } finally { fs.closeSync(fd); }
}

// Mac .dfont: a resource fork stored in the data fork; each 'sfnt' resource is one face
function parseDfont(rd) {
  const h = rd(0, 16); const dataOff = h.readUInt32BE(0), mapOff = h.readUInt32BE(4), mapLen = h.readUInt32BE(12);
  const map = rd(mapOff, Math.min(mapLen, 1 << 20)); if (map.length < 30) return [];
  const typeList = map.readUInt16BE(24); const nTypes = map.readUInt16BE(typeList) + 1; const faces = [];
  for (let t = 0; t < nTypes; t++) {
    const o = typeList + 2 + t * 8; if (o + 8 > map.length) break;
    if (map.toString('latin1', o, o + 4) !== 'sfnt') continue;
    const n = map.readUInt16BE(o + 4) + 1, ref = typeList + map.readUInt16BE(o + 6);
    for (let i = 0; i < n; i++) {
      const r = ref + i * 12; if (r + 12 > map.length) break;
      const off = dataOff + (map.readUInt32BE(r + 4) & 0xffffff) + 4; // skip the 4-byte resource length
      const sub = (pos, len) => rd(off + pos, len);
      const f = parseFace(sub, 0); if (f) faces.push(Object.assign(f, { index: i, collection: true }));
    }
  }
  return faces;
}

// ---------- scan with a cache keyed on path, size and modification time ----------
let cacheFile = null, cache = {}, lastResult = null, scanning = null;
function init(userDataDir) {
  cacheFile = path.join(userDataDir, 'font-cache.json');
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) { cache = {}; }
}

async function scan(force = false) {
  if (lastResult && !force) return lastResult;
  if (scanning) return scanning;
  scanning = (async () => {
    const files = []; for (const d of fontDirs()) walk(d, files);
    const next = {}; const faces = []; let i = 0;
    for (const f of [...new Set(files)]) {
      let st; try { st = fs.statSync(f); } catch (e) { continue; }
      const key = `${st.size}:${Math.round(st.mtimeMs)}`;
      let parsed = cache[f] && cache[f].key === key ? cache[f].faces : null;
      if (!parsed) parsed = parseFile(f);
      next[f] = { key, faces: parsed };
      for (const face of parsed) faces.push(Object.assign({ file: f }, face));
      if (++i % 50 === 0) await new Promise((r) => setImmediate(r)); // stay responsive
    }
    cache = next; if (cacheFile) { try { fs.writeFileSync(cacheFile, JSON.stringify(cache)); } catch (e) { /* ignore */ } }
    // group into families; hide Apple's private UI fonts (names starting with a dot)
    const fam = new Map();
    for (const f of faces) {
      if (!f.family || f.family.startsWith('.') || (f.ps && f.ps.startsWith('.'))) continue;
      const k = f.family.toLowerCase(); if (!fam.has(k)) fam.set(k, { family: f.family, styles: [] });
      const g = fam.get(k);
      if (g.styles.some((s) => s.style.toLowerCase() === f.style.toLowerCase())) continue; // duplicate installs
      g.styles.push({ style: f.style, ps: f.ps, full: f.full, weight: f.weight, italic: f.italic, file: f.file, index: f.index, collection: f.collection });
    }
    const list = [...fam.values()].sort((a, b) => a.family.localeCompare(b.family, undefined, { sensitivity: 'base' }));
    for (const g of list) g.styles.sort((a, b) => (a.italic - b.italic) || (a.weight - b.weight) || a.style.localeCompare(b.style));
    allowed = new Set(faces.map((f) => f.file));
    lastResult = list; scanning = null; return list;
  })();
  return scanning;
}

let allowed = new Set();
// Only files found by the scan may be read (keeps the renderer away from arbitrary paths)
function readFont(file) {
  if (!allowed.has(file)) throw new Error('Not a scanned font file');
  const b = fs.readFileSync(file); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

module.exports = { init, scan, readFont, parseFile, fontDirs };
