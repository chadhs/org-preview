import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setAppearance } from './appearance-smoke.mjs';

export async function checkImages(window, directory, prefix) {
  const folder = path.join(directory, 'images café 日本語');
  await mkdir(folder);
  const formats = await window.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 300;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#eee8d5'; ctx.fillRect(0, 0, 1200, 300);
    ctx.fillStyle = '#268bd2'; ctx.fillRect(40, 40, 320, 220);
    ctx.fillStyle = '#859900'; ctx.fillRect(400, 40, 320, 220);
    ctx.fillStyle = '#cb4b16'; ctx.fillRect(760, 40, 400, 220);
    ctx.fillStyle = '#002b36'; ctx.font = 'bold 32px sans-serif';
    ctx.fillText('Local image preview', 60, 165);
    return Object.fromEntries(['png', 'jpeg', 'webp'].map((type) => [type, canvas.toDataURL(`image/${type}`).split(',')[1]]));
  });
  for (const [ext, data] of Object.entries(formats)) await writeFile(path.join(folder, `chart.${ext}`), Buffer.from(data, 'base64'));
  await writeFile(path.join(folder, 'small.gif'), Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="100"><rect width="800" height="100" fill="#268bd2"/><text x="20" y="60" font-size="32" fill="#002b36">A local SVG</text><script>globalThis.compromised = true</script><image href="https://tracker.invalid/remote.png" width="1" height="1"/></svg>';
  await writeFile(path.join(folder, 'diagram.svg'), svg);
  await writeFile(path.join(folder, 'invalid.png'), '<script>not an image</script>');
  const file = path.join(directory, 'image-previews.org');
  const source = `#+title: Image previews
* Local files
Images fit the reading column and keep their original proportions.

[[file:images café 日本語/chart.png]]

[[file:images café 日本語/diagram.svg]]

[[file:images café 日本語/chart.jpeg]]
[[file:images café 日本語/chart.webp]]
[[file:images café 日本語/small.gif]]

[[file:missing.png]]
[[file:images café 日本語/invalid.png]]
[[https://tracker.invalid/remote.png]]
[[file:images café 日本語/chart.png][A described image link]]

#+begin_export html
<img src="https://tracker.invalid/export.png" onerror="globalThis.compromised=true">
#+end_export
`;
  await writeFile(file, source);
  const remoteRequests = [];
  const onRequest = (request) => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()); };
  window.on('request', onRequest);
  try {
    await window.evaluate((file) => window.orgPreview.openPath(file), file);
    await expect(window.locator('#document-title')).toHaveText('Image previews');
    await expect(window.locator('.image-preview[data-loaded="true"]')).toHaveCount(5);
    await expect(window.locator('.image-preview[data-loaded="false"]')).toHaveCount(2);
    await expect(window.locator('#content img')).toHaveCount(5);
    await expect(window.locator('[data-image-id="5"]')).toContainText('Image not found');
    await expect(window.locator('[data-image-id="6"]')).toContainText('invalid image');
    await expect(window.locator('#error')).toBeHidden();
    expect(await window.evaluate(() => window.compromised)).toBeUndefined();
    expect(remoteRequests).toEqual([]);
    expect(await window.locator('#content img').evaluateAll((images) => images.every((image) => image.src.startsWith('data:image/') && image.naturalWidth > 0))).toBe(true);
    await expect(window.locator('[data-image-id="0"] img')).toHaveAttribute('alt', 'chart.png');
    await mkdir('test-results', { recursive: true });
    for (const mode of ['light', 'dark']) {
      await setAppearance(window, { mode, [mode]: `solarized-${mode}` });
      await window.keyboard.press('Escape');
      expect(await window.locator('[data-image-id="0"] img').evaluate((image) => image.getBoundingClientRect().width <= document.querySelector('#content').clientWidth)).toBe(true);
      await window.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await window.screenshot({ path: `test-results/${prefix}-images-${mode}.png` });
    }
    await window.locator('#source-tab').click();
    expect(await window.locator('#source').textContent()).toBe(source);
    await expect(window.locator('#source img')).toHaveCount(0);
    await window.locator('#preview-tab').click();
    await writeFile(path.join(folder, 'diagram.svg'), svg.replaceAll('800', '640'));
    await writeFile(file, source + '\nSaved again.');
    await expect(window.locator('#content')).toContainText('Saved again.');
    await expect(window.locator('.image-preview[data-loaded="true"]')).toHaveCount(5);
    expect(await window.locator('[data-image-id="1"] img').evaluate((image) => image.naturalWidth)).toBe(640);
    const rejected = await window.evaluate((file) => window.orgPreview.image(file, { start: 0, end: 10, reference: '[[file:secret.png]]' }), file);
    expect(rejected.error).toBeTruthy();
    await expect(window.locator('#error')).toBeHidden();
    const next = path.join(directory, 'without-images.org');
    await writeFile(next, '#+title: Without images\nOnly text.');
    await window.evaluate(async ([file, next]) => {
      await window.orgPreview.openPath(file);
      await window.orgPreview.openPath(next);
    }, [file, next]);
    await expect(window.locator('#document-title')).toHaveText('Without images');
    await expect(window.locator('#content img, .image-preview')).toHaveCount(0);
    const stale = await window.evaluate((file) => window.orgPreview.image(file, {}), file);
    expect(stale.error).toBeTruthy();
    expect(remoteRequests).toEqual([]);
  } finally { window.off('request', onRequest); }
}
