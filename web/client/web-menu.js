// Forged Web — menu bar and keyboard shortcuts (mirrors the Mac app's menus in src/main.js)
(() => {
  'use strict';
  const W = window.ForgedWeb, isMac = window.native.isMac;
  const item = (label, cmd, accel, arg) => ({ label, cmd, accel, arg });
  const fn = (label, run, accel) => ({ label, run, accel });
  const sep = { sep: true };
  const sub = (label, items) => ({ label, items });
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});

  const MENUS = [
    sub('File', [
      item('New…', 'new', 'CmdOrCtrl+N'),
      item('Open…', 'open', 'CmdOrCtrl+O'),
      fn('Open from Library…', W.openLibrary, 'CmdOrCtrl+Shift+O'),
      item('Place Photo…', 'place', 'CmdOrCtrl+Shift+P'),
      fn('Place from Library…', W.placeFromLibrary),
      item('Photo Collage…', 'collage', 'CmdOrCtrl+Alt+N'),
      item('New from Clipboard', 'newFromClipboard'),
      sep,
      item('Save Project', 'save', 'CmdOrCtrl+S'),
      item('Save Project As…', 'saveAs', 'CmdOrCtrl+Shift+S'),
      item('Export…', 'export', 'CmdOrCtrl+Alt+Shift+S'),
      item('Convert Forged Projects…', 'convert'),
      fn('Convert Projects from Library…', W.convertFromLibrary),
      sep,
      item('Close Document', 'closeDoc', 'CmdOrCtrl+W'),
      ...(isMac ? [] : [sep, item('Preferences…', 'preferences', 'CmdOrCtrl+,')]),
    ]),
    sub('Edit', [
      item('Undo', 'undo', 'CmdOrCtrl+Z'),
      item('Redo', 'redo', 'CmdOrCtrl+Y'),
      { hidden: true, cmd: 'redo', accel: 'CmdOrCtrl+Shift+Z' },
      { hidden: true, cmd: 'undo', accel: 'CmdOrCtrl+Alt+Z' },
      sep,
      item('Cut', 'cut', 'CmdOrCtrl+X'),
      item('Copy', 'copy', 'CmdOrCtrl+C'),
      item('Copy Merged', 'copyMerged', 'CmdOrCtrl+Shift+C'),
      { label: 'Paste', cmd: 'paste', accel: 'CmdOrCtrl+V', passThrough: true }, // the paste event brings the system clipboard
      item('Delete', 'clearSel'),
      sep,
      item('Fill Selection…', 'fillSel'),
      item('Stroke Selection…', 'strokeSel'),
      item('Content-Aware Fill', 'contentFill'),
      sep,
      item('Free Transform', 'freeTransform', 'CmdOrCtrl+T'),
      ...(isMac ? [sep, item('Preferences…', 'preferences', 'CmdOrCtrl+,')] : []),
    ]),
    sub('Image', [
      sub('Rotate', [
        item('90° Right', 'rotate', null, 90), item('90° Left', 'rotate', null, -90), item('180°', 'rotate', null, 180),
        item('Custom / Straighten…', 'rotateCustom'),
        sep, item('Flip Horizontal', 'flipImage', null, 'h'), item('Flip Vertical', 'flipImage', null, 'v'),
      ]),
      item('Image Size…', 'imageSize', 'CmdOrCtrl+Alt+I'),
      item('Canvas Size…', 'canvasSize', 'CmdOrCtrl+Alt+C'),
      item('Crop to Selection', 'cropToSel'),
      item('Trim Transparent Pixels', 'trim'),
      sep,
      item('Auto Smart Fix', 'auto', 'CmdOrCtrl+Alt+M', 'smartfix'),
      item('Auto Levels', 'auto', 'CmdOrCtrl+Shift+L', 'levels'),
      item('Auto Contrast', 'auto', 'CmdOrCtrl+Alt+Shift+L', 'contrast'),
      item('Auto Color', 'auto', 'CmdOrCtrl+Shift+B', 'color'),
      item('Auto Sharpen', 'filterQuick', null, 'unsharp'),
      item('Auto Red Eye Fix', 'auto', 'CmdOrCtrl+R', 'redeye'),
      item('Adjust Smart Fix…', 'adjust', 'CmdOrCtrl+Shift+M', 'smartfix'),
    ]),
    sub('Enhance', [
      item('Brightness / Contrast…', 'adjust', null, 'brightnessContrast'),
      item('Levels…', 'adjust', 'CmdOrCtrl+L', 'levels'),
      item('Curves…', 'adjust', null, 'curves'),
      item('Exposure…', 'adjust', null, 'exposure'),
      item('Shadows / Highlights…', 'adjust', null, 'shadowsHighlights'),
      sep,
      item('Hue / Saturation…', 'adjust', 'CmdOrCtrl+U', 'hueSat'),
      item('Vibrance…', 'adjust', null, 'vibrance'),
      item('Colour Balance…', 'adjust', null, 'colorBalance'),
      item('Temperature / Tint…', 'adjust', null, 'temperature'),
      item('Photo Filter…', 'adjust', null, 'photoFilter'),
      sep,
      item('Black & White…', 'adjust', null, 'blackWhite'),
      item('Gradient Map…', 'adjust', null, 'gradientMap'),
      item('Posterize…', 'adjust', null, 'posterize'),
      item('Threshold…', 'adjust', null, 'threshold'),
      item('Invert', 'adjustNow', 'CmdOrCtrl+I', 'invert'),
      item('Remove Colour', 'adjustNow', 'CmdOrCtrl+Shift+U', 'desaturate'),
    ]),
    sub('Layer', [
      item('New Layer', 'newLayer', 'CmdOrCtrl+Shift+N'),
      sub('New Adjustment Layer', [
        item('Brightness / Contrast', 'newAdjLayer', null, 'brightnessContrast'),
        item('Levels', 'newAdjLayer', null, 'levels'),
        item('Curves', 'newAdjLayer', null, 'curves'),
        item('Hue / Saturation', 'newAdjLayer', null, 'hueSat'),
        item('Vibrance', 'newAdjLayer', null, 'vibrance'),
        item('Colour Balance', 'newAdjLayer', null, 'colorBalance'),
        item('Photo Filter', 'newAdjLayer', null, 'photoFilter'),
        item('Black & White', 'newAdjLayer', null, 'blackWhite'),
        item('Gradient Map', 'newAdjLayer', null, 'gradientMap'),
        item('Posterize', 'newAdjLayer', null, 'posterize'),
        item('Threshold', 'newAdjLayer', null, 'threshold'),
      ]),
      item('New Fill Layer (Solid Colour)', 'newFillLayer'),
      item('Duplicate Layer', 'dupLayer', 'CmdOrCtrl+J'),
      item('Layer via Cut', 'layerViaCut', 'CmdOrCtrl+Shift+J'),
      item('Delete Layer', 'deleteLayer'),
      sep,
      item('Add Layer Mask', 'addMask'),
      item('Add Mask from Selection', 'maskFromSel'),
      item('Apply Layer Mask', 'applyMask'),
      item('Delete Layer Mask', 'deleteMask'),
      item('Create Clipping Mask', 'clipOn', 'CmdOrCtrl+G'),
      item('Release Clipping Mask', 'clipOff', 'CmdOrCtrl+Shift+G'),
      sep,
      item('Rasterize Layer', 'rasterize'),
      item('Layer Style: Drop Shadow…', 'layerStyle', null, 'shadow'),
      item('Layer Style: Outer Glow…', 'layerStyle', null, 'glow'),
      item('Layer Style: Stroke…', 'layerStyle', null, 'stroke'),
      item('Clear Layer Style', 'layerStyle', null, 'clear'),
      sep,
      item('Bring to Front', 'arrange', 'CmdOrCtrl+Shift+]', 'front'),
      item('Bring Forward', 'arrange', 'CmdOrCtrl+]', 'up'),
      item('Send Backward', 'arrange', 'CmdOrCtrl+[', 'down'),
      item('Send to Back', 'arrange', 'CmdOrCtrl+Shift+[', 'back'),
      sep,
      sub('Align', [
        item('Left Edges', 'align', null, 'left'), item('Horizontal Centres', 'align', null, 'hcenter'), item('Right Edges', 'align', null, 'right'),
        sep,
        item('Top Edges', 'align', null, 'top'), item('Vertical Centres', 'align', null, 'vcenter'), item('Bottom Edges', 'align', null, 'bottom'),
      ]),
      item('Merge Down', 'mergeDown', 'CmdOrCtrl+E'),
      item('Merge Visible', 'mergeVisible', 'CmdOrCtrl+Shift+E'),
      item('Flatten Image', 'flatten'),
    ]),
    sub('Select', [
      item('All', 'selectAll', 'CmdOrCtrl+A'),
      item('Deselect', 'deselect', 'CmdOrCtrl+D'),
      item('Reselect', 'reselect', 'CmdOrCtrl+Shift+D'),
      item('Inverse', 'invertSel', 'CmdOrCtrl+Shift+I'),
      item('Select Subject (auto)', 'selectSubject'),
      item('Colour Range…', 'colorRange'),
      sep,
      item('Feather…', 'featherSel', 'CmdOrCtrl+Alt+D'),
      item('Expand…', 'growSel', null, 1),
      item('Contract…', 'growSel', null, -1),
      item('Smooth…', 'smoothSel'),
      item('Border…', 'borderSel'),
      item('Load Selection from Layer', 'selFromLayer'),
    ]),
    sub('Filter', [
      sub('Blur', [item('Gaussian Blur…', 'filter', null, 'gaussian'), item('Motion Blur…', 'filter', null, 'motion'), item('Radial (Zoom) Blur…', 'filter', null, 'zoomBlur'), item('Surface Blur…', 'filter', null, 'surface'), item('Tilt-Shift…', 'filter', null, 'tiltShift')]),
      sub('Sharpen', [item('Unsharp Mask…', 'filter', null, 'unsharp'), item('High Pass…', 'filter', null, 'highPass')]),
      sub('Noise', [item('Reduce Noise…', 'filter', null, 'reduceNoise'), item('Median…', 'filter', null, 'median'), item('Add Noise…', 'filter', null, 'addNoise'), item('Dust & Scratches…', 'filter', null, 'dust')]),
      sub('Stylise', [item('Emboss…', 'filter', null, 'emboss'), item('Find Edges', 'filter', null, 'edges'), item('Glowing Edges…', 'filter', null, 'glowEdges'), item('Oil Paint…', 'filter', null, 'oilPaint')]),
      sub('Distort', [item('Pinch / Bulge…', 'filter', null, 'pinch'), item('Twirl…', 'filter', null, 'twirl'), item('Ripple…', 'filter', null, 'ripple')]),
      sub('Pixelate', [item('Mosaic…', 'filter', null, 'pixelate'), item('Halftone…', 'filter', null, 'halftone')]),
      sub('Render', [item('Vignette…', 'filter', null, 'vignette'), item('Lens Flare…', 'filter', null, 'flare'), item('Film Grain…', 'filter', null, 'grain')]),
      sub('Artistic', [item('Pencil Sketch…', 'filter', null, 'sketch'), item('Cartoon…', 'filter', null, 'cartoon'), item('Watercolour…', 'filter', null, 'watercolor')]),
    ]),
    sub('View', [
      item('Zoom In', 'zoom', 'CmdOrCtrl+=', 1),
      { hidden: true, cmd: 'zoom', arg: 1, accel: 'CmdOrCtrl+Shift+=' },
      item('Zoom Out', 'zoom', 'CmdOrCtrl+-', -1),
      item('Fit on Screen', 'zoom', 'CmdOrCtrl+0', 0),
      item('Actual Pixels', 'zoom', 'CmdOrCtrl+Alt+0', 100),
      sep,
      item('Show / Hide Grid', 'toggleGrid', "CmdOrCtrl+'"),
      item('Show / Hide Rulers', 'toggleRulers', 'CmdOrCtrl+Shift+R'),
      item('Show / Hide Guides', 'toggleGuides', 'CmdOrCtrl+;'),
      item('Snap to Guides & Edges', 'toggleSnap', 'CmdOrCtrl+Shift+;'),
      item('Lock Guides', 'lockGuides', 'CmdOrCtrl+Alt+;'),
      item('New Guide…', 'newGuide'),
      item('New Guide Layout…', 'guideLayout'),
      item('Clear Guides', 'clearGuides'),
      sep,
      sub('Ruler Units', [item('Pixels', 'setUnits', null, 'px'), item('Millimetres', 'setUnits', null, 'mm'), item('Centimetres', 'setUnits', null, 'cm'), item('Inches', 'setUnits', null, 'in'), item('Points', 'setUnits', null, 'pt')]),
      item('Reset Ruler Origin', 'resetOrigin'),
      sep,
      fn('Use This Computer’s Fonts…', W.loadComputerFonts),
      fn('Enter / Exit Full Screen', fullscreen, isMac ? 'Cmd+Ctrl+F' : 'F11'),
    ]),
    sub('Window', [
      item('Next Document', 'cycleDoc', 'Ctrl+Tab', 1),
      { hidden: true, cmd: 'cycleDoc', arg: 1, accel: 'Alt+PageDown' },
      item('Previous Document', 'cycleDoc', 'Ctrl+Shift+Tab', -1),
      { hidden: true, cmd: 'cycleDoc', arg: -1, accel: 'Alt+PageUp' },
      sep,
      item('Tool Options', 'togglePanel', 'F4', 'options'),
      item('Photo Bin', 'togglePanel', 'F5', 'bin'),
      item('Histogram / Navigator', 'togglePanel', 'Alt+F9', 'info'),
      item('History', 'togglePanel', 'Alt+F10', 'history'),
      item('Layers', 'togglePanel', 'Alt+F11', 'layers'),
      item('Navigator', 'togglePanel', 'Alt+F12', 'info'),
    ]),
    sub('Help', [
      item('Keyboard Shortcuts', 'shortcuts'),
      fn('About Forged Web', about),
    ]),
  ];

  // ---------- accelerators ----------
  const CODE = { '=': 'Equal', '-': 'Minus', '[': 'BracketLeft', ']': 'BracketRight', ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash', Tab: 'Tab', PageUp: 'PageUp', PageDown: 'PageDown' };
  function parse(accel) {
    const parts = accel.split('+'); let key = parts.pop(); if (key === '') { parts.pop(); key = '+'; }
    const m = { meta: false, ctrl: false, alt: false, shift: false };
    for (const p of parts) {
      if (p === 'CmdOrCtrl') m[isMac ? 'meta' : 'ctrl'] = true;
      else if (p === 'Cmd') m.meta = true; else if (p === 'Ctrl') m.ctrl = true; else if (p === 'Alt') m.alt = true; else if (p === 'Shift') m.shift = true;
    }
    const code = /^[A-Z]$/i.test(key) ? 'Key' + key.toUpperCase() : /^[0-9]$/.test(key) ? 'Digit' + key : /^F\d+$/.test(key) ? key : CODE[key] || key;
    return { m, code, key, parts };
  }
  function label(accel) {
    const { parts, key } = parse(accel);
    if (isMac) {
      const sym = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Cmd: '⌘', CmdOrCtrl: '⌘' }, order = ['Ctrl', 'Alt', 'Shift', 'Cmd', 'CmdOrCtrl'];
      return parts.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((p) => sym[p]).join('') + (key === 'Tab' ? '⇥' : key.length === 1 ? key.toUpperCase() : key);
    }
    return parts.map((p) => (p === 'CmdOrCtrl' ? 'Ctrl' : p)).concat(key.length === 1 ? key.toUpperCase() : key).join('+');
  }
  const bindings = [];
  (function collect(items) { for (const it of items) { if (it.items) collect(it.items); else if (it.accel) bindings.push(Object.assign({ p: parse(it.accel) }, it)); } })(MENUS);
  const exec = (it) => { closeMenus(); if (it.run) it.run(); else W.run(it.cmd, it.arg); };

  window.addEventListener('keydown', (e) => {
    if (document.querySelector('.modal-bg')) return;
    const U = window.K.U;
    const hit = bindings.find((b) => b.p.code === e.code && b.p.m.meta === e.metaKey && b.p.m.ctrl === e.ctrlKey && b.p.m.alt === e.altKey && b.p.m.shift === e.shiftKey);
    if (!hit) { if (e.key === 'Escape') closeMenus(); return; }
    const anyMod = e.metaKey || e.ctrlKey || e.altKey;
    if (U.isTyping() && (!anyMod || ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'copyMerged'].includes(hit.cmd))) return; // normal text editing
    if (hit.passThrough) return; // let the browser fire its paste event
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat && !['zoom', 'arrange'].includes(hit.cmd)) return;
    exec(hit);
  }, true);

  // ---------- menu bar ----------
  const el = window.K.U.el;
  let openMenu = null;
  function closeMenus() { document.querySelectorAll('.wm-top.on').forEach((b) => b.classList.remove('on')); document.querySelectorAll('.wm-drop').forEach((d) => d.remove()); openMenu = null; }
  function buildList(items, cls) {
    const list = el('div', { class: 'wm-drop ' + (cls || ''), role: 'menu' });
    for (const it of items) {
      if (it.hidden) continue;
      if (it.sep) { if (list.lastChild && !list.lastChild.matches('hr')) list.append(el('hr')); continue; }
      if (it.items) {
        const row = el('div', { class: 'wm-item has-sub', role: 'menuitem', tabindex: -1 }, el('span', {}, it.label), el('em', {}, '›'));
        let child = null;
        const open = () => { list.querySelectorAll(':scope > .wm-item.has-sub.on').forEach((r) => { if (r !== row) { r.classList.remove('on'); r._child && r._child.remove(); r._child = null; } }); if (child && child.isConnected) return; child = buildList(it.items, 'wm-sub'); row._child = child; row.classList.add('on'); document.body.append(child); place(child, row.getBoundingClientRect(), true); };
        row.onmouseenter = open; row.onclick = open;
        list.append(row); continue;
      }
      const row = el('div', { class: 'wm-item', role: 'menuitem', tabindex: -1 }, el('span', {}, it.label), it.accel ? el('kbd', {}, label(it.accel)) : null);
      row.onmouseenter = () => list.querySelectorAll(':scope > .wm-item.has-sub.on').forEach((r) => { r.classList.remove('on'); r._child && r._child.remove(); r._child = null; });
      row.onclick = () => exec(it);
      list.append(row);
    }
    if (list.lastChild && list.lastChild.matches('hr')) list.lastChild.remove();
    return list;
  }
  function place(menu, r, side) {
    let x = side ? r.right - 2 : r.left, y = side ? r.top - 5 : r.bottom + 2;
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
    const m = menu.getBoundingClientRect();
    if (m.right > innerWidth - 4) x = side ? r.left - m.width + 2 : innerWidth - m.width - 4;
    if (m.bottom > innerHeight - 4) y = Math.max(4, innerHeight - m.height - 4);
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
  }
  function openTop(btn, menu) {
    closeMenus(); openMenu = menu; btn.classList.add('on');
    const d = buildList(menu.items, 'wm-main'); document.body.append(d); place(d, btn.getBoundingClientRect(), false);
  }

  function about() {
    W.serverInfo().then((s) => window.K.UI.modal({
      title: 'About Forged Web',
      body: el('div', { class: 'form' },
        el('p', { style: { margin: '0 0 8px' } }, `Forged ${s.version ? s.version + ' ' : ''}for the web, by New Zee Build.`),
        el('p', { class: 'hint' }, s.library ? `Running on your own server. The Library keeps projects and exports on the server${s.readOnly ? ' (read-only)' : ''}.` : 'Running without a Forged server: files open from and save to this computer only.'),
        el('p', { class: 'hint' }, 'Everything is edited in this browser. Photos are only sent to the server when you save them to the Library, and every exported image has its metadata removed.'),
        el('p', { class: 'hint' }, el('a', { class: 'link', href: 'https://github.com/brucewindsornz-sudo/forged', target: '_blank', rel: 'noopener' }, 'github.com/brucewindsornz-sudo/forged'))),
      buttons: [['Close', true]], width: 400,
    }));
  }

  window.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('web');
    const bar = el('nav', { id: 'menubar', role: 'menubar' });
    for (const m of MENUS) {
      const b = el('button', { class: 'wm-top', role: 'menuitem' }, m.label);
      b.onpointerdown = (e) => { e.preventDefault(); if (openMenu === m) closeMenus(); else openTop(b, m); };
      b.onmouseenter = () => { if (openMenu && openMenu !== m) openTop(b, m); };
      bar.append(b);
    }
    const tb = document.getElementById('titlebar'); tb.insertBefore(bar, document.getElementById('tabs'));
    document.addEventListener('pointerdown', (e) => { if (openMenu && !e.target.closest('.wm-drop, #menubar')) closeMenus(); }, true);
    window.addEventListener('blur', closeMenus); window.addEventListener('resize', closeMenus);

    // Welcome screen: add the Library
    W.serverInfo().then((s) => {
      const acts = document.querySelector('.welcome-actions');
      if (s.library && acts && window.K.icon) acts.insertBefore(el('button', { class: 'big', html: window.K.icon('open', 22) + '<span>Open from Library…</span>', onclick: () => W.openLibrary() }), acts.children[1]);
      const hint = document.querySelector('.welcome-card .hint'); if (hint) hint.textContent = 'Or drop photos anywhere in this window.';
    });
    // Offer this computer's fonts the first time the Type tool is used (Chromium asks permission once)
    let asked = false;
    document.addEventListener('pointerdown', (e) => {
      const app = window.K.app; if (asked || !app || !app.tool || app.tool.id !== 'text' || typeof window.queryLocalFonts !== 'function' || W.hasFontAccess()) return;
      if (!e.target.closest('#options, #stage')) return;
      asked = true; window.queryLocalFonts().then((l) => { if (l && l.length) window.K.Fonts.load(true); }).catch(() => {});
    }, true);
  });
})();
