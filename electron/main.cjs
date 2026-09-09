const { app, BrowserWindow, dialog, ipcMain, Menu, shell, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readDocument, watchDocument } = require('./documents.cjs');
const { documentArgument } = require('./arguments.cjs');
const { configureGraphics } = require('./graphics.cjs');
configureGraphics(app.commandLine);
let win, current, stopWatching;
let openRevision = 0;
let pendingPath = documentArgument(process.argv, app.isPackaged);
const iconPath = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '../build/icons/256x256.png');
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
function requestDocument(filePath) {
  if (!win) {
    pendingPath = filePath;
    if (!win && app.isReady()) createWindow();
  } else {
    openDocument(filePath).catch(fail);
  }
  win?.restore();
  win?.focus();
}
async function picker() {
  const options = { properties: ['openFile'], filters: [{ name: 'Org documents', extensions: ['org'] }] };
  const { canceled, filePaths } = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options));
  if (!canceled && filePaths[0]) requestDocument(filePaths[0]);
}
function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== pageUrl) throw new Error('Untrusted request');
    try { return await callback(...args); } catch (error) { fail(error); throw error; }
  });
}
function createWindow() {
  win = new BrowserWindow({ width: 1240, height: 850, minWidth: 720, minHeight: 500, backgroundColor: '#f8f7f3', title: 'Org Preview', icon: iconPath, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.on('closed', () => { openRevision++; stopWatching?.(); win = undefined; current = undefined; });
  win.loadFile(path.join(__dirname, '../dist/index.html'));
}
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
else {
  app.on('open-file', (event, filePath) => { event.preventDefault(); requestDocument(filePath); });
  app.on('second-instance', (_event, argv, cwd) => {
    const filePath = documentArgument(argv, app.isPackaged);
    if (filePath) requestDocument(path.resolve(cwd, filePath));
    else if (!win) createWindow();
    win?.restore(); win?.focus();
  });
  app.whenReady().then(() => {
    if (process.platform === 'darwin' && !app.isPackaged) app.dock.setIcon(iconPath);
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
