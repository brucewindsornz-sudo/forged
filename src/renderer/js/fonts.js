// Forged — local fonts: list, load on demand, and a searchable font picker
(() => {
  const K = (window.K = window.K || {});
  const BUILTIN = ['Helvetica Neue', 'Helvetica', 'Arial', 'Avenir Next', 'Futura', 'Gill Sans', 'Optima', 'Georgia', 'Times New Roman', 'Baskerville', 'Didot', 'Palatino', 'Hoefler Text', 'American Typewriter', 'Courier New', 'Menlo', 'Impact', 'Marker Felt', 'Chalkboard SE', 'Noteworthy', 'Snell Roundhand', 'Zapfino'];
  const F = (K.Fonts = {
    families: BUILTIN.map((f) => ({ family: f, styles: [] })), byName: new Map(), loaded: false,
    faces: new Map(), // ps -> 'loading' | 'ok' | 'fail'
    listeners: [],
  });
  const idx = () => { F.byName = new Map(F.families.map((g) => [g.family.toLowerCase(), g])); };
  idx();

  F.load = async (force) => {
    if (!window.native || !native.listFonts) return F.families;
    try {
      const list = await native.listFonts(force);
      if (list && list.length) { F.families = list; idx(); F.loaded = true; F.listeners.forEach((fn) => fn()); }
    } catch (e) { console.warn('Font scan failed', e); }
    return F.families;
  };
  F.onChange = (fn) => F.listeners.push(fn);
  F.family = (name) => F.byName.get(String(name || '').toLowerCase()) || null;
  F.styles = (name) => { const g = F.family(name); return g && g.styles.length ? g.styles : null; };
  F.defaultStyle = (name) => {
    const st = F.styles(name); if (!st) return null;
    return st.find((s) => /^(regular|roman|book|normal|medium)$/i.test(s.style) && !s.italic) || st.find((s) => !s.italic && s.weight === 400) || st.find((s) => !s.italic) || st[0];
  };
  const alias = (ps) => 'kf-' + ps;

  // Load a specific face on demand. Single-face files are read directly (always exact);
  // collections fall back to the system's PostScript-name lookup.
  F.ensure = (tp) => {
    if (!tp || !tp.ps) return true;
    const st = F.faces.get(tp.ps); if (st === 'ok') return true; if (st) return false;
    const g = F.family(tp.font); const face = g && g.styles.find((s) => s.ps === tp.ps); if (!face) { F.faces.set(tp.ps, 'fail'); return false; }
    F.faces.set(tp.ps, 'loading');
    const desc = { weight: String(face.weight || 400), style: face.italic ? 'italic' : 'normal' };
    (async () => {
      let ff = null;
      if (!face.collection && native.readFont) { try { ff = new FontFace(alias(face.ps), await native.readFont(face.file), desc); await ff.load(); } catch (e) { ff = null; } }
      if (!ff) { for (const n of [face.ps, face.full]) { if (!n) continue; try { ff = new FontFace(alias(face.ps), `local("${n.replace(/"/g, '')}")`, desc); await ff.load(); break; } catch (e) { ff = null; } } }
      if (ff) { document.fonts.add(ff); F.faces.set(face.ps, 'ok'); } else F.faces.set(face.ps, 'fail');
      F.refreshText(face.ps);
    })();
    return false;
  };
  F.refreshText = (ps) => {
    if (!K.app) return;
    for (const d of K.app.docs || []) {
      let hit = false;
      for (const L of d.layers) if (L.type === 'text' && L.tp && (!ps || L.tp.ps === ps)) { L._text = null; L._textKey = null; hit = true; }
      if (hit) { d.dirty = true; d.emit && d.emit('pixels'); }
    }
    if (K.app.view) K.app.view.requestRender();
    if (K.app.tool && K.app.tool.positionEditor && K.app.tool.editing) K.app.tool.positionEditor();
  };

  // CSS font string for a text layer's properties
  F.css = (tp, px) => {
    const weight = tp.bold ? 700 : (tp.weight || 400);
    const face = tp.ps ? (F.family(tp.font) || { styles: [] }).styles.find((s) => s.ps === tp.ps) : null;
    let fam = `"${tp.font}", -apple-system, sans-serif`;
    if (tp.ps && !tp.bold && (!face || !!face.italic === !!tp.italic) && F.ensure(tp)) fam = `"${alias(tp.ps)}", ` + fam;
    return `${tp.italic ? 'italic ' : ''}${weight} ${px}px ${fam}`;
  };

  // ---------- recent fonts ----------
  const RKEY = 'forged.recentFonts';
  F.recent = () => { try { return JSON.parse(localStorage.getItem(RKEY)) || []; } catch (e) { return []; } };
  F.addRecent = (f) => { const r = [f, ...F.recent().filter((x) => x !== f)].slice(0, 8); try { localStorage.setItem(RKEY, JSON.stringify(r)); } catch (e) { /* ignore */ } };

  // ---------- picker ----------
  const mk = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'style') Object.assign(e.style, v); else if (k.startsWith('on')) e[k] = v; else if (k === 'class') e.className = v; else e.setAttribute(k, v); } for (const c of kids.flat()) if (c != null) e.append(c); return e; };

  F.pickerButton = (current, onPick) => {
    const btn = mk('button', { class: 'font-btn', title: 'Font family (all fonts installed on this computer)' }, mk('span', { style: { fontFamily: `"${current}", -apple-system, sans-serif` } }, current), mk('i', {}, '▾'));
    btn.onclick = (e) => { e.stopPropagation(); F.openPicker(btn, current, onPick); };
    return btn;
  };

  F.openPicker = (anchor, current, onPick) => {
    F.closePicker();
    const r = anchor.getBoundingClientRect();
    const search = mk('input', { type: 'search', placeholder: `Search ${F.families.length} fonts`, spellcheck: 'false' });
    const list = mk('div', { class: 'font-list', tabindex: '-1' });
    const foot = mk('div', { class: 'font-foot' });
    const pop = mk('div', { class: 'font-pop', style: { left: Math.min(r.left, innerWidth - 340) + 'px', top: r.bottom + 4 + 'px', maxHeight: Math.max(240, innerHeight - r.bottom - 40) + 'px' } }, search, list, foot);
    document.body.append(pop); F._pop = pop;
    const io = new IntersectionObserver((es) => { for (const en of es) if (en.isIntersecting) { const n = en.target.querySelector('.fp'); if (n && !n.style.fontFamily) n.style.fontFamily = `"${en.target.dataset.f}", -apple-system, sans-serif`; io.unobserve(en.target); } }, { root: list, rootMargin: '200px' });
    let items = [], sel = -1;
    const row = (g, tag) => {
      const n = g.styles.length;
      const it = mk('div', { class: 'font-item' + (g.family === current ? ' cur' : ''), 'data-f': g.family }, mk('span', { class: 'fp' }, g.family), mk('em', {}, tag || (n > 1 ? `${n} styles` : '')));
      it.onmousedown = (e) => e.preventDefault();
      it.onclick = () => pick(g.family);
      io.observe(it); return it;
    };
    const render = () => {
      list.innerHTML = ''; items = []; const q = search.value.trim().toLowerCase();
      const words = q.split(/\s+/).filter(Boolean);
      const match = (g) => !words.length || words.every((w) => g.family.toLowerCase().includes(w) || g.styles.some((s) => s.style.toLowerCase().includes(w) || (s.ps || '').toLowerCase().includes(w)));
      if (!q) {
        const rec = F.recent().map(F.family).filter(Boolean);
        if (rec.length) { list.append(mk('div', { class: 'font-sec' }, 'Recent')); rec.forEach((g) => { const it = row(g); list.append(it); items.push(it); }); list.append(mk('div', { class: 'font-sec' }, 'All fonts')); }
      }
      const all = F.families.filter(match);
      const frag = document.createDocumentFragment(); all.forEach((g) => { const it = row(g); frag.append(it); items.push(it); }); list.append(frag);
      if (!all.length) list.append(mk('div', { class: 'font-empty' }, 'No fonts match'));
      foot.innerHTML = '';
      foot.append(mk('span', {}, F.loaded ? `${all.length} of ${F.families.length} families` : 'Reading your fonts…'));
      const rb = mk('button', { class: 'font-refresh', title: 'Look again for newly installed fonts' }, 'Refresh');
      rb.onmousedown = (e) => e.preventDefault();
      rb.onclick = async () => { rb.textContent = 'Refreshing…'; await F.load(true); if (F._pop === pop) { search.placeholder = `Search ${F.families.length} fonts`; render(); } };
      foot.append(rb);
      sel = Math.max(0, items.findIndex((i) => i.dataset.f === current)); if (!q && sel >= 0) mark(true); else { sel = 0; mark(false); }
    };
    const mark = (scroll) => { items.forEach((it, i) => it.classList.toggle('sel', i === sel)); if (scroll && items[sel]) items[sel].scrollIntoView({ block: 'center' }); };
    const pick = (f) => { F.addRecent(f); F.closePicker(); onPick(f); };
    search.oninput = render;
    search.onkeydown = (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); mark(false); items[sel] && items[sel].scrollIntoView({ block: 'nearest' }); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); mark(false); items[sel] && items[sel].scrollIntoView({ block: 'nearest' }); e.preventDefault(); }
      else if (e.key === 'Enter') { if (items[sel]) pick(items[sel].dataset.f); e.preventDefault(); }
      else if (e.key === 'Escape') { F.closePicker(); e.preventDefault(); }
      e.stopPropagation();
    };
    F._outside = (e) => { if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) F.closePicker(); };
    setTimeout(() => document.addEventListener('mousedown', F._outside, true), 0);
    F._io = io; F._rerender = render;
    render(); search.focus();
    if (!F.loaded) F.load().then(() => { if (F._pop === pop) { search.placeholder = `Search ${F.families.length} fonts`; render(); } });
  };
  F.closePicker = () => {
    if (F._pop) { F._pop.remove(); F._pop = null; }
    if (F._io) { F._io.disconnect(); F._io = null; }
    if (F._outside) { document.removeEventListener('mousedown', F._outside, true); F._outside = null; }
  };
})();
