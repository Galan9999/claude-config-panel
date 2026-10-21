import { test } from 'node:test';
import assert from 'node:assert/strict';
import { md } from '../ui/markdown.js';

test('headings and paragraphs', () => {
  assert.match(md('# Title\n\nA paragraph.'), /<h1>Title<\/h1>.*<p>A paragraph\.<\/p>/s);
});

test('skips the frontmatter', () => {
  assert.doesNotMatch(md('---\nname: x\n---\n\n# Hola'), /name/);
});

test('bulleted and numbered lists', () => {
  assert.match(md('- uno\n- dos'), /<ul><li>uno<\/li><li>dos<\/li><\/ul>/);
  assert.match(md('1. uno\n2. dos'), /<ol><li>uno<\/li>/);
});

test('tables', () => {
  const h = md('|a|b|\n|-|-|\n|1|2|');
  assert.match(h, /<table><tr><th>a<\/th>/);
  assert.match(h, /<td>1<\/td>/);
});

test('bold, links and inline code', () => {
  assert.match(md('**fuerte**'), /<strong>fuerte<\/strong>/);
  assert.match(md('[t](https://e.com)'), /<a href="https:\/\/e\.com"/);
  assert.match(md('x ' + String.fromCharCode(96) + 'code' + String.fromCharCode(96)), /<code>code<\/code>/);
});

test('code blocks', () => {
  const f = String.fromCharCode(96).repeat(3);
  assert.match(md(f + 'bash\nnpm test\n' + f), /<pre><code>npm test/);
});

test('escapes HTML in the content', () => {
  assert.match(md('<script>alert(1)</script>'), /&lt;script&gt;/);
  assert.doesNotMatch(md('<img onerror=x>'), /<img/);
});

test('an empty document does not blow up', () => {
  assert.equal(md(''), '');
});
