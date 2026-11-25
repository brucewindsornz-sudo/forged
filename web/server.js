// Forged Web — small self-hosted server (no dependencies).
// Serves the editor, a file library on the host (projects, exports, any mounted photo folders)
// and the fonts installed in the container or mounted into it.
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 8080;
const PUBLIC = path.resolve(process.env.FORGED_PUBLIC || path.join(__dirname, 'public'));
const DATA = path.resolve(process.env.FORGED_DATA || path.join(__dirname, 'data'));
const MAX_UPLOAD = (+process.env.FORGED_MAX_UPLOAD_MB || 1024) * 1024 * 1024;
const USER = process.env.FORGED_USER || 'forged';
const PASSWORD = process.env.FORGED_PASSWORD || '';
const READ_ONLY = /^(1|true|yes)$/i.test(process.env.FORGED_READ_ONLY || '');
const VERSION = (() => { try { return require('./package.json').version; } catch (e) { return 'dev'; } })();
if (!process.env.FORGED_FONT_DIRS) process.env.FORGED_FONT_DIRS = ['/fonts', '/usr/share/fonts', '/usr/local/share/fonts'].join(path.delimiter);
let Fonts = null;
try { Fonts = require(fs.existsSync(path.join(__dirname, 'fonts.js')) ? './fonts.js' : '../src/fonts.js'); } catch (e) { console.warn('Font scanning unavailable:', e.message); }

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.forged': 'application/json', '.kauri': 'application/json', '.pdf': 'application/pdf', '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.icc': 'application/vnd.iccprofile', '.txt': 'text/plain; charset=utf-8', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};
const LIB_EXT = new Set(['.forged', '.kauri', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']);

const send = (res, code, body, type = 'application/json', extra = {}) => {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, Object.assign({ 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-store' }, extra));
  res.end(buf);
};
const fail = (res, code, msg) => send(res, code, { error: msg });

function authorised(req) {
  if (!PASSWORD) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const [u, ...rest] = Buffer.from(h.slice(6), 'base64').toString().split(':');
  const a = Buffer.from(`${u}:${rest.join(':')}`), b = Buffer.from(`${USER}:${PASSWORD}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Resolve a library path safely inside DATA (no "..", no symlink escapes)
async function libPath(rel, mustExist = true) {
  rel = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (rel.split('/').some((p) => p.startsWith('.') || p.includes('\0'))) throw Object.assign(new Error('Bad path'), { code: 400 });
  const full = path.resolve(DATA, rel);
  if (full !== DATA && !full.startsWith(DATA + path.sep)) throw Object.assign(new Error('Bad path'), { code: 400 });
  const root = await fsp.realpath(DATA);
  let probe = full;
  if (!mustExist) { while (!fs.existsSync(probe)) probe = path.dirname(probe); }
  const real = await fsp.realpath(probe).catch(() => null);
  if (!real) throw Object.assign(new Error('Not found'), { code: 404 });
  // Mounted folders may be symlinks or bind mounts; allow them only if they were linked at the top level by the host
  if (real !== root && !real.startsWith(root + path.sep)) {
    const top = rel.split('/')[0]; const topReal = await fsp.realpath(path.join(DATA, top)).catch(() => null);
    if (!topReal || !(real === topReal || real.startsWith(topReal + path.sep))) throw Object.assign(new Error('Bad path'), { code: 400 });
  }
  return full;
}
const relOf = (full) => path.relative(DATA, full).split(path.sep).join('/');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > MAX_UPLOAD) { reject(Object.assign(new Error('File too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
}

async function uniqueName(full) {
  if (!fs.existsSync(full)) return full;
  const ext = path.extname(full), base = full.slice(0, full.length - ext.length); let n = 2;
  while (fs.existsSync(`${base} ${n}${ext}`)) n++;
  return `${base} ${n}${ext}`;
}

// ---------- fonts ----------
let fontIndex = [], fontList = null;
async function fonts(force) {
  if (!Fonts) return [];
  if (fontList && !force) return fontList;
  const list = await Fonts.scan(!!force); fontIndex = [];
  fontList = list.map((g) => ({ family: g.family, styles: g.styles.map((s) => { fontIndex.push(s.file); return Object.assign({}, s, { file: 'srv:' + (fontIndex.length - 1) }); }) }));
  return fontList;
}

async function api(req, res, url) {
  const p = url.pathname, q = url.searchParams;
  if (p === '/api/info') return send(res, 200, { app: 'Forged Web', version: VERSION, library: true, readOnly: READ_ONLY, fonts: !!Fonts });
  if (p === '/api/fonts') return send(res, 200, await fonts(q.get('refresh') === '1'));
  if (p === '/api/font') {
    await fonts(); const file = fontIndex[+String(q.get('id') || '').replace(/^srv:/, '')];
    if (!file) return fail(res, 404, 'No such font');
    return send(res, 200, await fsp.readFile(file), MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', { 'Cache-Control': 'private, max-age=86400' });
  }
  if (p === '/api/files' && req.method === 'GET') {
    const full = await libPath(q.get('path') || '');
    const ents = await fsp.readdir(full, { withFileTypes: true });
    const out = [];
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const fp = path.join(full, e.name); let st; try { st = await fsp.stat(fp); } catch (er) { continue; }
      if (st.isDirectory()) out.push({ name: e.name, type: 'dir', mtime: st.mtimeMs });
      else if (LIB_EXT.has(path.extname(e.name).toLowerCase())) out.push({ name: e.name, type: 'file', size: st.size, mtime: st.mtimeMs });
    }
    out.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })));
    return send(res, 200, { path: relOf(full), entries: out });
  }
  if (p === '/api/file') {
    if (req.method === 'GET') {
      const full = await libPath(q.get('path'));
      const st = await fsp.stat(full); if (!st.isFile()) return fail(res, 400, 'Not a file');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
      return fs.createReadStream(full).pipe(res);
    }
    if (READ_ONLY) return fail(res, 403, 'The library is read-only');
    if (req.method === 'PUT') {
      let full = await libPath(q.get('path'), false);
      if (!LIB_EXT.has(path.extname(full).toLowerCase())) return fail(res, 400, 'Only images, PDFs and Forged projects can be saved');
      const mode = q.get('mode') || 'fail';
      const body = await readBody(req);
      await fsp.mkdir(path.dirname(full), { recursive: true });
      if (fs.existsSync(full)) { if (mode === 'unique') full = await uniqueName(full); else if (mode !== 'overwrite') return fail(res, 409, 'A file with that name already exists'); }
      const tmp = path.join(path.dirname(full), `.${path.basename(full)}.${process.pid}.${Date.now()}.tmp`);
      await fsp.writeFile(tmp, body); await fsp.rename(tmp, full); // atomic: never leaves a half-written project
      return send(res, 200, { path: relOf(full), name: path.basename(full), bytes: body.length });
    }
    if (req.method === 'DELETE') {
      const full = await libPath(q.get('path'));
      if (!(await fsp.stat(full)).isFile()) return fail(res, 400, 'Only files can be deleted');
      await fsp.unlink(full); return send(res, 200, { ok: true });
    }
  }
  if (p === '/api/folder' && req.method === 'POST') {
    if (READ_ONLY) return fail(res, 403, 'The library is read-only');
    const full = await libPath(q.get('path'), false); await fsp.mkdir(full, { recursive: true });
    return send(res, 200, { path: relOf(full) });
  }
  return fail(res, 404, 'Unknown API');
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname); if (rel.endsWith('/')) rel += 'index.html';
  const full = path.resolve(PUBLIC, '.' + rel);
  if (!full.startsWith(PUBLIC)) return fail(res, 400, 'Bad path');
  let st; try { st = await fsp.stat(full); } catch (e) { return send(res, 404, 'Not found', 'text/plain'); }
  if (st.isDirectory()) return send(res, 302, '', 'text/plain', { Location: url.pathname + '/' });
  const etag = `"${st.size}-${Math.round(st.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, ETag: etag, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(full).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') return send(res, 200, 'ok', 'text/plain');
  if (!authorised(req)) return send(res, 401, 'Sign in required', 'text/plain', { 'WWW-Authenticate': 'Basic realm="Forged", charset="UTF-8"' });
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Method not allowed');
    return await serveStatic(req, res, url);
  } catch (e) {
    const code = e.code === 'ENOENT' ? 404 : e.code === 'EACCES' || e.code === 'EROFS' ? 403 : typeof e.code === 'number' ? e.code : 500;
    if (code === 500) console.error(e);
    if (!res.headersSent) fail(res, code, code === 404 ? 'Not found' : code === 403 ? 'Permission denied' : e.message);
  }
});

(async () => {
  await fsp.mkdir(DATA, { recursive: true });
  for (const d of ['Projects', 'Exports']) await fsp.mkdir(path.join(DATA, d), { recursive: true }).catch(() => {});
  if (Fonts) { Fonts.init(DATA.startsWith('/') ? path.join(DATA, '.forged') : DATA); await fsp.mkdir(path.join(DATA, '.forged'), { recursive: true }).catch(() => {}); fonts().catch(() => {}); }
  server.listen(PORT, () => console.log(`Forged Web ${VERSION} on :${PORT} — library ${DATA}${PASSWORD ? ' (password protected)' : ''}`));
})();
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => server.close(() => process.exit(0)));
