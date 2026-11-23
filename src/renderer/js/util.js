// Forged — shared helpers
window.K = window.K || {};
(function (K) {
  'use strict';
  const U = {};

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.uid = (() => { let n = 1; return () => 'L' + (n++) + '_' + Math.random().toString(36).slice(2, 7); })();

  U.canvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  };
  U.ctx = (c, opts) => c.getContext('2d', opts || { willReadFrequently: true });
  U.clone = (src) => {
    const c = U.canvas(src.width, src.height);
    U.ctx(c).drawImage(src, 0, 0);
    return c;
  };
  U.getData = (c) => U.ctx(c).getImageData(0, 0, c.width, c.height);
  U.fromData = (data) => {
    const c = U.canvas(data.width, data.height);
    U.ctx(c).putImageData(data, 0, 0);
    return c;
  };
  U.copyData = (d) => new ImageData(new Uint8ClampedArray(d.data), d.width, d.height);

  U.loadImage = (src) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Could not read image'));
    img.src = src;
  });
  U.imageToCanvas = (img) => {
    const c = U.canvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
    U.ctx(c).drawImage(img, 0, 0);
    return c;
  };
  U.blobToDataUrl = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });

  // High-quality resample: step down by halves to avoid aliasing
  U.resample = (src, w, h) => {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    let cur = src, cw = src.width, ch = src.height;
    while (cw / 2 >= w && ch / 2 >= h) {
      const nw = Math.round(cw / 2), nh = Math.round(ch / 2);
      const t = U.canvas(nw, nh); const x = U.ctx(t);
      x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, nw, nh);
      cur = t; cw = nw; ch = nh;
    }
    const out = U.canvas(w, h); const o = U.ctx(out);
    o.imageSmoothingEnabled = true; o.imageSmoothingQuality = 'high';
    o.drawImage(cur, 0, 0, w, h);
    return out;
  };

  // Colour helpers
  U.hexToRgb = (hex) => {
    hex = String(hex || '#000').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex.slice(0, 6), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  U.rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => U.clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  U.rgbToHsl = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  };
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  U.hslToRgb = (h, s, l) => {
    if (s === 0) { const v = l * 255; return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
  };
  U.lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  // Rotate a point around origin
  U.rot = (x, y, a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };

  U.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  U.rafThrottle = (fn) => { let q = false, args; return (...a) => { args = a; if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(...args); }); }; };

  U.el = (tag, attrs, ...children) => {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v;
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  };

  U.download = (dataUrl, name) => { const a = document.createElement('a'); a.href = dataUrl; a.download = name; a.click(); };
  U.dataUrlToBase64 = (d) => d.slice(d.indexOf(',') + 1);
  U.isTyping = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable) && a.type !== 'range' && a.type !== 'checkbox' && a.type !== 'color'; };

  // ---------- measurement units ----------
  // Pixels per unit are derived from the document resolution (pixels per inch).
  U.UNITS = [['px', 'Pixels'], ['mm', 'Millimetres'], ['cm', 'Centimetres'], ['in', 'Inches'], ['pt', 'Points']];
  const PER_INCH = { px: null, mm: 25.4, cm: 2.54, in: 1, pt: 72 };
  U.pxPerUnit = (unit, ppi) => (unit === 'px' ? 1 : (ppi || 72) / PER_INCH[unit]);
  U.toUnit = (px, unit, ppi) => px / U.pxPerUnit(unit, ppi);
  U.fromUnit = (v, unit, ppi) => v * U.pxPerUnit(unit, ppi);
  U.unitDigits = (unit) => ({ px: 0, mm: 1, cm: 2, in: 3, pt: 1 }[unit] || 0);
  U.fmtUnit = (px, unit, ppi, withUnit = true) => {
    const v = U.toUnit(px, unit, ppi), n = U.unitDigits(unit);
    const s = n ? (+v.toFixed(n)).toString() : String(Math.round(v));
    return withUnit ? `${s} ${unit}` : s;
  };
  // Reads the stored resolution from a JPEG (JFIF / EXIF) or PNG (pHYs) data URL. Returns ppi or null.
  U.readPPI = (dataUrl) => {
    try {
      const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1, dataUrl.indexOf(',') + 1 + 87384);
      const s = atob(b64.slice(0, b64.length - (b64.length % 4))), n = s.length, b = (i) => s.charCodeAt(i) & 255;
      const u16 = (i, le) => (le ? b(i) | (b(i + 1) << 8) : (b(i) << 8) | b(i + 1));
      const u32 = (i, le) => (le ? (u16(i, 1) | (u16(i + 2, 1) << 16)) >>> 0 : ((u16(i) << 16) | u16(i + 2)) >>> 0);
      if (b(0) === 0x89 && s.slice(1, 4) === 'PNG') {
        let p = 8;
        while (p + 8 < n) {
          const len = u32(p), type = s.slice(p + 4, p + 8);
          if (type === 'pHYs') { const ppm = u32(p + 8); return b(p + 16) === 1 && ppm ? Math.round(ppm * 0.0254) : null; }
          if (type === 'IDAT') break; p += 12 + len;
        }
        return null;
      }
      if (b(0) !== 0xff || b(1) !== 0xd8) return null;
      let p = 2, jfif = null;
      while (p + 4 < n && b(p) === 0xff) {
        const m = b(p + 1), len = u16(p + 2);
        if (m === 0xe0 && s.slice(p + 4, p + 9) === 'JFIF\0') { const unit = b(p + 11), xd = u16(p + 12); if (xd > 1) jfif = unit === 1 ? xd : unit === 2 ? Math.round(xd * 2.54) : null; }
        if (m === 0xe1 && s.slice(p + 4, p + 10) === 'Exif\0\0') {
          const t = p + 10, le = s.slice(t, t + 2) === 'II', ifd = t + u32(t + 4, le), cnt = u16(ifd, le);
          let xr = null, ru = 2;
          for (let i = 0; i < cnt; i++) {
            const e = ifd + 2 + i * 12, tag = u16(e, le);
            if (tag === 0x011a) { const o = t + u32(e + 8, le); const den = u32(o + 4, le); xr = den ? u32(o, le) / den : null; }
            if (tag === 0x0128) ru = u16(e + 8, le);
          }
          if (xr && xr > 1) return Math.round(ru === 3 ? xr * 2.54 : xr);
        }
        if (m === 0xda) break; p += 2 + len;
      }
      return jfif;
    } catch (e) { return null; }
  };

  K.U = U;
})(window.K);
