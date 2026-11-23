const { contextBridge, ipcRenderer, clipboard, nativeImage } = require('electron');

contextBridge.exposeInMainWorld('native', {
  isMac: process.platform === 'darwin',
  openImages: (opts) => ipcRenderer.invoke('dialog:openImages', opts),
  save: (opts) => ipcRenderer.invoke('dialog:save', opts),
  exportImage: (opts) => ipcRenderer.invoke('export:save', opts),
  openProjects: () => ipcRenderer.invoke('dialog:openProjects'),
  pickFolder: (opts) => ipcRenderer.invoke('dialog:pickFolder', opts),
  writeExport: (opts) => ipcRenderer.invoke('export:write', opts),
  confirm: (opts) => ipcRenderer.invoke('confirm', opts),
  closeOk: () => ipcRenderer.send('close-ok'),
  setTitle: (t) => ipcRenderer.send('set-title', t),
  reveal: (p) => ipcRenderer.send('reveal', p),
  clipboardWriteImage: (dataUrl) => clipboard.writeImage(nativeImage.createFromDataURL(dataUrl)),
  clipboardReadImage: () => { const img = clipboard.readImage(); return img.isEmpty() ? null : img.toDataURL(); },
  listFonts: (force) => ipcRenderer.invoke('fonts:list', force),
  readFont: (file) => ipcRenderer.invoke('fonts:read', file),
  onMenu: (fn) => ipcRenderer.on('menu', (_e, cmd, arg) => fn(cmd, arg)),
  onOpenFile: (fn) => ipcRenderer.on('open-file', (_e, f) => fn(f)),
  onRequestClose: (fn) => ipcRenderer.on('request-close', () => fn()),
});
