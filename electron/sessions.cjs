const { realpath } = require('node:fs/promises');
const { readDocument, watchDocument } = require('./documents.cjs');
const { createImageReader } = require('./images.cjs');

const MAX_TABS = 20;
const MAX_SESSION_BYTES = 64 * 1024 * 1024;
const message = (error) => error.code === 'ENOENT'
  ? 'File unavailable. Waiting for it to return, or open another file.' : error.message;

function createSessions({ read = readDocument, watch = watchDocument, canonicalize = realpath,
  imageReader = createImageReader, changed = () => {}, recent = () => {} } = {}) {
  const documents = new Map();
  let activeId = null, sequence = 0, nextId = 0, generation = 0, queue = Promise.resolve();
  const size = () => [...documents.values()].reduce((total, entry) => total + entry.doc.size, 0);
  const active = () => documents.get(activeId);
  function snapshot(includeDocument = true) {
    return { sequence, activeId, tabs: [...documents.values()].map(({ doc, error }) => ({
      id: doc.id, path: doc.path, name: doc.name, revision: doc.revision, error,
    })), ...(includeDocument ? { document: active()?.doc ?? null } : {}) };
  }
  function publish(includeDocument = true, openError = '') {
    sequence++;
    const state = { ...snapshot(includeDocument), openError };
    changed(state);
    return state;
  }
  function activate(id) {
    if (!documents.has(id)) throw new Error('This document is no longer open.');
    const switching = activeId !== id;
    if (switching && active()) active().reader = undefined;
    activeId = id;
    return publish(switching);
  }
  function openMany(paths) {
    if (!Array.isArray(paths) || !paths.length || paths.length > 100 || paths.some((p) => typeof p !== 'string')) {
      return Promise.reject(new Error('Choose between 1 and 100 Org files.'));
    }
    const epoch = generation;
    const work = async () => {
      const errors = [];
      for (const file of paths) {
        if (epoch !== generation) break;
        try {
          // Validate extension and contents before canonicalizing the identity.
          const doc = await read(file);
          const identity = await canonicalize(doc.path);
          if (epoch !== generation) break;
          const existing = [...documents.values()].find((entry) => entry.identity === identity);
          if (existing) { activate(existing.doc.id); continue; }
          if (documents.size >= MAX_TABS) throw new Error(`Up to ${MAX_TABS} documents can be open. Close a tab first.`);
          if (size() + doc.size > MAX_SESSION_BYTES) throw new Error('Open documents are limited to 64 MiB in total. Close a tab first.');
          const id = `document-${++nextId}`;
          const entry = { identity, doc: { ...doc, id, revision: 1 }, error: '', stop: () => {} };
          documents.set(id, entry);
          entry.stop = watch(doc.path, (next) => {
            if (documents.get(id) !== entry) return;
            if (size() - entry.doc.size + next.size > MAX_SESSION_BYTES) {
              entry.error = 'This update exceeds the 64 MiB open-document limit. Close another tab and save again.';
              publish(false);
              return;
            }
            entry.doc = { ...next, id, revision: entry.doc.revision + 1 };
            entry.reader = undefined;
            entry.error = '';
            publish(id === activeId);
          }, (error) => {
            if (documents.get(id) !== entry) return;
            entry.error = message(error);
            publish(false);
          });
          recent(doc.path);
          activate(id);
        } catch (error) { errors.push(`${file}: ${message(error)}`); }
      }
      if (epoch !== generation) return snapshot();
      return errors.length ? publish(!activeId, errors.join('\n')) : snapshot();
    };
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  }
  function close(id) {
    const entry = documents.get(id);
    if (!entry) return snapshot();
    const ids = [...documents.keys()];
    const index = ids.indexOf(id);
    const wasActive = id === activeId;
    entry.stop();
    documents.delete(id);
    if (wasActive) activeId = ids[index + 1] ?? ids[index - 1] ?? null;
    return publish(wasActive);
  }
  function dispose() {
    generation++;
    for (const entry of documents.values()) entry.stop();
    documents.clear();
    activeId = null;
    sequence++;
  }
  async function image(documentPath, reference, revision) {
    const entry = active();
    if (!entry || entry.doc.path !== documentPath || (revision !== undefined && revision !== entry.doc.revision)) {
      return { error: 'The document changed.' };
    }
    const doc = entry.doc;
    const reader = entry.reader ??= imageReader(doc);
    const result = await reader(reference);
    return active() === entry && entry.doc === doc && entry.reader === reader ? result : { error: 'The document changed.' };
  }
  return { openMany, activate, close, dispose, image, snapshot, active: () => active()?.doc };
}
module.exports = { createSessions, MAX_TABS, MAX_SESSION_BYTES };
