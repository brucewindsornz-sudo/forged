// Forged — selections (stored as document-sized alpha masks)
(function (K) {
  'use strict';
  const U = K.U, clamp = U.clamp;

  const blank = (doc) => U.canvas(doc.w, doc.h);
  function maskFromDraw(doc, draw) { const c = blank(doc), x = U.ctx(c); x.fillStyle = '#fff'; x.strokeStyle = '#fff'; draw(x); return c; }

  function bounds(c) { return K.Layers.alphaBounds(c); }
  function make(c) { const b = bounds(c); return b ? { canvas: c, bounds: b, path: null } : null; }

  function combine(doc, mask, mode = 'new', feather = 0) {
    if (feather > 0) mask = featherCanvas(mask, feather);
    let out;
    if (mode === 'new' || !doc.sel) out = mode === 'sub' ? null : mask;
    else {
      out = U.clone(doc.sel.canvas); const x = U.ctx(out);
      if (mode === 'add') x.drawImage(mask, 0, 0);
      else if (mode === 'sub') { x.globalCompositeOperation = 'destination-out'; x.drawImage(mask, 0, 0); }
      else if (mode === 'int') { x.globalCompositeOperation = 'destination-in'; x.drawImage(mask, 0, 0); }
    }
    doc.sel = out ? make(out) : null;
    doc.emit('selection');
    return doc.sel;
  }

  function featherCanvas(c, r) {
    const pad = Math.ceil(r * 3), t = U.canvas(c.width, c.height), x = U.ctx(t);
    x.filter = `blur(${r}px)`; x.drawImage(c, 0, 0); void pad; return t;
  }
  function threshold(c, level = 128) {
    const d = U.getData(c); const a = d.data;
    for (let i = 0; i < a.length; i += 4) { const v = a[i + 3] >= level ? 255 : 0; a[i] = a[i + 1] = a[i + 2] = 255; a[i + 3] = v; }
    return U.fromData(d);
  }
  function grow(c, r) {
    // expand (r>0) or contract (r<0) by blurring then thresholding
    const b = featherCanvas(c, Math.abs(r) / 2);
    return threshold(b, r > 0 ? 8 : 247);
  }

  const S = {
    rect(doc, x, y, w, h, mode, feather) { return combine(doc, maskFromDraw(doc, (c) => c.fillRect(x, y, w, h)), mode, feather); },
    ellipse(doc, x, y, w, h, mode, feather) { return combine(doc, maskFromDraw(doc, (c) => { c.beginPath(); c.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2); c.fill(); }), mode, feather); },
    polygon(doc, pts, mode, feather) {
      if (pts.length < 3) return doc.sel;
      return combine(doc, maskFromDraw(doc, (c) => { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (const p of pts) c.lineTo(p[0], p[1]); c.closePath(); c.fill(); }), mode, feather);
    },
    fromMask(doc, mask, mode, feather) { return combine(doc, mask, mode, feather); },
    all(doc) { return combine(doc, maskFromDraw(doc, (c) => c.fillRect(0, 0, doc.w, doc.h)), 'new'); },
    none(doc) { doc.sel = null; doc.emit('selection'); },
    invert(doc) {
      if (!doc.sel) return S.all(doc);
      const c = maskFromDraw(doc, (x) => x.fillRect(0, 0, doc.w, doc.h)), x = U.ctx(c);
      x.globalCompositeOperation = 'destination-out'; x.drawImage(doc.sel.canvas, 0, 0);
      doc.sel = make(c); doc.emit('selection'); return doc.sel;
    },
    feather(doc, r) { if (!doc.sel) return; doc.sel = make(featherCanvas(doc.sel.canvas, r)); doc.emit('selection'); },
    grow(doc, r) { if (!doc.sel) return; doc.sel = make(grow(doc.sel.canvas, r)); doc.emit('selection'); },
    smooth(doc, r) { if (!doc.sel) return; doc.sel = make(threshold(featherCanvas(doc.sel.canvas, r), 128)); doc.emit('selection'); },
    border(doc, r) {
      if (!doc.sel) return;
      const outer = grow(doc.sel.canvas, r), inner = grow(doc.sel.canvas, -r), x = U.ctx(outer);
      x.globalCompositeOperation = 'destination-out'; x.drawImage(inner, 0, 0);
      doc.sel = make(featherCanvas(outer, 1)); doc.emit('selection');
    },
    fromLayer(doc, L, mode = 'new') {
      const c = doc.renderLayer(L); const m = U.clone(c), x = U.ctx(m);
      x.globalCompositeOperation = 'source-in'; x.fillStyle = '#fff'; x.fillRect(0, 0, doc.w, doc.h);
      return combine(doc, m, mode);
    },
    // Flood / global colour selection
    wandMask(doc, src, px, py, tol, contiguous, region) {
      const w = doc.w, h = doc.h, d = U.getData(src).data, out = new ImageData(w, h), o = out.data;
      px = Math.floor(px); py = Math.floor(py);
      if (px < 0 || py < 0 || px >= w || py >= h) return null;
      const si = (py * w + px) * 4, r0 = d[si], g0 = d[si + 1], b0 = d[si + 2], a0 = d[si + 3];
      const t = tol * 3;
      const match = (i) => Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) + Math.abs(d[i + 3] - a0) * 0.7 <= t;
      const rx0 = region ? Math.max(0, region.x) : 0, ry0 = region ? Math.max(0, region.y) : 0;
      const rx1 = region ? Math.min(w, region.x + region.w) : w, ry1 = region ? Math.min(h, region.y + region.h) : h;
      if (contiguous) {
        const seen = new Uint8Array(w * h), stack = [px, py];
        while (stack.length) {
          const y = stack.pop(), x = stack.pop();
          let xl = x; while (xl > rx0 && !seen[y * w + xl - 1] && match((y * w + xl - 1) * 4)) xl--;
          let xr = x; while (xr < rx1 - 1 && !seen[y * w + xr + 1] && match((y * w + xr + 1) * 4)) xr++;
          for (let xx = xl; xx <= xr; xx++) {
            const j = y * w + xx; seen[j] = 1; o[j * 4] = o[j * 4 + 1] = o[j * 4 + 2] = o[j * 4 + 3] = 255;
            if (y > ry0 && !seen[j - w] && match((j - w) * 4)) stack.push(xx, y - 1);
            if (y < ry1 - 1 && !seen[j + w] && match((j + w) * 4)) stack.push(xx, y + 1);
          }
        }
      } else {
        for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) { const j = y * w + x; if (match(j * 4)) o[j * 4] = o[j * 4 + 1] = o[j * 4 + 2] = o[j * 4 + 3] = 255; }
      }
      return U.fromData(out);
    },
    wand(doc, src, px, py, tol, contiguous, mode, antialias = true) {
      let m = S.wandMask(doc, src, px, py, tol, contiguous); if (!m) return doc.sel;
      if (antialias) m = featherCanvas(m, 0.6);
      return combine(doc, m, mode);
    },
    colorRange(doc, src, rgb, fuzz, mode = 'new') {
      const d = U.getData(src), a = d.data, out = new ImageData(doc.w, doc.h), o = out.data;
      for (let i = 0; i < a.length; i += 4) {
        const dist = Math.hypot(a[i] - rgb[0], a[i + 1] - rgb[1], a[i + 2] - rgb[2]);
        const v = clamp(1 - dist / Math.max(1, fuzz * 2.5), 0, 1) * 255;
        o[i] = o[i + 1] = o[i + 2] = 255; o[i + 3] = v;
      }
      return combine(doc, U.fromData(out), mode);
    },
    // Heuristic subject selection: model the border colours as background, keep the largest distinct region
    subjectMask(doc, src) {
      const scale = Math.min(1, 360 / Math.max(doc.w, doc.h));
      const sw = Math.max(8, Math.round(doc.w * scale)), sh = Math.max(8, Math.round(doc.h * scale));
      const small = U.resample(src, sw, sh), d = U.getData(small).data, n = sw * sh;
      const lab = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { lab[i * 3] = d[i * 4]; lab[i * 3 + 1] = d[i * 4 + 1]; lab[i * 3 + 2] = d[i * 4 + 2]; }
      // gather border samples & k-means into 6 clusters
      const samples = [];
      for (let x = 0; x < sw; x++) { samples.push(x, (sw * (sh - 1) + x)); }
      for (let y = 0; y < sh; y++) { samples.push(y * sw, y * sw + sw - 1); }
      const k = 6, cent = [];
      for (let i = 0; i < k; i++) { const j = samples[Math.floor(i * samples.length / k)]; cent.push([lab[j * 3], lab[j * 3 + 1], lab[j * 3 + 2]]); }
      for (let it = 0; it < 8; it++) {
        const acc = cent.map(() => [0, 0, 0, 0]);
        for (const j of samples) {
          let best = 0, bd = Infinity;
          for (let c = 0; c < k; c++) { const dd = (lab[j * 3] - cent[c][0]) ** 2 + (lab[j * 3 + 1] - cent[c][1]) ** 2 + (lab[j * 3 + 2] - cent[c][2]) ** 2; if (dd < bd) { bd = dd; best = c; } }
          acc[best][0] += lab[j * 3]; acc[best][1] += lab[j * 3 + 1]; acc[best][2] += lab[j * 3 + 2]; acc[best][3]++;
        }
        acc.forEach((a, c) => { if (a[3]) cent[c] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
      }
      const dist = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let bd = Infinity; for (let c = 0; c < k; c++) bd = Math.min(bd, Math.hypot(lab[i * 3] - cent[c][0], lab[i * 3 + 1] - cent[c][1], lab[i * 3 + 2] - cent[c][2]));
        dist[i] = bd;
      }
      const sorted = Array.from(dist).sort((a, b) => a - b), thr = Math.max(28, sorted[Math.floor(n * 0.5)] * 1.15);
      const fg = new Uint8Array(n); for (let i = 0; i < n; i++) fg[i] = dist[i] > thr ? 1 : 0;
      // background = flood from borders through non-foreground; everything else is subject (fills holes)
      const bg = new Uint8Array(n), st = [];
      for (const j of samples) if (!fg[j] && !bg[j]) { bg[j] = 1; st.push(j); }
      while (st.length) { const j = st.pop(), x = j % sw, y = (j / sw) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue; const q = yy * sw + xx; if (!bg[q] && !fg[q]) { bg[q] = 1; st.push(q); } } }
      // largest connected subject component
      const lbl = new Int32Array(n).fill(-1); let bestL = -1, bestN = 0, cur = 0;
      for (let i = 0; i < n; i++) if (!bg[i] && lbl[i] < 0) {
        let cnt = 0; const q = [i]; lbl[i] = cur;
        while (q.length) { const j = q.pop(); cnt++; const x = j % sw, y = (j / sw) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue; const p = yy * sw + xx; if (!bg[p] && lbl[p] < 0) { lbl[p] = cur; q.push(p); } } }
        if (cnt > bestN) { bestN = cnt; bestL = cur; } cur++;
      }
      const m = new ImageData(sw, sh);
      for (let i = 0; i < n; i++) if (lbl[i] === bestL) { m.data[i * 4] = m.data[i * 4 + 1] = m.data[i * 4 + 2] = m.data[i * 4 + 3] = 255; }
      let mc = U.fromData(m);
      const full = U.canvas(doc.w, doc.h), fx = U.ctx(full); fx.imageSmoothingQuality = 'high'; fx.drawImage(mc, 0, 0, doc.w, doc.h);
      mc = threshold(featherCanvas(full, Math.max(1, 1.5 / scale)), 128);
      return featherCanvas(mc, 1);
    },
    // Outline segments for marching ants (path in doc coords)
    outline(sel) {
      if (sel.path) return sel.path;
      const c = sel.canvas, b = sel.bounds;
      const step = Math.max(1, Math.ceil(Math.max(b.w, b.h) / 2000));
      const d = U.ctx(c).getImageData(b.x, b.y, b.w, b.h).data, w = b.w, h = b.h;
      const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] >= 128;
      const p = new Path2D();
      for (let y = 0; y <= h; y += step) {
        let run = -1;
        for (let x = 0; x <= w; x += step) {
          const edge = x < w && inside(x, y) !== inside(x, y - step);
          if (edge && run < 0) run = x;
          if (!edge && run >= 0) { p.moveTo(b.x + run, b.y + y); p.lineTo(b.x + x, b.y + y); run = -1; }
        }
      }
      for (let x = 0; x <= w; x += step) {
        let run = -1;
        for (let y = 0; y <= h; y += step) {
          const edge = y < h && inside(x, y) !== inside(x - step, y);
          if (edge && run < 0) run = y;
          if (!edge && run >= 0) { p.moveTo(b.x + x, b.y + run); p.lineTo(b.x + x, b.y + y); run = -1; }
        }
      }
      sel.path = p; return p;
    },
    // Clip a doc-space canvas to the selection (in place)
    clip(doc, c, ox = 0, oy = 0) {
      if (!doc.sel) return c;
      const x = U.ctx(c); x.save(); x.globalCompositeOperation = 'destination-in'; x.drawImage(doc.sel.canvas, -ox, -oy); x.restore(); return c;
    },
    featherCanvas, threshold, grow, make, combine,
  };

  // ---------- Smart region: flood fill with true edge coverage ----------
  // Pixels within Tolerance (largest per-channel difference, premultiplied, so transparent areas
  // behave) are fully included. With anti-alias on, the soft edge pixels around the region are
  // un-mixed: each is treated as a blend of the clicked colour and the neighbouring edge colour,
  // giving partial coverage plus the pure edge colour. Fills then run cleanly into anti-aliased
  // lines and erasing leaves no fringe or halo.
  S.smartRegion = (doc, src, px, py, o = {}) => {
    const w = doc.w, h = doc.h, N = w * h;
    px = Math.floor(px); py = Math.floor(py);
    if (px < 0 || py < 0 || px >= w || py >= h) return null;
    const d = o.cache && o.cache.src === src ? null : U.getData(src).data;
    const tol = Math.max(0, +o.tol || 0), contiguous = o.contiguous !== false, aa = o.antialias !== false, expand = Math.round(+o.expand || 0);
    // premultiplied copy (cached per source canvas by the caller)
    let P = o.cache && o.cache.src === src ? o.cache.P : null;
    if (!P) {
      P = new Uint8ClampedArray(N * 4);
      for (let i = 0; i < N * 4; i += 4) { const a = d[i + 3] / 255; P[i] = d[i] * a; P[i + 1] = d[i + 1] * a; P[i + 2] = d[i + 2] * a; P[i + 3] = d[i + 3]; }
      if (o.cache) { o.cache.src = src; o.cache.P = P; }
    }
    const si = (py * w + px) * 4, S0 = P[si], S1 = P[si + 1], S2 = P[si + 2], S3 = P[si + 3];
    const dist = (i) => Math.max(Math.abs(P[i] - S0), Math.abs(P[i + 1] - S1), Math.abs(P[i + 2] - S2), Math.abs(P[i + 3] - S3));
    const ok = (j) => dist(j * 4) <= tol + 0.5;
    const core = new Uint8Array(N);
    if (contiguous) {
      const stack = [px, py]; core[py * w + px] = 1;
      while (stack.length) {
        const y = stack.pop(), x = stack.pop();
        let xl = x; while (xl > 0 && !core[y * w + xl - 1] && ok(y * w + xl - 1)) { xl--; core[y * w + xl] = 1; }
        let xr = x; while (xr < w - 1 && !core[y * w + xr + 1] && ok(y * w + xr + 1)) { xr++; core[y * w + xr] = 1; }
        for (const ny of [y - 1, y + 1]) {
          if (ny < 0 || ny >= h) continue; let run = false;
          for (let xx = xl; xx <= xr; xx++) {
            const j = ny * w + xx;
            if (!core[j] && ok(j)) { core[j] = 1; if (!run) { stack.push(xx, ny); run = true; } } else run = false;
          }
        }
      }
    } else for (let j = 0; j < N; j++) if (ok(j)) core[j] = 1;
    // bounding box of the region, padded, so the edge passes only visit nearby pixels
    let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
    for (let y = 0; y < h; y++) { const row = y * w; let any = false; for (let x = 0; x < w; x++) if (core[row + x]) { any = true; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; } if (any) { if (y < by0) by0 = y; by1 = y; } }
    if (bx1 < 0) return { w, h, cov: new Uint8Array(N), core, edges: new Map(), count: 0 };
    const pad = Math.abs(expand) + 4;
    bx0 = Math.max(0, bx0 - pad); by0 = Math.max(0, by0 - pad); bx1 = Math.min(w - 1, bx1 + pad); by1 = Math.min(h - 1, by1 + pad);
    // Expand / contract the region by whole pixels
    for (let k = 0; k < Math.abs(expand); k++) {
      const grow1 = expand > 0, src1 = core.slice();
      for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
        const j = y * w + x; if (src1[j] === (grow1 ? 1 : 0)) continue;
        let hit = false;
        for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; if (src1[yy * w + xx] === (grow1 ? 1 : 0)) { hit = true; break; } }
        if (hit) core[j] = grow1 ? 1 : 0;
      }
    }
    const cov = new Uint8Array(N); let count = 0;
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) { const j = y * w + x; if (core[j]) { cov[j] = 255; count++; } }
    const edges = new Map();
    if (aa && expand <= 0) {
      const ring = (seedTest) => {
        const list = [];
        for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
          const j = y * w + x; if (cov[j]) continue; let near = false;
          for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if ((dx || dy) && xx >= 0 && yy >= 0 && xx < w && yy < h && seedTest(yy * w + xx)) { near = true; break; } }
          if (near) list.push(j);
        }
        return list;
      };
      const unmix = (list) => {
        const done = [];
        for (const j of list) {
          const x = j % w, y = (j - x) / w, i = j * 4;
          // edge colour = the most different nearby pixel outside the region
          let best = -1, bi = -1;
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const k = yy * w + xx; if (cov[k] || edges.has(k)) continue; const q = k * 4;
            const dd = (P[q] - S0) ** 2 + (P[q + 1] - S1) ** 2 + (P[q + 2] - S2) ** 2 + (P[q + 3] - S3) ** 2;
            if (dd > best) { best = dd; bi = q; }
          }
          if (bi < 0 || best < 1) continue;
          const E0 = P[bi], E1 = P[bi + 1], E2 = P[bi + 2], E3 = P[bi + 3];
          const v0 = S0 - E0, v1 = S1 - E1, v2 = S2 - E2, v3 = S3 - E3, vv = v0 * v0 + v1 * v1 + v2 * v2 + v3 * v3;
          const q0 = P[i] - E0, q1 = P[i + 1] - E1, q2 = P[i + 2] - E2, q3 = P[i + 3] - E3;
          let a = (q0 * v0 + q1 * v1 + q2 * v2 + q3 * v3) / vv; a = Math.min(0.995, Math.max(0, a));
          // how well "blend of clicked colour and edge colour" explains this pixel
          const r0 = q0 - a * v0, r1 = q1 - a * v1, r2 = q2 - a * v2, r3 = q3 - a * v3;
          const resid = Math.sqrt((r0 * r0 + r1 * r1 + r2 * r2 + r3 * r3) / vv);
          a *= Math.max(0, 1 - resid * 2);
          if (a < 0.03) continue;
          cov[j] = Math.round(a * 255); edges.set(j, [E0, E1, E2, E3]); done.push(j);
        }
        return done;
      };
      const r1 = unmix(ring((k) => core[k] === 1));
      const strong = new Set(r1.filter((j) => cov[j] > 76));
      if (strong.size) unmix(ring((k) => strong.has(k)));
    }
    // Clip to the active selection
    if (doc.sel) {
      const sd = U.getData(doc.sel.canvas).data;
      for (let j = 0; j < N; j++) if (cov[j]) { const m = sd[j * 4 + 3]; if (m < 255) cov[j] = Math.round(cov[j] * m / 255); }
    }
    return { w, h, cov, core, edges, count, seed: [S0, S1, S2, S3] };
  };
  // Coverage as an alpha mask canvas (doc size)
  S.regionMask = (R, rgb = [255, 255, 255]) => {
    const img = new ImageData(R.w, R.h), o = img.data;
    for (let j = 0; j < R.w * R.h; j++) { const a = R.cov[j]; if (!a) continue; const i = j * 4; o[i] = rgb[0]; o[i + 1] = rgb[1]; o[i + 2] = rgb[2]; o[i + 3] = a; }
    return U.fromData(img);
  };
  // Apply to a pixel layer in place. target(premultiplied) gets the new colour for a region pixel.
  // fill = [r,g,b] (straight) to fill, or null to erase. opacity 0..1.
  S.applyRegion = (doc, L, R, fill, opacity = 1) => {
    const lw = L.canvas.width, lh = L.canvas.height, x = U.ctx(L.canvas);
    const ox = Math.max(0, L.x), oy = Math.max(0, L.y), ex = Math.min(R.w, L.x + lw), ey = Math.min(R.h, L.y + lh);
    if (ex <= ox || ey <= oy) return;
    const img = x.getImageData(ox - L.x, oy - L.y, ex - ox, ey - oy), D = img.data, iw = ex - ox;
    const F = fill ? [fill[0], fill[1], fill[2], 255] : [0, 0, 0, 0];
    for (let y = oy; y < ey; y++) for (let xx = ox; xx < ex; xx++) {
      const j = y * R.w + xx, c = R.cov[j]; if (!c) continue;
      const i = ((y - oy) * iw + (xx - ox)) * 4, a0 = D[i + 3] / 255;
      const p = [D[i] * a0, D[i + 1] * a0, D[i + 2] * a0, D[i + 3]];
      const E = R.edges.get(j); let t, m = 1;
      if (E) { const a = c / 255; t = [0, 1, 2, 3].map((k) => a * F[k] + (1 - a) * E[k]); }
      else { t = F; m = c / 255; } // c < 255 here only from a soft selection edge
      const op = opacity * m;
      const q = [0, 1, 2, 3].map((k) => p[k] + op * (t[k] - p[k]));
      const na = q[3];
      if (na <= 0.5) { D[i] = D[i + 1] = D[i + 2] = D[i + 3] = 0; continue; }
      D[i] = Math.round(q[0] * 255 / na); D[i + 1] = Math.round(q[1] * 255 / na); D[i + 2] = Math.round(q[2] * 255 / na); D[i + 3] = Math.round(na);
    }
    x.putImageData(img, ox - L.x, oy - L.y);
  };
  K.Sel = S;
})(window.K);
