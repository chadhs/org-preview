import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readDocument, watchDocument, MAX_BYTES } from '../electron/documents.cjs';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await delay(30); } throw new Error('Timed out waiting for file watch'); }

test('reads Org files and rejects invalid types, directories and oversized input', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'org-preview-'));
  try {
    const file = path.join(dir, 'notes.ORG');
    await writeFile(file, '* Hello\nUnicode: 日本語');
    assert.match((await readDocument(file)).source, /日本語/);
    await assert.rejects(readDocument(path.join(dir, 'notes.md')), /Choose an .org/);
    await mkdir(path.join(dir, 'folder.org'));
    await assert.rejects(readDocument(path.join(dir, 'folder.org')), /directory/);
    await writeFile(file, Buffer.alloc(MAX_BYTES + 1));
    await assert.rejects(readDocument(file), /up to 16 MiB/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('reads the full 16 MiB limit, including UTF-8 characters across read chunks', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'org-preview-large-'));
  try {
    const file = path.join(dir, 'large.org');
    const source = 'a'.repeat(65535) + '日本語' + 'b'.repeat(MAX_BYTES - 65535 - 9);
    await writeFile(file, source);
    const doc = await readDocument(file);
    assert.equal(doc.size, MAX_BYTES);
    assert.equal(doc.source, source);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('watches normal saves, atomic replacements, deletion and recreation; stops cleanly', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'org-preview-'));
  const file = path.join(dir, 'notes.org');
  const changes = [], errors = [];
  await writeFile(file, '* Initial');
  const stop = watchDocument(file, (doc) => changes.push(doc.source), (error) => errors.push(error.code), 30);
  try {
    await delay(80);
    await writeFile(file, '* Saved');
    await until(() => changes.includes('* Saved'));
    await writeFile(path.join(dir, 'replacement'), '* Atomic');
    await rename(path.join(dir, 'replacement'), file);
    await until(() => changes.includes('* Atomic'));
    await rm(file);
    await until(() => errors.includes('ENOENT'));
    await writeFile(file, '* Returned');
    await until(() => changes.includes('* Returned'));
    stop();
    const count = changes.length;
    await writeFile(file, '* After stop');
    await delay(120);
    assert.equal(changes.length, count);
  } finally { stop(); await rm(dir, { recursive: true, force: true }); }
});
