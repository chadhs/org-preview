import test from 'node:test';
import assert from 'node:assert/strict';
import { documentArgument, documentArguments } from '../electron/arguments.cjs';

test('development and packaged command lines keep Unicode and unsupported paths', () => {
  for (const file of ['notes café 日本語.org', 'unsupported.txt', 'large.org']) {
    assert.equal(documentArgument(['electron', '.', '--ozone-platform=wayland', file], false), file);
    assert.equal(documentArgument(['org-preview', '--ozone-platform=x11', file], true), file);
  }
  assert.equal(documentArgument(['electron', '.', '--ozone-platform=wayland'], false), undefined);
  assert.equal(documentArgument(['org-preview', '--', '-notes.org'], true), '-notes.org');
});


test('desktop file URLs resolve locally without treating remote URLs as files', () => {
  const url = 'file:///tmp/notes%20caf%C3%A9%20%E6%97%A5%E6%9C%AC%E8%AA%9E.org';
  assert.equal(documentArgument(['org-preview', url], true), '/tmp/notes café 日本語.org');
  assert.equal(documentArgument(['electron', '.', url], false), '/tmp/notes café 日本語.org');
  for (const unsupported of ['https://example.com/notes.org', 'file://remote-host/notes.org', 'file:///tmp/bad%2Fpath.org']) {
    assert.equal(documentArgument(['org-preview', unsupported], true), unsupported);
  }
});


test('second-instance Chromium flag reordering does not turn the app path into a document', () => {
  const flags = ['--user-data-dir=/tmp/profile', '--allow-file-access-from-files', '--enable-avfoundation'];
  assert.equal(documentArgument(['electron', ...flags, '.', 'file:///tmp/notes%20caf%C3%A9.org'], false), '/tmp/notes café.org');
  assert.equal(documentArgument(['electron', ...flags, '/source/org-preview', 'notes.org'], false), 'notes.org');
  assert.equal(documentArgument(['org-preview', ...flags, 'notes.org'], true), 'notes.org');
});

test('multi-file invocations preserve order, Unicode URLs and explicit dash-prefixed paths', () => {
  assert.deepEqual(documentArguments(['electron', '--user-data-dir=/tmp/profile', '.', 'a.org', 'file:///tmp/b%20c.org', '--ozone-platform=x11'], false), ['a.org', '/tmp/b c.org']);
  assert.deepEqual(documentArguments(['org-preview', '--', '-a.org', 'b.org'], true), ['-a.org', 'b.org']);
});
