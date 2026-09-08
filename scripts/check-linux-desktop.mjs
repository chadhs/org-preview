import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2];
if (!root) throw new Error('Pass the extracted AppImage directory.');
const desktop = await readFile(path.join(root, 'org-preview.desktop'), 'utf8');
const fields = Object.fromEntries(desktop.split('\n').filter((line) => line.includes('=')).map((line) => {
  const index = line.indexOf('=');
  return [line.slice(0, index), line.slice(index + 1)];
}));
assert.equal(fields.Name, 'Org Preview');
assert.equal(fields.Type, 'Application');
assert.equal(fields.Terminal, 'false');
assert.equal(fields.StartupWMClass, 'org-preview');
assert.equal(fields.Icon, 'org-preview');
assert.match(fields.Exec, /^AppRun %U$/);
assert.doesNotMatch(fields.Exec, /--no-sandbox|--disable.*sandbox/);
assert.match(fields.Categories, /(?:^|;)Office;/);
for (const mime of ['text/org', 'text/x-org']) assert.ok(fields.MimeType.split(';').includes(mime));
assert.ok(fields.Keywords.includes('Emacs;'));
const icon = await readFile(path.join(root, '.DirIcon'));
const iconDirectory = new URL('../build/icons/', import.meta.url);
const sources = await Promise.all((await readdir(iconDirectory)).map((name) => readFile(new URL(name, iconDirectory))));
assert.ok(sources.some((source) => source.equals(icon)), 'AppImage must contain the Org Preview icon');
console.log(desktop.trim());
console.log('AppImage desktop metadata, local file arguments, sandbox flags, and icon verified.');
