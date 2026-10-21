import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontmatter, scriptDoc } from '../src/fsutil.mjs';

test('frontmatter lee los pares clave: valor', () => {
  const fm = frontmatter('---\nname: triage\ndescription: Hace cosas\n---\n\n# Título');
  assert.equal(fm.name, 'triage');
  assert.equal(fm.description, 'Hace cosas');
});

test('frontmatter quita las comillas del valor', () => {
  assert.equal(frontmatter('---\nname: "con comillas"\n---').name, 'con comillas');
});

test('frontmatter devuelve {} si no hay bloque', () => {
  assert.deepEqual(frontmatter('# Sólo un título'), {});
});

test('frontmatter no se cree un --- que aparece más abajo', () => {
  assert.deepEqual(frontmatter('Texto\n\n---\nname: no\n---'), {});
});

test('scriptDoc junta los comentarios de cabecera y se salta el shebang', () => {
  assert.equal(scriptDoc('#!/bin/bash\n# Sincroniza worktrees.\n# Se dispara tras git worktree add.\necho hola\n# otro'),
    'Sincroniza worktrees. Se dispara tras git worktree add.');
});

test('scriptDoc entiende los comentarios de JavaScript', () => {
  assert.equal(scriptDoc('// Genera el board de PRs.\nimport x from "y";'), 'Genera el board de PRs.');
});

test('scriptDoc devuelve cadena vacía si no hay cabecera', () => {
  assert.equal(scriptDoc('echo hola'), '');
});
