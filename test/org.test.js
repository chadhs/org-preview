import test from 'node:test';
import assert from 'node:assert/strict';
import { renderOrg } from '../src/org.js';

test('metadata, task states, tags, stable duplicate headings, and custom anchors', () => {
  const result = renderOrg('#+title: A notebook\n#+author: Chad\n* TODO First :work:\n:PROPERTIES:\n:CUSTOM_ID: custom\n:END:\n* DONE First\n* First\n[[#custom][Go back]]');
  assert.equal(result.title, 'A notebook');
  assert.equal(result.author, 'Chad');
  assert.deepEqual(result.outline.map((h) => h.id), ['org-custom', 'org-first', 'org-first-2']);
  assert.match(result.html, /class="todo pending">TODO/);
  assert.match(result.html, /class="todo done">DONE/);
  assert.match(result.html, /<span>work<\/span>/);
  assert.match(result.html, /href="#org-custom"/);
});

test('emphasis, nested lists, checkboxes, tables and source blocks', () => {
  const { html } = renderOrg('* Hello\n*bold* /italic/ =literal= ~code~ _under_ +gone+\n\n- [X] Done\n  - Nested\n- [ ] Later\n\n| Name | Value |\n|------+-------|\n| One | Two |\n\n#+begin_src js\nconsole.log("<hello>")\n#+end_src');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<code>literal<\/code>/);
  assert.match(html, /<u>under<\/u>/);
  assert.match(html, /<s>gone<\/s>/);
  assert.match(html, /Done\s*<ul><li>Nested\s*<\/li><\/ul><\/li>/);
  assert.match(html, /disabled checked/);
  assert.match(html, /<thead><tr><th> Name <\/th>/);
  assert.match(html, /console.log\(&quot;&lt;hello&gt;&quot;\)/);
});

test('embedded HTML, code, attributes and unsafe links stay inert', () => {
  const { html, title } = renderOrg('#+title: <script>alert(1)</script>\n* <img src=x onerror=alert(1)>\n[[javascript:alert(1)][click]]\n[[file:/etc/passwd][local]]\n[[https://example.com/"onclick="bad][safe]]\n#+begin_export html\n<script>alert(1)</script><img src="https://tracker.test/pixel">\n#+end_export');
  assert.equal(title, '<script>alert(1)</script>');
  assert.doesNotMatch(html, /<(script|img)\b/);
  assert.doesNotMatch(html, /href="(?:javascript|file):/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /href="https:\/\/example.com\/&quot;onclick=&quot;bad"/);
});

test('empty files, no headings, Unicode and headings deeper than HTML supports', () => {
  assert.equal(renderOrg('', 'Empty').title, 'Empty');
  assert.equal(renderOrg('').words, 0);
  assert.equal(renderOrg('Just a paragraph').outline.length, 0);
  const result = renderOrg('* Café 日本語\n******* Deep');
  assert.equal(result.outline[0].id, 'org-café-日本語');
  assert.match(result.html, /<h6 /);
});
