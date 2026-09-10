import test from 'node:test';
import assert from 'node:assert/strict';
import { updateTitlebar } from '../electron/titlebar.cjs';

test('native control colors follow each theme and reject arbitrary settings', () => {
  const backgrounds = [], overlays = [];
  const window = { setBackgroundColor: (color) => backgrounds.push(color), setTitleBarOverlay: (value) => overlays.push(value) };
  for (const platform of ['darwin', 'linux']) {
    for (const theme of ['light', 'dark', 'solarized-light', 'solarized-dark']) updateTitlebar(window, theme, platform);
  }
  assert.equal(overlays.length, 4);
  assert.deepEqual(backgrounds.slice(0, 4), backgrounds.slice(4));
  assert.deepEqual(overlays[3], { color: '#073642', symbolColor: '#839496', height: 44 });
  assert.throws(() => updateTitlebar(window, '__proto__'), /Invalid/);
  assert.equal(backgrounds.length, 8);
});
