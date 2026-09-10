import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessions, MAX_TABS, MAX_SESSION_BYTES } from '../electron/sessions.cjs';

const document = (path, source = path, size = source.length) => ({ path, source, size, name: path.split('/').at(-1), modified: 1 });
function setup(options = {}) {
  const watchers = new Map(), events = [], stopped = [];
  const sessions = createSessions({
    read: async (path) => document(path), canonicalize: async (path) => path,
    watch: (path, change, error) => { watchers.set(path, { change, error }); return () => stopped.push(path); },
    changed: (state) => events.push(state), ...options,
  });
  return { sessions, watchers, events, stopped };
}

test('sessions preserve all watchers, canonical identity, order and background revisions', async () => {
  const { sessions, watchers, events, stopped } = setup({ canonicalize: async (path) => path.replace('/alias/', '/') });
  await sessions.openMany(['/a.org', '/b.org']);
  const [a, b] = sessions.snapshot().tabs;
  watchers.get('/a.org').change(document('/a.org', 'Updated A'));
  assert.equal(sessions.active().id, b.id);
  assert.equal(events.at(-1).document, undefined);
  assert.equal(sessions.snapshot().tabs[0].revision, 2);
  await sessions.openMany(['/alias/a.org']);
  assert.equal(sessions.snapshot().tabs.length, 2);
  assert.equal(sessions.active().id, a.id);
  assert.equal(sessions.active().source, 'Updated A');
  assert.deepEqual(stopped, []);
  sessions.close(a.id);
  assert.equal(sessions.active().id, b.id);
  watchers.get('/a.org').change(document('/a.org', 'Late update'));
  assert.equal(sessions.snapshot().tabs.length, 1);
  assert.deepEqual(stopped, ['/a.org']);
  sessions.close(b.id);
  assert.equal(sessions.snapshot().document, null);
});

test('a background error does not replace the active document and clears on recovery', async () => {
  const { sessions, watchers } = setup();
  await sessions.openMany(['/a.org', '/b.org']);
  watchers.get('/a.org').error(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  assert.match(sessions.snapshot().tabs[0].error, /File unavailable/);
  assert.equal(sessions.active().path, '/b.org');
  watchers.get('/a.org').change(document('/a.org', 'Recovered'));
  assert.equal(sessions.snapshot().tabs[0].error, '');
});

test('a failed initial open exposes the empty state and duplicate opens do not rerender', async () => {
  const { sessions, events } = setup({ read: async (path) => {
    if (path === 'bad') throw new Error('Bad file');
    return document(path);
  } });
  const failed = await sessions.openMany(['bad']);
  assert.equal(failed.document, null);
  assert.equal(failed.tabs.length, 0);
  assert.match(failed.openError, /Bad file/);
  await sessions.openMany(['a', 'b']);
  await sessions.openMany(['b']);
  assert.equal(events.at(-1).document, undefined);
  sessions.close(sessions.snapshot().tabs[0].id);
  assert.equal(events.at(-1).document, undefined);
});

test('batch failures preserve valid files and concurrent batches retain request order', async () => {
  const { sessions } = setup({ read: async (path) => {
    if (path === 'bad') throw new Error('Bad file');
    await new Promise((resolve) => setTimeout(resolve, path === 'a' ? 10 : 0));
    return document(path);
  } });
  const first = sessions.openMany(['a', 'bad', 'b']);
  const second = sessions.openMany(['c']);
  assert.match((await first).openError, /Bad file/);
  await second;
  assert.deepEqual(sessions.snapshot().tabs.map((tab) => tab.path), ['a', 'b', 'c']);
  assert.equal(sessions.active().path, 'c');
});

test('disposing a session invalidates queued reads and all watchers', async () => {
  let finish;
  const { sessions, stopped } = setup({ read: (path) => path === 'slow'
    ? new Promise((resolve) => { finish = () => resolve(document(path)); }) : Promise.resolve(document(path)) });
  await sessions.openMany(['a']);
  const opening = sessions.openMany(['slow', 'later']);
  await new Promise(setImmediate);
  sessions.dispose();
  finish();
  await opening;
  assert.equal(sessions.snapshot().tabs.length, 0);
  assert.deepEqual(stopped, ['a']);
  await sessions.openMany(['new']);
  assert.equal(sessions.active().path, 'new');
});

test('tab and byte limits retain existing tabs and reject oversized background updates', async () => {
  const { sessions, watchers } = setup({ read: async (path) => document(path, '', path === 'large' ? MAX_SESSION_BYTES : 1) });
  await sessions.openMany(['a', 'large', 'b']);
  assert.deepEqual(sessions.snapshot().tabs.map((tab) => tab.path), ['a', 'b']);
  watchers.get('a').change(document('a', '', MAX_SESSION_BYTES));
  assert.match(sessions.snapshot().tabs[0].error, /64 MiB/);
  assert.equal(sessions.snapshot().tabs[0].revision, 1);
  await sessions.openMany(Array.from({ length: MAX_TABS }, (_, i) => String(i)));
  assert.equal(sessions.snapshot().tabs.length, MAX_TABS);
});

test('image completions are rejected after switching, closing or saving a document', async () => {
  let finish;
  const { sessions, watchers } = setup({ imageReader: () => () => new Promise((resolve) => { finish = resolve; }) });
  await sessions.openMany(['a', 'b']);
  const [a, b] = sessions.snapshot().tabs;
  for (const change of [() => sessions.activate(a.id), () => watchers.get('b').change(document('b', 'save')), () => sessions.close(b.id)]) {
    sessions.activate(b.id);
    const reading = sessions.image('b', {}, sessions.active().revision);
    change();
    finish({ dataUrl: 'data:image/png;base64,abc' });
    assert.match((await reading).error, /changed/);
  }
});
