import { test } from 'node:test';
import assert from 'node:assert/strict';
import { md } from '../ui/markdown.js';

test('cabeceras y párrafos', () => {
  assert.match(md('# Título\n\nUn párrafo.'), /<h1>Título<\/h1>.*<p>Un párrafo\.<\/p>/s);
});

test('se salta el frontmatter', () => {
  assert.doesNotMatch(md('---\nname: x\n---\n\n# Hola'), /name/);
});

test('listas con viñetas y numeradas', () => {
  assert.match(md('- uno\n- dos'), /<ul><li>uno<\/li><li>dos<\/li><\/ul>/);
  assert.match(md('1. uno\n2. dos'), /<ol><li>uno<\/li>/);
});

test('tablas', () => {
  const h = md('|a|b|\n|-|-|\n|1|2|');
  assert.match(h, /<table><tr><th>a<\/th>/);
  assert.match(h, /<td>1<\/td>/);
});

test('negrita, enlaces y código en línea', () => {
  assert.match(md('**fuerte**'), /<strong>fuerte<\/strong>/);
  assert.match(md('[t](https://e.com)'), /<a href="https:\/\/e\.com"/);
  assert.match(md('x ' + String.fromCharCode(96) + 'code' + String.fromCharCode(96)), /<code>code<\/code>/);
});

test('bloques de código', () => {
  const f = String.fromCharCode(96).repeat(3);
  assert.match(md(f + 'bash\nnpm test\n' + f), /<pre><code>npm test/);
});

test('escapa el HTML del contenido', () => {
  assert.match(md('<script>alert(1)</script>'), /&lt;script&gt;/);
  assert.doesNotMatch(md('<img onerror=x>'), /<img/);
});

test('un documento vacío no revienta', () => {
  assert.equal(md(''), '');
});
