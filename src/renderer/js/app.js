// Forged — application controller: commands, file I/O, input handling
(function (K) {
  'use strict';
  const U = K.U, UI = K.UI, Lr = K.Layers, el = U.el;
  const native = window.native || null;

  K.prefs = Object.assign({ historyLimit: 50, exportQuality: 92, rulerUnits: 'cm', gridEvery: 2, gridUnit: 'cm', gridSubdiv: 4, guideColor: '#00d0ff', guideStyle: 'lines', lockGuides: false, newPpi: 300 }, JSON.parse(localStorage.getItem('kauri.prefs') || '{}'));
  const savePrefs = () => localStorage.setItem('kauri.prefs', JSON.stringify(K.prefs));

  const app = {
    docs: [], doc: null, tool: null, fg: '#000000', bg: '#ffffff', editMask: false, clip: null, view: null,
  };
  K.app = app;

  // ---------- documents ----------
  app.addDoc = (d) => {
    d.listeners.add((what) => {
      if (d !== app.doc) return;
      if (what === 'layers' || what === 'history') { UI.refreshLayers(); if (UI.ptab === 'history') UI.renderPanel(); UI.refreshTabs(); UI.refreshBin(); UI.updateInfo(); }
      if (what === 'pixels') { UI.updateInfo(); }
      if (what === 'selection') UI.updateStatus();
      app.view.requestRender();
    });
    app.docs.push(d); app.switchDoc(d);
  };
  app.switchDoc = (d) => {
    if (app.tool && app.tool.deactivate) app.tool.deactivate();
    app.doc = d; app.editMask = false;
    document.body.classList.toggle('has-doc', !!d);
    if (d && !d.view.fitted) setTimeout(() => app.view.fit(), 0);
    UI.buildPanels(); UI.refreshAll(); UI.renderOptions();
  };
  app.closeDoc = async (d) => {
    d = d || app.doc; if (!d) return;
    if (d.modified && d.history.length > 1) {
      const r = native ? await native.confirm({ message: `Save changes to “${d.name}” before closing?`, detail: 'Your changes will be lost if you don’t save them.', buttons: ['Save', 'Don’t Save', 'Cancel'] }) : (confirm(`Discard changes to ${d.name}?`) ? 1 : 2);
      if (r === 2) return false;
      if (r === 0) { const ok = await app.saveProject(d); if (!ok) return false; }
    }
    const i = app.docs.indexOf(d); app.docs.splice(i, 1);
    app.switchDoc(app.docs[Math.min(i, app.docs.length - 1)] || null);
    return true;
  };
  app.newDoc = (w, h, bg = '#ffffff', name, ppi) => {
    const d = new K.Doc(w, h, name || `Untitled-${app.docs.length + 1}`); if (ppi) d.ppi = ppi;
    const L = Lr.newLayer({ name: bg === 'transparent' ? 'Layer 1' : 'Background', canvas: U.canvas(w, h), x: 0, y: 0 });
    if (bg !== 'transparent') { const x = U.ctx(L.canvas); x.fillStyle = bg; x.fillRect(0, 0, w, h); }
    d.layers.push(L); d.activeId = L.id; d.push('New Document'); d.modified = false;
    app.addDoc(d); return d;
  };
  app.docFromCanvas = (c, name, path, ppi) => {
    const d = new K.Doc(c.width, c.height, name); d.path = null; d.sourcePath = path || null; d.ppi = ppi || 72;
    const L = Lr.newLayer({ name: 'Background', canvas: c, x: 0, y: 0 }); d.layers.push(L); d.activeId = L.id;
    d.push('Open'); d.modified = false; app.addDoc(d); return d;
  };

  // ---------- file I/O ----------
  async function openFiles(files) {
    for (const f of files) {
      try {
        if (f.kind === 'project') await app.loadProject(f.text, f.name, f.path);
        else if (f.kind === 'pdf' || K.PDF.isPdfName(f.name)) await K.PDF.open(f);
        else { const img = await U.loadImage(f.dataUrl); app.docFromCanvas(U.imageToCanvas(img), f.name.replace(/\.[^.]+$/, ''), f.path, U.readPPI(f.dataUrl)); }
      } catch (e) { UI.toast(`Could not open ${f.name}: ${e.message}`); }
    }
  }
  app.openFiles = openFiles;
  function browserPick(multi) {
    return new Promise((res) => {
      const i = el('input', { type: 'file', accept: 'image/*,.pdf,application/pdf,.forged,.kauri', multiple: multi });
      i.onchange = async () => {
        const out = [];
        for (const f of i.files) { if (/\.(forged|kauri)$/i.test(f.name)) out.push({ kind: 'project', name: f.name, text: await f.text() }); else if (K.PDF.isPdfName(f.name)) out.push({ kind: 'pdf', name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }); else out.push({ kind: 'image', name: f.name, dataUrl: await U.blobToDataUrl(f) }); }
        res(out);
      };
      i.click();
    });
  }
  const pickFiles = (multi = true) => native ? native.openImages({ multi }) : browserPick(multi);

  app.placeCanvas = (c, name, at) => {
    const d = app.doc; if (!d) return app.docFromCanvas(c, name);
    const framed = K.Collage && K.Collage.placeIntoFrame(d, c, name, at);
    if (framed) { app.setTool('move'); UI.refreshAll(); return framed; }
    const fit = Math.min(1, (d.w * 0.85) / c.width, (d.h * 0.85) / c.height);
    const L = Lr.newLayer({ type: 'smart', name: name || 'Placed Photo', src: c, t: { x: at ? at[0] : d.w / 2, y: at ? at[1] : d.h / 2, sx: fit, sy: fit, rot: 0 } });
    d.addLayer(L); d.push('Place ' + (name || 'Photo'));
    app.setTool('move'); K.tools.move.o.showBox = true; UI.renderOptions(); UI.refreshAll();
    return L;
  };

  function serialize(d) {
    const layers = d.layers.map((L) => {
      const r = { id: L.id, name: L.name, type: L.type, visible: L.visible, opacity: L.opacity, blend: L.blend, locked: L.locked, lockAlpha: !!L.lockAlpha, clip: L.clip, maskOn: L.maskOn, style: L.style, frame: L.frame || undefined };
      if (L.mask) r.mask = L.mask.toDataURL('image/png');
      if (L.type === 'pixel') { r.canvas = L.canvas.toDataURL('image/png'); r.x = L.x; r.y = L.y; }
      if (L.type === 'smart') { r.src = L.src.toDataURL('image/png'); r.t = L.t; }
      if (L.type === 'text') { r.tp = L.tp; r.t = L.t; }
      if (L.type === 'adjust') r.adj = L.adj;
      if (L.type === 'fill') r.color = L.color;
      return r;
    });
    return JSON.stringify({ app: 'Forged', version: 1, w: d.w, h: d.h, ppi: d.ppi, origin: d.origin, guides: d.guides, activeId: d.activeId, layers });
  }
  // Build a document from a project file without opening it (used by Open and by Convert)
  app.buildProject = async (text, name, path) => {
    const j = JSON.parse(text); if (j.app !== 'Forged' && j.app !== 'Kauri Photo') throw new Error('Not a Forged project');
    const d = new K.Doc(j.w, j.h, (name || 'Project').replace(/\.(forged|kauri)$/i, '')); d.path = path || null; d.guides = j.guides || []; d.ppi = j.ppi || 72; d.origin = j.origin || [0, 0];
    const load = async (u) => U.imageToCanvas(await U.loadImage(u));
    for (const r of j.layers) {
      const L = Lr.newLayer(r);
      if (r.mask) L.mask = await load(r.mask);
      if (r.canvas) L.canvas = await load(r.canvas);
      if (r.src) L.src = await load(r.src);
      d.layers.push(L);
    }
    d.activeId = j.activeId;
    if (K.Fonts && K.Fonts.ensureForDoc) { try { await K.Fonts.ensureForDoc(d); } catch (e) { /* fall back to default font */ } }
    return d;
  };
  app.loadProject = async (text, name, path) => {
    const d = await app.buildProject(text, name, path);
    d.push('Open Project'); d.modified = false; app.addDoc(d);
  };
  app.saveProject = async (d, saveAs) => {
    d = d || app.doc; if (!d) return false;
    const data = serialize(d);
    if (native) {
      const r = await native.save({ defaultName: d.name + '.forged', filters: [{ name: 'Forged Project', extensions: ['forged'] }], data, path: saveAs ? null : d.path });
      if (!r) return false; d.path = r.path; d.name = r.name.replace(/\.(forged|kauri)$/i, '');
    } else U.download('data:application/json;base64,' + btoa(unescape(encodeURIComponent(data))), d.name + '.forged');
    d.modified = false; UI.refreshTabs(); UI.toast('Project saved'); return true;
  };
  // Encode a document as an image. Metadata is stripped again when the file is written.
  function encodeDoc(d, o) {
    let out = d.composite();
    if (o.scale !== 100) out = U.resample(out, Math.max(1, Math.round(d.w * o.scale / 100)), Math.max(1, Math.round(d.h * o.scale / 100)));
    if (o.format === 'jpeg') { const c = U.canvas(out.width, out.height), x = U.ctx(c); x.fillStyle = o.matte; x.fillRect(0, 0, c.width, c.height); x.drawImage(out, 0, 0); out = c; }
    return { url: out.toDataURL('image/' + o.format, o.quality / 100), ext: o.format === 'jpeg' ? 'jpg' : o.format };
  }
  app.encodeDoc = encodeDoc;
  app.serialize = serialize;
  const META_NOTE = 'Metadata is always removed: camera and location (EXIF), XMP, comments, software tags, timestamps, DPI and colour profiles.';
  function exportFields(d, est, withWebp) {
    return [
      { key: 'format', label: 'Format', type: 'select', value: K.prefs.exportFormat || 'jpeg', options: [['jpeg', 'JPEG'], ['png', 'PNG (keeps transparency)'], ...(withWebp ? [['webp', 'WebP'], ['pdf', 'PDF…']] : [])], onChange: (v, _vals, body) => { if (v === 'pdf' && body) { const b = body.closest('.modal'); const cancel = b && [...b.querySelectorAll('footer .btn')].find((x) => !x.classList.contains('primary')); if (cancel) cancel.click(); setTimeout(() => K.PDF.exportDialog(), 0); } } },
      { key: 'quality', label: 'Quality (JPEG)', type: 'range', value: K.prefs.exportQuality, min: 10, max: 100, unit: '%' },
      { key: 'scale', label: 'Size', type: 'range', value: 100, min: 5, max: 400, unit: '%', onChange: (v) => { if (d && est) est.textContent = `${Math.round(d.w * v / 100)} × ${Math.round(d.h * v / 100)} px`; } },
      { key: 'matte', label: 'Background (JPEG)', type: 'color', value: '#ffffff' },
      ...(est ? [{ type: 'html', node: est }] : []),
      { type: 'html', node: el('div', { class: 'hint' }, META_NOTE) },
    ];
  }
  app.exportDialog = async () => {
    const d = app.doc; if (!d) return;
    const est = el('div', { class: 'hint', id: 'export-est' }, `${d.w} × ${d.h} px`);
    const vals = await UI.form('Export Image', exportFields(d, est, true), 'Export…');
    if (!vals) return;
    K.prefs.exportQuality = vals.quality; K.prefs.exportFormat = vals.format; savePrefs();
    const { url, ext } = encodeDoc(d, vals);
    if (native) {
      const r = await native.exportImage({ defaultName: `${d.name}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }], base64: U.dataUrlToBase64(url) });
      if (r) UI.toast(`Exported ${r.name} (metadata removed)`);
    } else U.download(url, `${d.name}.${ext}`);
  };
  // Convert one or more .forged projects straight to PNG or JPEG, without opening them
  app.convertProjects = async (files) => {
    if (!files) files = native ? await native.openProjects() : (await pickFiles(true)).filter((f) => f.kind === 'project');
    files = (files || []).filter((f) => f.kind === 'project');
    if (!files.length) return;
    const vals = await UI.form(`Convert ${files.length} Project${files.length > 1 ? 's' : ''}`, exportFields(null, null, false), 'Choose Folder…');
    if (!vals) return;
    K.prefs.exportQuality = vals.quality; K.prefs.exportFormat = vals.format; savePrefs();
    let folder = null;
    if (native) { folder = await native.pickFolder({ defaultPath: files[0].path ? files[0].path.replace(/[\\/][^\\/]*$/, '') : undefined }); if (!folder) return; }
    let ok = 0; const failed = [];
    for (const f of files) {
      UI.busy && UI.busy(`Converting ${f.name}…`);
      try {
        const d = await app.buildProject(f.text, f.name, f.path);
        const { url, ext } = encodeDoc(d, vals), name = `${d.name}.${ext}`;
        if (native) await native.writeExport({ folder, name, base64: U.dataUrlToBase64(url) }); else U.download(url, name);
        ok++;
      } catch (e) { failed.push(f.name); }
    }
    UI.busy && UI.busy(false);
    UI.toast(`Converted ${ok} of ${files.length} to ${vals.format === 'jpeg' ? 'JPEG' : 'PNG'} (metadata removed)` + (failed.length ? ` · could not read ${failed.join(', ')}` : ''));
  };

  // ---------- pixel operation helpers ----------
  function requirePixelLayer(label) {
    const d = app.doc; if (!d) return null; const L = d.active;
    if (!L) { UI.toast('No active layer'); return null; }
    if (L.locked) { UI.toast('This layer is locked'); return null; }
    if (L.type === 'adjust') { UI.toast(`${label}: select a photo layer (adjustment layers have their own settings in Layers)`); return null; }
    if (L.type !== 'pixel') { d.rasterize(L); UI.toast(`“${L.name}” was rasterised`); }
    d.writable(L); return L;
  }
  // Prepare an operation on the active layer that respects the selection. Returns {run(fn), cancel(), commit(label)}
  function layerOp(L) {
    const d = app.doc, orig = L.canvas; d.writable(L); const base = L.canvas;
    let region = { x: 0, y: 0, w: base.width, h: base.height };
    let selData = null;
    if (d.sel) {
      const b = d.sel.bounds, m = 40;
      const x0 = Math.max(0, Math.floor(b.x - L.x - m)), y0 = Math.max(0, Math.floor(b.y - L.y - m));
      const x1 = Math.min(base.width, Math.ceil(b.x + b.w - L.x + m)), y1 = Math.min(base.height, Math.ceil(b.y + b.h - L.y + m));
      region = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
      selData = U.ctx(d.sel.canvas).getImageData(region.x + L.x, region.y + L.y, region.w, region.h).data;
    }
    const srcData = U.ctx(base).getImageData(region.x, region.y, region.w, region.h);
    return {
      run(fn) {
        let out = fn(U.copyData(srcData));
        if (selData) { const o = out.data, s = srcData.data; for (let i = 0; i < o.length; i += 4) { const a = selData[i + 3] / 255; if (a >= 1) continue; for (let c = 0; c < 4; c++) o[i + c] = s[i + c] + (o[i + c] - s[i + c]) * a; } }
        const c = U.clone(base); U.ctx(c).putImageData(out, region.x, region.y); L.canvas = c; d.touch(L); app.view.requestRender();
      },
      cancel() { L.canvas = orig; d.touch(L); app.view.requestRender(); },
      commit(label) { d.push(label); UI.refreshAll(); },
    };
  }
  async function adjustDialog(kind) {
    const L = requirePixelLayer('Adjustment'); if (!L) return;
    const def = K.Adjust.defs[kind], params = K.Adjust.defaults(kind), op = layerOp(L);
    const ok = await UI.paramDialog({ title: def.title, def, params, preview: (p) => op.run((data) => K.Adjust.apply(kind, p, data)), onCancel: (temp) => op.cancel(temp) });
    if (ok) { op.run((data) => K.Adjust.apply(kind, params, data)); op.commit(def.title); }
  }
  async function filterDialog(kind) {
    const L = requirePixelLayer('Filter'); if (!L) return;
    const def = K.Filters.defs[kind], params = K.Filters.defaults(kind), op = layerOp(L);
    if (!def.controls.length) { await UI.withBusy(def.title + '…', () => op.run((data) => def.fn(data, params))); op.commit(def.title); return; }
    let pending = 0;
    const ok = await UI.paramDialog({ title: def.title, def, params, preview: (p) => { const id = ++pending; UI.busy(true, 'Previewing…'); setTimeout(() => { if (id === pending) { try { op.run((data) => def.fn(data, p)); } finally { UI.busy(false); } } }, 10); }, onCancel: () => op.cancel() });
    if (ok) { await UI.withBusy(def.title + '…', () => op.run((data) => def.fn(data, params))); op.commit(def.title); }
  }

  function rotatedRectWithMaxArea(w, h, angle) {
    const longer = w >= h, sl = longer ? w : h, ss = longer ? h : w, s = Math.abs(Math.sin(angle)), c = Math.abs(Math.cos(angle));
    if (ss <= 2 * s * c * sl || Math.abs(s - c) < 1e-10) { const x = 0.5 * ss; return longer ? [x / s, x / c] : [x / c, x / s]; }
    const c2 = c * c - s * s; return [(w * c - h * s) / c2, (h * c - w * s) / c2];
  }
  app.straighten = (deg, autoCrop) => {
    const d = app.doc; if (!d || Math.abs(deg) < 0.01) return;
    const w0 = d.w, h0 = d.h; d.rotateAll(deg);
    if (autoCrop) { const [cw, ch] = rotatedRectWithMaxArea(w0, h0, deg * Math.PI / 180); const W = Math.floor(cw), H = Math.floor(ch); d.translateAll(-Math.round((d.w - W) / 2), -Math.round((d.h - H) / 2), W, H); }
    d.push(`Straighten ${deg.toFixed(1)}°`); app.view.fit(); UI.refreshAll();
  };

  function selectionMaskOrAll(d) { return d.sel ? d.sel.canvas : (() => { const c = U.canvas(d.w, d.h), x = U.ctx(c); x.fillStyle = '#fff'; x.fillRect(0, 0, d.w, d.h); return c; })(); }
  function copySelection(merged) {
    const d = app.doc; if (!d) return null;
    const L = d.active; const src = merged ? d.composite() : (L ? K.ToolHelpers.contentOnly(d, L) : null); if (!src) return null;
    const c = K.Sel.clip(d, U.clone(src));
    const b = d.sel ? d.sel.bounds : Lr.alphaBounds(c) || { x: 0, y: 0, w: d.w, h: d.h };
    const out = U.canvas(b.w, b.h); U.ctx(out).drawImage(c, -b.x, -b.y);
    app.clip = { canvas: out, x: b.x, y: b.y, w: b.w, h: b.h };
    const url = out.toDataURL('image/png');
    if (native) native.clipboardWriteImage(url); else if (navigator.clipboard && window.ClipboardItem) out.toBlob((bl) => navigator.clipboard.write([new ClipboardItem({ 'image/png': bl })]).catch(() => {}));
    return app.clip;
  }
  async function readClipboard() {
    let url = null;
    if (native) url = await native.clipboardReadImage();
    else if (navigator.clipboard && navigator.clipboard.read) { try { const items = await navigator.clipboard.read(); for (const it of items) { const t = it.types.find((x) => x.startsWith('image/')); if (t) { url = await U.blobToDataUrl(await it.getType(t)); break; } } } catch (e) { /* permission */ } }
    if (url) { const c = U.imageToCanvas(await U.loadImage(url)); if (app.clip && c.width === app.clip.w && c.height === app.clip.h) return app.clip; return { canvas: c }; }
    return app.clip;
  }
  function clearSelectionPixels(L) {
    const d = app.doc; d.writable(L); const x = U.ctx(L.canvas); x.save(); x.globalCompositeOperation = 'destination-out'; x.drawImage(selectionMaskOrAll(d), -L.x, -L.y); x.restore(); d.touch(L);
  }
  function mergeLayers(list, name) {
    const d = app.doc; const c = d.compositeLayers(list);
    return Lr.newLayer({ name, canvas: c, x: 0, y: 0 });
  }

  // ---------- commands ----------
  const editCmds = { undo: 'undo', redo: 'redo', cut: 'cut', copy: 'copy', paste: 'paste', selectAll: 'selectAll', copyMerged: 'copy' };
  const C = {};
  app.run = async (cmd, arg) => {
    if (U.isTyping() && editCmds[cmd]) { document.execCommand(editCmds[cmd]); return; }
    const fn = C[cmd]; if (!fn) { console.warn('Unknown command', cmd); return; }
    const needsDoc = !['new', 'open', 'collage', 'newFromClipboard', 'shortcuts', 'preferences', 'swapColors', 'resetColors', 'place', 'convert'].includes(cmd);
    if (needsDoc && !app.doc) { UI.toast('Open or create a document first'); return; }
    try { await fn(arg); } catch (e) { console.error(e); UI.toast('Something went wrong: ' + e.message); }
    app.view.requestRender(); UI.updateStatus();
  };

  // File
  // ---------- unit-aware size fields (shared by New, Image Size, Canvas Size) ----------
  const UNIT_OPTS = [['px', 'Pixels'], ['mm', 'Millimetres'], ['cm', 'Centimetres'], ['in', 'Inches']];
  const numIn = (attrs) => el('input', Object.assign({ type: 'number', step: 'any', min: 0 }, attrs));
  const unitSel = (u, onchange) => { const s = el('select', {}, UNIT_OPTS.map(([v, l]) => el('option', { value: v, selected: v === u }, l))); s.onchange = () => onchange(s.value); return s; };
  const frow = (label, ...kids) => el('label', { class: 'frow' }, el('span', {}, label), ...kids);
  const showVal = (inp, px, unit, ppi) => { inp.value = U.fmtUnit(px, unit, ppi, false); };
  app.lastUnit = () => K.prefs.sizeUnit || K.prefs.rulerUnits || 'cm';

  // File
  C.new = async () => {
    // [key, label, width, height, unit, ppi]
    const presets = [['custom', 'Custom'], ['a4p', 'A4 portrait (210 × 297 mm)', 210, 297, 'mm', 300], ['a4l', 'A4 landscape (297 × 210 mm)', 297, 210, 'mm', 300],
      ['a5p', 'A5 portrait (148 × 210 mm)', 148, 210, 'mm', 300], ['a3p', 'A3 portrait (297 × 420 mm)', 297, 420, 'mm', 300], ['dl', 'DL card (99 × 210 mm)', 99, 210, 'mm', 300],
      ['p10x15', 'Photo 10 × 15 cm', 15, 10, 'cm', 300], ['p13x18', 'Photo 13 × 18 cm', 18, 13, 'cm', 300], ['p20x25', 'Photo 20 × 25 cm', 25, 20, 'cm', 300], ['p20x30', 'Photo 20 × 30 cm', 30, 20, 'cm', 300],
      ['6x4', 'Photo 6 × 4 in', 6, 4, 'in', 300], ['7x5', 'Photo 7 × 5 in', 7, 5, 'in', 300], ['10x8', 'Photo 10 × 8 in', 10, 8, 'in', 300], ['letter', 'US Letter (8.5 × 11 in)', 8.5, 11, 'in', 300],
      ['hd', 'HD 1920 × 1080 px', 1920, 1080, 'px', 72], ['4k', '4K 3840 × 2160 px', 3840, 2160, 'px', 72], ['igsq', 'Instagram square 1080 px', 1080, 1080, 'px', 72], ['igp', 'Instagram portrait 1080 × 1350', 1080, 1350, 'px', 72],
      ['story', 'Story / Reel 1080 × 1920', 1080, 1920, 'px', 72], ['fb', 'Facebook cover 1640 × 624', 1640, 624, 'px', 72]];
    const st = { W: 2480, H: 3508, ppi: 300, unit: 'mm' };
    const name = el('input', { type: 'text', value: `Untitled-${app.docs.length + 1}` });
    const preset = el('select', {}, presets.map(([v, l]) => el('option', { value: v, selected: v === 'a4p' }, l)));
    const wIn = numIn({ 'data-key': 'w' }), hIn = numIn({ 'data-key': 'h' }), rIn = numIn({ value: 300, min: 1, max: 2400 });
    const px = el('em', {}), sel = unitSel(st.unit, (u) => { st.unit = u; K.prefs.sizeUnit = u; savePrefs(); refresh(); });
    const bg = el('select', {}, [['#ffffff', 'White'], ['#000000', 'Black'], ['transparent', 'Transparent'], ['fg', 'Foreground colour'], ['bgc', 'Background colour']].map(([v, l]) => el('option', { value: v }, l)));
    const refresh = (skip) => { if (skip !== wIn) showVal(wIn, st.W, st.unit, st.ppi); if (skip !== hIn) showVal(hIn, st.H, st.unit, st.ppi); rIn.value = st.ppi; px.textContent = `${Math.round(st.W)} × ${Math.round(st.H)} px`; };
    const custom = () => { preset.value = 'custom'; };
    wIn.oninput = () => { st.W = U.fromUnit(+wIn.value || 0, st.unit, st.ppi); custom(); refresh(wIn); };
    hIn.oninput = () => { st.H = U.fromUnit(+hIn.value || 0, st.unit, st.ppi); custom(); refresh(hIn); };
    rIn.onchange = () => { const r = U.clamp(+rIn.value || 72, 1, 2400); if (st.unit !== 'px') { st.W *= r / st.ppi; st.H *= r / st.ppi; } st.ppi = r; custom(); refresh(); };
    preset.onchange = () => { const p = presets.find((q) => q[0] === preset.value); if (!p || !p[2]) return; st.ppi = p[5]; st.W = U.fromUnit(p[2], p[4], p[5]); st.H = U.fromUnit(p[3], p[4], p[5]); st.unit = p[4]; sel.value = p[4]; refresh(); };
    preset.onchange();
    const body = el('div', { class: 'form' }, frow('Name', name), frow('Preset', preset), frow('Width', wIn, sel), frow('Height', hIn, px), frow('Resolution', rIn, el('em', {}, 'pixels/inch')), frow('Background', bg));
    if (!await UI.modal({ title: 'New Document', body, buttons: [['Cancel', false], ['Create', true]], width: 400 })) return;
    const W = U.clamp(Math.round(st.W), 1, 30000), H = U.clamp(Math.round(st.H), 1, 30000);
    const b = bg.value === 'fg' ? app.fg : bg.value === 'bgc' ? app.bg : bg.value;
    app.newDoc(W, H, b, name.value || undefined, st.ppi);
  };
  C.open = async () => openFiles(await pickFiles(true));
  C.place = async () => {
    const all = await pickFiles(true), files = all.filter((f) => f.kind === 'image');
    for (const f of all.filter((x) => x.kind === 'pdf')) { try { await K.PDF.place(f); } catch (e) { UI.toast(`Could not place ${f.name}: ${e.message}`); } }
    for (const f of files) { const c = U.imageToCanvas(await U.loadImage(f.dataUrl)); app.placeCanvas(c, f.name.replace(/\.[^.]+$/, '')); }
  };
  C.newFromClipboard = async () => { const c = await readClipboard(); if (!c) { UI.toast('The clipboard has no image'); return; } app.docFromCanvas(U.clone(c.canvas), 'Clipboard'); };
  C.save = () => app.saveProject(app.doc, false);
  C.saveAs = () => app.saveProject(app.doc, true);
  C.export = () => app.exportDialog();
  C.exportPdf = (arg) => K.PDF.exportDialog(arg);
  C.convert = () => app.convertProjects();
  C.closeDoc = () => app.closeDoc();
  C.collage = () => K.Collage.dialog();

  // Edit
  C.undo = () => { const t = app.tool; if (t && t.cancel && t.id === 'polylasso' && t.pts) { t.cancel(); return; } app.doc.undo(); UI.refreshAll(); };
  C.redo = () => { app.doc.redo(); UI.refreshAll(); };
  C.copy = () => { if (copySelection(false)) UI.toast('Copied'); };
  C.copyMerged = () => { if (copySelection(true)) UI.toast('Copied merged'); };
  C.cut = () => { const L = requirePixelLayer('Cut'); if (!L) return; copySelection(false); clearSelectionPixels(L); app.doc.push('Cut'); };
  C.paste = async () => {
    const c = await readClipboard(); if (!c) { UI.toast('Nothing to paste'); return; }
    if (!app.doc) { app.docFromCanvas(U.clone(c.canvas), 'Pasted'); return; }
    const d = app.doc;
    const at = c.x !== undefined ? [c.x + c.w / 2, c.y + c.h / 2] : (d.sel ? [d.sel.bounds.x + d.sel.bounds.w / 2, d.sel.bounds.y + d.sel.bounds.h / 2] : null);
    const L = Lr.newLayer({ type: 'smart', name: d.nextName('Pasted'), src: U.clone(c.canvas), t: { x: at ? at[0] : d.w / 2, y: at ? at[1] : d.h / 2, sx: 1, sy: 1, rot: 0 } });
    if (c.x === undefined) { const f = Math.min(1, d.w / c.canvas.width, d.h / c.canvas.height); L.t.sx = L.t.sy = f; }
    d.addLayer(L); d.push('Paste'); app.setTool('move');
  };
  C.clearSel = () => {
    const d = app.doc, L = d.active; if (!L) return;
    if (!d.sel) { UI.toast('Make a selection first (or use Layer › Delete Layer)'); return; }
    if (app.editMask && L.mask) { const m = d.writable(L, 'mask'), x = U.ctx(m); x.globalCompositeOperation = 'destination-out'; x.drawImage(d.sel.canvas, 0, 0); d.touch(L); d.push('Hide in Mask'); return; }
    const P = requirePixelLayer('Delete'); if (!P) return; clearSelectionPixels(P); d.push('Delete Pixels');
  };
  C.quickFill = (which) => { // ⌥Delete = foreground, ⌘Delete = background
    const L = requirePixelLayer('Fill'); if (!L) return; const d = app.doc, col = which === 'bg' ? app.bg : app.fg;
    const m = U.clone(selectionMaskOrAll(d)), mx = U.ctx(m); mx.globalCompositeOperation = 'source-in'; mx.fillStyle = col; mx.fillRect(0, 0, d.w, d.h);
    d.ensureCovers(L); const x = U.ctx(L.canvas); x.save();
    if (L.lockAlpha) { const c2 = U.clone(m), c2x = U.ctx(c2); c2x.globalCompositeOperation = 'destination-in'; c2x.drawImage(L.canvas, L.x, L.y); x.drawImage(c2, -L.x, -L.y); } else x.drawImage(m, -L.x, -L.y);
    x.restore(); d.touch(L); d.push(which === 'bg' ? 'Fill with Background Colour' : 'Fill with Foreground Colour');
  };
  C.lockAlpha = () => { const L = app.doc && app.doc.active; if (!L) return; L.lockAlpha = !L.lockAlpha; UI.toast('Lock transparent pixels ' + (L.lockAlpha ? 'on' : 'off')); UI.refreshLayers(); };
  C.cycleDoc = (dir) => { if (app.docs.length < 2) return; const i = app.docs.indexOf(app.doc); app.switchDoc(app.docs[(i + dir + app.docs.length) % app.docs.length]); };
  C.togglePanel = (which) => {
    const b = document.body;
    if (which === 'options') b.classList.toggle('hide-options');
    else if (which === 'bin') b.classList.toggle('hide-bin');
    else if (which === 'info') b.classList.toggle('hide-info');
    else { b.classList.remove('hide-panels'); UI.ptab = which; UI.buildPanels(); }
    setTimeout(() => { app.view && app.view.requestRender(); UI.updateInfo(); }, 0);
  };
  C.toggleAllPanels = () => { document.body.classList.toggle('hide-panels'); setTimeout(() => { app.view.requestRender(); UI.updateInfo(); }, 0); };
  C.toggleGuides = () => { app.view.hideGuides = !app.view.hideGuides; app.view.requestRender(); };
  C.fillSel = async () => {
    const vals = await UI.form('Fill', [
      { key: 'use', label: 'Contents', type: 'select', value: 'fg', options: [['fg', 'Foreground colour'], ['bg', 'Background colour'], ['color', 'Colour…'], ['white', 'White'], ['black', 'Black'], ['gray', '50% Grey'], ['content', 'Content-Aware']] },
      { key: 'color', label: 'Colour', type: 'color', value: app.fg },
      { key: 'opacity', label: 'Opacity', type: 'range', value: 100, min: 1, max: 100, unit: '%' },
      { key: 'blend', label: 'Mode', type: 'select', value: 'normal', options: Object.entries(Lr.BLEND_NAMES) },
    ], 'Fill');
    if (!vals) return;
    if (vals.use === 'content') return C.contentFill();
    const L = requirePixelLayer('Fill'); if (!L) return; const d = app.doc;
    const col = { fg: app.fg, bg: app.bg, color: vals.color, white: '#fff', black: '#000', gray: '#808080' }[vals.use];
    const m = U.clone(selectionMaskOrAll(d)), mx = U.ctx(m); mx.globalCompositeOperation = 'source-in'; mx.fillStyle = col; mx.fillRect(0, 0, d.w, d.h);
    d.ensureCovers(L); const x = U.ctx(L.canvas); x.save(); x.globalAlpha = vals.opacity / 100; x.globalCompositeOperation = Lr.BLEND[vals.blend]; x.drawImage(m, -L.x, -L.y); x.restore();
    d.touch(L); d.push('Fill');
  };
  C.strokeSel = async () => {
    const d = app.doc; if (!d.sel) { UI.toast('Make a selection first'); return; }
    const vals = await UI.form('Stroke Selection', [
      { key: 'width', label: 'Width', type: 'number', value: 6, min: 1, max: 250, unit: 'px' }, { key: 'color', label: 'Colour', type: 'color', value: app.fg },
      { key: 'loc', label: 'Location', type: 'select', value: 'center', options: [['inside', 'Inside'], ['center', 'Centre'], ['outside', 'Outside']] },
      { key: 'opacity', label: 'Opacity', type: 'range', value: 100, min: 1, max: 100, unit: '%' },
    ], 'Stroke');
    if (!vals) return; const L = requirePixelLayer('Stroke'); if (!L) return;
    const w = +vals.width, s = d.sel.canvas; let outer, inner;
    if (vals.loc === 'inside') { outer = U.clone(s); inner = K.Sel.grow(s, -w); } else if (vals.loc === 'outside') { outer = K.Sel.grow(s, w); inner = U.clone(s); } else { outer = K.Sel.grow(s, w / 2); inner = K.Sel.grow(s, -w / 2); }
    const ox = U.ctx(outer); ox.globalCompositeOperation = 'destination-out'; ox.drawImage(inner, 0, 0); ox.globalCompositeOperation = 'source-in'; ox.fillStyle = vals.color; ox.fillRect(0, 0, d.w, d.h);
    d.ensureCovers(L); const x = U.ctx(L.canvas); x.globalAlpha = vals.opacity / 100; x.drawImage(outer, -L.x, -L.y); x.globalAlpha = 1;
    d.touch(L); d.push('Stroke');
  };
  C.contentFill = async () => {
    const d = app.doc; if (!d.sel) { UI.toast('Select the area to remove first (e.g. with the Lasso)'); return; }
    const L = requirePixelLayer('Content-Aware Fill'); if (!L) return;
    await UI.withBusy('Content-aware fill…', () => {
      d.ensureCovers(L);
      const mask = K.Sel.threshold(K.Sel.grow(d.sel.canvas, 2), 60);
      const b = Lr.alphaBounds(mask); const margin = Math.max(60, Math.max(b.w, b.h));
      const rx = Math.max(0, Math.floor(b.x - margin - L.x)), ry = Math.max(0, Math.floor(b.y - margin - L.y));
      const rw = Math.min(L.canvas.width - rx, Math.ceil(b.w + margin * 2)), rh = Math.min(L.canvas.height - ry, Math.ceil(b.h + margin * 2));
      const crop = U.canvas(rw, rh); U.ctx(crop).drawImage(L.canvas, -rx, -ry);
      K.Inpaint.fillCanvas(crop, mask, rx + L.x, ry + L.y);
      const soft = K.Sel.featherCanvas(mask, 1.5), cx = U.ctx(crop); cx.globalCompositeOperation = 'destination-in'; cx.drawImage(soft, -(rx + L.x), -(ry + L.y));
      U.ctx(L.canvas).drawImage(crop, rx, ry); d.touch(L);
    });
    d.push('Content-Aware Fill');
  };
  C.freeTransform = () => {
    const d = app.doc, L = d.active; if (!L || L.type === 'adjust' || L.type === 'fill') { UI.toast('Select a photo, text or shape layer to transform'); return; }
    if (d.sel && L.type === 'pixel') { C.layerViaCopyForTransform(); }
    else if (L.type === 'pixel') { d.toSmart(L); d.push('Free Transform'); }
    app.setTool('move'); K.tools.move.o.showBox = true; UI.renderOptions();
  };
  C.layerViaCopyForTransform = () => { const d = app.doc, L = d.active; const c = copySelection(false); if (!c) return; clearSelectionPixels(L); const N = Lr.newLayer({ type: 'smart', name: 'Transformed', src: c.canvas, t: { x: c.x + c.w / 2, y: c.y + c.h / 2, sx: 1, sy: 1, rot: 0 } }); d.addLayer(N); K.Sel.none(d); d.push('Free Transform Selection'); };

  // Image
  C.rotate = (deg) => { const d = app.doc; d.rotateAll(deg); d.push(`Rotate ${deg}°`); app.view.fit(); UI.refreshAll(); };
  C.rotateCustom = async () => {
    const v = await UI.form('Rotate Canvas', [{ key: 'deg', label: 'Angle', type: 'number', value: 0, min: -360, max: 360, step: 0.1, unit: '°' }, { key: 'crop', label: 'Crop to remove background', type: 'check', value: false }], 'Rotate');
    if (v && +v.deg) { if (v.crop) app.straighten(+v.deg, true); else C.rotate(+v.deg); }
  };
  C.flipImage = (axis) => { app.doc.flipAll(axis); app.doc.push(axis === 'h' ? 'Flip Horizontal' : 'Flip Vertical'); UI.refreshAll(); };
  C.flipLayer = (axis) => {
    const d = app.doc, L = d.active; if (!L || L.locked) return;
    if (L.type === 'pixel') d.toSmart(L); if (!L.t) return;
    if (axis === 'h') L.t.sx = -L.t.sx; else L.t.sy = -L.t.sy; d.touch(L); d.push('Flip Layer');
  };
  C.imageSize = async () => {
    const d = app.doc, ratio = d.w / d.h;
    const st = { W: d.w, H: d.h, ppi: d.ppi, unit: app.lastUnit() === 'px' ? 'cm' : app.lastUnit(), keep: true, resample: true };
    const pwIn = numIn({ min: 1 }), phIn = numIn({ min: 1 }), dwIn = numIn({}), dhIn = numIn({}), rIn = numIn({ min: 1, max: 2400 });
    const keep = el('input', { type: 'checkbox', checked: true }), resample = el('input', { type: 'checkbox', checked: true });
    const sel = unitSel(st.unit, (u) => { st.unit = u; K.prefs.sizeUnit = u; savePrefs(); refresh(); });
    const dhUnit = el('em', {}, st.unit); sel.addEventListener('change', () => { dhUnit.textContent = st.unit; });
    const before = el('em', {}, `Was ${d.w} × ${d.h} px at ${d.ppi} ppi`);
    const refresh = (skip) => {
      if (skip !== pwIn) pwIn.value = Math.round(st.W); if (skip !== phIn) phIn.value = Math.round(st.H);
      if (skip !== dwIn) showVal(dwIn, st.W, st.unit, st.ppi); if (skip !== dhIn) showVal(dhIn, st.H, st.unit, st.ppi);
      if (skip !== rIn) rIn.value = +st.ppi.toFixed(2);
      pwIn.disabled = phIn.disabled = !st.resample;
    };
    const setW = (W, skip) => { st.W = W; if (st.keep) st.H = W / ratio; refresh(skip); };
    const setH = (H, skip) => { st.H = H; if (st.keep) st.W = H * ratio; refresh(skip); };
    pwIn.oninput = () => setW(+pwIn.value || 1, pwIn);
    phIn.oninput = () => setH(+phIn.value || 1, phIn);
    // Document (print) size: with resampling the pixel count changes; without it the resolution changes instead.
    dwIn.oninput = () => { const v = +dwIn.value; if (!v) return; if (st.resample) setW(U.fromUnit(v, st.unit, st.ppi), dwIn); else { st.ppi = st.W / U.toUnit(U.fromUnit(v, st.unit, 1), 'in', 1); refresh(dwIn); } };
    dhIn.oninput = () => { const v = +dhIn.value; if (!v) return; if (st.resample) setH(U.fromUnit(v, st.unit, st.ppi), dhIn); else { st.ppi = st.H / U.toUnit(U.fromUnit(v, st.unit, 1), 'in', 1); refresh(dhIn); } };
    rIn.oninput = () => { const r = +rIn.value; if (!r) return; if (st.resample) { st.W *= r / st.ppi; st.H *= r / st.ppi; } st.ppi = r; refresh(rIn); };
    keep.onchange = () => { st.keep = keep.checked; };
    resample.onchange = () => { st.resample = resample.checked; if (!st.resample) { st.W = d.w; st.H = d.h; keep.checked = st.keep = true; } refresh(); };
    refresh();
    const body = el('div', { class: 'form' },
      el('div', { class: 'fhead' }, 'Pixel dimensions'), frow('Width', pwIn, el('em', {}, 'px')), frow('Height', phIn, el('em', {}, 'px')),
      el('div', { class: 'fhead' }, 'Document size'), frow('Width', dwIn, sel), frow('Height', dhIn, dhUnit), frow('Resolution', rIn, el('em', {}, 'pixels/inch')),
      el('label', { class: 'frow check' }, el('span', {}, ''), keep, el('span', {}, 'Constrain proportions')),
      el('label', { class: 'frow check' }, el('span', {}, ''), resample, el('span', {}, 'Resample image')), before);
    if (!await UI.modal({ title: 'Image Size', body, buttons: [['Cancel', false], ['OK', true]], width: 400 })) return;
    const W = U.clamp(Math.round(st.W), 1, 30000), H = U.clamp(Math.round(st.H), 1, 30000), ppi = Math.round(st.ppi * 100) / 100;
    if (W !== d.w || H !== d.h) await UI.withBusy('Resizing…', () => d.resizeAll(W, H));
    d.ppi = ppi; d.push('Image Size'); app.view.fit(); UI.refreshAll();
  };
  C.canvasSize = async () => {
    const d = app.doc; let anchor = [1, 1];
    const grid = el('div', { class: 'anchor-grid' });
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) { const b = el('button', { class: x === 1 && y === 1 ? 'on' : '' }); b.onclick = (e) => { e.preventDefault(); anchor = [x, y]; grid.querySelectorAll('button').forEach((q) => q.classList.remove('on')); b.classList.add('on'); }; grid.append(b); }
    const st = { W: d.w, H: d.h, unit: app.lastUnit() }, wIn = numIn({}), hIn = numIn({}), rel = el('input', { type: 'checkbox' }), col = el('input', { type: 'color', value: app.bg });
    const cur = el('em', {}, `Current: ${U.fmtUnit(d.w, st.unit, d.ppi)} × ${U.fmtUnit(d.h, st.unit, d.ppi)}`);
    const refresh = (skip) => { const r = rel.checked; if (skip !== wIn) showVal(wIn, r ? st.W - d.w : st.W, st.unit, d.ppi); if (skip !== hIn) showVal(hIn, r ? st.H - d.h : st.H, st.unit, d.ppi); cur.textContent = `Current: ${U.fmtUnit(d.w, st.unit, d.ppi)} × ${U.fmtUnit(d.h, st.unit, d.ppi)}  ·  new ${Math.round(st.W)} × ${Math.round(st.H)} px`; };
    const sel = unitSel(st.unit, (u) => { st.unit = u; K.prefs.sizeUnit = u; savePrefs(); refresh(); });
    wIn.oninput = () => { st.W = U.fromUnit(+wIn.value || 0, st.unit, d.ppi) + (rel.checked ? d.w : 0); refresh(wIn); };
    hIn.oninput = () => { st.H = U.fromUnit(+hIn.value || 0, st.unit, d.ppi) + (rel.checked ? d.h : 0); refresh(hIn); };
    rel.onchange = () => refresh(); refresh();
    const body = el('div', { class: 'form' }, cur, frow('Width', wIn, sel), frow('Height', hIn), el('label', { class: 'frow check' }, el('span', {}, ''), rel, el('span', {}, 'Relative')),
      el('div', { class: 'frow' }, el('span', {}, 'Anchor'), grid), frow('Extension colour', col));
    if (!await UI.modal({ title: 'Canvas Size', body, buttons: [['Cancel', false], ['Resize Canvas', true]], width: 400 })) return;
    const v = { color: col.value };
    const W = U.clamp(Math.round(st.W), 1, 30000), H = U.clamp(Math.round(st.H), 1, 30000), dx = Math.round((W - d.w) * anchor[0] / 2), dy = Math.round((H - d.h) * anchor[1] / 2);
    const bg = d.layers[0];
    d.translateAll(dx, dy, W, H);
    if (bg && bg.type === 'pixel' && bg.name === 'Background') {
      const c = U.canvas(W, H), x = U.ctx(c); x.fillStyle = v.color; x.fillRect(0, 0, W, H); x.drawImage(bg.canvas, bg.x, bg.y); bg.canvas = c; bg.x = 0; bg.y = 0; d.touch(bg);
    }
    d.push('Canvas Size'); app.view.fit(); UI.refreshAll();
  };
  C.cropToSel = () => { const d = app.doc; if (!d.sel) { UI.toast('Make a selection first'); return; } const b = d.sel.bounds; d.translateAll(-b.x, -b.y, b.w, b.h); d.push('Crop to Selection'); app.view.fit(); UI.refreshAll(); };
  C.trim = () => { const d = app.doc, b = Lr.alphaBounds(d.composite()); if (!b) return; d.translateAll(-b.x, -b.y, b.w, b.h); d.push('Trim'); app.view.fit(); UI.refreshAll(); };
  C.auto = async (kind) => {
    const L = requirePixelLayer('Auto fix'); if (!L) return; const op = layerOp(L);
    const label = { smartfix: 'Auto Smart Fix', levels: 'Auto Levels', contrast: 'Auto Contrast', color: 'Auto Colour', redeye: 'Auto Red Eye' }[kind];
    await UI.withBusy(label + '…', () => op.run((data) => K.Adjust.auto(kind, data))); op.commit(label);
  };
  C.filterQuick = async (kind) => { const L = requirePixelLayer('Sharpen'); if (!L) return; const op = layerOp(L); await UI.withBusy('Sharpening…', () => op.run((data) => K.Filters.run(kind, data, { amount: 70, radius: 1.2, threshold: 3 }))); op.commit('Auto Sharpen'); };
  C.adjust = (kind) => adjustDialog(kind);
  C.adjustNow = async (kind) => { const L = requirePixelLayer('Adjustment'); if (!L) return; const op = layerOp(L); op.run((data) => K.Adjust.apply(kind, {}, data)); op.commit(K.Adjust.defs[kind].title); };
  C.filter = (kind) => filterDialog(kind);

  // Layers
  C.newLayer = () => { const d = app.doc; d.addPixelLayer(); d.push('New Layer'); };
  C.newAdjLayer = (kind) => {
    const d = app.doc; const L = Lr.newLayer({ type: 'adjust', name: K.Adjust.defs[kind].title, adj: { kind, params: K.Adjust.defaults(kind) } });
    if (d.sel) { L.mask = U.clone(d.sel.canvas); }
    d.addLayer(L); d.push('New Adjustment Layer'); UI.ptab = 'layers'; UI.buildPanels();
  };
  C.newFillLayer = async () => {
    const v = await UI.form('New Fill Layer', [{ key: 'color', label: 'Colour', type: 'color', value: app.fg }, { key: 'name', label: 'Name', value: 'Colour Fill' }], 'Create');
    if (!v) return; const d = app.doc; const L = Lr.newLayer({ type: 'fill', name: v.name, color: v.color });
    if (d.sel) L.mask = U.clone(d.sel.canvas);
    d.addLayer(L); d.push('New Fill Layer');
  };
  C.dupLayer = () => { const d = app.doc, L = d.active; if (!L) return; if (d.sel && L.type === 'pixel') { C.layerViaCopy(); return; } K.ToolHelpers.duplicateLayer(d, L); d.push('Duplicate Layer'); };
  C.layerViaCopy = () => { const d = app.doc; const c = copySelection(false); if (!c) return; const L = Lr.newLayer({ name: d.nextName('Layer'), canvas: U.canvas(d.w, d.h), x: 0, y: 0 }); U.ctx(L.canvas).drawImage(c.canvas, c.x, c.y); d.addLayer(L); d.push('Layer via Copy'); };
  C.layerViaCut = () => { const d = app.doc; const P = requirePixelLayer('Layer via Cut'); if (!P || !d.sel) { if (!d.sel) UI.toast('Make a selection first'); return; } const c = copySelection(false); clearSelectionPixels(P); const L = Lr.newLayer({ name: d.nextName('Layer'), canvas: U.canvas(d.w, d.h), x: 0, y: 0 }); U.ctx(L.canvas).drawImage(c.canvas, c.x, c.y); d.addLayer(L); d.push('Layer via Cut'); };
  C.deleteLayer = () => { const d = app.doc, L = d.active; if (!L) return; if (d.layers.length === 1) { UI.toast('A document needs at least one layer'); return; } d.removeLayer(L); d.push('Delete Layer'); };
  C.addMask = () => { const d = app.doc, L = d.active; if (!L) return; if (L.mask) { app.editMask = true; UI.refreshLayers(); return; } if (d.sel) return C.maskFromSel(); const m = U.canvas(d.w, d.h), x = U.ctx(m); x.fillStyle = '#fff'; x.fillRect(0, 0, d.w, d.h); L.mask = m; app.editMask = true; d.touch(L); d.push('Add Layer Mask'); UI.toast('Mask added — paint with black to hide, white to reveal'); };
  C.maskFromSel = () => { const d = app.doc, L = d.active; if (!L || !d.sel) { UI.toast('Make a selection first'); return; } L.mask = U.clone(d.sel.canvas); app.editMask = true; K.Sel.none(d); d.touch(L); d.push('Mask from Selection'); };
  C.applyMask = () => { const d = app.doc, L = d.active; if (!L || !L.mask) return; const P = requirePixelLayer('Apply mask'); if (!P) return; d.ensureCovers(P); const x = U.ctx(P.canvas); x.globalCompositeOperation = 'destination-in'; x.drawImage(P.mask, -P.x, -P.y); x.globalCompositeOperation = 'source-over'; P.mask = null; app.editMask = false; d.touch(P); d.push('Apply Layer Mask'); };
  C.deleteMask = () => { const d = app.doc, L = d.active; if (!L || !L.mask) return; L.mask = null; app.editMask = false; d.touch(L); d.push('Delete Layer Mask'); };
  C.clipOn = () => { const L = app.doc.active; if (L && !L.clip) C.clip(); };
  C.clipOff = () => { const L = app.doc.active; if (L && L.clip) C.clip(); };
  C.clip = () => { const d = app.doc, L = d.active; if (!L) return; if (d.layerIndex(L) === 0) { UI.toast('The bottom layer cannot be clipped'); return; } L.clip = !L.clip; d.touch(L); d.changed(); d.push(L.clip ? 'Create Clipping Mask' : 'Release Clipping Mask'); };
  C.rasterize = () => { const d = app.doc, L = d.active; if (!L || L.type === 'pixel') return; d.rasterize(L); d.push('Rasterize Layer'); };
  C.layerStyle = async (kind) => {
    const d = app.doc, L = d.active; if (!L || L.type === 'adjust') return;
    if (kind === 'clear') { L.style = null; d.touch(L); d.push('Clear Layer Style'); return; }
    const before = L.style ? JSON.parse(JSON.stringify(L.style)) : null;
    L.style = L.style || {};
    const defs = {
      shadow: { title: 'Drop Shadow', p: { on: true, color: '#000000', opacity: 60, angle: 120, distance: 12, blur: 14 }, c: [['color', 'Colour', 'color'], ['opacity', 'Opacity', 0, 100], ['angle', 'Angle', -180, 180], ['distance', 'Distance', 0, 300], ['blur', 'Softness', 0, 150]] },
      glow: { title: 'Outer Glow', p: { on: true, color: '#fff6a8', opacity: 75, size: 18 }, c: [['color', 'Colour', 'color'], ['opacity', 'Opacity', 0, 100], ['size', 'Size', 1, 150]] },
      stroke: { title: 'Stroke', p: { on: true, color: '#ffffff', opacity: 100, size: 4 }, c: [['color', 'Colour', 'color'], ['opacity', 'Opacity', 0, 100], ['size', 'Size', 1, 60]] },
    }[kind];
    const p = Object.assign({}, defs.p, L.style[kind] || {}, { on: true }); L.style[kind] = p;
    const upd = () => { d.touch(L); app.view.requestRender(); };
    const def = { controls: defs.c.map(([key, label, a, b]) => a === 'color' ? { key, label, type: 'color', def: p[key] } : { key, label, type: 'range', min: a, max: b, def: p[key] }) };
    upd();
    const body = el('div'); UI.controls(body, def, p, upd);
    const ok = await UI.modal({ title: 'Layer Style: ' + defs.title, body });
    if (ok) d.push(defs.title); else { L.style = before; upd(); }
  };
  C.arrange = (dir) => {
    const d = app.doc, L = d.active; if (!L) return; const i = d.layerIndex(L), n = d.layers.length;
    const j = { up: Math.min(n - 1, i + 1), down: Math.max(0, i - 1), front: n - 1, back: 0 }[dir]; if (j === i) return;
    d.layers.splice(i, 1); d.layers.splice(j, 0, L); d.changed(); d.push('Arrange Layer');
  };
  C.align = (edge) => {
    const d = app.doc, L = d.active; if (!L || L.type === 'adjust' || L.type === 'fill') return;
    const b = Lr.contentBounds(L); if (!b) return; const ref = d.sel ? d.sel.bounds : { x: 0, y: 0, w: d.w, h: d.h };
    let dx = 0, dy = 0;
    if (edge === 'left') dx = ref.x - b.x; if (edge === 'right') dx = ref.x + ref.w - (b.x + b.w); if (edge === 'hcenter') dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
    if (edge === 'top') dy = ref.y - b.y; if (edge === 'bottom') dy = ref.y + ref.h - (b.y + b.h); if (edge === 'vcenter') dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
    if (L.type === 'pixel') { L.x += Math.round(dx); L.y += Math.round(dy); } else { L.t.x += dx; L.t.y += dy; }
    d.touch(L); d.push('Align'); UI.updateTransformFields();
  };
  C.mergeDown = () => {
    const d = app.doc, L = d.active, i = d.layerIndex(L); if (i <= 0) { UI.toast('There is no layer below to merge into'); return; }
    const below = d.layers[i - 1];
    const lower = Object.assign({}, below, { opacity: 1, blend: 'normal', v: below.v });
    const M = mergeLayers([lower, L], below.name); M.opacity = below.opacity; M.blend = below.blend;
    d.layers.splice(i - 1, 2, M); d.activeId = M.id; d.changed(); d.push('Merge Down');
  };
  C.mergeVisible = () => { const d = app.doc; const vis = d.layers.filter((l) => l.visible); const M = mergeLayers(d.layers, 'Merged'); d.layers = d.layers.filter((l) => !l.visible); d.layers.push(M); d.activeId = M.id; d.changed(); d.push('Merge Visible'); void vis; };
  C.mergeAdjust = (id) => { const d = app.doc, i = d.layers.findIndex((l) => l.id === id); if (i < 0) return; const M = mergeLayers(d.layers.slice(0, i + 1), d.layers[0].name); d.layers.splice(0, i + 1, M); d.activeId = M.id; d.changed(); d.push('Apply Quick Fix'); UI.renderPanel(); };
  C.flatten = () => { const d = app.doc; const c = d.compositeLayers(d.layers, { background: '#ffffff' }); const M = Lr.newLayer({ name: 'Background', canvas: c, x: 0, y: 0 }); d.layers = [M]; d.activeId = M.id; d.changed(); d.push('Flatten Image'); };

  // Select
  C.selectAll = () => { K.Sel.all(app.doc); app.doc.push('Select All'); };
  C.deselect = () => { if (!app.doc.sel) return; app.doc.lastSel = app.doc.sel; K.Sel.none(app.doc); app.doc.push('Deselect'); };
  C.reselect = () => { const d = app.doc; if (!d.lastSel) return; d.sel = d.lastSel; d.emit('selection'); d.push('Reselect'); };
  C.invertSel = () => { K.Sel.invert(app.doc); app.doc.push('Inverse Selection'); };
  C.selectSubject = async () => { const d = app.doc; await UI.withBusy('Finding the subject…', () => { const m = K.Sel.subjectMask(d, d.composite()); K.Sel.combine(d, m, 'new'); }); d.push('Select Subject'); if (!d.sel) UI.toast('No clear subject found — try Quick Selection'); else UI.toast('Subject selected — refine with Quick Selection (Alt to subtract)'); };
  C.colorRange = async () => {
    const d = app.doc, before = d.sel, src = d.composite(), p = { fuzz: 40, color: app.fg };
    const upd = U.debounce(() => { d.sel = before; K.Sel.colorRange(d, src, U.hexToRgb(p.color), p.fuzz, 'new'); app.view.requestRender(); }, 80);
    const body = el('div'); UI.controls(body, { controls: [{ key: 'color', label: 'Colour to select', type: 'color' }, { key: 'fuzz', label: 'Fuzziness', type: 'range', min: 1, max: 200 }] }, p, upd);
    body.append(el('p', { class: 'hint' }, 'Tip: pick the colour with the Eyedropper first — it becomes the foreground colour.'));
    upd(); const ok = await UI.modal({ title: 'Colour Range', body });
    if (ok) d.push('Colour Range'); else { d.sel = before; d.emit('selection'); }
  };
  const selAmount = async (title, def) => { const v = await UI.form(title, [{ key: 'r', label: 'Amount', type: 'number', value: def, min: 0.5, max: 250, step: 0.5, unit: 'px' }]); return v ? +v.r : null; };
  C.featherSel = async () => { const d = app.doc; if (!d.sel) return; const r = await selAmount('Feather Selection', 10); if (r) { K.Sel.feather(d, r); d.push('Feather'); } };
  C.growSel = async (dir) => { const d = app.doc; if (!d.sel) return; const r = await selAmount(dir > 0 ? 'Expand Selection' : 'Contract Selection', 5); if (r) { K.Sel.grow(d, r * dir); d.push(dir > 0 ? 'Expand' : 'Contract'); } };
  C.smoothSel = async () => { const d = app.doc; if (!d.sel) return; const r = await selAmount('Smooth Selection', 4); if (r) { K.Sel.smooth(d, r); d.push('Smooth'); } };
  C.borderSel = async () => { const d = app.doc; if (!d.sel) return; const r = await selAmount('Border Selection', 10); if (r) { K.Sel.border(d, r); d.push('Border'); } };
  C.selFromLayer = () => { const d = app.doc; if (!d.active) return; K.Sel.fromLayer(d, d.active); d.push('Select Layer Pixels'); };

  // View
  C.zoom = (a) => { if (a === 0) app.view.fit(); else if (a === 100) app.view.setZoom(1); else app.view.zoomStep(a); UI.refreshTabs(); UI.updateInfo(); };
  C.toggleGrid = () => { app.view.showGrid = !app.view.showGrid; app.view.requestRender(); };
  C.toggleRulers = () => { app.view.showRulers = !app.view.showRulers; app.view.requestRender(); };
  C.toggleSnap = () => { K.tools.move.o.snap = !K.tools.move.o.snap; UI.toast('Snapping ' + (K.tools.move.o.snap ? 'on' : 'off')); UI.renderOptions(); };
  C.clearGuides = () => { if (!app.doc.guides.length) return; app.doc.guides = []; app.doc.push('Clear Guides'); app.view.requestRender(); };
  C.setUnits = (u) => { K.prefs.rulerUnits = u; savePrefs(); app.view.requestRender(); UI.updateStatus(); UI.toast('Ruler units: ' + (UNIT_OPTS.find((q) => q[0] === u) || [u, u])[1]); };
  C.resetOrigin = () => { app.doc.origin = [0, 0]; app.doc.push('Reset Ruler Origin'); app.view.requestRender(); };
  C.lockGuides = () => { K.prefs.lockGuides = !K.prefs.lockGuides; savePrefs(); UI.toast(K.prefs.lockGuides ? 'Guides locked' : 'Guides unlocked'); };
  // position of a guide expressed in units, measured from the ruler origin
  const guideToUnit = (d, axis, pos, u) => U.toUnit(pos - d.origin[axis === 'v' ? 0 : 1], u, d.ppi);
  const unitToGuide = (d, axis, val, u) => Math.round(U.fromUnit(val, u, d.ppi) + d.origin[axis === 'v' ? 0 : 1]);
  C.newGuide = async (edit) => {
    const d = app.doc; if (!d) return; const g = edit && edit.axis ? edit : null;
    let unit = app.view.unit();
    const ori = el('select', {}, [['v', 'Vertical'], ['h', 'Horizontal']].map(([v, l]) => el('option', { value: v, selected: g ? g.axis === v : v === 'v' }, l)));
    const pos = numIn({ value: g ? +guideToUnit(d, g.axis, g.pos, unit).toFixed(U.unitDigits(unit)) : 0, min: -100000 });
    const sel = unitSel(unit, (u) => { const v = guideToUnit(d, ori.value, unitToGuide(d, ori.value, +pos.value || 0, unit), u); unit = u; pos.value = +v.toFixed(U.unitDigits(u)); });
    const body = el('div', { class: 'form' }, frow('Orientation', ori), frow('Position', pos, sel), el('em', {}, 'Measured from the ruler zero point. Tip: drag from a ruler to add a guide, Shift snaps to ruler ticks.'));
    const buttons = g ? [['Delete Guide', 'delete'], ['Cancel', false], ['OK', true]] : [['Cancel', false], ['OK', true]];
    const r = await UI.modal({ title: g ? 'Edit Guide' : 'New Guide', body, buttons, width: 380 }); if (!r) return;
    if (r === 'delete') { d.guides.splice(d.guides.indexOf(g), 1); d.push('Delete Guide'); }
    else { const p2 = unitToGuide(d, ori.value, +pos.value || 0, unit); if (g) { g.axis = ori.value; g.pos = p2; d.push('Move Guide'); } else { d.guides.push({ axis: ori.value, pos: p2 }); d.push('New Guide'); } }
    app.view.hideGuides = false; app.view.requestRender();
  };
  C.guideLayout = async () => {
    const d = app.doc; if (!d) return; let unit = app.view.unit() === 'px' ? 'px' : 'mm';
    const f = (v) => numIn({ value: v, min: 0 });
    const cols = f(3), colW = f(''), gutC = f(unit === 'px' ? 20 : 5), rows = f(0), rowH = f(''), gutR = f(unit === 'px' ? 20 : 5);
    const mT = f(unit === 'px' ? 40 : 10), mL = f(unit === 'px' ? 40 : 10), mB = f(unit === 'px' ? 40 : 10), mR = f(unit === 'px' ? 40 : 10);
    const clear = el('input', { type: 'checkbox', checked: true }), centre = el('input', { type: 'checkbox' });
    const sel = unitSel(unit, (u) => { unit = u; });
    colW.placeholder = rowH.placeholder = 'auto';
    const grid4 = (...kids) => el('div', { class: 'guide-margins' }, ...kids);
    const body = el('div', { class: 'form' }, frow('Units', sel),
      el('div', { class: 'fhead' }, 'Columns'), frow('Number', cols), frow('Width', colW), frow('Gutter', gutC),
      el('div', { class: 'fhead' }, 'Rows'), frow('Number', rows), frow('Height', rowH), frow('Gutter', gutR),
      el('div', { class: 'fhead' }, 'Margins'), grid4(el('label', {}, el('span', {}, 'Top'), mT), el('label', {}, el('span', {}, 'Left'), mL), el('label', {}, el('span', {}, 'Bottom'), mB), el('label', {}, el('span', {}, 'Right'), mR)),
      el('label', { class: 'frow check' }, el('span', {}, ''), centre, el('span', {}, 'Centre columns')),
      el('label', { class: 'frow check' }, el('span', {}, ''), clear, el('span', {}, 'Clear existing guides')));
    if (!await UI.modal({ title: 'New Guide Layout', body, buttons: [['Cancel', false], ['OK', true]], width: 400 })) return;
    const px = (i) => U.fromUnit(+i.value || 0, unit, d.ppi), out = [];
    const make = (axis, n, size, gut, m0, m1, len, centred) => {
      const add = (p) => out.push({ axis, pos: Math.round(p) });
      const inner = len - m0 - m1; if (inner <= 0) return;
      if (m0 > 0) add(m0); if (m1 > 0) add(len - m1);
      if (n < 1) return;
      const w = size > 0 ? size : (inner - gut * (n - 1)) / n; if (w <= 0) return;
      const total = w * n + gut * (n - 1); let x = m0 + (centred && size > 0 ? (inner - total) / 2 : 0);
      for (let i = 0; i < n; i++) { add(x); add(x + w); x += w + gut; }
    };
    make('v', Math.round(+cols.value || 0), px(colW), px(gutC), px(mL), px(mR), d.w, centre.checked);
    make('h', Math.round(+rows.value || 0), px(rowH), px(gutR), px(mT), px(mB), d.h, false);
    if (clear.checked) d.guides = [];
    for (const g of out) if (!d.guides.some((q) => q.axis === g.axis && Math.abs(q.pos - g.pos) < 0.5)) d.guides.push(g);
    d.push('New Guide Layout'); app.view.hideGuides = false; app.view.requestRender();
  };
  C.swapColors = () => { [app.fg, app.bg] = [app.bg, app.fg]; UI.refreshColors(); };
  C.resetColors = () => { app.fg = '#000000'; app.bg = '#ffffff'; UI.refreshColors(); };
  C.preferences = async () => {
    const P = K.prefs;
    const v = await UI.form('Preferences', [
      { type: 'html', node: el('div', { class: 'fhead' }, 'General') },
      { key: 'historyLimit', label: 'History states', type: 'number', value: P.historyLimit, min: 5, max: 200 },
      { type: 'html', node: el('div', { class: 'fhead' }, 'Units & Rulers') },
      { key: 'rulerUnits', label: 'Rulers', type: 'select', value: P.rulerUnits, options: UNIT_OPTS.concat([['pt', 'Points']]) },
      { key: 'newPpi', label: 'New document resolution', type: 'number', value: P.newPpi, min: 1, max: 2400, unit: 'ppi' },
      { type: 'html', node: el('div', { class: 'fhead' }, 'Guides & Grid') },
      { key: 'guideColor', label: 'Guide colour', type: 'color', value: P.guideColor },
      { key: 'guideStyle', label: 'Guide style', type: 'select', value: P.guideStyle, options: [['lines', 'Lines'], ['dashed', 'Dashed lines']] },
      { key: 'gridEvery', label: 'Gridline every', type: 'number', value: P.gridEvery, min: 0.01, max: 10000, step: 'any' },
      { key: 'gridUnit', label: 'Grid units', type: 'select', value: P.gridUnit, options: UNIT_OPTS },
      { key: 'gridSubdiv', label: 'Subdivisions', type: 'number', value: P.gridSubdiv, min: 1, max: 100 },
    ], 'Save', 400);
    if (!v) return;
    Object.assign(P, { historyLimit: +v.historyLimit, rulerUnits: v.rulerUnits, newPpi: +v.newPpi || 300, guideColor: v.guideColor, guideStyle: v.guideStyle, gridEvery: +v.gridEvery || 2, gridUnit: v.gridUnit, gridSubdiv: Math.max(1, Math.round(+v.gridSubdiv || 1)) });
    savePrefs(); app.view.requestRender(); UI.updateStatus();
  };
  C.shortcuts = () => {
    const groups = {}; K.TOOL_ORDER.flat().forEach((id) => { const t = K.tools[id]; (groups[t.hotkey] = groups[t.hotkey] || []).push(t.name); });
    const rows = [['Tools', Object.entries(groups).map(([k, n]) => `${k.toUpperCase()} — ${n.join(', ')}`).join('<br>') + '<br>Shift + letter cycles tools that share a key'],
      ['File', '⌘N new · ⌘O open · ⌘S save · ⇧⌘S save as · ⌥⇧⌘S export · ⌘W close'],
      ['Edit', '⌘Z undo · ⌘Y or ⇧⌘Z redo · ⌥⌘Z step backward · ⌘X/⌘C/⌘V · ⇧⌘C copy merged'],
      ['Fill', '⌥Delete foreground · ⌘Delete background · ⇧Delete Fill dialog · Delete clears selection'],
      ['Enhance', '⌥⌘M Auto Smart Fix · ⇧⌘M Adjust Smart Fix · ⇧⌘L Auto Levels · ⌥⇧⌘L Auto Contrast · ⇧⌘B Auto Colour · ⌘R Auto Red Eye · ⌘L Levels · ⌘U Hue/Saturation · ⇧⌘U Remove Colour · ⌘I Invert'],
      ['Image', '⌘T Free Transform · ⌥⌘I Resize · ⌥⌘C Canvas Size'],
      ['Layer', '⇧⌘N new · ⌘J via copy · ⇧⌘J via cut · ⌘G / ⇧⌘G clipping mask · ⌘E merge down · ⇧⌘E merge visible · ⌘] / ⌘[ arrange (⇧ for front/back) · / lock transparent pixels'],
      ['Select', '⌘A all · ⌘D deselect · ⇧⌘D reselect · ⇧⌘I inverse · ⌥⌘D feather · Shift add · ⌥ subtract · ⇧⌥ intersect · Shift/⌥ with no selection = constrain/centre · Space-drag repositions'],
      ['View', '⌘= / ⌘− zoom · ⌘0 fit · ⌥⌘0 actual pixels · ⇧⌘R rulers · ⌘\' grid · ⌘; guides · ⇧⌘; snap · ⌥⌘; lock guides · drag from a ruler for a guide (⌥ swaps direction, ⇧ snaps to ticks) · drag a guide back to the ruler to delete · drag the ruler corner to move zero, double-click to reset · right-click a ruler for units · Page Up/Down, Home/End scroll · ⌃Tab next document'],
      ['Panels', 'Tab hide all · F4 tool options · F5 photo bin · ⌥F9/⌥F12 info · ⌥F10 history · ⌥F11 layers'],
      ['Painting', '[ / ] size · Shift+[ / ] hardness 25% · , / . previous/next size (Shift = first/last) · 1–0 opacity (two quick digits = exact) · Shift + / − blend mode · ⌥ eyedropper · Shift-click straight line · Caps Lock precise cursor'],
      ['Navigation', 'Space hand · Space+⌘ click zoom in · Space+⌥ click zoom out · hold ⌘ for Move tool · arrows nudge (Shift = 10 px) · ⌘arrows move layer'],
      ['Type', '⇧⌘L / C / R align · ⇧⌘U underline · ⇧⌘< / > size · ⇧⌘Y plain · ⌘Return or Esc commit'],
      ['Healing &amp; Clone', '⌥-click places the source marker · ⌥-drag moves it · Spot Healing switches to Source point when you ⌥-click · Aligned keeps the source following your brush'],
      ['Crop', 'Return apply · Esc cancel · / toggle shield'], ['Colours', 'D default · X swap']];
    UI.modal({ title: 'Keyboard Shortcuts', width: 680, buttons: [['Close', true]], body: el('div', { class: 'shortcuts', html: rows.map(([a, b]) => `<div><b>${a}</b><span>${b}</span></div>`).join('') }) });
  };

  // ---------- tools ----------
  app.setTool = (id) => {
    const t = K.tools[id]; if (!t) return;
    if (app.tool && app.tool !== t && app.tool.deactivate) app.tool.deactivate();
    app.tool = t; if (t.activate) t.activate();
    if (t.hotkey) { app.lastInGroup = app.lastInGroup || {}; app.lastInGroup[t.hotkey] = id; }
    app.view.c.style.cursor = t.cursor || 'default';
    UI.refreshToolbar(); UI.renderOptions(); app.view.requestRender();
  };

  // ---------- input ----------
  function bindInput() {
    const v = app.view, c = v.c; let spaceDown = false, panning = null, guideDrag = null, originDrag = false, downTool = null;
    const guideAt = (p) => { const d = app.doc, thr = 4 / d.view.zoom; let best = null, bd = thr; for (const q of d.guides) { const dd = Math.abs((q.axis === 'v' ? p[0] : p[1]) - q.pos); if (dd <= bd) { bd = dd; best = q; } } return best; };
    // Shift while dragging a guide or the ruler origin snaps it to the nearest ruler tick
    const tickSnap = (val, axisIdx) => { const d = app.doc, unitPx = U.pxPerUnit(v.unit(), d.ppi), z = d.view.zoom, o = d.origin[axisIdx];
      const nice = [0.01, 0.02, 0.05, 0.1, 0.125, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
      const minor = (nice.find((s) => s * unitPx * z >= 56) || 1000) / 10, step = nice.find((s) => s >= minor * 0.999) || minor;
      return Math.round(o + Math.round((val - o) / unitPx / step) * step * unitPx); };
    // Marquees, crop and shapes snap to guides, document edges and the grid when snapping is on
    const SNAP_TOOLS = ['marquee', 'ellipse', 'crop', 'shape'];
    const snapP = (tool, p) => {
      if (!K.tools.move.o.snap || !tool || !SNAP_TOOLS.includes(tool.id)) return p;
      const d = app.doc, thr = 6 / d.view.zoom, out = p.slice();
      const xs = [0, d.w], ys = [0, d.h];
      if (!v.hideGuides) for (const g of d.guides) (g.axis === 'v' ? xs : ys).push(g.pos);
      if (v.showGrid) { const P = K.prefs, st = Math.max(2, (P.gridEvery || 2) * U.pxPerUnit(P.gridUnit || 'cm', d.ppi)); for (const [arr, o, i] of [[xs, d.origin[0], 0], [ys, d.origin[1], 1]]) arr.push(o + Math.round((p[i] - o) / st) * st); }
      let bx = thr, by = thr;
      for (const t of xs) { const dd = Math.abs(p[0] - t); if (dd < bx) { bx = dd; out[0] = t; } }
      for (const t of ys) { const dd = Math.abs(p[1] - t); if (dd < by) { by = dd; out[1] = t; } }
      return out;
    };
    const edgeSnap = (val, axis) => { if (!K.tools.move.o.snap) return val; const d = app.doc, lim = axis === 'v' ? d.w : d.h, thr = 6 / d.view.zoom; for (const t of [0, lim / 2, lim]) if (Math.abs(val - t) < thr) return Math.round(t); return val; };
    const pt = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    c.addEventListener('pointerdown', (e) => {
      if (!app.doc) return; UI.closeFlyouts(); if (document.activeElement && document.activeElement.blur && document.activeElement.id !== 'text-editor') document.activeElement.blur();
      const [sx, sy] = pt(e), p = v.toDoc(sx, sy);
      c.setPointerCapture(e.pointerId);
      if (spaceDown && (e.metaKey || e.ctrlKey || e.altKey) && e.button === 0) { v.zoomStep(e.altKey ? -1 : 1, sx, sy); UI.refreshTabs(); UI.updateInfo(); return; }
      if (spaceDown || e.button === 1) { panning = { sx, sy, px: app.doc.view.panX, py: app.doc.view.panY }; c.style.cursor = 'grabbing'; return; }
      if (e.button === 2) return;
      if (v.inCorner(sx, sy)) { originDrag = true; v.originDrag = [Math.round(p[0]), Math.round(p[1])]; v.requestRender(); return; }
      const ruler = v.inRuler(sx, sy);
      if (ruler) {
        // the top ruler makes horizontal guides, the left one vertical; hold Alt to swap
        let axis = ruler === 'h' ? 'h' : 'v'; if (e.altKey) axis = axis === 'h' ? 'v' : 'h';
        guideDrag = { axis, pos: Math.round(axis === 'h' ? p[1] : p[0]) }; app.doc.guides.push(guideDrag); v.guideDrag = guideDrag; v.requestRender(); return;
      }
      const g = guideAt(p);
      if (g && (app.tool.id === 'move' || e.metaKey) && !K.prefs.lockGuides && !v.hideGuides) { guideDrag = g; v.guideDrag = g; v.requestRender(); return; }
      downTool = app.tool;
      // Holding ⌘ temporarily switches to the Move tool (not for Hand, Zoom, Move, shapes, crop or text editing)
      if (e.metaKey && !['move', 'hand', 'zoom', 'shape', 'crop', 'text'].includes(app.tool.id)) { downTool = K.tools.move; downTool.down(e, p, sx, sy); return; }
      if (app.tool.down) app.tool.down(e, snapP(app.tool, p), sx, sy);
    });
    c.addEventListener('pointermove', (e) => {
      if (!app.doc) return; const [sx, sy] = pt(e), p = v.toDoc(sx, sy);
      v.cursorPos = p; hoverInfo(p);
      if (panning) { app.doc.view.panX = panning.px + sx - panning.sx; app.doc.view.panY = panning.py + sy - panning.sy; v.requestRender(); return; }
      if (originDrag) { v.originDrag = e.shiftKey ? [tickSnap(p[0], 0), tickSnap(p[1], 1)] : [edgeSnap(Math.round(p[0]), 'v'), edgeSnap(Math.round(p[1]), 'h')]; v.requestRender(); return; }
      if (guideDrag) { const raw = guideDrag.axis === 'v' ? p[0] : p[1]; guideDrag.pos = e.shiftKey ? tickSnap(raw, guideDrag.axis === 'v' ? 0 : 1) : edgeSnap(Math.round(raw), guideDrag.axis); v.requestRender(); return; }
      if (!(e.buttons & 1) && !spaceDown) { const g = !K.prefs.lockGuides && !v.hideGuides && (app.tool.id === 'move' || e.metaKey) ? guideAt(p) : null; const want = g ? (g.axis === 'v' ? 'col-resize' : 'row-resize') : v.inCorner(sx, sy) ? 'crosshair' : null; if (want) c.style.cursor = want; else if (c.style.cursor === 'col-resize' || c.style.cursor === 'row-resize' || (c.style.cursor === 'crosshair' && app.tool.cursor !== 'crosshair')) c.style.cursor = app.tool.cursor || 'default'; }
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      if (downTool && (e.buttons & 1)) { for (const ev of events.length ? events : [e]) { const [x2, y2] = pt(ev); if (downTool.move) downTool.move(ev, snapP(downTool, v.toDoc(x2, y2)), x2, y2); } }
      else if (app.tool.hover) app.tool.hover(p, e, sx, sy);
      if (app.tool.cursor === 'none' || app.tool.overlay || v.showRulers) v.requestRender();
    });
    const end = (e) => {
      if (!app.doc) return; const [sx, sy] = pt(e), p = v.toDoc(sx, sy);
      if (panning) { panning = null; c.style.cursor = spaceDown ? 'grab' : (app.tool.cursor || 'default'); UI.updateInfo(); return; }
      if (originDrag) { originDrag = false; const o = v.originDrag; v.originDrag = null; if (o) { app.doc.origin = o; app.doc.push('Ruler Origin'); } v.requestRender(); UI.updateStatus(); return; }
      if (guideDrag) {
        const d = app.doc, inRulerNow = v.inRuler(sx, sy), off = inRulerNow || (guideDrag.axis === 'v' ? (p[0] < 0 || p[0] > d.w) : (p[1] < 0 || p[1] > d.h));
        if (off) d.guides.splice(d.guides.indexOf(guideDrag), 1);
        guideDrag = null; v.guideDrag = null; d.push(off ? 'Delete Guide' : 'Guide'); v.requestRender(); return;
      }
      if (downTool && downTool.up) downTool.up(e, snapP(downTool, p), sx, sy); downTool = null;
      UI.updateStatus(); UI.updateTransformFields();
    };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { v.cursorPos = null; v.requestRender(); });
    c.addEventListener('dblclick', (e) => {
      if (!app.doc) return; const [sx, sy] = pt(e), p = v.toDoc(sx, sy);
      if (v.inCorner(sx, sy)) { C.resetOrigin(); return; }
      if (v.inRuler(sx, sy)) { C.preferences(); return; }
      const g = !v.hideGuides && (app.tool.id === 'move' || e.metaKey) ? guideAt(p) : null; if (g) { C.newGuide(g); return; }
      if (app.tool.id === 'hand') C.zoom(0); if (app.tool.id === 'zoom') C.zoom(100);
    });
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault(); if (!app.doc) return;
      { const [sx, sy] = pt(e); if (v.inRuler(sx, sy) || v.inCorner(sx, sy)) { const u = v.unit(); UI.contextMenu(e.clientX, e.clientY, [...UNIT_OPTS, ['pt', 'Points']].map(([k, l]) => [(k === u ? '✓ ' : '   ') + l, 'setUnits', k]).concat([null, ['Reset Ruler Origin', 'resetOrigin'], ['New Guide…', 'newGuide'], ['New Guide Layout…', 'guideLayout']])); return; }
        const g = !v.hideGuides ? guideAt(v.toDoc(sx, sy)) : null; if (g) { UI.contextMenu(e.clientX, e.clientY, [['Edit Guide…', () => C.newGuide(g)], ['Delete Guide', () => { const d = app.doc; d.guides.splice(d.guides.indexOf(g), 1); d.push('Delete Guide'); v.requestRender(); }], null, [K.prefs.lockGuides ? 'Unlock Guides' : 'Lock Guides', 'lockGuides'], ['Clear Guides', 'clearGuides']]); return; } }
      const items = app.doc.sel ? [['Deselect', 'deselect'], ['Select Inverse', 'invertSel'], ['Feather…', 'featherSel'], null, ['Layer via Copy', 'dupLayer'], ['Layer via Cut', 'layerViaCut'], ['Content-Aware Fill', 'contentFill'], ['Fill Selection…', 'fillSel'], ['Stroke Selection…', 'strokeSel'], ['Add Mask from Selection', 'maskFromSel'], ['Crop to Selection', 'cropToSel'], ['New Adjustment Layer (Levels)', 'newAdjLayer', 'levels']]
        : [['Select All', 'selectAll'], ['Select Subject', 'selectSubject'], null, ['Paste', 'paste'], ['Place Photo…', 'place'], null, ['Free Transform', 'freeTransform'], ['Fit on Screen', 'zoom', 0], ['Actual Pixels', 'zoom', 100]];
      UI.contextMenu(e.clientX, e.clientY, items);
    });
    c.addEventListener('wheel', (e) => {
      if (!app.doc) return; e.preventDefault(); const [sx, sy] = pt(e);
      if (e.ctrlKey || e.metaKey || e.altKey) { const f = Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002)); v.setZoom(app.doc.view.zoom * f, sx, sy); UI.refreshTabs(); }
      else { app.doc.view.panX -= e.deltaX; app.doc.view.panY -= e.deltaY; v.requestRender(); }
      UI.updateInfo();
    }, { passive: false });

    const hoverInfo = U.rafThrottle((p) => { UI.updatePixelInfo(p); UI.updateStatus(); });

    let digitBuf = '', digitTime = 0, selNudgeT = 0;
    const nudgeSel = (dx, dy) => {
      const d = app.doc, c = U.canvas(d.w, d.h); U.ctx(c).drawImage(d.sel.canvas, dx, dy);
      d.sel = K.Sel.make(c);
      d.emit('selection'); app.view.requestRender(); clearTimeout(selNudgeT); selNudgeT = setTimeout(() => d.push('Move Selection'), 400);
    };
    const BRUSH_STEPS = [1, 2, 3, 5, 8, 10, 13, 17, 21, 27, 35, 45, 65, 100, 200, 300, 500, 750, 1000, 1500, 2000];
    window.addEventListener('keydown', (e) => {
      if (document.querySelector('.modal-bg')) return;
      if (e.key === ' ' && !U.isTyping()) { if (!spaceDown) { spaceDown = true; app.spaceDown = true; app.view.c.style.cursor = 'grab'; } e.preventDefault(); return; }
      if (U.isTyping()) return;
      const mod = e.metaKey || e.ctrlKey, k = e.key, lower = k.length === 1 ? k.toLowerCase() : k;
      if (k === 'CapsLock') { app.preciseCursor = e.getModifierState('CapsLock'); app.view.requestRender(); return; }
      if (app.tool && typeof app.tool.key === 'function' && !mod && app.tool.key(e)) { e.preventDefault(); return; }
      // Fill shortcuts (Elements): ⌥Delete = foreground, ⌘Delete = background, ⇧Delete = Fill dialog
      if ((k === 'Backspace' || k === 'Delete') && app.doc) {
        e.preventDefault();
        if (e.altKey) return app.run('quickFill', 'fg');
        if (mod) return app.run('quickFill', 'bg');
        if (e.shiftKey) return app.run('fillSel');
        return app.run('clearSel');
      }
      // Arrows: move selection outline with selection tools, layer with Move tool or ⌘
      if (k.startsWith('Arrow') && app.doc && !(app.tool.id === 'move' && !mod)) {
        const step = e.shiftKey ? 10 : 1, dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
        const selTools = ['marquee', 'ellipse', 'lasso', 'polylasso', 'wand', 'quickselect', 'selbrush'];
        if (!mod && selTools.includes(app.tool.id) && app.doc.sel) { e.preventDefault(); nudgeSel(dx, dy); return; }
        if (mod && app.doc.active) { e.preventDefault(); K.tools.move.key(e); return; }
      }
      if (k === 'PageUp' || k === 'PageDown' || k === 'Home' || k === 'End') {
        if (!app.doc) return; e.preventDefault(); const V = app.doc.view, r = app.view.c.getBoundingClientRect(), dir = (k === 'PageUp' || k === 'Home') ? 1 : -1;
        if (k === 'Home') { V.panX = 20; V.panY = 20; } else if (k === 'End') { V.panX = r.width - app.doc.w * V.zoom - 20; V.panY = r.height - app.doc.h * V.zoom - 20; }
        else { const amt = e.shiftKey ? 10 : (mod ? r.width : r.height); if (mod) V.panX += dir * amt; else V.panY += dir * amt; }
        app.view.requestRender(); UI.updateInfo(); return;
      }
      if (!native && mod) { // browser fallback for menu accelerators (same layout as the Mac menu)
        const map = { z: e.shiftKey ? 'redo' : 'undo', y: 'redo', n: e.shiftKey ? 'newLayer' : 'new', o: 'open', s: e.shiftKey ? 'saveAs' : 'save', c: e.altKey ? 'canvasSize' : e.shiftKey ? 'copyMerged' : 'copy', x: 'cut', v: 'paste', a: 'selectAll', d: e.altKey ? 'featherSel' : e.shiftKey ? 'reselect' : 'deselect', t: 'freeTransform', j: e.shiftKey ? 'layerViaCut' : 'layerViaCopy', l: e.shiftKey ? 'auto' : 'adjust', m: e.shiftKey ? 'adjust' : e.altKey ? 'auto' : null, u: e.shiftKey ? 'adjustNow' : 'adjust', i: e.altKey ? 'imageSize' : e.shiftKey ? 'invertSel' : 'adjustNow', b: e.shiftKey ? 'auto' : null, r: e.shiftKey ? 'toggleRulers' : 'auto', g: e.shiftKey ? 'clipOff' : 'clipOn', '0': 'zoom', '=': 'zoom', '+': 'zoom', '-': 'zoom', e: e.shiftKey ? 'mergeVisible' : 'mergeDown', "'": 'toggleGrid', ';': e.altKey ? 'lockGuides' : e.shiftKey ? 'toggleSnap' : 'toggleGuides', w: 'closeDoc', ']': 'arrange', '[': 'arrange' };
        const arg = { l: e.shiftKey ? (e.altKey ? 'contrast' : 'levels') : 'levels', m: e.shiftKey ? 'smartfix' : 'smartfix', u: e.shiftKey ? 'desaturate' : 'hueSat', i: e.shiftKey || e.altKey ? undefined : 'invert', b: 'color', r: e.shiftKey ? undefined : 'redeye', '0': e.altKey ? 100 : 0, '=': 1, '+': 1, '-': -1, ']': e.shiftKey ? 'front' : 'up', '[': e.shiftKey ? 'back' : 'down' }[lower];
        if (map[lower]) { e.preventDefault(); app.run(map[lower], arg); }
        return;
      }
      if (mod) return;
      if (k === 'Tab') { e.preventDefault(); return C.toggleAllPanels(); }
      if (k === 'Escape') { if (app.tool.cancel) app.tool.cancel(); return; }
      if (k === '/') { e.preventDefault(); return C.lockAlpha(); }
      const t = app.tool;
      if (k === '[' || k === ']' || k === '{' || k === '}') {
        const dir = (k === ']' || k === '}') ? 1 : -1;
        if (e.shiftKey && t.o.hardness !== undefined) t.o.hardness = U.clamp(Math.round((t.o.hardness + dir * 25) / 25) * 25, 0, 100);
        else if (t.o.size !== undefined) { const s = t.o.size; t.o.size = U.clamp(Math.round(s + dir * Math.max(1, s * 0.15)), 1, 2000); }
        UI.renderOptions(); app.view.requestRender(); return;
      }
      if ((k === ',' || k === '.' || k === '<' || k === '>') && t.o.size !== undefined) { // previous / next brush size (Shift = first / last)
        const next = k === '.' || k === '>';
        if (e.shiftKey) t.o.size = next ? BRUSH_STEPS[BRUSH_STEPS.length - 1] : BRUSH_STEPS[0];
        else t.o.size = next ? (BRUSH_STEPS.find((v) => v > t.o.size) || 2000) : ([...BRUSH_STEPS].reverse().find((v) => v < t.o.size) || 1);
        UI.renderOptions(); app.view.requestRender(); return;
      }
      if (e.shiftKey && (k === '+' || k === '=' || k === '-' || k === '_') && t.o.blend !== undefined) { // cycle blend modes
        const modes = Object.keys(Lr.BLEND_NAMES), i = modes.indexOf(t.o.blend), dir = (k === '-' || k === '_') ? -1 : 1;
        t.o.blend = modes[(i + dir + modes.length) % modes.length]; UI.renderOptions(); UI.toast('Mode: ' + Lr.BLEND_NAMES[t.o.blend]); return;
      }
      if (/^[0-9]$/.test(k)) { // 1 = 10%, 0 = 100%, two quick digits = exact value (4 then 5 = 45%)
        const key = ['opacity', 'tolerance', 'exposure', 'strength', 'flow'].find((o) => t.o[o] !== undefined); if (!key) return;
        const now = performance.now();
        if (digitBuf && now - digitTime < 600) { digitBuf += k; t.o[key] = Math.max(1, +digitBuf); digitBuf = ''; }
        else { digitBuf = k; t.o[key] = k === '0' ? 100 : +k * 10; }
        digitTime = now; UI.renderOptions(); return;
      }
      if (lower === 'x') return C.swapColors();
      if (lower === 'd') return C.resetColors();
      // Tool letters: plain key selects the group, Shift + key cycles through tools sharing the letter
      const ids = K.TOOL_ORDER.flat().filter((id) => K.tools[id].hotkey === lower);
      if (ids.length) {
        const cur = ids.indexOf(t.id);
        if (cur >= 0 && e.shiftKey) app.setTool(ids[(cur + 1) % ids.length]);
        else if (cur < 0) app.setTool(app.lastInGroup && ids.includes(app.lastInGroup[lower]) ? app.lastInGroup[lower] : ids[0]);
      }
    });
    window.addEventListener('keyup', (e) => { if (e.key === 'CapsLock') { app.preciseCursor = e.getModifierState('CapsLock'); app.view.requestRender(); } if (e.key === ' ') { spaceDown = false; app.spaceDown = false; app.view.c.style.cursor = app.tool.cursor || 'default'; } });

    // drag & drop
    const stage = document.getElementById('stage');
    const handleDrop = async (e, intoDoc) => {
      e.preventDefault(); document.body.classList.remove('dropping');
      const docId = e.dataTransfer.getData('application/x-forged-doc');
      if (docId) { const src = app.docs.find((d) => d.id === docId); if (src && app.doc && src !== app.doc) { const [sx, sy] = pt(e); app.placeCanvas(U.clone(src.composite()), src.name, v.toDoc(sx, sy)); } return; }
      const files = [...e.dataTransfer.files];
      for (const f of files) {
        if (/\.(forged|kauri)$/i.test(f.name)) { await app.loadProject(await f.text(), f.name, f.path); continue; }
        if (f.type === 'application/pdf' || K.PDF.isPdfName(f.name)) {
          const rec = { kind: 'pdf', name: f.name, path: f.path, bytes: new Uint8Array(await f.arrayBuffer()) };
          try { if (intoDoc && app.doc) { const [sx, sy] = pt(e); await K.PDF.place(rec, v.toDoc(sx, sy)); } else await K.PDF.open(rec); } catch (er) { UI.toast(`Could not open ${f.name}: ${er.message}`); }
          continue;
        }
        if (!f.type.startsWith('image/')) continue;
        const c = U.imageToCanvas(await U.loadImage(await U.blobToDataUrl(f)));
        if (intoDoc && app.doc) { const [sx, sy] = pt(e); app.placeCanvas(c, f.name.replace(/\.[^.]+$/, ''), v.toDoc(sx, sy)); }
        else app.docFromCanvas(c, f.name.replace(/\.[^.]+$/, ''), f.path);
      }
    };
    stage.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dropping'); });
    stage.addEventListener('dragleave', () => document.body.classList.remove('dropping'));
    stage.addEventListener('drop', (e) => handleDrop(e, true));
    const bin = document.getElementById('bin'); bin.addEventListener('dragover', (e) => e.preventDefault()); bin.addEventListener('drop', (e) => handleDrop(e, false));
    document.getElementById('tabs').addEventListener('dragover', (e) => e.preventDefault()); document.getElementById('tabs').addEventListener('drop', (e) => handleDrop(e, false));
    window.addEventListener('paste', (e) => { if (U.isTyping()) return; if (!native) { const it = [...e.clipboardData.items].find((i) => i.type.startsWith('image/')); if (it) { e.preventDefault(); U.blobToDataUrl(it.getAsFile()).then(async (u) => { const c = U.imageToCanvas(await U.loadImage(u)); app.clip = { canvas: c }; C.paste(); }); } } });
  }

  // ---------- boot ----------
  function welcome() {
    const w = document.getElementById('welcome');
    w.innerHTML = '';
    w.append(el('div', { class: 'welcome-card' },
      el('div', { class: 'logo' }, el('img', { src: 'forged-mark.png', width: 64, height: 64, alt: '' })),
      el('h1', {}, 'Forged'), el('p', {}, native && native.tagline || 'Layered photo editing for your Mac'),
      el('div', { class: 'welcome-actions' },
        el('button', { class: 'big', html: K.icon('open', 22) + '<span>Open Photo…</span>', onclick: () => app.run('open') }),
        el('button', { class: 'big', html: K.icon('plus', 22) + '<span>New Blank…</span>', onclick: () => app.run('new') }),
        el('button', { class: 'big', html: K.icon('collage', 22) + '<span>Photo Collage…</span>', onclick: () => app.run('collage') })),
      el('p', { class: 'hint' }, 'Or drop photos or PDFs anywhere in this window.'),
      el('p', { class: 'hint' }, el('a', { href: '#', class: 'link', onclick: (e) => { e.preventDefault(); app.run('convert'); } }, 'Convert Forged projects to PNG or JPEG…'))));
  }

  window.addEventListener('DOMContentLoaded', () => {
    app.view = new K.View(document.getElementById('view'));
    app.tool = K.tools.move;
    UI.buildToolbar(); UI.buildPanels(); UI.renderOptions(); UI.refreshAll(); welcome();
    bindInput();
    if (native) {
      document.body.classList.add('electron'); if (native.isMac) document.body.classList.add('mac');
      native.onMenu((cmd, arg) => app.run(cmd, arg));
      native.onOpenFile((f) => openFiles([f]));
      native.onRequestClose(async () => { for (const d of [...app.docs]) { app.switchDoc(d); const ok = await app.closeDoc(d); if (!ok) return; } native.closeOk(); });
    }
    window.addEventListener('resize', () => UI.updateInfo());
    // all fonts installed on this computer
    K.Fonts.onChange(() => { if (app.tool && app.tool.id === 'text') UI.renderOptions(); K.Fonts.refreshText(); });
    K.Fonts.load();
  });
})(window.K);
