import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli.mjs';

test('default port', () => {
  assert.equal(parseArgs([], {}).port, 7337);
});

test('--port changes the port', () => {
  assert.equal(parseArgs(['--port', '8080'], {}).port, 8080);
});

test('an invalid port fails with a clear message', () => {
  assert.throws(() => parseArgs(['--port', 'abc'], {}), /Invalid port/);
  assert.throws(() => parseArgs(['--port', '99999'], {}), /Invalid port/);
});

test('an unknown option fails', () => {
  assert.throws(() => parseArgs(['--zzz'], {}), /Unknown option/);
});

test('bare paths are the folders to scan', () => {
  assert.deepEqual(parseArgs(['/a', '/b'], {}).scanRoots, ['/a', '/b']);
});

test('CLAUDE_CFG_ROOTS is used when no paths are given', () => {
  assert.deepEqual(parseArgs([], { CLAUDE_CFG_ROOTS: '/x:/y' }).scanRoots, ['/x', '/y']);
});

test('arguments win over the environment variable', () => {
  assert.deepEqual(parseArgs(['/a'], { CLAUDE_CFG_ROOTS: '/x' }).scanRoots, ['/a']);
});

test('--worktrees and --help are recognised', () => {
  assert.equal(parseArgs(['--worktrees'], {}).withWorktrees, true);
  assert.equal(parseArgs(['-h'], {}).help, true);
});

test('default depth and --depth', () => {
  assert.equal(parseArgs([], {}).depth, 5);
  assert.equal(parseArgs(['--depth', '7'], {}).depth, 7);
});

test('an absurd depth fails', () => {
  assert.throws(() => parseArgs(['--depth', '0'], {}), /Invalid depth/);
  assert.throws(() => parseArgs(['--depth', '99'], {}), /Invalid depth/);
});
