// Forged — colour & tone adjustments (all operate in place on ImageData)
(function (K) {
  'use strict';
  const U = K.U;
  const clamp = U.clamp;

  // ---------- Curve helpers ----------
  // Monotone cubic interpolation through control points -> 256 LUT
  function curveLUT(points) {
    const pts = points.slice().sort((a, b) => a[0] - b[0]);
    const n = pts.length; const lut = new Uint8ClampedArray(256);
    if (n < 2) { for (let i = 0; i < 256; i++) lut[i] = i; return lut; }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    for (let x = 0; x < 256; x++) {
      if (x <= xs[0]) { lut[x] = ys[0]; continue; }
      if (x >= xs[n - 1]) { lut[x] = ys[n - 1]; continue; }
      let k = 0; while (k < n - 2 && x > xs[k + 1]) k++;
      const h = xs[k + 1] - xs[k], t = (x - xs[k]) / h;
      const t2 = t * t, t3 = t2 * t;
      const v = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
      lut[x] = clamp(Math.round(v), 0, 255);
    }
    return lut;
  }

  function applyLUT(data, lr, lg, lb) {
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = lr[d[i]]; d[i + 1] = lg[d[i + 1]]; d[i + 2] = lb[d[i + 2]]; }
  }
  const identity = () => { const l = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) l[i] = i; return l; };
  const compose = (a, b) => { const o = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) o[i] = b[a[i]]; return o; };

  function levelsLUT(inB, inW, gamma, outB, outW) {
    const l = new Uint8ClampedArray(256);
    const range = Math.max(1, inW - inB);
    for (let i = 0; i < 256; i++) {
      let v = clamp((i - inB) / range, 0, 1);
      v = Math.pow(v, 1 / gamma);
      l[i] = Math.round(outB + v * (outW - outB));
    }
    return l;
  }

  function histogram(data) {
    const d = data.data; const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
    const step = d.length > 16e6 ? 16 : d.length > 4e6 ? 8 : 4;
    for (let i = 0; i < d.length; i += step) {
      if (d[i + 3] < 8) continue;
      r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++; l[Math.round(U.lum(d[i], d[i + 1], d[i + 2]))]++;
    }
    return { r, g, b, l };
  }
  function percentile(h, p) {
    let tot = 0; for (let i = 0; i < 256; i++) tot += h[i];
    const lo = tot * p, hi = tot * (1 - p); let acc = 0, a = 0, b = 255, fa = false;
    for (let i = 0; i < 256; i++) { acc += h[i]; if (!fa && acc >= lo) { a = i; fa = true; } if (acc >= hi) { b = i; break; } }
    return [a, Math.max(a + 1, b)];
  }

  // Hue-sector weight (0..1) for hue h (0..1) relative to centre c
  const hueW = (h, c) => { let dd = Math.abs(h - c); dd = Math.min(dd, 1 - dd); return Math.max(0, 1 - dd * 6); };

  // Box blur of a single-channel Float32Array
  function blurChannel(src, w, h, r) {
    r = Math.max(1, Math.round(r));
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    const pass = (a, b, horiz) => {
      const len = horiz ? w : h, lines = horiz ? h : w;
      for (let l = 0; l < lines; l++) {
        let acc = 0; const idx = (k) => horiz ? l * w + clamp(k, 0, w - 1) : clamp(k, 0, h - 1) * w + l;
        for (let k = -r; k <= r; k++) acc += a[idx(k)];
        for (let k = 0; k < len; k++) {
          b[horiz ? l * w + k : k * w + l] = acc / (2 * r + 1);
          acc += a[idx(k + r + 1)] - a[idx(k - r)];
        }
      }
    };
    pass(src, tmp, true); pass(tmp, out, false);
    pass(out, tmp, true); pass(tmp, out, false);
    return out;
  }

  // ---------- Definitions (for UI + defaults) ----------
  const S = (key, label, min, max, def, step = 1) => ({ key, label, min, max, def, step, type: 'range' });
  const C = (key, label, def) => ({ key, label, def, type: 'color' });
  const B = (key, label, def) => ({ key, label, def, type: 'check' });

  const defs = {
    brightnessContrast: { title: 'Brightness / Contrast', controls: [S('brightness', 'Brightness', -150, 150, 0), S('contrast', 'Contrast', -100, 100, 0)] },
    levels: { title: 'Levels', controls: [S('inBlack', 'Input black', 0, 253, 0), S('gamma', 'Midtones (gamma)', 0.1, 4, 1, 0.01), S('inWhite', 'Input white', 2, 255, 255), S('outBlack', 'Output black', 0, 255, 0), S('outWhite', 'Output white', 0, 255, 255)], histogram: true },
    curves: { title: 'Curves', controls: [], curves: true },
    exposure: { title: 'Exposure', controls: [S('exposure', 'Exposure (stops)', -4, 4, 0, 0.05), S('offset', 'Offset', -0.5, 0.5, 0, 0.005), S('gamma', 'Gamma', 0.2, 3, 1, 0.01)] },
    shadowsHighlights: { title: 'Shadows / Highlights', controls: [S('shadows', 'Lighten shadows', 0, 100, 25), S('highlights', 'Darken highlights', 0, 100, 0), S('midtone', 'Midtone contrast', -100, 100, 0)] },
    hueSat: { title: 'Hue / Saturation', controls: [S('hue', 'Hue', -180, 180, 0), S('saturation', 'Saturation', -100, 100, 0), S('lightness', 'Lightness', -100, 100, 0), B('colorize', 'Colourise', false)] },
    vibrance: { title: 'Vibrance', controls: [S('vibrance', 'Vibrance', -100, 100, 30), S('saturation', 'Saturation', -100, 100, 0)] },
    colorBalance: { title: 'Colour Balance', controls: [
      S('sCR', 'Shadows: Cyan ↔ Red', -100, 100, 0), S('sMG', 'Shadows: Magenta ↔ Green', -100, 100, 0), S('sYB', 'Shadows: Yellow ↔ Blue', -100, 100, 0),
      S('mCR', 'Midtones: Cyan ↔ Red', -100, 100, 0), S('mMG', 'Midtones: Magenta ↔ Green', -100, 100, 0), S('mYB', 'Midtones: Yellow ↔ Blue', -100, 100, 0),
      S('hCR', 'Highlights: Cyan ↔ Red', -100, 100, 0), S('hMG', 'Highlights: Magenta ↔ Green', -100, 100, 0), S('hYB', 'Highlights: Yellow ↔ Blue', -100, 100, 0),
      B('preserve', 'Preserve luminosity', true)] },
    temperature: { title: 'Temperature / Tint', controls: [S('temperature', 'Temperature', -100, 100, 0), S('tint', 'Tint', -100, 100, 0)] },
    photoFilter: { title: 'Photo Filter', controls: [C('color', 'Filter colour', '#ec8a00'), S('density', 'Density', 0, 100, 25), B('preserve', 'Preserve luminosity', true)] },
    blackWhite: { title: 'Black & White', controls: [S('reds', 'Reds', -200, 300, 40), S('yellows', 'Yellows', -200, 300, 60), S('greens', 'Greens', -200, 300, 40), S('cyans', 'Cyans', -200, 300, 60), S('blues', 'Blues', -200, 300, 20), S('magentas', 'Magentas', -200, 300, 80), B('tint', 'Tint', false), C('tintColor', 'Tint colour', '#c8a77a')] },
    gradientMap: { title: 'Gradient Map', controls: [C('from', 'Shadows colour', '#1a1033'), C('to', 'Highlights colour', '#ffd9a0'), B('reverse', 'Reverse', false)] },
    posterize: { title: 'Posterize', controls: [S('levels', 'Levels', 2, 32, 6)] },
    threshold: { title: 'Threshold', controls: [S('level', 'Threshold level', 1, 255, 128)] },
    invert: { title: 'Invert', controls: [] },
    desaturate: { title: 'Desaturate', controls: [] },
    quick: { title: 'Quick Fix', controls: [
      S('exposure', 'Exposure', -100, 100, 0), S('contrast', 'Contrast', -100, 100, 0), S('highlights', 'Highlights', -100, 100, 0), S('shadows', 'Shadows', -100, 100, 0),
      S('whites', 'Whites', -100, 100, 0), S('blacks', 'Blacks', -100, 100, 0), S('temperature', 'Temperature', -100, 100, 0), S('tint', 'Tint', -100, 100, 0),
      S('vibrance', 'Vibrance', -100, 100, 0), S('saturation', 'Saturation', -100, 100, 0), S('fade', 'Fade', 0, 100, 0)] },
    smartfix: { title: 'Adjust Smart Fix', controls: [S('amount', 'Fix amount', 0, 200, 100)] },
    look: { title: 'Effect', controls: [S('amount', 'Strength', 0, 100, 100)] },
  };
  for (const k in defs) defs[k].kind = k;

  function defaults(kind) {
    const p = {};
    for (const c of defs[kind].controls) p[c.key] = c.def;
    if (kind === 'curves') p.points = { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] };
    if (kind === 'look') p.name = 'vivid';
    return p;
  }

  // ---------- Look presets (built from quick fix + toning) ----------
  const looks = {
    vivid: { label: 'Vivid', q: { contrast: 18, vibrance: 45, saturation: 10 } },
    warm: { label: 'Warm Glow', q: { temperature: 35, exposure: 5, vibrance: 10 } },
    cool: { label: 'Cool Breeze', q: { temperature: -35, tint: -5, contrast: 8 } },
    matte: { label: 'Matte', q: { contrast: -15, fade: 22, saturation: -10 } },
    faded: { label: 'Faded Film', q: { fade: 35, saturation: -25, temperature: 10, contrast: -10 } },
    vintage: { label: 'Vintage', q: { fade: 18, saturation: -30, temperature: 30, tint: 8, contrast: 8 }, tone: ['#2b1a10', '#fff1d0', 0.35] },
    noir: { label: 'Noir', q: { contrast: 45, saturation: -100, blacks: -20 } },
    silver: { label: 'Silver B&W', q: { contrast: 10, saturation: -100, highlights: -15, shadows: 20 } },
    sepia: { label: 'Sepia', q: { saturation: -100 }, tone: ['#2d1b0e', '#f6e2c0', 1] },
    duotone: { label: 'Duotone', q: { contrast: 15 }, tone: ['#16224f', '#ffb36b', 1] },
    cross: { label: 'Cross Process', q: { contrast: 25, saturation: 20, tint: -15 }, curves: { r: [[0, 0], [64, 45], [192, 220], [255, 255]], b: [[0, 40], [255, 215]] } },
    lomo: { label: 'Lomo', q: { contrast: 35, saturation: 30, vibrance: 20, blacks: -15 }, vignette: 0.55 },
    golden: { label: 'Golden Hour', q: { temperature: 50, tint: 10, exposure: 8, highlights: -20, vibrance: 20 } },
    moody: { label: 'Moody', q: { exposure: -12, contrast: 20, saturation: -20, temperature: -10, shadows: -15 } },
    bright: { label: 'Bright & Airy', q: { exposure: 22, contrast: -12, shadows: 30, highlights: -10, saturation: -8, temperature: -5 } },
    dramatic: { label: 'Dramatic', q: { contrast: 40, highlights: -35, shadows: 25, vibrance: 15, blacks: -10 } },
  };

  // ---------- Core apply ----------
  function quickFix(data, q) {
    const p = Object.assign(defaults('quick'), q);
    // Tone LUT
    const lut = new Uint8ClampedArray(256);
    const ex = Math.pow(2, p.exposure / 50), ct = 1 + p.contrast / 100;
    for (let i = 0; i < 256; i++) {
      let v = i / 255;
      v = v * ex;
      // shadows/highlights tone-curve style
      const sh = p.shadows / 100, hi = p.highlights / 100;
      v += sh * 0.35 * Math.pow(1 - v, 2) * v * 4 * 0.5;
      v += hi * 0.35 * Math.pow(v, 2) * (1 - v) * 4 * 0.5;
      // whites / blacks
      v += (p.whites / 100) * 0.25 * v * v * v;
      v += (p.blacks / 100) * 0.25 * Math.pow(1 - v, 3);
      // contrast around mid grey
      v = (v - 0.5) * ct + 0.5;
      // fade lifts black point
      v = p.fade / 100 * 0.25 + v * (1 - p.fade / 100 * 0.25 - p.fade / 100 * 0.05);
      lut[i] = clamp(Math.round(v * 255), 0, 255);
    }
    const d = data.data;
    const tr = p.temperature / 100 * 30, tb = -p.temperature / 100 * 30, tg = -p.tint / 100 * 25;
    const vib = p.vibrance / 100, sat = 1 + p.saturation / 100;
    for (let i = 0; i < d.length; i += 4) {
      let r = lut[d[i]] + tr, g = lut[d[i + 1]] + tg, b = lut[d[i + 2]] + tb;
      if (vib || sat !== 1) {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        const s = (mx - mn) / 255;
        const f = sat * (1 + vib * (1 - s) * (vib > 0 ? 1 : 0.6));
        r = l + (r - l) * f; g = l + (g - l) * f; b = l + (b - l) * f;
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  }

  function tone(data, c1, c2, amt) {
    const a = U.hexToRgb(c1), b = U.hexToRgb(c2), d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      const t = U.lum(d[i], d[i + 1], d[i + 2]) / 255;
      d[i] = U.lerp(d[i], a[0] + (b[0] - a[0]) * t, amt);
      d[i + 1] = U.lerp(d[i + 1], a[1] + (b[1] - a[1]) * t, amt);
      d[i + 2] = U.lerp(d[i + 2], a[2] + (b[2] - a[2]) * t, amt);
    }
  }

  function vignette(data, amount, size = 0.6, feather = 0.5) {
    const w = data.width, h = data.height, d = data.data, cx = w / 2, cy = h / 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const r = Math.hypot((x - cx) / cx, (y - cy) / cy) / Math.SQRT2;
      const t = clamp((r - size * 0.7) / Math.max(0.05, feather), 0, 1);
      const k = Math.abs(amount) * t * t, i = (y * w + x) * 4;
      if (amount >= 0) { const f = 1 - k; d[i] *= f; d[i + 1] *= f; d[i + 2] *= f; }
      else { d[i] += (255 - d[i]) * k; d[i + 1] += (255 - d[i + 1]) * k; d[i + 2] += (255 - d[i + 2]) * k; }
    }
  }

  function apply(kind, p, data) {
    const d = data.data;
    p = Object.assign(defaults(kind), p || {});
    switch (kind) {
      case 'brightnessContrast': {
        const lut = new Uint8ClampedArray(256), b = p.brightness, c = p.contrast / 100;
        const cf = c >= 0 ? 1 / Math.max(0.01, 1 - c * 0.99) : 1 + c;
        for (let i = 0; i < 256; i++) {
          let v = i / 255;
          v = b >= 0 ? 1 - Math.pow(1 - v, 1 + b / 100) : Math.pow(v, 1 - b / 100);
          v = (v - 0.5) * cf + 0.5;
          lut[i] = clamp(Math.round(v * 255), 0, 255);
        }
        applyLUT(data, lut, lut, lut); break;
      }
      case 'levels': { const l = levelsLUT(p.inBlack, p.inWhite, p.gamma, p.outBlack, p.outWhite); applyLUT(data, l, l, l); break; }
      case 'curves': {
        const pts = p.points || defaults('curves').points;
        const m = curveLUT(pts.rgb);
        applyLUT(data, compose(curveLUT(pts.r), m), compose(curveLUT(pts.g), m), compose(curveLUT(pts.b), m)); break;
      }
      case 'exposure': {
        const lut = new Uint8ClampedArray(256), e = Math.pow(2, p.exposure);
        for (let i = 0; i < 256; i++) lut[i] = clamp(Math.round(Math.pow(clamp((i / 255) * e + p.offset, 0, 1), 1 / p.gamma) * 255), 0, 255);
        applyLUT(data, lut, lut, lut); break;
      }
      case 'shadowsHighlights': {
        const w = data.width, h = data.height, n = w * h, L = new Float32Array(n);
        for (let i = 0, j = 0; j < n; i += 4, j++) L[j] = U.lum(d[i], d[i + 1], d[i + 2]) / 255;
        const B = blurChannel(L, w, h, Math.max(2, Math.min(w, h) / 40));
        const sA = p.shadows / 100, hA = p.highlights / 100, mc = p.midtone / 100;
        for (let i = 0, j = 0; j < n; i += 4, j++) {
          const bl = B[j];
          const sMask = Math.pow(1 - bl, 2), hMask = Math.pow(bl, 2);
          const l0 = Math.max(1e-3, L[j]);
          let l1 = l0 + sA * sMask * (1 - l0) * 0.9 - hA * hMask * l0 * 0.6;
          l1 = clamp((l1 - 0.5) * (1 + mc * 0.6) + 0.5, 0, 1);
          const f = l1 / l0;
          d[i] = d[i] * f; d[i + 1] = d[i + 1] * f; d[i + 2] = d[i + 2] * f;
        }
        break;
      }
      case 'hueSat': {
        const hs = p.hue / 360, sat = p.saturation / 100, li = p.lightness / 100;
        for (let i = 0; i < d.length; i += 4) {
          let [h, s, l] = U.rgbToHsl(d[i], d[i + 1], d[i + 2]);
          if (p.colorize) { h = ((p.hue + 360) % 360) / 360; s = sat >= 0 ? 0.25 + sat * 0.75 : 0.25 * (1 + sat); }
          else { h = (h + hs + 1) % 1; s = sat >= 0 ? s + (1 - s) * sat * s : s * (1 + sat); }
          l = li >= 0 ? l + (1 - l) * li : l * (1 + li);
          const c = U.hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1));
          d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
        }
        break;
      }
      case 'vibrance': quickFix(data, { vibrance: p.vibrance, saturation: p.saturation }); break;
      case 'colorBalance': {
        const sh = [p.sCR, p.sMG, p.sYB], mi = [p.mCR, p.mMG, p.mYB], hi = [p.hCR, p.hMG, p.hYB];
        for (let i = 0; i < d.length; i += 4) {
          const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2], l = U.lum(r0, g0, b0) / 255;
          const ws = clamp(1 - l * 2.2, 0, 1), wh = clamp(l * 2.2 - 1.2, 0, 1), wm = clamp(1 - Math.abs(l - 0.5) * 2.5, 0, 1);
          const dr = (sh[0] * ws + mi[0] * wm + hi[0] * wh) * 0.5;
          const dg = (sh[1] * ws + mi[1] * wm + hi[1] * wh) * 0.5;
          const db = (sh[2] * ws + mi[2] * wm + hi[2] * wh) * 0.5;
          let r = r0 + dr, g = g0 + dg, b = b0 + db;
          if (p.preserve) { const nl = U.lum(r, g, b) || 1, f = (l * 255) / nl; r *= f; g *= f; b *= f; }
          d[i] = r; d[i + 1] = g; d[i + 2] = b;
        }
        break;
      }
      case 'temperature': quickFix(data, { temperature: p.temperature, tint: p.tint }); break;
      case 'photoFilter': {
        const c = U.hexToRgb(p.color), a = p.density / 100;
        for (let i = 0; i < d.length; i += 4) {
          const l0 = U.lum(d[i], d[i + 1], d[i + 2]);
          let r = U.lerp(d[i], d[i] * c[0] / 255 * 1.6, a), g = U.lerp(d[i + 1], d[i + 1] * c[1] / 255 * 1.6, a), b = U.lerp(d[i + 2], d[i + 2] * c[2] / 255 * 1.6, a);
          if (p.preserve) { const nl = U.lum(r, g, b) || 1, f = l0 / nl; r *= f; g *= f; b *= f; }
          d[i] = r; d[i + 1] = g; d[i + 2] = b;
        }
        break;
      }
      case 'blackWhite': {
        const W = [p.reds, p.yellows, p.greens, p.cyans, p.blues, p.magentas].map((v) => v / 100);
        const tc = U.hexToRgb(p.tintColor);
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const [h, s] = U.rgbToHsl(r, g, b);
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          let wsum = 0, ww = 0;
          for (let k = 0; k < 6; k++) { const hw = hueW(h, k / 6); wsum += hw * W[k]; ww += hw; }
          const weight = ww ? wsum / ww : 0.5;
          // blend between neutral luminance and weighted chroma response
          let v = mn + (mx - mn) * weight * 1.25 * (0.4 + s * 0.6) + (U.lum(r, g, b) - mn) * (1 - s) * 0.5;
          v = clamp(v, 0, 255);
          if (p.tint) { const t = v / 255; d[i] = v * (1 - 0.5) + tc[0] * t * 0.5; d[i + 1] = v * 0.5 + tc[1] * t * 0.5; d[i + 2] = v * 0.5 + tc[2] * t * 0.5; }
          else { d[i] = d[i + 1] = d[i + 2] = v; }
        }
        break;
      }
      case 'gradientMap': { const a = p.reverse ? p.to : p.from, b = p.reverse ? p.from : p.to; tone(data, a, b, 1); break; }
      case 'posterize': {
        const n = Math.max(2, p.levels | 0), lut = new Uint8ClampedArray(256);
        for (let i = 0; i < 256; i++) lut[i] = Math.round(Math.round((i / 255) * (n - 1)) / (n - 1) * 255);
        applyLUT(data, lut, lut, lut); break;
      }
      case 'threshold': for (let i = 0; i < d.length; i += 4) { const v = U.lum(d[i], d[i + 1], d[i + 2]) >= p.level ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; } break;
      case 'invert': for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; } break;
      case 'desaturate': for (let i = 0; i < d.length; i += 4) { const v = U.lum(d[i], d[i + 1], d[i + 2]); d[i] = d[i + 1] = d[i + 2] = v; } break;
      case 'quick': quickFix(data, p); break;
      case 'smartfix': {
        const orig = new Uint8ClampedArray(d), amt = p.amount / 100; auto('smartfix', data);
        for (let i = 0; i < d.length; i++) if ((i & 3) !== 3) d[i] = orig[i] + (d[i] - orig[i]) * amt;
        break;
      }
      case 'look': {
        const L = looks[p.name] || looks.vivid; const amt = p.amount / 100;
        const orig = amt < 1 ? new Uint8ClampedArray(d) : null;
        quickFix(data, L.q);
        if (L.tone) tone(data, L.tone[0], L.tone[1], L.tone[2]);
        if (L.curves) applyLUT(data, L.curves.r ? curveLUT(L.curves.r) : identity(), L.curves.g ? curveLUT(L.curves.g) : identity(), L.curves.b ? curveLUT(L.curves.b) : identity());
        if (L.vignette) vignette(data, L.vignette);
        if (orig) for (let i = 0; i < d.length; i++) if ((i & 3) !== 3) d[i] = orig[i] + (d[i] - orig[i]) * amt;
        break;
      }
    }
    return data;
  }

  // ---------- Auto fixes ----------
  function auto(kind, data) {
    const h = histogram(data);
    if (kind === 'levels') {
      const [r0, r1] = percentile(h.r, 0.005), [g0, g1] = percentile(h.g, 0.005), [b0, b1] = percentile(h.b, 0.005);
      applyLUT(data, levelsLUT(r0, r1, 1, 0, 255), levelsLUT(g0, g1, 1, 0, 255), levelsLUT(b0, b1, 1, 0, 255));
    } else if (kind === 'contrast') {
      const [a, b] = percentile(h.l, 0.005); const l = levelsLUT(a, b, 1, 0, 255); applyLUT(data, l, l, l);
    } else if (kind === 'color') {
      // grey-world white balance + per-channel stretch
      const d = data.data; let sr = 0, sg = 0, sb = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) { if (d[i + 3] < 8) continue; sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++; }
      const avg = (sr + sg + sb) / (3 * Math.max(1, n));
      const fr = avg / Math.max(1, sr / n), fg = avg / Math.max(1, sg / n), fb = avg / Math.max(1, sb / n);
      const k = (f) => clamp(1 + (f - 1) * 0.6, 0.85, 1.18); // gentle, capped grey-world
      for (let i = 0; i < d.length; i += 4) { d[i] *= k(fr); d[i + 1] *= k(fg); d[i + 2] *= k(fb); }
      auto('contrast', data);
    } else if (kind === 'smartfix') {
      const [a, b] = percentile(h.l, 0.003);
      let mean = 0, tot = 0; for (let i = 0; i < 256; i++) { mean += i * h.l[i]; tot += h.l[i]; } mean /= Math.max(1, tot);
      const gamma = clamp(Math.log(0.46) / Math.log(Math.max(0.05, (mean - a) / Math.max(1, b - a))), 0.6, 1.8);
      const l = levelsLUT(a, b, 1 / gamma, 0, 255); applyLUT(data, l, l, l);
      const before = new Uint8ClampedArray(data.data);
      auto('color', data);
      apply('shadowsHighlights', { shadows: 12, highlights: 8, midtone: 0 }, data);
      quickFix(data, { vibrance: 12, contrast: 4 });
      // keep it natural: blend 75% of the fix and limit per-pixel change
      const dd = data.data; for (let i = 0; i < dd.length; i++) { if ((i & 3) === 3) continue; const o = before[i]; dd[i] = o + clamp((dd[i] - o) * 0.75, -70, 70); }
    } else if (kind === 'redeye') {
      // only fix small, compact, round red blobs (pupil-sized), never large red objects
      const d = data.data, w = data.width, hh = data.height, N = w * hh, red = new Uint8Array(N), seen = new Uint8Array(N);
      for (let i = 0, p = 0; p < N; p++, i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; red[p] = r > 80 && r - Math.max(g, b) > 50 && r > (g + b) * 0.75 ? 1 : 0; }
      const maxA = Math.max(30, N * 0.0015), stack = [];
      for (let p0 = 0; p0 < N; p0++) {
        if (!red[p0] || seen[p0]) continue;
        let area = 0, x0 = w, y0 = hh, x1 = 0, y1 = 0; stack.push(p0); seen[p0] = 1;
        while (stack.length) { const p = stack.pop(), x = p % w, y = (p / w) | 0; area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          if (area > maxA * 4) continue;
          for (const q of [p - 1, p + 1, p - w, p + w]) if (q >= 0 && q < N && !seen[q] && red[q] && Math.abs((q % w) - x) <= 1) { seen[q] = 1; stack.push(q); } }
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1, fill = area / (bw * bh), asp = bw / bh;
        if (area >= 6 && area <= maxA && asp > 0.5 && asp < 2 && fill > 0.45) { const pad = Math.ceil(Math.max(bw, bh) * 0.25); redEye(data, x0 - pad, y0 - pad, x1 + pad + 1, y1 + pad + 1); }
      }
    }
    return data;
  }

  // Red eye: reduce strongly red pixels in region
  function redEye(data, x0, y0, x1, y1, strength = 1) {
    const d = data.data, w = data.width;
    for (let y = Math.max(0, y0); y < Math.min(data.height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
      const i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      const redness = r - Math.max(g, b);
      if (r > 60 && redness > 35 && r > (g + b) * 0.6) {
        const v = (g + b) / 2; const t = clamp((redness - 35) / 60, 0, 1) * strength;
        d[i] = U.lerp(r, v * 0.8, t); d[i + 1] = U.lerp(g, g * 0.85, t); d[i + 2] = U.lerp(b, b * 0.85, t);
      }
    }
  }

  K.Adjust = { defs, defaults, apply, auto, looks, curveLUT, histogram, blurChannel, redEye, tone, vignette };
})(window.K);
