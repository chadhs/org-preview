import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, writeFile, rename, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { checkAppearance, setAppearance, captureAppearances } from './lib/appearance-smoke.mjs';
import { checkHighlighting } from './lib/highlight-smoke.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'org-preview-smoke-'));
const file = path.join(directory, 'smoke café 日本語.org');
await writeFile(file, '#+title: Desktop smoke test\n* TODO A heading :test:\nRead *this* in Org.\n- [X] Working\n\n#+begin_export html\n<img src=x onerror="window.compromised=true">\n#+end_export');
await writeFile(path.join(directory, 'links.org'), '#+title: Links\n* Supported\n[[http://example.com][HTTP]] [[https://example.com][HTTPS]] [[mailto:reader@example.invalid][Mail]]');
const executablePath = process.env.ORG_PREVIEW_EXECUTABLE;
const appArgs = executablePath ? [] : ['.'];
const profileArg = `--user-data-dir=${path.join(directory, 'profile')}`;
let app;
try {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath, args: [...appArgs, file, profileArg, ...process.argv.slice(2)], env, chromiumSandbox: true });
  let stderr = '';
  app.process().stderr.on('data', (chunk) => { stderr += chunk; });
  let window = await app.firstWindow();
  expect(app.process().spawnargs).not.toContain('--no-sandbox');
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox)).toBe(true);
  const errors = [];
  window.on('pageerror', (error) => errors.push(error.message));
  await expect(window.locator('#document-title')).toHaveText('Desktop smoke test');
  await expect(window.locator('.version')).toHaveText(JSON.parse(await readFile('package.json', 'utf8')).version);
  await expect(window.locator('#outline .outline-item')).toHaveCount(1);
  await expect(window.locator('#content strong')).toHaveText('this');
  await expect(window.locator('#content img')).toHaveCount(0);
  expect(await window.evaluate(() => typeof window.require)).toBe('undefined');
  expect(await window.evaluate(() => window.compromised)).toBeUndefined();
  await window.locator('#source-tab').click();
  await expect(window.locator('#source')).toBeVisible();
  await expect(window.locator('#source')).toContainText('#+title: Desktop smoke test');
  await window.locator('#preview-tab').click();
  await checkAppearance(window);
  await window.locator('#find-button').click();
  await window.locator('#search').fill('Read');
  await expect(window.locator('#search-count')).toContainText('/ 1');
  await window.locator('#close-search').click();
  // Refreshing search highlights must not jump back to the first match.
  const longSource = '#+title: Scroll test\n* Reading\nneedle one\n\n' + 'A paragraph for scrolling.\n\n'.repeat(200) + 'needle two\n';
  await writeFile(file, longSource);
  await expect(window.locator('#document-title')).toHaveText('Scroll test');
  await window.locator('#find-button').click();
  await window.locator('#search').fill('needle');
  await window.locator('#search').press('Enter');
  await expect(window.locator('#search-count')).toHaveText('2 / 2');
  await window.locator('#reader').evaluate((reader) => { reader.scrollTop = 1000; });
  await window.evaluate(() => { window.originalContent = document.querySelector('#content').firstChild; });
  await setAppearance(window, { mode: 'dark', dark: 'solarized-dark' });
  expect(await window.locator('#reader').evaluate((reader) => reader.scrollTop)).toBe(1000);
  expect(await window.evaluate(() => window.originalContent === document.querySelector('#content').firstChild)).toBe(true);
  await expect(window.locator('#search-count')).toHaveText('2 / 2');
  await window.keyboard.press('Escape');
  await window.locator('#source-tab').click();
  await window.locator('#reader').evaluate((reader) => { reader.scrollTop = 600; });
  await setAppearance(window, { mode: 'light', light: 'solarized-light' });
  await expect(window.locator('#source')).toBeVisible();
  await expect(window.locator('#source-tab')).toHaveAttribute('aria-pressed', 'true');
  expect(await window.locator('#reader').evaluate((reader) => reader.scrollTop)).toBe(600);
  await expect(window.locator('#search-count')).toHaveText('2 / 2');
  await window.keyboard.press('Escape');
  await window.locator('#preview-tab').click();
  await writeFile(file, longSource + 'External save with search open.\n');
  await expect(window.locator('#source')).toContainText('External save with search open.');
  expect(await window.locator('#reader').evaluate((reader) => reader.scrollTop)).toBe(1000);
  await expect(window.locator('#search-count')).toHaveText('2 / 2');
  await window.locator('#search').press('Shift+Enter');
  await expect(window.locator('#search-count')).toHaveText('1 / 2');
  await window.locator('#close-search').click();
  await writeFile(file, '#+title: After saving\n* Updated\nThe file changed outside the app.');
  await expect(window.locator('#document-title')).toHaveText('After saving');
  await writeFile(path.join(directory, 'replacement'), '#+title: Atomic save\n* Still watching\nReplacement saves work.');
  await rename(path.join(directory, 'replacement'), file);
  await expect(window.locator('#document-title')).toHaveText('Atomic save');
  await rm(file);
  await expect(window.locator('#error')).toBeVisible();
  await writeFile(file, '#+title: Recreated\n* Returned\nThe watcher recovered.');
  await expect(window.locator('#document-title')).toHaveText('Recreated');
  await expect(window.locator('#error')).toBeHidden();
  const unsupported = path.join(directory, 'unsupported.txt');
  const oversized = path.join(directory, 'oversized.org');
  await writeFile(unsupported, 'Unsupported');
  await writeFile(oversized, Buffer.alloc(16 * 1024 * 1024 + 1));
  // File-backed Chromium drops exercise Electron's webUtils.getPathForFile.
  const cdp = await window.context().newCDPSession(window);
  async function drop(filePath) {
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await cdp.send('Input.dispatchDragEvent', { type, x: 500, y: 300, data: { items: [], files: [filePath], dragOperationsMask: 1 } });
    }
  }
  await drop(path.join(directory, 'links.org'));
  await expect(window.locator('#document-title')).toHaveText('Links');
  await app.evaluate(({ shell }) => {
    globalThis.openedLinks = [];
    shell.openExternal = async (url) => { globalThis.openedLinks.push(url); };
  });
  for (const href of ['http://example.com', 'https://example.com', 'mailto:reader@example.invalid']) {
    await window.locator(`#content a[href="${href}"]`).click();
  }
  expect(await app.evaluate(() => globalThis.openedLinks)).toEqual(['http://example.com/', 'https://example.com/', 'mailto:reader@example.invalid']);
  await drop(unsupported);
  await expect(window.locator('#error')).toContainText('Choose an .org file.');
  await drop(oversized);
  await expect(window.locator('#error')).toContainText('up to 16 MiB');
  await drop(file);
  await expect(window.locator('#error')).toBeHidden();
  await expect(window.locator('#filename')).toHaveText(path.basename(file));
  // Keep fixtures synthetic: personal configs must never enter CI artifacts.
  const large = path.join(directory, 'large.org');
  const largeSource = '#+title: Large notebook\n* Notes\n' +
    'A paragraph with *bold* text.\n\n'.repeat(3000) +
    '\n#+begin_src emacs-lisp\n' + ('; ' + 'x'.repeat(4093) + '\n').repeat(1280) +
    '#+end_src\n* Final heading\nLast sentence.';
  await writeFile(large, largeSource);
  await drop(large);
  await expect(window.locator('#document-title')).toHaveText('Large notebook', { timeout: 30000 });
  await expect(window.locator('#error')).toBeHidden();
  await expect(window.locator('#content strong')).toHaveCount(3000);
  await expect(window.locator('#outline .outline-item')).toHaveCount(2);
  await window.locator('#outline .outline-item').last().click();
  await expect(window.locator('#content h2').last()).toBeInViewport();
  await window.locator('#source-tab').click();
  expect(await window.locator('#source').textContent()).toBe(largeSource);
  await window.locator('#preview-tab').click();
  await window.locator('#find-button').click();
  await window.locator('#search').fill('Last sentence');
  await expect(window.locator('#search-count')).toHaveText('1 / 1');
  await window.locator('#close-search').click();
  await writeFile(large, largeSource.replace('Last sentence.', 'Saved large document.'));
  await expect(window.locator('#source')).toContainText('Saved large document.', { timeout: 30000 });
  await expect(window.locator('#error')).toBeHidden();
  // A second CLI invocation must report bad input instead of ignoring it.
  const child = spawn(app.process().spawnfile, [...appArgs, unsupported, profileArg], { env, stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Second instance exited ${code}`)));
  });
  await expect(window.locator('#error')).toContainText('Choose an .org file.');
  // Desktop launchers can pass file:// URLs, including encoded spaces/Unicode.
  const uriChild = spawn(app.process().spawnfile, [...appArgs, pathToFileURL(path.join(directory, 'links.org')).href, profileArg], { env, stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    uriChild.once('error', reject);
    uriChild.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`File URL instance exited ${code}`)));
  });
  await expect(window.locator('#document-title')).toHaveText('Links');
  await expect(window.locator('#error')).toBeHidden();
  await checkHighlighting(window, directory, executablePath ? 'packaged' : 'desktop');
  // Exercise the same picker path used by the Open button without a native dialog.
  await app.evaluate(({ dialog }, welcome) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [welcome] }); }, path.resolve('examples/welcome.org'));
  await window.locator('#open').click();
  await expect(window.locator('#document-title')).toHaveText('Your words, in Org.');
  await writeFile(file, '#+title: Old file must stay detached');
  await new Promise((resolve) => setTimeout(resolve, 650));
  await expect(window.locator('#document-title')).toHaveText('Your words, in Org.');
  if (process.platform === 'darwin') {
    // macOS keeps the application alive after its last window closes. A Finder
    // open-file event must create a window without waiting for an activate event.
    await app.evaluate(({ BrowserWindow }) => new Promise((resolve) => {
      const closing = BrowserWindow.getAllWindows()[0];
      closing.once('closed', resolve);
      closing.close();
    }));
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);
    const reopened = app.waitForEvent('window', { timeout: 5000 });
    await app.evaluate(({ app }, filePath) => app.emit('open-file', { preventDefault() {} }, filePath), file);
    window = await reopened;
    await expect(window.locator('#document-title')).toHaveText('Old file must stay detached');
    // Open remains usable from the native menu with no windows, too.
    await app.evaluate(({ BrowserWindow }) => new Promise((resolve) => {
      const closing = BrowserWindow.getAllWindows()[0];
      closing.once('closed', resolve);
      closing.close();
    }));
    const picked = app.waitForEvent('window', { timeout: 5000 });
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((item) => item.label === 'File').submenu.items[0].click());
    window = await picked;
    await expect(window.locator('#document-title')).toHaveText('Your words, in Org.');
  }
  await mkdir('test-results', { recursive: true });
  const screenshotPrefix = executablePath ? 'packaged' : 'desktop';
  await captureAppearances(window, screenshotPrefix);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 500));
  await setAppearance(window, { mode: 'light' });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize()[0])).toBe(720);
  // Window decorations can consume part of the outer width on Linux.
  for (const mode of ['light', 'dark']) {
    await setAppearance(window, { mode });
    // Native resize and popover toggle events settle asynchronously in the renderer.
    await expect.poll(() => window.locator('#appearance-panel').evaluate((panel) => {
      const bounds = panel.getBoundingClientRect();
      return bounds.left >= 12 && bounds.right <= innerWidth - 12 && bounds.bottom <= innerHeight;
    })).toBe(true);
    expect(await window.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await window.screenshot({ path: `test-results/${screenshotPrefix}-solarized-${mode}-narrow.png` });
  }
  await setAppearance(window, { mode: 'system' });
  await app.close();
  app = await electron.launch({ executablePath, args: [...appArgs, file, profileArg, ...process.argv.slice(2)], env, chromiumSandbox: true });
  app.process().stderr.on('data', (chunk) => { stderr += chunk; });
  window = await app.firstWindow();
  window.on('pageerror', (error) => errors.push(error.message));
  await expect(window.locator('#document-title')).toHaveText('Old file must stay detached');
  await expect(window.locator('#appearance-mode')).toHaveValue('system');
  await expect(window.locator('#light-theme')).toHaveValue('solarized-light');
  await expect(window.locator('#dark-theme')).toHaveValue('solarized-dark');
  await expect(window.locator('#sans-serif-headings')).toBeChecked();
  await expect(window.locator('#document-title')).toHaveCSS('font-family', /sans-serif/);
  await window.emulateMedia({ colorScheme: 'light' });
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'solarized-light');
  await window.emulateMedia({ colorScheme: 'dark' });
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'solarized-dark');
  expect(errors).toEqual([]);
  expect(stderr).not.toContain('not compatible with Vulkan');
  console.log(`Desktop smoke passed (${executablePath ? 'packaged' : 'development'}): open, file-backed drops, Unicode paths, input errors, CLI handoff${process.platform === 'darwin' ? ', macOS window reopening' : ''}, render, source, themes, syntax highlighting, search, scroll preservation, external saves, atomic replacement, delete/recreate, watcher switching, large documents, sandbox, HTML safety, and no Vulkan compatibility warning.`);
} finally {
  await app?.close();
  await rm(directory, { recursive: true, force: true });
}
