const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceWorkspace', {
  setMode: (mode) => ipcRenderer.invoke('voice-workspace:mode', mode),
});
