// Forged — pixel filters. Each fn(imageData, params) returns an ImageData (may be same object).
(function (K) {
  'use strict';
  const U = K.U, clamp = U.clamp;

  // Separable box blur on RGBA, premultiplied, 3 passes ≈ gaussian
  function blurRGBA(src, radius, passes = 3) {
    const w = src.width, h = src.height, n = w * h;
    if (radius < 0.5) return U.copyData(src);
    const r = Math.max(1, Math.round(radius / Math.sqrt(passes) * 1.2));
    const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    const s = src.data;
    for (let i = 0, j = 0; j < n; i += 4, j++) { const a = s[i + 3] / 255; ch[0][j] = s[i] * a; ch[1][j] = s[i + 1] * a; ch[2][j] = s[i + 2] * a; ch[3][j] = s[i + 3]; }
    const tmp = new Float32Array(n);
    const line = (a, b, len, lines, stride, lstride) => {
      const inv = 1 / (2 * r + 1);
      for (let l = 0; l < lines; l++) {
        const base = l * lstride; let acc = 0;
        for (let k = -r; k <= r; k++) acc += a[base + clamp(k, 0, len - 1) * stride];
        for (let k = 0; k < len; k++) {
          b[base + k * stride] = acc * inv;
          acc += a[base + Math.min(len - 1, k + r + 1) * stride] - a[base + Math.max(0, k - r) * stride];
        }
      }
    };
    for (const c of ch) for (let p = 0; p < passes; p++) { line(c, tmp, w, h, 1, w); line(tmp, c, h, w, w, 1); }
    const out = new ImageData(w, h), o = out.data;
    for (let i = 0, j = 0; j < n; i += 4, j++) { const a = ch[3][j]; const ia = a > 0 ? 255 / a : 0; o[i] = ch[0][j] * ia; o[i + 1] = ch[1][j] * ia; o[i + 2] = ch[2][j] * ia; o[i + 3] = a; }
    return out;
  }

  // Convolution 3x3
  function convolve(src, k, divisor = 1, bias = 0, keepAlpha = true) {
    const w = src.width, h = src.height, s = src.data, out = new ImageData(w, h), o = out.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, idx = 0;
      for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
        const sx = clamp(x + kx, 0, w - 1), sy = clamp(y + ky, 0, h - 1), i = (sy * w + sx) * 4, kv = k[idx++];
        r += s[i] * kv; g += s[i + 1] * kv; b += s[i + 2] * kv;
      }
      const i = (y * w + x) * 4;
      o[i] = r / divisor + bias; o[i + 1] = g / divisor + bias; o[i + 2] = b / divisor + bias; o[i + 3] = keepAlpha ? s[i + 3] : 255;
    }
    return out;
  }

  // Sample with bilinear interpolation
  function sampler(src) {
    const w = src.width, h = src.height, s = src.data;
    return (x, y, out) => {
      x = clamp(x, 0, w - 1.001); y = clamp(y, 0, h - 1.001);
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
      const i00 = (y0 * w + x0) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
      for (let c = 0; c < 4; c++) out[c] = (s[i00 + c] * (1 - fx) + s[i10 + c] * fx) * (1 - fy) + (s[i01 + c] * (1 - fx) + s[i11 + c] * fx) * fy;
      return out;
    };
  }
  function warp(src, fn) {
    const w = src.width, h = src.height, out = new ImageData(w, h), o = out.data, samp = sampler(src), px = [0, 0, 0, 0];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [sx, sy] = fn(x, y); samp(sx, sy, px); const i = (y * w + x) * 4;
      o[i] = px[0]; o[i + 1] = px[1]; o[i + 2] = px[2]; o[i + 3] = px[3];
    }
    return out;
  }

  function median(src, radius) {
    const w = src.width, h = src.height, s = src.data, out = new ImageData(w, h), o = out.data, r = Math.max(1, radius | 0);
    const hist = [new Uint16Array(256), new Uint16Array(256), new Uint16Array(256)];
    const size = (2 * r + 1) * (2 * r + 1), half = size >> 1;
    for (let y = 0; y < h; y++) {
      for (const hh of hist) hh.fill(0);
      for (let ky = -r; ky <= r; ky++) for (let kx = -r; kx <= r; kx++) {
        const i = (clamp(y + ky, 0, h - 1) * w + clamp(kx, 0, w - 1)) * 4; hist[0][s[i]]++; hist[1][s[i + 1]]++; hist[2][s[i + 2]]++;
      }
      for (let x = 0; x < w; x++) {
        const oi = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) { let acc = 0, v = 0; const hh = hist[c]; while (v < 255 && (acc += hh[v]) <= half) v++; o[oi + c] = v; }
        o[oi + 3] = s[oi + 3];
        if (x + 1 < w) for (let ky = -r; ky <= r; ky++) {
          const row = clamp(y + ky, 0, h - 1) * w;
          const iOut = (row + clamp(x - r, 0, w - 1)) * 4, iIn = (row + clamp(x + r + 1, 0, w - 1)) * 4;
          for (let c = 0; c < 3; c++) { hist[c][s[iOut + c]]--; hist[c][s[iIn + c]]++; }
        }
      }
    }
    return out;
  }

  function gray(src) { const n = src.width * src.height, g = new Float32Array(n), s = src.data; for (let i = 0, j = 0; j < n; i += 4, j++) g[j] = U.lum(s[i], s[i + 1], s[i + 2]); return g; }
  function sobel(src) {
    const w = src.width, h = src.height, g = gray(src), m = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      m[i] = Math.hypot(gx, gy);
    }
    return m;
  }
  function seeded(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  const S = (key, label, min, max, def, step = 1) => ({ key, label, min, max, def, step, type: 'range' });
  const B = (key, label, def) => ({ key, label, def, type: 'check' });
  const C = (key, label, def) => ({ key, label, def, type: 'color' });

  const F = {
    gaussian: { title: 'Gaussian Blur', controls: [S('radius', 'Radius (px)', 0.5, 150, 6, 0.5)], fn: (d, p) => blurRGBA(d, p.radius) },
    motion: { title: 'Motion Blur', controls: [S('angle', 'Angle', -180, 180, 0), S('distance', 'Distance (px)', 1, 300, 30)], fn: (d, p) => {
      const w = d.width, h = d.height, out = new ImageData(w, h), o = out.data, samp = sampler(d), px = [0, 0, 0, 0];
      const a = p.angle * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), steps = Math.max(2, Math.min(64, Math.round(p.distance)));
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, al = 0;
        for (let k = 0; k < steps; k++) { const t = (k / (steps - 1) - 0.5) * p.distance; samp(x + dx * t, y + dy * t, px); r += px[0]; g += px[1]; b += px[2]; al += px[3]; }
        const i = (y * w + x) * 4; o[i] = r / steps; o[i + 1] = g / steps; o[i + 2] = b / steps; o[i + 3] = al / steps;
      }
      return out;
    } },
    zoomBlur: { title: 'Radial (Zoom) Blur', controls: [S('amount', 'Amount', 1, 100, 25), S('cx', 'Centre X (%)', 0, 100, 50), S('cy', 'Centre Y (%)', 0, 100, 50)], fn: (d, p) => {
      const w = d.width, h = d.height, out = new ImageData(w, h), o = out.data, samp = sampler(d), px = [0, 0, 0, 0];
      const cx = w * p.cx / 100, cy = h * p.cy / 100, steps = 24, amt = p.amount / 300;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, al = 0;
        for (let k = 0; k < steps; k++) { const s = 1 - amt * k / steps; samp(cx + (x - cx) * s, cy + (y - cy) * s, px); r += px[0]; g += px[1]; b += px[2]; al += px[3]; }
        const i = (y * w + x) * 4; o[i] = r / steps; o[i + 1] = g / steps; o[i + 2] = b / steps; o[i + 3] = al / steps;
      }
      return out;
    } },
    surface: { title: 'Surface Blur', controls: [S('radius', 'Radius', 1, 30, 5), S('threshold', 'Threshold', 1, 100, 20)], fn: (d, p) => {
      const b = blurRGBA(d, p.radius), s = d.data, o = b.data, t = p.threshold * 2.2;
      for (let i = 0; i < s.length; i += 4) {
        const diff = Math.abs(s[i] - o[i]) + Math.abs(s[i + 1] - o[i + 1]) + Math.abs(s[i + 2] - o[i + 2]);
        const k = clamp(1 - diff / t, 0, 1); for (let c = 0; c < 3; c++) o[i + c] = s[i + c] + (o[i + c] - s[i + c]) * k; o[i + 3] = s[i + 3];
      }
      return b;
    } },
    tiltShift: { title: 'Tilt-Shift', controls: [S('focus', 'Focus position (%)', 0, 100, 55), S('band', 'Focus band (%)', 2, 80, 18), S('blur', 'Blur amount', 1, 60, 14), S('sat', 'Saturation boost', 0, 60, 20)], fn: (d, p) => {
      const b = blurRGBA(d, p.blur), w = d.width, h = d.height, s = d.data, o = b.data, fy = h * p.focus / 100, band = h * p.band / 200;
      for (let y = 0; y < h; y++) {
        const t = clamp((Math.abs(y - fy) - band) / (h * 0.15), 0, 1);
        for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; for (let c = 0; c < 4; c++) o[i + c] = s[i + c] + (o[i + c] - s[i + c]) * t; }
      }
      K.Adjust.apply('quick', { saturation: p.sat, contrast: p.sat / 3 }, b);
      return b;
    } },
    unsharp: { title: 'Unsharp Mask', controls: [S('amount', 'Amount (%)', 1, 500, 80), S('radius', 'Radius (px)', 0.5, 50, 1.5, 0.1), S('threshold', 'Threshold', 0, 255, 2)], fn: (d, p) => {
      const b = blurRGBA(d, p.radius), s = d.data, o = b.data, a = p.amount / 100;
      for (let i = 0; i < s.length; i += 4) for (let c = 0; c < 3; c++) {
        const diff = s[i + c] - o[i + c];
        o[i + c] = Math.abs(diff) >= p.threshold ? s[i + c] + diff * a : s[i + c];
      }
      for (let i = 3; i < s.length; i += 4) o[i] = s[i];
      return b;
    } },
    highPass: { title: 'High Pass', controls: [S('radius', 'Radius', 0.5, 100, 8, 0.5)], fn: (d, p) => {
      const b = blurRGBA(d, p.radius), s = d.data, o = b.data;
      for (let i = 0; i < s.length; i += 4) { for (let c = 0; c < 3; c++) o[i + c] = s[i + c] - o[i + c] + 128; o[i + 3] = s[i + 3]; }
      return b;
    } },
    reduceNoise: { title: 'Reduce Noise', controls: [S('strength', 'Strength', 1, 10, 5), S('detail', 'Preserve details (%)', 0, 100, 50), S('color', 'Reduce colour noise (%)', 0, 100, 60)], fn: (d, p) => {
      const out = F.surface.fn(d, { radius: 1 + p.strength * 0.6, threshold: 8 + p.strength * 6 * (1 - p.detail / 150) });
      if (p.color > 0) {
        const cb = blurRGBA(d, 2 + p.strength), o = out.data, c = cb.data, k = p.color / 100;
        for (let i = 0; i < o.length; i += 4) {
          const l = U.lum(o[i], o[i + 1], o[i + 2]), lc = U.lum(c[i], c[i + 1], c[i + 2]);
          for (let j = 0; j < 3; j++) o[i + j] = o[i + j] + ((c[i + j] - lc + l) - o[i + j]) * k;
        }
      }
      return out;
    } },
    median: { title: 'Median', controls: [S('radius', 'Radius', 1, 10, 2)], fn: (d, p) => median(d, p.radius) },
    addNoise: { title: 'Add Noise', controls: [S('amount', 'Amount (%)', 1, 100, 12), B('mono', 'Monochromatic', true), B('gaussian', 'Gaussian distribution', true)], fn: (d, p) => {
      const s = d.data, rnd = seeded(7), a = p.amount * 2.2;
      const nz = () => p.gaussian ? (rnd() + rnd() + rnd() - 1.5) * 1.15 : rnd() * 2 - 1;
      for (let i = 0; i < s.length; i += 4) {
        if (p.mono) { const n = nz() * a; s[i] += n; s[i + 1] += n; s[i + 2] += n; }
        else { s[i] += nz() * a; s[i + 1] += nz() * a; s[i + 2] += nz() * a; }
      }
      return d;
    } },
    dust: { title: 'Dust & Scratches', controls: [S('radius', 'Radius', 1, 8, 2), S('threshold', 'Threshold', 0, 128, 20)], fn: (d, p) => {
      const m = median(d, p.radius), s = d.data, o = m.data;
      for (let i = 0; i < s.length; i += 4) {
        const diff = Math.abs(s[i] - o[i]) + Math.abs(s[i + 1] - o[i + 1]) + Math.abs(s[i + 2] - o[i + 2]);
        if (diff / 3 < p.threshold) { o[i] = s[i]; o[i + 1] = s[i + 1]; o[i + 2] = s[i + 2]; }
      }
      return m;
    } },
    emboss: { title: 'Emboss', controls: [S('angle', 'Angle', -180, 180, 135), S('height', 'Height', 1, 10, 3), S('amount', 'Amount (%)', 1, 500, 100)], fn: (d, p) => {
      const a = p.angle * Math.PI / 180, dx = Math.round(Math.cos(a) * p.height), dy = Math.round(-Math.sin(a) * p.height);
      const w = d.width, h = d.height, g = gray(d), out = new ImageData(w, h), o = out.data, s = d.data, k = p.amount / 100;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, j = clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1), l = clamp(y - dy, 0, h - 1) * w + clamp(x - dx, 0, w - 1);
        const v = 128 + (g[j] - g[l]) * k; o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = v; o[i * 4 + 3] = s[i * 4 + 3];
      }
      return out;
    } },
    edges: { title: 'Find Edges', controls: [], fn: (d) => {
      const m = sobel(d), out = new ImageData(d.width, d.height), o = out.data, s = d.data;
      for (let j = 0; j < m.length; j++) { const v = 255 - clamp(m[j] / 3, 0, 255); o[j * 4] = o[j * 4 + 1] = o[j * 4 + 2] = v; o[j * 4 + 3] = s[j * 4 + 3]; }
      return out;
    } },
    glowEdges: { title: 'Glowing Edges', controls: [S('width', 'Edge width', 1, 10, 2), S('brightness', 'Brightness', 1, 20, 8)], fn: (d, p) => {
      const b = p.width > 1 ? blurRGBA(d, p.width - 1) : d;
      const m = sobel(b), out = new ImageData(d.width, d.height), o = out.data, s = b.data;
      for (let j = 0; j < m.length; j++) { const k = clamp(m[j] / 255 * p.brightness / 4, 0, 1); for (let c = 0; c < 3; c++) o[j * 4 + c] = s[j * 4 + c] * k * 1.4; o[j * 4 + 3] = d.data[j * 4 + 3]; }
      return out;
    } },
    oilPaint: { title: 'Oil Paint', controls: [S('radius', 'Brush radius', 1, 8, 3), S('levels', 'Detail levels', 4, 40, 20)], fn: (d, p) => {
      const w = d.width, h = d.height, s = d.data, out = new ImageData(w, h), o = out.data, r = p.radius, L = p.levels;
      const cnt = new Int32Array(L), sr = new Int32Array(L), sg = new Int32Array(L), sb = new Int32Array(L);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        cnt.fill(0); sr.fill(0); sg.fill(0); sb.fill(0);
        for (let ky = -r; ky <= r; ky += 1) for (let kx = -r; kx <= r; kx += 1) {
          const i = (clamp(y + ky, 0, h - 1) * w + clamp(x + kx, 0, w - 1)) * 4;
          const l = Math.min(L - 1, (U.lum(s[i], s[i + 1], s[i + 2]) * L / 256) | 0);
          cnt[l]++; sr[l] += s[i]; sg[l] += s[i + 1]; sb[l] += s[i + 2];
        }
        let best = 0; for (let k = 1; k < L; k++) if (cnt[k] > cnt[best]) best = k;
        const i = (y * w + x) * 4; o[i] = sr[best] / cnt[best]; o[i + 1] = sg[best] / cnt[best]; o[i + 2] = sb[best] / cnt[best]; o[i + 3] = s[i + 3];
      }
      return out;
    } },
    pinch: { title: 'Pinch / Bulge', controls: [S('amount', 'Amount (−pinch / +bulge)', -100, 100, 50)], fn: (d, p) => {
      const w = d.width, h = d.height, cx = w / 2, cy = h / 2, R = Math.min(cx, cy), a = p.amount / 100;
      return warp(d, (x, y) => {
        const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) / R;
        if (r >= 1 || r === 0) return [x, y];
        const s = Math.pow(r, a > 0 ? 1 + a : 1 / (1 - a)) / r;
        return [cx + dx * s, cy + dy * s];
      });
    } },
    twirl: { title: 'Twirl', controls: [S('angle', 'Angle', -999, 999, 120)], fn: (d, p) => {
      const w = d.width, h = d.height, cx = w / 2, cy = h / 2, R = Math.min(cx, cy), A = p.angle * Math.PI / 180;
      return warp(d, (x, y) => {
        const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy); if (r >= R) return [x, y];
        const t = A * (1 - r / R) * (1 - r / R); const [rx, ry] = U.rot(dx, dy, t); return [cx + rx, cy + ry];
      });
    } },
    ripple: { title: 'Ripple', controls: [S('amount', 'Amount', 1, 60, 8), S('size', 'Wavelength', 4, 200, 40)], fn: (d, p) =>
      warp(d, (x, y) => [x + Math.sin(y / p.size * Math.PI * 2) * p.amount, y + Math.sin(x / p.size * Math.PI * 2) * p.amount]) },
    pixelate: { title: 'Mosaic', controls: [S('cell', 'Cell size (px)', 2, 200, 16)], fn: (d, p) => {
      const w = d.width, h = d.height, s = d.data, c = p.cell | 0;
      for (let y0 = 0; y0 < h; y0 += c) for (let x0 = 0; x0 < w; x0 += c) {
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let y = y0; y < Math.min(h, y0 + c); y++) for (let x = x0; x < Math.min(w, x0 + c); x++) { const i = (y * w + x) * 4; r += s[i]; g += s[i + 1]; b += s[i + 2]; a += s[i + 3]; n++; }
        for (let y = y0; y < Math.min(h, y0 + c); y++) for (let x = x0; x < Math.min(w, x0 + c); x++) { const i = (y * w + x) * 4; s[i] = r / n; s[i + 1] = g / n; s[i + 2] = b / n; s[i + 3] = a / n; }
      }
      return d;
    } },
    halftone: { title: 'Colour Halftone', controls: [S('size', 'Dot size', 3, 40, 8), B('mono', 'Black & white', false)], fn: (d, p) => {
      const w = d.width, h = d.height, s = d.data, c = U.canvas(w, h), x = U.ctx(c), sz = p.size;
      x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
      const chans = p.mono ? [[0, '#000', 45]] : [[0, 'rgba(0,200,255,0.9)', 15], [1, 'rgba(255,0,170,0.9)', 75], [2, 'rgba(255,230,0,0.9)', 0]];
      x.globalCompositeOperation = 'multiply';
      for (const [ci, col, ang] of chans) {
        x.fillStyle = col; const a = ang * Math.PI / 180, R = Math.hypot(w, h);
        for (let gy = -R; gy < R; gy += sz) for (let gx = -R; gx < R; gx += sz) {
          const [px, py] = U.rot(gx, gy, a); const X = px + w / 2, Y = py + h / 2;
          if (X < -sz || Y < -sz || X > w + sz || Y > h + sz) continue;
          const i = (clamp(Y | 0, 0, h - 1) * w + clamp(X | 0, 0, w - 1)) * 4;
          const v = p.mono ? 1 - U.lum(s[i], s[i + 1], s[i + 2]) / 255 : 1 - s[i + ci] / 255;
          const r = Math.sqrt(v) * sz * 0.7; if (r < 0.3) continue;
          x.beginPath(); x.arc(X, Y, r, 0, Math.PI * 2); x.fill();
        }
      }
      const out = x.getImageData(0, 0, w, h); for (let i = 3; i < s.length; i += 4) out.data[i] = s[i];
      return out;
    } },
    vignette: { title: 'Vignette', controls: [S('amount', 'Amount (−white / +dark)', -100, 100, 45), S('size', 'Size', 0, 100, 55), S('feather', 'Feather', 5, 100, 55)], fn: (d, p) => { K.Adjust.vignette(d, p.amount / 100, p.size / 100, p.feather / 100); return d; } },
    flare: { title: 'Lens Flare', controls: [S('x', 'Position X (%)', 0, 100, 25), S('y', 'Position Y (%)', 0, 100, 25), S('brightness', 'Brightness', 10, 300, 100)], fn: (d, p) => {
      const w = d.width, h = d.height, c = U.fromData(d), x = U.ctx(c), fx = w * p.x / 100, fy = h * p.y / 100, R = Math.hypot(w, h), b = p.brightness / 100;
      x.globalCompositeOperation = 'screen';
      const g = x.createRadialGradient(fx, fy, 0, fx, fy, R * 0.25);
      g.addColorStop(0, `rgba(255,250,235,${0.95 * Math.min(1, b)})`); g.addColorStop(0.15, `rgba(255,220,170,${0.5 * b})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      [[0.3, 0.05, '120,180,255'], [0.55, 0.03, '255,160,120'], [0.8, 0.08, '160,255,180'], [1.2, 0.04, '200,140,255'], [1.5, 0.11, '255,210,140']].forEach(([t, r, col]) => {
        const X = fx + (cx - fx) * t * 2, Y = fy + (cy - fy) * t * 2, rr = R * r;
        const gg = x.createRadialGradient(X, Y, 0, X, Y, rr); gg.addColorStop(0, `rgba(${col},${0.25 * b})`); gg.addColorStop(0.8, `rgba(${col},${0.12 * b})`); gg.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = gg; x.beginPath(); x.arc(X, Y, rr, 0, Math.PI * 2); x.fill();
      });
      const out = x.getImageData(0, 0, w, h); for (let i = 3; i < out.data.length; i += 4) out.data[i] = d.data[i];
      return out;
    } },
    grain: { title: 'Film Grain', controls: [S('amount', 'Amount', 1, 100, 25), S('size', 'Grain size', 1, 4, 1.5, 0.5)], fn: (d, p) => {
      const w = d.width, h = d.height, gw = Math.ceil(w / p.size), gh = Math.ceil(h / p.size), rnd = seeded(11), noise = new Float32Array(gw * gh);
      for (let i = 0; i < noise.length; i++) noise[i] = (rnd() + rnd() - 1);
      const s = d.data, a = p.amount * 0.9;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, n = noise[((y / p.size) | 0) * gw + ((x / p.size) | 0)];
        const l = U.lum(s[i], s[i + 1], s[i + 2]) / 255, k = n * a * (1 - Math.abs(l - 0.5) * 1.2);
        s[i] += k; s[i + 1] += k; s[i + 2] += k;
      }
      return d;
    } },
    sketch: { title: 'Pencil Sketch', controls: [S('detail', 'Detail', 1, 30, 8), S('darkness', 'Darkness', 10, 300, 100), B('colour', 'Keep colour', false)], fn: (d, p) => {
      const w = d.width, h = d.height, s = d.data, g = new ImageData(w, h), gd = g.data;
      for (let i = 0; i < s.length; i += 4) { const v = 255 - U.lum(s[i], s[i + 1], s[i + 2]); gd[i] = gd[i + 1] = gd[i + 2] = v; gd[i + 3] = 255; }
      const b = blurRGBA(g, p.detail), bd = b.data, out = new ImageData(w, h), o = out.data, dk = p.darkness / 100;
      for (let i = 0; i < s.length; i += 4) {
        const base = 255 - gd[i], blend = bd[i];
        let v = blend >= 255 ? 255 : Math.min(255, base * 255 / (255 - blend));
        v = 255 - (255 - v) * dk;
        if (p.colour) { const f = v / 255; o[i] = U.lerp(255, s[i], 0.5) * f; o[i + 1] = U.lerp(255, s[i + 1], 0.5) * f; o[i + 2] = U.lerp(255, s[i + 2], 0.5) * f; }
        else o[i] = o[i + 1] = o[i + 2] = v;
        o[i + 3] = s[i + 3];
      }
      return out;
    } },
    cartoon: { title: 'Cartoon', controls: [S('smooth', 'Smoothing', 1, 10, 4), S('levels', 'Colour levels', 3, 16, 6), S('edges', 'Edge strength', 0, 100, 60)], fn: (d, p) => {
      let o = F.surface.fn(d, { radius: p.smooth * 1.5, threshold: 30 });
      K.Adjust.apply('posterize', { levels: p.levels }, o);
      const m = sobel(blurRGBA(d, 1.2)), od = o.data, t = 255 - p.edges * 2.2;
      for (let j = 0; j < m.length; j++) if (m[j] > t) { const k = clamp((m[j] - t) / 80, 0, 1); for (let c = 0; c < 3; c++) od[j * 4 + c] *= 1 - k; }
      return o;
    } },
    watercolor: { title: 'Watercolour', controls: [S('brush', 'Brush detail', 1, 8, 3), S('texture', 'Paper texture', 0, 100, 40)], fn: (d, p) => {
      let o = median(d, p.brush);
      o = F.surface.fn(o, { radius: p.brush * 2, threshold: 40 });
      K.Adjust.apply('quick', { saturation: 15, contrast: -10, fade: 6 }, o);
      const m = sobel(o), od = o.data;
      for (let j = 0; j < m.length; j++) { const k = clamp(m[j] / 600, 0, 0.35); for (let c = 0; c < 3; c++) od[j * 4 + c] *= 1 - k; }
      if (p.texture) F.grain.fn(o, { amount: p.texture / 3, size: 2 });
      return o;
    } },
  };
  for (const k in F) F[k].kind = k;
  const defaults = (kind) => { const p = {}; for (const c of F[kind].controls) p[c.key] = c.def; return p; };

  K.Filters = { defs: F, defaults, blurRGBA, median, sobel, sampler, seeded, run: (kind, data, p) => F[kind].fn(data, Object.assign(defaults(kind), p || {})) };
})(window.K);
