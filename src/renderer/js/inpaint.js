// Forged — patch-based inpainting used by Spot Healing and Content-Aware Fill
(function (K) {
  'use strict';
  const U = K.U;

  /**
   * Fill masked pixels of `data` (ImageData) using texture synthesis from surrounding pixels.
   * mask: Uint8Array (w*h), 1 = fill. Operates on a cropped working region for speed.
   */
  function inpaint(data, mask, opts = {}) {
    const W = data.width, H = data.height;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return data;
    const holeSize = Math.max(x1 - x0, y1 - y0) + 1;
    const search = opts.search || Math.max(24, Math.min(400, holeSize * 2));
    const rx0 = Math.max(0, x0 - search), ry0 = Math.max(0, y0 - search), rx1 = Math.min(W - 1, x1 + search), ry1 = Math.min(H - 1, y1 + search);
    const w = rx1 - rx0 + 1, h = ry1 - ry0 + 1, n = w * h;
    const px = new Uint8ClampedArray(n * 4), known = new Uint8Array(n), orig = new Uint8Array(n), src = new Int32Array(n).fill(-1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gi = ((y + ry0) * W + (x + rx0)), li = y * w + x;
      for (let c = 0; c < 4; c++) px[li * 4 + c] = data.data[gi * 4 + c];
      const k = mask[gi] ? 0 : 1; known[li] = k; orig[li] = k; if (k) src[li] = li;
    }
    const R = opts.patch || (holeSize < 24 ? 2 : 3);
    const rnd = K.Filters.seeded(1234);
    const cost = (p, q, best) => {
      const pxp = p % w, pyp = (p / w) | 0, pxq = q % w, pyq = (q / w) | 0; let s = 0, cnt = 0;
      for (let dy = -R; dy <= R; dy++) {
        const yp = pyp + dy, yq = pyq + dy; if (yp < 0 || yq < 0 || yp >= h || yq >= h) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xp = pxp + dx, xq = pxq + dx; if (xp < 0 || xq < 0 || xp >= w || xq >= w) continue;
          const ip = yp * w + xp; if (!known[ip]) continue; const iq = yq * w + xq; if (!orig[iq]) { s += 3000; cnt++; continue; }
          const a = ip * 4, b = iq * 4;
          const dr = px[a] - px[b], dg = px[a + 1] - px[b + 1], db = px[a + 2] - px[b + 2];
          s += dr * dr + dg * dg + db * db; cnt++;
          if (s > best * (cnt + 4)) return Infinity;
        }
      }
      return cnt ? s / cnt : Infinity;
    };
    const nb = [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1];
    const hx0 = x0 - rx0, hy0 = y0 - ry0, hx1 = x1 - rx0, hy1 = y1 - ry0;
    const K_RANDOM = opts.samples || 14;
    let remaining = 0; for (let i = 0; i < n; i++) if (!known[i]) remaining++;
    while (remaining > 0) {
      // onion peel: unknown pixels with at least one known neighbour
      const queue = [];
      for (let y = hy0; y <= hy1; y++) for (let x = hx0; x <= hx1; x++) {
        const i = y * w + x; if (known[i]) continue;
        for (const o of nb) { const j = i + o; if (j < 0 || j >= n || Math.abs((j % w) - x) > 1) continue; if (known[j]) { queue.push(i); break; } }
      }
      if (!queue.length) { for (let i = 0; i < n; i++) if (!known[i]) { queue.push(i); break; } }
      for (let i = queue.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = queue[i]; queue[i] = queue[j]; queue[j] = t; }
      for (const p of queue) {
        const x = p % w, y = (p / w) | 0; let best = Infinity, bestQ = -1;
        const tryQ = (q) => { if (q < 0 || q >= n || !orig[q]) return; const c = cost(p, q, best); if (c < best) { best = c; bestQ = q; } };
        for (const o of nb) {
          const j = p + o; if (j < 0 || j >= n || Math.abs((j % w) - x) > 1) continue;
          if (known[j] && src[j] >= 0) { const sq = src[j] - o; if (Math.abs((sq % w) - (src[j] % w)) <= 1) tryQ(sq); }
        }
        for (let k = 0, tries = 0; k < K_RANDOM && tries < K_RANDOM * 4; tries++) {
          const sx = x + Math.round((rnd() * 2 - 1) * search), sy = y + Math.round((rnd() * 2 - 1) * search);
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue; const q = sy * w + sx; if (!orig[q]) continue; tryQ(q); k++;
        }
        if (bestQ < 0) {
          let r = 0, g = 0, b = 0, a = 0, c = 0;
          for (const o of nb) { const j = p + o; if (j >= 0 && j < n && known[j]) { r += px[j * 4]; g += px[j * 4 + 1]; b += px[j * 4 + 2]; a += px[j * 4 + 3]; c++; } }
          if (c) { px[p * 4] = r / c; px[p * 4 + 1] = g / c; px[p * 4 + 2] = b / c; px[p * 4 + 3] = a / c; }
        } else {
          for (let c = 0; c < 4; c++) px[p * 4 + c] = px[bestQ * 4 + c];
          src[p] = bestQ;
        }
        known[p] = 1; remaining--;
      }
    }
    // light smoothing pass over the filled area to soften seams
    const out = new Uint8ClampedArray(px);
    for (let i = 0; i < n; i++) if (!orig[i]) {
      const x = i % w; let r = 0, g = 0, b = 0, c = 0;
      for (const o of [0, -1, 1, -w, w]) { const j = i + o; if (j < 0 || j >= n || Math.abs((j % w) - x) > 1) continue; r += px[j * 4]; g += px[j * 4 + 1]; b += px[j * 4 + 2]; c++; }
      const k = opts.smooth === undefined ? 0.35 : opts.smooth;
      out[i * 4] = px[i * 4] * (1 - k) + (r / c) * k; out[i * 4 + 1] = px[i * 4 + 1] * (1 - k) + (g / c) * k; out[i * 4 + 2] = px[i * 4 + 2] * (1 - k) + (b / c) * k;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const li = y * w + x; if (orig[li]) continue; const gi = (y + ry0) * W + (x + rx0);
      for (let c = 0; c < 4; c++) data.data[gi * 4 + c] = out[li * 4 + c];
    }
    return data;
  }

  // Fill masked area of a canvas (mask canvas alpha > 0.5 = fill). Large areas are synthesised at reduced scale then refined.
  function fillCanvas(c, maskCanvas, ox = 0, oy = 0) {
    const d = U.getData(c), w = c.width, h = c.height;
    const md = U.ctx(maskCanvas).getImageData(ox, oy, w, h).data, mask = new Uint8Array(w * h);
    let count = 0; for (let i = 0; i < w * h; i++) if (md[i * 4 + 3] > 100) { mask[i] = 1; count++; }
    if (!count) return c;
    // dilate mask by 1px to cover soft edges
    const m2 = new Uint8Array(mask);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (mask[i - 1] || mask[i + 1] || mask[i - w] || mask[i + w]) m2[i] = 1; }
    if (count > 60000) {
      // coarse-to-fine: synthesise at lower res, upscale as an initial guess, then refine at full res using only the coarse guess near edges
      const s = Math.sqrt(60000 / count), sw = Math.max(8, Math.round(w * s)), sh = Math.max(8, Math.round(h * s));
      const small = U.resample(c, sw, sh), sd = U.getData(small), sm = new Uint8Array(sw * sh);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (m2[Math.min(h - 1, Math.floor(y / s)) * w + Math.min(w - 1, Math.floor(x / s))]) sm[y * sw + x] = 1;
      inpaint(sd, sm, { patch: 3 });
      const up = U.resample(U.fromData(sd), w, h), ud = U.getData(up).data;
      for (let i = 0; i < w * h; i++) if (m2[i]) for (let k = 0; k < 4; k++) d.data[i * 4 + k] = ud[i * 4 + k];
      // add back fine texture by synthesising a high-pass detail layer
      const detail = K.Filters.run('highPass', U.copyData(d), { radius: 2 });
      const dm = new Uint8Array(m2); inpaint(detail, dm, { patch: 2, samples: 8, search: 60, smooth: 0 });
      for (let i = 0; i < w * h; i++) if (m2[i]) for (let k = 0; k < 3; k++) d.data[i * 4 + k] += (detail.data[i * 4 + k] - 128) * 0.9;
    } else inpaint(d, m2);
    U.ctx(c).putImageData(d, 0, 0);
    return c;
  }

  // ---------- source-based healing ----------
  // Box blur (running sum) of a Float32 plane, zero outside the edges.
  function boxBlur(a, w, h, r) {
    if (r < 1) return a;
    const t = new Float32Array(w * h), o = new Float32Array(w * h);
    for (let y = 0; y < h; y++) { let s = 0; const row = y * w; for (let x = -r; x <= r; x++) if (x >= 0 && x < w) s += a[row + x]; for (let x = 0; x < w; x++) { t[row + x] = s; const xo = x - r, xi = x + r + 1; if (xo >= 0) s -= a[row + xo]; if (xi < w) s += a[row + xi]; } }
    for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) if (y >= 0 && y < h) s += t[y * w + x]; for (let y = 0; y < h; y++) { o[y * w + x] = s; const yo = y - r, yi = y + r + 1; if (yo >= 0) s -= t[yo * w + x]; if (yi < h) s += t[yi * w + x]; } }
    return o;
  }
  const blur3 = (a, w, h, r) => { const q = Math.max(1, Math.round(r / 1.7)); return boxBlur(boxBlur(boxBlur(a, w, h, q), w, h, q), w, h, q); };

  // Heals the masked area of layer L using pixels from `src` (document-space canvas) shifted by `off`.
  // Texture comes from the source; colour and brightness are matched to the pixels around the area.
  function healFrom(doc, L, mask, src, off, opts = {}) {
    const b = K.Layers.alphaBounds(mask); if (!b) return false;
    const big = Math.max(b.w, b.h), rLarge = Math.ceil(big / 2) + 3, rSmall = Math.max(3, Math.min(12, Math.round(big / 6)));
    const pad = rLarge + 4;
    const Rx = Math.max(0, Math.floor(b.x - pad)), Ry = Math.max(0, Math.floor(b.y - pad));
    const Rw = Math.min(doc.w, Math.ceil(b.x + b.w + pad)) - Rx, Rh = Math.min(doc.h, Math.ceil(b.y + b.h + pad)) - Ry;
    if (Rw <= 0 || Rh <= 0) return false;
    const lx = Rx - L.x, ly = Ry - L.y;
    const dstD = U.ctx(L.canvas).getImageData(lx, ly, Rw, Rh), dd = dstD.data;
    const sc = U.canvas(Rw, Rh); U.ctx(sc).drawImage(src, -(Rx + off[0]), -(Ry + off[1])); const sd = U.getData(sc).data;
    const mc = U.canvas(Rw, Rh); U.ctx(mc).drawImage(mask, -Rx, -Ry); const md = U.getData(mc).data;
    const soft = K.Sel.featherCanvas(mask, opts.feather === undefined ? 1.5 : opts.feather), fc = U.canvas(Rw, Rh); U.ctx(fc).drawImage(soft, -Rx, -Ry); const fd = U.getData(fc).data;
    const n = Rw * Rh, W = new Float32Array(n), D = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let k = 0, i = 0; k < n; k++, i += 4) {
      if (md[i + 3] < 128 && sd[i + 3] > 200 && dd[i + 3] > 200) { W[k] = 1; for (let c = 0; c < 3; c++) D[c][k] = dd[i + c] - sd[i + c]; }
    }
    const k1 = 6, Ws = blur3(W, Rw, Rh, rSmall), Wl = blur3(W, Rw, Rh, rLarge);
    const Ds = D.map((a) => blur3(a, Rw, Rh, rSmall)), Dl = D.map((a) => blur3(a, Rw, Rh, rLarge));
    const match = opts.match === undefined ? 1 : opts.match; // 1 = full colour matching (healing), 0 = straight copy (clone)
    for (let k = 0, i = 0; k < n; k++, i += 4) {
      const a = fd[i + 3] / 255 * (opts.opacity === undefined ? 1 : opts.opacity); if (a <= 0 || sd[i + 3] === 0) continue;
      const den = Ws[k] * k1 + Wl[k];
      for (let c = 0; c < 3; c++) {
        const diff = den > 1e-6 ? (Ds[c][k] * k1 + Dl[c][k]) / den : 0;
        const v = sd[i + c] + diff * match;
        dd[i + c] = dd[i + c] * (1 - a) + U.clamp(v, 0, 255) * a;
      }
      dd[i + 3] = dd[i + 3] * (1 - a) + sd[i + 3] * a;
    }
    U.ctx(L.canvas).putImageData(dstD, lx, ly);
    return true;
  }

  K.Inpaint = { inpaint, fillCanvas, healFrom };
})(window.K);
