import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { planRelease, parseVersion, stampVersion, assetNames, verifyAssets, sha256, assertMainRelease, uploadAndPublish, releaseNotes } from '../scripts/lib/releases.mjs';
const source = 'a'.repeat(40);

test('first release uses the initial version, then increments minors numerically', () => {
  assert.equal(planRelease('0.1.0', [], source).version, '0.1.0');
  const tags = ['v0.9.9', 'v0.10.2', 'v1.0.0-beta.1', 'irrelevant'].map((tag) => ({ tag, source: 'b'.repeat(40) }));
  const result = planRelease('0.1.0', tags, source);
  assert.equal(result.version, '0.11.0');
  assert.equal(result.previous, 'v0.10.2');
  assert.equal(planRelease('0.1.0', [{ tag: 'v2.4.7' }], source).version, '2.5.0');
});

test('reruns reuse their source tag, even if a later release exists', () => {
  const result = planRelease('0.1.0', [{ tag: 'v0.1.0', source }, { tag: 'v0.2.0', source: 'b'.repeat(40) }], source);
  assert.equal(result.tag, 'v0.1.0');
  assert.equal(result.existing, true);
  assert.equal(result.previous, undefined);
  assert.throws(() => planRelease('0.1.0', [{ tag: 'v0.1.0', source }, { tag: 'v0.2.0', source }], source), /More than one/);
});

test('version and publication guards reject malformed or non-main inputs', () => {
  for (const version of ['0.01.0', 'v0.1.0', '0.1.0-beta', '1.2', '0.1.0\nfoo', '0.9007199254740992.0']) assert.throws(() => parseVersion(version));
  const valid = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' };
  assert.doesNotThrow(() => assertMainRelease(valid));
  for (const changed of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_ACTIONS: 'false' }]) assert.throws(() => assertMainRelease({ ...valid, ...changed }), /main push/);
});

test('stamping changes both version manifests and preserves dependency data', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'org-version-'));
  try {
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'org-preview', version: '0.1.0', dependencies: { orga: '^4.7.1' } }));
    await writeFile(path.join(dir, 'package-lock.json'), JSON.stringify({ name: 'org-preview', version: '0.1.0', packages: { '': { version: '0.1.0', dependencies: { orga: '^4.7.1' } }, 'node_modules/orga': { version: '4.7.1' } } }));
    await stampVersion(dir, '0.12.0');
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json')));
    const lock = JSON.parse(await readFile(path.join(dir, 'package-lock.json')));
    assert.equal(pkg.version, '0.12.0');
    assert.equal(lock.version, pkg.version);
    assert.equal(lock.packages[''].version, pkg.version);
    assert.equal(lock.packages['node_modules/orga'].version, '4.7.1');
    assert.deepEqual(pkg.dependencies, { orga: '^4.7.1' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('all six assets and matching checksums are required before publication', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'org-assets-'));
  const names = assetNames('0.2.0');
  try {
    for (const name of names.slice(0, 4)) await writeFile(path.join(dir, name), `Test package ${name}`);
    const line = async (name) => `${await sha256(path.join(dir, name))}  ${name}\n`;
    await writeFile(path.join(dir, names[4]), await line(names[0]) + await line(names[1]));
    await writeFile(path.join(dir, names[5]), await line(names[2]) + await line(names[3]));
    assert.equal((await verifyAssets(dir, '0.2.0')).length, 6);
    await writeFile(path.join(dir, names[0]), 'Tampered');
    await assert.rejects(verifyAssets(dir, '0.2.0'), /Checksum mismatch/);
    await rm(path.join(dir, names[3]));
    await assert.rejects(verifyAssets(dir, '0.2.0'), /exactly both platform/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function fakeGitHub({ existing = null, failUpload = false, latest = null } = {}) {
  const calls = [];
  return {
    calls,
    async request(method, endpoint, body) {
      calls.push({ method, endpoint, body });
      if (endpoint.includes('/releases/tags/')) return existing;
      if (endpoint === '/releases/latest') return latest;
      return { id: 1, draft: true, upload_url: 'https://uploads.github.com/test', assets: [], ...body };
    },
    async upload(_url, asset) {
      calls.push({ method: 'UPLOAD', asset: asset.name });
      if (failUpload) throw new Error('Network interrupted');
      return { state: 'uploaded', size: asset.size, digest: asset.digest };
    },
  };
}
const assets = [{ name: 'test.dmg', size: 10, digest: 'sha256:test' }];
const plan = { tag: 'v0.1.0', version: '0.1.0' };

test('publication happens only after complete verified uploads', async () => {
  const api = fakeGitHub();
  await uploadAndPublish(api, plan, assets, 'Notes');
  assert.equal(api.calls.find((call) => call.method === 'POST').body.draft, true);
  assert.equal(api.calls.at(-1).body.draft, false);
  assert.ok(api.calls.findIndex((call) => call.method === 'UPLOAD') < api.calls.length - 1);
  const interrupted = fakeGitHub({ failUpload: true });
  await assert.rejects(uploadAndPublish(interrupted, plan, assets, 'Notes'), /Network interrupted/);
  assert.ok(!interrupted.calls.some((call) => call.body?.draft === false));
});

test('published releases are untouched, draft retries replace partial assets, older retries do not replace latest', async () => {
  const published = fakeGitHub({ existing: { id: 1, draft: false } });
  await uploadAndPublish(published, plan, assets, 'Notes');
  assert.deepEqual(published.calls.map((call) => call.method), ['GET']);
  const draft = fakeGitHub({ existing: { id: 1, draft: true, upload_url: 'https://uploads.github.com/test', assets: [{ id: 7 }] }, latest: { tag_name: 'v0.2.0' } });
  await uploadAndPublish(draft, plan, assets, 'Notes');
  assert.ok(draft.calls.some((call) => call.method === 'DELETE' && call.endpoint === '/releases/assets/7'));
  assert.equal(draft.calls.at(-1).body.make_latest, 'false');
});

test('release notes use the actual version and source, without stale publication instructions', () => {
  const notes = releaseNotes({ version: '0.12.0', repository: 'chadhs/org-preview', source, changes: 'Merged feature A.' });
  assert.match(notes, /Org Preview-0\.12\.0-arm64\.dmg/);
  assert.match(notes, /org-preview-0\.12\.0\.tar\.gz/);
  assert.match(notes, /ORG_PREVIEW_VERSION=0\.12\.0/);
  assert.ok(notes.includes('/blob/v0.12.0/README.org#install'));
  assert.ok(notes.includes(source));
  assert.match(notes, /Merged feature A/);
  assert.doesNotMatch(notes, /MVP-v0\.1|after the PR is merged/);
});
