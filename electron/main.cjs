const { app, BrowserWindow, dialog, ipcMain, Menu, shell, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createSessions } = require('./sessions.cjs');
const { createDiagramRenderer, diagramSource } = require('./diagrams.cjs');
const { documentArguments } = require('./arguments.cjs');
const { configureGraphics } = require('./graphics.cjs');
const { titlebarOptions, updateTitlebar } = require('./titlebar.cjs');
configureGraphics(app.commandLine);
let win;
let initialized = false;
let pendingPaths = documentArguments(process.argv, app.isPackaged);
const iconPath = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '../build/icons/256x256.png');
const pageUrl = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
const fail = (error) => win?.webContents.send('document:error', error.message);
const diagrams = createDiagramRenderer();
let diagramDocument = '';
let diagramTheme = '';
let diagramEpoch = 0;
const sessions = createSessions({
  changed: (state) => {
    const identity = `${state.activeId}:${state.tabs.find((tab) => tab.id === state.activeId)?.revision}`;
    if (identity !== diagramDocument) { diagrams.cancel(); diagramDocument = identity; diagramEpoch++; }
    win?.setTitle(sessions.active() ? `${sessions.active().name} — Org Preview` : 'Org Preview');
    win?.webContents.send('session:changed', state);
  },
  recent: (file) => app.addRecentDocument(file),
});
function requestDocuments(paths) {
  if (!win) {
    pendingPaths.push(...paths);
    if (app.isReady()) createWindow();
  } else if (!initialized) {
    pendingPaths.push(...paths);
  } else {
    sessions.openMany(paths).catch(fail);
  }
  win?.restore();
  win?.focus();
}
async function picker() {
  const options = { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Org documents', extensions: ['org'] }] };
  const { canceled, filePaths } = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options));
  if (!canceled && filePaths.length) requestDocuments(filePaths);
}
function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== pageUrl) throw new Error('Untrusted request');
    try { return await callback(...args); } catch (error) { fail(error); throw error; }
  });
}
function createWindow() {
  initialized = false;
  win = new BrowserWindow({ ...titlebarOptions(), width: 1240, height: 850, minWidth: 720, minHeight: 500, backgroundColor: '#f5f4ef', title: 'Org Preview', icon: iconPath, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.alt) return;
    if (input.control && !input.meta && input.key === 'Tab') {
      event.preventDefault();
      win.webContents.send('app:command', input.shift ? 'previous-tab' : 'next-tab');
    } else if ((process.platform === 'darwin' ? input.meta : input.control) && !input.shift && input.key.toLowerCase() === 'w') {
      event.preventDefault();
      if (sessions.active()) sessions.close(sessions.active().id);
    }
  });
  win.on('closed', () => { sessions.dispose(); diagrams.cancel(); win = undefined; });
  win.loadFile(path.join(__dirname, '../dist/index.html'));
}
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
else {
  app.on('open-file', (event, filePath) => { event.preventDefault(); requestDocuments([filePath]); });
  app.on('second-instance', (_event, argv, cwd) => {
    const paths = documentArguments(argv, app.isPackaged);
    if (paths.length) requestDocuments(paths.map((file) => path.resolve(cwd, file)));
    else if (!win) createWindow();
    win?.restore(); win?.focus();
  });
  app.whenReady().then(() => {
    if (process.platform === 'darwin' && !app.isPackaged) app.dock.setIcon(iconPath);
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    // Documents cannot make network requests, even through image or CSS URLs.
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
    handle('window:theme', (theme) => updateTitlebar(win, theme));
    handle('document:open', picker);
    handle('document:path', (file) => sessions.openMany([file]));
    handle('document:paths', (paths) => sessions.openMany(paths));
    handle('document:activate', (id) => sessions.activate(id));
    handle('document:close', (id) => sessions.close(id));
    handle('document:initial', async () => {
      if (initialized) return sessions.snapshot();
      initialized = true;
      const paths = pendingPaths.length ? pendingPaths : [path.join(__dirname, '../examples/welcome.org')];
      pendingPaths = [];
      return sessions.openMany(paths);
    });
    handle('document:reveal', () => { if (sessions.active()) shell.showItemInFolder(sessions.active().path); });
    handle('image:read', (documentPath, reference, revision) => sessions.image(documentPath, reference, revision));
    handle('diagram:render', async (id, revision, request, theme) => {
      const doc = sessions.active();
      if (!doc || doc.id !== id || doc.revision !== revision) return { error: 'The document changed.' };
      try {
        const source = diagramSource(doc, request);
        if (!['light', 'dark', 'solarized-light', 'solarized-dark'].includes(theme)) throw new Error('Invalid diagram appearance.');
        if (diagramTheme !== theme) { diagrams.cancel(); diagramTheme = theme; diagramEpoch++; }
        const epoch = diagramEpoch;
        return await diagrams.render(source, theme, () => sessions.active() === doc && epoch === diagramEpoch);
      } catch (error) { return { error: error.message }; }
    });
    handle('link:external', async (value) => {
      if (typeof value !== 'string' || value.length > 8192) throw new Error('Invalid link.');
      const url = new URL(value);
      if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) throw new Error('Unsupported link.');
      await shell.openExternal(url.href);
    });
    const command = (name) => () => win?.webContents.send('app:command', name);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { label: 'File', submenu: [{ label: 'Open Org file…', accelerator: 'CmdOrCtrl+O', click: () => picker().catch(fail) }, { label: 'Reveal file', click: () => sessions.active() && shell.showItemInFolder(sessions.active().path) }, { type: 'separator' }, { label: 'Close tab', accelerator: 'CmdOrCtrl+W', click: () => sessions.active() && sessions.close(sessions.active().id) }, { label: 'Close window', accelerator: 'CmdOrCtrl+Shift+W', role: 'close' }] },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ label: 'Find', accelerator: 'CmdOrCtrl+F', click: command('find') }, { label: 'Toggle source', accelerator: 'CmdOrCtrl+Shift+S', click: command('source') }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }] },
      { label: 'Window', submenu: [{ label: 'Next tab', accelerator: 'Ctrl+Tab', click: command('next-tab') }, { label: 'Previous tab', accelerator: 'Ctrl+Shift+Tab', click: command('previous-tab') }, { role: 'minimize' }, { role: 'front' }] },
    ]));
    createWindow();
    app.on('activate', () => { if (!win) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => {
    if (app.isReady()) session.defaultSession.flushStorageData();
    sessions.dispose(); diagrams.cancel();
  });
}
