// Forged Web — browser stand-in for the desktop bridge (window.native).
// Files come from this computer (File System Access API where the browser has it, otherwise
// upload/download) or from the server's Library. Every exported image has its metadata removed here.
(() => {
  'use strict';
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const K = () => window.K;
  const UI = () => window.K.UI;
  const el = (...a) => window.K.U.el(...a);
  const FSA = typeof window.showOpenFilePicker === 'function';
  const IMG_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', forged: 'application/json', kauri: 'application/json' };
  const extOf = (n) => (String(n).match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  const isProject = (n) => /\.(forged|kauri)$/i.test(n);
  const handles = new Map(); let hid = 0; // 'fsa:N' -> FileSystemFileHandle / FileSystemDirectoryHandle
  const keep = (h) => { const id = 'fsa:' + (++hid); handles.set(id, h); return id; };

  // ---------- server ----------
  let info = null;
  const serverInfo = async () => { if (info) return info; try { const r = await fetch('api/info', { cache: 'no-store' }); info = r.ok ? await r.json() : { library: false }; } catch (e) { info = { library: false }; } return info; };
  serverInfo();
  async function api(pathq, opts = {}) {
    const r = await fetch('api/' + pathq, opts);
    if (!r.ok) { let m = r.statusText; try { m = (await r.json()).error || m; } catch (e) { /* ignore */ } throw Object.assign(new Error(m), { status: r.status }); }
    return r;
  }
  const libGet = (p) => api('file?path=' + encodeURIComponent(p));
  const libPut = (p, body, mode = 'fail') => api(`file?path=${encodeURIComponent(p)}&mode=${mode}`, { method: 'PUT', body }).then((r) => r.json());
  const libList = (p) => api('files?path=' + encodeURIComponent(p || '')).then((r) => r.json());
  const libDel = (p) => api('file?path=' + encodeURIComponent(p), { method: 'DELETE' });

  // ---------- bytes ----------
  const b64ToBytes = (b64) => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  const blobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
  const bytesToDataUrl = (u, mime) => blobToDataUrl(new Blob([u], { type: mime }));
  async function readFileObj(file, path) {
    if (isProject(file.name)) return { kind: 'project', name: file.name, path, text: await file.text() };
    const ext = extOf(file.name);
    return { kind: 'image', name: file.name, path, dataUrl: await bytesToDataUrl(new Uint8Array(await file.arrayBuffer()), MIME[ext] || file.type || 'application/octet-stream') };
  }

  // ---------- metadata removal (same rules as the desktop app's strip.js) ----------
  const be32 = (u, p) => ((u[p] << 24) >>> 0) + (u[p + 1] << 16) + (u[p + 2] << 8) + u[p + 3];
  const le32 = (u, p) => u[p] + (u[p + 1] << 8) + (u[p + 2] << 16) + ((u[p + 3] << 24) >>> 0);
  const tag = (u, p) => String.fromCharCode(u[p], u[p + 1], u[p + 2], u[p + 3]);
  const concat = (parts) => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
  function stripPng(u) {
    const keepT = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']); const parts = [u.subarray(0, 8)]; let p = 8;
    while (p + 12 <= u.length) { const len = be32(u, p), t = tag(u, p + 4), end = p + 12 + len; if (end > u.length) break; if (keepT.has(t)) parts.push(u.subarray(p, end)); p = end; if (t === 'IEND') break; }
    return concat(parts);
  }
  function stripJpeg(u) {
    const parts = [u.subarray(0, 2)]; let p = 2;
    while (p + 4 <= u.length) {
      if (u[p] !== 0xff) return u; const m = u[p + 1];
      if (m === 0xff) { p++; continue; }
      if (m === 0xd9) { parts.push(u.subarray(p, p + 2)); break; }
      const len = (u[p + 2] << 8) + u[p + 3], end = p + 2 + len; if (end > u.length) return u;
      if (!(m >= 0xe0 && m <= 0xef) && m !== 0xfe) parts.push(u.subarray(p, end));
      if (m === 0xda) { parts.push(u.subarray(end)); return concat(parts); }
      p = end;
    }
    return concat(parts);
  }
  function stripWebp(u) {
    const parts = []; let p = 12;
    while (p + 8 <= u.length) {
      const id = tag(u, p), len = le32(u, p + 4), end = p + 8 + len + (len & 1);
      if (end > u.length + 1) break;
      let chunk = u.subarray(p, Math.min(end, u.length));
      if (id === 'EXIF' || id === 'XMP ' || id === 'ICCP') { p = end; continue; }
      if (id === 'VP8X') { chunk = chunk.slice(); chunk[8] &= ~(0x20 | 0x08 | 0x04); }
      parts.push(chunk); p = end;
    }
    const body = concat(parts), head = new Uint8Array(12), n = body.length + 4;
    head.set([82, 73, 70, 70, n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255, 87, 69, 66, 80]);
    return concat([head, body]);
  }
  function stripImage(u) {
    if (u[0] === 0x89 && u[1] === 0x50) return stripPng(u);
    if (u[0] === 0xff && u[1] === 0xd8) return stripJpeg(u);
    if (tag(u, 0) === 'RIFF' && tag(u, 8) === 'WEBP') return stripWebp(u);
    return u;
  }

  // ---------- this computer ----------
  const ACCEPT = { images: { 'image/*': IMG_EXT.map((e) => '.' + e) }, projects: { 'application/x-forged': ['.forged', '.kauri'] } };
  async function pickLocal({ multi = true, projectsOnly = false } = {}) {
    if (FSA) {
      let hs;
      const types = projectsOnly ? [{ description: 'Forged Projects', accept: ACCEPT.projects }]
        : [{ description: 'Images & Projects', accept: Object.assign({}, ACCEPT.images, ACCEPT.projects) }];
      try { hs = await window.showOpenFilePicker({ multiple: multi, types, excludeAcceptAllOption: false, id: 'forged-open' }); } catch (e) { return []; }
      const out = [];
      for (const h of hs) { const f = await h.getFile(); out.push(await readFileObj(f, isProject(f.name) ? keep(h) : null)); }
      return out;
    }
    return new Promise((res) => {
      const i = document.createElement('input'); i.type = 'file'; i.multiple = multi; i.accept = projectsOnly ? '.forged,.kauri' : 'image/*,.forged,.kauri';
      i.onchange = async () => { const out = []; for (const f of i.files) out.push(await readFileObj(f, null)); res(out); };
      i.oncancel = () => res([]);
      i.click();
    });
  }
  function download(bytes, name, mime) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function writeHandle(h, bytes) { const w = await h.createWritable(); await w.write(bytes); await w.close(); }
  async function saveLocal(name, bytes, mime, desc, ext) {
    if (typeof window.showSaveFilePicker === 'function') {
      let h; try { h = await window.showSaveFilePicker({ suggestedName: name, id: ext === 'forged' ? 'forged-save' : 'forged-export', types: [{ description: desc, accept: { [mime]: ['.' + ext].concat(ext === 'jpg' ? ['.jpeg'] : []) } }] }); } catch (e) { return null; }
      await writeHandle(h, bytes); return { path: keep(h), name: h.name };
    }
    download(bytes, name, mime); return { path: null, name };
  }

  // ---------- dialogs ----------
  async function whereDialog(title, name, ext, okLabel, libFolder) {
    const s = await serverInfo();
    const locs = [];
    if (s.library && !s.readOnly) locs.push(['library', `Library on server (${libFolder})`]);
    locs.push(['computer', FSA ? 'This computer…' : 'This computer (Downloads)']);
    const last = localStorage.getItem('forged.web.saveTo');
    const v = await UI().form(title, [
      { key: 'name', label: 'Name', type: 'text', value: name.replace(/\.[^.]+$/, '') },
      { key: 'where', label: 'Save to', type: 'select', value: locs.some((l) => l[0] === last) ? last : locs[0][0], options: locs },
    ], okLabel, 400);
    if (!v) return null;
    localStorage.setItem('forged.web.saveTo', v.where);
    const clean = (String(v.name || '').trim() || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-');
    return { where: v.where, file: `${clean}.${ext}` };
  }
  async function confirmBox(message, detail, buttons) {
    const body = el('div', { class: 'form' }, el('p', { style: { margin: '0 0 6px', fontWeight: 600 } }, message), detail ? el('p', { class: 'hint' }, detail) : null);
    // UI.modal lists buttons left to right with the last as the default; return the index in the caller's order
    const order = buttons.map((b, i) => [b, i]);
    const cancel = order.length - 1;
    const r = await UI().modal({ title: 'Forged', body, buttons: [order[cancel], ...order.slice(1, cancel), order[0]].map(([b, i]) => [b, i, i === 0 ? 'primary' : '']), width: 420 });
    return r === false ? cancel : r;
  }
  async function libWrite(folder, file, bytes, mode) {
    try { return await libPut(`${folder}/${file}`, bytes, mode); } catch (e) {
      if (e.status !== 409) throw e;
      const r = await confirmBox(`“${file}” already exists in ${folder}.`, 'Do you want to replace it?', ['Replace', 'Keep Both', 'Cancel']);
      if (r === 2) return null;
      return libPut(`${folder}/${file}`, bytes, r === 0 ? 'overwrite' : 'unique');
    }
  }

  // ---------- Library browser ----------
  const fmtSize = (n) => n == null ? '' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const fmtDate = (t) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  async function libraryDialog({ projectsOnly = false, title = 'Open from Library', start } = {}) {
    const s = await serverInfo(); if (!s.library) { UI().toast('No Library: this copy of Forged is not running on a Forged server'); return []; }
    let cwd = start || localStorage.getItem('forged.web.libDir') || '';
    const chosen = new Set();
    const crumbs = el('div', { class: 'lib-crumbs' }), list = el('div', { class: 'lib-list' }), note = el('div', { class: 'hint lib-note' });
    const body = el('div', { class: 'lib' }, crumbs, list, note);
    async function show(dir) {
      let data; try { data = await libList(dir); } catch (e) { if (dir) return show(''); note.textContent = e.message; return; }
      cwd = data.path; localStorage.setItem('forged.web.libDir', cwd); chosen.clear();
      crumbs.innerHTML = ''; const parts = cwd ? cwd.split('/') : [];
      crumbs.append(el('button', { class: 'crumb', onclick: () => show('') }, 'Library'));
      parts.forEach((p, i) => crumbs.append(el('span', {}, '›'), el('button', { class: 'crumb', onclick: () => show(parts.slice(0, i + 1).join('/')) }, p)));
      list.innerHTML = '';
      const ents = data.entries.filter((e) => e.type === 'dir' || !projectsOnly || isProject(e.name));
      if (!ents.length) list.append(el('div', { class: 'lib-empty' }, 'This folder is empty.'));
      for (const e of ents) {
        const p = (cwd ? cwd + '/' : '') + e.name;
        const thumb = e.type === 'dir' ? el('div', { class: 'lib-ico', html: K().icon ? K().icon('open', 20) : '' })
          : isProject(e.name) ? el('div', { class: 'lib-ico proj' }, 'F')
          : el('img', { class: 'lib-thumb', loading: 'lazy', src: 'api/file?path=' + encodeURIComponent(p), alt: '' });
        const row = el('div', { class: 'lib-row' + (e.type === 'dir' ? ' dir' : ''), tabindex: 0 }, thumb,
          el('span', { class: 'lib-name' }, e.name), el('span', { class: 'lib-meta' }, e.type === 'dir' ? 'Folder' : `${fmtSize(e.size)} · ${fmtDate(e.mtime)}`));
        if (e.type === 'dir') { row.onclick = () => show(p); row.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.stopPropagation(); show(p); } }; }
        else {
          row.onclick = (ev) => { if (!(ev.metaKey || ev.ctrlKey || ev.shiftKey)) { chosen.clear(); list.querySelectorAll('.lib-row.on').forEach((r) => r.classList.remove('on')); } if (chosen.has(p)) { chosen.delete(p); row.classList.remove('on'); } else { chosen.add(p); row.classList.add('on'); } };
          row.ondblclick = () => { chosen.clear(); chosen.add(p); body.closest('.modal').querySelector('footer .btn.primary').click(); };
          if (!s.readOnly) row.append(el('button', { class: 'lib-del', title: 'Delete', onclick: async (ev) => { ev.stopPropagation(); if (!confirm(`Delete “${e.name}” from the Library? This can't be undone.`)) return; try { await libDel(p); show(cwd); } catch (er) { UI().toast(er.message); } } }, '×'));
        }
        list.append(row);
      }
      note.textContent = s.readOnly ? 'The Library is read-only on this server.' : 'Tip: ⌘/Ctrl-click or Shift-click to open several files. Double-click opens one.';
    }
    await show(cwd);
    const ok = await UI().modal({ title, body, buttons: [['Cancel', false], ['Open', true]], width: 620 });
    if (!ok || !chosen.size) return [];
    UI().busy(true, 'Opening…');
    try {
      const out = [];
      for (const p of chosen) {
        const name = p.split('/').pop(); const r = await libGet(p);
        if (isProject(name)) out.push({ kind: 'project', name, path: 'lib:' + p, text: await r.text() });
        else out.push({ kind: 'image', name, path: 'lib:' + p, dataUrl: await blobToDataUrl(await r.blob()) });
      }
      return out;
    } catch (e) { UI().toast(e.message); return []; } finally { UI().busy(false); }
  }

  // ---------- fonts: the server's fonts plus (in Chromium, with permission) this computer's ----------
  let localFonts = [];
  const STYLE_WEIGHT = [[/thin|hairline/i, 100], [/extra ?light|ultra ?light/i, 200], [/light/i, 300], [/medium/i, 500], [/semi ?bold|demi/i, 600], [/extra ?bold|ultra ?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700]];
  async function queryLocal(prompt) {
    if (typeof window.queryLocalFonts !== 'function') return [];
    try {
      if (!prompt && navigator.permissions) { const st = await navigator.permissions.query({ name: 'local-fonts' }).catch(() => null); if (!st || st.state !== 'granted') return localFonts; }
      localFonts = await window.queryLocalFonts();
    } catch (e) { /* denied or not allowed yet */ }
    return localFonts;
  }
  function groupFonts(server, local) {
    const fam = new Map();
    const add = (family, s) => { if (!family || family.startsWith('.')) return; const k = family.toLowerCase(); if (!fam.has(k)) fam.set(k, { family, styles: [] }); const g = fam.get(k); if (!g.styles.some((x) => x.style.toLowerCase() === s.style.toLowerCase())) g.styles.push(s); };
    local.forEach((f, i) => { const w = (STYLE_WEIGHT.find(([re]) => re.test(f.style)) || [0, 400])[1]; add(f.family, { style: f.style, ps: f.postscriptName, full: f.fullName, weight: w, italic: /italic|oblique/i.test(f.style), file: 'loc:' + i, collection: false }); });
    for (const g of server || []) for (const s of g.styles) add(g.family, s);
    const list = [...fam.values()].sort((a, b) => a.family.localeCompare(b.family, undefined, { sensitivity: 'base' }));
    for (const g of list) g.styles.sort((a, b) => (a.italic - b.italic) || (a.weight - b.weight) || a.style.localeCompare(b.style));
    return list;
  }
  let fontsGranted = false;

  // ---------- the bridge ----------
  const listeners = { menu: [], open: [] };
  window.native = {
    isMac, isWeb: true, tagline: 'Layered photo editing in your browser',
    async openImages({ multi } = {}) { return pickLocal({ multi }); },
    async openProjects() { return pickLocal({ multi: true, projectsOnly: true }); },
    async save({ defaultName, data, path }) {
      const bytes = new TextEncoder().encode(data);
      if (path && path.startsWith('lib:')) { const r = await libPut(path.slice(4), bytes, 'overwrite'); return { path: 'lib:' + r.path, name: r.name }; }
      if (path && handles.has(path)) { const h = handles.get(path); try { await writeHandle(h, bytes); return { path, name: h.name }; } catch (e) { UI().toast('Could not save in place: ' + e.message); } }
      const w = await whereDialog('Save Project', defaultName, 'forged', 'Save', 'Projects'); if (!w) return null;
      if (w.where === 'library') { const r = await libWrite('Projects', w.file, bytes); return r ? { path: 'lib:' + r.path, name: r.name } : null; }
      return saveLocal(w.file, bytes, 'application/json', 'Forged Project', 'forged');
    },
    async exportImage({ defaultName, base64 }) {
      const ext = extOf(defaultName) || 'png', bytes = stripImage(b64ToBytes(base64)), mime = MIME[ext] || 'image/png';
      const w = await whereDialog('Export Image', defaultName, ext, 'Export', 'Exports'); if (!w) return null;
      if (w.where === 'library') { const r = await libWrite('Exports', w.file, bytes); return r ? { path: 'lib:' + r.path, name: r.name, bytes: bytes.length } : null; }
      const r = await saveLocal(w.file, bytes, mime, ext.toUpperCase(), ext); return r ? Object.assign(r, { bytes: bytes.length }) : null;
    },
    async pickFolder() {
      const s = await serverInfo(), opts = [];
      if (s.library && !s.readOnly) opts.push(['library', 'Library on server (Exports)']);
      if (typeof window.showDirectoryPicker === 'function') opts.push(['folder', 'A folder on this computer…']);
      opts.push(['downloads', 'Downloads']);
      const v = await UI().form('Convert To', [{ key: 'where', label: 'Save to', type: 'select', value: opts[0][0], options: opts }], 'Convert', 380);
      if (!v) return null;
      if (v.where === 'folder') { try { return keep(await window.showDirectoryPicker({ id: 'forged-convert', mode: 'readwrite' })); } catch (e) { return null; } }
      return v.where;
    },
    async writeExport({ folder, name, base64 }) {
      const ext = extOf(name), bytes = stripImage(b64ToBytes(base64));
      if (folder === 'library') { const r = await libPut('Exports/' + name, bytes, 'unique'); return { path: 'lib:' + r.path, name: r.name }; }
      if (folder && handles.has(folder)) {
        const dir = handles.get(folder), base = name.replace(/\.[^.]+$/, ''); let file = name, n = 2;
        for (;;) { try { await dir.getFileHandle(file); file = `${base} ${n++}.${ext}`; } catch (e) { break; } } // never overwrite
        const h = await dir.getFileHandle(file, { create: true }); await writeHandle(h, bytes); return { path: null, name: file };
      }
      download(bytes, name, MIME[ext] || 'image/png'); return { path: null, name };
    },
    confirm: ({ message, detail, buttons }) => confirmBox(message, detail, buttons),
    closeOk() {},
    setTitle(t) { document.title = t; },
    reveal() {},
    clipboardWriteImage(dataUrl) {
      if (!navigator.clipboard || !window.ClipboardItem) return;
      fetch(dataUrl).then((r) => r.blob()).then((b) => navigator.clipboard.write([new ClipboardItem({ 'image/png': b })])).catch(() => {});
    },
    async clipboardReadImage() {
      if (window.native._pasted) { const u = window.native._pasted; window.native._pasted = null; return u; }
      if (!navigator.clipboard || !navigator.clipboard.read) return null;
      try { for (const it of await navigator.clipboard.read()) { const t = it.types.find((x) => x.startsWith('image/')); if (t) return blobToDataUrl(await it.getType(t)); } } catch (e) { /* no permission or not an image */ }
      return null;
    },
    async listFonts(force) {
      let server = [];
      try { server = await (await fetch('api/fonts' + (force ? '?refresh=1' : ''))).json(); } catch (e) { /* static hosting: no server fonts */ }
      const local = await queryLocal(!!force);
      fontsGranted = local.length > 0;
      return groupFonts(Array.isArray(server) ? server : [], local);
    },
    async readFont(file) {
      if (String(file).startsWith('loc:')) { const f = localFonts[+file.slice(4)]; if (!f) throw new Error('Font not available'); return (await f.blob()).arrayBuffer(); }
      const r = await fetch('api/font?id=' + encodeURIComponent(file)); if (!r.ok) throw new Error('Font not available'); return r.arrayBuffer();
    },
    onMenu(fn) { listeners.menu.push(fn); },
    onOpenFile(fn) { listeners.open.push(fn); },
    onRequestClose() {},
  };
  // used by the web menu bar
  window.ForgedWeb = {
    run: (cmd, arg) => listeners.menu.forEach((fn) => fn(cmd, arg)),
    openLibrary: async () => { const files = await libraryDialog(); if (files.length) listeners.open.forEach((fn) => files.forEach((f) => fn(f))); },
    placeFromLibrary: async () => {
      const files = (await libraryDialog({ title: 'Place from Library' })).filter((f) => f.kind === 'image');
      const app = K().app, U = K().U;
      for (const f of files) app.placeCanvas(U.imageToCanvas(await U.loadImage(f.dataUrl)), f.name.replace(/\.[^.]+$/, ''));
    },
    convertFromLibrary: async () => { const files = await libraryDialog({ projectsOnly: true, title: 'Convert Projects from Library', start: 'Projects' }); if (files.length) K().app.convertProjects(files); },
    loadComputerFonts: async () => {
      if (typeof window.queryLocalFonts !== 'function') { UI().toast('This browser can’t list your computer’s fonts. Use Chrome or Edge, or add font files to the server’s fonts folder.', 5000); return; }
      await queryLocal(true);
      if (!localFonts.length) { UI().toast('Font access was not allowed. You can allow it in the site settings.', 4000); return; }
      await K().Fonts.load(true); UI().toast(`${K().Fonts.families.length} font families available`);
    },
    hasFontAccess: () => fontsGranted,
    serverInfo, stripImage,
  };

  // Paste from the system clipboard (works without clipboard permission)
  window.addEventListener('paste', (e) => {
    const U = window.K && window.K.U; if (!U || U.isTyping() || document.querySelector('.modal-bg')) return;
    const it = [...(e.clipboardData ? e.clipboardData.items : [])].find((i) => i.type.startsWith('image/'));
    e.preventDefault();
    if (it) blobToDataUrl(it.getAsFile()).then((u) => { window.native._pasted = u; window.ForgedWeb.run('paste'); });
    else window.ForgedWeb.run('paste');
  });
  // Unsaved work warning
  window.addEventListener('beforeunload', (e) => { const app = window.K && window.K.app; if (app && app.docs.some((d) => d.modified && d.history.length > 1)) { e.preventDefault(); e.returnValue = ''; } });
  // Opened from the OS when installed as an app ("Open with Forged")
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      for (const h of params.files || []) { const f = await h.getFile(); const item = await readFileObj(f, isProject(f.name) ? keep(h) : null); listeners.open.forEach((fn) => fn(item)); }
    });
  }
})();
