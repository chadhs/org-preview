import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createImageReader, MAX_IMAGE_BYTES, MAX_DOCUMENT_IMAGE_BYTES } from '../electron/images.cjs';
import { renderOrg } from '../src/org.js';
import { MAX_IMAGE_LINKS } from '../electron/image-links.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ioAAAAASUVORK5CYII=', 'base64');
const request = (source, reference) => ({ reference, start: source.indexOf(reference), end: source.indexOf(reference) + reference.length });

test('Org local image links produce placeholders and verified source positions', () => {
  const source = '#+title: Café 日本語\n[[file:images/chart.png]]\n[[./photo.JPG]]\n[[../diagram.svg]]\n[[file:photo.png][A description]]\n[[https://example.com/photo.png]]\n#+begin_src org\n[[file:code.png]]\n#+end_src';
  const result = renderOrg(source);
  assert.equal(result.images.length, 3);
  for (const image of result.images) assert.equal(source.slice(image.start, image.end), image.reference);
  assert.match(result.html, /data-image-id="0"/);
  assert.doesNotMatch(result.html, /<img\b/);
  assert.match(result.html, /href="https:\/\/example.com\/photo.png"/);
  assert.match(result.html, /A description/);
  const many = renderOrg('[[file:photo.png]]\n'.repeat(MAX_IMAGE_LINKS + 1));
  assert.equal(many.images.length, MAX_IMAGE_LINKS);
  assert.match(many.html, /Image limit reached/);
});

test('local images resolve relative paths, parents, absolute paths, file URLs, spaces and Unicode', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'org-preview-images-'));
  try {
    await mkdir(path.join(dir, 'notes'));
    const file = path.join(dir, 'café 日本語.png');
    await writeFile(file, png);
    const references = [`[[file:../café 日本語.png]]`, `[[file:${file}]]`, `[[${pathToFileURL(file).href}]]`, '[[file:../caf%C3%A9%20%E6%97%A5%E6%9C%AC%E8%AA%9E.png]]'];
    const doc = { path: path.join(dir, 'notes', 'notes.org'), source: references.join('\n') };
    const read = createImageReader(doc);
    for (const reference of references) {
      assert.deepEqual(await read(request(doc.source, reference)), { dataUrl: `data:image/png;base64,${png.toString('base64')}` });
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('image reads reject forged references, remote paths, directories, invalid files and oversized files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'org-preview-images-'));
  try {
    await writeFile(path.join(dir, 'bad.png'), '<script>not an image</script>');
    await mkdir(path.join(dir, 'folder.png'));
    const handle = await open(path.join(dir, 'large.png'), 'w');
    await handle.truncate(MAX_IMAGE_BYTES + 1);
    await handle.close();
    const references = ['[[file:missing.png]]', '[[file:bad.png]]', '[[file:folder.png]]', '[[file:large.png]]', '[[https://example.com/a.png]]', '[[file://remote-host/a.png]]'];
    const doc = { path: path.join(dir, 'notes.org'), source: references.join('\n') };
    const read = createImageReader(doc);
    for (const reference of references) {
      const result = await read(request(doc.source, reference));
      assert.equal(typeof result.error, 'string');
      assert.equal(result.dataUrl, undefined);
    }
    assert.match((await read({ ...request(doc.source, references[0]), reference: '[[file:secret.png]]' })).error, /changed/);
    for (const invalid of [null, {}, { start: -1, end: 2 }, { start: 0, end: doc.source.length + 1 }]) {
      assert.match((await read(invalid)).error, /Invalid image reference/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('image loading has a per-document byte budget and refreshes on a new document revision', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'org-preview-images-'));
  try {
    const count = MAX_DOCUMENT_IMAGE_BYTES / MAX_IMAGE_BYTES;
    const references = [];
    for (let index = 0; index <= count; index++) {
      const name = `${index}.png`;
      references.push(`[[file:${name}]]`);
      const handle = await open(path.join(dir, name), 'w');
      await handle.write(png);
      await handle.truncate(MAX_IMAGE_BYTES);
      await handle.close();
    }
    const doc = { path: path.join(dir, 'notes.org'), source: references.join('\n') };
    const read = createImageReader(doc);
    const results = await Promise.all(references.map((reference) => read(request(doc.source, reference))));
    assert.ok(results.slice(0, count).every((result) => result.dataUrl?.startsWith('data:image/png;base64,')));
    assert.match(results[count].error, /Image limit reached/);
    assert.ok((await read(request(doc.source, references[0]))).dataUrl);
    assert.ok((await createImageReader(doc)(request(doc.source, references[count]))).dataUrl);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
