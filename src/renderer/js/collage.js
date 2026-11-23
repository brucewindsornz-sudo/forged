// Forged — Photo Collage: layouts, live preview, frame + clipped photo layers, drop-into-frame placement
(function (K) {
  'use strict';
  const U = K.U, el = U.el, Lr = K.Layers;
  const app = () => K.app, UI = () => K.UI;

  // ---------- layouts (cells in unit space 0..1, before gap/margin) ----------
  const grid = (cols, rows) => { const out = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: c / cols, y: r / rows, w: 1 / cols, h: 1 / rows }); return out; };
  const LAYOUTS = {
    g2h: { name: '2 side by side', n: 2, cells: () => grid(2, 1) },
    g2v: { name: '2 stacked', n: 2, cells: () => grid(1, 2) },
    g3h: { name: '3 columns', n: 3, cells: () => grid(3, 1) },
    g3v: { name: '3 rows', n: 3, cells: () => grid(1, 3) },
    g4: { name: '2 × 2 grid', n: 4, cells: () => grid(2, 2) },
    g6: { name: '3 × 2 grid', n: 6, cells: () => grid(3, 2) },
    g6v: { name: '2 × 3 grid', n: 6, cells: () => grid(2, 3) },
    g9: { name: '3 × 3 grid', n: 9, cells: () => grid(3, 3) },
    g12: { name: '4 × 3 grid', n: 12, cells: () => grid(4, 3) },
    g16: { name: '4 × 4 grid', n: 16, cells: () => grid(4, 4) },
    featL: { name: 'Feature + 2', n: 3, cells: () => [{ x: 0, y: 0, w: 2 / 3, h: 1 }, { x: 2 / 3, y: 0, w: 1 / 3, h: 0.5 }, { x: 2 / 3, y: 0.5, w: 1 / 3, h: 0.5 }] },
    featL3: { name: 'Feature + 3', n: 4, cells: () => [{ x: 0, y: 0, w: 0.64, h: 1 }, ...[0, 1, 2].map((i) => ({ x: 0.64, y: i / 3, w: 0.36, h: 1 / 3 }))] },
    featT: { name: 'Feature top + 3', n: 4, cells: () => [{ x: 0, y: 0, w: 1, h: 0.62 }, ...[0, 1, 2].map((i) => ({ x: i / 3, y: 0.62, w: 1 / 3, h: 0.38 }))] },
    featC: { name: 'Centre feature', n: 5, cells: () => [{ x: 0.25, y: 0, w: 0.5, h: 1 }, { x: 0, y: 0, w: 0.25, h: 0.5 }, { x: 0, y: 0.5, w: 0.25, h: 0.5 }, { x: 0.75, y: 0, w: 0.25, h: 0.5 }, { x: 0.75, y: 0.5, w: 0.25, h: 0.5 }] },
    mosaic5: { name: 'Mosaic 2 + 3', n: 5, cells: () => [{ x: 0, y: 0, w: 0.5, h: 0.55 }, { x: 0.5, y: 0, w: 0.5, h: 0.55 }, ...[0, 1, 2].map((i) => ({ x: i / 3, y: 0.55, w: 1 / 3, h: 0.45 }))] },
    mosaic7: { name: 'Mosaic 7', n: 7, cells: () => [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.25, h: 0.5 }, { x: 0.75, y: 0, w: 0.25, h: 0.5 }, { x: 0, y: 0.5, w: 0.25, h: 0.5 }, { x: 0.25, y: 0.5, w: 0.25, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0, h: 0 }].slice(0, 6) },
    strip: { name: 'Film strip', n: 4, cells: () => [0, 1, 2, 3].map((i) => ({ x: 0.03, y: i / 4, w: 0.94, h: 1 / 4 })) },
    scatter: { name: 'Scattered prints', n: 5, scatter: true, cells: (seed) => {
      const R = K.Filters && K.Filters.seeded ? K.Filters.seeded(seed) : Math.random;
      const base = [[0.27, 0.3], [0.72, 0.28], [0.5, 0.55], [0.26, 0.74], [0.74, 0.75]];
      return base.map(([cx, cy]) => { const w = 0.42, h = 0.4; return { x: cx - w / 2 + (R() - 0.5) * 0.06, y: cy - h / 2 + (R() - 0.5) * 0.06, w, h, rot: (R() - 0.5) * 0.42 }; });
    } },
  };
  LAYOUTS.mosaic7.n = 6; LAYOUTS.mosaic7.name = 'Mosaic 6';

  const SIZES = [
    ['sq', 'Square 25 cm', 3000, 3000], ['10x15', '15 × 10 cm print', 1772, 1181], ['13x18', '18 × 13 cm print', 2126, 1535], ['20x30', '30 × 20 cm print', 3543, 2362], ['6x4', '6 × 4 in print', 1800, 1200], ['7x5', '7 × 5 in print', 2100, 1500],
    ['10x8', '10 × 8 in print', 3000, 2400], ['a4', 'A4', 3508, 2480], ['a3', 'A3', 4961, 3508],
    ['ig', 'Instagram post', 1080, 1080], ['ig45', 'Instagram 4:5', 1350, 1080], ['story', 'Story 9:16', 1920, 1080],
    ['fb', 'Facebook cover', 1640, 624], ['hd', 'Widescreen 16:9', 1920, 1080], ['custom', 'Custom…', 0, 0],
  ];

  // Convert unit cells to pixel cells, applying margin/gap; rotation kept
  function layoutCells(key, W, H, o) {
    const L = LAYOUTS[key], m = Math.min(W, H) * o.margin / 100, g = Math.min(W, H) * o.gap / 100;
    const iw = W - 2 * m, ih = H - 2 * m;
    return L.cells(o.seed).filter((c) => c.w > 0 && c.h > 0).map((c) => {
      if (L.scatter) return { x: m + c.x * iw, y: m + c.y * ih, w: c.w * iw, h: c.h * ih, rot: c.rot || 0 };
      const x0 = m + c.x * iw + (c.x > 1e-6 ? g / 2 : 0), y0 = m + c.y * ih + (c.y > 1e-6 ? g / 2 : 0);
      const x1 = m + (c.x + c.w) * iw - (c.x + c.w < 1 - 1e-6 ? g / 2 : 0), y1 = m + (c.y + c.h) * ih - (c.y + c.h < 1 - 1e-6 ? g / 2 : 0);
      return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0), rot: 0 };
    });
  }

  function roundRect(x, X, Y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2)); x.beginPath();
    if (x.roundRect) x.roundRect(X, Y, w, h, r);
    else { x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
  }

  // Draw a photo into a cell with "cover" fit; pan/zoom are per-photo user tweaks
  function drawCover(x, img, cell, zoom = 1, ox = 0, oy = 0) {
    const s = Math.max(cell.w / img.width, cell.h / img.height) * zoom;
    const w = img.width * s, h = img.height * s;
    x.drawImage(img, cell.w / 2 - w / 2 + ox * cell.w, cell.h / 2 - h / 2 + oy * cell.h, w, h);
  }

  function renderPreview(cv, st) {
    const { W, H } = st, scale = Math.min(cv.width / W, cv.height / H), x = cv.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height);
    const pw = W * scale, ph = H * scale, px = (cv.width - pw) / 2, py = (cv.height - ph) / 2;
    x.save(); x.translate(px, py); x.scale(scale, scale);
    x.fillStyle = st.o.bg; x.fillRect(0, 0, W, H);
    const cells = layoutCells(st.layout, W, H, st.o), r = Math.min(W, H) * st.o.radius / 100, bw = Math.min(W, H) * st.o.border / 100;
    st._cells = cells.map((c) => ({ ...c, sx: px + c.x * scale, sy: py + c.y * scale, sw: c.w * scale, sh: c.h * scale }));
    cells.forEach((c, i) => {
      x.save(); x.translate(c.x + c.w / 2, c.y + c.h / 2); x.rotate(c.rot); x.translate(-c.w / 2, -c.h / 2);
      if (st.o.shadow) { x.save(); x.shadowColor = 'rgba(0,0,0,0.45)'; x.shadowBlur = Math.min(W, H) * 0.02; x.shadowOffsetY = Math.min(W, H) * 0.008; x.fillStyle = bw > 0 ? st.o.borderColor : '#777'; roundRect(x, -bw, -bw, c.w + 2 * bw, c.h + 2 * bw, r + bw); x.fill(); x.restore(); }
      if (bw > 0) { x.fillStyle = st.o.borderColor; roundRect(x, -bw, -bw, c.w + 2 * bw, c.h + 2 * bw, r + bw); x.fill(); }
      roundRect(x, 0, 0, c.w, c.h, r); x.save(); x.clip();
      const ph_ = st.photos[i];
      if (ph_) drawCover(x, ph_.thumb, c, ph_.zoom, ph_.ox, ph_.oy);
      else { x.fillStyle = '#c9ccd1'; x.fillRect(0, 0, c.w, c.h); x.fillStyle = '#8a8f98'; x.font = `${Math.min(c.w, c.h) * 0.14}px -apple-system, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('+', c.w / 2, c.h / 2); }
      x.restore();
      if (st.sel === i) { x.strokeStyle = '#3fd18b'; x.lineWidth = 3 / scale; roundRect(x, 0, 0, c.w, c.h, r); x.stroke(); }
      x.restore();
    });
    x.restore();
  }

  function layoutIcon(key) {
    const c = el('canvas', { width: 64, height: 46 }), x = c.getContext('2d');
    x.fillStyle = '#2b2d31'; x.fillRect(0, 0, 64, 46);
    const cells = layoutCells(key, 64, 46, { margin: 6, gap: 6, seed: 3 });
    x.fillStyle = '#8fd8b4';
    for (const k of cells) { x.save(); x.translate(k.x + k.w / 2, k.y + k.h / 2); x.rotate(k.rot); x.fillRect(-k.w / 2, -k.h / 2, k.w, k.h); x.restore(); }
    return c;
  }

  async function photoFromCanvas(c, name) {
    const s = Math.min(1, 700 / Math.max(c.width, c.height));
    return { name, full: c, thumb: s < 1 ? U.resample(c, Math.round(c.width * s), Math.round(c.height * s)) : c, zoom: 1, ox: 0, oy: 0 };
  }

  // ---------- dialog ----------
  async function dialog(initial) {
    const st = { layout: 'g4', sizeKey: 'sq', W: 3000, H: 3000, landscape: true, photos: [], sel: -1,
      o: { margin: 3, gap: 2, radius: 0, border: 0, borderColor: '#ffffff', bg: '#ffffff', shadow: false, seed: 7 } };
    // Start with the open photos (excluding empty collages)
    for (const d of app().docs) st.photos.push(await photoFromCanvas(U.clone(d.composite()), d.name));
    if (initial) for (const p of initial) st.photos.push(await photoFromCanvas(p.canvas, p.name));
    const bestFit = Object.keys(LAYOUTS).find((k) => !LAYOUTS[k].scatter && LAYOUTS[k].n === st.photos.length); if (bestFit) st.layout = bestFit;

    const preview = el('canvas', { class: 'collage-preview', width: 560, height: 420 });
    const redraw = U.rafThrottle(() => renderPreview(preview, st));

    // layouts
    const lay = el('div', { class: 'collage-layouts' });
    const buildLayouts = () => {
      lay.innerHTML = '';
      for (const [k, L] of Object.entries(LAYOUTS)) {
        const b = el('button', { class: 'clayout' + (st.layout === k ? ' on' : ''), title: `${L.name} (${L.n} photos)` }, layoutIcon(k), el('span', {}, L.name));
        b.onclick = () => { st.layout = k; buildLayouts(); redraw(); };
        lay.append(b);
      }
    };
    buildLayouts();

    // photo strip
    const strip = el('div', { class: 'collage-photos' });
    const buildStrip = () => {
      strip.innerHTML = '';
      st.photos.forEach((p, i) => {
        const t = el('div', { class: 'cphoto' + (st.sel === i ? ' on' : ''), draggable: 'true', title: p.name + ' — drag to reorder' }, U.resample(p.thumb, 72, Math.max(1, Math.round(72 * p.thumb.height / p.thumb.width))), el('b', {}, String(i + 1)),
          el('button', { class: 'x', title: 'Remove', html: K.icon('close', 10), onclick: (e) => { e.stopPropagation(); st.photos.splice(i, 1); st.sel = -1; buildStrip(); redraw(); } }));
        t.onclick = () => { st.sel = st.sel === i ? -1 : i; buildStrip(); redraw(); };
        t.ondragstart = (e) => e.dataTransfer.setData('text/forged-cphoto', String(i));
        t.ondragover = (e) => e.preventDefault();
        t.ondrop = (e) => { e.preventDefault(); const from = +e.dataTransfer.getData('text/forged-cphoto'); if (isNaN(from) || from === i) return; const [m] = st.photos.splice(from, 1); st.photos.splice(i, 0, m); buildStrip(); redraw(); };
        strip.append(t);
      });
      strip.append(el('button', { class: 'bin-add', title: 'Add photos', html: K.icon('plus', 20), onclick: addPhotos }));
    };
    async function addPhotos() {
      const files = window.native ? await window.native.openImages({ multi: true }) : await new Promise((res) => {
        const i = el('input', { type: 'file', accept: 'image/*', multiple: true });
        i.onchange = async () => { const out = []; for (const f of i.files) out.push({ kind: 'image', name: f.name, dataUrl: await U.blobToDataUrl(f) }); res(out); }; i.click();
      });
      for (const f of files || []) { if (f.kind !== 'image') continue; const c = U.imageToCanvas(await U.loadImage(f.dataUrl)); st.photos.push(await photoFromCanvas(c, f.name.replace(/\.[^.]+$/, ''))); }
      buildStrip(); redraw();
    }
    buildStrip();

    // preview interaction: click a cell to select, drag to pan the photo, wheel to zoom, drop thumbnails to swap
    const cellAt = (e) => { const r = preview.getBoundingClientRect(), mx = (e.clientX - r.left) * preview.width / r.width, my = (e.clientY - r.top) * preview.height / r.height; return (st._cells || []).findIndex((c) => mx >= c.sx && my >= c.sy && mx <= c.sx + c.sw && my <= c.sy + c.sh); };
    let drag = null;
    preview.onpointerdown = (e) => { const i = cellAt(e); st.sel = i; buildStrip(); redraw(); if (i >= 0 && st.photos[i]) { preview.setPointerCapture(e.pointerId); drag = { i, x: e.clientX, y: e.clientY, ox: st.photos[i].ox, oy: st.photos[i].oy }; } else if (i >= 0) addPhotos(); };
    preview.onpointermove = (e) => { if (!drag) return; const c = st._cells[drag.i], r = preview.getBoundingClientRect(), k = preview.width / r.width, p = st.photos[drag.i]; p.ox = drag.ox + (e.clientX - drag.x) * k / c.sw; p.oy = drag.oy + (e.clientY - drag.y) * k / c.sh; redraw(); };
    preview.onpointerup = () => { drag = null; };
    preview.onwheel = (e) => { const i = cellAt(e); if (i < 0 || !st.photos[i]) return; e.preventDefault(); const p = st.photos[i]; p.zoom = U.clamp(p.zoom * Math.exp(-e.deltaY * 0.002), 1, 6); redraw(); };
    preview.ondragover = (e) => e.preventDefault();
    preview.ondrop = (e) => { e.preventDefault(); const from = +e.dataTransfer.getData('text/forged-cphoto'), to = cellAt(e); if (isNaN(from) || to < 0 || to >= st.photos.length) return; [st.photos[from], st.photos[to]] = [st.photos[to], st.photos[from]]; buildStrip(); redraw(); };

    // settings
    const sizeSel = el('select', {}, SIZES.map(([k, l]) => el('option', { value: k, selected: k === st.sizeKey }, l)));
    const wIn = el('input', { type: 'number', class: 'num wide', value: st.W, min: 100, max: 12000 }), hIn = el('input', { type: 'number', class: 'num wide', value: st.H, min: 100, max: 12000 });
    const orient = el('div', { class: 'seg' }, el('button', { class: 'on', 'data-o': 'l' }, 'Landscape'), el('button', { 'data-o': 'p' }, 'Portrait'));
    const applySize = () => {
      st.sizeKey = sizeSel.value;
      const s = SIZES.find((x) => x[0] === sizeSel.value);
      if (s[0] !== 'custom') { const a = Math.max(s[2], s[3]), b = Math.min(s[2], s[3]); const land = s[2] >= s[3] ? st.landscape : !st.landscape; st.W = land ? a : b; st.H = land ? b : a; wIn.value = st.W; hIn.value = st.H; }
      wIn.disabled = hIn.disabled = s[0] !== 'custom'; redraw();
    };
    sizeSel.onchange = applySize;
    wIn.onchange = () => { st.W = U.clamp(+wIn.value, 100, 12000); redraw(); }; hIn.onchange = () => { st.H = U.clamp(+hIn.value, 100, 12000); redraw(); };
    orient.querySelectorAll('button').forEach((b) => { b.onclick = () => { st.landscape = b.dataset.o === 'l'; orient.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); if (sizeSel.value === 'custom') { [st.W, st.H] = [st.H, st.W]; wIn.value = st.W; hIn.value = st.H; redraw(); } else applySize(); }; });
    applySize();
    const S = UI().sliderControl;
    const bgIn = el('input', { type: 'color', value: st.o.bg }); bgIn.oninput = () => { st.o.bg = bgIn.value; redraw(); };
    const bcIn = el('input', { type: 'color', value: st.o.borderColor }); bcIn.oninput = () => { st.o.borderColor = bcIn.value; redraw(); };
    const shIn = el('input', { type: 'checkbox' }); shIn.onchange = () => { st.o.shadow = shIn.checked; redraw(); };
    const settings = el('div', { class: 'collage-settings' },
      el('h4', {}, 'Page'), el('label', { class: 'frow' }, el('span', {}, 'Size'), sizeSel),
      el('label', { class: 'frow' }, el('span', {}, 'W × H'), wIn, hIn, el('em', {}, 'px')), orient,
      el('h4', {}, 'Spacing & frames'),
      S('Margin', st.o.margin, 0, 15, 0.5, '%', (v) => { st.o.margin = v; redraw(); }),
      S('Gap', st.o.gap, 0, 10, 0.25, '%', (v) => { st.o.gap = v; redraw(); }),
      S('Corners', st.o.radius, 0, 25, 0.5, '%', (v) => { st.o.radius = v; redraw(); }),
      S('Border', st.o.border, 0, 5, 0.1, '%', (v) => { st.o.border = v; redraw(); }),
      el('label', { class: 'frow' }, el('span', {}, 'Border colour'), bcIn),
      el('label', { class: 'frow' }, el('span', {}, 'Background'), bgIn),
      el('label', { class: 'opt check' }, shIn, el('span', {}, 'Drop shadows')),
      el('div', { class: 'row' },
        el('button', { class: 'btn small', onclick: () => { for (let i = st.photos.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [st.photos[i], st.photos[j]] = [st.photos[j], st.photos[i]]; } st.o.seed = Math.floor(Math.random() * 1e6); buildStrip(); redraw(); } }, 'Shuffle'),
        el('button', { class: 'btn small', onclick: () => { st.photos.forEach((p) => { p.zoom = 1; p.ox = 0; p.oy = 0; }); redraw(); } }, 'Reset framing')));

    const body = el('div', { class: 'collage' },
      el('div', { class: 'collage-left' }, el('h4', {}, 'Layout'), lay),
      el('div', { class: 'collage-main' }, preview, el('p', { class: 'hint' }, 'Drag inside a frame to reposition a photo, scroll to zoom it, and drag thumbnails onto frames to swap. Click an empty frame to add photos.'), strip),
      settings);
    setTimeout(redraw, 0);
    const ok = await UI().modal({ title: 'Photo Collage', body, width: 1060, buttons: [['Cancel', false], ['Create Collage', true]] });
    if (!ok) return null;
    return UI().withBusy('Building collage…', () => build(st));
  }

  // ---------- build the real document ----------
  function frameLayer(d, cell, i, o) {
    const r = Math.min(d.w, d.h) * o.radius / 100, bw = Math.min(d.w, d.h) * o.border / 100;
    // bounding box of the (possibly rotated) frame
    const cos = Math.abs(Math.cos(cell.rot)), sin = Math.abs(Math.sin(cell.rot)), bwW = cell.w + 2 * bw, bwH = cell.h + 2 * bw;
    const bbW = Math.ceil(bwW * cos + bwH * sin) + 4, bbH = Math.ceil(bwW * sin + bwH * cos) + 4;
    const cx = cell.x + cell.w / 2, cy = cell.y + cell.h / 2;
    const mk = (fill, inset) => {
      const c = U.canvas(bbW, bbH), x = U.ctx(c); x.translate(bbW / 2, bbH / 2); x.rotate(cell.rot);
      x.fillStyle = fill; roundRect(x, -cell.w / 2 - inset, -cell.h / 2 - inset, cell.w + 2 * inset, cell.h + 2 * inset, r + inset); x.fill(); return c;
    };
    const lx = Math.round(cx - bbW / 2), ly = Math.round(cy - bbH / 2);
    const layers = [];
    if (bw > 0) layers.push(Lr.newLayer({ name: `Border ${i + 1}`, canvas: mk(o.borderColor, bw), x: lx, y: ly, style: o.shadow ? shadow(d) : null }));
    const F = Lr.newLayer({ name: `Frame ${i + 1}`, canvas: mk('#c9ccd1', 0), x: lx, y: ly, frame: { x: cell.x, y: cell.y, w: cell.w, h: cell.h, rot: cell.rot }, style: o.shadow && bw <= 0 ? shadow(d) : null });
    layers.push(F);
    return { layers, F };
  }
  const shadow = (d) => ({ shadow: { on: true, color: '#000000', opacity: 45, angle: 90, distance: Math.round(Math.min(d.w, d.h) * 0.008), blur: Math.round(Math.min(d.w, d.h) * 0.012) } });

  function photoLayer(F, img, name, zoom = 1, ox = 0, oy = 0) {
    const f = F.frame, s = Math.max(f.w / img.width, f.h / img.height) * zoom;
    const [dx, dy] = U.rot ? U.rot(ox * f.w, oy * f.h, f.rot) : [ox * f.w, oy * f.h];
    return Lr.newLayer({ type: 'smart', name: name || 'Photo', src: img, clip: true, t: { x: f.x + f.w / 2 + dx, y: f.y + f.h / 2 + dy, sx: s, sy: s, rot: f.rot } });
  }

  function build(st) {
    const a = app(), d = a.newDoc(st.W, st.H, st.o.bg, 'Collage ' + (a.docs.length + 1), /^(ig|ig45|story|fb|hd)$/.test(st.sizeKey) ? 72 : 300);
    d.layers[0].name = 'Background';
    const cells = layoutCells(st.layout, st.W, st.H, st.o);
    cells.forEach((cell, i) => {
      const { layers, F } = frameLayer(d, cell, i, st.o);
      for (const L of layers) d.layers.push(L);
      const p = st.photos[i];
      if (p) d.layers.push(photoLayer(F, p.full, p.name, p.zoom, p.ox, p.oy));
    });
    d.activeId = d.layers[d.layers.length - 1].id; d.changed(); d.push('Photo Collage');
    a.setTool('move'); UI().buildPanels(); UI().refreshAll(); a.view.fit();
    UI().toast('Collage created. Drag a photo from the Photo Bin onto a frame to replace it; use Move to adjust a photo inside its frame.', 4200);
    return d;
  }

  // Drop-into-frame: if `at` lands on a collage frame, the photo is clipped and fitted to it (replacing the old photo)
  function placeIntoFrame(d, canvas, name, at) {
    if (!d || !at) return null;
    const hit = (F) => { const f = F.frame, cx = f.x + f.w / 2, cy = f.y + f.h / 2; const [lx, ly] = U.rot ? U.rot(at[0] - cx, at[1] - cy, -f.rot) : [at[0] - cx, at[1] - cy]; return Math.abs(lx) <= f.w / 2 && Math.abs(ly) <= f.h / 2; };
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const F = d.layers[i]; if (!F.frame || !F.visible || !hit(F)) continue;
      // remove photos currently clipped to this frame
      let j = i + 1; while (j < d.layers.length && d.layers[j].clip) d.layers.splice(j, 1);
      const P = photoLayer(F, canvas, name); d.layers.splice(i + 1, 0, P); d.activeId = P.id; d.changed(); d.push('Place in Frame');
      return P;
    }
    return null;
  }

  K.Collage = { dialog, build, placeIntoFrame, LAYOUTS, layoutCells };
})(window.K);
