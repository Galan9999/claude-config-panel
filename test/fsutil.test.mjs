import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontmatter, scriptDoc } from '../src/fsutil.mjs';

test('frontmatter reads key: value pairs', () => {
  const fm = frontmatter('---\nname: triage\ndescription: Does things\n---\n\n# Title');
  assert.equal(fm.name, 'triage');
  assert.equal(fm.description, 'Does things');
});

test('frontmatter strips quotes from the value', () => {
  assert.equal(frontmatter('---\nname: "con comillas"\n---').name, 'con comillas');
});

test('frontmatter returns {} when there is no block', () => {
  assert.deepEqual(frontmatter('# Just a title'), {});
});

test('frontmatter ignores a --- that appears further down', () => {
  assert.deepEqual(frontmatter('Texto\n\n---\nname: no\n---'), {});
});

test('scriptDoc joins the header comments and skips the shebang', () => {
  assert.equal(scriptDoc('#!/bin/bash\n# Sincroniza worktrees.\n# Se dispara tras git worktree add.\necho hola\n# otro'),
    'Sincroniza worktrees. Se dispara tras git worktree add.');
});

test('scriptDoc understands JavaScript comments', () => {
  assert.equal(scriptDoc('// Genera el board de PRs.\nimport x from "y";'), 'Genera el board de PRs.');
});

test('scriptDoc returns an empty string when there is no header', () => {
  assert.equal(scriptDoc('echo hola'), '');
});
