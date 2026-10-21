import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain } from '../ui/permissions.js';

test('una regla acotada se explica sin alarmar', () => {
  const r = explain('Bash(git *)');
  assert.match(r.text, /git/);
  assert.equal(r.level, 'normal');
});

test('los intérpretes se marcan como permiso amplio', () => {
  for (const rule of ['Bash(bash *)', 'Bash(node *)', 'Bash(python3 *)']) {
    assert.equal(explain(rule).level, 'broad', rule + ' debería salir como amplio');
  }
  assert.match(explain('Bash(node *)').text, /cualquier script/);
});

test('rm se marca porque borra ficheros', () => {
  const r = explain('Bash(rm -rf *)');
  assert.equal(r.level, 'broad');
  assert.match(r.text, /[Bb]orra ficheros/);
});

test('leer cualquier ruta es amplio', () => {
  assert.equal(explain('Read(**)').level, 'broad');
});

test('una herramienta MCP que envía se marca como saliente', () => {
  const r = explain('mcp__slack__slack_send_message');
  assert.equal(r.level, 'outbound');
  assert.match(r.text, /enviar o cambiar/);
});

test('una herramienta MCP de sólo lectura no se marca', () => {
  assert.equal(explain('mcp__slack__slack_read_channel').level, 'normal');
});

test('una herramienta sin argumentos se explica igual', () => {
  assert.match(explain('WebSearch').text, /buscar en internet/);
});

test('una regla ilegible no revienta', () => {
  assert.ok(explain('%%%').text.length > 0);
});
