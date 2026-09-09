const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fileURLToPath } = require('node:url');
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_IMAGE_BYTES = 32 * 1024 * 1024;

function imagePath(documentPath, target) {
  if (/^file:\/\//i.test(target)) return fileURLToPath(target);
  let local = target.replace(/^file:/i, '');
  try { local = decodeURIComponent(local); } catch { /* Keep literal percent signs. */ }
  if (local.includes('\0') || local.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(local)) throw new Error('Only local image files are supported.');
  if (local.startsWith('~/')) return path.join(os.homedir(), local.slice(2));
  return path.resolve(path.dirname(documentPath), local);
}

function imageMime(file, bytes) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (['.jpg', '.jpeg'].includes(ext) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (ext === '.gif' && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return 'image/gif';
  if (ext === '.webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (ext === '.svg' && /<svg(?:\s|>)/i.test(bytes.subarray(0, 4096).toString('utf8'))) return 'image/svg+xml';
  throw new Error('Unsupported or invalid image.');
}

// Bind reads to actual links in one document revision, never renderer-supplied paths.
function createImageReader(doc) {
  let remaining = MAX_DOCUMENT_IMAGE_BYTES;
  let queue = Promise.resolve();
  const cache = new Map();
  return async (request) => {
    try {
      const { localImageTarget, MAX_IMAGE_LINKS } = await import('./image-links.mjs');
      if (!request || !Number.isSafeInteger(request.start) || !Number.isSafeInteger(request.end) || request.start < 0 || request.end > doc.source.length || request.end <= request.start || request.end - request.start > 8192) throw new Error('Invalid image reference.');
      const reference = doc.source.slice(request.start, request.end);
      if (reference !== request.reference) throw new Error('The document changed. Reopen it to reload images.');
      const target = localImageTarget(reference);
      if (!target) throw new Error('Only local image links are supported.');
      const file = imagePath(doc.path, target);
      if (cache.has(file)) return await cache.get(file);
      if (cache.size >= MAX_IMAGE_LINKS) throw new Error('Image limit reached for this document.');
      const loading = queue.then(async () => {
        const handle = await fs.open(file, constants.O_RDONLY | constants.O_NONBLOCK);
        try {
          const stat = await handle.stat();
          if (!stat.isFile()) throw new Error('The image path is not a file.');
          if (stat.size > MAX_IMAGE_BYTES) throw new Error('Image exceeds 8 MiB.');
          if (stat.size > remaining) throw new Error('Image limit reached for this document.');
          // Read one extra byte to detect growth without an unbounded readFile.
          const bytes = Buffer.alloc(stat.size + 1);
          let total = 0;
          while (total < bytes.length) {
            const { bytesRead } = await handle.read(bytes, total, bytes.length - total, null);
            if (!bytesRead) break;
            total += bytesRead;
          }
          if (total > stat.size) throw new Error('The image changed while loading. Reopen the document to retry.');
          const content = bytes.subarray(0, total);
          const mime = imageMime(file, content);
          remaining -= total;
          return { dataUrl: `data:${mime};base64,${content.toString('base64')}` };
        } finally { await handle.close(); }
      }).catch((error) => ({ error: error.code === 'ENOENT' ? 'Image not found.' : error.code === 'EACCES' ? 'Image is not readable.' : error.message }));
      cache.set(file, loading);
      queue = loading;
      return await loading;
    } catch (error) {
      return { error: error.message };
    }
  };
}

module.exports = { createImageReader, MAX_IMAGE_BYTES, MAX_DOCUMENT_IMAGE_BYTES };
