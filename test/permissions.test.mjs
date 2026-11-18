import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain, MODES, autoModeGrant, classifierNote, describe, sentence } from '../ui/permissions.js';

test('a Bash rule that runs a script takes the script\'s language', () => {
  const d = describe('Bash(/usr/bin/env python3 /x/scripts/chat-menu.py *)');
  assert.equal(d.lang, 'python');
  assert.match(d.action, /chat-menu\.py/);
  assert.ok(d.notes.some((n) => /says today/.test(n)), 'warns that the file decides');
  assert.ok(d.notes.some((n) => /env only sets up/.test(n)));
});

test('wrappers and VAR=value are looked past to find the real program', () => {
  const d = describe('Bash(node_modules/.bin/cross-env NODE_ENV=test node_modules/.bin/jest --ci*)');
  assert.equal(d.program, 'jest');
  assert.equal(d.lang, 'node');
});

test('the language of common programs', () => {
  assert.equal(describe('Bash(git *)').lang, 'shell');
  assert.equal(describe('Bash(pnpm test)').lang, 'node');
  assert.equal(describe('Bash(osascript *)').lang, 'applescript');
  assert.equal(describe('Read(**)').lang, 'files');
  assert.equal(describe('WebFetch(domain:github.com)').lang, 'web');
  assert.equal(describe('mcp__claude_ai_Notion__notion-fetch').lang, 'mcp');
});

test('an open interpreter is broad; an exact command line is not', () => {
  assert.equal(describe('Bash(python3 *)').level, 'broad');
  assert.equal(describe('Bash(pnpm test)').level, 'normal');
  assert.match(describe('Bash(pnpm test)').scope, /Exactly/);
});

test('the sentence quotes the rule, so a narrow deny is not read as a wide one', () => {
  assert.equal(sentence('Bash(git push --force*main*)', 'deny'), 'Never allowed to run "git push --force*main…".');
  assert.match(describe('Bash(git push --force*main*)').scope, /each \* stands for any text/);
  assert.match(sentence('Bash(pnpm test)', 'ask'), /^Always asks you before/);
  assert.equal(sentence('Bash(git *)', 'allow'), 'Can run git with any arguments without asking you.');
});

test('connectors say which service and whether they act outward', () => {
  const d = describe('mcp__1d163d7a-54f0-43c7-90af-783b3dc1ad68__slack_send_message');
  assert.equal(d.level, 'outbound');
  assert.match(d.server, /claude\.ai connector/);
  assert.match(describe('mcp__claude_ai_Notion__notion-fetch').server, /Notion/);
});

test('nothing it is handed makes describe throw', () => {
  for (const r of ['', '%%%', 'Bash()', 'Bash(*)', 'Bash', 'mcp__x', null, undefined]) assert.ok(describe(r).langLabel);
});

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

test('the mode list covers every mode Claude Code accepts', () => {
  const names = MODES.map(([v]) => v);
  for (const m of ['default', 'plan', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions']) {
    assert.ok(names.includes(m), m + ' should be offered');
  }
});

test('auto mode is granted only from the global settings.json', () => {
  assert.equal(autoModeGrant('settings.json', true).granted, true);
  assert.equal(autoModeGrant('settings.local.json', true).granted, false);
  assert.equal(autoModeGrant('settings.json', false).granted, false);
  assert.equal(autoModeGrant('settings.local.json', false).granted, false);
});

test('a project file says why its "auto" is ignored', () => {
  assert.match(autoModeGrant('settings.local.json', false).text, /ignored/);
});

test('without classifyAllShell an allow rule carries no classifier note', () => {
  assert.equal(classifierNote('Bash(gh pr *)'), null);
});

test('classifyAllShell marks Bash rules as suspended, and only those', () => {
  const n = classifierNote('Bash(gh pr *)', { classifyAllShell: true });
  assert.equal(n.level, 'warn');
  assert.match(n.label, /suspended/);
  assert.equal(classifierNote('Read(**)', { classifyAllShell: true }), null);
  assert.equal(classifierNote('mcp__slack__slack_send_message', { classifyAllShell: true }), null);
});
