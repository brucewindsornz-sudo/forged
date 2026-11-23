// Forged — tools
(function (K) {
  'use strict';
  const U = K.U, L_ = K.Layers;
  const app = () => K.app;
  const doc = () => K.app.doc;
  const toast = (m) => K.UI.toast(m);
  const view = () => K.app.view;

  // ---------- option spec helpers ----------
  const O = {
    size: (def = 30, max = 1000) => ({ key: 'size', label: 'Size', type: 'range', min: 1, max, def, unit: 'px', log: true }),
    hardness: (def = 70) => ({ key: 'hardness', label: 'Hardness', type: 'range', min: 0, max: 100, def, unit: '%' }),
    opacity: (def = 100) => ({ key: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, def, unit: '%' }),
    flow: (def = 100) => ({ key: 'flow', label: 'Flow', type: 'range', min: 1, max: 100, def, unit: '%' }),
    strength: (def = 50) => ({ key: 'strength', label: 'Strength', type: 'range', min: 1, max: 100, def, unit: '%' }),
    selMode: () => ({ key: 'mode', label: '', type: 'buttons', def: 'new', options: [['new', 'New', 'sel-new'], ['add', 'Add', 'sel-add'], ['sub', 'Subtract', 'sel-sub'], ['int', 'Intersect', 'sel-int']] }),
    feather: () => ({ key: 'feather', label: 'Feather', type: 'number', min: 0, max: 250, def: 0, unit: 'px' }),
    allLayers: (def = false) => ({ key: 'allLayers', label: 'Sample all layers', type: 'check', def }),
  };

  function selModeFromEvent(e, base) {
    // With no active selection, Shift constrains and Option draws from centre (handled by the tool)
    if (!K.app.doc || !K.app.doc.sel) return base;
    if (e.shiftKey && e.altKey) return 'int';
    if (e.shiftKey) return 'add';
    if (e.altKey) return 'sub';
    return base;
  }

  // ---------- painting helpers ----------
  function dabCanvas(r, hard, color) {
    const s = Math.max(2, Math.ceil(r * 2) + 2), c = U.canvas(s, s), x = U.ctx(c), m = s / 2;
    const [cr, cg, cb] = U.hexToRgb(color);
    if (hard >= 0.999) { x.fillStyle = `rgb(${cr},${cg},${cb})`; x.beginPath(); x.arc(m, m, r, 0, Math.PI * 2); x.fill(); return c; }
    const g = x.createRadialGradient(m, m, 0, m, m, r);
    g.addColorStop(0, `rgba(${cr},${cg},${cb},1)`); g.addColorStop(Math.max(0.01, hard), `rgba(${cr},${cg},${cb},1)`); g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    x.fillStyle = g; x.fillRect(0, 0, s, s); return c;
  }

  function paintTarget(opts = {}) {
    const d = doc(); if (!d) return null;
    let L = d.active; if (!L) { toast('Add a layer first'); return null; }
    if (L.locked) { toast('This layer is locked'); return null; }
    if (!L.visible) { toast('The active layer is hidden'); return null; }
    if (app().editMask && L.mask) return { L, target: 'mask' };
    if (L.type === 'adjust' || L.type === 'fill') {
      if (L.mask) { app().editMask = true; K.UI.refreshLayers(); return { L, target: 'mask' }; }
      toast('Select a pixel layer, or add a layer mask to paint on'); return null;
    }
    if (opts.maskOnly) return null;
    if (L.type !== 'pixel') { d.rasterize(L); toast(`“${L.name}” was rasterised for painting`); }
    d.writable(L); d.ensureCovers(L);
    return { L, target: 'layer' };
  }

  // Stroke interpolation
  function strokePoints(last, p, spacing, fn) {
    if (!last) { fn(p[0], p[1]); return p; }
    const dx = p[0] - last[0], dy = p[1] - last[1], dist = Math.hypot(dx, dy);
    if (dist < spacing) return last;
    const n = Math.floor(dist / spacing);
    let cx = last[0], cy = last[1];
    for (let i = 1; i <= n; i++) { cx = last[0] + dx * (i * spacing / dist); cy = last[1] + dy * (i * spacing / dist); fn(cx, cy); }
    return [cx, cy];
  }

  function brushCursor(x, v, px, size) {
    const p = v.cursorPos; if (!p) return;
    if (K.app.preciseCursor) { // Caps Lock: precise cross hair
      const r = 7 * px; for (const [c, w] of [['rgba(0,0,0,0.8)', 3 * px], ['#fff', px]]) { x.strokeStyle = c; x.lineWidth = w; x.beginPath(); x.moveTo(p[0] - r, p[1]); x.lineTo(p[0] + r, p[1]); x.moveTo(p[0], p[1] - r); x.lineTo(p[0], p[1] + r); x.stroke(); }
      return;
    }
    x.lineWidth = px; x.strokeStyle = 'rgba(0,0,0,0.8)'; x.beginPath(); x.arc(p[0], p[1], Math.max(size / 2, px * 2), 0, Math.PI * 2); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.9)'; x.beginPath(); x.arc(p[0], p[1], Math.max(size / 2 - px, px), 0, Math.PI * 2); x.stroke();
  }

  // ---------- Brush-type tool factory (brush, pencil, eraser) ----------
  function makeBrush(id, name, key, extra = {}) {
    return Object.assign({
      id, name, hotkey: key, cursor: 'none',
      optionSpec: [...(id === 'eraser' ? [{ key: 'etype', label: 'Type', type: 'buttons', def: 'brush', options: [['brush', 'Brush'], ['pencil', 'Pencil'], ['block', 'Block']] }] : []),
        O.size(id === 'pencil' ? 4 : 30), ...(id === 'pencil' ? [] : [O.hardness(id === 'eraser' ? 80 : 60)]), O.opacity(), ...(id === 'pencil' ? [] : [O.flow()]),
        ...(id === 'brush' ? [{ key: 'blend', label: 'Mode', type: 'select', def: 'normal', options: Object.entries(L_.BLEND_NAMES) }] : [])],
      down(e, p) {
        const t = paintTarget(); if (!t) return;
        const o = this.o, d = doc();
        if (e.altKey && id !== 'eraser') { K.tools.eyedropper.sample(p, false); return; }
        const erase = id === 'eraser';
        let op;
        if (t.target === 'mask') {
          const lum = U.lum(...U.hexToRgb(app().fg));
          op = erase ? (lum < 128 ? 'reveal' : 'hide') : (lum < 128 ? 'hide' : 'reveal');
        } else op = erase ? 'erase' : 'paint';
        const color = t.target === 'mask' ? '#ffffff' : (erase ? '#000000' : app().fg);
        const et = erase ? o.etype : null;
        const hard = id === 'pencil' || et === 'pencil' ? 1 : o.hardness / 100;
        const r = o.size / 2;
        if (et === 'block') { const bs = Math.max(1, Math.round(o.size)); this.dab = U.canvas(bs, bs); const bx = U.ctx(this.dab); bx.fillStyle = color; bx.fillRect(0, 0, bs, bs); }
        else this.dab = dabCanvas(r, hard, color);
        this.hardEdge = id === 'pencil' || et === 'pencil' || et === 'block';
        this.raw = U.canvas(d.w, d.h); this.rawX = U.ctx(this.raw);
        this.stroke = { t, op, r, flow: (o.flow || 100) / 100 };
        d.live = { layerId: t.L.id, target: t.target, op, opacity: o.opacity / 100, canvas: this.raw };
        this.last = null; this.lineFrom = e.shiftKey && this.prevEnd ? this.prevEnd : null;
        if (this.lineFrom) { this.last = this.lineFrom; }
        this.paintTo(p);
      },
      paintTo(p) {
        const s = this.stroke; if (!s) return;
        const spacing = Math.max(1, s.r * (this.hardEdge ? 0.25 : 0.12));
        this.last = strokePoints(this.last, p, spacing, (x, y) => {
          this.rawX.globalAlpha = s.flow;
          if (this.hardEdge) { this.rawX.imageSmoothingEnabled = false; this.rawX.drawImage(this.dab, Math.round(x - this.dab.width / 2), Math.round(y - this.dab.height / 2)); }
          else this.rawX.drawImage(this.dab, x - this.dab.width / 2, y - this.dab.height / 2);
        });
        this.updateLive();
      },
      updateLive() {
        const d = doc(); if (!d.live) return;
        d.live.canvas = d.sel ? K.Sel.clip(d, U.clone(this.raw)) : this.raw;
        d.dirty = true; view().requestRender();
      },
      move(e, p) { if (this.stroke) this.paintTo(p); },
      up() {
        const s = this.stroke; if (!s) return;
        const d = doc(), L = s.t.L, strokeC = d.live.canvas;
        if (s.target === 'mask') {
          const m = d.writable(L, 'mask'), x = U.ctx(m);
          x.globalAlpha = this.o.opacity / 100; x.globalCompositeOperation = s.op === 'hide' ? 'destination-out' : 'source-over'; x.drawImage(strokeC, 0, 0);
        } else {
          const x = U.ctx(L.canvas);
          x.save(); x.globalAlpha = this.o.opacity / 100;
          x.globalCompositeOperation = s.op === 'erase' ? 'destination-out' : (L_.BLEND[this.o.blend] || 'source-over');
          if (L.lockAlpha && s.op !== 'erase') { // Lock transparent pixels: paint only where the layer already has pixels
            const c2 = U.clone(strokeC), c2x = U.ctx(c2); c2x.globalCompositeOperation = 'destination-in'; c2x.drawImage(L.canvas, L.x, L.y); x.drawImage(c2, -L.x, -L.y);
          } else x.drawImage(strokeC, -L.x, -L.y);
          x.restore();
        }
        d.live = null; d.touch(L); d.push(name);
        this.prevEnd = this.last; this.stroke = null; K.UI.refreshLayers();
      },
      overlay(x, v, px) {
        if (id === 'eraser' && this.o.etype === 'block' && v.cursorPos && !K.app.preciseCursor) { const p = v.cursorPos, h = this.o.size / 2; x.lineWidth = px; x.strokeStyle = 'rgba(0,0,0,0.8)'; x.strokeRect(p[0] - h, p[1] - h, h * 2, h * 2); x.strokeStyle = '#fff'; x.strokeRect(p[0] - h + px, p[1] - h + px, h * 2 - 2 * px, h * 2 - 2 * px); return; }
        brushCursor(x, v, px, this.o.size);
      },
    }, extra);
  }

  // ---------- Retouch tools (dab-based direct pixel edits) ----------
  function makeRetouch(id, name, key, optionSpec, process) {
    return {
      id, name, hotkey: key, cursor: 'none', optionSpec,
      down(e, p) {
        const t = paintTarget(); if (!t || t.target === 'mask') { if (t) toast('Retouch tools work on pixels, not masks'); return; }
        this.t = t; this.last = null; this.state = {};
        if (this.begin && this.begin(e, p) === false) { this.t = null; return; }
        this.dabAt(p);
      },
      dabAt(p) {
        const r = this.o.size / 2;
        this.last = strokePoints(this.last, p, Math.max(1, r * 0.25), (x, y) => this.applyDab(x, y, r));
        doc().touch(this.t.L); view().requestRender();
      },
      applyDab(cx, cy, r) {
        const L = this.t.L, d = doc();
        const lx = Math.floor(cx - r - L.x - 2), ly = Math.floor(cy - r - L.y - 2), s = Math.ceil(r * 2 + 4);
        const x0 = Math.max(0, lx), y0 = Math.max(0, ly), x1 = Math.min(L.canvas.width, lx + s), y1 = Math.min(L.canvas.height, ly + s);
        if (x1 <= x0 || y1 <= y0) return;
        const ctx = U.ctx(L.canvas), data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
        const w = x1 - x0, h = y1 - y0, weights = new Float32Array(w * h);
        const sel = d.sel ? U.ctx(d.sel.canvas).getImageData(x0 + L.x, y0 + L.y, w, h).data : null;
        const hard = (this.o.hardness === undefined ? 50 : this.o.hardness) / 100;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const dist = Math.hypot(x + x0 + L.x + 0.5 - cx, y + y0 + L.y + 0.5 - cy) / r;
          let wgt = dist >= 1 ? 0 : dist <= hard ? 1 : 1 - (dist - hard) / (1 - hard);
          if (sel) wgt *= sel[(y * w + x) * 4 + 3] / 255;
          weights[y * w + x] = wgt;
        }
        process.call(this, data, weights, { x0, y0, w, h, cx: cx - L.x - x0, cy: cy - L.y - y0, r, L });
        ctx.putImageData(data, x0, y0);
      },
      move(e, p) { if (this.placing && e.altKey && this.source) { this.source = [p[0], p[1]]; view().requestRender(); return; } if (this.t) this.dabAt(p); },
      up() { if (this.placing) { this.placing = false; view().requestRender(); } if (!this.t) return; if (this.end) this.end(); doc().push(name); this.t = null; K.UI.refreshLayers(); },
      overlay(x, v, px) { brushCursor(x, v, px, this.o.size); if (this.extraOverlay) this.extraOverlay(x, v, px); },
    };
  }

  const tools = {};

  // ===== Move / transform =====
  tools.move = {
    id: 'move', name: 'Move', hotkey: 'v', cursor: 'default',
    optionSpec: [
      { key: 'autoSelect', label: 'Auto-select layer', type: 'check', def: true },
      { key: 'showBox', label: 'Show bounding box', type: 'check', def: true },
      { key: 'snap', label: 'Snap', type: 'check', def: true },
      { key: 'constrain', label: 'Constrain proportions', type: 'check', def: true },
      { key: 'transform', type: 'transformFields' },
      { key: 'align', type: 'alignButtons' },
    ],
    handles(L) {
      if (!L || (L.type !== 'smart' && L.type !== 'text' && L.type !== 'pixel')) return null;
      let pts;
      if (L.type === 'pixel') { const b = L_.contentBounds(L); if (!b) return null; pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]; }
      else pts = L_.corners(L);
      const scr = pts.map((q) => view().toScreen(...q));
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const hs = [
        { hx: -1, hy: -1, p: scr[0] }, { hx: 1, hy: -1, p: scr[1] }, { hx: 1, hy: 1, p: scr[2] }, { hx: -1, hy: 1, p: scr[3] },
        { hx: 0, hy: -1, p: mid(scr[0], scr[1]) }, { hx: 1, hy: 0, p: mid(scr[1], scr[2]) }, { hx: 0, hy: 1, p: mid(scr[2], scr[3]) }, { hx: -1, hy: 0, p: mid(scr[3], scr[0]) },
      ];
      const top = mid(scr[0], scr[1]), c = mid(scr[0], scr[2]);
      const dx = top[0] - c[0], dy = top[1] - c[1], len = Math.hypot(dx, dy) || 1;
      const rotK = [top[0] + dx / len * 26, top[1] + dy / len * 26];
      return { scr, hs, rotK, center: c };
    },
    hit(sx, sy) {
      const L = doc().active; if (!this.o.showBox || !L || L.locked) return null;
      const H = this.handles(L); if (!H) return null;
      if (Math.hypot(sx - H.rotK[0], sy - H.rotK[1]) < 9) return { kind: 'rotate' };
      for (const h of H.hs) if (Math.abs(sx - h.p[0]) < 7 && Math.abs(sy - h.p[1]) < 7) return { kind: 'scale', hx: h.hx, hy: h.hy };
      for (const q of H.scr) if (Math.hypot(sx - q[0], sy - q[1]) < 26 && !pointInPoly([sx, sy], H.scr)) return { kind: 'rotate' };
      return null;
    },
    hover(p, e, sx, sy) {
      const h = this.hit(sx, sy);
      const el = view().c;
      if (!h) el.style.cursor = 'default';
      else if (h.kind === 'rotate') el.style.cursor = 'grab';
      else { const L = doc().active; const rot = L.t ? L.t.rot : 0; const a = Math.atan2(h.hy, h.hx) + rot; const oct = Math.round(((a * 180 / Math.PI) + 360) % 180 / 45) % 4; el.style.cursor = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][oct]; }
    },
    down(e, p, sx, sy) {
      const d = doc(); this.drag = null;
      const h = this.hit(sx, sy);
      let L = d.active;
      if (h) {
        if (L.type === 'pixel') d.toSmart(L);
        this.drag = { kind: h.kind, hx: h.hx, hy: h.hy, t0: Object.assign({}, L.t), start: p, L };
        return;
      }
      if (this.o.autoSelect && !e.metaKey) {
        const picked = pickLayer(d, p);
        if (picked && picked !== L) { d.setActive(picked); L = picked; app().editMask = false; K.UI.refreshLayers(); }
      }
      if (!L || L.locked) { if (L && L.locked) toast('This layer is locked'); return; }
      if (L.type === 'adjust' || L.type === 'fill') return;
      // Move selected pixels
      if (d.sel && L.type === 'pixel' && selAlphaAt(d, p) > 0) {
        d.writable(L); d.ensureCovers(L);
        const float = K.Sel.clip(d, U.clone(d.renderLayerContentOnly ? d.renderLayerContentOnly(L) : contentOnly(d, L)));
        if (!e.altKey) { const x = U.ctx(L.canvas); x.save(); x.globalCompositeOperation = 'destination-out'; x.drawImage(d.sel.canvas, -L.x, -L.y); x.restore(); d.touch(L); }
        this.drag = { kind: 'float', start: p, L, float, sel0: d.sel, dx: 0, dy: 0 };
        d.live = { layerId: L.id, target: 'layer', op: 'paint', opacity: 1, canvas: float };
        return;
      }
      if (e.altKey) { const c = duplicateLayer(d, L); L = c; }
      this.drag = { kind: 'move', start: p, L, x0: L.type === 'pixel' ? L.x : L.t.x, y0: L.type === 'pixel' ? L.y : L.t.y };
    },
    move(e, p) {
      const g = this.drag; if (!g) return; const d = doc(), L = g.L;
      let dx = p[0] - g.start[0], dy = p[1] - g.start[1];
      if (e.shiftKey && (g.kind === 'move' || g.kind === 'float')) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      if (g.kind === 'move') {
        if (L.type === 'pixel') { L.x = Math.round(g.x0 + dx); L.y = Math.round(g.y0 + dy); }
        else { L.t.x = g.x0 + dx; L.t.y = g.y0 + dy; }
        if (this.o.snap && !e.metaKey) this.applySnap(L);
        d.touch(L);
      } else if (g.kind === 'float') {
        g.dx = Math.round(dx); g.dy = Math.round(dy);
        const c = U.canvas(d.w, d.h); U.ctx(c).drawImage(g.float, g.dx, g.dy);
        d.live.canvas = c; d.dirty = true;
      } else if (g.kind === 'rotate') {
        const t0 = g.t0, a0 = Math.atan2(g.start[1] - t0.y, g.start[0] - t0.x), a1 = Math.atan2(p[1] - t0.y, p[0] - t0.x);
        let r = t0.rot + a1 - a0;
        if (e.shiftKey) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
        L.t.rot = r; d.touch(L);
      } else if (g.kind === 'scale') {
        scaleFromHandle(L, g, p, e.shiftKey, e.altKey, this.o.constrain !== false); d.touch(L);
      }
      view().requestRender(); K.UI.updateTransformFields();
    },
    up() {
      const g = this.drag; this.drag = null; this.snapLines = null; if (!g) return; const d = doc();
      if (g.kind === 'float') {
        const L = g.L, x = U.ctx(L.canvas); x.drawImage(d.live.canvas, -L.x, -L.y); d.live = null;
        if (g.sel0) { const m = U.canvas(d.w, d.h); U.ctx(m).drawImage(g.sel0.canvas, g.dx, g.dy); d.sel = K.Sel.make(m); }
        d.touch(L); d.push('Move Selection'); return;
      }
      const moved = g.kind !== 'move' || (g.L.type === 'pixel' ? (g.L.x !== g.x0 || g.L.y !== g.y0) : (g.L.t.x !== g.x0 || g.L.t.y !== g.y0));
      if (moved) d.push(g.kind === 'move' ? 'Move' : g.kind === 'rotate' ? 'Rotate' : 'Scale');
      K.UI.refreshLayers();
    },
    applySnap(L) {
      const d = doc(), b = L.type === 'pixel' ? L_.contentBounds(L) : L_.bboxOf(L_.corners(L)); if (!b) return;
      const thr = 7 / d.view.zoom, xs = [0, d.w / 2, d.w], ys = [0, d.h / 2, d.h];
      for (const g of d.guides) (g.axis === 'v' ? xs : ys).push(g.pos);
      for (const o of d.layers) { if (o === L || !o.visible || o.type === 'adjust' || o.type === 'fill') continue; const ob = L_.contentBounds(o); if (!ob) continue; xs.push(ob.x, ob.x + ob.w / 2, ob.x + ob.w); ys.push(ob.y, ob.y + ob.h / 2, ob.y + ob.h); }
      const lines = [];
      const best = (cands, vals) => { let bd = thr, off = 0, at = null; for (const v of vals) for (const c of cands) { const dd = v - c; if (Math.abs(dd) < Math.abs(bd)) { bd = dd; off = dd; at = v; } } return at === null ? null : { off, at }; };
      const sx = best([b.x, b.x + b.w / 2, b.x + b.w], xs), sy = best([b.y, b.y + b.h / 2, b.y + b.h], ys);
      if (sx) { if (L.type === 'pixel') L.x = Math.round(L.x + sx.off); else L.t.x += sx.off; lines.push(['v', sx.at]); }
      if (sy) { if (L.type === 'pixel') L.y = Math.round(L.y + sy.off); else L.t.y += sy.off; lines.push(['h', sy.at]); }
      this.snapLines = lines;
    },
    key(e) {
      const d = doc(), L = d && d.active; if (!L || L.locked) return false;
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[e.key] && L.type !== 'adjust' && L.type !== 'fill') {
        const [dx, dy] = arrows[e.key].map((v) => v * (e.shiftKey ? 10 : 1));
        if (L.type === 'pixel') { L.x += dx; L.y += dy; } else { L.t.x += dx; L.t.y += dy; }
        d.touch(L); clearTimeout(this.nudgeT); this.nudgeT = setTimeout(() => d.push('Nudge'), 400); view().requestRender(); K.UI.updateTransformFields(); return true;
      }
      return false;
    },
    screenOverlay(x, v) {
      const d = doc(), L = d.active; if (!this.o.showBox || !L || L.type === 'adjust' || L.type === 'fill') return;
      const H = this.handles(L); if (!H) return;
      x.strokeStyle = '#3d8bff'; x.lineWidth = 1; x.beginPath(); H.scr.forEach((q, i) => (i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]))); x.closePath(); x.stroke();
      const top = H.hs[4].p; x.beginPath(); x.moveTo(top[0], top[1]); x.lineTo(H.rotK[0], H.rotK[1]); x.stroke();
      x.fillStyle = '#fff';
      for (const h of H.hs) { x.fillRect(h.p[0] - 4, h.p[1] - 4, 8, 8); x.strokeRect(h.p[0] - 4, h.p[1] - 4, 8, 8); }
      x.beginPath(); x.arc(H.rotK[0], H.rotK[1], 5, 0, Math.PI * 2); x.fill(); x.stroke();
      if (this.snapLines) {
        x.strokeStyle = '#ff2bd6'; x.setLineDash([4, 3]);
        for (const [ax, at] of this.snapLines) { x.beginPath(); if (ax === 'v') { const [sx] = v.toScreen(at, 0); x.moveTo(sx, 0); x.lineTo(sx, v.h); } else { const [, sy] = v.toScreen(0, at); x.moveTo(0, sy); x.lineTo(v.w, sy); } x.stroke(); }
        x.setLineDash([]);
      }
    },
  };
  function contentOnly(d, L) { const c = U.canvas(d.w, d.h); L_.drawContent(U.ctx(c), L, d); return c; }
  function selAlphaAt(d, p) { if (!d.sel) return 0; const x = Math.floor(p[0]), y = Math.floor(p[1]); if (x < 0 || y < 0 || x >= d.w || y >= d.h) return 0; return U.ctx(d.sel.canvas).getImageData(x, y, 1, 1).data[3]; }
  function pointInPoly(p, poly) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) inside = !inside; } return inside; }
  function pickLayer(d, p) {
    const x = Math.floor(p[0]), y = Math.floor(p[1]); if (x < 0 || y < 0 || x >= d.w || y >= d.h) return null;
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const L = d.layers[i]; if (!L.visible || L.type === 'adjust' || L.type === 'fill' || L.locked) continue;
      const a = U.ctx(d.renderLayer(L)).getImageData(x, y, 1, 1).data[3]; if (a > 10) return L;
    }
    return null;
  }
  function duplicateLayer(d, L) {
    const c = Object.assign({}, L, { id: U.uid(), name: L.name + ' copy', v: 1 });
    delete c._rc; delete c._text;
    if (L.canvas) c.canvas = U.clone(L.canvas);
    if (L.mask) c.mask = U.clone(L.mask);
    if (L.t) c.t = Object.assign({}, L.t);
    if (L.tp) c.tp = Object.assign({}, L.tp);
    if (L.adj) c.adj = JSON.parse(JSON.stringify(L.adj));
    if (L.style) c.style = JSON.parse(JSON.stringify(L.style));
    d.addLayer(c, d.layerIndex(L) + 1); return c;
  }
  // Corner handles keep proportions while "Constrain proportions" is on; Shift temporarily flips it.
  // Side handles stretch one way; for text they follow the same setting so text can be squashed or stretched.
  function scaleFromHandle(L, g, p, shift, fromCenter, constrain = true) {
    const t0 = g.t0, s = L_.srcOf(L), w = s.width, h = s.height;
    const W0 = w * Math.abs(t0.sx), H0 = h * Math.abs(t0.sy);
    const [qx, qy] = U.rot(p[0] - t0.x, p[1] - t0.y, -t0.rot);
    const ax = fromCenter ? 0 : -g.hx * W0 / 2, ay = fromCenter ? 0 : -g.hy * H0 / 2;
    let nW = g.hx ? (fromCenter ? 2 * qx * g.hx : (qx - ax) * g.hx) : W0;
    let nH = g.hy ? (fromCenter ? 2 * qy * g.hy : (qy - ay) * g.hy) : H0;
    const proportional = g.hx && g.hy ? (constrain !== shift) : (L.type === 'text' ? (constrain !== shift) : shift);
    if (proportional) {
      let f;
      if (g.hx && g.hy) f = Math.max(nW / W0, nH / H0);
      else f = g.hx ? nW / W0 : nH / H0;
      nW = W0 * f; nH = H0 * f;
    }
    nW = Math.max(2, nW); nH = Math.max(2, nH);
    L.t.sx = Math.sign(t0.sx || 1) * nW / w; L.t.sy = Math.sign(t0.sy || 1) * nH / h;
    const clx = fromCenter ? 0 : (g.hx ? ax + g.hx * nW / 2 : 0), cly = fromCenter ? 0 : (g.hy ? ay + g.hy * nH / 2 : 0);
    const [rx, ry] = U.rot(clx, cly, t0.rot);
    L.t.x = t0.x + rx; L.t.y = t0.y + ry;
  }

  // ===== Hand & Zoom =====
  tools.hand = {
    id: 'hand', name: 'Hand', hotkey: 'h', cursor: 'grab', optionSpec: [{ key: 'fit', type: 'button', label: 'Fit Screen', action: () => K.app.run('zoom', 0) }, { key: 'one', type: 'button', label: '100%', action: () => K.app.run('zoom', 100) }],
    down(e, p, sx, sy) { const v = doc().view; this.drag = { sx, sy, px: v.panX, py: v.panY }; view().c.style.cursor = 'grabbing'; },
    move(e, p, sx, sy) { if (!this.drag) return; const v = doc().view; v.panX = this.drag.px + sx - this.drag.sx; v.panY = this.drag.py + sy - this.drag.sy; view().requestRender(); },
    up() { this.drag = null; view().c.style.cursor = 'grab'; },
  };
  tools.zoom = {
    id: 'zoom', name: 'Zoom', hotkey: 'z', cursor: 'zoom-in',
    optionSpec: [{ key: 'dir', type: 'buttons', def: 'in', options: [['in', 'Zoom in'], ['out', 'Zoom out']] }, { key: 'fit', type: 'button', label: 'Fit Screen', action: () => K.app.run('zoom', 0) }, { key: 'one', type: 'button', label: '100%', action: () => K.app.run('zoom', 100) }],
    down(e, p, sx, sy) { this.start = [sx, sy]; this.cur = [sx, sy]; },
    move(e, p, sx, sy) { if (this.start) { this.cur = [sx, sy]; view().requestRender(); } },
    up(e, p, sx, sy) {
      const s = this.start; this.start = null; if (!s) return;
      if (Math.hypot(sx - s[0], sy - s[1]) > 8 && this.o.dir === 'in' && !e.altKey) {
        const [x0, y0] = view().toDoc(Math.min(s[0], sx), Math.min(s[1], sy)), [x1, y1] = view().toDoc(Math.max(s[0], sx), Math.max(s[1], sy));
        const z = Math.min(view().w / (x1 - x0), view().h / (y1 - y0));
        const v = doc().view; v.zoom = U.clamp(z, 0.01, 64); v.panX = view().w / 2 - (x0 + x1) / 2 * v.zoom; v.panY = view().h / 2 - (y0 + y1) / 2 * v.zoom; view().afterZoom();
      } else view().zoomStep((this.o.dir === 'in') !== e.altKey ? 1 : -1, sx, sy);
    },
    screenOverlay(x) { if (this.start && this.cur) { x.strokeStyle = '#fff'; x.setLineDash([4, 4]); x.strokeRect(this.start[0], this.start[1], this.cur[0] - this.start[0], this.cur[1] - this.start[1]); x.setLineDash([]); } },
  };

  // ===== Selection tools =====
  function marquee(id, name, ellipse) {
    return {
      id, name, hotkey: 'm', cursor: 'crosshair',
      optionSpec: [O.selMode(), O.feather(), { key: 'ratio', label: 'Aspect', type: 'select', def: 'free', options: [['free', 'Normal'], ['1:1', '1:1'], ['4:3', '4:3'], ['3:2', '3:2'], ['16:9', '16:9'], ['5:7', '5:7']] }],
      down(e, p) {
        const d = doc();
        if (!e.shiftKey && !e.altKey && this.o.mode === 'new' && d.sel && selAlphaAt(d, p) > 0 && !(e.metaKey)) {
          this.moveSel = { start: p, sel0: d.sel }; return;
        }
        this.start = p; this.cur = p; this.mode = selModeFromEvent(e, this.o.mode);
      },
      rect(e) {
        let [x0, y0] = this.start, [x1, y1] = this.cur;
        let w = x1 - x0, h = y1 - y0;
        const r = this.o.ratio !== 'free' ? this.o.ratio.split(':').map(Number) : (e && e.shiftKey && this.mode === 'new' ? [1, 1] : null);
        if (r) { const a = r[0] / r[1]; if (Math.abs(w) / a > Math.abs(h)) h = Math.sign(h || 1) * Math.abs(w) / a; else w = Math.sign(w || 1) * Math.abs(h) * a; }
        if (e && e.altKey && this.mode === 'new') { x0 -= w; y0 -= h; w *= 2; h *= 2; }
        return { x: Math.min(x0, x0 + w), y: Math.min(y0, y0 + h), w: Math.abs(w), h: Math.abs(h) };
      },
      move(e, p) {
        if (this.moveSel) { const d = doc(), m = U.canvas(d.w, d.h); U.ctx(m).drawImage(this.moveSel.sel0.canvas, Math.round(p[0] - this.moveSel.start[0]), Math.round(p[1] - this.moveSel.start[1])); d.sel = K.Sel.make(m); view().requestRender(); return; }
        if (!this.start) return; if (K.app.spaceDown && this.cur) { this.start = [this.start[0] + p[0] - this.cur[0], this.start[1] + p[1] - this.cur[1]]; } this.cur = p; this.lastE = e; view().requestRender();
      },
      up(e) {
        const d = doc();
        if (this.moveSel) { this.moveSel = null; d.push('Move Selection'); return; }
        if (!this.start) return;
        const r = this.rect(e); this.start = null;
        if (r.w < 1 || r.h < 1) { if (this.mode === 'new') { K.Sel.none(d); d.push('Deselect'); } return; }
        if (ellipse) K.Sel.ellipse(d, r.x, r.y, r.w, r.h, this.mode, this.o.feather); else K.Sel.rect(d, r.x, r.y, r.w, r.h, this.mode, this.o.feather);
        d.push(ellipse ? 'Elliptical Marquee' : 'Rectangular Marquee');
      },
      overlay(x, v, px) {
        if (!this.start) return; const r = this.rect(this.lastE);
        x.lineWidth = px; x.strokeStyle = '#fff'; x.setLineDash([4 * px, 4 * px]);
        x.beginPath(); if (ellipse) x.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); else x.rect(r.x, r.y, r.w, r.h); x.stroke();
        x.strokeStyle = '#000'; x.lineDashOffset = 4 * px; x.stroke(); x.setLineDash([]);
      },
    };
  }
  tools.marquee = marquee('marquee', 'Rectangular Marquee', false);
  tools.ellipse = marquee('ellipse', 'Elliptical Marquee', true);

  tools.lasso = {
    id: 'lasso', name: 'Lasso', hotkey: 'l', cursor: 'crosshair', optionSpec: [O.selMode(), O.feather()],
    down(e, p) { this.pts = [p]; this.mode = selModeFromEvent(e, this.o.mode); },
    move(e, p) { if (this.pts) { this.pts.push(p); view().requestRender(); } },
    up() { const d = doc(); if (!this.pts) return; if (this.pts.length > 2) { K.Sel.polygon(d, this.pts, this.mode, this.o.feather); d.push('Lasso'); } else if (this.mode === 'new') { K.Sel.none(d); } this.pts = null; },
    overlay(x, v, px) { if (!this.pts) return; x.lineWidth = px; x.strokeStyle = '#fff'; x.beginPath(); this.pts.forEach((q, i) => (i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]))); x.stroke(); },
  };
  tools.polylasso = {
    id: 'polylasso', name: 'Polygonal Lasso', hotkey: 'l', cursor: 'crosshair', optionSpec: [O.selMode(), O.feather()],
    down(e, p) {
      const d = doc();
      if (!this.pts) { this.pts = [p]; this.mode = selModeFromEvent(e, this.o.mode); return; }
      const [sx, sy] = view().toScreen(...this.pts[0]), [cx, cy] = view().toScreen(...p);
      if ((Math.hypot(sx - cx, sy - cy) < 8 || e.detail >= 2) && this.pts.length > 2) this.finish(d); else this.pts.push(p);
    },
    finish(d) { K.Sel.polygon(d, this.pts, this.mode, this.o.feather); d.push('Polygonal Lasso'); this.pts = null; view().requestRender(); },
    hover(p) { this.hoverP = p; if (this.pts) view().requestRender(); },
    key(e) { if (!this.pts) return false; if (e.key === 'Enter') { this.finish(doc()); return true; } if (e.key === 'Escape') { this.pts = null; view().requestRender(); return true; } if (e.key === 'Backspace' || e.key === 'Delete') { this.pts.pop(); if (!this.pts.length) this.pts = null; view().requestRender(); return true; } return false; },
    cancel() { this.pts = null; },
    overlay(x, v, px) { if (!this.pts) return; x.lineWidth = px; x.strokeStyle = '#fff'; x.beginPath(); this.pts.forEach((q, i) => (i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]))); if (this.hoverP) x.lineTo(...this.hoverP); x.stroke(); x.fillStyle = '#fff'; x.fillRect(this.pts[0][0] - 3 * px, this.pts[0][1] - 3 * px, 6 * px, 6 * px); },
  };
  tools.wand = {
    id: 'wand', name: 'Magic Wand', hotkey: 'a', cursor: 'crosshair',
    optionSpec: [O.selMode(), { key: 'tolerance', label: 'Tolerance', type: 'range', min: 0, max: 255, def: 32 }, { key: 'contiguous', label: 'Contiguous', type: 'check', def: true }, { key: 'antialias', label: 'Anti-alias', type: 'check', def: true }, O.allLayers()],
    down(e, p) {
      const d = doc(), src = this.o.allLayers ? d.composite() : d.renderLayer(d.active || d.layers[0]);
      K.Sel.wand(d, src, p[0], p[1], this.o.tolerance, this.o.contiguous, selModeFromEvent(e, this.o.mode), this.o.antialias); d.push('Magic Wand');
    },
  };
  tools.quickselect = {
    id: 'quickselect', name: 'Quick Selection', hotkey: 'a', cursor: 'none',
    optionSpec: [{ key: 'mode', type: 'buttons', def: 'add', options: [['new', 'New'], ['add', 'Add'], ['sub', 'Subtract']] }, O.size(40, 500), { key: 'tolerance', label: 'Edge sensitivity', type: 'range', min: 5, max: 120, def: 40 }, O.allLayers(true)],
    down(e, p) {
      const d = doc(); this.src = this.o.allLayers ? d.composite() : d.renderLayer(d.active);
      this.mode = e.altKey ? 'sub' : this.o.mode === 'new' && !d.sel ? 'new' : this.o.mode === 'new' ? 'new' : this.o.mode;
      if (this.mode === 'new') { K.Sel.none(d); this.mode = 'add'; }
      this.acc = U.canvas(d.w, d.h); this.last = null; this.addAt(p);
    },
    addAt(p) {
      const d = doc(), r = this.o.size / 2;
      this.last = strokePoints(this.last, p, Math.max(4, r * 0.6), (x, y) => {
        const region = { x: Math.floor(x - r * 3), y: Math.floor(y - r * 3), w: Math.ceil(r * 6), h: Math.ceil(r * 6) };
        const m = K.Sel.wandMask(d, this.src, x, y, this.o.tolerance, true, region);
        const ax = U.ctx(this.acc); if (m) ax.drawImage(m, 0, 0);
        ax.fillStyle = '#fff'; ax.beginPath(); ax.arc(x, y, r * 0.5, 0, Math.PI * 2); ax.fill();
      });
      this.preview = this.acc; view().requestRender();
    },
    move(e, p) { if (this.acc) this.addAt(p); },
    up() { if (!this.acc) return; const d = doc(); K.Sel.combine(d, K.Sel.featherCanvas(K.Sel.threshold(K.Sel.featherCanvas(this.acc, 1.5)), 0.6), this.mode); this.acc = null; this.preview = null; d.push('Quick Selection'); },
    overlay(x, v, px) {
      if (this.preview) { x.save(); x.globalAlpha = 0.35; const t = U.clone(this.preview), tx = U.ctx(t); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = this.mode === 'sub' ? '#ff3b30' : '#3d8bff'; tx.fillRect(0, 0, t.width, t.height); x.drawImage(t, 0, 0); x.restore(); }
      brushCursor(x, v, px, this.o.size);
    },
  };

  // ===== Crop =====
  tools.crop = {
    id: 'crop', name: 'Crop', hotkey: 'c', cursor: 'crosshair',
    optionSpec: [
      { key: 'ratio', label: 'Ratio', type: 'select', def: 'free', options: [['free', 'No restriction'], ['orig', 'Use photo ratio'], ['1:1', '1 × 1 (square)'], ['4:3', '4 × 3'], ['3:2', '3 × 2 (4 × 6 in)'], ['5:4', '5 × 4 (8 × 10 in)'], ['7:5', '7 × 5'], ['16:9', '16 × 9'], ['4:5', '4 × 5 (portrait)'], ['2:3', '2 × 3 (portrait)'], ['9:16', '9 × 16 (story)']] },
      { key: 'overlay', label: 'Overlay', type: 'select', def: 'thirds', options: [['thirds', 'Rule of thirds'], ['grid', 'Grid'], ['golden', 'Golden ratio'], ['none', 'None']] },
      { key: 'apply', type: 'button', label: '✓ Apply', primary: true, action: () => K.tools.crop.commit() },
      { key: 'cancel', type: 'button', label: '✕ Cancel', action: () => K.tools.crop.cancel() },
    ],
    activate() { this.rect = null; },
    ratio() { const r = this.o.ratio; if (r === 'free') return null; if (r === 'orig') return doc().w / doc().h; const [a, b] = r.split(':').map(Number); return a / b; },
    down(e, p, sx, sy) {
      if (this.rect) {
        const h = this.hitHandle(sx, sy);
        if (h) { this.drag = { kind: 'h', h, r0: Object.assign({}, this.rect) }; return; }
        const r = this.rect; if (p[0] > r.x && p[0] < r.x + r.w && p[1] > r.y && p[1] < r.y + r.h) { if (e.detail >= 2) { this.commit(); return; } this.drag = { kind: 'move', start: p, r0: Object.assign({}, r) }; return; }
      }
      this.drag = { kind: 'new', start: p }; this.rect = { x: p[0], y: p[1], w: 0, h: 0 };
    },
    hitHandle(sx, sy) {
      const r = this.rect; if (!r) return null;
      const [x0, y0] = view().toScreen(r.x, r.y), [x1, y1] = view().toScreen(r.x + r.w, r.y + r.h);
      const hs = [[-1, -1, x0, y0], [1, -1, x1, y0], [1, 1, x1, y1], [-1, 1, x0, y1], [0, -1, (x0 + x1) / 2, y0], [1, 0, x1, (y0 + y1) / 2], [0, 1, (x0 + x1) / 2, y1], [-1, 0, x0, (y0 + y1) / 2]];
      for (const [hx, hy, x, y] of hs) if (Math.abs(sx - x) < 8 && Math.abs(sy - y) < 8) return [hx, hy];
      return null;
    },
    move(e, p) {
      const g = this.drag; if (!g) return; const ar = this.ratio();
      if (g.kind === 'new') {
        let w = p[0] - g.start[0], h = p[1] - g.start[1];
        if (ar) { if (Math.abs(w) / ar > Math.abs(h)) h = Math.sign(h || 1) * Math.abs(w) / ar; else w = Math.sign(w || 1) * Math.abs(h) * ar; }
        this.rect = { x: Math.min(g.start[0], g.start[0] + w), y: Math.min(g.start[1], g.start[1] + h), w: Math.abs(w), h: Math.abs(h) };
      } else if (g.kind === 'move') {
        this.rect.x = g.r0.x + p[0] - g.start[0]; this.rect.y = g.r0.y + p[1] - g.start[1];
      } else {
        const [hx, hy] = g.h, r0 = g.r0; let x0 = r0.x, y0 = r0.y, x1 = r0.x + r0.w, y1 = r0.y + r0.h;
        if (hx < 0) x0 = p[0]; if (hx > 0) x1 = p[0]; if (hy < 0) y0 = p[1]; if (hy > 0) y1 = p[1];
        let w = x1 - x0, h = y1 - y0;
        if (ar) { if (hx && hy) { if (Math.abs(w) / ar > Math.abs(h)) h = Math.sign(h || 1) * Math.abs(w) / ar; else w = Math.sign(w || 1) * Math.abs(h) * ar; } else if (hx) h = Math.abs(w) / ar; else w = Math.abs(h) * ar; if (hy < 0) y0 = y1 - h; else y1 = y0 + h; if (hx < 0) x0 = x1 - w; else x1 = x0 + w; }
        this.rect = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
      }
      view().requestRender(); K.UI.setStatusExtra(`Crop ${Math.round(this.rect.w)} × ${Math.round(this.rect.h)} px`);
    },
    up() { this.drag = null; if (this.rect && (this.rect.w < 2 || this.rect.h < 2)) this.rect = null; view().requestRender(); },
    key(e) { if (e.key === 'Enter' && this.rect) { this.commit(); return true; } if (e.key === 'Escape' && this.rect) { this.cancel(); return true; } if (e.key === '/' && this.rect) { this.noShield = !this.noShield; view().requestRender(); return true; } return false; },
    commit() {
      const r = this.rect, d = doc(); if (!r) { toast('Drag on the photo to choose the crop area'); return; }
      d.translateAll(-Math.round(r.x), -Math.round(r.y), Math.round(r.w), Math.round(r.h));
      d.push('Crop'); this.rect = null; view().fit(); K.UI.refreshAll(); K.UI.setStatusExtra('');
    },
    cancel() { this.rect = null; view().requestRender(); K.UI.setStatusExtra(''); },
    overlay(x, v, px) {
      const r = this.rect, d = doc(); if (!r) return;
      if (!this.noShield) { x.fillStyle = 'rgba(0,0,0,0.55)'; x.beginPath(); x.rect(-1e5, -1e5, 2e5, 2e5); x.rect(r.x, r.y, r.w, r.h); x.fill('evenodd'); }
      x.strokeStyle = '#fff'; x.lineWidth = px; x.strokeRect(r.x, r.y, r.w, r.h);
      x.strokeStyle = 'rgba(255,255,255,0.55)'; x.beginPath();
      const ov = this.o.overlay;
      const fr = ov === 'thirds' ? [1 / 3, 2 / 3] : ov === 'grid' ? [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] : ov === 'golden' ? [0.382, 0.618] : [];
      for (const f of fr) { x.moveTo(r.x + r.w * f, r.y); x.lineTo(r.x + r.w * f, r.y + r.h); x.moveTo(r.x, r.y + r.h * f); x.lineTo(r.x + r.w, r.y + r.h * f); }
      x.stroke();
      x.fillStyle = '#fff'; const hs = 8 * px;
      for (const [hx, hy] of [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]) x.fillRect(r.x + r.w * hx - hs / 2, r.y + r.h * hy - hs / 2, hs, hs);
      void d;
    },
  };

  // ===== Straighten =====
  tools.straighten = {
    id: 'straighten', name: 'Straighten', hotkey: 'p', cursor: 'crosshair',
    optionSpec: [{ key: 'autoCrop', label: 'Crop to remove background', type: 'check', def: true }, { key: 'hint', type: 'hint', label: 'Draw a line along something that should be level (or vertical)' }],
    down(e, p) { this.a = p; this.b = p; },
    move(e, p) { if (this.a) { this.b = p; view().requestRender(); } },
    up() {
      const a = this.a, b = this.b; this.a = null; if (!a || Math.hypot(b[0] - a[0], b[1] - a[1]) < 5) return;
      let ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
      // choose nearest horizontal/vertical
      let rot = -ang; while (rot > 45) rot -= 90; while (rot < -45) rot += 90;
      K.app.straighten(rot, this.o.autoCrop);
    },
    overlay(x, v, px) { if (!this.a) return; x.strokeStyle = '#ffd000'; x.lineWidth = 2 * px; x.beginPath(); x.moveTo(...this.a); x.lineTo(...this.b); x.stroke(); },
  };

  // ===== Eyedropper =====
  tools.eyedropper = {
    id: 'eyedropper', name: 'Eyedropper', hotkey: 'i', cursor: 'crosshair',
    optionSpec: [{ key: 'sample', label: 'Sample size', type: 'select', def: '1', options: [['1', 'Point'], ['3', '3 × 3 average'], ['5', '5 × 5 average'], ['11', '11 × 11 average']] }, O.allLayers(true)],
    sample(p, toBg) {
      const d = doc(), src = (this.o && !this.o.allLayers) ? d.renderLayer(d.active) : d.composite();
      const s = parseInt((this.o && this.o.sample) || '1', 10), x0 = Math.floor(p[0] - (s - 1) / 2), y0 = Math.floor(p[1] - (s - 1) / 2);
      if (p[0] < 0 || p[1] < 0 || p[0] >= d.w || p[1] >= d.h) return;
      const data = U.ctx(src).getImageData(Math.max(0, x0), Math.max(0, y0), s, s).data; let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
      if (!n) return; const hex = U.rgbToHex(r / n, g / n, b / n);
      if (toBg) K.app.bg = hex; else K.app.fg = hex; K.UI.refreshColors();
    },
    down(e, p) { this.on = true; this.sample(p, e.altKey); },
    move(e, p) { if (this.on) this.sample(p, e.altKey); },
    up() { this.on = false; },
  };

  // ===== Painting =====
  tools.brush = makeBrush('brush', 'Brush', 'b');
  tools.pencil = makeBrush('pencil', 'Pencil', 'n');
  tools.eraser = makeBrush('eraser', 'Eraser', 'e');

  // Background Eraser: erases pixels similar to the colour under the centre cross hair, keeping edges of other colours
  const colorDist = (d, i, c) => Math.max(Math.abs(d[i] - c[0]), Math.abs(d[i + 1] - c[1]), Math.abs(d[i + 2] - c[2]));
  tools.bgeraser = makeRetouch('bgeraser', 'Background Eraser', 'e', [O.size(80, 1000), O.hardness(90),
    { key: 'tolerance', label: 'Tolerance', type: 'range', min: 0, max: 100, def: 30, unit: '%' },
    { key: 'limits', label: 'Limits', type: 'select', def: 'contig', options: [['contig', 'Contiguous'], ['discontig', 'Discontiguous']] },
    { key: 'sampling', label: 'Sampling', type: 'select', def: 'continuous', options: [['continuous', 'Continuous'], ['once', 'Once'], ['bg', 'Background swatch']] },
    { key: 'protectFg', label: 'Protect foreground colour', type: 'check', def: false },
    { key: 'hint', type: 'hint', label: 'Keep the centre cross hair on the colour you want to remove' }],
    function (data, wts, g) {
      const d = data.data, w = g.w, h = g.h, tol = this.o.tolerance * 2.55, soft = Math.max(4, tol * 0.25);
      const cx = Math.round(g.cx), cy = Math.round(g.cy);
      let col = this.state.sample;
      if (!col || this.o.sampling === 'continuous') {
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) return; const i = (cy * w + cx) * 4; if (d[i + 3] === 0 && this.o.sampling === 'continuous') return;
        if (this.o.sampling === 'bg') col = U.hexToRgb(K.app.bg); else col = [d[i], d[i + 1], d[i + 2]];
        this.state.sample = col;
      }
      const fg = this.o.protectFg ? U.hexToRgb(K.app.fg) : null;
      // per-pixel erase strength by colour similarity
      const amt = new Float32Array(w * h);
      for (let k = 0, i = 0; k < w * h; k++, i += 4) {
        if (wts[k] <= 0 || d[i + 3] === 0) continue;
        const dist = colorDist(d, i, col); if (dist > tol + soft) continue;
        if (fg && colorDist(d, i, fg) <= Math.max(10, tol * 0.5)) continue;
        amt[k] = dist <= tol ? 1 : 1 - (dist - tol) / soft;
      }
      if (this.o.limits === 'contig') { // keep only the area connected to the centre
        const keep = new Uint8Array(w * h), st = []; const s0 = U.clamp(cy, 0, h - 1) * w + U.clamp(cx, 0, w - 1);
        if (amt[s0] > 0) { st.push(s0); keep[s0] = 1; }
        while (st.length) { const k = st.pop(), x = k % w, y = (k / w) | 0; for (const n of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1]) if (n >= 0 && !keep[n] && amt[n] > 0) { keep[n] = 1; st.push(n); } }
        for (let k = 0; k < w * h; k++) if (!keep[k]) amt[k] = 0;
      }
      for (let k = 0, i = 3; k < w * h; k++, i += 4) if (amt[k] > 0) d[i] = d[i] * (1 - amt[k] * wts[k]);
    });
  Object.assign(tools.bgeraser, {
    begin() { this.state.sample = null; return true; },
    extraOverlay(x, v, px) { const p = v.cursorPos; if (!p) return; const r = 5 * px; x.lineWidth = px; for (const c of ['rgba(0,0,0,0.8)', '#fff']) { x.strokeStyle = c; x.beginPath(); x.moveTo(p[0] - r, p[1]); x.lineTo(p[0] + r, p[1]); x.moveTo(p[0], p[1] - r); x.lineTo(p[0], p[1] + r); x.stroke(); } },
  });

  // Magic Eraser: one click erases all similar pixels (like a magic wand that deletes)
  tools.magiceraser = {
    id: 'magiceraser', name: 'Magic Eraser', hotkey: 'e', cursor: 'crosshair',
    optionSpec: [{ key: 'tolerance', label: 'Tolerance', type: 'range', min: 0, max: 255, def: 32 }, { key: 'contiguous', label: 'Contiguous', type: 'check', def: true },
      { key: 'antialias', label: 'Anti-alias', type: 'check', def: true }, O.allLayers(false), O.opacity()],
    down(e, p) {
      const t = paintTarget(); if (!t) return; if (t.target === 'mask') { toast('The Magic Eraser works on layer pixels'); return; }
      const d = doc(), L = t.L, src = this.o.allLayers ? d.composite() : d.renderLayer(L);
      let m = K.Sel.wandMask(d, src, p[0], p[1], this.o.tolerance, this.o.contiguous); if (!m) return;
      if (this.o.antialias) m = K.Sel.featherCanvas(m, 0.6);
      K.Sel.clip(d, m);
      const x = U.ctx(L.canvas); x.save(); x.globalCompositeOperation = 'destination-out'; x.globalAlpha = this.o.opacity / 100; x.drawImage(m, -L.x, -L.y); x.restore();
      d.touch(L); d.push('Magic Eraser'); K.UI.refreshLayers(); view().requestRender();
    },
  };

  tools.bucket = {
    id: 'bucket', name: 'Paint Bucket', hotkey: 'k', cursor: 'crosshair',
    optionSpec: [{ key: 'tolerance', label: 'Tolerance', type: 'range', min: 0, max: 255, def: 32 }, { key: 'contiguous', label: 'Contiguous', type: 'check', def: true }, O.opacity(), O.allLayers()],
    down(e, p) {
      const t = paintTarget(); if (!t) return; const d = doc(), L = t.L;
      const src = this.o.allLayers ? d.composite() : d.renderLayer(L);
      let m = K.Sel.wandMask(d, src, p[0], p[1], this.o.tolerance, this.o.contiguous); if (!m) return;
      m = K.Sel.featherCanvas(m, 0.5); K.Sel.clip(d, m);
      const fill = U.clone(m), fx = U.ctx(fill); fx.globalCompositeOperation = 'source-in'; fx.fillStyle = t.target === 'mask' ? '#fff' : K.app.fg; fx.fillRect(0, 0, d.w, d.h);
      if (t.target === 'mask') { const mm = d.writable(L, 'mask'), x = U.ctx(mm); const dark = U.lum(...U.hexToRgb(K.app.fg)) < 128; x.globalCompositeOperation = dark ? 'destination-out' : 'source-over'; x.globalAlpha = this.o.opacity / 100; x.drawImage(fill, 0, 0); }
      else { const x = U.ctx(L.canvas); x.globalAlpha = this.o.opacity / 100; x.drawImage(fill, -L.x, -L.y); x.globalAlpha = 1; }
      d.touch(L); d.push('Paint Bucket'); K.UI.refreshLayers();
    },
  };

  tools.gradient = {
    id: 'gradient', name: 'Gradient', hotkey: 'g', cursor: 'crosshair',
    optionSpec: [{ key: 'type', label: '', type: 'buttons', def: 'linear', options: [['linear', 'Linear'], ['radial', 'Radial'], ['reflected', 'Reflected']] },
      { key: 'colors', label: 'Colours', type: 'select', def: 'fgbg', options: [['fgbg', 'Foreground → Background'], ['fgclear', 'Foreground → Transparent'], ['rainbow', 'Spectrum'], ['sunset', 'Sunset'], ['ocean', 'Ocean']] },
      { key: 'reverse', label: 'Reverse', type: 'check', def: false }, O.opacity(),
      { key: 'blend', label: 'Mode', type: 'select', def: 'normal', options: Object.entries(L_.BLEND_NAMES) }],
    stops() {
      const fg = K.app.fg, bg = K.app.bg;
      const s = { fgbg: [[0, fg], [1, bg]], fgclear: [[0, fg], [1, fg + '00']], rainbow: [[0, '#ff0000'], [0.17, '#ffa500'], [0.33, '#ffff00'], [0.5, '#00c000'], [0.67, '#0080ff'], [0.83, '#4b0082'], [1, '#ee82ee']], sunset: [[0, '#2b1055'], [0.5, '#d53369'], [1, '#ffcc70']], ocean: [[0, '#00204a'], [0.5, '#005792'], [1, '#00bbf0']] }[this.o.colors];
      return this.o.reverse ? s.map(([o, c]) => [1 - o, c]).reverse() : s;
    },
    draw(a, b) {
      const d = doc(), c = U.canvas(d.w, d.h), x = U.ctx(c), len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const stops = this.stops(); const add = (g, list) => { for (const [o, col] of list) g.addColorStop(U.clamp(o, 0, 1), col); return g; };
      if (this.o.type === 'linear') x.fillStyle = add(x.createLinearGradient(a[0], a[1], b[0], b[1]), stops);
      else if (this.o.type === 'radial') x.fillStyle = add(x.createRadialGradient(a[0], a[1], 0, a[0], a[1], len), stops);
      else if (this.o.type === 'reflected') { const mir = [...stops.map(([o, col]) => [0.5 - o / 2, col]).reverse(), ...stops.map(([o, col]) => [0.5 + o / 2, col])]; x.fillStyle = add(x.createLinearGradient(2 * a[0] - b[0], 2 * a[1] - b[1], b[0], b[1]), mir); }
      x.fillRect(0, 0, d.w, d.h); return K.Sel.clip(d, c);
    },
    down(e, p) { const t = paintTarget(); if (!t) return; this.t = t; this.a = p; this.b = p; },
    move(e, p) {
      if (!this.t) return; if (e.shiftKey) { const ang = Math.round(Math.atan2(p[1] - this.a[1], p[0] - this.a[0]) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(p[0] - this.a[0], p[1] - this.a[1]); p = [this.a[0] + Math.cos(ang) * len, this.a[1] + Math.sin(ang) * len]; }
      this.b = p; const d = doc();
      d.live = { layerId: this.t.L.id, target: this.t.target, op: this.t.target === 'mask' ? 'reveal' : 'paint', opacity: this.o.opacity / 100, canvas: this.draw(this.a, this.b) };
      d.dirty = true; view().requestRender();
    },
    up() {
      const t = this.t; this.t = null; const d = doc(); if (!t || !d.live) { d.live = null; return; }
      const g = d.live.canvas, L = t.L;
      if (t.target === 'mask') { const m = d.writable(L, 'mask'), x = U.ctx(m); x.clearRect(0, 0, m.width, m.height); const gray = U.clone(g); const gd = U.getData(gray); for (let i = 0; i < gd.data.length; i += 4) { gd.data[i + 3] = U.lum(gd.data[i], gd.data[i + 1], gd.data[i + 2]) * gd.data[i + 3] / 255; gd.data[i] = gd.data[i + 1] = gd.data[i + 2] = 255; } x.putImageData(gd, 0, 0); }
      else { const x = U.ctx(L.canvas); x.save(); x.globalAlpha = this.o.opacity / 100; x.globalCompositeOperation = L_.BLEND[this.o.blend] || 'source-over'; x.drawImage(g, -L.x, -L.y); x.restore(); }
      d.live = null; d.touch(L); d.push('Gradient'); K.UI.refreshLayers();
    },
    overlay(x, v, px) { if (!this.t) return; x.strokeStyle = '#fff'; x.lineWidth = px; x.beginPath(); x.moveTo(...this.a); x.lineTo(...this.b); x.stroke(); },
  };

  // ===== Clone stamp =====
  tools.clone = makeRetouch('clone', 'Clone Stamp', 's', [O.size(60), O.hardness(50), O.opacity(), { key: 'aligned', label: 'Aligned', type: 'check', def: true }, O.allLayers(false), { key: 'hint', type: 'hint', label: 'Alt-click to set the source' }],
    function (data, wts, g) {
      const s = this.state.src; if (!s) return;
      const sd = this.state.srcData, sw = this.state.srcW, sh = this.state.srcH, d = data.data, op = this.o.opacity / 100;
      const L = g.L, ox = this.state.off[0], oy = this.state.off[1];
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
        const w = wts[y * g.w + x] * op; if (w <= 0) continue;
        const dxDoc = x + g.x0 + L.x, dyDoc = y + g.y0 + L.y;
        const sx = Math.round(dxDoc + ox - this.state.srcOX), sy = Math.round(dyDoc + oy - this.state.srcOY);
        if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
        const i = (y * g.w + x) * 4, j = (sy * sw + sx) * 4, sa = sd[j + 3] / 255 * w;
        const da = d[i + 3] / 255, oa = sa + da * (1 - sa);
        if (oa <= 0) continue;
        for (let c = 0; c < 3; c++) d[i + c] = (sd[j + c] * sa + d[i + c] * da * (1 - sa)) / oa;
        d[i + 3] = oa * 255;
      }
    });
  Object.assign(tools.clone, {
    begin(e, p) {
      const d = doc();
      if (e.altKey) { SourcePoint.setFrom(this, e, p); toast('Clone source set'); return false; }
      this.placing = false;
      if (!SourcePoint.valid(this)) { toast('Alt-click to set a clone source first'); return false; }
      if (!this.o.aligned || !this.offset) this.offset = [this.source[0] - p[0], this.source[1] - p[1]];
      const L = this.t.L;
      const srcC = this.o.allLayers ? d.composite() : U.clone(L.canvas);
      this.state.src = srcC; this.state.srcData = U.getData(srcC).data; this.state.srcW = srcC.width; this.state.srcH = srcC.height;
      this.state.srcOX = this.o.allLayers ? 0 : L.x; this.state.srcOY = this.o.allLayers ? 0 : L.y;
      this.state.off = this.offset;
      return true;
    },
    extraOverlay(x, v, px) { SourcePoint.draw(this, x, v, px, !!this.t); },
  });

  // ===== Source point marker (shared by Healing Brush and Spot Healing "Source point") =====
  // Alt-click places the marker; Alt-drag moves it. With Aligned on, the source keeps its offset between strokes.
  const SourcePoint = {
    setFrom(tool, e, p) { tool.source = [p[0], p[1]]; tool.sourceDoc = doc().id; tool.offset = null; tool.placing = true; view().requestRender(); },
    valid(tool) { return tool.source && tool.sourceDoc === doc().id; },
    startStroke(tool, p) { if (!tool.o.aligned || !tool.offset) tool.offset = [tool.source[0] - p[0], tool.source[1] - p[1]]; return tool.offset; },
    sourceCanvas(tool, L) { const d = doc(); if (tool.o.allLayers) return d.composite(); const c = U.canvas(d.w, d.h); U.ctx(c).drawImage(L.canvas, L.x, L.y); return c; },
    draw(tool, x, v, px, painting) {
      if (!this.valid(tool)) return;
      let p = tool.source;
      if (tool.offset && v.cursorPos && (painting || tool.o.aligned)) p = [v.cursorPos[0] + tool.offset[0], v.cursorPos[1] + tool.offset[1]];
      const r = tool.o.size / 2, arm = Math.max(10 * px, Math.min(r * 0.6, 24 * px));
      for (const [c, w] of [['rgba(0,0,0,0.85)', 3 * px], ['#fff', 1.2 * px]]) {
        x.strokeStyle = c; x.lineWidth = w; x.beginPath();
        x.moveTo(p[0] - arm, p[1]); x.lineTo(p[0] + arm, p[1]); x.moveTo(p[0], p[1] - arm); x.lineTo(p[0], p[1] + arm); x.stroke();
        x.beginPath(); x.arc(p[0], p[1], Math.max(r, 4 * px), 0, Math.PI * 2); x.stroke();
      }
      x.fillStyle = '#2fbf7d'; x.beginPath(); x.arc(p[0], p[1], 2.5 * px, 0, Math.PI * 2); x.fill();
      if (!tool.offset || tool.placing) { // label the fixed marker
        x.font = `${11 * px}px -apple-system, sans-serif`; const t = 'Source', tw = x.measureText(t).width;
        x.fillStyle = 'rgba(20,21,24,0.85)'; x.fillRect(p[0] + r + 4 * px, p[1] - 8 * px, tw + 8 * px, 16 * px); x.fillStyle = '#fff'; x.fillText(t, p[0] + r + 8 * px, p[1] + 4 * px);
      }
    },
  };

  // Shared stroke: paints a mask, previews source pixels under the brush, heals on release
  function healStroke(tool, label, getOffset) {
    return {
      start(e, p) {
        const t = paintTarget(); if (!t || t.target === 'mask') { if (t) toast('Healing works on layer pixels, not masks'); return false; }
        tool.t = t; const d = doc();
        tool.acc = U.canvas(d.w, d.h); tool.ax = U.ctx(tool.acc); tool.ax.fillStyle = '#fff'; tool.last = null;
        tool.off = getOffset ? getOffset(p) : null;
        if (tool.off) { tool.srcC = SourcePoint.sourceCanvas(tool, t.L); tool.prev = U.canvas(d.w, d.h); tool.px = U.ctx(tool.prev); }
        this.add(p); return true;
      },
      add(p) {
        const r = tool.o.size / 2, hard = tool.o.hardness === undefined ? 1 : tool.o.hardness / 100;
        tool.last = strokePoints(tool.last, p, Math.max(1, r * 0.2), (x, y) => {
          if (hard >= 0.99) { tool.ax.beginPath(); tool.ax.arc(x, y, r, 0, Math.PI * 2); tool.ax.fill(); }
          else { const g = tool.ax.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, '#fff'); g.addColorStop(Math.max(0.01, hard), '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)'); tool.ax.fillStyle = g; tool.ax.fillRect(x - r, y - r, r * 2, r * 2); tool.ax.fillStyle = '#fff'; }
          if (tool.prev) { const c = tool.px; c.save(); c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.clip(); c.drawImage(tool.srcC, -tool.off[0], -tool.off[1]); c.restore(); }
        });
        view().requestRender();
      },
      finish() {
        if (!tool.acc) return; const d = doc(), L = tool.t.L, mask = K.Sel.clip(d, tool.acc), off = tool.off, srcC = tool.srcC;
        tool.acc = null; tool.prev = null; tool.srcC = null;
        if (!K.Layers.alphaBounds(mask)) { view().requestRender(); return; }
        K.UI.busy(true, 'Healing…');
        setTimeout(() => {
          try {
            if (off) K.Inpaint.healFrom(d, L, mask, srcC, off, { match: tool.o.mode === 'replace' ? 0 : 1, opacity: (tool.o.opacity || 100) / 100, feather: tool.o.mode === 'replace' ? 0.6 : 1.5 });
            else spotSynth(d, L, mask, tool.o.type);
            d.touch(L); d.push(label);
          } finally { K.UI.busy(false); view().requestRender(); K.UI.refreshLayers(); }
        }, 20);
      },
      overlay(x, v, px) {
        if (tool.prev) x.drawImage(tool.prev, 0, 0);
        else if (tool.acc) { x.save(); x.globalAlpha = 0.45; const t = U.clone(tool.acc), tx = U.ctx(t); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = '#8a8a8a'; tx.fillRect(0, 0, t.width, t.height); x.drawImage(t, 0, 0); x.restore(); }
      },
    };
  }

  function spotSynth(d, L, mask, type) {
    const b = K.Layers.alphaBounds(mask); if (!b) return;
    const margin = Math.max(30, Math.max(b.w, b.h) * (type === 'content' ? 1.5 : 0.6));
    const rx = Math.max(0, Math.floor(b.x - margin - L.x)), ry = Math.max(0, Math.floor(b.y - margin - L.y));
    const rw = Math.min(L.canvas.width - rx, Math.ceil(b.w + margin * 2)), rh = Math.min(L.canvas.height - ry, Math.ceil(b.h + margin * 2));
    const crop = U.canvas(rw, rh); U.ctx(crop).drawImage(L.canvas, -rx, -ry);
    K.Inpaint.fillCanvas(crop, mask, rx + L.x, ry + L.y);
    const soft = K.Sel.featherCanvas(mask, 1.2), sx = U.ctx(crop); sx.globalCompositeOperation = 'destination-in'; sx.drawImage(soft, -(rx + L.x), -(ry + L.y));
    U.ctx(L.canvas).drawImage(crop, rx, ry);
  }

  // ===== Spot Healing Brush: paint over a blemish; fills automatically, or from a source point you place =====
  tools.heal = {
    id: 'heal', name: 'Spot Healing Brush', hotkey: 'j', cursor: 'none',
    optionSpec: [O.size(30, 400), { key: 'type', label: 'Type', type: 'buttons', def: 'content', options: [['content', 'Content-aware'], ['texture', 'Proximity match'], ['source', 'Source point']] },
      { key: 'aligned', label: 'Aligned', type: 'check', def: false }, O.allLayers(false),
      { key: 'hint', type: 'hint', label: 'Alt-click to place a source marker (switches to Source point); Alt-drag moves it' }],
    down(e, p) {
      if (e.altKey) { SourcePoint.setFrom(this, e, p); if (this.o.type !== 'source') { this.o.type = 'source'; K.UI.renderOptions(); } toast('Source point set — paint over the spot to heal'); return; }
      if (this.o.type === 'source' && !SourcePoint.valid(this)) { toast('Alt-click to place the source marker first'); return; }
      this.placing = false;
      this.s = healStroke(this, 'Spot Healing', this.o.type === 'source' ? (q) => SourcePoint.startStroke(this, q) : null);
      if (!this.s.start(e, p)) this.s = null;
    },
    move(e, p) { if (this.placing && e.altKey) { this.source = [p[0], p[1]]; view().requestRender(); return; } if (this.s) this.s.add(p); },
    up() { if (this.placing) { this.placing = false; view().requestRender(); } if (this.s) { this.s.finish(); this.s = null; } },
    overlay(x, v, px) {
      if (this.s) this.s.overlay(x, v, px);
      if (this.o.type === 'source') SourcePoint.draw(this, x, v, px, !!this.s);
      brushCursor(x, v, px, this.o.size);
    },
  };

  // ===== Healing Brush: Alt-click a source, then paint; texture comes from the source, tone from the destination =====
  tools.healbrush = {
    id: 'healbrush', name: 'Healing Brush', hotkey: 'j', cursor: 'none',
    optionSpec: [O.size(40, 1000), O.hardness(100), { key: 'mode', label: 'Mode', type: 'select', def: 'normal', options: [['normal', 'Normal (blend)'], ['replace', 'Replace (copy exactly)']] },
      { key: 'aligned', label: 'Aligned', type: 'check', def: true }, O.allLayers(false),
      { key: 'hint', type: 'hint', label: 'Alt-click to place the source marker; Alt-drag moves it' }],
    down(e, p) {
      if (e.altKey) { SourcePoint.setFrom(this, e, p); toast('Source point set'); return; }
      if (!SourcePoint.valid(this)) { toast('Alt-click to place the source marker first'); return; }
      this.placing = false;
      this.s = healStroke(this, 'Healing Brush', (q) => SourcePoint.startStroke(this, q));
      if (!this.s.start(e, p)) this.s = null;
    },
    move(e, p) { if (this.placing && e.altKey) { this.source = [p[0], p[1]]; view().requestRender(); return; } if (this.s) this.s.add(p); },
    up() { if (this.placing) { this.placing = false; view().requestRender(); } if (this.s) { this.s.finish(); this.s = null; } },
    overlay(x, v, px) { if (this.s) this.s.overlay(x, v, px); SourcePoint.draw(this, x, v, px, !!this.s); brushCursor(x, v, px, this.o.size); },
  };

  tools.redeye = {
    id: 'redeye', name: 'Red Eye Removal', hotkey: 'y', cursor: 'crosshair',
    optionSpec: [{ key: 'size', label: 'Pupil size', type: 'range', min: 5, max: 300, def: 40, unit: 'px' }, { key: 'darken', label: 'Darken amount', type: 'range', min: 1, max: 100, def: 60, unit: '%' }, { key: 'hint', type: 'hint', label: 'Click on each red eye, or drag a box around it' }],
    down(e, p) { const t = paintTarget(); if (!t || t.target === 'mask') return; this.t = t; this.a = p; this.b = p; },
    move(e, p) { if (this.t) { this.b = p; view().requestRender(); } },
    up() {
      const t = this.t; this.t = null; if (!t) return; const d = doc(), L = t.L;
      let x0, y0, x1, y1;
      if (Math.hypot(this.b[0] - this.a[0], this.b[1] - this.a[1]) < 4) { const r = this.o.size / 2; x0 = this.a[0] - r; y0 = this.a[1] - r; x1 = this.a[0] + r; y1 = this.a[1] + r; }
      else { x0 = Math.min(this.a[0], this.b[0]); y0 = Math.min(this.a[1], this.b[1]); x1 = Math.max(this.a[0], this.b[0]); y1 = Math.max(this.a[1], this.b[1]); }
      const lx = Math.max(0, Math.floor(x0 - L.x)), ly = Math.max(0, Math.floor(y0 - L.y)), w = Math.min(L.canvas.width - lx, Math.ceil(x1 - x0)), h = Math.min(L.canvas.height - ly, Math.ceil(y1 - y0));
      if (w <= 0 || h <= 0) return;
      const ctx = U.ctx(L.canvas), data = ctx.getImageData(lx, ly, w, h);
      const orig = new Uint8ClampedArray(data.data);
      K.Adjust.redEye(data, 0, 0, w, h, 1);
      const dk = this.o.darken / 100, cx = w / 2, cy = h / 2;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4; if (orig[i] === data.data[i]) continue;
        const fall = U.clamp(1.2 - Math.hypot((x - cx) / cx, (y - cy) / cy), 0, 1);
        for (let c = 0; c < 3; c++) data.data[i + c] = U.lerp(orig[i + c], data.data[i + c] * (1 - dk * 0.6), Math.min(1, fall * 1.5));
      }
      ctx.putImageData(data, lx, ly); d.touch(L); d.push('Red Eye Removal'); view().requestRender();
    },
    overlay(x, v, px) { if (!this.t) return; x.strokeStyle = '#fff'; x.lineWidth = px; x.strokeRect(this.a[0], this.a[1], this.b[0] - this.a[0], this.b[1] - this.a[1]); },
  };

  tools.blur = makeRetouch('blur', 'Blur', 'r', [O.size(50), O.strength(50), O.hardness(30)], function (data, wts, g) {
    const d = data.data, src = new Uint8ClampedArray(d), w = g.w, h = g.h, k = this.o.strength / 100;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const wt = wts[y * w + x] * k; if (wt <= 0) continue; const i = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) { let s = 0, n = 0; for (let ky = -2; ky <= 2; ky++) for (let kx = -2; kx <= 2; kx++) { const yy = y + ky, xx = x + kx; if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue; s += src[(yy * w + xx) * 4 + c]; n++; } d[i + c] = U.lerp(src[i + c], s / n, wt); }
    }
  });
  tools.sharpen = makeRetouch('sharpen', 'Sharpen', 'r', [O.size(50), O.strength(30), O.hardness(30)], function (data, wts, g) {
    const d = data.data, src = new Uint8ClampedArray(d), w = g.w, h = g.h, k = this.o.strength / 100 * 0.6;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const wt = wts[y * w + x] * k; if (wt <= 0) continue; const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) { const lap = 4 * src[i + c] - src[i - 4 + c] - src[i + 4 + c] - src[i - w * 4 + c] - src[i + w * 4 + c]; d[i + c] = src[i + c] + lap * wt; }
    }
  });
  tools.smudge = makeRetouch('smudge', 'Smudge', 'r', [O.size(40), O.strength(50), O.hardness(30), { key: 'finger', label: 'Finger painting', type: 'check', def: false }], function (data, wts, g) {
    const d = data.data, w = g.w, h = g.h, k = this.o.strength / 100;
    if (!this.state.buf || this.state.bw !== w || this.state.bh !== h) {
      this.state.buf = new Float32Array(d.length); this.state.bw = w; this.state.bh = h;
      if (this.o.finger && !this.state.init) { const [r, gg, b] = U.hexToRgb(K.app.fg); for (let i = 0; i < d.length; i += 4) { this.state.buf[i] = r; this.state.buf[i + 1] = gg; this.state.buf[i + 2] = b; this.state.buf[i + 3] = 255; } }
      else for (let i = 0; i < d.length; i++) this.state.buf[i] = d[i];
      this.state.init = true; return;
    }
    const buf = this.state.buf;
    for (let i = 0, j = 0; j < w * h; i += 4, j++) {
      const wt = wts[j] * k; if (wt <= 0) continue;
      for (let c = 0; c < 4; c++) { const nv = U.lerp(d[i + c], buf[i + c], wt); buf[i + c] = U.lerp(buf[i + c], d[i + c], 1 - k * 0.9); d[i + c] = nv; }
    }
  });
  const toneW = (l, range) => range === 'shadows' ? Math.pow(1 - l, 2) : range === 'highlights' ? l * l : 1 - Math.abs(l - 0.5) * 2 * 0.8;
  tools.dodge = makeRetouch('dodge', 'Dodge', 'o', [O.size(60), { key: 'range', label: 'Range', type: 'select', def: 'midtones', options: [['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']] }, { key: 'exposure', label: 'Exposure', type: 'range', min: 1, max: 100, def: 30, unit: '%' }, O.hardness(20)], function (data, wts) {
    const d = data.data, k = this.o.exposure / 100 * 0.25;
    for (let i = 0, j = 0; j < wts.length; i += 4, j++) { const w = wts[j]; if (w <= 0) continue; const l = U.lum(d[i], d[i + 1], d[i + 2]) / 255, f = 1 + k * w * toneW(l, this.o.range); for (let c = 0; c < 3; c++) d[i + c] = d[i + c] * f + (255 - d[i + c]) * (f - 1) * 0.3; }
  });
  tools.burn = makeRetouch('burn', 'Burn', 'o', [O.size(60), { key: 'range', label: 'Range', type: 'select', def: 'midtones', options: [['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']] }, { key: 'exposure', label: 'Exposure', type: 'range', min: 1, max: 100, def: 30, unit: '%' }, O.hardness(20)], function (data, wts) {
    const d = data.data, k = this.o.exposure / 100 * 0.2;
    for (let i = 0, j = 0; j < wts.length; i += 4, j++) { const w = wts[j]; if (w <= 0) continue; const l = U.lum(d[i], d[i + 1], d[i + 2]) / 255, f = 1 - k * w * toneW(l, this.o.range); for (let c = 0; c < 3; c++) d[i + c] *= f; }
  });
  tools.sponge = makeRetouch('sponge', 'Sponge', 'o', [O.size(60), { key: 'mode', label: 'Mode', type: 'buttons', def: 'sat', options: [['sat', 'Saturate'], ['desat', 'Desaturate']] }, O.flow(40), O.hardness(20)], function (data, wts) {
    const d = data.data, k = (this.o.flow / 100) * 0.15 * (this.o.mode === 'sat' ? 1 : -1);
    for (let i = 0, j = 0; j < wts.length; i += 4, j++) { const w = wts[j]; if (w <= 0) continue; const l = U.lum(d[i], d[i + 1], d[i + 2]), f = 1 + k * w; for (let c = 0; c < 3; c++) d[i + c] = l + (d[i + c] - l) * f; }
  });

  // ===== Text =====
  const FONTS = ['Helvetica Neue', 'Helvetica', 'Arial', 'Avenir Next', 'Futura', 'Gill Sans', 'Optima', 'Georgia', 'Times New Roman', 'Baskerville', 'Didot', 'Palatino', 'Hoefler Text', 'American Typewriter', 'Courier New', 'Menlo', 'Impact', 'Marker Felt', 'Chalkboard SE', 'Noteworthy', 'Snell Roundhand', 'Zapfino', 'Bradley Hand', 'Copperplate', 'Rockwell', 'Trebuchet MS', 'Verdana', 'SF Pro Display'];
  tools.text = {
    id: 'text', name: 'Type', hotkey: 't', cursor: 'text',
    optionSpec: [
      { key: 'font', label: 'Font', type: 'font', def: 'Helvetica Neue', options: FONTS.map((f) => [f, f]) },
      { key: 'fstyle', label: '', type: 'fontstyle', def: '' },
      { key: 'size', label: 'Size', type: 'number', min: 4, max: 2000, def: 72, unit: 'px' },
      { key: 'color', label: 'Colour', type: 'color', def: '#ffffff' },
      { key: 'bold', label: 'B', type: 'toggle', def: true }, { key: 'italic', label: 'I', type: 'toggle', def: false }, { key: 'underline', label: 'U', type: 'toggle', def: false },
      { key: 'align', label: '', type: 'buttons', def: 'left', options: [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] },
      { key: 'leading', label: 'Leading', type: 'number', min: 0.5, max: 4, step: 0.05, def: 1.2 },
      { key: 'tracking', label: 'Tracking', type: 'number', min: -50, max: 200, def: 0, unit: 'px' },
    ],
    onOption(key) { const L = this.editing; if (!L) { const d = doc(); const a = d && d.active; if (a && a.type === 'text') { this.applyOpts(a); d.touch(a); d.push('Text Style'); view().requestRender(); } return; } this.applyOpts(L); doc().touch(L); this.positionEditor(); view().requestRender(); void key; },
    applyOpts(L) { Object.assign(L.tp, { font: this.o.font, fstyle: this.o.fstyle || '', ps: this.o.ps || '', weight: this.o.weight || 400, size: +this.o.size, color: this.o.color, bold: this.o.bold, italic: this.o.italic, underline: this.o.underline, align: this.o.align, leading: +this.o.leading, tracking: +this.o.tracking }); },
    down(e, p) {
      const d = doc();
      if (this.editing) { this.commit(); return; }
      for (let i = d.layers.length - 1; i >= 0; i--) {
        const L = d.layers[i]; if (L.type !== 'text' || !L.visible) continue;
        if (pointInPoly(p, L_.corners(L))) { d.setActive(L); this.edit(L); return; }
      }
      const tp = { text: '', font: this.o.font, fstyle: this.o.fstyle || '', ps: this.o.ps || '', weight: this.o.weight || 400, size: +this.o.size, color: this.o.color, bold: this.o.bold, italic: this.o.italic, underline: this.o.underline, align: this.o.align, leading: +this.o.leading, tracking: +this.o.tracking };
      const L = K.Layers.newLayer({ type: 'text', name: 'Text', tp, t: { x: p[0], y: p[1], sx: 1, sy: 1, rot: 0 } });
      const s = L_.srcOf(L); L.t.x = p[0] + s.width / 2 - tp.size * 0.35; L.t.y = p[1] + s.height / 2 - tp.size * 0.9;
      L._anchor = [p[0] - tp.size * 0.35, p[1] - tp.size * 0.9];
      d.addLayer(L); this.isNew = true; this.edit(L);
    },
    edit(L) {
      this.editing = L; const o = this.o;
      Object.assign(o, { font: L.tp.font, fstyle: L.tp.fstyle || '', ps: L.tp.ps || '', weight: L.tp.weight || 400, size: L.tp.size, color: L.tp.color, bold: L.tp.bold, italic: L.tp.italic, underline: !!L.tp.underline, align: L.tp.align, leading: L.tp.leading, tracking: L.tp.tracking || 0 });
      K.UI.renderOptions();
      const s = L_.srcOf(L); L._anchor = L._anchor || [L.t.x - s.width / 2 * L.t.sx, L.t.y - s.height / 2 * L.t.sy];
      const ta = document.getElementById('text-editor');
      ta.value = L.tp.text; ta.style.display = 'block';
      ta.oninput = () => { L.tp.text = ta.value; this.reflow(L); doc().touch(L); this.positionEditor(); view().requestRender(); };
      ta.onkeydown = (e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); this.commit(); }
        else if ((e.metaKey || e.ctrlKey) && e.shiftKey) { // Elements-style type shortcuts
          const k = e.key.toLowerCase(), tp = L.tp; let hit = true;
          if (k === 'l') tp.align = 'left'; else if (k === 'c') tp.align = 'center'; else if (k === 'r') tp.align = 'right';
          else if (k === 'u') tp.underline = !tp.underline;
          else if (k === '>' || k === '.') tp.size = Math.min(2000, tp.size + 1);
          else if (k === '<' || k === ',') tp.size = Math.max(1, tp.size - 1);
          else if (k === 'y') { tp.bold = false; tp.italic = false; tp.underline = false; }
          else hit = false;
          if (hit) { e.preventDefault(); Object.assign(this.o, { size: tp.size, align: tp.align, underline: !!tp.underline, bold: tp.bold, italic: tp.italic }); this.reflow(L); doc().touch(L); this.positionEditor(); K.UI.renderOptions(); view().requestRender(); }
        }
        e.stopPropagation();
      };
      this.positionEditor(); setTimeout(() => ta.focus(), 0); view().requestRender();
    },
    reflow(L) { // keep the top-left anchor fixed while typing
      const s = L_.srcOf(L), a = L._anchor; if (!a) return;
      const [rx, ry] = U.rot(s.width / 2 * L.t.sx, s.height / 2 * L.t.sy, L.t.rot); L.t.x = a[0] + rx; L.t.y = a[1] + ry;
    },
    positionEditor() {
      const L = this.editing; if (!L) return; const ta = document.getElementById('text-editor');
      const s = L_.srcOf(L), z = doc().view.zoom * Math.abs(L.t.sx);
      const [sx, sy] = view().toScreen(L.t.x, L.t.y);
      ta.style.font = L_.textFont(L.tp, z); ta.style.color = 'transparent'; ta.style.caretColor = L.tp.color === '#ffffff' ? '#3d8bff' : L.tp.color;
      ta.style.lineHeight = (L.tp.size * L.tp.leading * z) + 'px'; ta.style.textAlign = L.tp.align;
      ta.style.letterSpacing = ((L.tp.tracking || 0) * z) + 'px';
      const pad = Math.ceil(L.tp.size * 0.35) * z;
      ta.style.padding = pad + 'px';
      ta.style.width = (s.width * z + 40) + 'px'; ta.style.height = (s.height * z + 10) + 'px';
      ta.style.left = (sx - s.width * z / 2) + 'px'; ta.style.top = (sy - s.height * z / 2) + 'px';
      ta.style.transform = `rotate(${L.t.rot}rad)`; ta.style.transformOrigin = `${s.width * z / 2}px ${s.height * z / 2}px`;
    },
    commit() {
      const L = this.editing; if (!L) return; const d = doc();
      const ta = document.getElementById('text-editor'); ta.style.display = 'none'; ta.blur();
      this.editing = null; delete L._anchor;
      if (!L.tp.text.trim()) { d.removeLayer(L); if (!this.isNew) d.push('Delete Text'); }
      else { L.name = L.tp.text.split('\n')[0].slice(0, 30); d.touch(L); d.push(this.isNew ? 'Add Text' : 'Edit Text'); }
      this.isNew = false; K.UI.refreshLayers(); view().requestRender();
    },
    deactivate() { this.commit(); },
    key(e) { if (this.editing && e.key === 'Escape') { this.commit(); return true; } return false; },
    screenOverlay(x) {
      const L = this.editing; if (!L) return;
      const pts = L_.corners(L).map((q) => view().toScreen(...q));
      x.strokeStyle = '#3d8bff'; x.setLineDash([3, 3]); x.beginPath(); pts.forEach((q, i) => (i ? x.lineTo(...q) : x.moveTo(...q))); x.closePath(); x.stroke(); x.setLineDash([]);
    },
  };

  // ===== Shapes =====
  tools.shape = {
    id: 'shape', name: 'Shapes', hotkey: 'u', cursor: 'crosshair',
    optionSpec: [
      { key: 'shape', label: '', type: 'buttons', def: 'rect', options: [['rect', 'Rectangle'], ['rounded', 'Rounded'], ['ellipse', 'Ellipse'], ['polygon', 'Polygon'], ['star', 'Star'], ['line', 'Line'], ['arrow', 'Arrow'], ['heart', 'Heart'], ['speech', 'Speech bubble']] },
      { key: 'fill', label: 'Fill', type: 'color', def: '#3d8bff' }, { key: 'useFill', label: 'Fill', type: 'check', def: true },
      { key: 'stroke', label: 'Stroke', type: 'color', def: '#ffffff' }, { key: 'strokeW', label: 'Width', type: 'number', min: 0, max: 200, def: 0, unit: 'px' },
      { key: 'radius', label: 'Radius', type: 'number', min: 0, max: 500, def: 24, unit: 'px' },
      { key: 'sides', label: 'Sides', type: 'number', min: 3, max: 30, def: 5 },
    ],
    down(e, p) { this.a = p; this.b = p; },
    move(e, p) {
      if (!this.a) return;
      if (e.shiftKey) { const dx = p[0] - this.a[0], dy = p[1] - this.a[1]; if (this.o.shape === 'line' || this.o.shape === 'arrow') { const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy); p = [this.a[0] + Math.cos(ang) * len, this.a[1] + Math.sin(ang) * len]; } else { const s = Math.max(Math.abs(dx), Math.abs(dy)); p = [this.a[0] + Math.sign(dx || 1) * s, this.a[1] + Math.sign(dy || 1) * s]; } }
      this.b = p; view().requestRender();
    },
    path(a, b) {
      const o = this.o, p = new Path2D(), x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]), cx = x0 + w / 2, cy = y0 + h / 2;
      switch (o.shape) {
        case 'rect': p.rect(x0, y0, w, h); break;
        case 'rounded': p.roundRect(x0, y0, w, h, Math.min(+o.radius, w / 2, h / 2)); break;
        case 'ellipse': p.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2); break;
        case 'polygon': case 'star': {
          const n = Math.max(3, +o.sides | 0), pts = o.shape === 'star' ? n * 2 : n;
          for (let i = 0; i < pts; i++) { const ang = -Math.PI / 2 + i * Math.PI * 2 / pts, r = o.shape === 'star' && i % 2 ? 0.45 : 1; const X = cx + Math.cos(ang) * w / 2 * r, Y = cy + Math.sin(ang) * h / 2 * r; i ? p.lineTo(X, Y) : p.moveTo(X, Y); }
          p.closePath(); break;
        }
        case 'heart': {
          p.moveTo(cx, y0 + h * 0.3);
          p.bezierCurveTo(cx, y0, x0, y0, x0, y0 + h * 0.32); p.bezierCurveTo(x0, y0 + h * 0.62, cx, y0 + h * 0.78, cx, y0 + h);
          p.bezierCurveTo(cx, y0 + h * 0.78, x0 + w, y0 + h * 0.62, x0 + w, y0 + h * 0.32); p.bezierCurveTo(x0 + w, y0, cx, y0, cx, y0 + h * 0.3); p.closePath(); break;
        }
        case 'speech': { const r = Math.min(+o.radius, w / 4, h / 4); p.roundRect(x0, y0, w, h * 0.78, r); p.moveTo(x0 + w * 0.22, y0 + h * 0.76); p.lineTo(x0 + w * 0.15, y0 + h); p.lineTo(x0 + w * 0.42, y0 + h * 0.76); p.closePath(); break; }
        default: break;
      }
      return p;
    },
    drawShape(x, a, b) {
      const o = this.o, sw = +o.strokeW;
      if (o.shape === 'line' || o.shape === 'arrow') {
        x.strokeStyle = o.fill; x.lineWidth = Math.max(1, sw || 6); x.lineCap = 'round'; x.beginPath(); x.moveTo(...a); x.lineTo(...b); x.stroke();
        if (o.shape === 'arrow') { const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), s = Math.max(14, x.lineWidth * 3.5); x.fillStyle = o.fill; x.beginPath(); x.moveTo(...b); x.lineTo(b[0] - Math.cos(ang - 0.45) * s, b[1] - Math.sin(ang - 0.45) * s); x.lineTo(b[0] - Math.cos(ang + 0.45) * s, b[1] - Math.sin(ang + 0.45) * s); x.closePath(); x.fill(); }
        return;
      }
      const p = this.path(a, b);
      if (o.useFill) { x.fillStyle = o.fill; x.fill(p); }
      if (sw > 0) { x.strokeStyle = o.stroke; x.lineWidth = sw; x.lineJoin = 'round'; x.stroke(p); }
    },
    up() {
      const a = this.a, b = this.b; this.a = null; if (!a || Math.hypot(b[0] - a[0], b[1] - a[1]) < 2) return;
      const d = doc(), L = d.addPixelLayer(d.nextName('Shape'));
      this.drawShape(U.ctx(L.canvas), a, b); d.toSmart(L); d.touch(L); d.push('Draw Shape'); K.UI.refreshLayers(); view().requestRender();
    },
    overlay(x) { if (this.a) { x.save(); this.drawShape(x, this.a, this.b); x.restore(); } },
  };

  // Register defaults on each tool
  for (const k in tools) {
    const t = tools[k]; t.o = {};
    for (const s of t.optionSpec || []) if (s.def !== undefined) t.o[s.key] = s.def;
  }

  K.tools = tools;
  K.ToolHelpers = { pickLayer, duplicateLayer, pointInPoly, paintTarget, contentOnly };
  K.TOOL_ORDER = [
    ['move'], ['hand'], ['zoom'],
    ['marquee', 'ellipse'], ['lasso', 'polylasso'], ['wand', 'quickselect'],
    ['crop'], ['straighten'], ['eyedropper'],
    ['brush', 'pencil'], ['eraser', 'bgeraser', 'magiceraser'], ['bucket', 'gradient'],
    ['clone'], ['heal', 'healbrush'], ['redeye'], ['blur', 'sharpen', 'smudge'], ['dodge', 'burn', 'sponge'],
    ['text'], ['shape'],
  ];
})(window.K);
