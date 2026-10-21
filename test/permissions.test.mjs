import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain } from '../ui/permissions.js';

test('a narrow rule is explained without alarm', () => {
  const r = explain('Bash(git *)');
  assert.match(r.text, /git/);
  assert.equal(r.level, 'normal');
});

test('interpreters are flagged as a broad permission', () => {
  for (const rule of ['Bash(bash *)', 'Bash(node *)', 'Bash(python3 *)']) {
    assert.equal(explain(rule).level, 'broad', rule + ' should come out as broad');
  }
  assert.match(explain('Bash(node *)').text, /any script/);
});

test('rm is flagged because it deletes files', () => {
  const r = explain('Bash(rm -rf *)');
  assert.equal(r.level, 'broad');
  assert.match(r.text, /[Ii]t deletes files/);
});

test('reading any path is broad', () => {
  assert.equal(explain('Read(**)').level, 'broad');
});

test('an MCP tool that sends is flagged as outbound', () => {
  const r = explain('mcp__slack__slack_send_message');
  assert.equal(r.level, 'outbound');
  assert.match(r.text, /send or change/);
});

test('a read-only MCP tool is not flagged', () => {
  assert.equal(explain('mcp__slack__slack_read_channel').level, 'normal');
});

test('a tool with no arguments is explained all the same', () => {
  assert.match(explain('WebSearch').text, /search the internet/);
});

test('an unreadable rule does not blow up', () => {
  assert.ok(explain('%%%').text.length > 0);
});
