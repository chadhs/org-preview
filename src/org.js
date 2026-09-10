import { parse } from 'orga';
import { createCodeHighlighter } from './highlight.js';
import { localImageTarget, MAX_IMAGE_LINKS } from '../electron/image-links.mjs';

export const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ignored = new Set(['stars', 'opening', 'closing', 'link.path', 'list.item.bullet', 'emptyLine', 'table.columnSeparator', 'table.hr']);
const styles = { bold: 'strong', italic: 'em', underline: 'u', strikeThrough: 's', strikethrough: 's', code: 'code', verbatim: 'code' };

export function renderOrg(source, fallbackTitle = 'Untitled') {
  const tree = parse(source);
  const highlightCode = createCodeHighlighter();
  const outline = [];
  const images = [];
  const diagrams = [];
  const diagramNodes = new WeakMap();
  let diagramCharacters = 0;
  const used = new Set();
  const raw = (node) => source.slice(node.position?.start.offset, node.position?.end.offset);
  const text = (node) => node.type === 'text' ? node.value : (node.children || []).map(text).join('');
  const anchor = (value) => `org-${String(value).trim().toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '') || 'section'}`;
  const ids = new WeakMap();
  function index(node) {
    if (node.type === 'section') {
      const heading = node.children.find((child) => child.type === 'headline');
      if (heading) {
        const label = text(heading).trim();
        const base = anchor(node.properties?.custom_id || label);
        let id = base;
        for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
        used.add(id);
        ids.set(heading, id);
        outline.push({ id, label, level: heading.level, todo: heading.keyword || '' });
      }
    }
    const siblings = node.children || [];
    for (let i = 0; i < siblings.length; i++) {
      const block = siblings[i];
      if (block.type !== 'block' || block.name.toLowerCase() !== 'src' || block.params?.[0]?.toLowerCase() !== 'mermaid') continue;
      const error = diagrams.length >= 20 ? 'Diagram limit reached: 20 per document.'
        : block.value.length > 20000 ? 'Diagram exceeds 20,000 characters.'
        : diagramCharacters + block.value.length > 100000 ? 'Diagram source exceeds 100,000 characters per document.' : '';
      if (error) { diagramNodes.set(block, { error }); continue; }
      diagramCharacters += block.value.length;
      const diagram = { id: diagrams.length, start: block.position.start.offset, end: block.position.end.offset };
      const following = siblings.slice(i + 1).filter((child) => !['emptyLine', 'newline'].includes(child.type));
      const [result, link] = following;
      if (result?.type === 'keyword' && result.key.toLowerCase() === 'results'
        && (result.value || '') === (block.attributes?.name || '')
        && link?.type === 'link' && localImageTarget(raw(link))
        && !source.slice(block.position.end.offset, result.position.start.offset).trim()
        && !source.slice(result.position.end.offset, link.position.start.offset).trim()
        && /^[ \t]*(?:\r?\n[ \t]*(?:\r?\n|$)|$)/.test(source.slice(link.position.end.offset))) {
        diagram.resultStart = link.position.start.offset;
      }
      diagrams.push(diagram);
      diagramNodes.set(block, diagram);
    }
    (node.children || []).forEach(index);
  }
  index(tree);
  const children = (node) => (node.children || []).map(render).join('');
  function render(node) {
    if (ignored.has(node.type)) return '';
    switch (node.type) {
      case 'document': case 'section': return children(node);
      case 'text': {
        const tag = styles[node.style];
        return tag ? `<${tag}>${escapeHtml(node.value)}</${tag}>` : escapeHtml(node.value);
      }
      case 'newline': return '\n';
      case 'paragraph': return `<p>${children(node)}</p>`;
      case 'headline': {
        const level = Math.min(node.level + 1, 6);
        return `<h${level} id="${escapeHtml(ids.get(node))}" data-level="${node.level}">${children(node)}</h${level}>`;
      }
      case 'todo': return `<span class="todo ${node.actionable ? 'pending' : 'done'}">${escapeHtml(node.keyword)}</span> `;
      case 'priority': return `<span class="priority">${escapeHtml(node.value)}</span> `;
      case 'tags': return `<span class="tags">${node.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</span>`;
      case 'link': {
        const pathValue = node.path?.value || '';
        const reference = raw(node);
        if (node.path?.protocol === 'file' && localImageTarget(reference)) {
          if (images.length >= MAX_IMAGE_LINKS) return `<span class="image-placeholder">Image limit reached: ${escapeHtml(pathValue)}</span>`;
          const id = images.length;
          images.push({ id, reference, start: node.position.start.offset, end: node.position.end.offset, label: pathValue });
          return `<span class="image-preview" data-image-id="${id}" data-image-start="${node.position.start.offset}"><span class="image-placeholder">Loading image: ${escapeHtml(pathValue)}</span></span>`;
        }
        // Orga separates mailto from its address, unlike HTTP URLs.
        const value = node.path?.protocol === 'mailto' ? `mailto:${pathValue}` : pathValue;
        const label = children(node) || escapeHtml(value);
        if (node.path?.protocol === 'internal') {
          const target = value.startsWith('#') ? anchor(value.slice(1)) : outline.find((item) => item.label === value.replace(/^\*/, ''))?.id;
          return target ? `<a href="#${escapeHtml(target)}">${label}</a>` : `<span class="unresolved" title="Unresolved Org link">${label}</span>`;
        }
        if (/^https?:\/\//i.test(value) || /^mailto:/i.test(value)) return `<a href="${escapeHtml(value)}" rel="noreferrer">${label}</a>`;
        return `<span class="unresolved" title="Local and custom protocol links are not available in v0.1">${label}</span>`;
      }
      case 'list': {
        // Orga may group ordered and unordered items in the same list node.
        const groups = [];
        for (const child of node.children) {
          if (child.type === 'list.item') {
            const ordered = child.children.find((item) => item.type === 'list.item.bullet')?.ordered ?? node.ordered;
            const tag = ordered ? 'ol' : 'ul';
            if (groups.at(-1)?.tag !== tag) groups.push({ tag, items: [] });
            groups.at(-1).items.push(`<li>${children(child)}</li>`);
          } else if (child.type === 'list' && groups.length) {
            // Nested lists belong inside the preceding item.
            const items = groups.at(-1).items;
            items[items.length - 1] = items.at(-1).replace(/<\/li>$/, `${render(child)}</li>`);
          }
        }
        return groups.map(({ tag, items }) => `<${tag}>${items.join('')}</${tag}>`).join('');
      }
      case 'list.item.checkbox': return `<input type="checkbox" disabled ${node.checked === true ? 'checked' : ''} aria-label="${node.checked === true ? 'Complete' : 'Incomplete'}"> `;
      case 'table': {
        const rows = node.children.filter((child) => child.type === 'table.row');
        const hasHeader = node.children.findIndex((child) => child.type === 'table.hr') === 1;
        const row = (item, tag) => `<tr>${item.children.filter((child) => child.type === 'table.cell').map((cell) => `<${tag}>${children(cell)}</${tag}>`).join('')}</tr>`;
        return `<div class="table-wrap"><table>${hasHeader ? `<thead>${row(rows.shift(), 'th')}</thead>` : ''}<tbody>${rows.map((item) => row(item, 'td')).join('')}</tbody></table></div>`;
      }
      case 'block': {
        if (node.name.toLowerCase() === 'quote') return `<blockquote>${children(node)}</blockquote>`;
        const diagram = diagramNodes.get(node);
        if (diagram) {
          if (diagram.error) return `<figure class="code-block"><figcaption>mermaid · ${escapeHtml(diagram.error)}</figcaption><pre><code>${escapeHtml(node.value)}</code></pre></figure>`;
          return `<figure class="code-block diagram" data-diagram-id="${diagram.id}"><figcaption>mermaid</figcaption><div class="diagram-output" role="status">Rendering diagram…</div><details open><summary>Show source</summary><pre><code>${escapeHtml(node.value)}</code></pre></details></figure>`;
        }
        const sourceBlock = node.name.toLowerCase() === 'src';
        const language = sourceBlock ? node.params?.[0] || '' : '';
        const label = sourceBlock ? language || 'source' : node.name;
        const highlighted = sourceBlock ? highlightCode(node.value, language) : null;
        return `<figure class="code-block"><figcaption>${escapeHtml(label)}</figcaption><pre><code>${highlighted ?? escapeHtml(node.value)}</code></pre></figure>`;
      }
      case 'planning': return `<p class="planning">${escapeHtml(raw(node))}</p>`;
      case 'drawer': return `<details class="drawer"><summary>${escapeHtml(node.name.toLowerCase())}</summary><pre>${escapeHtml(node.value.trim())}</pre></details>`;
      case 'keyword': case 'comment': return '';
      case 'hr': return '<hr>';
      default: return `<span>${escapeHtml(raw(node))}</span>`;
    }
  }
  return {
    html: render(tree), outline, images, diagrams,
    title: String(tree.properties.title || fallbackTitle),
    subtitle: String(tree.properties.subtitle || ''),
    author: String(tree.properties.author || ''),
    words: source.trim() ? source.trim().split(/\s+/).length : 0,
    lines: source.split('\n').length,
  };
}
