// Forged — PDF support: open PDF pages as editable documents or layers, place pages into a
// document, and export one or more documents as a PDF.
// Reading uses Mozilla's pdf.js (vendor/pdfjs). Writing is done here: each page becomes one
// image at its real page size. Exported PDFs carry no metadata (no Info dictionary, no XMP).
(function (K) {
  'use strict';
  const U = K.U, el = U.el;
  const UI = () => K.UI;
  const PDF = {};
  const MAX_SIDE = 16000, MAX_PIXELS = 120e6; // stay inside what browsers allow for one canvas

  PDF.isPdfName = (n) => /\.pdf$/i.test(String(n || ''));
  PDF.isPdfBytes = (u) => u && u.length > 4 && u[0] === 0x25 && u[1] === 0x50 && u[2] === 0x44 && u[3] === 0x46; // %PDF

  // Bytes of an opened file record ({ bytes } from the desktop/web bridge, or a data URL)
  PDF.bytesOf = async (f) => {
    if (f.bytes) return f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
    if (f.base64) { const s = atob(f.base64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
    if (f.dataUrl) return new Uint8Array(await (await fetch(f.dataUrl)).arrayBuffer());
    if (f.file) return new Uint8Array(await f.file.arrayBuffer());
    throw new Error('No PDF data');
  };

  // ---------- reading (pdf.js) ----------
  let libP = null;
  const base = () => new URL('vendor/pdfjs/', document.baseURI).href;
  PDF.lib = () => {
    if (!libP) {
      libP = import(base() + 'pdf.min.mjs').then((lib) => { lib.GlobalWorkerOptions.workerSrc = base() + 'pdf.worker.min.mjs'; return lib; });
      libP.catch(() => { libP = null; });
    }
    return libP;
  };
  async function askPassword(name, again) {
    const v = await UI().form(again ? 'Wrong Password' : 'Password Required', [
      { type: 'html', node: el('p', { class: 'hint' }, `“${name}” is protected. Enter its password to open it.`) },
      { key: 'pw', label: 'Password', type: 'password', value: '' },
    ], 'Open', 380);
    return v ? String(v.pw || '') : null;
  }
  // Load a PDF. Scripts, forms' JavaScript and XFA are never run.
  PDF.load = async (bytes, name) => {
    const lib = await PDF.lib();
    const task = lib.getDocument({
      data: bytes.slice(), // pdf.js takes ownership of the buffer
      standardFontDataUrl: base() + 'standard_fonts/', cMapUrl: base() + 'cmaps/', cMapPacked: true,
      wasmUrl: base() + 'wasm/', iccUrl: base() + 'iccs/',
      enableScripting: false, enableXfa: false,
    });
    task.onPassword = async (update, reason) => {
      UI().busy(false);
      const pw = await askPassword(name, reason === lib.PasswordResponses.INCORRECT_PASSWORD);
      if (pw != null) UI().busy(true, `Reading ${name}…`);
      if (pw == null) { task.destroy(); return; }
      update(pw);
    };
    const pdf = await task.promise;
    pdf.close = () => { try { return Promise.resolve(task.destroy()).catch(() => {}); } catch (e) { return Promise.resolve(); } }; // frees the worker
    return pdf;
  };
  // Page size in points (1/72 inch), honouring the page's rotation
  PDF.pageSize = async (pdf, n) => { const p = await pdf.getPage(n), vp = p.getViewport({ scale: 1 }); return { w: vp.width, h: vp.height }; };
  // Render one page to a canvas at the given resolution (pixels per inch)
  PDF.renderPage = async (pdf, n, ppi, transparent) => {
    const page = await pdf.getPage(n);
    let scale = ppi / 72; const vp1 = page.getViewport({ scale: 1 });
    const fit = Math.min(1, MAX_SIDE / (vp1.width * scale), MAX_SIDE / (vp1.height * scale), Math.sqrt(MAX_PIXELS / (vp1.width * vp1.height * scale * scale)));
    scale *= fit;
    const vp = page.getViewport({ scale });
    const c = U.canvas(Math.max(1, Math.round(vp.width)), Math.max(1, Math.round(vp.height)));
    const ctx = c.getContext('2d');
    await page.render({ canvasContext: ctx, canvas: c, viewport: vp, background: transparent ? 'rgba(0,0,0,0)' : '#ffffff', annotationMode: 2 /* ENABLE_FORMS: show filled-in form values */ }).promise;
    page.cleanup();
    return { canvas: c, ppi: ppi * fit, reduced: fit < 1 };
  };

  // "1-3, 5, 8-" → [1,2,3,5,8,…,count]; empty or "all" → every page
  PDF.parsePages = (s, count) => {
    s = String(s || '').trim().toLowerCase();
    if (!s || s === 'all') return Array.from({ length: count }, (_, i) => i + 1);
    const out = [];
    for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
      const m = part.match(/^(\d*)\s*[-–]\s*(\d*)$/);
      let a, b;
      if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : count; } else if (/^\d+$/.test(part)) a = b = +part; else throw new Error(`“${part}” is not a page number or range`);
      if (a > b) [a, b] = [b, a];
      for (let i = Math.max(1, a); i <= Math.min(count, b); i++) if (!out.includes(i)) out.push(i);
    }
    if (!out.length) throw new Error(`Pick pages between 1 and ${count}`);
    return out;
  };
  const fmtSize = (pt) => { const u = K.prefs.rulerUnits === 'px' ? 'cm' : (K.prefs.rulerUnits || 'cm'); return `${U.fmtUnit(pt.w, u, 72, false)} × ${U.fmtUnit(pt.h, u, 72)}`; };
  const PPI_OPTS = [[72, '72 ppi (screen, small)'], [150, '150 ppi (good for most edits)'], [200, '200 ppi'], [300, '300 ppi (print quality)'], [600, '600 ppi (fine detail, large)']];

  // Ask which pages to open and how. Returns { pages, ppi, mode, transparent } or null.
  async function openOptions(pdf, name, { place = false } = {}) {
    const count = pdf.numPages, first = await PDF.pageSize(pdf, 1);
    const est = el('div', { class: 'hint' });
    const vals = { pages: count === 1 ? '1' : 'all', ppi: place ? Math.min(600, Math.max(72, Math.round((K.app.doc && K.app.doc.ppi) || 150))) : (K.prefs.pdfPpi || 150) };
    const showEst = () => {
      const ppi = +vals.ppi || 150;
      est.textContent = `Page 1: ${fmtSize(first)} → ${Math.round(first.w * ppi / 72)} × ${Math.round(first.h * ppi / 72)} px`;
    };
    showEst();
    const ppiOpts = PPI_OPTS.slice(); if (!ppiOpts.some(([v]) => v === vals.ppi)) ppiOpts.push([vals.ppi, `${vals.ppi} ppi (this document)`]);
    const fields = [
      { type: 'html', node: el('p', { class: 'hint', style: { margin: '0 0 6px' } }, `“${name}” has ${count} page${count > 1 ? 's' : ''}. Pages open as pictures you can edit with every tool; text in the PDF becomes part of the picture.`) },
      { key: 'pages', label: 'Pages', type: 'text', value: vals.pages },
      { key: 'ppi', label: 'Resolution', type: 'select', value: vals.ppi, options: ppiOpts, onChange: (v) => { vals.ppi = +v; showEst(); } },
    ];
    if (!place && count > 1) fields.push({ key: 'mode', label: 'Open as', type: 'select', value: K.prefs.pdfMode || 'docs', options: [['docs', 'One document per page'], ['layers', 'One document, a layer per page']] });
    fields.push({ key: 'transparent', label: 'Transparent page background', type: 'check', value: !!place });
    fields.push({ type: 'html', node: est });
    if (count > 1) fields.push({ type: 'html', node: el('div', { class: 'hint' }, 'Pages: “all”, or numbers and ranges such as 1-3, 5, 8-') });
    for (;;) {
      const v = await UI().form(place ? 'Place PDF Pages' : 'Open PDF', fields, place ? 'Place' : 'Open', 420);
      if (!v) return null;
      try {
        const pages = PDF.parsePages(v.pages, count);
        if (!place) { K.prefs.pdfPpi = +v.ppi; K.prefs.pdfMode = v.mode || K.prefs.pdfMode; localStorage.setItem('kauri.prefs', JSON.stringify(K.prefs)); }
        return { pages, ppi: +v.ppi || 150, mode: v.mode || 'docs', transparent: !!v.transparent };
      } catch (e) { UI().toast(e.message, 3500); fields[1].value = v.pages; fields[2].value = v.ppi; }
    }
  }

  const baseName = (n) => String(n || 'PDF').replace(/\.pdf$/i, '');
  async function withPdf(f, fn) {
    UI().busy(true, `Reading ${f.name}…`);
    let pdf;
    try { pdf = await PDF.load(await PDF.bytesOf(f), f.name); } catch (e) {
      UI().busy(false);
      if (e && e.name === 'PasswordException') throw new Error('it is password protected');
      throw new Error(e && e.message ? e.message.replace(/^Invalid PDF structure\.?/, 'it is not a readable PDF') : 'it is not a readable PDF');
    }
    UI().busy(false);
    try { return await fn(pdf); } finally { UI().busy(false); pdf.close(); }
  }

  // File ▸ Open (and drag & drop) for a PDF
  PDF.open = (f) => withPdf(f, async (pdf) => {
    const o = await openOptions(pdf, f.name); if (!o) return;
    const app = K.app, Lr = K.Layers, name = baseName(f.name), many = o.pages.length > 1;
    let reduced = false;
    if (o.mode === 'layers' && many) {
      const rendered = [];
      for (const [i, n] of o.pages.entries()) { UI().busy(true, `Rendering page ${n} (${i + 1} of ${o.pages.length})…`); const r = await PDF.renderPage(pdf, n, o.ppi, o.transparent); reduced = reduced || r.reduced; rendered.push([n, r]); await new Promise((res) => setTimeout(res, 0)); }
      const w = Math.max(...rendered.map(([, r]) => r.canvas.width)), h = Math.max(...rendered.map(([, r]) => r.canvas.height));
      const d = new K.Doc(w, h, name); d.ppi = rendered[0][1].ppi; d.sourcePath = f.path || null; d.pdf = { source: f.name, pages: o.pages.slice() };
      rendered.forEach(([n, r], i) => { const L = Lr.newLayer({ name: `Page ${n}`, canvas: r.canvas, x: 0, y: 0 }); L.visible = i === 0; L.pdfPage = { n, w: r.canvas.width, h: r.canvas.height }; d.layers.unshift(L); });
      d.activeId = d.layers[d.layers.length - 1].id; d.push('Open PDF'); d.modified = false; app.addDoc(d);
      UI().toast(`Opened ${o.pages.length} pages as layers — show one at a time, or use File ▸ Export as PDF ▸ Each layer as a page`, 5000);
    } else {
      for (const [i, n] of o.pages.entries()) {
        UI().busy(true, `Rendering page ${n}${many ? ` (${i + 1} of ${o.pages.length})` : ''}…`);
        const r = await PDF.renderPage(pdf, n, o.ppi, o.transparent); reduced = reduced || r.reduced;
        const d = app.docFromCanvas(r.canvas, pdf.numPages > 1 ? `${name} p${n}` : name, f.path, r.ppi);
        d.pdf = { source: f.name, page: n, of: pdf.numPages };
        await new Promise((res) => setTimeout(res, 0));
      }
      if (many) UI().toast(`Opened ${o.pages.length} pages. File ▸ Export as PDF can put them back together.`, 4000);
    }
    if (reduced) UI().toast('Some pages were very large, so they were opened at a lower resolution', 4000);
  });

  // File ▸ Place for a PDF: each chosen page becomes a placed (scalable) layer
  PDF.place = (f, at) => withPdf(f, async (pdf) => {
    const o = await openOptions(pdf, f.name, { place: true }); if (!o) return;
    for (const n of o.pages) {
      UI().busy(true, `Rendering page ${n}…`);
      const r = await PDF.renderPage(pdf, n, o.ppi, o.transparent);
      UI().busy(false);
      K.app.placeCanvas(r.canvas, pdf.numPages > 1 ? `${baseName(f.name)} p${n}` : baseName(f.name), at);
    }
  });

  // ---------- writing ----------
  const enc = new TextEncoder();
  const num = (v) => (Math.round(v * 1000) / 1000).toString();
  const canvasBlob = (c, type, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the page'))), type, q));
  async function deflate(u) {
    if (typeof CompressionStream !== 'function') return null;
    const s = new Blob([u]).stream().pipeThrough(new CompressionStream('deflate')); // zlib format = PDF FlateDecode
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  // Turn a page canvas into PDF image objects: { dict, data, smask? }
  async function imageFor(c, o) {
    const w = c.width, h = c.height;
    const px = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    let opaque = true; for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) { opaque = false; break; }
    if (o.format === 'jpeg') {
      const flat = U.canvas(w, h), x = flat.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h); x.drawImage(c, 0, 0);
      const data = new Uint8Array(await (await canvasBlob(flat, 'image/jpeg', o.quality / 100)).arrayBuffer());
      return { dict: `/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, data };
    }
    const rgb = new Uint8Array(w * h * 3), a = opaque ? null : new Uint8Array(w * h);
    for (let i = 0, j = 0, k = 0; i < px.length; i += 4, j += 3, k++) {
      if (a) a[k] = px[i + 3]; // getImageData gives straight (not premultiplied) alpha, as PDF expects
      rgb[j] = px[i]; rgb[j + 1] = px[i + 1]; rgb[j + 2] = px[i + 2];
    }
    const z = await deflate(rgb), za = a ? await deflate(a) : null;
    const img = { dict: `/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8${z ? ' /Filter /FlateDecode' : ''}`, data: z || rgb };
    if (a) img.smask = { dict: `/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8${za ? ' /Filter /FlateDecode' : ''}`, data: za || a };
    return img;
  }
  // pages: [{ canvas, wPt, hPt }]; o: { format: 'jpeg'|'lossless', quality }. Returns the PDF bytes.
  PDF.write = async (pages, o = {}) => {
    o = Object.assign({ format: 'jpeg', quality: 92 }, o);
    const objs = []; // index i → object number i+1; each entry is an array of Uint8Array/string parts
    const add = () => { objs.push(null); return objs.length; };
    const set = (n, ...parts) => { objs[n - 1] = parts; };
    const stream = (n, dict, data) => set(n, `<< ${dict} /Length ${data.length} >>\nstream\n`, data, '\nendstream');
    const catalog = add(), tree = add(), kids = [];
    for (const p of pages) {
      const img = await imageFor(p.canvas, o);
      const pageN = add(), contN = add(), imgN = add(), smN = img.smask ? add() : 0;
      if (smN) stream(smN, img.smask.dict, img.smask.data);
      stream(imgN, img.dict + (smN ? ` /SMask ${smN} 0 R` : ''), img.data);
      const content = enc.encode(`q ${num(p.wPt)} 0 0 ${num(p.hPt)} 0 0 cm /Im0 Do Q`);
      stream(contN, '', content);
      set(pageN, `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${num(p.wPt)} ${num(p.hPt)}] /Resources << /XObject << /Im0 ${imgN} 0 R >> >> /Contents ${contN} 0 R >>`);
      kids.push(pageN);
      await new Promise((res) => setTimeout(res, 0));
    }
    set(catalog, `<< /Type /Catalog /Pages ${tree} 0 R >>`);
    set(tree, `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`);
    // header; the second line is the customary binary marker (raw bytes above 127)
    const chunks = [new Uint8Array([...enc.encode('%PDF-1.4\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])], offsets = [];
    let pos = chunks[0].length;
    objs.forEach((parts, i) => {
      offsets.push(pos);
      for (const part of [`${i + 1} 0 obj\n`, ...parts, '\nendobj\n']) { const b = typeof part === 'string' ? enc.encode(part) : part; chunks.push(b); pos += b.length; }
    });
    const xref = ['xref', `0 ${objs.length + 1}`, '0000000000 65535 f ', ...offsets.map((off) => String(off).padStart(10, '0') + ' 00000 n ')].join('\n') + '\n';
    chunks.push(enc.encode(xref + `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
    let n = 0; for (const c of chunks) n += c.length;
    const out = new Uint8Array(n); let i = 0; for (const c of chunks) { out.set(c, i); i += c.length; }
    return out;
  };

  // Page size of a document in points, from its resolution
  const docPt = (d) => ({ w: d.w / (d.ppi || 72) * 72, h: d.h / (d.ppi || 72) * 72 });
  function scaled(c, pct) { return pct === 100 ? c : U.resample(c, Math.max(1, Math.round(c.width * pct / 100)), Math.max(1, Math.round(c.height * pct / 100))); }
  function layerCanvas(d, L) {
    // One layer on its own, as it shows in the document (opacity, mask, style), even if hidden
    const vis = L.visible; L.visible = true;
    try { return d.compositeLayers([L]); } finally { L.visible = vis; }
  }
  const bytesToBase64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  PDF.bytesToBase64 = bytesToBase64;

  // File ▸ Export as PDF…
  PDF.exportDialog = async (preset) => {
    const app = K.app, d = app.doc; if (!d) return;
    const pixelPages = d.layers.filter((l) => l.type !== 'adjust');
    const srcOpts = [['doc', 'This document (one page)']];
    if (app.docs.length > 1) srcOpts.push(['all', `All ${app.docs.length} open documents, in tab order`]);
    if (pixelPages.length > 1) srcOpts.push(['layers', `Each layer of this document as a page (${pixelPages.length})`]);
    const pt = docPt(d);
    const info = el('div', { class: 'hint' });
    const vals = { source: preset || (d.pdf && d.pdf.pages && pixelPages.length > 1 ? 'layers' : 'doc'), scale: 100 };
    const showInfo = () => { info.textContent = `Page size ${fmtSize(pt)} at ${Math.round(d.ppi || 72)} ppi (from Image ▸ Image Size). ${vals.source === 'all' ? 'Each document keeps its own page size.' : ''}`; };
    if (!srcOpts.some(([v]) => v === vals.source)) vals.source = 'doc';
    showInfo();
    const v = await UI().form('Export as PDF', [
      { key: 'source', label: 'Pages', type: 'select', value: vals.source, options: srcOpts, onChange: (x) => { vals.source = x; showInfo(); } },
      { key: 'format', label: 'Image quality', type: 'select', value: K.prefs.pdfFormat || 'jpeg', options: [['jpeg', 'JPEG (smaller file)'], ['lossless', 'Lossless (exact pixels, keeps transparency)']] },
      { key: 'quality', label: 'JPEG quality', type: 'range', value: K.prefs.exportQuality, min: 10, max: 100, unit: '%' },
      { key: 'scale', label: 'Pixels', type: 'range', value: 100, min: 10, max: 100, unit: '%' },
      { type: 'html', node: info },
      { type: 'html', node: el('div', { class: 'hint' }, 'The page size stays the same; fewer pixels makes a smaller file. The PDF is saved without metadata.') },
    ], 'Export…', 420);
    if (!v) return;
    K.prefs.pdfFormat = v.format; K.prefs.exportQuality = v.quality; localStorage.setItem('kauri.prefs', JSON.stringify(K.prefs));
    let bytes;
    try {
      UI().busy(true, 'Making the PDF…');
      const pages = [];
      if (v.source === 'all') for (const doc of app.docs) { const p = docPt(doc); pages.push({ canvas: scaled(doc.composite(), +v.scale), wPt: p.w, hPt: p.h }); }
      else if (v.source === 'layers') {
        // top layer (first in the Layers panel) = page 1; pages opened from a PDF keep their own size
        for (const L of d.layers.filter((l) => l.type !== 'adjust').slice().reverse()) {
          let c = layerCanvas(d, L), w = pt.w, h = pt.h;
          const pg = L.pdfPage;
          if (pg && (pg.w < d.w || pg.h < d.h)) { const cc = U.canvas(pg.w, pg.h); cc.getContext('2d').drawImage(c, 0, 0); c = cc; w = pg.w / (d.ppi || 72) * 72; h = pg.h / (d.ppi || 72) * 72; }
          pages.push({ canvas: scaled(c, +v.scale), wPt: w, hPt: h });
        }
      }
      else pages.push({ canvas: scaled(d.composite(), +v.scale), wPt: pt.w, hPt: pt.h });
      bytes = await PDF.write(pages, { format: v.format, quality: +v.quality });
      bytes.pages = pages.length;
    } catch (e) { UI().busy(false); UI().toast('Could not make the PDF: ' + e.message, 4000); return; }
    UI().busy(false);
    const nm = (d.pdf && d.pdf.source ? baseName(d.pdf.source) + (v.source === 'doc' && d.pdf.page ? ` p${d.pdf.page}` : '') : d.name) + '.pdf';
    const native = window.native;
    if (native) {
      const r = await native.exportImage({ defaultName: nm, filters: [{ name: 'PDF', extensions: ['pdf'] }], base64: bytesToBase64(bytes) });
      if (r) UI().toast(`Exported ${r.name} · ${bytes.pages} page${bytes.pages > 1 ? 's' : ''}`);
    } else {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a'); a.href = url; a.download = nm; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  };

  K.PDF = PDF;
})(window.K);
