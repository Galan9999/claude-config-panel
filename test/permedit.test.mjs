import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPermissionOp, permissionSummary, badRule } from '../src/permedit.mjs';

const base = { model: 'opus', permissions: { allow: ['Bash(git *)'], deny: ['Bash(rm -rf /)'], defaultMode: 'auto' } };

test('add puts the rule in the list and leaves the rest of the file alone', () => {
  const r = applyPermissionOp(base, { op: 'add', list: 'ask', rule: 'Bash(gh pr merge *)' });
  assert.equal(r.changed, true);
  assert.deepEqual(r.obj.permissions.ask, ['Bash(gh pr merge *)']);
  assert.equal(r.obj.model, 'opus');
  assert.equal(base.permissions.ask, undefined, 'the input is not mutated');
});

test('adding a rule already there changes nothing', () => {
  assert.equal(applyPermissionOp(base, { op: 'add', list: 'allow', rule: 'Bash(git *)' }).changed, false);
});

test('adding a rule that lives in another list asks to move it instead', () => {
  assert.match(applyPermissionOp(base, { op: 'add', list: 'allow', rule: 'Bash(rm -rf /)' }).error, /move/);
});

test('move takes the rule out of one list and into the other, dropping the emptied list', () => {
  const r = applyPermissionOp(base, { op: 'move', list: 'allow', rule: 'Bash(git *)', to: 'ask' });
  assert.equal(r.obj.permissions.allow, undefined);
  assert.deepEqual(r.obj.permissions.ask, ['Bash(git *)']);
});

test('remove of a rule that is no longer there says the file changed', () => {
  assert.match(applyPermissionOp(base, { op: 'remove', list: 'allow', rule: 'Bash(ls *)' }).error, /no longer/);
});

test('mode default removes the key; an unknown mode is refused', () => {
  assert.equal(applyPermissionOp(base, { op: 'mode', value: 'default' }).obj.permissions.defaultMode, undefined);
  assert.ok(applyPermissionOp(base, { op: 'mode', value: 'yolo' }).error);
});

test('malformed rules are refused before touching anything', () => {
  for (const bad of ['', 'Bash(a)\nBash(b)', 'rm -rf /', 'x'.repeat(600)]) assert.ok(badRule(bad), JSON.stringify(bad));
  assert.equal(badRule('Bash(pnpm test *)'), null);
  assert.equal(badRule('mcp__claude_ai_Slack__slack_send_message'), null);
  assert.equal(badRule('WebSearch'), null);
});

test('a file with no permissions block still summarises', () => {
  assert.deepEqual(permissionSummary({}), { defaultMode: 'default', allow: [], ask: [], deny: [] });
});
