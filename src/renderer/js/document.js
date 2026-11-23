// Forged — document model, layers, compositing and history
(function (K) {
  'use strict';
  const U = K.U;

  const BLEND = {
    normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten',
    'color-dodge': 'color-dodge', 'color-burn': 'color-burn', 'hard-light': 'hard-light', 'soft-light': 'soft-light',
    difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
  };
  const BLEND_NAMES = { normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten', 'color-dodge': 'Colour Dodge', 'color-burn': 'Colour Burn', 'hard-light': 'Hard Light', 'soft-light': 'Soft Light', difference: 'Difference', exclusion: 'Exclusion', hue: 'Hue', saturation: 'Saturation', color: 'Colour', luminosity: 'Luminosity' };

  // ---------- Text rendering ----------
  function textFont(tp, scale = 1) {
    const px = Math.max(1, tp.size * scale);
    if (K.Fonts) return K.Fonts.css(tp, px);
    return `${tp.italic ? 'italic ' : ''}${tp.bold ? '700 ' : '400 '}${px}px "${tp.font}", -apple-system, sans-serif`;
  }
  function renderText(tp) {
    const lines = String(tp.text || '').split('\n');
    const probe = U.ctx(U.canvas(1, 1));
    probe.font = textFont(tp);
    try { probe.letterSpacing = (tp.tracking || 0) + 'px'; } catch (e) { /* older engines */ }
    const lh = tp.size * (tp.leading || 1.2);
    const widths = lines.map((l) => probe.measureText(l || ' ').width);
    const pad = Math.ceil(tp.size * 0.35);
    const w = Math.ceil(Math.max(4, ...widths)) + pad * 2, h = Math.ceil(lh * lines.length) + pad * 2;
    const c = U.canvas(w, h), x = U.ctx(c);
    x.font = textFont(tp);
    try { x.letterSpacing = (tp.tracking || 0) + 'px'; } catch (e) { /* ignore */ }
    x.fillStyle = tp.color; x.textBaseline = 'middle';
    lines.forEach((l, i) => {
      const y = pad + lh * i + lh / 2;
      let xx = pad;
      if (tp.align === 'center') xx = pad + (w - pad * 2 - widths[i]) / 2;
      else if (tp.align === 'right') xx = w - pad - widths[i];
      if (tp.underline) { x.fillRect(xx, y + tp.size * 0.42, widths[i], Math.max(1, tp.size / 16)); }
      x.fillText(l, xx, y);
    });
    return c;
  }

  // ---------- Layer helpers ----------
  function newLayer(props) {
    return Object.assign({ id: U.uid(), name: 'Layer', type: 'pixel', visible: true, opacity: 1, blend: 'normal', locked: false, clip: false, mask: null, maskOn: true, style: null, v: 1 }, props);
  }
  function srcOf(L) {
    if (L.type === 'text') {
      if (!L._text || L._textKey !== JSON.stringify(L.tp)) { L._text = renderText(L.tp); L._textKey = JSON.stringify(L.tp); }
      return L._text;
    }
    return L.src;
  }
  const isTransformable = (L) => L && (L.type === 'smart' || L.type === 'text');

  // Corners of a layer in document space
  function corners(L) {
    if (isTransformable(L)) {
      const s = srcOf(L), hw = s.width / 2, hh = s.height / 2, t = L.t;
      return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => { const [rx, ry] = U.rot(x * t.sx, y * t.sy, t.rot); return [t.x + rx, t.y + ry]; });
    }
    if (L.type === 'pixel') return [[L.x, L.y], [L.x + L.canvas.width, L.y], [L.x + L.canvas.width, L.y + L.canvas.height], [L.x, L.y + L.canvas.height]];
    return null;
  }
  function bboxOf(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  // Bounds of non-transparent content
  function alphaBounds(c) {
    const d = U.getData(c).data, w = c.width, h = c.height;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function contentBounds(L) {
    if (isTransformable(L)) return bboxOf(corners(L));
    if (L.type === 'pixel') {
      if (L._cbV !== L.v || L._cbC !== L.canvas) { L._cb = alphaBounds(L.canvas); L._cbV = L.v; L._cbC = L.canvas; }
      return L._cb ? { x: L._cb.x + L.x, y: L._cb.y + L.y, w: L._cb.w, h: L._cb.h } : null;
    }
    return null;
  }
  function drawContent(ctx, L, doc) {
    if (L.type === 'pixel') ctx.drawImage(L.canvas, L.x, L.y);
    else if (isTransformable(L)) {
      const s = srcOf(L), t = L.t;
      ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(t.rot); ctx.scale(t.sx, t.sy);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(s, -s.width / 2, -s.height / 2); ctx.restore();
    } else if (L.type === 'fill') { ctx.fillStyle = L.color; ctx.fillRect(0, 0, doc.w, doc.h); }
  }

  // Apply layer style effects behind/around content
  function applyStyle(c, style) {
    if (!style) return c;
    const w = c.width, h = c.height, out = U.canvas(w, h), o = U.ctx(out);
    const silhouette = (color) => { const s = U.canvas(w, h), x = U.ctx(s); x.drawImage(c, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, w, h); return s; };
    if (style.shadow && style.shadow.on) {
      const sh = style.shadow, a = sh.angle * Math.PI / 180, sil = silhouette(sh.color);
      o.save(); o.globalAlpha = sh.opacity / 100; o.filter = sh.blur > 0 ? `blur(${sh.blur}px)` : 'none';
      o.drawImage(sil, -Math.cos(a) * sh.distance, Math.sin(a) * sh.distance); o.restore();
    }
    if (style.glow && style.glow.on) {
      const g = style.glow, sil = silhouette(g.color);
      o.save(); o.globalAlpha = g.opacity / 100; o.filter = `blur(${Math.max(1, g.size)}px)`;
      for (let i = 0; i < 2; i++) o.drawImage(sil, 0, 0); o.restore();
    }
    if (style.stroke && style.stroke.on) {
      const st = style.stroke, sil = silhouette(st.color), n = Math.max(12, Math.round(st.size * 4));
      o.save(); o.globalAlpha = st.opacity / 100;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; o.drawImage(sil, Math.cos(a) * st.size, Math.sin(a) * st.size); }
      for (let r = st.size - 1; r > 0; r -= 1.5) for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; o.drawImage(sil, Math.cos(a) * r, Math.sin(a) * r); }
      o.restore();
    }
    o.drawImage(c, 0, 0);
    return out;
  }

  class Doc {
    constructor(w, h, name = 'Untitled') {
      this.id = U.uid();
      this.w = Math.round(w); this.h = Math.round(h);
      this.name = name; this.path = null;
      this.layers = []; this.activeId = null;
      this.sel = null;
      this.history = []; this.hIndex = -1;
      this.dirty = true; this.modified = false;
      this.view = { zoom: 1, panX: 0, panY: 0, fitted: false };
      this.guides = []; // {axis:'v'|'h', pos:px}
      this.ppi = 72; // print resolution (pixels per inch), used for rulers and units
      this.origin = [0, 0]; // ruler zero point in document pixels
      this.live = null; // live brush stroke preview {layerId, canvas, op, opacity}
      this.listeners = new Set();
      this._composite = null;
    }
    get active() { return this.layers.find((l) => l.id === this.activeId) || this.layers[this.layers.length - 1] || null; }
    layerIndex(L) { return this.layers.indexOf(L); }
    setActive(L) { this.activeId = L ? L.id : null; this.emit('layers'); }
    emit(what) { for (const fn of this.listeners) fn(what); }
    touch(L) { if (L) L.v = (L.v || 0) + 1; this.dirty = true; this.modified = true; this.emit('pixels'); }
    changed() { this.dirty = true; this.modified = true; this.emit('layers'); }

    // ----- copy-on-write for canvases referenced by history -----
    writable(L, key = 'canvas') {
      if (L[key] && L[key].__frozen) L[key] = U.clone(L[key]);
      return L[key];
    }
    ensureCovers(L) {
      if (L.type !== 'pixel') return;
      const x0 = Math.min(L.x, 0), y0 = Math.min(L.y, 0);
      const x1 = Math.max(L.x + L.canvas.width, this.w), y1 = Math.max(L.y + L.canvas.height, this.h);
      if (x0 === L.x && y0 === L.y && x1 === L.x + L.canvas.width && y1 === L.y + L.canvas.height) return;
      const c = U.canvas(x1 - x0, y1 - y0); U.ctx(c).drawImage(L.canvas, L.x - x0, L.y - y0);
      L.canvas = c; L.x = x0; L.y = y0;
    }

    // ----- layers -----
    addLayer(L, index) {
      if (index === undefined) { const a = this.active; index = a ? this.layerIndex(a) + 1 : this.layers.length; }
      this.layers.splice(index, 0, L); this.activeId = L.id; this.changed(); return L;
    }
    addPixelLayer(name, index) { return this.addLayer(newLayer({ name: name || this.nextName('Layer'), canvas: U.canvas(this.w, this.h), x: 0, y: 0 }), index); }
    nextName(base) { let n = 1; const names = new Set(this.layers.map((l) => l.name)); while (names.has(`${base} ${n}`)) n++; return `${base} ${n}`; }
    removeLayer(L) {
      const i = this.layerIndex(L); if (i < 0) return;
      this.layers.splice(i, 1);
      const next = this.layers[Math.min(i, this.layers.length - 1)] || null; this.activeId = next ? next.id : null;
      this.changed();
    }
    rasterize(L) {
      if (L.type === 'pixel') return L;
      if (L.type === 'fill' || L.type === 'adjust') {
        const c = U.canvas(this.w, this.h);
        if (L.type === 'fill') { const x = U.ctx(c); x.fillStyle = L.color; x.fillRect(0, 0, this.w, this.h); }
        Object.assign(L, { type: 'pixel', canvas: c, x: 0, y: 0 }); delete L.adj; delete L.color;
      } else {
        const b = bboxOf(corners(L)); const x0 = Math.floor(b.x), y0 = Math.floor(b.y);
        const c = U.canvas(Math.ceil(b.x + b.w) - x0 + 1, Math.ceil(b.y + b.h) - y0 + 1), x = U.ctx(c);
        x.translate(-x0, -y0); drawContent(x, L, this);
        Object.assign(L, { type: 'pixel', canvas: c, x: x0, y: y0 }); delete L.t; delete L.src; delete L.tp; delete L._text;
      }
      this.touch(L); this.emit('layers'); return L;
    }
    toSmart(L) {
      if (L.type !== 'pixel') return L;
      const b = alphaBounds(L.canvas);
      if (!b) return L;
      const src = U.canvas(b.w, b.h); U.ctx(src).drawImage(L.canvas, -b.x, -b.y);
      Object.assign(L, { type: 'smart', src, t: { x: L.x + b.x + b.w / 2, y: L.y + b.y + b.h / 2, sx: 1, sy: 1, rot: 0 } });
      delete L.canvas; delete L.x; delete L.y;
      this.touch(L); return L;
    }

    // ----- compositing -----
    renderLayer(L) {
      const live = this.live && this.live.layerId === L.id ? this.live : null;
      if (!live && L._rc && L._rcV === L.v && L._rcW === this.w && L._rcH === this.h) return L._rc;
      let c = U.canvas(this.w, this.h); const x = U.ctx(c);
      drawContent(x, L, this);
      if (live && live.target === 'layer') {
        x.save(); x.globalAlpha = live.opacity; x.globalCompositeOperation = live.op === 'erase' ? 'destination-out' : 'source-over';
        x.drawImage(live.canvas, 0, 0); x.restore();
      }
      const plain = L.style ? c : null; // unstyled pixels: clipping masks use these so shadows/glows don't leak
      c = applyStyle(c, L.style);
      let mask = L.mask && L.maskOn ? L.mask : null;
      if (live && live.target === 'mask' && L.mask) {
        const m = U.clone(L.mask), mx = U.ctx(m);
        mx.globalAlpha = live.opacity; mx.globalCompositeOperation = live.op === 'hide' ? 'destination-out' : 'source-over';
        mx.drawImage(live.canvas, 0, 0); mask = m;
      }
      if (mask) { for (const t of plain ? [c, plain] : [c]) { const cx = U.ctx(t); cx.globalCompositeOperation = 'destination-in'; cx.drawImage(mask, 0, 0); cx.globalCompositeOperation = 'source-over'; } }
      c._plain = plain;
      if (!live) { L._rc = c; L._rcV = L.v; L._rcW = this.w; L._rcH = this.h; }
      return c;
    }
    compositeLayers(layers, opts = {}) {
      const out = U.canvas(this.w, this.h), o = U.ctx(out);
      if (opts.background) { o.fillStyle = opts.background; o.fillRect(0, 0, this.w, this.h); }
      let base = null;
      for (const L of layers) {
        if (!L.visible) { if (!L.clip) base = null; continue; }
        let lc;
        if (L.type === 'adjust') {
          const data = o.getImageData(0, 0, this.w, this.h);
          K.Adjust.apply(L.adj.kind, L.adj.params, data);
          lc = U.fromData(data);
          const mask = L.mask && L.maskOn ? L.mask : null;
          if (mask) { const x = U.ctx(lc); x.globalCompositeOperation = 'destination-in'; x.drawImage(mask, 0, 0); }
          if (this.live && this.live.layerId === L.id && this.live.target === 'mask') {
            lc = U.fromData(data); const m = U.clone(L.mask), mx = U.ctx(m);
            mx.globalAlpha = this.live.opacity; mx.globalCompositeOperation = this.live.op === 'hide' ? 'destination-out' : 'source-over'; mx.drawImage(this.live.canvas, 0, 0);
            const x = U.ctx(lc); x.globalCompositeOperation = 'destination-in'; x.drawImage(m, 0, 0);
          }
        } else lc = this.renderLayer(L);
        if (L.clip && base) {
          const t = U.clone(lc), x = U.ctx(t); x.globalCompositeOperation = 'destination-in'; x.drawImage(base, 0, 0); lc = t;
        } else if (!L.clip) base = L.type === 'adjust' ? null : (lc._plain || lc);
        o.save(); o.globalAlpha = L.opacity; o.globalCompositeOperation = BLEND[L.blend] || 'source-over';
        o.drawImage(lc, 0, 0); o.restore();
      }
      return out;
    }
    composite() {
      if (this.dirty || !this._composite || this.live) {
        this._composite = this.compositeLayers(this.layers);
        this.dirty = !!this.live;
      }
      return this._composite;
    }

    // ----- history -----
    snapshot() {
      const freeze = (c) => { if (c) c.__frozen = true; return c; };
      return {
        w: this.w, h: this.h, activeId: this.activeId, sel: this.sel, guides: this.guides.map((g) => ({ axis: g.axis, pos: g.pos })), ppi: this.ppi, origin: this.origin.slice(),
        layers: this.layers.map((L) => {
          freeze(L.canvas); freeze(L.mask); freeze(L.src);
          const r = Object.assign({}, L);
          delete r._rc; delete r._text; delete r._cb;
          if (L.t) r.t = Object.assign({}, L.t);
          if (L.tp) r.tp = Object.assign({}, L.tp);
          if (L.adj) r.adj = JSON.parse(JSON.stringify(L.adj));
          if (L.style) r.style = JSON.parse(JSON.stringify(L.style));
          return r;
        }),
      };
    }
    restore(s) {
      this.w = s.w; this.h = s.h; this.activeId = s.activeId; this.sel = s.sel; this.guides = s.guides.map((g) => ({ axis: g.axis, pos: g.pos })); this.ppi = s.ppi || 72; this.origin = (s.origin || [0, 0]).slice();
      this.layers = s.layers.map((r) => {
        const L = Object.assign({}, r);
        if (r.t) L.t = Object.assign({}, r.t);
        if (r.tp) L.tp = Object.assign({}, r.tp);
        if (r.adj) L.adj = JSON.parse(JSON.stringify(r.adj));
        if (r.style) L.style = JSON.parse(JSON.stringify(r.style));
        L.v = (L.v || 0) + 1000;
        return L;
      });
      this.dirty = true; this.emit('layers'); this.emit('selection'); this.emit('history');
    }
    push(label) {
      this.history = this.history.slice(0, this.hIndex + 1);
      this.history.push({ label, state: this.snapshot(), time: Date.now() });
      const limit = (K.prefs && K.prefs.historyLimit) || 50;
      while (this.history.length > limit) this.history.shift();
      this.hIndex = this.history.length - 1;
      if (this.history.length > 1) this.modified = true;
      this.emit('history');
    }
    undo() { if (this.hIndex > 0) { this.hIndex--; this.restore(this.history[this.hIndex].state); this.modified = true; } }
    redo() { if (this.hIndex < this.history.length - 1) { this.hIndex++; this.restore(this.history[this.hIndex].state); this.modified = true; } }
    jump(i) { if (i >= 0 && i < this.history.length) { this.hIndex = i; this.restore(this.history[i].state); } }

    // ----- whole-document geometry -----
    _remapMasks(fn, W, H) {
      for (const L of this.layers) if (L.mask) { const m = U.canvas(W, H), x = U.ctx(m); fn(x, L.mask); L.mask = m; }
    }
    translateAll(dx, dy, W, H) {
      for (const L of this.layers) {
        if (L.type === 'pixel') { L.x += dx; L.y += dy; }
        else if (L.t) { L.t.x += dx; L.t.y += dy; }
        L.v++;
      }
      this._remapMasks((x, m) => { x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.clearRect(dx, dy, m.width, m.height); x.drawImage(m, dx, dy); }, W, H);
      this.guides = this.guides.map((g) => ({ axis: g.axis, pos: g.pos + (g.axis === 'v' ? dx : dy) })).filter((g) => g.pos >= 0 && g.pos <= (g.axis === 'v' ? W : H));
      this.origin = [0, 0];
      this.w = W; this.h = H; this.sel = null; this.changed();
    }
    rotateAll(deg) {
      const a = deg * Math.PI / 180, cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
      const W = Math.round(this.w * cos + this.h * sin), H = Math.round(this.w * sin + this.h * cos);
      const ocx = this.w / 2, ocy = this.h / 2, ncx = W / 2, ncy = H / 2;
      const mapPt = (x, y) => { const [rx, ry] = U.rot(x - ocx, y - ocy, a); return [ncx + rx, ncy + ry]; };
      for (const L of this.layers) {
        if (L.type === 'pixel') {
          const pts = corners(L).map(([x, y]) => mapPt(x, y)), b = bboxOf(pts);
          const c = U.canvas(Math.ceil(b.w), Math.ceil(b.h)), x = U.ctx(c);
          x.imageSmoothingQuality = 'high';
          x.translate(-b.x, -b.y); x.translate(ncx, ncy); x.rotate(a); x.translate(-ocx, -ocy);
          x.drawImage(L.canvas, L.x, L.y);
          L.canvas = c; L.x = Math.round(b.x); L.y = Math.round(b.y);
        } else if (L.t) { const [nx, ny] = mapPt(L.t.x, L.t.y); L.t.x = nx; L.t.y = ny; L.t.rot += a; }
        L.v++;
      }
      this._remapMasks((x, m) => { x.translate(ncx, ncy); x.rotate(a); x.drawImage(m, -ocx, -ocy); }, W, H);
      this.w = W; this.h = H; this.sel = null; this.guides = []; this.origin = [0, 0]; this.changed();
    }
    flipAll(axis) {
      const W = this.w, H = this.h;
      for (const L of this.layers) {
        if (L.type === 'pixel') {
          const c = U.canvas(L.canvas.width, L.canvas.height), x = U.ctx(c);
          if (axis === 'h') { x.translate(c.width, 0); x.scale(-1, 1); L.x = W - (L.x + c.width); }
          else { x.translate(0, c.height); x.scale(1, -1); L.y = H - (L.y + c.height); }
          x.drawImage(L.canvas, 0, 0); L.canvas = c;
        } else if (L.t) {
          if (axis === 'h') { L.t.x = W - L.t.x; L.t.sx = -L.t.sx; } else { L.t.y = H - L.t.y; L.t.sy = -L.t.sy; }
          L.t.rot = -L.t.rot;
        }
        L.v++;
      }
      this._remapMasks((x, m) => { if (axis === 'h') { x.translate(W, 0); x.scale(-1, 1); } else { x.translate(0, H); x.scale(1, -1); } x.drawImage(m, 0, 0); }, W, H);
      this.sel = null; this.changed();
    }
    resizeAll(W, H) {
      W = Math.max(1, Math.round(W)); H = Math.max(1, Math.round(H));
      const fx = W / this.w, fy = H / this.h;
      for (const L of this.layers) {
        if (L.type === 'pixel') { L.canvas = U.resample(L.canvas, L.canvas.width * fx, L.canvas.height * fy); L.x = Math.round(L.x * fx); L.y = Math.round(L.y * fy); }
        else if (L.t) { L.t.x *= fx; L.t.y *= fy; L.t.sx *= fx; L.t.sy *= fy; }
        if (L.mask) L.mask = U.resample(L.mask, W, H);
        L.v++;
      }
      this.guides = this.guides.map((g) => ({ axis: g.axis, pos: Math.round(g.pos * (g.axis === 'v' ? fx : fy)) }));
      this.origin = [this.origin[0] * fx, this.origin[1] * fy];
      this.w = W; this.h = H; this.sel = null; this.changed();
    }
  }

  K.Doc = Doc;
  K.Layers = { newLayer, srcOf, isTransformable, corners, bboxOf, alphaBounds, contentBounds, drawContent, renderText, textFont, applyStyle, BLEND, BLEND_NAMES };
})(window.K);
