// Forged — Electron main process
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const Fonts = require('./fonts');
const { stripImage } = require('./strip');

let win = null;
let pendingOpen = [];

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif' };

function readForRenderer(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (ext === 'forged' || ext === 'kauri') {
    return { kind: 'project', name: path.basename(file), path: file, text: fs.readFileSync(file, 'utf8') };
  }
  const b64 = fs.readFileSync(file).toString('base64');
  return { kind: 'image', name: path.basename(file), path: file, dataUrl: `data:${MIME[ext] || 'application/octet-stream'};base64,${b64}` };
}

function createWindow() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#1b1c1f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    title: 'Forged',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    for (const f of pendingOpen) win.webContents.send('open-file', readForRenderer(f));
    pendingOpen = [];
  });
  win.on('close', (e) => {
    if (win.__forceClose) return;
    e.preventDefault();
    win.webContents.send('request-close');
  });
  buildMenu();
}

function send(cmd, arg) { if (win) win.webContents.send('menu', cmd, arg); }

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const item = (label, cmd, accelerator, arg) => ({ label, accelerator, click: () => send(cmd, arg) });
  const template = [
    ...(isMac ? [{ label: 'Forged', submenu: [
      { role: 'about' }, { type: 'separator' },
      item('Preferences…', 'preferences', 'Cmd+,'),
      { type: 'separator' }, { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] }] : []),
    { label: 'File', submenu: [
      item('New…', 'new', 'CmdOrCtrl+N'),
      item('Open…', 'open', 'CmdOrCtrl+O'),
      item('Place Photo…', 'place', 'CmdOrCtrl+Shift+P'),
      item('Photo Collage…', 'collage', 'CmdOrCtrl+Alt+N'),
      item('New from Clipboard', 'newFromClipboard'),
      { type: 'separator' },
      item('Save Project', 'save', 'CmdOrCtrl+S'),
      item('Save Project As…', 'saveAs', 'CmdOrCtrl+Shift+S'),
      item('Export…', 'export', 'CmdOrCtrl+Alt+Shift+S'),
      item('Convert Forged Projects…', 'convert'),
      { type: 'separator' },
      item('Close Document', 'closeDoc', 'CmdOrCtrl+W'),
    ] },
    { label: 'Edit', submenu: [
      item('Undo', 'undo', 'CmdOrCtrl+Z'),
      item('Redo', 'redo', 'CmdOrCtrl+Y'),
      { label: 'Step Forward', accelerator: 'CmdOrCtrl+Shift+Z', visible: false, acceleratorWorksWhenHidden: true, click: () => send('redo') },
      { label: 'Step Backward', accelerator: 'CmdOrCtrl+Alt+Z', visible: false, acceleratorWorksWhenHidden: true, click: () => send('undo') },
      { type: 'separator' },
      item('Cut', 'cut', 'CmdOrCtrl+X'),
      item('Copy', 'copy', 'CmdOrCtrl+C'),
      item('Copy Merged', 'copyMerged', 'CmdOrCtrl+Shift+C'),
      item('Paste', 'paste', 'CmdOrCtrl+V'),
      item('Delete', 'clearSel'),
      { type: 'separator' },
      item('Fill Selection…', 'fillSel'),
      item('Stroke Selection…', 'strokeSel'),
      item('Content-Aware Fill', 'contentFill'),
      { type: 'separator' },
      item('Free Transform', 'freeTransform', 'CmdOrCtrl+T'),
    ] },
    { label: 'Image', submenu: [
      { label: 'Rotate', submenu: [
        item('90° Right', 'rotate', null, 90), item('90° Left', 'rotate', null, -90), item('180°', 'rotate', null, 180),
        item('Custom / Straighten…', 'rotateCustom'),
        { type: 'separator' }, item('Flip Horizontal', 'flipImage', null, 'h'), item('Flip Vertical', 'flipImage', null, 'v'),
      ] },
      item('Image Size…', 'imageSize', 'CmdOrCtrl+Alt+I'),
      item('Canvas Size…', 'canvasSize', 'CmdOrCtrl+Alt+C'),
      item('Crop to Selection', 'cropToSel'),
      item('Trim Transparent Pixels', 'trim'),
      { type: 'separator' },
      item('Auto Smart Fix', 'auto', 'CmdOrCtrl+Alt+M', 'smartfix'),
      item('Auto Levels', 'auto', 'CmdOrCtrl+Shift+L', 'levels'),
      item('Auto Contrast', 'auto', 'CmdOrCtrl+Alt+Shift+L', 'contrast'),
      item('Auto Color', 'auto', 'CmdOrCtrl+Shift+B', 'color'),
      item('Auto Sharpen', 'filterQuick', null, 'unsharp'),
      item('Auto Red Eye Fix', 'auto', 'CmdOrCtrl+R', 'redeye'),
      item('Adjust Smart Fix…', 'adjust', 'CmdOrCtrl+Shift+M', 'smartfix'),
    ] },
    { label: 'Enhance', submenu: [
      item('Brightness / Contrast…', 'adjust', null, 'brightnessContrast'),
      item('Levels…', 'adjust', 'CmdOrCtrl+L', 'levels'),
      item('Curves…', 'adjust', null, 'curves'),
      item('Exposure…', 'adjust', null, 'exposure'),
      item('Shadows / Highlights…', 'adjust', null, 'shadowsHighlights'),
      { type: 'separator' },
      item('Hue / Saturation…', 'adjust', 'CmdOrCtrl+U', 'hueSat'),
      item('Vibrance…', 'adjust', null, 'vibrance'),
      item('Colour Balance…', 'adjust', null, 'colorBalance'),
      item('Temperature / Tint…', 'adjust', null, 'temperature'),
      item('Photo Filter…', 'adjust', null, 'photoFilter'),
      { type: 'separator' },
      item('Black & White…', 'adjust', null, 'blackWhite'),
      item('Gradient Map…', 'adjust', null, 'gradientMap'),
      item('Posterize…', 'adjust', null, 'posterize'),
      item('Threshold…', 'adjust', null, 'threshold'),
      item('Invert', 'adjustNow', 'CmdOrCtrl+I', 'invert'),
      item('Remove Colour', 'adjustNow', 'CmdOrCtrl+Shift+U', 'desaturate'),
    ] },
    { label: 'Layer', submenu: [
      item('New Layer', 'newLayer', 'CmdOrCtrl+Shift+N'),
      { label: 'New Adjustment Layer', submenu: [
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
      ] },
      item('New Fill Layer (Solid Colour)', 'newFillLayer'),
      item('Duplicate Layer', 'dupLayer', 'CmdOrCtrl+J'),
      item('Layer via Cut', 'layerViaCut', 'CmdOrCtrl+Shift+J'),
      item('Delete Layer', 'deleteLayer'),
      { type: 'separator' },
      item('Add Layer Mask', 'addMask'),
      item('Add Mask from Selection', 'maskFromSel'),
      item('Apply Layer Mask', 'applyMask'),
      item('Delete Layer Mask', 'deleteMask'),
      item('Create Clipping Mask', 'clipOn', 'CmdOrCtrl+G'),
      item('Release Clipping Mask', 'clipOff', 'CmdOrCtrl+Shift+G'),
      { type: 'separator' },
      item('Rasterize Layer', 'rasterize'),
      item('Layer Style: Drop Shadow…', 'layerStyle', null, 'shadow'),
      item('Layer Style: Outer Glow…', 'layerStyle', null, 'glow'),
      item('Layer Style: Stroke…', 'layerStyle', null, 'stroke'),
      item('Clear Layer Style', 'layerStyle', null, 'clear'),
      { type: 'separator' },
      item('Bring to Front', 'arrange', 'CmdOrCtrl+Shift+]', 'front'),
      item('Bring Forward', 'arrange', 'CmdOrCtrl+]', 'up'),
      item('Send Backward', 'arrange', 'CmdOrCtrl+[', 'down'),
      item('Send to Back', 'arrange', 'CmdOrCtrl+Shift+[', 'back'),
      { type: 'separator' },
      { label: 'Align', submenu: [
        item('Left Edges', 'align', null, 'left'), item('Horizontal Centres', 'align', null, 'hcenter'), item('Right Edges', 'align', null, 'right'),
        { type: 'separator' },
        item('Top Edges', 'align', null, 'top'), item('Vertical Centres', 'align', null, 'vcenter'), item('Bottom Edges', 'align', null, 'bottom'),
      ] },
      item('Merge Down', 'mergeDown', 'CmdOrCtrl+E'),
      item('Merge Visible', 'mergeVisible', 'CmdOrCtrl+Shift+E'),
      item('Flatten Image', 'flatten'),
    ] },
    { label: 'Select', submenu: [
      item('All', 'selectAll', 'CmdOrCtrl+A'),
      item('Deselect', 'deselect', 'CmdOrCtrl+D'),
      item('Reselect', 'reselect', 'CmdOrCtrl+Shift+D'),
      item('Inverse', 'invertSel', 'CmdOrCtrl+Shift+I'),
      item('Select Subject (auto)', 'selectSubject'),
      item('Colour Range…', 'colorRange'),
      { type: 'separator' },
      item('Feather…', 'featherSel', 'CmdOrCtrl+Alt+D'),
      item('Expand…', 'growSel', null, 1),
      item('Contract…', 'growSel', null, -1),
      item('Smooth…', 'smoothSel'),
      item('Border…', 'borderSel'),
      item('Load Selection from Layer', 'selFromLayer'),
    ] },
    { label: 'Filter', submenu: [
      { label: 'Blur', submenu: [
        item('Gaussian Blur…', 'filter', null, 'gaussian'),
        item('Motion Blur…', 'filter', null, 'motion'),
        item('Radial (Zoom) Blur…', 'filter', null, 'zoomBlur'),
        item('Surface Blur…', 'filter', null, 'surface'),
        item('Tilt-Shift…', 'filter', null, 'tiltShift'),
      ] },
      { label: 'Sharpen', submenu: [
        item('Unsharp Mask…', 'filter', null, 'unsharp'),
        item('High Pass…', 'filter', null, 'highPass'),
      ] },
      { label: 'Noise', submenu: [
        item('Reduce Noise…', 'filter', null, 'reduceNoise'),
        item('Median…', 'filter', null, 'median'),
        item('Add Noise…', 'filter', null, 'addNoise'),
        item('Dust & Scratches…', 'filter', null, 'dust'),
      ] },
      { label: 'Stylise', submenu: [
        item('Emboss…', 'filter', null, 'emboss'),
        item('Find Edges', 'filter', null, 'edges'),
        item('Glowing Edges…', 'filter', null, 'glowEdges'),
        item('Oil Paint…', 'filter', null, 'oilPaint'),
      ] },
      { label: 'Distort', submenu: [
        item('Pinch / Bulge…', 'filter', null, 'pinch'),
        item('Twirl…', 'filter', null, 'twirl'),
        item('Ripple…', 'filter', null, 'ripple'),
      ] },
      { label: 'Pixelate', submenu: [
        item('Mosaic…', 'filter', null, 'pixelate'),
        item('Halftone…', 'filter', null, 'halftone'),
      ] },
      { label: 'Render', submenu: [
        item('Vignette…', 'filter', null, 'vignette'),
        item('Lens Flare…', 'filter', null, 'flare'),
        item('Film Grain…', 'filter', null, 'grain'),
      ] },
      { label: 'Artistic', submenu: [
        item('Pencil Sketch…', 'filter', null, 'sketch'),
        item('Cartoon…', 'filter', null, 'cartoon'),
        item('Watercolour…', 'filter', null, 'watercolor'),
      ] },
    ] },
    { label: 'View', submenu: [
      item('Zoom In', 'zoom', 'CmdOrCtrl+=', 1),
      item('Zoom Out', 'zoom', 'CmdOrCtrl+-', -1),
      item('Fit on Screen', 'zoom', 'CmdOrCtrl+0', 0),
      item('Actual Pixels', 'zoom', 'CmdOrCtrl+Alt+0', 100),
      { type: 'separator' },
      item('Show / Hide Grid', 'toggleGrid', "CmdOrCtrl+'"),
      item('Show / Hide Rulers', 'toggleRulers', 'CmdOrCtrl+Shift+R'),
      item('Show / Hide Guides', 'toggleGuides', 'CmdOrCtrl+;'),
      item('Snap to Guides & Edges', 'toggleSnap', 'CmdOrCtrl+Shift+;'),
      item('Lock Guides', 'lockGuides', 'CmdOrCtrl+Alt+;'),
      item('New Guide…', 'newGuide'),
      item('New Guide Layout…', 'guideLayout'),
      item('Clear Guides', 'clearGuides'),
      { type: 'separator' },
      { label: 'Ruler Units', submenu: [
        { label: 'Pixels', click: () => send('setUnits', 'px') },
        { label: 'Millimetres', click: () => send('setUnits', 'mm') },
        { label: 'Centimetres', click: () => send('setUnits', 'cm') },
        { label: 'Inches', click: () => send('setUnits', 'in') },
        { label: 'Points', click: () => send('setUnits', 'pt') },
      ] },
      item('Reset Ruler Origin', 'resetOrigin'),
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { role: 'toggleDevTools' },
    ] },
    { label: 'Window', submenu: [
      { role: 'minimize' }, { role: 'zoom' }, { type: 'separator' },
      item('Next Document', 'cycleDoc', 'Ctrl+Tab', 1),
      item('Previous Document', 'cycleDoc', 'Ctrl+Shift+Tab', -1),
      { type: 'separator' },
      item('Tool Options', 'togglePanel', 'F4', 'options'),
      item('Photo Bin', 'togglePanel', 'F5', 'bin'),
      item('Histogram / Navigator', 'togglePanel', 'Alt+F9', 'info'),
      item('History', 'togglePanel', 'Alt+F10', 'history'),
      item('Layers', 'togglePanel', 'Alt+F11', 'layers'),
      item('Navigator', 'togglePanel', 'Alt+F12', 'info'),
      { type: 'separator' }, { role: 'front' },
    ] },
    { role: 'help', submenu: [
      item('Keyboard Shortcuts', 'shortcuts'),
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('dialog:openImages', async (_e, opts = {}) => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', ...(opts.multi ? ['multiSelections'] : [])],
    filters: [
      { name: 'Images & Projects', extensions: [...IMAGE_EXT, 'forged', 'kauri'] },
      { name: 'Images', extensions: IMAGE_EXT },
      { name: 'Forged Projects', extensions: ['forged', 'kauri'] },
    ],
  });
  if (r.canceled) return [];
  return r.filePaths.map(readForRenderer);
});

ipcMain.handle('dialog:save', async (_e, { defaultName, filters, data, encoding, path: existing }) => {
  let file = existing;
  if (!file) {
    const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters });
    if (r.canceled || !r.filePath) return null;
    file = r.filePath;
  }
  if (encoding === 'base64') fs.writeFileSync(file, Buffer.from(data, 'base64'));
  else fs.writeFileSync(file, data, 'utf8');
  app.addRecentDocument(file);
  return { path: file, name: path.basename(file) };
});

