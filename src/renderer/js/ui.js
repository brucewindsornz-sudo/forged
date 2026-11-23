// Forged — interface: toolbar, options bar, panels, dialogs, photo bin
(function (K) {
  'use strict';
  const U = K.U, el = U.el, $ = (s) => document.querySelector(s);
  const app = () => K.app, doc = () => K.app.doc;
  const UI = {};

  // ---------- toast / busy ----------
  UI.toast = (msg, ms = 2600) => {
    const t = el('div', { class: 'toast' }, msg); $('#toasts').append(t);
    setTimeout(() => t.classList.add('out'), ms); setTimeout(() => t.remove(), ms + 400);
  };
  UI.busy = (on, msg = 'Working…') => { const b = $('#busy'); b.querySelector('span').textContent = msg; b.classList.toggle('on', !!on); };
  UI.withBusy = (msg, fn) => new Promise((res, rej) => { UI.busy(true, msg); setTimeout(() => { try { res(fn()); } catch (e) { console.error(e); UI.toast('Error: ' + e.message); rej(e); } finally { UI.busy(false); } }, 30); });

  // ---------- toolbar ----------
  UI.buildToolbar = () => {
    const tb = $('#toolbar'); tb.innerHTML = '';
    const groups = el('div', { class: 'tool-grid' });
    UI.groupActive = UI.groupActive || {};
    K.TOOL_ORDER.forEach((group, gi) => {
      const activeId = UI.groupActive[gi] || group[0];
      const t = K.tools[activeId];
      const b = el('button', { class: 'tool' + (app().tool && group.includes(app().tool.id) ? ' active' : ''), title: `${t.name} (${t.hotkey.toUpperCase()})`, 'data-group': gi, html: K.icon(t.id, 20) + (group.length > 1 ? '<i class="more"></i>' : '') });
      b.onclick = () => app().setTool(activeId);
      b.oncontextmenu = (e) => { e.preventDefault(); if (group.length > 1) UI.flyout(b, group, gi); };
      let lp; b.onpointerdown = () => { lp = setTimeout(() => { if (group.length > 1) UI.flyout(b, group, gi); }, 380); };
      b.onpointerup = b.onpointerleave = () => clearTimeout(lp);
      groups.append(b);
    });
    tb.append(groups);
    const colors = el('div', { class: 'colors' },
      el('button', { class: 'swatch bg', id: 'bg-swatch', title: 'Background colour' }),
      el('button', { class: 'swatch fg', id: 'fg-swatch', title: 'Foreground colour' }),
      el('button', { class: 'mini swap', title: 'Swap colours (X)', html: K.icon('swap', 13), onclick: () => app().run('swapColors') }),
      el('button', { class: 'mini reset', title: 'Default colours (D)', html: K.icon('reset', 12), onclick: () => app().run('resetColors') }));
    tb.append(colors);
    const pick = (which) => { const inp = $('#color-input'); inp.value = app()[which]; inp.oninput = () => { app()[which] = inp.value; UI.refreshColors(); }; inp.click(); };
    $('#fg-swatch').onclick = () => pick('fg'); $('#bg-swatch').onclick = () => pick('bg');
    UI.refreshColors();
  };
  UI.flyout = (btn, group, gi) => {
    UI.closeFlyouts();
    const r = btn.getBoundingClientRect();
    const f = el('div', { class: 'flyout', style: { left: r.right + 6 + 'px', top: r.top + 'px' } },
      group.map((id) => el('button', { class: app().tool.id === id ? 'on' : '', html: K.icon(id, 18) + `<span>${K.tools[id].name}</span><kbd>${K.tools[id].hotkey.toUpperCase()}</kbd>`, onclick: () => { UI.groupActive[gi] = id; app().setTool(id); UI.closeFlyouts(); } })));
    document.body.append(f);
    setTimeout(() => document.addEventListener('pointerdown', UI._flyClose = (e) => { if (!f.contains(e.target)) UI.closeFlyouts(); }), 0);
  };
  UI.closeFlyouts = () => { document.querySelectorAll('.flyout').forEach((f) => f.remove()); if (UI._flyClose) document.removeEventListener('pointerdown', UI._flyClose); };
  UI.refreshColors = () => { const f = $('#fg-swatch'), b = $('#bg-swatch'); if (f) f.style.background = app().fg; if (b) b.style.background = app().bg; };
  UI.refreshToolbar = () => {
    document.querySelectorAll('#toolbar .tool').forEach((b) => {
      const gi = +b.dataset.group, group = K.TOOL_ORDER[gi];
      const on = group.includes(app().tool.id);
      if (on) { UI.groupActive[gi] = app().tool.id; const t = app().tool; b.innerHTML = K.icon(t.id, 20) + (group.length > 1 ? '<i class="more"></i>' : ''); b.title = `${t.name} (${t.hotkey.toUpperCase()})`; }
      b.classList.toggle('active', on);
    });
  };

  // ---------- options bar ----------
  function sliderControl(label, value, min, max, step, unit, onInput, onChange, log) {
    const toPos = (v) => log ? Math.log(v / min) / Math.log(max / min) * 1000 : v;
    const fromPos = (p) => log ? Math.round(min * Math.pow(max / min, p / 1000)) : +p;
    const num = el('input', { type: 'number', value, min, max, step: step || 1, class: 'num' });
    const rng = el('input', { type: 'range', min: log ? 0 : min, max: log ? 1000 : max, step: log ? 1 : (step || 1), value: toPos(value) });
    rng.oninput = () => { const v = fromPos(rng.value); num.value = v; onInput(v); };
    rng.onchange = () => onChange && onChange(fromPos(rng.value));
    num.onchange = () => { const v = U.clamp(+num.value, min, max); num.value = v; rng.value = toPos(v); onInput(v); onChange && onChange(v); };
    return el('label', { class: 'opt slider' }, label ? el('span', {}, label) : null, rng, num, unit ? el('em', {}, unit) : null);
  }
  UI.sliderControl = sliderControl;

  UI.renderOptions = () => {
    const bar = $('#options'), t = app().tool; bar.innerHTML = '';
    bar.append(el('div', { class: 'tool-name', html: K.icon(t.id, 18) + `<span>${t.name}</span>` }));
    for (const s of t.optionSpec || []) {
      const set = (v) => { t.o[s.key] = v; if (t.onOption) t.onOption(s.key, v); K.app.view.requestRender(); };
      if (s.type === 'range') bar.append(sliderControl(s.label, t.o[s.key], s.min, s.max, s.step, s.unit, set, null, s.log));
      else if (s.type === 'number') { const i = el('input', { type: 'number', value: t.o[s.key], min: s.min, max: s.max, step: s.step || 1, class: 'num wide' }); i.onchange = () => set(+i.value); bar.append(el('label', { class: 'opt' }, el('span', {}, s.label), i, s.unit ? el('em', {}, s.unit) : null)); }
      else if (s.type === 'check') { const i = el('input', { type: 'checkbox' }); i.checked = !!t.o[s.key]; i.onchange = () => set(i.checked); bar.append(el('label', { class: 'opt check' }, i, el('span', {}, s.label))); }
      else if (s.type === 'toggle') { const b = el('button', { class: 'tog' + (t.o[s.key] ? ' on' : ''), style: { fontWeight: s.label === 'B' ? 700 : 400, fontStyle: s.label === 'I' ? 'italic' : 'normal', textDecoration: s.label === 'U' ? 'underline' : 'none' } }, s.label); b.onclick = () => { set(!t.o[s.key]); b.classList.toggle('on', !!t.o[s.key]); }; bar.append(b); }
      else if (s.type === 'color') { const i = el('input', { type: 'color', value: t.o[s.key] }); i.oninput = () => set(i.value); bar.append(el('label', { class: 'opt' }, el('span', {}, s.label), i)); }
      else if (s.type === 'font') {
        const btn = K.Fonts.pickerButton(t.o[s.key], (f) => {
          const st = K.Fonts.defaultStyle(f);
          Object.assign(t.o, { font: f, fstyle: st ? st.style : '', ps: st ? st.ps : '', weight: st ? st.weight : 400 });
          if (st) Object.assign(t.o, { italic: !!st.italic, bold: false });
          if (t.onOption) t.onOption(s.key, f); UI.renderOptions(); K.app.view.requestRender();
          if (t.editing) { const ta = document.getElementById('text-editor'); if (ta) ta.focus(); }
        });
        bar.append(el('label', { class: 'opt' }, s.label ? el('span', {}, s.label) : null, btn));
      } else if (s.type === 'fontstyle') {
        const styles = K.Fonts.styles(t.o.font);
        const opts = styles ? styles.map((st) => [st.ps || st.style, st.style]) : [['', 'Regular']];
        const cur = styles ? (styles.find((st) => st.ps && st.ps === t.o.ps) || styles.find((st) => st.style === t.o.fstyle)) : null;
        const sel = el('select', { title: 'Font style', class: 'font-style' }, opts.map(([v, l]) => el('option', { value: v, selected: cur ? (cur.ps || cur.style) === v : false }, l)));
        sel.disabled = !styles || styles.length < 2;
        sel.onchange = () => {
          const st = styles && styles.find((x) => (x.ps || x.style) === sel.value); if (!st) return;
          Object.assign(t.o, { fstyle: st.style, ps: st.ps || '', weight: st.weight, italic: !!st.italic, bold: false });
          if (t.onOption) t.onOption(s.key, st.style); UI.renderOptions(); K.app.view.requestRender();
          if (t.editing) { const ta = document.getElementById('text-editor'); if (ta) ta.focus(); }
        };
        bar.append(el('label', { class: 'opt' }, el('span', {}, 'Style'), sel));
      }
      else if (s.type === 'select') { const sel = el('select', {}, s.options.map(([v, l]) => el('option', { value: v, selected: String(t.o[s.key]) === String(v) }, l))); sel.onchange = () => set(sel.value); bar.append(el('label', { class: 'opt' }, s.label ? el('span', {}, s.label) : null, sel)); }
      else if (s.type === 'buttons') {
        const g = el('div', { class: 'seg' });
        for (const [v, l] of s.options) { const b = el('button', { class: t.o[s.key] === v ? 'on' : '' }, l); b.onclick = () => { set(v); g.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); }; g.append(b); }
        bar.append(el('div', { class: 'opt' }, s.label ? el('span', {}, s.label) : null, g));
      } else if (s.type === 'button') bar.append(el('button', { class: 'btn' + (s.primary ? ' primary' : ''), onclick: s.action }, s.label));
      else if (s.type === 'hint') bar.append(el('span', { class: 'hint' }, s.label));
      else if (s.type === 'transformFields') bar.append(UI.transformFields());
      else if (s.type === 'alignButtons') bar.append(el('div', { class: 'seg icons' }, [['left', 'alignL'], ['hcenter', 'alignCH'], ['right', 'alignR'], ['top', 'alignT'], ['vcenter', 'alignCV'], ['bottom', 'alignB']].map(([a, ic]) => el('button', { title: 'Align ' + a, html: K.icon(ic, 16), onclick: () => app().run('align', a) }))));
    }
  };
  UI.transformFields = () => {
    const wrap = el('div', { class: 'opt tf', id: 'tf' });
    const f = (k, label, unit) => { const i = el('input', { type: 'number', class: 'num wide', 'data-k': k, step: k === 'rot' ? 0.1 : 1 }); i.onchange = () => UI.applyTransformField(k, +i.value); return el('label', {}, el('span', {}, label), i, unit ? el('em', {}, unit) : null); };
    wrap.append(f('x', 'X'), f('y', 'Y'), f('w', 'W', '%'), f('h', 'H', '%'), f('rot', '∠', '°'));
    wrap.append(el('button', { class: 'icon-btn', title: 'Flip horizontal', html: K.icon('flipH', 16), onclick: () => app().run('flipLayer', 'h') }), el('button', { class: 'icon-btn', title: 'Flip vertical', html: K.icon('flipV', 16), onclick: () => app().run('flipLayer', 'v') }));
    setTimeout(UI.updateTransformFields, 0);
    return wrap;
  };
  UI.updateTransformFields = () => {
    const w = document.getElementById('tf'); if (!w) return; const L = doc() && doc().active;
    const inputs = w.querySelectorAll('input'); const ok = L && (L.type === 'smart' || L.type === 'text' || L.type === 'pixel');
    inputs.forEach((i) => { i.disabled = !ok; });
    if (!ok) return;
    let vals;
    if (L.t) vals = { x: Math.round(L.t.x), y: Math.round(L.t.y), w: +(Math.abs(L.t.sx) * 100).toFixed(1), h: +(Math.abs(L.t.sy) * 100).toFixed(1), rot: +(L.t.rot * 180 / Math.PI).toFixed(1) };
    else { const b = K.Layers.contentBounds(L) || { x: L.x, y: L.y, w: 0, h: 0 }; vals = { x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2), w: 100, h: 100, rot: 0 }; }
    inputs.forEach((i) => { if (document.activeElement !== i) i.value = vals[i.dataset.k]; });
  };
  UI.applyTransformField = (k, v) => {
    const d = doc(), L = d.active; if (!L || L.locked) return;
    if (L.type === 'pixel') d.toSmart(L); if (!L.t) return;
    if (k === 'x') L.t.x = v; else if (k === 'y') L.t.y = v;
    const keep = K.tools.move.o.constrain !== false;
    if (k === 'w') { L.t.sx = Math.sign(L.t.sx || 1) * v / 100; if (keep) L.t.sy = Math.sign(L.t.sy || 1) * v / 100; }
    else if (k === 'h') { L.t.sy = Math.sign(L.t.sy || 1) * v / 100; if (keep) L.t.sx = Math.sign(L.t.sx || 1) * v / 100; }
    else if (k === 'rot') L.t.rot = v * Math.PI / 180;
    d.touch(L); d.push('Transform'); app().view.requestRender(); UI.updateTransformFields();
  };

  // ---------- status ----------
  UI.updateStatus = () => {
    const d = doc(), s = $('#status');
    if (!d) { s.innerHTML = '<span>No document</span>'; return; }
    const zoom = Math.round(d.view.zoom * 1000) / 10;
    const pos = app().view.cursorPos;
    s.innerHTML = '';
    const z = el('input', { class: 'zoom-in', value: zoom + '%' }); z.onchange = () => { const v = parseFloat(z.value); if (v > 0) app().view.setZoom(v / 100); };
    const u = app().view.unit(), f = (v) => U.fmtUnit(v, u, d.ppi, false);
    const size = el('span', { class: 'clickable', title: 'Image Size…' }, `${d.w} × ${d.h} px` + (u === 'px' ? `  ·  ${d.ppi} ppi` : `  ·  ${f(d.w)} × ${f(d.h)} ${u} at ${d.ppi} ppi`));
    size.onclick = () => app().run('imageSize');
    const unitBtn = el('span', { class: 'clickable', title: 'Ruler units' }, u);
    unitBtn.onclick = (e) => UI.contextMenu(e.clientX, e.clientY - 150, [['px', 'Pixels'], ['mm', 'Millimetres'], ['cm', 'Centimetres'], ['in', 'Inches'], ['pt', 'Points']].map(([k, l]) => [(k === u ? '✓ ' : '   ') + l, 'setUnits', k]));
    s.append(...[z, size, el('span', {}, `${d.layers.length} layer${d.layers.length === 1 ? '' : 's'}`),
      pos ? el('span', {}, `X ${f(pos[0] - d.origin[0])}  Y ${f(pos[1] - d.origin[1])}`) : null, unitBtn,
      d.sel ? el('span', {}, `Selection ${f(d.sel.bounds.w)} × ${f(d.sel.bounds.h)} ${u}`) : null,
      el('span', { class: 'extra' }, UI._extra || '')].filter(Boolean));
  };
  UI.setStatusExtra = (t) => { UI._extra = t; UI.updateStatus(); };

  // ---------- tabs (documents) ----------
  UI.refreshTabs = () => {
    const tabs = $('#tabs'); tabs.innerHTML = '';
    for (const d of app().docs) {
      const t = el('div', { class: 'tab' + (d === doc() ? ' on' : ''), title: d.path || d.name },
        el('span', {}, (d.modified ? '• ' : '') + d.name),
        el('button', { class: 'x', html: K.icon('close', 12), onclick: (e) => { e.stopPropagation(); app().closeDoc(d); } }));
      t.onclick = () => app().switchDoc(d); tabs.append(t);
    }
    const title = doc() ? `${doc().name} @ ${Math.round(doc().view.zoom * 100)}% — Forged` : 'Forged';
    document.title = title; if (window.native) window.native.setTitle(title);
  };

  // ---------- photo bin ----------
  UI.refreshBin = U.debounce(() => {
    const bin = $('#bin-items'); bin.innerHTML = '';
    for (const d of app().docs) {
      const c = U.canvas(1, 1); const comp = d.composite(); const s = Math.min(1, 120 / Math.max(comp.width, comp.height));
      const th = U.resample(comp, comp.width * s, comp.height * s);
      const item = el('div', { class: 'bin-item' + (d === doc() ? ' on' : ''), draggable: 'true', title: `${d.name} — drag onto the canvas to place it as a layer` }, th, el('span', {}, d.name));
      item.onclick = () => app().switchDoc(d);
      item.ondragstart = (e) => { e.dataTransfer.setData('application/x-forged-doc', d.id); e.dataTransfer.effectAllowed = 'copy'; };
      bin.append(item); void c;
    }
    bin.append(el('button', { class: 'bin-add', title: 'Open photos', html: K.icon('plus', 22), onclick: () => app().run('open') }));
  }, 250);

  // ---------- panels ----------
  UI.buildPanels = () => {
    const p = $('#panels'); p.innerHTML = '';
    const info = el('section', { class: 'panel info' },
      el('header', {}, 'Navigator & Histogram'),
      el('div', { class: 'nav-wrap' }, el('canvas', { id: 'nav', width: 260, height: 150 })),
      el('canvas', { id: 'histo', width: 260, height: 70 }),
      el('div', { class: 'pixel-info', id: 'pixel-info' }, '—'));
    const tabsBar = el('nav', { class: 'ptabs' });
    const body = el('div', { class: 'pbody' });
    const tabs = [['layers', 'Layers'], ['quick', 'Adjust'], ['effects', 'Effects'], ['history', 'History']];
    UI.ptab = UI.ptab || 'layers';
    for (const [id, label] of tabs) {
      const b = el('button', { class: UI.ptab === id ? 'on' : '', 'data-tab': id }, label);
      b.onclick = () => { UI.ptab = id; tabsBar.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.tab === id)); UI.renderPanel(); };
      tabsBar.append(b);
    }
    p.append(info, el('section', { class: 'panel main' }, tabsBar, body));
    UI.renderPanel();
    const nav = $('#nav');
    const navMove = (e) => {
      const d = doc(); if (!d) return; const r = nav.getBoundingClientRect(), s = UI._navScale || 1, ox = UI._navOx || 0, oy = UI._navOy || 0;
      const dx = (e.clientX - r.left - ox) / s, dy = (e.clientY - r.top - oy) / s, v = app().view;
      d.view.panX = v.w / 2 - dx * d.view.zoom; d.view.panY = v.h / 2 - dy * d.view.zoom; v.requestRender();
    };
    nav.onpointerdown = (e) => { nav.setPointerCapture(e.pointerId); navMove(e); nav.onpointermove = navMove; };
    nav.onpointerup = () => { nav.onpointermove = null; };
  };
  UI.renderPanel = () => {
    const body = document.querySelector('#panels .pbody'); if (!body) return; body.innerHTML = '';
    if (!doc()) { body.append(el('div', { class: 'empty' }, 'Open a photo to begin')); return; }
    if (UI.ptab === 'layers') UI.renderLayers(body);
    else if (UI.ptab === 'quick') UI.renderQuick(body);
    else if (UI.ptab === 'effects') UI.renderEffects(body);
    else if (UI.ptab === 'history') UI.renderHistory(body);
  };
  UI.refreshLayers = U.rafThrottle(() => { if (UI.ptab === 'layers') UI.renderPanel(); UI.updateStatus(); UI.updateTransformFields(); });
  UI.refreshAll = () => { UI.renderPanel(); UI.refreshTabs(); UI.refreshBin(); UI.updateStatus(); UI.updateInfo(); app().view.requestRender(); };

  function layerThumb(d, L) {
    const c = U.canvas(44, 34), x = U.ctx(c);
    if (L.type === 'adjust') { x.fillStyle = '#3a3b40'; x.fillRect(0, 0, 44, 34); x.translate(10, 5); x.fillStyle = '#ddd'; x.font = '20px sans-serif'; x.fillText('◐', 2, 20); return c; }
    const s = Math.min(44 / d.w, 34 / d.h), w = d.w * s, h = d.h * s, ox = (44 - w) / 2, oy = (34 - h) / 2;
    for (let yy = 0; yy < 34; yy += 5) for (let xx = 0; xx < 44; xx += 5) { x.fillStyle = ((xx + yy) / 5) % 2 ? '#bbb' : '#fff'; x.fillRect(xx, yy, 5, 5); }
    const rc = U.canvas(d.w, d.h); K.Layers.drawContent(U.ctx(rc), L, d);
    x.imageSmoothingQuality = 'high'; x.drawImage(rc, ox, oy, w, h);
    return c;
  }
  function maskThumb(d, L) {
    const c = U.canvas(44, 34), x = U.ctx(c); x.fillStyle = '#000'; x.fillRect(0, 0, 44, 34);
    const s = Math.min(44 / d.w, 34 / d.h), w = d.w * s, h = d.h * s; x.drawImage(L.mask, (44 - w) / 2, (34 - h) / 2, w, h); return c;
  }

  UI.renderLayers = (body) => {
    const d = doc(), A = d.active;
    // top controls
    const blend = el('select', { disabled: !A }, Object.entries(K.Layers.BLEND_NAMES).map(([v, l]) => el('option', { value: v, selected: A && A.blend === v }, l)));
    blend.onchange = () => { A.blend = blend.value; d.changed(); d.push('Blend Mode'); app().view.requestRender(); };
    const op = sliderControl('Opacity', A ? Math.round(A.opacity * 100) : 100, 0, 100, 1, '%', (v) => { if (!A) return; A.opacity = v / 100; d.dirty = true; app().view.requestRender(); }, () => { d.push('Opacity'); UI.refreshBin(); });
    const lock = el('button', { class: 'icon-btn' + (A && A.locked ? ' on' : ''), title: 'Lock layer', html: K.icon(A && A.locked ? 'lock' : 'unlock', 15), onclick: () => { if (!A) return; A.locked = !A.locked; d.push(A.locked ? 'Lock Layer' : 'Unlock Layer'); UI.renderPanel(); } });
    body.append(el('div', { class: 'layer-top' }, blend, lock), el('div', { class: 'layer-top' }, op));
    // list (top-most first)
    const list = el('div', { class: 'layer-list' });
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const L = d.layers[i];
      const eye = el('button', { class: 'eye', title: 'Show/hide', html: K.icon(L.visible ? 'eye' : 'eyeOff', 15) });
      eye.onclick = (e) => {
        e.stopPropagation();
        if (e.altKey) { const solo = d.layers.every((o) => o === L || !o.visible); d.layers.forEach((o) => { o.visible = solo ? true : o === L; }); }
        else L.visible = !L.visible;
        d.changed(); d.push(L.visible ? 'Show Layer' : 'Hide Layer'); app().view.requestRender();
      };
      const th = layerThumb(d, L); th.className = 'thumb' + (A === L && !app().editMask ? ' sel' : '');
      th.onclick = (e) => { e.stopPropagation(); app().editMask = false; d.setActive(L); UI.renderPanel(); };
      const parts = [eye, L.clip ? el('span', { class: 'clip-ind', html: K.icon('clip', 13) }) : null, th];
      if (L.mask) {
        const mt = maskThumb(d, L); mt.className = 'thumb mask' + (A === L && app().editMask ? ' sel' : '') + (L.maskOn ? '' : ' off');
        mt.title = 'Layer mask — click to edit, Shift-click to disable';
        mt.onclick = (e) => { e.stopPropagation(); if (e.shiftKey) { L.maskOn = !L.maskOn; d.touch(L); d.push(L.maskOn ? 'Enable Mask' : 'Disable Mask'); } else { d.setActive(L); app().editMask = true; } UI.renderPanel(); app().view.requestRender(); };
        parts.push(mt);
      }
      const typeTag = { smart: 'Photo', text: 'Text', adjust: 'Adjust', fill: 'Fill', pixel: '' }[L.type];
      const name = el('div', { class: 'lname' }, el('span', {}, L.name), el('small', {}, [typeTag, L.style ? 'fx' : '', L.locked ? 'locked' : ''].filter(Boolean).join(' · ')));
      name.ondblclick = (e) => {
        e.stopPropagation();
        if (L.type === 'text' && e.altKey) { app().setTool('text'); K.tools.text.edit(L); return; }
        const inp = el('input', { value: L.name, class: 'rename' });
        name.replaceWith(inp); inp.focus(); inp.select();
        const done = () => { if (inp.value.trim()) { L.name = inp.value.trim(); d.push('Rename Layer'); } UI.renderPanel(); };
        inp.onblur = done; inp.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.value = ''; inp.blur(); } };
      };
      const row = el('div', { class: 'layer' + (A === L ? ' active' : '') + (L.visible ? '' : ' hidden'), draggable: 'true', 'data-id': L.id }, ...parts, name);
      row.onclick = () => { if (A !== L) app().editMask = false; d.setActive(L); UI.renderPanel(); UI.updateTransformFields(); };
      row.ondragstart = (e) => { e.dataTransfer.setData('text/forged-layer', L.id); row.classList.add('dragging'); };
      row.ondragend = () => row.classList.remove('dragging');
      row.ondragover = (e) => { e.preventDefault(); row.classList.add('drop'); };
      row.ondragleave = () => row.classList.remove('drop');
      row.ondrop = (e) => {
        e.preventDefault(); row.classList.remove('drop');
        const id = e.dataTransfer.getData('text/forged-layer'); const M = d.layers.find((x) => x.id === id); if (!M || M === L) return;
        d.layers.splice(d.layers.indexOf(M), 1); d.layers.splice(d.layers.indexOf(L) + 1, 0, M); d.changed(); d.push('Reorder Layers'); UI.renderPanel(); app().view.requestRender();
      };
      row.oncontextmenu = (e) => { e.preventDefault(); d.setActive(L); UI.contextMenu(e.clientX, e.clientY, [
        ['Duplicate Layer', 'dupLayer'], ['Delete Layer', 'deleteLayer'], ['Rename…', () => name.ondblclick(new MouseEvent('dblclick'))], null,
        [L.mask ? 'Delete Layer Mask' : 'Add Layer Mask', L.mask ? 'deleteMask' : 'addMask'], ['Clipping Mask (toggle)', 'clip'], ['Rasterize Layer', 'rasterize'], ['Select Layer Pixels', 'selFromLayer'], null,
        ['Drop Shadow…', 'layerStyle', 'shadow'], ['Outer Glow…', 'layerStyle', 'glow'], ['Stroke…', 'layerStyle', 'stroke'], ['Clear Layer Style', 'layerStyle', 'clear'], null,
        ['Merge Down', 'mergeDown'], ['Merge Visible', 'mergeVisible'], ['Flatten Image', 'flatten']]); };
      list.append(row);
    }
    body.append(list);
    // action bar
    const adjMenu = (e) => UI.contextMenu(e.clientX, e.clientY - 300, Object.keys(K.Adjust.defs).filter((k) => !['look', 'invert', 'desaturate'].includes(k)).map((k) => [K.Adjust.defs[k].title, 'newAdjLayer', k]).concat([['Invert', 'newAdjLayer', 'invert']]));
    body.append(el('div', { class: 'layer-actions' },
      el('button', { title: 'New layer', html: K.icon('plus', 16), onclick: () => app().run('newLayer') }),
      el('button', { title: 'New adjustment layer', html: K.icon('adjust', 16), onclick: adjMenu }),
      el('button', { title: 'New fill layer', html: K.icon('fill', 16), onclick: () => app().run('newFillLayer') }),
      el('button', { title: 'Add layer mask', html: K.icon('mask', 16), onclick: () => app().run('addMask') }),
      el('button', { title: 'Clipping mask', html: K.icon('clip', 16), onclick: () => app().run('clip') }),
      el('button', { title: 'Layer style', html: K.icon('fx', 16), onclick: (e) => UI.contextMenu(e.clientX, e.clientY - 120, [['Drop Shadow…', 'layerStyle', 'shadow'], ['Outer Glow…', 'layerStyle', 'glow'], ['Stroke…', 'layerStyle', 'stroke'], ['Clear Layer Style', 'layerStyle', 'clear']]) }),
      el('button', { title: 'Duplicate layer', html: K.icon('copy', 16), onclick: () => app().run('dupLayer') }),
      el('button', { title: 'Move up', html: K.icon('up', 16), onclick: () => app().run('arrange', 'up') }),
      el('button', { title: 'Move down', html: K.icon('down', 16), onclick: () => app().run('arrange', 'down') }),
      el('button', { title: 'Delete layer', html: K.icon('trash', 16), onclick: () => app().run('deleteLayer') })));
    // properties for adjustment / fill / text layers
    if (A && A.type === 'adjust') body.append(UI.adjustProps(A));
    if (A && A.type === 'fill') {
      const c = el('input', { type: 'color', value: A.color }); c.oninput = () => { A.color = c.value; d.touch(A); app().view.requestRender(); }; c.onchange = () => d.push('Fill Colour');
      body.append(el('div', { class: 'props' }, el('h4', {}, 'Fill colour'), c));
    }
    if (A && A.type === 'text') body.append(el('div', { class: 'props' }, el('h4', {}, 'Text layer'), el('p', { class: 'hint' }, 'Use the Type tool (T) and click the text to edit it. Style changes in the options bar apply to the selected text layer.'), el('button', { class: 'btn', onclick: () => { app().setTool('text'); K.tools.text.edit(A); } }, 'Edit text')));
  };

  UI.adjustProps = (A) => {
    const d = doc(), def = K.Adjust.defs[A.adj.kind], wrap = el('div', { class: 'props' }, el('h4', {}, def.title));
    const update = () => { d.touch(A); app().view.requestRender(); };
    const commit = U.debounce(() => { d.push('Edit ' + def.title); UI.refreshBin(); UI.updateInfo(); }, 300);
    UI.controls(wrap, def, A.adj.params, () => { update(); commit(); });
    if (def.curves) wrap.append(UI.curvesEditor(A.adj.params, () => { update(); commit(); }));
    return wrap;
  };

  UI.controls = (wrap, def, params, onChange) => {
    for (const c of def.controls) {
      if (c.type === 'range') wrap.append(sliderControl(c.label, params[c.key], c.min, c.max, c.step, '', (v) => { params[c.key] = v; onChange(); }));
      else if (c.type === 'check') { const i = el('input', { type: 'checkbox' }); i.checked = !!params[c.key]; i.onchange = () => { params[c.key] = i.checked; onChange(); }; wrap.append(el('label', { class: 'opt check' }, i, el('span', {}, c.label))); }
      else if (c.type === 'color') { const i = el('input', { type: 'color', value: params[c.key] }); i.oninput = () => { params[c.key] = i.value; onChange(); }; wrap.append(el('label', { class: 'opt colorrow' }, el('span', {}, c.label), i)); }
    }
  };

  // Curves editor
  UI.curvesEditor = (params, onChange) => {
    const size = 240, c = el('canvas', { width: size, height: size, class: 'curves' });
    let ch = 'rgb'; const wrap = el('div', { class: 'curves-wrap' });
    const chSel = el('div', { class: 'seg' }, [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']].map(([v, l]) => el('button', { class: v === ch ? 'on' : '', onclick: (e) => { ch = v; chSel.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); draw(); } }, l)));
    const presets = el('select', {}, [['', 'Presets…'], ['contrast', 'Increase contrast'], ['soft', 'Soft contrast'], ['brighten', 'Brighten'], ['darken', 'Darken'], ['fade', 'Faded matte'], ['reset', 'Reset']].map(([v, l]) => el('option', { value: v }, l)));
    presets.onchange = () => {
      const P = { contrast: [[0, 0], [64, 48], [192, 208], [255, 255]], soft: [[0, 0], [64, 58], [192, 198], [255, 255]], brighten: [[0, 0], [128, 160], [255, 255]], darken: [[0, 0], [128, 100], [255, 255]], fade: [[0, 36], [80, 78], [200, 210], [255, 240]], reset: [[0, 0], [255, 255]] }[presets.value];
      if (P) { params.points[ch] = P.map((p) => p.slice()); draw(); onChange(); } presets.value = '';
    };
    const x = c.getContext('2d');
    const histo = doc() ? K.Adjust.histogram(U.getData(U.resample(doc().composite(), Math.min(400, doc().w), Math.min(400, doc().h) * doc().h / Math.max(doc().h, 1)))) : null;
    const draw = () => {
      x.fillStyle = '#1c1d20'; x.fillRect(0, 0, size, size);
      if (histo) { const h = histo.l; let mx = 0; for (let i = 0; i < 256; i++) mx = Math.max(mx, h[i]); x.fillStyle = '#34363b'; for (let i = 0; i < 256; i++) { const hh = (h[i] / mx) * size * 0.9; x.fillRect(i * size / 256, size - hh, size / 256 + 0.5, hh); } }
      x.strokeStyle = '#333'; x.beginPath(); for (let i = 1; i < 4; i++) { x.moveTo(i * size / 4, 0); x.lineTo(i * size / 4, size); x.moveTo(0, i * size / 4); x.lineTo(size, i * size / 4); } x.stroke();
      x.strokeStyle = '#555'; x.beginPath(); x.moveTo(0, size); x.lineTo(size, 0); x.stroke();
      const lut = K.Adjust.curveLUT(params.points[ch]);
      x.strokeStyle = { rgb: '#eee', r: '#ff5a5a', g: '#5aff7a', b: '#5aa0ff' }[ch]; x.lineWidth = 2; x.beginPath();
      for (let i = 0; i < 256; i++) { const X = i * size / 255, Y = size - lut[i] * size / 255; i ? x.lineTo(X, Y) : x.moveTo(X, Y); } x.stroke(); x.lineWidth = 1;
      x.fillStyle = '#fff'; for (const [px, py] of params.points[ch]) { x.beginPath(); x.arc(px * size / 255, size - py * size / 255, 4, 0, Math.PI * 2); x.fill(); }
    };
    let dragI = -1;
    const pt = (e) => { const r = c.getBoundingClientRect(); return [U.clamp(Math.round((e.clientX - r.left) / r.width * 255), 0, 255), U.clamp(Math.round((1 - (e.clientY - r.top) / r.height) * 255), 0, 255)]; };
    c.onpointerdown = (e) => {
      c.setPointerCapture(e.pointerId); const p = pt(e), pts = params.points[ch];
      dragI = pts.findIndex(([a, b]) => Math.hypot(a - p[0], b - p[1]) < 10);
      if (dragI < 0) { pts.push(p); pts.sort((a, b) => a[0] - b[0]); dragI = pts.findIndex((q) => q === p); }
      draw(); onChange();
    };
    c.onpointermove = (e) => {
      if (dragI < 0) return; const p = pt(e), pts = params.points[ch];
      const isEnd = dragI === 0 || dragI === pts.length - 1;
      const lo = dragI > 0 ? pts[dragI - 1][0] + 1 : 0, hi = dragI < pts.length - 1 ? pts[dragI + 1][0] - 1 : 255;
      pts[dragI] = [isEnd && pts.length > 1 ? U.clamp(p[0], lo, hi) : U.clamp(p[0], lo, hi), p[1]];
      draw(); onChange();
    };
    c.onpointerup = () => { dragI = -1; };
    c.ondblclick = (e) => { const p = pt(e), pts = params.points[ch]; const i = pts.findIndex(([a, b]) => Math.hypot(a - p[0], b - p[1]) < 10); if (i > 0 && i < pts.length - 1) { pts.splice(i, 1); draw(); onChange(); } };
    draw();
    wrap.append(el('div', { class: 'row' }, chSel, presets), c, el('p', { class: 'hint' }, 'Click to add a point, drag to shape the curve, double-click a point to remove it.'));
    return wrap;
  };

  // Quick fix panel
  UI.renderQuick = (body) => {
    const d = doc();
    body.append(el('div', { class: 'quick-auto' },
      el('button', { class: 'btn primary', html: K.icon('sparkle', 15) + ' Auto Smart Fix', onclick: () => app().run('auto', 'smartfix') }),
      el('button', { class: 'btn', onclick: () => app().run('auto', 'levels') }, 'Auto Levels'),
      el('button', { class: 'btn', onclick: () => app().run('auto', 'contrast') }, 'Auto Contrast'),
      el('button', { class: 'btn', onclick: () => app().run('auto', 'color') }, 'Auto Colour'),
      el('button', { class: 'btn', onclick: () => app().run('filterQuick', 'unsharp') }, 'Auto Sharpen')));
    let L = d.layers.find((l) => l.type === 'adjust' && l.adj.kind === 'quick');
    const params = L ? L.adj.params : K.Adjust.defaults('quick');
    const ensure = () => { if (!L) { L = K.Layers.newLayer({ type: 'adjust', name: 'Quick Fix', adj: { kind: 'quick', params } }); d.addLayer(L, d.layers.length); UI.refreshBin(); } return L; };
    const commit = U.debounce(() => { d.push('Quick Fix'); UI.refreshBin(); UI.updateInfo(); }, 400);
    const groups = [['Light', ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks']], ['Colour', ['temperature', 'tint', 'vibrance', 'saturation']], ['Finish', ['fade']]];
    const def = K.Adjust.defs.quick;
    for (const [title, keys] of groups) {
      const sec = el('div', { class: 'props' }, el('h4', {}, title));
      for (const k of keys) { const c = def.controls.find((x) => x.key === k); sec.append(sliderControl(c.label, params[k], c.min, c.max, c.step, '', (v) => { params[k] = v; const A = ensure(); d.touch(A); app().view.requestRender(); commit(); })); }
      body.append(sec);
    }
    body.append(el('div', { class: 'row end' },
      el('button', { class: 'btn', onclick: () => { if (L) { d.removeLayer(L); d.push('Reset Quick Fix'); UI.renderPanel(); app().view.requestRender(); } } }, 'Reset'),
      el('button', { class: 'btn', onclick: () => { if (L) { app().run('mergeAdjust', L.id); } } }, 'Apply to photo')));
    body.append(el('p', { class: 'hint' }, 'Quick Fix changes live on a non-destructive adjustment layer. You can hide or delete it at any time in Layers.'));
  };

  // Effects (looks) panel with live thumbnails
  UI.renderEffects = (body) => {
    const d = doc(); const grid = el('div', { class: 'fx-grid' });
    const comp = d.composite(), s = Math.min(1, 110 / Math.max(comp.width, comp.height)), small = U.getData(U.resample(comp, comp.width * s, comp.height * s));
    for (const [name, L] of Object.entries(K.Adjust.looks)) {
      const data = U.copyData(small); K.Adjust.apply('look', { name, amount: 100 }, data);
      const c = U.fromData(data);
      const b = el('button', { class: 'fx', title: L.label }, c, el('span', {}, L.label));
      b.onclick = () => { const A = K.Layers.newLayer({ type: 'adjust', name: L.label, adj: { kind: 'look', params: { name, amount: 100 } } }); d.addLayer(A, d.layers.length); d.push('Effect: ' + L.label); UI.ptab = 'layers'; UI.buildPanels(); app().view.requestRender(); UI.toast(`${L.label} added as an adjustment layer — tweak strength in Layers`); };
      grid.append(b);
    }
    body.append(el('p', { class: 'hint' }, 'Click a look to add it as an adjustment layer.'), grid);
    const filters = el('div', { class: 'filter-list' });
    const fl = [['gaussian', 'Soft Focus'], ['tiltShift', 'Miniature (Tilt-Shift)'], ['vignette', 'Vignette'], ['grain', 'Film Grain'], ['sketch', 'Pencil Sketch'], ['cartoon', 'Cartoon'], ['watercolor', 'Watercolour'], ['oilPaint', 'Oil Paint'], ['halftone', 'Halftone'], ['glowEdges', 'Neon Edges'], ['flare', 'Lens Flare'], ['zoomBlur', 'Zoom Burst']];
    for (const [k, l] of fl) filters.append(el('button', { class: 'btn', onclick: () => app().run('filter', k) }, l));
    body.append(el('h4', { class: 'sub' }, 'Artistic filters'), filters);
  };

  UI.renderHistory = (body) => {
    const d = doc(); const list = el('div', { class: 'history' });
    d.history.forEach((h, i) => {
      const r = el('div', { class: 'hstep' + (i === d.hIndex ? ' on' : '') + (i > d.hIndex ? ' future' : '') }, el('span', {}, h.label), el('small', {}, new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
      r.onclick = () => { d.jump(i); UI.refreshAll(); }; list.append(r);
    });
    body.append(list); setTimeout(() => { const on = list.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' }); }, 0);
  };

  // Navigator & histogram
  UI.updateInfo = U.debounce(() => {
    const d = doc(), nav = $('#nav'), hc = $('#histo'); if (!nav || !hc) return;
    const nx = nav.getContext('2d'); nx.fillStyle = '#1c1d20'; nx.fillRect(0, 0, nav.width, nav.height);
    const hx = hc.getContext('2d'); hx.fillStyle = '#1c1d20'; hx.fillRect(0, 0, hc.width, hc.height);
    if (!d) return;
    const comp = d.composite(), s = Math.min((nav.width - 10) / d.w, (nav.height - 10) / d.h), w = d.w * s, h = d.h * s, ox = (nav.width - w) / 2, oy = (nav.height - h) / 2;
    UI._navScale = s * nav.getBoundingClientRect().width / nav.width; UI._navOx = ox * nav.getBoundingClientRect().width / nav.width; UI._navOy = oy * nav.getBoundingClientRect().height / nav.height;
    const small = U.resample(comp, Math.max(1, w), Math.max(1, h)); nx.drawImage(small, ox, oy);
    const v = app().view, [x0, y0] = v.toDoc(0, 0), [x1, y1] = v.toDoc(v.w, v.h);
    nx.strokeStyle = '#ff3b30'; nx.lineWidth = 1.5; nx.strokeRect(ox + x0 * s, oy + y0 * s, (x1 - x0) * s, (y1 - y0) * s);
    const hd = K.Adjust.histogram(U.getData(small.width * small.height < 2000 ? U.resample(comp, Math.min(d.w, 300), Math.min(d.h, 300 * d.h / d.w)) : small));
    let mx = 1; for (let i = 2; i < 254; i++) mx = Math.max(mx, hd.r[i], hd.g[i], hd.b[i]);
    hx.globalCompositeOperation = 'screen';
    for (const [arr, col] of [[hd.r, '#ff4040'], [hd.g, '#40ff60'], [hd.b, '#4080ff']]) {
      hx.fillStyle = col; hx.globalAlpha = 0.7; hx.beginPath(); hx.moveTo(0, hc.height);
      for (let i = 0; i < 256; i++) hx.lineTo(i * hc.width / 255, hc.height - Math.min(1, arr[i] / mx) * (hc.height - 4));
      hx.lineTo(hc.width, hc.height); hx.closePath(); hx.fill();
    }
    hx.globalAlpha = 1; hx.globalCompositeOperation = 'source-over';
  }, 200);
  UI.updatePixelInfo = (p) => {
    const d = doc(), e = $('#pixel-info'); if (!e || !d || !p) return;
    const x = Math.floor(p[0]), y = Math.floor(p[1]);
    if (x < 0 || y < 0 || x >= d.w || y >= d.h) { e.textContent = '—'; return; }
    const px = U.ctx(d.composite()).getImageData(x, y, 1, 1).data;
    e.innerHTML = `<i style="background:rgb(${px[0]},${px[1]},${px[2]})"></i> R ${px[0]}  G ${px[1]}  B ${px[2]}  <b>${U.rgbToHex(px[0], px[1], px[2])}</b>`;
  };

  // ---------- context menu ----------
  UI.contextMenu = (x, y, items) => {
    UI.closeFlyouts();
    const m = el('div', { class: 'flyout menu', style: { left: x + 'px', top: Math.max(8, y) + 'px' } });
    for (const it of items) {
      if (!it) { m.append(el('hr')); continue; }
      const [label, cmd, arg] = it;
      m.append(el('button', { onclick: () => { UI.closeFlyouts(); typeof cmd === 'function' ? cmd() : app().run(cmd, arg); } }, el('span', {}, label)));
    }
    document.body.append(m);
    const r = m.getBoundingClientRect(); if (r.bottom > window.innerHeight) m.style.top = Math.max(8, window.innerHeight - r.height - 8) + 'px'; if (r.right > window.innerWidth) m.style.left = (window.innerWidth - r.width - 8) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', UI._flyClose = (e) => { if (!m.contains(e.target)) UI.closeFlyouts(); }), 0);
  };

  // ---------- modal dialogs ----------
  UI.modal = ({ title, body, buttons = [['Cancel', false], ['OK', true]], width = 380, onClose }) => new Promise((resolve) => {
    const bg = el('div', { class: 'modal-bg' }), box = el('div', { class: 'modal', style: { width: width + 'px' } });
    const close = (v) => { bg.remove(); if (onClose) onClose(v); resolve(v); };
    box.append(el('header', {}, title), el('div', { class: 'mbody' }, body));
    const foot = el('footer', {});
    for (const [label, val, cls] of buttons) foot.append(el('button', { class: 'btn' + (val === true || cls === 'primary' ? ' primary' : ''), onclick: () => close(val) }, label));
    box.append(foot); bg.append(box); $('#modal-root').append(bg);
    box.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Escape') close(false); if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'SELECT') { e.preventDefault(); close(buttons[buttons.length - 1][1]); } };
    setTimeout(() => { const f = box.querySelector('input[type=number]:not(:disabled), input[type=text]') || box.querySelector('select') || box.querySelector('button.primary'); if (f) f.focus(); }, 30);
  });

  // Parameter dialog with live preview on the layer
  UI.paramDialog = async ({ title, def, params, preview, onCancel, extra }) => {
    const body = el('div', { class: 'param-body' });
    const pv = el('label', { class: 'opt check' }, el('input', { type: 'checkbox', checked: true }), el('span', {}, 'Preview'));
    let previewOn = true;
    const run = U.debounce(() => { if (previewOn) preview(params); }, 60);
    pv.querySelector('input').onchange = (e) => { previewOn = e.target.checked; if (previewOn) preview(params); else onCancel(true); };
    if (def.histogram && doc()) { const hc = el('canvas', { width: 330, height: 80, class: 'mini-histo' }); body.append(hc); setTimeout(() => drawMiniHisto(hc), 0); }
    UI.controls(body, def, params, run);
    if (def.curves) body.append(UI.curvesEditor(params, run));
    if (extra) body.append(extra);
    const reset = el('button', { class: 'btn small', onclick: () => { Object.assign(params, def.kind && K.Adjust.defs[def.kind] === def ? K.Adjust.defaults(def.kind) : K.Filters.defaults(def.kind)); body.querySelectorAll('.opt, .curves-wrap').forEach((n) => n.remove()); UI.controls(body, def, params, run); if (def.curves) body.append(UI.curvesEditor(params, run)); run(); } }, 'Reset');
    body.append(el('div', { class: 'row' }, pv, reset));
    setTimeout(() => preview(params), 0);
    const ok = await UI.modal({ title, body, width: def.curves ? 400 : 380 });
    if (!ok) onCancel(); return ok;
  };
  function drawMiniHisto(hc) {
    const d = doc(), x = hc.getContext('2d'), comp = d.composite(), sm = U.resample(comp, Math.min(400, d.w), Math.max(1, Math.min(400, d.w) * d.h / d.w));
    const h = K.Adjust.histogram(U.getData(sm)).l; let mx = 1; for (let i = 1; i < 255; i++) mx = Math.max(mx, h[i]);
    x.fillStyle = '#1c1d20'; x.fillRect(0, 0, hc.width, hc.height); x.fillStyle = '#9aa0a6';
    for (let i = 0; i < 256; i++) { const hh = Math.min(1, h[i] / mx) * hc.height; x.fillRect(i * hc.width / 256, hc.height - hh, hc.width / 256 + 0.5, hh); }
  }

  // Simple form dialog: fields [{key,label,type,value,min,max,options}]
  UI.form = async (title, fields, okLabel = 'OK', width = 360) => {
    const body = el('div', { class: 'form' }), vals = {};
    for (const f of fields) {
      vals[f.key] = f.value;
      let inp;
      if (f.type === 'select') { inp = el('select', {}, f.options.map(([v, l]) => el('option', { value: v, selected: String(v) === String(f.value) }, l))); inp.onchange = () => { vals[f.key] = inp.value; f.onChange && f.onChange(inp.value, vals, body); }; }
      else if (f.type === 'check') { inp = el('input', { type: 'checkbox' }); inp.checked = !!f.value; inp.onchange = () => { vals[f.key] = inp.checked; f.onChange && f.onChange(inp.checked, vals, body); }; }
      else if (f.type === 'color') { inp = el('input', { type: 'color', value: f.value }); inp.oninput = () => { vals[f.key] = inp.value; }; }
      else if (f.type === 'range') { body.append(sliderControl(f.label, f.value, f.min, f.max, f.step, f.unit, (v) => { vals[f.key] = v; f.onChange && f.onChange(v, vals, body); })); continue; }
      else if (f.type === 'html') { body.append(f.node); continue; }
      else { inp = el('input', { type: f.type || 'text', value: f.value, min: f.min, max: f.max, step: f.step }); inp.oninput = () => { vals[f.key] = f.type === 'number' ? +inp.value : inp.value; f.onChange && f.onChange(vals[f.key], vals, body); }; }
      inp.dataset.key = f.key;
      body.append(el('label', { class: 'frow' + (f.type === 'check' ? ' check' : '') }, el('span', {}, f.label), inp, f.unit ? el('em', {}, f.unit) : null));
    }
    const ok = await UI.modal({ title, body, buttons: [['Cancel', false], [okLabel, true]], width });
    return ok ? vals : null;
  };

  K.UI = UI;
})(window.K);
