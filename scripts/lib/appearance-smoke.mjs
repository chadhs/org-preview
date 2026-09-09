import { expect } from '@playwright/test';

export async function setAppearance(window, preferences) {
  if (!await window.locator('#appearance-panel').isVisible()) await window.locator('#appearance-button').click();
  for (const [name, value] of Object.entries(preferences)) {
    if (name === 'sansSerifHeadings') await window.locator('#sans-serif-headings').setChecked(value);
    else await window.locator(name === 'mode' ? '#appearance-mode' : `#${name}-theme`).selectOption(value);
  }
}

export async function checkAppearance(window) {
  await window.emulateMedia({ colorScheme: 'light' });
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'light');
  // Exercise the old saved settings through real renderer initialization.
  for (const mode of ['dark', 'light', 'system']) {
    await window.evaluate((mode) => localStorage.setItem('org-preview-theme', mode), mode);
    await window.reload();
    await expect(window.locator('#appearance-mode')).toHaveValue(mode);
    await expect(window.locator('#light-theme')).toHaveValue('light');
    await expect(window.locator('#dark-theme')).toHaveValue('dark');
    await expect(window.locator('html')).toHaveAttribute('data-theme', mode === 'dark' ? 'dark' : 'light');
  }
  await setAppearance(window, { light: 'solarized-light', dark: 'solarized-dark' });
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'solarized-light');
  await window.emulateMedia({ colorScheme: 'dark' });
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'solarized-dark');
  await setAppearance(window, { light: 'light' });
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'solarized-dark');
  await window.emulateMedia({ colorScheme: 'light' });
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'light');
  await setAppearance(window, { mode: 'light', light: 'solarized-light' });
  await window.emulateMedia({ colorScheme: 'dark' });
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'solarized-light');
  await setAppearance(window, { mode: 'dark', dark: 'dark' });
  await window.emulateMedia({ colorScheme: 'light' });
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark');
  await window.reload();
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(window.locator('#appearance-mode')).toHaveValue('dark');
  await expect(window.locator('#light-theme')).toHaveValue('solarized-light');
  await expect(window.locator('#dark-theme')).toHaveValue('dark');

  await expect(window.locator('#sans-serif-headings')).not.toBeChecked();
  await expect(window.locator('#document-title')).toHaveCSS('font-family', /Georgia/);
  await setAppearance(window, { sansSerifHeadings: true });
  const bodyFont = await window.locator('body').evaluate((element) => getComputedStyle(element).fontFamily);
  await expect(window.locator('#document-title')).toHaveCSS('font-family', bodyFont);
  await expect(window.locator('#content h2').first()).toHaveCSS('font-family', bodyFont);
  await window.reload();
  await expect(window.locator('#sans-serif-headings')).toBeChecked();
  await expect(window.locator('#document-title')).toHaveCSS('font-family', bodyFont);
  await setAppearance(window, { sansSerifHeadings: false });
  await expect(window.locator('#document-title')).toHaveCSS('font-family', /Georgia/);
  await expect(window.locator('#content h2').first()).toHaveCSS('font-family', /Georgia/);
  await window.keyboard.press('Escape');

  // Escape closes the panel and leaves an existing search untouched.
  await window.locator('#find-button').click();
  await window.locator('#search').fill('Read');
  await expect(window.locator('#search-count')).toContainText('/ 1');
  await window.locator('#appearance-button').focus();
  await window.keyboard.press('Enter');
  await expect(window.locator('#appearance-mode')).toBeFocused();
  await expect(window.locator('#appearance-button')).toHaveAttribute('aria-expanded', 'true');
  await window.keyboard.press('Tab');
  await expect(window.locator('#light-theme')).toBeFocused();
  await window.keyboard.press('Tab');
  await expect(window.locator('#dark-theme')).toBeFocused();
  await window.keyboard.press('Tab');
  await expect(window.locator('#sans-serif-headings')).toBeFocused();
  await window.keyboard.press('Space');
  await expect(window.locator('#sans-serif-headings')).toBeChecked();
  await window.keyboard.press('Escape');
  await expect(window.locator('#appearance-panel')).toBeHidden();
  await expect(window.locator('#appearance-button')).toBeFocused();
  await expect(window.locator('#appearance-button')).toHaveAttribute('aria-expanded', 'false');
  await expect(window.locator('#search')).toHaveValue('Read');
  await expect(window.locator('#search-count')).toContainText('/ 1');
  await window.locator('#appearance-button').click();
  await window.locator('#sidebar .sidebar-label').first().click();
  await expect(window.locator('#appearance-panel')).toBeHidden();
  await expect(window.locator('#appearance-button')).toHaveAttribute('aria-expanded', 'false');
  await window.locator('#close-search').click();
  await setAppearance(window, { mode: 'light', light: 'light', dark: 'dark', sansSerifHeadings: false });
  await window.keyboard.press('Escape');
}

export async function captureAppearances(window, prefix) {
  await window.locator('#find-button').click();
  await window.locator('#search').fill('Org');
  await expect(window.locator('#search-count')).toContainText('/');
  for (const [theme, mode, paper, ink] of [
    ['light', 'light', 'rgb(252, 251, 248)', 'rgb(48, 51, 47)'],
    ['dark', 'dark', 'rgb(32, 37, 35)', 'rgb(226, 228, 219)'],
    ['solarized-light', 'light', 'rgb(253, 246, 227)', 'rgb(101, 123, 131)'],
    ['solarized-dark', 'dark', 'rgb(0, 43, 54)', 'rgb(131, 148, 150)'],
  ]) {
    await setAppearance(window, { mode, [mode]: theme });
    await expect(window.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(window.locator('html')).toHaveCSS('color-scheme', mode);
    await expect(window.locator('body')).toHaveCSS('background-color', paper);
    await expect(window.locator('body')).toHaveCSS('color', ink);
    await window.screenshot({ path: `test-results/${prefix}-${theme}-appearance.png` });
    await setAppearance(window, { sansSerifHeadings: true });
    const bodyFont = await window.locator('body').evaluate((element) => getComputedStyle(element).fontFamily);
    for (const heading of await window.locator('#document :is(h1, h2, h3, h4, h5, h6)').all()) {
      await expect(heading).toHaveCSS('font-family', bodyFont);
    }
    await window.screenshot({ path: `test-results/${prefix}-${theme}-sans-headings.png` });
    await setAppearance(window, { sansSerifHeadings: false });
    await window.keyboard.press('Escape');
    await window.screenshot({ path: `test-results/${prefix}-${theme}.png` });
    await window.locator('#source-tab').click();
    await expect(window.locator('#source')).toHaveCSS('color', ink);
    await window.screenshot({ path: `test-results/${prefix}-${theme}-source.png` });
    await window.locator('#preview-tab').click();
  }
  await setAppearance(window, { mode: 'system', light: 'solarized-light', dark: 'solarized-dark', sansSerifHeadings: true });
  await window.emulateMedia({ media: 'print' });
  await expect(window.locator('#appearance-panel')).toBeHidden();
  await window.emulateMedia({ media: 'screen' });
  await window.keyboard.press('Escape');
  await window.locator('#close-search').click();
}
