import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { setAppearance } from './appearance-smoke.mjs';

export async function checkTitlebar(app, window, prefix) {
  const native = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().endsWith('/index.html'));
    return { bounds: win.getBounds(), content: win.getContentBounds(), trafficLights: process.platform === 'darwin' ? win.getWindowButtonPosition() : null };
  });
  if (process.platform === 'darwin') {
    expect(native.content.height).toBe(native.bounds.height);
    expect(native.trafficLights).toEqual({ x: 14, y: 15 });
  }
  await expect(window.locator('.toolbar')).toHaveCSS('height', '44px');
  await expect(window.locator('.toolbar')).toHaveCSS('app-region', 'drag');
  await expect(window.locator('#open')).toHaveCSS('app-region', 'no-drag');
  await expect(window.locator('.version')).toBeVisible();
  await mkdir('test-results', { recursive: true });
  for (const [theme, chrome] of [['light', 'rgb(245, 244, 239)'], ['dark', 'rgb(27, 32, 30)'], ['solarized-light', 'rgb(238, 232, 213)'], ['solarized-dark', 'rgb(7, 54, 66)']]) {
    const mode = theme.endsWith('dark') ? 'dark' : 'light';
    await setAppearance(window, { mode, [mode]: theme });
    await expect(window.locator('.toolbar')).toHaveCSS('background-color', chrome);
    await expect(window.locator('#document-tabs')).toHaveCSS('background-color', chrome);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/index.html')).getBackgroundColor().toLowerCase())).toBe({ light: '#f5f4ef', dark: '#1b201e', 'solarized-light': '#eee8d5', 'solarized-dark': '#073642' }[theme]);
    await window.keyboard.press('Escape');
    await window.screenshot({ path: `test-results/${prefix}-titlebar-${theme}.png` });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/index.html')).setSize(720, 500));
  await expect.poll(() => window.evaluate(() => innerWidth)).toBeLessThanOrEqual(720);
  const controls = await window.locator('.toolbar-actions button').evaluateAll((buttons) => buttons.filter((button) => !button.closest('[popover]')).map((button) => {
    const bounds = button.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
  }));
  for (const control of controls) {
    expect(control.left).toBeGreaterThanOrEqual(process.platform === 'darwin' ? 88 : 0);
    expect(control.right).toBeLessThanOrEqual(720);
    expect(control.top).toBeGreaterThanOrEqual(0);
    expect(control.bottom).toBeLessThanOrEqual(44);
  }
  await window.locator('#appearance-button').click();
  await expect(window.locator('#appearance-panel')).toBeVisible();
  await window.screenshot({ path: `test-results/${prefix}-titlebar-narrow.png` });
  await window.keyboard.press('Escape');
  await window.locator('#source-tab').click();
  await expect(window.locator('#source')).toBeVisible();
  await window.locator('#preview-tab').click();
  // Test actual native fullscreen transitions, not only a resized web viewport.
  for (const fullscreen of [true, false]) {
    await app.evaluate(({ BrowserWindow }, value) => new Promise((resolve) => {
      const win = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().endsWith('/index.html'));
      win.once(value ? 'enter-full-screen' : 'leave-full-screen', resolve);
      win.setFullScreen(value);
    }), fullscreen);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/index.html')).isFullScreen()), { timeout: 10000 }).toBe(fullscreen);
    await expect(window.locator('#appearance-button')).toBeVisible();
  }
  await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/index.html')).setBounds(bounds), native.bounds);
  await setAppearance(window, { mode: 'system', light: 'light', dark: 'dark' });
  await window.keyboard.press('Escape');
  console.log('Compact title bar smoke passed: native controls, themes, safe spacing, fullscreen, and toolbar buttons.');
}
