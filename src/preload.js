const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snow', {
  // Overlay: receives settings (intensity, pile, enabled) and the screen's "ground" line.
  onConfig: (cb) => ipcRenderer.on('config', (_e, cfg) => cb(cfg)),
  onWindows: (cb) => ipcRenderer.on('windows', (_e, wins) => cb(wins)),
  onBulldoze: (cb) => ipcRenderer.on('bulldoze', () => cb()),
  // Widget: manual dragging so a simple click can still shake the globe.
  dragBy: (dx, dy) => ipcRenderer.send('widget-drag', dx, dy),
  dragEnd: () => ipcRenderer.send('widget-drag-end'),
  hideWidget: () => ipcRenderer.send('widget-hide'),
});
