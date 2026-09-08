import { parse } from 'orga';

export const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ignored = new Set(['stars', 'opening', 'closing', 'link.path', 'list.item.bullet', 'emptyLine', 'table.columnSeparator', 'table.hr']);
const styles = { bold: 'strong', italic: 'em', underline: 'u', strikeThrough: 's', strikethrough: 's', code: 'code', verbatim: 'code' };

export function renderOrg(source, fallbackTitle = 'Untitled') {
  const tree = parse(source);
  const outline = [];
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
        const label = node.name.toLowerCase() === 'src' ? node.params?.[0] || 'source' : node.name;
        return `<figure class="code-block"><figcaption>${escapeHtml(label)}</figcaption><pre><code>${escapeHtml(node.value)}</code></pre></figure>`;
      }
      case 'planning': return `<p class="planning">${escapeHtml(raw(node))}</p>`;
      case 'drawer': return `<details class="drawer"><summary>${escapeHtml(node.name.toLowerCase())}</summary><pre>${escapeHtml(node.value.trim())}</pre></details>`;
      case 'keyword': case 'comment': return '';
      case 'hr': return '<hr>';
      default: return `<span>${escapeHtml(raw(node))}</span>`;
    }
  }
  return {
    html: render(tree), outline,
    title: String(tree.properties.title || fallbackTitle),
    subtitle: String(tree.properties.subtitle || ''),
    author: String(tree.properties.author || ''),
    words: source.trim() ? source.trim().split(/\s+/).length : 0,
    lines: source.split('\n').length,
  };
}
