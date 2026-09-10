import test from 'node:test';
import assert from 'node:assert/strict';
import { tabLabel } from '../src/tabs.js';

test('duplicate filenames use the shortest distinct parent context', () => {
  const tabs = ['/work/client/notes.org', '/home/client/notes.org', '/日本語/notes.org', '/home/todo.org']
    .map((path, id) => ({ id, path, name: path.split('/').at(-1) }));
  assert.deepEqual(tabs.map((tab) => tabLabel(tab, tabs)), ['work/client/notes.org', 'home/client/notes.org', '日本語/notes.org', 'todo.org']);
  assert.equal(tabLabel(tabs[0], [tabs[0]]), 'notes.org');
});
