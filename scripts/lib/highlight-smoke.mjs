import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setAppearance } from './appearance-smoke.mjs';

export async function checkHighlighting(window, directory, prefix) {
  const file = path.join(directory, 'highlighting.org');
  const large = '// <large> & ' + 'x'.repeat(60_000);
  const source = `#+title: Syntax highlighting
* Code examples
#+begin_src js
// Greet the reader.
const message = "Hello, Org!";
function greet(name) {
  return message + name;
}
console.log(greet("reader"));
#+end_src

#+begin_src python
def greet(name):
    return f"Hello, {name}!"
#+end_src

#+begin_src emacs-lisp
(message "Hello from Emacs")
#+end_src

#+begin_src html
<script>globalThis.compromised = true</script>
<img src="https://tracker.invalid/pixel" onerror="alert(1)">
#+end_src

#+begin_src unknown-language
const plain = "<plain>";
#+end_src

#+begin_example
const example = "<example>";
#+end_example

#+begin_src js
${large}
#+end_src
`;
  await writeFile(file, source);
  const remoteRequests = [];
  const onRequest = (request) => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()); };
  window.on('request', onRequest);
  try {
    await window.evaluate((file) => window.orgPreview.openPath(file), file);
    await expect(window.locator('#document-title')).toHaveText('Syntax highlighting');
    const blocks = window.locator('.code-block code');
    await expect(blocks).toHaveCount(7);
    await expect(blocks.nth(0)).toHaveText('// Greet the reader.\nconst message = "Hello, Org!";\nfunction greet(name) {\n  return message + name;\n}\nconsole.log(greet("reader"));');
    await expect(blocks.nth(1).locator('.hljs-keyword').first()).toHaveText('def');
    await expect(blocks.nth(2).locator('.hljs-string')).toHaveText('"Hello from Emacs"');
    await expect(blocks.nth(3)).toHaveText('<script>globalThis.compromised = true</script>\n<img src="https://tracker.invalid/pixel" onerror="alert(1)">');
    await expect(window.locator('#content script, #content img')).toHaveCount(0);
    expect(await window.evaluate(() => window.compromised)).toBeUndefined();
    for (const index of [4, 5, 6]) await expect(blocks.nth(index).locator('span')).toHaveCount(0);
    expect(await blocks.nth(6).textContent()).toBe(large);

    await window.locator('#find-button').click();
    await window.locator('#search').fill('const message');
    await expect(window.locator('#search-count')).toHaveText('1 / 1');
    expect(await window.evaluate(() => [...CSS.highlights.get('search-active')][0].toString())).toBe('const message');
    await window.evaluate(() => { window.highlightedCode = document.querySelector('.code-block code').firstChild; });
    await mkdir('test-results', { recursive: true });
    for (const [theme, mode, keywordColor] of [
      ['light', 'light', 'rgb(125, 80, 132)'], ['dark', 'dark', 'rgb(199, 161, 205)'],
      ['solarized-light', 'light', 'rgb(133, 153, 0)'], ['solarized-dark', 'dark', 'rgb(133, 153, 0)'],
    ]) {
      await setAppearance(window, { mode, [mode]: theme, sansSerifHeadings: false });
      await expect(blocks.nth(0).locator('.hljs-keyword').first()).toHaveCSS('color', keywordColor);
      expect(await window.evaluate(() => window.highlightedCode === document.querySelector('.code-block code').firstChild)).toBe(true);
      await expect(window.locator('#search-count')).toHaveText('1 / 1');
      await window.keyboard.press('Escape');
      await window.locator('#reader').evaluate((reader) => { reader.scrollTop = 0; });
      await window.screenshot({ path: `test-results/${prefix}-${theme}-code.png` });
    }
    await window.locator('#source-tab').click();
    expect(await window.locator('#source').textContent()).toBe(source);
    await expect(window.locator('#source span')).toHaveCount(0);
    await window.locator('#preview-tab').click();
    await window.locator('#reader').evaluate((reader) => { reader.scrollTop = 300; });
    await writeFile(file, source.replace('Hello, Org!', 'Updated, Org!'));
    await expect(blocks.nth(0).locator('.hljs-string').first()).toHaveText('"Updated, Org!"');
    await expect(window.locator('#search-count')).toHaveText('1 / 1');
    expect(await window.locator('#reader').evaluate((reader) => reader.scrollTop)).toBe(300);
    expect(remoteRequests).toEqual([]);
    await window.locator('#close-search').click();
  } finally {
    window.off('request', onRequest);
  }
}
