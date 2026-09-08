import { Resvg } from '@resvg/resvg-js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

// The SVG is the source of truth. No fonts or native graphics tools are required.
const svg = await readFile(new URL('../assets/icon.svg', import.meta.url));
const output = new URL('../build/', import.meta.url);
await mkdir(new URL('icons/', output), { recursive: true });
const pngs = new Map();
for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  pngs.set(size, png);
  await writeFile(new URL(`icons/${size}x${size}.png`, output), png);
}
// Modern ICNS stores PNG representations, including the Retina variants.
const representations = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 };
const chunks = Object.entries(representations).map(([type, size]) => {
  const data = pngs.get(size);
  const header = Buffer.alloc(8);
  header.write(type, 0, 'ascii');
  header.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([header, data]);
});
const header = Buffer.alloc(8);
header.write('icns', 0, 'ascii');
header.writeUInt32BE(8 + chunks.reduce((size, chunk) => size + chunk.length, 0), 4);
await writeFile(new URL('icon.icns', output), Buffer.concat([header, ...chunks]));
console.log('Generated macOS ICNS and Linux PNG icons from assets/icon.svg.');
