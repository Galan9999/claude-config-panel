import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTools, connectorsInRules } from '../src/tools.mjs';
import { describeMod } from '../ui/mods.js';

const files = [
  { label: 'Global · settings.json', isGlobal: true, name: 'settings.json', fullPath: '/nonexistent',
    allow: ['Read(**)', 'Bash(git *)', 'mcp__claude_ai_Slack__slack_send_message'], ask: [], deny: ['WebFetch'] },
];

test('each built-in tool says what your settings make of it', () => {
  const t = readTools({ settingsFiles: files, projects: [], mods: [], claudeDir: '/nonexistent', claudeJson: '/nonexistent' });
  const by = Object.fromEntries(t.builtin.map((x) => [x.name, x]));
  assert.equal(by.Read.state, 'allowed');
  assert.equal(by.WebFetch.state, 'forbidden');
  assert.equal(by.Bash.state, 'asks, except the allowed patterns');
  assert.equal(by.Write.state, 'asks you');
  assert.equal(by.Grep.state, 'free (never asks)');
});

test('claude.ai connectors are found through the rules that name them', () => {
  const c = connectorsInRules(files);
  assert.equal(c.length, 1);
  assert.equal(c[0].name, 'Slack');
  assert.equal(c[0].kind, 'claude.ai connector');
});

test('a mod\'s tools and commands come with the description written in its source', () => {
  const src = [
    "$.tool.register({ tools })",
    "const T = [",
    "  {",
    "    name: 'open',",
    "    description:",
    "      'Opens sessions ' +",
    "      'in new windows.',",
    "    inputSchema: { type: 'object' },",
    "  },",
    "]",
    "await $.command.register({ name: 'chat', description: 'The session menu', argumentHint: '[filter]' })",
  ].join('\n');
  const m = describeMod({ dir: 'x', manifest: { name: 'x' }, sources: [src], active: true });
  assert.deepEqual(m.toolDetails.map((t) => [t.name, t.description]), [['open', 'Opens sessions in new windows.']]);
  assert.deepEqual(m.commandDetails, [{ name: '/chat', description: 'The session menu' }]);
});
