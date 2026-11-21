const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workflowCanvas', {
  onUpdate(receive) {
    ipcRenderer.on('workflow-canvas:update', async (_event, requestId, message) => {
      let result = 'failed';
      try { result = await receive(message); } catch { /* Return a failed acknowledgment. */ }
      ipcRenderer.send('workflow-canvas:ack', requestId, result);
    });
  },
  close: () => ipcRenderer.send('workflow-canvas:close'),
});