// Exports: always written with metadata removed
ipcMain.handle('export:save', async (_e, { defaultName, filters, base64 }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters });
  if (r.canceled || !r.filePath) return null;
  const out = stripImage(Buffer.from(base64, 'base64'));
  fs.writeFileSync(r.filePath, out);
  return { path: r.filePath, name: path.basename(r.filePath), bytes: out.length };
});
ipcMain.handle('dialog:openProjects', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Forged Projects', extensions: ['forged', 'kauri'] }] });
  if (r.canceled) return [];
  return r.filePaths.map(readForRenderer);
});
ipcMain.handle('dialog:pickFolder', async (_e, { defaultPath } = {}) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath, buttonLabel: 'Convert Here' });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});
ipcMain.handle('export:write', async (_e, { folder, name, base64 }) => {
  const ext = path.extname(name), base = path.basename(name, ext);
  let file = path.join(folder, name), n = 2;
  while (fs.existsSync(file)) file = path.join(folder, `${base} ${n++}${ext}`); // never overwrite
  const out = stripImage(Buffer.from(base64, 'base64'));
  fs.writeFileSync(file, out);
  return { path: file, name: path.basename(file) };
});

ipcMain.handle('confirm', async (_e, { message, detail, buttons }) => {
  const r = await dialog.showMessageBox(win, { type: 'question', message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1 });
  return r.response;
});

ipcMain.on('close-ok', () => { if (win) { win.__forceClose = true; win.close(); } });
ipcMain.on('set-title', (_e, t) => { if (win) win.setTitle(t); });
ipcMain.on('reveal', (_e, p) => shell.showItemInFolder(p));

app.on('open-file', (e, file) => {
  e.preventDefault();
  if (win && !win.webContents.isLoading()) win.webContents.send('open-file', readForRenderer(file));
  else pendingOpen.push(file);
});

ipcMain.handle('fonts:list', async (_e, force) => Fonts.scan(!!force));
ipcMain.handle('fonts:read', async (_e, file) => Fonts.readFont(file));

app.whenReady().then(() => {
  Fonts.init(app.getPath('userData')); Fonts.scan().catch(() => {}); // warm the font list in the background
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
