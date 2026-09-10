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
    `org-preview-${version}-arm64.dmg`, `org-preview-${version}-arm64.zip`,
    `org-preview-${version}.AppImage`, `org-preview-${version}.tar.gz`,
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
  const regular = ['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME);
  const merged = env.GITHUB_EVENT_NAME === 'pull_request_target' && env.RELEASE_PR_MERGED === 'true' && env.RELEASE_PR_BASE === 'main';
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REF !== 'refs/heads/main' || (!regular && !merged)) throw new Error('Releasing is allowed only for trusted main events in GitHub Actions.');
}
export function releaseNotes({ version, repository, source, changes = '' }) {
  parseVersion(version);
  const guide = `https://github.com/${repository}/blob/v${version}/README.org#install`;
  return [
    'Org Preview is a live reader for local Org-mode files. Keep writing in your editor and the preview follows your saves. Downloaded releases need no Node.js, npm, or Emacs.',
    '',
    'Includes document tabs, offline Mermaid diagrams, local images, an outline, search, source view, themes, zoom, and common Org formatting. Documents stay local; embedded HTML and Babel blocks never execute. BSD-3-Clause, with the MIT-licensed Orga parser.',
    '',
    '### macOS: Apple Silicon',
    '',
    `1. Download \`org-preview-${version}-arm64.dmg\` and \`SHA256SUMS-darwin-arm64.txt\` from Assets below. The ZIP is an alternative; GitHub's Source code archives are not installers.`,
    '2. Quit older copies. Open the DMG, drag Org Preview.app into Applications, and eject the disk image.',
    '3. Launch the Applications copy. If macOS cannot verify the developer and you trust this repository, first try opening the app, then use System Settings → Privacy & Security → Open Anyway and confirm Open. These builds are ad-hoc signed for bundle integrity, but not Developer-ID-signed or notarized. Click Done on the initial alert, then approve this app specifically; no paid Apple Developer membership is needed to run it.',
    '4. Click Open file, press ⌘O, drag in an Org file, or use Finder → Open With → Org Preview. Keep one installed copy.',
    '',
    '[Apple first-launch guidance](https://support.apple.com/en-us/102445). If the app is reported as damaged, re-download and verify its checksum; report the exact alert if it persists.',
    '',
    '### Omarchy / Arch Linux: x86_64',
    '',
    `Download \`org-preview-${version}.tar.gz\` and \`SHA256SUMS-linux-x64.txt\` to Downloads. This tested installation uses your home directory and needs no FUSE or sudo:`,
    '',
    '```sh',
    `ORG_PREVIEW_VERSION=${version}`,
    'cd "$HOME/Downloads"',
    'mkdir -p "$HOME/.local/opt" "$HOME/.local/bin"',
    'tar -xzf "org-preview-$ORG_PREVIEW_VERSION.tar.gz" -C "$HOME/.local/opt"',
    'ln -sfn "$HOME/.local/opt/org-preview-$ORG_PREVIEW_VERSION/org-preview" "$HOME/.local/bin/org-preview"',
    '"$HOME/.local/bin/org-preview"',
    '```',
    '',
    `Use Open file, Ctrl+O, or drag-and-drop. Open notebooks from the terminal with \`~/.local/bin/org-preview ~/notes/today.org\`. The [installation guide](${guide}) includes an optional app-launcher entry, default file associations, and update instructions. No AUR/pacman package is supplied.`,
    '',
    `Alternatively download \`org-preview-${version}.AppImage\`, make it executable, and run it with \`--appimage-extract-and-run\` when FUSE 2 is absent. Native Wayland and XWayland were tested on Omarchy. Run as your normal user with sandboxing enabled.`,
    '',
    'Compare downloads with the supplied SHA-256 files using `shasum -a 256` on macOS or `sha256sum` on Linux. To update, quit the app and repeat installation for the new version; there is no in-app updater.',
    '',
    '### Known limits',
    '',
    'Up to 20 UTF-8 documents, 16 MiB per file and 64 MiB of source files total. Tabs do not persist after quitting. Mermaid rendering has input, output, and time limits; document configuration and remote assets are unsupported. Editing, full Emacs export parity, links to other local files, math, other diagram engines, Babel, Quick Look, Developer ID signing/notarization, and auto-updates remain outside scope. Intel Mac builds are not supplied.',
    '',
    `[Release information](https://github.com/${repository}/blob/v${version}/RELEASE-NOTES.org) · [Merged source](https://github.com/${repository}/commit/${source})`,
    '',
    changes,
  ].join('\n');
}
// The tag endpoint can omit drafts, even for authenticated callers. List
// releases as a fallback so an interrupted upload resumes the existing draft.
export async function findRelease(github, tag) {
  const published = await github.request('GET', `/releases/tags/${tag}`, undefined, true);
  if (published) return published;
  for (let page = 1; ; page++) {
    const releases = await github.request('GET', `/releases?per_page=100&page=${page}`);
    if (!Array.isArray(releases)) throw new Error('Unexpected release-list response.');
    const found = releases.find((release) => release.tag_name === tag);
    if (found) return found;
    if (releases.length < 100) return null;
  }
}
// A failed upload leaves a draft. Published releases and their assets are never replaced.
export async function uploadAndPublish(github, plan, assets, body) {
  let release = await findRelease(github, plan.tag);
  if (release && !release.draft) return release;
  if (!release) release = await github.request('POST', '/releases', { tag_name: plan.tag, name: `Org Preview ${plan.tag}`, body, draft: true, prerelease: false });
  else {
    await github.request('PATCH', `/releases/${release.id}`, { name: `Org Preview ${plan.tag}`, body });
    for (const asset of release.assets) await github.request('DELETE', `/releases/assets/${asset.id}`);
  }
  for (const asset of assets) {
    const uploaded = await github.upload(release.upload_url, asset);
    if (uploaded.name !== asset.name || uploaded.state !== 'uploaded' || uploaded.size !== asset.size || (uploaded.digest && uploaded.digest !== asset.digest)) throw new Error(`Upload verification failed: ${asset.name}`);
  }
  const latest = await github.request('GET', '/releases/latest', undefined, true);
  const makeLatest = !latest || !/^v\d+\.\d+\.\d+$/.test(latest.tag_name) || compareVersions(plan.version, latest.tag_name.slice(1)) >= 0;
  return github.request('PATCH', `/releases/${release.id}`, { draft: false, make_latest: String(makeLatest) });
}
