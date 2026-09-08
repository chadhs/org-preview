const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('orgPreview', {
  open: () => ipcRenderer.invoke('document:open'),
  openPath: (path) => ipcRenderer.invoke('document:path', path),
  droppedPath: (file) => webUtils.getPathForFile(file),
  initial: () => ipcRenderer.invoke('document:initial'),
  reveal: () => ipcRenderer.invoke('document:reveal'),
  external: (url) => ipcRenderer.invoke('link:external', url),
  onDocument: (callback) => {
    const listener = (_event, doc) => callback(doc);
    ipcRenderer.on('document:changed', listener);
    return () => ipcRenderer.removeListener('document:changed', listener);
  },
  onError: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('document:error', listener);
    return () => ipcRenderer.removeListener('document:error', listener);
  },
  onCommand: (callback) => ipcRenderer.on('app:command', (_event, command) => callback(command)),
});
