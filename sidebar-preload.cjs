const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceWorkspace', {
  setMode: (mode) => ipcRenderer.invoke('voice-workspace:mode', mode),
  setDesktopActive: (active) => ipcRenderer.invoke('voice-workspace:desktop', active),
  showCanvas: () => ipcRenderer.invoke('voice-workspace:show-canvas'),
  updateCanvas: (message) => ipcRenderer.invoke('voice-workspace:canvas', message),
  onCanvasClosed(callback) {
    ipcRenderer.on('voice-workspace:canvas-closed', (_event, id) => callback(id));
  },
});
