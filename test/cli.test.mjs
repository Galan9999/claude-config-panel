import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli.mjs';

test('puerto por defecto', () => {
  assert.equal(parseArgs([], {}).port, 7337);
});

test('--port cambia el puerto', () => {
  assert.equal(parseArgs(['--port', '8080'], {}).port, 8080);
});

test('un puerto inválido falla con un mensaje claro', () => {
  assert.throws(() => parseArgs(['--port', 'abc'], {}), /Puerto inválido/);
  assert.throws(() => parseArgs(['--port', '99999'], {}), /Puerto inválido/);
});

test('una opción desconocida falla', () => {
  assert.throws(() => parseArgs(['--zzz'], {}), /Opción desconocida/);
});

test('las rutas sueltas son las carpetas a escanear', () => {
  assert.deepEqual(parseArgs(['/a', '/b'], {}).scanRoots, ['/a', '/b']);
});

test('CLAUDE_CFG_ROOTS se usa cuando no se pasan rutas', () => {
  assert.deepEqual(parseArgs([], { CLAUDE_CFG_ROOTS: '/x:/y' }).scanRoots, ['/x', '/y']);
});

test('los argumentos ganan a la variable de entorno', () => {
  assert.deepEqual(parseArgs(['/a'], { CLAUDE_CFG_ROOTS: '/x' }).scanRoots, ['/a']);
});

test('--worktrees y --help se reconocen', () => {
  assert.equal(parseArgs(['--worktrees'], {}).withWorktrees, true);
  assert.equal(parseArgs(['-h'], {}).help, true);
});
