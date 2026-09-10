import { expect } from '@playwright/test';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { setAppearance } from './appearance-smoke.mjs';

export async function checkTabsAndDiagrams(app, window, directory, prefix) {
  const original = await window.evaluate(() => window.orgPreview.initial());
  const a = path.join(directory, 'tabs-a.org');
  const b = path.join(directory, 'tabs-b.org');
  const c = path.join(directory, 'tabs-c.org');
  const source = '#+title: Tab A\n* Reading\nneedle one\n\n' + 'A paragraph for scrolling.\n\n'.repeat(80) + 'needle two\n';
  await writeFile(a, source);
  await writeFile(b, '#+title: Tab B\n* Background\nSecond document.');
  await writeFile(c, '#+title: Diagrams\n* Workflow\n#+name: workflow\n#+begin_src mermaid :file chart.svg\nflowchart LR\n  A[Draft] --> B{Review}\n  B -->|Approved| C[Publish]\n  B -->|Changes| A\n#+end_src\n\n#+RESULTS: workflow\n[[file:chart.svg]]\n\n* Conversation\n#+begin_src mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Ready\n#+end_src\n\n* Invalid\n#+begin_src mermaid\nnot a diagram\n#+end_src\n\n* Configuration\n#+begin_src mermaid\n%%{init: {"securityLevel": "loose"}}%%\nflowchart LR\n A-->B\n#+end_src');
  await writeFile(path.join(directory, 'chart.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><text x="5" y="40">Saved Babel result</text></svg>');
  await app.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, [a, b]);
  await window.locator('#open').click();
  await expect(window.locator('#document-title')).toHaveText('Tab B');
  const state = await window.evaluate(() => window.orgPreview.initial());
  const aId = state.tabs.find((tab) => tab.path === a).id;
  const bId = state.tabs.find((tab) => tab.path === b).id;
  await expect(window.locator('#document-title')).toHaveText('Tab B');
  await window.locator(`#tab-${aId}`).click();
  await expect(window.locator('#document-title')).toHaveText('Tab A');
  await window.locator('#find-button').click();
  await window.locator('#search').fill('needle');
  await window.locator('#search').press('Enter');
  await expect(window.locator('#search-count')).toHaveText('2 / 2');
  await window.locator('#reader').evaluate((reader) => { reader.scrollTop = 700; });
  await window.locator('#source-tab').click();
  await window.locator('#reader').evaluate((reader) => { reader.scrollTop = 400; });
  await window.locator(`#tab-${bId}`).click();
  await expect(window.locator('#document-title')).toHaveText('Tab B');
  await expect(window.locator('#search-bar')).toBeHidden();
  await writeFile(a, source.replace('Tab A', 'Saved Tab A'));
  await expect.poll(async () => (await window.evaluate(() => window.orgPreview.initial())).tabs.find((tab) => tab.id === aId).revision).toBe(2);
  await expect(window.locator('#document-title')).toHaveText('Tab B');
  await window.evaluate((file) => window.orgPreview.openPath(file), a);
  await expect(window.locator('#document-title')).toHaveText('Saved Tab A');
  await expect(window.locator('#source')).toBeVisible();
  await expect(window.locator('#search-count')).toHaveText('2 / 2');
  expect(await window.locator('#reader').evaluate((reader) => reader.scrollTop)).toBe(400);
  await window.locator('#preview-tab').click();
  expect(await window.locator('#reader').evaluate((reader) => reader.scrollTop)).toBe(700);
  await expect(window.locator('#document-tabs [role="tab"]')).toHaveCount(original.tabs.length + 2);
  await window.locator(`#tab-${aId}`).focus();
  await window.keyboard.press('ArrowRight');
  await expect(window.locator(`#tab-${bId}`)).toHaveAttribute('aria-selected', 'true');
  await expect(window.locator(`#tab-${bId}`)).toBeFocused();
  await window.keyboard.press('Control+Shift+Tab');
  await expect(window.locator(`#tab-${aId}`)).toHaveAttribute('aria-selected', 'true');
  await window.keyboard.press('Control+Tab');
  await expect(window.locator(`#tab-${bId}`)).toHaveAttribute('aria-selected', 'true');
  await rm(a);
  await expect(window.locator(`#tab-${aId}`)).toContainText('⚠');
  await expect(window.locator('#error')).toBeHidden();
  await window.locator(`#tab-${aId}`).click();
  await expect(window.locator('#error')).toContainText('File unavailable');
  await writeFile(a, source);
  await expect(window.locator('#error')).toBeHidden();
  await window.evaluate((file) => window.orgPreview.openPath(file), c);
  await expect(window.locator('#document-title')).toHaveText('Diagrams');
  await expect(window.locator('.diagram[data-rendered="true"]')).toHaveCount(2, { timeout: 20000 });
  await expect(window.locator('.diagram[data-rendered="false"]')).toHaveCount(2);
  await expect(window.locator('.diagram').nth(2)).toContainText('Diagram unavailable');
  await expect(window.locator('.diagram').nth(3)).toContainText('configuration directives');
  await expect(window.locator('.image-preview')).toBeHidden();
  await expect(window.locator('.diagram details').first()).not.toHaveAttribute('open');
  await window.locator('.diagram summary').first().click();
  await expect(window.locator('.diagram pre').first()).toBeVisible();
  await expect(window.locator('.diagram pre').first()).toContainText('A[Draft]');
  expect(await window.locator('.diagram-output img').evaluateAll((images) => images.every((image) => image.naturalWidth > 0))).toBe(true);
  await mkdir('test-results', { recursive: true });
  for (const theme of ['light', 'dark', 'solarized-light', 'solarized-dark']) {
    const previousTheme = await window.locator('html').getAttribute('data-theme');
    const previous = await window.locator('.diagram-output img').evaluateAll((images) => images.map((img) => img.src));
    await setAppearance(window, { mode: theme.endsWith('dark') ? 'dark' : 'light', [theme.endsWith('dark') ? 'dark' : 'light']: theme });
    await window.keyboard.press('Escape');
    console.log(`Checking Mermaid appearance: ${theme}`);
    if (previousTheme !== theme) {
      for (let index = 0; index < 2; index++) await expect.poll(() => window.locator('.diagram-output img').nth(index).getAttribute('src')).not.toBe(previous[index]);
    }
    await window.locator('#reader').evaluate((reader) => { reader.scrollTop = 0; });
    await window.screenshot({ path: `test-results/${prefix}-tabs-mermaid-${theme}.png` });
  }
  await window.locator('.diagram').nth(1).scrollIntoViewIfNeeded();
  await window.screenshot({ path: `test-results/${prefix}-mermaid-sequence.png` });
  // A save racing with a tab switch must never put a diagram in the other file.
  await writeFile(c, '#+title: Updated diagrams\n#+begin_src mermaid\nflowchart LR\n New-->Saved\n#+end_src');
  await window.evaluate((id) => window.orgPreview.activate(id), bId);
  await expect(window.locator('#document-title')).toHaveText('Tab B');
  await expect(window.locator('.diagram')).toHaveCount(0);
  await window.evaluate((file) => window.orgPreview.openPath(file), c);
  await expect(window.locator('#document-title')).toHaveText('Updated diagrams');
  await expect(window.locator('.diagram[data-rendered="true"]')).toHaveCount(1);
  // Diagram work has a distinct renderer process and a real termination bound.
  const processIds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((win) => win.webContents.getOSProcessId()));
  expect(new Set(processIds).size).toBe(2);
  await app.evaluate(({ BrowserWindow }) => {
    const helper = BrowserWindow.getAllWindows().find((win) => win.getTitle() === 'Diagram renderer');
    void helper.webContents.executeJavaScript('while (true) {}').catch(() => {});
  });
  await window.evaluate(async () => {
    const { document: doc } = await window.orgPreview.initial();
    const start = doc.source.indexOf('#+begin_src');
    const end = doc.source.indexOf('#+end_src') + '#+end_src'.length;
    window.diagramTimeoutResult = null;
    void window.orgPreview.diagram(doc.id, doc.revision, { start, end }, document.documentElement.dataset.theme).then((result) => { window.diagramTimeoutResult = result; });
  });
  await window.locator('#source-tab').click();
  await expect(window.locator('#source')).toBeVisible();
  await expect.poll(() => window.evaluate(() => window.diagramTimeoutResult?.error), { timeout: 10000 }).toContain('5-second');
  await window.locator('#preview-tab').click();
  // The helper restarts on the next render, and unsafe content stays inert.
  const safety = '#+title: Safety\n#+begin_src mermaid\nflowchart LR\n A["<img src=https://tracker.invalid/image onerror=alert(1)>"] --> B[Safe]\n click B "https://tracker.invalid/click"\n#+end_src';
  await writeFile(c, safety);
  await expect(window.locator('#document-title')).toHaveText('Safety');
  await expect(window.locator('.diagram[data-rendered="true"]')).toHaveCount(1);
  const svg = await window.locator('.diagram-output img').evaluate((img) => decodeURIComponent(img.src.split(',').slice(1).join(',')));
  expect(svg).not.toMatch(/<(?:script|foreignObject|image|a)(?:\s|>)/i);
  expect(svg).not.toMatch(/\s(?:href|onerror|onclick)=/i);
  expect(await window.evaluate(() => window.compromised)).toBeUndefined();
  // Rendering failure must restore an existing Babel image, never hide it.
  await writeFile(c, '#+title: Fallback\n#+begin_src mermaid\nnot a diagram\n#+end_src\n\n#+RESULTS:\n[[file:chart.svg]]');
  await expect(window.locator('#document-title')).toHaveText('Fallback');
  await expect(window.locator('.diagram[data-rendered="false"]')).toHaveCount(1);
  await expect(window.locator('.image-preview img')).toBeVisible();
  await expect(window.locator('.diagram pre')).toBeVisible();
  // A valid file still opens after a failure in the same batch.
  await window.evaluate((files) => window.orgPreview.openPaths(files), [path.join(directory, 'missing.org'), b]);
  await expect(window.locator('#document-title')).toHaveText('Tab B');
  await expect(window.locator('#error')).toContainText('missing.org');
  await window.evaluate((id) => window.orgPreview.activate(id), bId);
  await expect(window.locator('#error')).toBeHidden();
  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+w' : 'Control+w');
  await expect(window.locator(`#tab-${bId}`)).toHaveCount(0);
  const cdp = await window.context().newCDPSession(window);
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await cdp.send('Input.dispatchDragEvent', { type, x: 500, y: 300, data: { items: [], files: [a, b], dragOperationsMask: 1 } });
  }
  await expect(window.locator('#document-title')).toHaveText('Tab B');
  await cdp.detach();
  // Closing every tab leaves a usable empty reader, and the picker can reopen.
  const all = await window.evaluate(() => window.orgPreview.initial());
  for (const tab of all.tabs) await window.evaluate((id) => window.orgPreview.close(id), tab.id);
  await expect(window.locator('#empty-state')).toBeVisible();
  await expect(window.locator('#document-tabs [role="tab"]')).toHaveCount(0);
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, b);
  await window.locator('#empty-open').click();
  await expect(window.locator('#document-title')).toHaveText('Tab B');
  console.log('Tabs and Mermaid smoke passed.');
}
