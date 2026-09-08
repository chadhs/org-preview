import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directory = await mkdtemp(path.join(tmpdir(), 'org-preview-smoke-'));
const file = path.join(directory, 'smoke.org');
await writeFile(file, '#+title: Desktop smoke test\n* TODO A heading :test:\nRead *this* in Org.\n- [X] Working\n\n#+begin_export html\n<img src=x onerror="window.compromised=true">\n#+end_export');
let app;
try {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['.', file], env });
  const window = await app.firstWindow();
  const errors = [];
  window.on('pageerror', (error) => errors.push(error.message));
  await expect(window.locator('#document-title')).toHaveText('Desktop smoke test');
  await expect(window.locator('#outline .outline-item')).toHaveCount(1);
  await expect(window.locator('#content strong')).toHaveText('this');
  await expect(window.locator('#content img')).toHaveCount(0);
  expect(await window.evaluate(() => typeof window.require)).toBe('undefined');
  expect(await window.evaluate(() => window.compromised)).toBeUndefined();
  await window.locator('#source-tab').click();
  await expect(window.locator('#source')).toBeVisible();
  await expect(window.locator('#source')).toContainText('#+title: Desktop smoke test');
  await window.locator('#preview-tab').click();
  await window.locator('#theme').selectOption('dark');
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark');
  await window.locator('#theme').selectOption('light');
  await window.locator('#find-button').click();
  await window.locator('#search').fill('Read');
  await expect(window.locator('#search-count')).toContainText('/ 1');
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
  // Exercise the same picker path used by the Open button without a native dialog.
  await app.evaluate(({ dialog }, welcome) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [welcome] }); }, path.resolve('examples/welcome.org'));
  await window.locator('#open').click();
  await expect(window.locator('#document-title')).toHaveText('Your words, in Org.');
  await mkdir('test-results', { recursive: true });
  await window.screenshot({ path: 'test-results/desktop-light.png' });
  await window.locator('#theme').selectOption('dark');
  await window.screenshot({ path: 'test-results/desktop-dark.png' });
  await window.locator('#theme').selectOption('system');
  expect(errors).toEqual([]);
  console.log('Desktop smoke passed: open, render, source, themes, search, external saves, atomic replacement, delete/recreate, sandbox, and HTML safety.');
} finally {
  await app?.close();
  await rm(directory, { recursive: true, force: true });
}
