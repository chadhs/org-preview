import test from 'node:test';
import assert from 'node:assert/strict';
import { documentArgument } from '../electron/arguments.cjs';

test('development and packaged command lines keep Unicode and unsupported paths', () => {
  for (const file of ['notes café 日本語.org', 'unsupported.txt', 'large.org']) {
    assert.equal(documentArgument(['electron', '.', '--ozone-platform=wayland', file], false), file);
    assert.equal(documentArgument(['org-preview', '--ozone-platform=x11', file], true), file);
  }
  assert.equal(documentArgument(['electron', '.', '--ozone-platform=wayland'], false), undefined);
  assert.equal(documentArgument(['org-preview', '--', '-notes.org'], true), '-notes.org');
});
