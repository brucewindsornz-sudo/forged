// Forged — canvas viewport: zoom/pan, drawing the document and overlays
(function (K) {
  'use strict';
  const U = K.U;
  const RULER = 20;

  class View {
    constructor(canvas) {
      this.c = canvas; this.x = canvas.getContext('2d');
      this.dpr = window.devicePixelRatio || 1;
      this.antsOffset = 0; this.showGrid = false; this.showRulers = false; this.snap = true;
      this.cursorPos = null;
      this.pattern = null;
      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
      setInterval(() => { const d = K.app.doc; if (d && d.sel) { this.antsOffset = (this.antsOffset + 1) % 16; this.requestRender(); } }, 90);
      this.requestRender = U.rafThrottle(() => this.render());
      this.resize();
    }
    get doc() { return K.app.doc; }
    get v() { return this.doc ? this.doc.view : { zoom: 1, panX: 0, panY: 0 }; }
    get offset() { return this.showRulers ? RULER : 0; }
    resize() {
      const r = this.c.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      // Only touch the canvas size when it really changed; resetting it clears the canvas and causes a flash
      if (r.width === this.w && r.height === this.h && dpr === this.dpr && this.c.width) return;
      this.dpr = dpr;
      this.w = r.width; this.h = r.height;
      this.c.width = Math.round(r.width * this.dpr); this.c.height = Math.round(r.height * this.dpr);
      this.c.style.width = r.width + 'px'; this.c.style.height = r.height + 'px';
      if (this.doc && !this.doc.view.fitted) this.fit();
      this.render(); // draw immediately so a resized (cleared) canvas is never shown blank
    }
    fit() {
      const d = this.doc; if (!d) return;
      const o = this.offset, pad = 40, aw = this.w - o - pad * 2, ah = this.h - o - pad * 2;
      const z = Math.min(1, aw / d.w, ah / d.h);
      d.view.zoom = Math.max(0.01, z); d.view.fitted = true;
      d.view.panX = o + (this.w - o - d.w * d.view.zoom) / 2; d.view.panY = o + (this.h - o - d.h * d.view.zoom) / 2;
      this.afterZoom();
    }
    setZoom(z, sx, sy) {
      const d = this.doc; if (!d) return;
      z = U.clamp(z, 0.01, 64);
      if (sx === undefined) { sx = this.w / 2; sy = this.h / 2; }
      const [px, py] = this.toDoc(sx, sy);
      d.view.zoom = z; d.view.panX = sx - px * z; d.view.panY = sy - py * z;
      this.afterZoom();
    }
    zoomStep(dir, sx, sy) {
      const steps = [0.01, 0.02, 0.03, 0.05, 0.0667, 0.0833, 0.125, 0.1667, 0.25, 0.333, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 5, 6, 8, 12, 16, 24, 32, 48, 64];
      const z = this.v.zoom; let next = z;
      if (dir > 0) next = steps.find((s) => s > z * 1.001) || 64; else next = [...steps].reverse().find((s) => s < z / 1.001) || 0.01;
      this.setZoom(next, sx, sy);
    }
    afterZoom() { K.UI && K.UI.updateStatus(); this.requestRender(); }
    toDoc(sx, sy) { const v = this.v; return [(sx - v.panX) / v.zoom, (sy - v.panY) / v.zoom]; }
    toScreen(x, y) { const v = this.v; return [x * v.zoom + v.panX, y * v.zoom + v.panY]; }

    checker() {
      if (this.pattern) return this.pattern;
      const s = 8, c = U.canvas(s * 2, s * 2), x = U.ctx(c);
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, s * 2, s * 2); x.fillStyle = '#d6d6d6'; x.fillRect(0, 0, s, s); x.fillRect(s, s, s, s);
      this.pattern = this.x.createPattern(c, 'repeat'); return this.pattern;
    }

    render() {
      const x = this.x, d = this.doc, dpr = this.dpr;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.fillStyle = getComputedStyle(document.body).getPropertyValue('--canvas-bg') || '#202124';
      x.fillRect(0, 0, this.w, this.h);
      if (!d) return;
      const v = d.view, W = d.w * v.zoom, H = d.h * v.zoom;
      // shadow + checkerboard
      x.save(); x.shadowColor = 'rgba(0,0,0,0.45)'; x.shadowBlur = 18; x.fillStyle = '#fff'; x.fillRect(v.panX, v.panY, W, H); x.restore();
      x.save(); x.beginPath(); x.rect(v.panX, v.panY, W, H); x.clip();
      x.fillStyle = this.checker(); x.fillRect(v.panX, v.panY, W, H);
      const comp = d.composite();
      x.imageSmoothingEnabled = v.zoom < 2; x.imageSmoothingQuality = 'high';
      x.drawImage(comp, v.panX, v.panY, W, H);
      x.restore();
      // overlays in document space
      x.save(); x.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * v.panX, dpr * v.panY);
      const px = 1 / v.zoom;
      if (this.showGrid) this.drawGrid(x, d, px);
      if (d.sel) this.drawAnts(x, d, px);
      if (!this.hideGuides || this.guideDrag) this.drawGuides(x, d, px);
      if (this.originDrag) { x.strokeStyle = '#00d0ff'; x.lineWidth = px; x.setLineDash([4 * px, 3 * px]); x.beginPath(); x.moveTo(this.originDrag[0], -1e5); x.lineTo(this.originDrag[0], 1e5); x.moveTo(-1e5, this.originDrag[1]); x.lineTo(1e5, this.originDrag[1]); x.stroke(); x.setLineDash([]); }
      const tool = K.app.tool;
      if (tool && tool.overlay) tool.overlay(x, this, px);
      x.restore();
      if (tool && tool.screenOverlay) { x.save(); x.setTransform(dpr, 0, 0, dpr, 0, 0); tool.screenOverlay(x, this); x.restore(); }
      if (this.showRulers) this.drawRulers(x);
      if (this.guideDrag) this.drawGuideLabel(x);
    }
    drawGuideLabel(x) {
      const d = this.doc, g = this.guideDrag, dpr = this.dpr, u = this.unit();
      const val = U.fmtUnit(g.pos - d.origin[g.axis === 'v' ? 0 : 1], u, d.ppi);
      const txt = (g.axis === 'v' ? 'X ' : 'Y ') + val;
      const [sx, sy] = this.toScreen(g.axis === 'v' ? g.pos : (this.cursorPos ? this.cursorPos[0] : 0), g.axis === 'h' ? g.pos : (this.cursorPos ? this.cursorPos[1] : 0));
      x.setTransform(dpr, 0, 0, dpr, 0, 0); x.font = '11px -apple-system, sans-serif';
      const w = x.measureText(txt).width + 12, bx = Math.min(this.w - w - 4, sx + 12), by = Math.min(this.h - 26, Math.max(this.offset + 4, sy + 12));
      x.fillStyle = 'rgba(20,21,24,0.92)'; x.beginPath(); x.roundRect ? x.roundRect(bx, by, w, 20, 4) : x.rect(bx, by, w, 20); x.fill();
      x.fillStyle = '#e8eaed'; x.fillText(txt, bx + 6, by + 14);
    }
    unit() { return (K.prefs && K.prefs.rulerUnits) || 'cm'; }
    drawGrid(x, d, px) {
      const P = K.prefs || {}, unitPx = U.pxPerUnit(P.gridUnit || 'cm', d.ppi), major = Math.max(2, (P.gridEvery || 2) * unitPx), sub = Math.max(1, Math.round(P.gridSubdiv || 4));
      const ox = ((d.origin[0] % major) + major) % major, oy = ((d.origin[1] % major) + major) % major;
      const line = (step, alpha, offX, offY) => {
        x.strokeStyle = `rgba(0,200,255,${alpha})`; x.lineWidth = px; x.beginPath();
        for (let gx = offX; gx <= d.w; gx += step) { x.moveTo(gx, 0); x.lineTo(gx, d.h); }
        for (let gy = offY; gy <= d.h; gy += step) { x.moveTo(0, gy); x.lineTo(d.w, gy); }
        x.stroke();
      };
      const minor = major / sub;
      if (sub > 1 && minor * d.view.zoom >= 5) line(minor, 0.16, ox % minor, oy % minor);
      if (major * d.view.zoom >= 3) line(major, 0.42, ox, oy);
    }
    drawGuides(x, d, px) {
      const P = K.prefs || {};
      x.strokeStyle = P.guideColor || '#00d0ff'; x.lineWidth = px;
      if (P.guideStyle === 'dashed') x.setLineDash([5 * px, 4 * px]);
      for (const g of d.guides) {
        x.globalAlpha = g === this.guideDrag ? 1 : 0.95; x.beginPath();
        if (g.axis === 'v') { x.moveTo(g.pos, -1e5); x.lineTo(g.pos, 1e5); } else { x.moveTo(-1e5, g.pos); x.lineTo(1e5, g.pos); }
        x.stroke();
      }
      x.setLineDash([]); x.globalAlpha = 1;
    }
    drawAnts(x, d, px) {
      const p = K.Sel.outline(d.sel);
      x.lineWidth = px; x.setLineDash([4 * px, 4 * px]);
      x.strokeStyle = '#000'; x.lineDashOffset = -this.antsOffset * px * 0.5; x.stroke(p);
      x.strokeStyle = '#fff'; x.lineDashOffset = -this.antsOffset * px * 0.5 + 4 * px; x.stroke(p);
      x.setLineDash([]);
    }
    // Rulers are labelled in the chosen unit, measured from the document's ruler origin.
    drawRulers(x) {
      const d = this.doc, v = d.view, dpr = this.dpr, unit = this.unit(), unitPx = U.pxPerUnit(unit, d.ppi);
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.fillStyle = '#2b2c30'; x.fillRect(0, 0, this.w, RULER); x.fillRect(0, 0, RULER, this.h);
      x.strokeStyle = '#3c3d42'; x.beginPath(); x.moveTo(0, RULER - 0.5); x.lineTo(this.w, RULER - 0.5); x.moveTo(RULER - 0.5, 0); x.lineTo(RULER - 0.5, this.h); x.stroke();
      const scr = unitPx * v.zoom; // screen pixels per unit
      const nice = unit === 'in' ? [0.0625, 0.125, 0.25, 0.5, 1, 2, 3, 6, 12, 24, 48, 96, 192]
        : [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
      const step = nice.find((s) => s * scr >= 56) || nice[nice.length - 1];
      const spacing = step * scr;
      const sub = unit === 'in' ? (spacing / 8 >= 5 ? 8 : spacing / 4 >= 5 ? 4 : 2) : (spacing / 10 >= 5 ? 10 : spacing / 5 >= 5 ? 5 : 2);
      const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
      const label = (u) => { const r = +u.toFixed(Math.min(4, digits + 1)); return String(Math.abs(r) < 1e-9 ? 0 : r); };
      x.fillStyle = '#9aa0a6'; x.strokeStyle = '#6b6f76'; x.font = '9px -apple-system, sans-serif'; x.lineWidth = 1;
      const axis = (horiz) => {
        const o = horiz ? d.origin[0] : d.origin[1], pan = horiz ? v.panX : v.panY, len = horiz ? this.w : this.h;
        const u0 = ((RULER - pan) / v.zoom - o) / unitPx, u1 = ((len - pan) / v.zoom - o) / unitPx;
        const i0 = Math.floor(u0 / step) * sub, i1 = Math.ceil(u1 / step) * sub;
        if (i1 - i0 > 4000) return;
        x.beginPath();
        for (let i = i0; i <= i1; i++) {
          const u = (i / sub) * step, s = Math.round((o + u * unitPx) * v.zoom + pan) + 0.5;
          if (s < RULER) continue;
          const major = i % sub === 0, half = !major && sub % 2 === 0 && i % (sub / 2) === 0;
          const tick = major ? RULER : half ? 8 : 5;
          if (horiz) { x.moveTo(s, RULER); x.lineTo(s, RULER - tick); } else { x.moveTo(RULER, s); x.lineTo(RULER - tick, s); }
          if (major) {
            const t = label(u);
            if (horiz) x.fillText(t, s + 3, 9);
            else { x.save(); x.translate(9, s + 3); x.rotate(-Math.PI / 2); x.textAlign = 'right'; x.fillText(t, 0, 0); x.restore(); }
          }
        }
        x.stroke();
      };
      axis(true); axis(false);
      // guide markers on the rulers
      if (!this.hideGuides) {
        x.fillStyle = (K.prefs && K.prefs.guideColor) || '#00d0ff';
        for (const g of d.guides) { const [gs] = g.axis === 'v' ? this.toScreen(g.pos, 0) : [this.toScreen(0, g.pos)[1]]; if (gs < RULER) continue; if (g.axis === 'v') x.fillRect(gs - 1, RULER - 4, 2, 4); else x.fillRect(RULER - 4, gs - 1, 4, 2); }
      }
      if (this.cursorPos) {
        const [sx, sy] = this.toScreen(...this.cursorPos);
        x.strokeStyle = '#00d0ff'; x.beginPath(); if (sx > RULER) { x.moveTo(Math.round(sx) + 0.5, 0); x.lineTo(Math.round(sx) + 0.5, RULER); } if (sy > RULER) { x.moveTo(0, Math.round(sy) + 0.5); x.lineTo(RULER, Math.round(sy) + 0.5); } x.stroke();
      }
      // corner box: unit label; drag it to set the zero point, double-click to reset
      x.fillStyle = '#232428'; x.fillRect(0, 0, RULER, RULER);
      x.strokeStyle = '#6b6f76'; x.beginPath(); x.moveTo(4, 13.5); x.lineTo(RULER - 4, 13.5); x.moveTo(13.5, 4); x.lineTo(13.5, RULER - 4); x.stroke();
      x.fillStyle = '#c4c7cc'; x.font = 'bold 8px -apple-system, sans-serif'; x.textAlign = 'left'; x.fillText(unit, 2, 9);
    }
    inCorner(sx, sy) { return this.showRulers && sx < RULER && sy < RULER; }
    inRuler(sx, sy) { if (!this.showRulers) return null; if (sy < RULER && sx > RULER) return 'h'; if (sx < RULER && sy > RULER) return 'v'; return null; }
  }
  K.View = View;
})(window.K);
