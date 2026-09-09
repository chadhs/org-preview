import DOMPurify from 'dompurify';
import { version as appVersion } from '../package.json';
import { renderOrg } from './org.js';
import './style.css';
import { createSearch } from './search.js';

const $ = (selector) => document.querySelector(selector);
const api = window.orgPreview;
$('.version').textContent = appVersion;
let current;
let sourceMode = false;
const finder = createSearch(() => $(sourceMode ? '#source' : '#document'), $('#reader'), (text) => { $('#search-count').textContent = text; });
let observer;
let renderRevision = 0;
let scrollPositions = { preview: 0, source: 0 };
const error = (message) => { $('#error').textContent = message; $('#error').hidden = false; $('#status').textContent = 'Preview paused'; };
const run = (promise) => promise?.catch((reason) => error(reason.message));

function setView(source) {
  scrollPositions[sourceMode ? 'source' : 'preview'] = $('#reader').scrollTop;
  sourceMode = source;
  $('#document').hidden = source;
  $('#source').hidden = !source;
  $('#preview-tab').setAttribute('aria-pressed', String(!source));
  $('#source-tab').setAttribute('aria-pressed', String(source));
  $('#mode-label').textContent = source ? 'ORG SOURCE · READ ONLY' : 'ORG DOCUMENT';
  $('#reader').scrollTop = scrollPositions[source ? 'source' : 'preview'];
  if ($('#search').value) finder.search($('#search').value, true, true, false);
}
function goTo(id) {
  if (sourceMode) setView(false);
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function acceptDocument(doc) {
  if (!doc) return;
  const revision = ++renderRevision;
  const changedFile = current?.path !== doc.path;
  const top = changedFile ? 0 : $('#reader').scrollTop;
  $('#status').textContent = 'Rendering…';
  // Let the status paint before parsing a larger document.
  await new Promise(requestAnimationFrame);
  if (revision !== renderRevision) return;
  try {
    const parsed = renderOrg(doc.source, doc.name.replace(/\.org$/i, ''));
    current = doc;
    if (changedFile) scrollPositions = { preview: 0, source: 0 };
    $('#error').hidden = true;
    $('#filename').textContent = doc.name;
    $('#breadcrumb').textContent = doc.path;
    $('#file-info').title = `Reveal ${doc.path}`;
    $('#document-title').textContent = parsed.title;
    $('#subtitle').textContent = parsed.subtitle;
    $('#subtitle').hidden = !parsed.subtitle;
    $('#metadata').textContent = [parsed.author, `${Math.max(1, Math.ceil(parsed.words / 220))} min read`].filter(Boolean).join('  ·  ');
    $('#content').innerHTML = DOMPurify.sanitize(parsed.html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'img', 'video', 'audio', 'iframe', 'form'], FORBID_ATTR: ['style'] });
    $('#source').textContent = doc.source;
    $('#heading-count').textContent = parsed.outline.length;
    const outline = document.createDocumentFragment();
    for (const heading of parsed.outline) {
      const button = document.createElement('button');
      button.className = 'outline-item';
      button.style.paddingLeft = `${16 + Math.min(heading.level - 1, 5) * 14}px`;
      button.dataset.target = heading.id;
      const marker = document.createElement('span');
      marker.className = 'outline-marker';
      marker.textContent = heading.level === 1 ? '○' : '·';
      const label = document.createElement('span');
      label.textContent = heading.label || 'Untitled heading';
      button.append(marker, label);
      button.addEventListener('click', () => goTo(heading.id));
      outline.append(button);
    }
    $('#outline').replaceChildren(outline);
    if (!parsed.outline.length) $('#outline').textContent = 'No headings in this file.';
    $('#stats').textContent = `${parsed.words.toLocaleString()} words  ·  ${parsed.lines.toLocaleString()} lines`;
    $('#status').replaceChildren();
    const dot = document.createElement('span');
    dot.className = 'live-dot';
    $('#status').append(dot, document.createTextNode(`Live · updated ${new Date(doc.modified).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`));
    $('#reader').scrollTop = top;
    if ($('#search').value) finder.search($('#search').value, true, true, false);
    observer?.disconnect();
    observer = new IntersectionObserver((entries) => {
      const heading = entries.find((entry) => entry.isIntersecting);
      if (!heading) return;
      $$('.outline-item').forEach((item) => {
        const active = item.dataset.target === heading.target.id;
        item.classList.toggle('active', active);
        if (active) item.setAttribute('aria-current', 'location'); else item.removeAttribute('aria-current');
      });
    }, { root: $('#reader'), rootMargin: '-5% 0px -65% 0px' });
    $$('#content [data-level]').forEach((heading) => observer.observe(heading));
  } catch (reason) { error(`Could not render this file: ${reason.message}`); }
}
const $$ = (selector) => [...document.querySelectorAll(selector)];
$('#open').addEventListener('click', () => run(api.open()));
$('#file-info').addEventListener('click', () => run(api.reveal()));
$('#preview-tab').addEventListener('click', () => setView(false));
$('#source-tab').addEventListener('click', () => setView(true));
$('#toggle-outline').addEventListener('click', () => { $('#sidebar').hidden = !$('#sidebar').hidden; });
$('#content').addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (!link) return;
  event.preventDefault();
  const href = link.getAttribute('href');
  if (href?.startsWith('#')) goTo(href.slice(1));
  else if (href) run(api.external(href));
});
function showSearch(show = true) {
  $('#search-bar').hidden = !show;
  if (show) { $('#search').focus(); $('#search').select(); }
  else { $('#search').value = ''; $('#search-count').textContent = ''; finder.clear(); $('#reader').focus(); }
}
$('#find-button').addEventListener('click', () => showSearch());
$('#close-search').addEventListener('click', () => showSearch(false));
$('#search').addEventListener('input', () => { $('#search-count').textContent = ''; finder.search($('#search').value); });
$('#search').addEventListener('keydown', (event) => { if (event.key === 'Enter') finder.search($('#search').value, !event.shiftKey); });
$('#find-next').addEventListener('click', () => finder.search($('#search').value, true));
$('#find-prev').addEventListener('click', () => finder.search($('#search').value, false));
api.onCommand((command) => { if (command === 'find') showSearch(); if (command === 'source') setView(!sourceMode); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { showSearch(false); $('#drop-overlay').hidden = true; } });
const storedTheme = localStorage.getItem('org-preview-theme') || 'system';
$('#theme').value = ['system', 'light', 'dark'].includes(storedTheme) ? storedTheme : 'system';
function updateTheme() { document.documentElement.dataset.theme = $('#theme').value; localStorage.setItem('org-preview-theme', $('#theme').value); }
$('#theme').addEventListener('change', updateTheme);
updateTheme();
if (!navigator.platform.includes('Mac')) $('#open-shortcut').textContent = 'Ctrl O';
let dragDepth = 0;
document.addEventListener('dragenter', (event) => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) { dragDepth++; $('#drop-overlay').hidden = false; } });
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('dragleave', (event) => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').hidden = true; } });
document.addEventListener('drop', (event) => {
  event.preventDefault(); dragDepth = 0; $('#drop-overlay').hidden = true;
  const file = event.dataTransfer.files[0];
  if (file) run(api.openPath(api.droppedPath(file)));
});
api.onDocument(acceptDocument);
api.onError(error);
run(api.initial().then(acceptDocument));
