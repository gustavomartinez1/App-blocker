// Puente seguro entre las ventanas (bloqueo / vinculación) y el proceso principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('guardian', {
  pair: (server, code, name) => ipcRenderer.invoke('guardian:pair', server, code, name),
  request: (minutes, reason) => ipcRenderer.invoke('guardian:request', minutes, reason),
  requestStatus: (id) => ipcRenderer.invoke('guardian:requestStatus', id),
  code: (code) => ipcRenderer.invoke('guardian:code', code),
  close: () => ipcRenderer.invoke('guardian:close'),
  onDecision: (fn) => ipcRenderer.on('decision', (_e, data) => fn(JSON.parse(data))),
});
