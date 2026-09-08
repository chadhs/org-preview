import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
const seen = new Set();
let output = `#+title: Third-party notices\n\norg-preview's own code uses BSD-3-Clause. Dependencies retain their licenses.\nDOMPurify is used under its Apache-2.0 option. Electron's distribution also\nincludes LICENSE and LICENSES.chromium.html for its bundled components.\n\nRegenerate this file with =npm run notices= after dependency updates.\n`;
async function visit(name) {
  if (seen.has(name)) return;
  seen.add(name);
  const directory = path.join('node_modules', name);
  const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  const files = await readdir(directory);
  const license = files.find((file) => /^license(?:\.(?:md|org|txt))?$/i.test(file));
  if (!license) throw new Error(`Missing license text for ${name}`);
  output += `\n* ${name} ${pkg.version}\nLicense: ${pkg.license}\n\n#+begin_example\n${await readFile(path.join(directory, license), 'utf8')}\n#+end_example\n`;
  for (const dependency of Object.keys(pkg.dependencies || {})) await visit(dependency);
}
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
for (const dependency of Object.keys(pkg.dependencies)) await visit(dependency);
await writeFile('THIRD-PARTY-NOTICES.org', output);
