import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePreferences, readPreferences, savePreferences, resolveTheme } from '../src/appearance.js';

function storage(entries = []) {
  const values = new Map(entries);
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('new and existing installations keep their appearance mode and default themes', () => {
  assert.deepEqual(readPreferences(storage()), { mode: 'system', light: 'light', dark: 'dark', sansSerifHeadings: false });
  for (const mode of ['system', 'light', 'dark']) {
    assert.deepEqual(readPreferences(storage([['org-preview-theme', mode]])), { mode, light: 'light', dark: 'dark', sansSerifHeadings: false });
  }
});

test('invalid settings fall back independently without losing valid preferences', () => {
  assert.deepEqual(normalizePreferences({ mode: 'sepia', light: 'solarized-light', dark: 'unknown' }), {
    mode: 'system', light: 'solarized-light', dark: 'dark', sansSerifHeadings: false,
  });
  for (const light of [undefined, null, '', 'dark', 'solarized-dark']) {
    assert.deepEqual(normalizePreferences({ mode: 'dark', light, dark: 'solarized-dark' }), {
      mode: 'dark', light: 'light', dark: 'solarized-dark', sansSerifHeadings: false,
    });
  }
  for (const dark of [undefined, null, '', 'light', 'solarized-light']) {
    assert.equal(normalizePreferences({ dark }).dark, 'dark');
  }
});

test('preferences persist separately while the legacy key continues to store mode', () => {
  const saved = storage();
  const preferences = { mode: 'system', light: 'solarized-light', dark: 'solarized-dark', sansSerifHeadings: true };
  savePreferences(saved, preferences);
  assert.equal(saved.getItem('org-preview-theme'), 'system');
  assert.equal(saved.getItem('org-preview-light-theme'), 'solarized-light');
  assert.equal(saved.getItem('org-preview-dark-theme'), 'solarized-dark');
  assert.equal(saved.getItem('org-preview-sans-serif-headings'), 'true');
  assert.deepEqual(readPreferences(saved), preferences);
  savePreferences(saved, { ...preferences, light: 'dark' });
  assert.deepEqual(readPreferences(saved), { ...preferences, light: 'light' });
  savePreferences(saved, { ...preferences, sansSerifHeadings: false });
  assert.equal(readPreferences(saved).sansSerifHeadings, false);
});

test('System resolves every preferred pair using OS appearance; manual modes ignore it', () => {
  for (const light of ['light', 'solarized-light']) {
    for (const dark of ['dark', 'solarized-dark']) {
      for (const systemDark of [false, true]) {
        assert.deepEqual(resolveTheme({ mode: 'system', light, dark }, systemDark), {
          theme: systemDark ? dark : light, colorScheme: systemDark ? 'dark' : 'light',
        });
        assert.deepEqual(resolveTheme({ mode: 'light', light, dark }, systemDark), { theme: light, colorScheme: 'light' });
        assert.deepEqual(resolveTheme({ mode: 'dark', light, dark }, systemDark), { theme: dark, colorScheme: 'dark' });
      }
    }
  }
});
