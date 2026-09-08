import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export function parseVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match || match.slice(1).some((part) => !Number.isSafeInteger(Number(part)))) throw new Error(`Invalid stable version: ${value}`);
  return match.slice(1).map(Number);
}
export function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b);
  for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index] - right[index];
  return 0;
}
export function planRelease(initial, tags, source) {
  parseVersion(initial);
  if (!/^[a-f0-9]{40}$/.test(source)) throw new Error('A full source commit SHA is required.');
  const stable = tags.filter(({ tag }) => /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag));
  stable.sort((a, b) => compareVersions(a.tag.slice(1), b.tag.slice(1)));
  const matching = stable.filter((item) => item.source === source);
  if (matching.length > 1) throw new Error('More than one release tag maps to this source commit.');
  let version = matching[0]?.tag.slice(1);
  if (!version) {
    const latest = stable.at(-1);
    if (!latest) version = initial;
    else {
      const [major, minor] = parseVersion(latest.tag.slice(1));
      version = `${major}.${minor + 1}.0`;
      parseVersion(version);
    }
  }
  const previous = stable.filter((item) => compareVersions(item.tag.slice(1), version) < 0).at(-1)?.tag;
  return { version, tag: `v${version}`, source, previous, existing: matching.length === 1 };
}
export async function stampVersion(directory, version) {
  parseVersion(version);
  const packagePath = path.join(directory, 'package.json');
  const lockPath = path.join(directory, 'package-lock.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  if (!lock.packages?.[''] || lock.name !== pkg.name) throw new Error('Package and lockfile roots must agree.');
  pkg.version = lock.version = lock.packages[''].version = version;
  await writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n');
  await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
}
export function assetNames(version) {
  parseVersion(version);
  return [
    `Org Preview-${version}-arm64.dmg`, `Org Preview-${version}-arm64-mac.zip`,
    `Org Preview-${version}.AppImage`, `org-preview-${version}.tar.gz`,
    'SHA256SUMS-darwin-arm64.txt', 'SHA256SUMS-linux-x64.txt',
  ];
}
export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function verifyAssets(directory, version) {
  const expected = assetNames(version).sort();
  const actual = (await readdir(directory)).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Release must contain exactly both platform packages and their checksum files.');
  const checksummed = new Set();
  for (const name of expected.filter((name) => name.startsWith('SHA256SUMS-'))) {
    const lines = (await readFile(path.join(directory, name), 'utf8')).trim().split('\n');
    for (const line of lines) {
      const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
      if (!match || path.basename(match[2]) !== match[2] || !expected.includes(match[2]) || match[2].startsWith('SHA256SUMS-')) throw new Error('Invalid checksum entry.');
      if (checksummed.has(match[2])) throw new Error('Duplicate checksum entry.');
      if (await sha256(path.join(directory, match[2])) !== match[1]) throw new Error(`Checksum mismatch: ${match[2]}`);
      checksummed.add(match[2]);
    }
  }
  if (checksummed.size !== 4) throw new Error('All four packages need checksums.');
  return Promise.all(expected.map(async (name) => {
    const file = path.join(directory, name);
    const info = await stat(file);
    if (!info.isFile() || info.size === 0) throw new Error(`Empty or invalid release asset: ${name}`);
    return { name, file, size: info.size, digest: `sha256:${await sha256(file)}` };
  }));
}
export function assertMainRelease(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main') throw new Error('Publishing is allowed only for a main push in GitHub Actions.');
}
export function releaseNotes({ version, repository, source, changes = '' }) {
  parseVersion(version);
  return `Org Preview is a live reader for local Org-mode files on macOS and Linux. Keep writing in your editor and the preview follows your saves.\n\n` +
    `Includes an outline, search, source view, themes, zoom, and common Org formatting. Documents stay local; embedded HTML and Babel blocks never execute. BSD-3-Clause, with the MIT-licensed Orga parser.\n\n` +
    `### Install\n\n` +
    `- **Apple Silicon Mac:** download \`Org Preview-${version}-arm64.dmg\` or \`Org Preview-${version}-arm64-mac.zip\`, then move the app to Applications. Keep one installed copy to avoid Finder ambiguity. Builds are unsigned and unnotarized; macOS may require approval before first launch.\n` +
    `- **Linux x86_64:** make \`Org Preview-${version}.AppImage\` executable and run it. If FUSE 2 is unavailable, add \`--appimage-extract-and-run\`, or extract \`org-preview-${version}.tar.gz\` and run its \`org-preview\` executable. The tar archive does not install a desktop launcher.\n` +
    `- Compare each download's SHA-256 with the attached platform checksum file.\n\n` +
    `### Known limits\n\nOne UTF-8 document at a time, up to 4 MB. Editing, full Emacs export parity, local image/file links, math/diagrams, Babel, Quick Look, signing, and auto-updates remain outside scope. Intel Mac builds are not supplied.\n\n` +
    `[Release information](https://github.com/${repository}/blob/v${version}/RELEASE-NOTES.org) · [Merged source](https://github.com/${repository}/commit/${source})\n\n` + changes;
}
// A failed upload leaves a draft. Published releases and their assets are never replaced.
export async function uploadAndPublish(github, plan, assets, body) {
  let release = await github.request('GET', `/releases/tags/${plan.tag}`, undefined, true);
  if (release && !release.draft) return release;
  if (!release) release = await github.request('POST', '/releases', { tag_name: plan.tag, name: `Org Preview ${plan.tag}`, body, draft: true, prerelease: false });
  else {
    await github.request('PATCH', `/releases/${release.id}`, { name: `Org Preview ${plan.tag}`, body });
    for (const asset of release.assets) await github.request('DELETE', `/releases/assets/${asset.id}`);
  }
  for (const asset of assets) {
    const uploaded = await github.upload(release.upload_url, asset);
    if (uploaded.state !== 'uploaded' || uploaded.size !== asset.size || (uploaded.digest && uploaded.digest !== asset.digest)) throw new Error(`Upload verification failed: ${asset.name}`);
  }
  const latest = await github.request('GET', '/releases/latest', undefined, true);
  const makeLatest = !latest || !/^v\d+\.\d+\.\d+$/.test(latest.tag_name) || compareVersions(plan.version, latest.tag_name.slice(1)) >= 0;
  return github.request('PATCH', `/releases/${release.id}`, { draft: false, make_latest: String(makeLatest) });
}
