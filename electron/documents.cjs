const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const MAX_BYTES = 4 * 1024 * 1024;

async function readDocument(filePath) {
  if (typeof filePath !== 'string' || path.extname(filePath).toLowerCase() !== '.org') throw new Error('Choose an .org file.');
  const absolute = path.resolve(filePath);
  const handle = await fsp.open(absolute, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Choose a file, not a directory.');
    if (stat.size > MAX_BYTES) throw new Error('This prototype supports files up to 4 MB.');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > MAX_BYTES) throw new Error('This prototype supports files up to 4 MB.');
    return { path: absolute, name: path.basename(absolute), source: buffer.subarray(0, total).toString('utf8'), modified: stat.mtimeMs, size: total };
  } finally { await handle.close(); }
}

function watchDocument(filePath, onChange, onError, interval = 300) {
  let stopped = false;
  let revision = 0;
  const listener = async () => {
    const current = ++revision;
    try {
      const doc = await readDocument(filePath);
      if (!stopped && current === revision) onChange(doc);
    } catch (error) {
      if (!stopped && current === revision) onError(error);
    }
  };
  // Poll the pathname so atomic editor saves and delete/recreate keep working.
  fs.watchFile(filePath, { interval }, listener);
  return () => { stopped = true; revision++; fs.unwatchFile(filePath, listener); };
}
module.exports = { readDocument, watchDocument, MAX_BYTES };
