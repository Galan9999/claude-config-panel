import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhase, isFolderDoc, groupFlows, parseTools, findCommandRefs, findConfigPaths, brokenRefs } from '../src/flows.mjs';

test('recognises a numbered phase', () => {
  assert.deepEqual(parsePhase('lpb:3.dev'), { folder: 'lpb', order: 3, slug: 'dev' });
  assert.deepEqual(parsePhase('lpb:1.read'), { folder: 'lpb', order: 1, slug: 'read' });
});

test('what is not a phase is not one', () => {
  for (const n of ['lpb:lesson', 'fix-ts', 'lp:task', '', null]) assert.equal(parsePhase(n), null);
});

test('a _README is folder documentation, not a command', () => {
  assert.equal(isFolderDoc('lpb:_SDD_README'), true);
  assert.equal(isFolderDoc('lpb:3.dev'), false);
});

const cmd = (name, extra = {}) => ({ name, scope: 'repo', repo: '/r', meta: {}, ...extra });

test('groups phases in order even when they arrive shuffled', () => {
  const [f] = groupFlows([cmd('lpb:3.dev'), cmd('lpb:1.read'), cmd('lpb:2.refine')]);
  assert.deepEqual(f.phases.map((p) => p.order), [1, 2, 3]);
  assert.equal(f.folder, 'lpb');
});

test('a single command is not a flow', () => {
  assert.deepEqual(groupFlows([cmd('lpb:1.read'), cmd('otro:solo')]), []);
});

test('folder documentation travels with its flow', () => {
  const [f] = groupFlows([cmd('lpb:1.read'), cmd('lpb:2.refine'), cmd('lpb:_SDD_README')]);
  assert.equal(f.phases.length, 2);
  assert.equal(f.docs.length, 1);
});

test('flags the tools that act outside the machine', () => {
  const t = parseTools('Bash, Read, mcp__x__slack_send_message, mcp__x__notion-fetch, mcp__x__notion-update-page');
  assert.equal(t.tools.length, 5);
  assert.deepEqual(t.outward, ['mcp__x__slack_send_message', 'mcp__x__notion-update-page']);
  assert.equal(t.agents, false);
});

test('Task means the phase spawns subagents', () => {
  assert.equal(parseTools('Task, Bash').agents, true);
});

test('does not blow up without allowed-tools', () => {
  assert.deepEqual(parseTools(undefined), { tools: [], outward: [], agents: false });
});

test('finds the commands quoted in a text', () => {
  const refs = findCommandRefs('Primero /lpb:1.read y luego /lpb:2.refine model:opus');
  assert.ok(refs.includes('lpb:1.read'));
  assert.ok(refs.includes('lpb:2.refine'));
});

test('detects a quoted command that no longer exists', () => {
  const known = new Set(['lpb:1.read', 'lpb:2.refine']);
  const refs = findCommandRefs('use /lpb:1.read and then /lp:promote');
  assert.deepEqual(brokenRefs(refs, new Set([...known, 'lp:task'])), ['lp:promote']);
});

test('keeps out of folders that are not its own', () => {
  assert.deepEqual(brokenRefs(['http:something', 'otra:cosa'], new Set(['lpb:1.read'])), []);
});

test('finds quoted configuration paths', () => {
  const p = findConfigPaths('ver `.claude/agents/lp-dev-worker.md` y apps/web/.claude/skills/x/SKILL.md.');
  assert.ok(p.includes('.claude/agents/lp-dev-worker.md'));
  assert.ok(p.includes('apps/web/.claude/skills/x/SKILL.md'));
});

test('placeholders in prose are not broken commands', () => {
  const known = new Set(['lpb:1.read']);
  for (const placeholder of ['/lpb:N', '/lpb:X', '/lpb:<fase>', '/lpb:FASE']) {
    assert.deepEqual(brokenRefs(findCommandRefs('write ' + placeholder + ' here'), known), [],
      placeholder + ' is a placeholder, not a command');
  }
});

test('but a retired command is flagged', () => {
  assert.deepEqual(brokenRefs(findCommandRefs('usa /lpb:promote'), new Set(['lpb:1.read'])), ['lpb:promote']);
});

test('folders do not count as broken paths: they are created on the fly', () => {
  assert.deepEqual(findConfigPaths('deja el ticket en `.claude/tickets/`'), []);
  assert.deepEqual(findConfigPaths('lee `.claude/tickets/x.md`'), ['.claude/tickets/x.md']);
});
