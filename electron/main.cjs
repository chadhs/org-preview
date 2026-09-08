const { app, BrowserWindow, dialog, ipcMain, Menu, shell, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readDocument, watchDocument } = require('./documents.cjs');
let win, current, stopWatching;
let openRevision = 0;
let pendingPath = process.argv.slice(app.isPackaged ? 1 : 2).find((arg) => !arg.startsWith('-') && /\.org$/i.test(arg));
const pageUrl = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
const fail = (error) => win?.webContents.send('document:error', error.code === 'ENOENT' ? 'File unavailable. Waiting for it to return, or open another file.' : error.message);

async function openDocument(filePath) {
  const revision = ++openRevision;
  const doc = await readDocument(filePath);
  if (revision !== openRevision) return current;
  stopWatching?.();
  current = doc;
  const publish = (next) => {
    current = next;
    win?.setTitle(`${next.name} — Org Preview`);
    win?.webContents.send('document:changed', next);
  };
  stopWatching = watchDocument(doc.path, publish, fail);
  publish(doc);
  app.addRecentDocument(doc.path);
  return doc;
}
async function picker() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Org documents', extensions: ['org'] }] });
  if (!canceled && filePaths[0]) return openDocument(filePaths[0]);
  return null;
}
function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== pageUrl) throw new Error('Untrusted request');
    try { return await callback(...args); } catch (error) { fail(error); throw error; }
  });
}
function createWindow() {
  win = new BrowserWindow({ width: 1240, height: 850, minWidth: 720, minHeight: 500, backgroundColor: '#f8f7f3', title: 'Org Preview', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.on('closed', () => { stopWatching?.(); win = undefined; current = undefined; });
  win.loadFile(path.join(__dirname, '../dist/index.html'));
}
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
else {
  app.on('open-file', (event, filePath) => { event.preventDefault(); if (win) openDocument(filePath).catch(fail); else pendingPath = filePath; });
  app.on('second-instance', (_event, argv, cwd) => {
    const filePath = argv.slice(1).find((arg) => !arg.startsWith('-') && /\.org$/i.test(arg));
    if (!win) { pendingPath = filePath && path.resolve(cwd, filePath); createWindow(); }
    else if (filePath) openDocument(path.resolve(cwd, filePath)).catch(fail);
    win?.restore(); win?.focus();
  });
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    // Documents cannot make network requests, even through image or CSS URLs.
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
    handle('document:open', picker);
    handle('document:path', openDocument);
    handle('document:initial', async () => {
      if (current) return current;
      const filePath = pendingPath || path.join(__dirname, '../examples/welcome.org');
      pendingPath = undefined;
      return openDocument(filePath);
    });
    handle('document:reveal', () => { if (current) shell.showItemInFolder(current.path); });
    handle('link:external', async (value) => {
      if (typeof value !== 'string' || value.length > 8192) throw new Error('Invalid link.');
      const url = new URL(value);
      if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) throw new Error('Unsupported link.');
      await shell.openExternal(url.href);
    });
    const command = (name) => () => win?.webContents.send('app:command', name);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { label: 'File', submenu: [{ label: 'Open Org file…', accelerator: 'CmdOrCtrl+O', click: () => picker().catch(fail) }, { label: 'Reveal file', click: () => current && shell.showItemInFolder(current.path) }, { type: 'separator' }, { role: 'close' }] },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ label: 'Find', accelerator: 'CmdOrCtrl+F', click: command('find') }, { label: 'Toggle source', accelerator: 'CmdOrCtrl+Shift+S', click: command('source') }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }] },
      { role: 'windowMenu' },
    ]));
    createWindow();
    app.on('activate', () => { if (!win) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => stopWatching?.());
}
