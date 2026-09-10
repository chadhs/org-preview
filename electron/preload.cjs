const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('orgPreview', {
  platform: process.platform,
  windowTheme: (theme) => ipcRenderer.invoke('window:theme', theme),
  open: () => ipcRenderer.invoke('document:open'),
  openPath: (path) => ipcRenderer.invoke('document:path', path),
  openPaths: (paths) => ipcRenderer.invoke('document:paths', paths),
  activate: (id) => ipcRenderer.invoke('document:activate', id),
  close: (id) => ipcRenderer.invoke('document:close', id),
  droppedPath: (file) => webUtils.getPathForFile(file),
  initial: () => ipcRenderer.invoke('document:initial'),
  reveal: () => ipcRenderer.invoke('document:reveal'),
  image: (documentPath, reference, revision) => ipcRenderer.invoke('image:read', documentPath, reference, revision),
  diagram: (id, revision, reference, theme) => ipcRenderer.invoke('diagram:render', id, revision, reference, theme),
  external: (url) => ipcRenderer.invoke('link:external', url),
  onDocument: (callback) => {
    const listener = (_event, doc) => callback(doc);
    ipcRenderer.on('session:changed', listener);
    return () => ipcRenderer.removeListener('session:changed', listener);
  },
  onError: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('document:error', listener);
    return () => ipcRenderer.removeListener('document:error', listener);
  },
  onCommand: (callback) => ipcRenderer.on('app:command', (_event, command) => callback(command)),
});
