import DOMPurify from 'dompurify';
import { version as appVersion } from '../package.json';
import { renderOrg } from './org.js';
import './style.css';
import { createSearch } from './search.js';
import { initializeAppearance } from './appearance.js';
import { loadImages } from './images.js';
import { loadDiagrams } from './diagrams.js';
import { tabLabel } from './tabs.js';

document.documentElement.dataset.platform = window.orgPreview.platform;
initializeAppearance();

const $ = (selector) => document.querySelector(selector);
const api = window.orgPreview;
$('.version').textContent = appVersion;
let current;
let sourceMode = false;
const finder = createSearch(() => $(sourceMode ? '#source' : '#document'), $('#reader'), (text) => { $('#search-count').textContent = text; });
let observer;
let renderRevision = 0;
let diagramRevision = 0;
let activeDiagrams = [];
let interactionRevision = 0;
for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
  document.addEventListener(event, () => { interactionRevision++; }, { capture: true, passive: true });
}
let scrollPositions = { preview: 0, source: 0 };
const error = (message) => { $('#error').textContent = message; $('#error').hidden = false; $('#status').textContent = 'Preview paused'; };
const run = (promise) => promise?.catch((reason) => error(reason.message));

const views = new Map();
let tabs = [];
let activeTabId = null;
let sessionSequence = -1;
let sessionOpenError = '';
const newView = () => ({ sourceMode: false, scroll: { preview: 0, source: 0 }, search: { query: '', active: -1 }, searchOpen: false });
function saveView() {
  if (!current) return;
  scrollPositions[sourceMode ? 'source' : 'preview'] = $('#reader').scrollTop;
  views.set(current.id, { sourceMode, scroll: { ...scrollPositions }, search: finder.snapshot(), searchOpen: !$('#search-bar').hidden });
}
function selectTab(id) { run(api.activate(id)); }
function cycleTab(direction) {
  if (!tabs.length) return;
  const index = tabs.findIndex((tab) => tab.id === activeTabId);
  selectTab(tabs[(index + direction + tabs.length) % tabs.length].id);
}
function renderTabs(activeId) {
  const focused = document.activeElement?.dataset.tabFocus;
  const fragment = document.createDocumentFragment();
  for (const tab of tabs) {
    const group = document.createElement('div');
    group.className = 'document-tab';
    group.dataset.active = String(tab.id === activeId);
    const button = document.createElement('button');
    button.id = `tab-${tab.id}`;
    button.dataset.tabFocus = tab.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', 'reader');
    button.setAttribute('aria-selected', String(tab.id === activeId));
    button.tabIndex = tab.id === activeId ? 0 : -1;
    button.textContent = `${tab.error ? '⚠ ' : ''}${tabLabel(tab, tabs)}`;
    button.title = tab.path + (tab.error ? `\n${tab.error}` : '');
    button.addEventListener('click', () => selectTab(tab.id));
    button.addEventListener('keydown', (event) => {
      const index = tabs.indexOf(tab);
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      selectTab(tabs[next].id);
      queueMicrotask(() => document.getElementById(`tab-${tabs[next].id}`)?.focus());
    });
    const close = document.createElement('button');
    close.className = 'close-tab';
    close.dataset.tabFocus = `close-${tab.id}`;
    close.setAttribute('aria-label', `Close ${tab.name}`);
    close.title = `Close ${tab.name}`;
    close.textContent = '×';
    close.addEventListener('click', () => run(api.close(tab.id)));
    group.append(button, close);
    fragment.append(group);
  }
  $('#document-tabs').replaceChildren(fragment);
  if (focused) {
    const target = [...$('#document-tabs').querySelectorAll('button')].find((button) => button.dataset.tabFocus === focused);
    (target ?? document.getElementById(`tab-${activeId}`))?.focus();
  }
  document.getElementById(`tab-${activeId}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
async function acceptSession(state) {
  if (!state || state.sequence <= sessionSequence) return;
  sessionSequence = state.sequence;
  tabs = state.tabs;
  activeTabId = state.activeId;
  renderTabs(state.activeId);
  sessionOpenError = state.openError;
  if (Object.hasOwn(state, 'document')) {
    if (state.document) await acceptDocument(state.document);
    else {
      saveView(); current = undefined; renderRevision++; observer?.disconnect(); finder.clear();
      activeDiagrams = [];
      $('#content').replaceChildren(); $('#source').textContent = '';
      $('#empty-state').hidden = false; $('#document').hidden = true; $('#source').hidden = true;
      $('#sidebar').hidden = true; $('.page-top').hidden = true;
      $('#search-bar').hidden = true; $('#stats').textContent = '';
      $('#status').textContent = 'Open an Org file to begin.';
      $('#reader').removeAttribute('aria-labelledby');
    }
  }
  const activeError = tabs.find((tab) => tab.id === activeTabId)?.error;
  for (const id of views.keys()) if (!tabs.some((tab) => tab.id === id)) views.delete(id);
  for (const selector of ['#preview-tab', '#source-tab', '#find-button', '#toggle-outline', '#file-info']) $(selector).disabled = !activeTabId;
  $('#error').hidden = !(activeError || sessionOpenError);
  if (activeError || sessionOpenError) error(sessionOpenError || activeError);
}

function setView(source) {
  if (!current) return;
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
  saveView();
  const view = views.get(doc.id) ?? newView();
  const changedFile = current?.id !== doc.id;
  const revision = ++renderRevision;
  const top = view.scroll[view.sourceMode ? 'source' : 'preview'];
  const interaction = interactionRevision;
  $('#status').textContent = 'Rendering…';
  // Let the status paint before parsing a larger document.
  await new Promise(requestAnimationFrame);
  if (revision !== renderRevision) return;
  try {
    const parsed = renderOrg(doc.source, doc.name.replace(/\.org$/i, ''));
    current = doc;
    sourceMode = view.sourceMode;
    scrollPositions = { ...view.scroll };
    $('#empty-state').hidden = true; $('.page-top').hidden = false;
    if (changedFile) $('#sidebar').hidden = false;
    $('#reader').setAttribute('aria-labelledby', `tab-${doc.id}`);
    $('#document').hidden = sourceMode; $('#source').hidden = !sourceMode;
    $('#preview-tab').setAttribute('aria-pressed', String(!sourceMode));
    $('#source-tab').setAttribute('aria-pressed', String(sourceMode));
    $('#mode-label').textContent = sourceMode ? 'ORG SOURCE · READ ONLY' : 'ORG DOCUMENT';
    $('#search-bar').hidden = !view.searchOpen;
    $('#search').value = view.search.query;
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
    activeDiagrams = parsed.diagrams;
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
    finder.restore(view.search);
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
    const layoutChanged = () => {
      if (interaction === interactionRevision && revision === renderRevision) $('#reader').scrollTop = top;
      if ($('#search').value) finder.search($('#search').value, true, true, false);
    };
    refreshDiagrams(layoutChanged);
    void loadImages($('#content'), parsed.images, doc.path, (file, reference) => api.image(file, reference, doc.revision), () => revision === renderRevision, layoutChanged);
  } catch (reason) { error(`Could not render this file: ${reason.message}`); }
}
function refreshDiagrams(onChange) {
  const top = $('#reader').scrollTop;
  const interaction = interactionRevision;
  const layoutChanged = typeof onChange === 'function' ? onChange : () => {
    if (interaction === interactionRevision) $('#reader').scrollTop = top;
    if ($('#search').value) finder.search($('#search').value, true, true, false);
  };
  const generation = ++diagramRevision;
  const revision = renderRevision;
  if (!current || !activeDiagrams.length) return;
  void loadDiagrams($('#content'), activeDiagrams, current, api.diagram,
    () => generation === diagramRevision && revision === renderRevision,
    layoutChanged);
}
new MutationObserver(refreshDiagrams).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
$('#content').addEventListener('toggle', () => {
  if ($('#search').value) finder.search($('#search').value, true, true, false);
}, true);
const $$ = (selector) => [...document.querySelectorAll(selector)];
$('#open').addEventListener('click', () => run(api.open()));
$('#empty-open').addEventListener('click', () => run(api.open()));
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
  if (!current) return;
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
api.onCommand((command) => { if (command === 'find') showSearch(); if (command === 'source') setView(!sourceMode); if (command === 'next-tab') cycleTab(1); if (command === 'previous-tab') cycleTab(-1); });
document.addEventListener('keydown', (event) => {
  // Also handle renderer-dispatched keys, including accessibility automation.
  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Tab') {
    event.preventDefault(); cycleTab(event.shiftKey ? -1 : 1); return;
  }
  if ((navigator.platform.includes('Mac') ? event.metaKey : event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'w') {
    event.preventDefault(); if (activeTabId) run(api.close(activeTabId)); return;
  }
  if (event.key === 'Escape') { showSearch(false); $('#drop-overlay').hidden = true; } });
if (!navigator.platform.includes('Mac')) $('#open-shortcut').textContent = 'Ctrl O';
let dragDepth = 0;
document.addEventListener('dragenter', (event) => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) { dragDepth++; $('#drop-overlay').hidden = false; } });
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('dragleave', (event) => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').hidden = true; } });
document.addEventListener('drop', (event) => {
  event.preventDefault(); dragDepth = 0; $('#drop-overlay').hidden = true;
  const files = [...event.dataTransfer.files].map((file) => api.droppedPath(file));
  if (files.length) run(api.openPaths(files));
});
api.onDocument(acceptSession);
api.onError(error);
run(api.initial().then(acceptSession));
