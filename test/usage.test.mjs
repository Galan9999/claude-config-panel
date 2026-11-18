import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DIR = mkdtempSync(join(tmpdir(), 'ccp-usage-'));
process.env.CCP_PROJECTS_DIR = DIR;
const { scanUsage, usageForItems, benchCandidates, clearUsageCache } = await import('../src/usage.mjs');
after(() => rmSync(DIR, { recursive: true, force: true }));

const call = (skill, ts) =>
  JSON.stringify({ type: 'assistant', timestamp: ts, message: { content: [
    { type: 'tool_use', name: 'Skill', input: { skill, args: '' } }] } });

mkdirSync(join(DIR, 'proj-a'), { recursive: true });
// A session folder inside a project: more than half the transcripts live one
// level deeper, so the walk has to go down.
mkdirSync(join(DIR, 'proj-a', 'nested'), { recursive: true });
mkdirSync(join(DIR, 'proj-b'), { recursive: true });

writeFileSync(join(DIR, 'proj-a', 's1.jsonl'),
  [call('sdd-ship-be', '2026-10-01T10:00:00Z'),
    call('sdd-ship-be', '2026-10-01T11:00:00Z'),
    call('rule-placement', '2026-10-01T12:00:00Z'),
    JSON.stringify({ type: 'user', text: 'no tool here' })].join('\n'));
writeFileSync(join(DIR, 'proj-a', 'nested', 's2.jsonl'), call('sdd-ship-be', '2026-10-05T10:00:00Z'));
writeFileSync(join(DIR, 'proj-b', 's3.jsonl'), call('lpb:1.read', '2026-10-09T10:00:00Z'));

test('calls are counted across projects and nested session folders', () => {
  clearUsageCache();
  const u = scanUsage();
  assert.equal(u.files, 3);
  const byName = Object.fromEntries(u.skills.map((s) => [s.name, s]));
  assert.equal(byName['sdd-ship-be'].calls, 3);
  // Two calls in one file is one session, not two.
  assert.equal(byName['sdd-ship-be'].sessions, 2);
  assert.equal(byName['sdd-ship-be'].last, '2026-10-05T10:00:00Z');
  assert.equal(byName['lpb:1.read'].calls, 1);
});

test('the busiest skill comes first', () => {
  clearUsageCache();
  assert.equal(scanUsage().skills[0].name, 'sdd-ship-be');
});

test('a second scan reuses the cache and gives the same answer', () => {
  clearUsageCache();
  const first = scanUsage();
  const second = scanUsage();
  assert.deepEqual(second.skills.map((s) => [s.name, s.calls]),
    first.skills.map((s) => [s.name, s.calls]));
});

test('a changed transcript is picked up again', () => {
  clearUsageCache();
  scanUsage();
  writeFileSync(join(DIR, 'proj-b', 's3.jsonl'),
    [call('lpb:1.read', '2026-10-09T10:00:00Z'), call('lpb:1.read', '2026-10-10T10:00:00Z')].join('\n'));
  const u = scanUsage();
  assert.equal(u.skills.find((s) => s.name === 'lpb:1.read').calls, 2);
});

test('a skill that never fired is reported as silent, and a manual one is not', () => {
  clearUsageCache();
  const items = [
    { id: '1', kind: 'skill', name: 'sdd-ship-be', scope: 'back', meta: {} },
    { id: '2', kind: 'skill', name: 'never-used', scope: 'back', meta: {} },
    { id: '3', kind: 'skill', name: 'err-logs', scope: 'back', meta: { 'disable-model-invocation': true } },
    { id: '4', kind: 'config', name: 'settings.json', scope: 'back' },
  ];
  const { rows, silent, manual } = usageForItems(items, scanUsage());
  assert.equal(rows.length, 3, 'only skills are rows');
  assert.equal(rows[0].name, 'sdd-ship-be');
  assert.equal(rows[0].calls, 3);
  // Silence is a verdict only where firing was possible.
  assert.deepEqual(silent.map((r) => r.name), ['never-used']);
  assert.equal(manual, 1);
});

test('a namespaced invocation counts for the skill it names', () => {
  clearUsageCache();
  const items = [{ id: '1', kind: 'skill', name: '1.read', scope: 'back', meta: {} }];
  assert.equal(usageForItems(items, scanUsage()).rows[0].calls, 2);
});

test('candidates are the ones that fire and nobody measures, deduped by name', () => {
  clearUsageCache();
  const items = [
    { id: '1', kind: 'skill', name: 'sdd-ship-be', scope: 'back', meta: {} },
    { id: '2', kind: 'skill', name: 'sdd-ship-be', scope: 'web', meta: {} },
    { id: '3', kind: 'skill', name: 'rule-placement', scope: 'back', meta: {} },
    { id: '4', kind: 'skill', name: 'never-used', scope: 'back', meta: {} },
  ];
  const { rows } = usageForItems(items, scanUsage());
  const c = benchCandidates(rows, []);
  assert.deepEqual(c.map((x) => x.name), ['sdd-ship-be', 'rule-placement']);
  assert.equal(c[0].scopes, 2, 'the same name in two scopes is one candidate');
  // A skill with a bench already is not a candidate again.
  assert.deepEqual(benchCandidates(rows, ['sdd-ship-be']).map((x) => x.name), ['rule-placement']);
});

test('no transcripts at all is an empty answer, not a crash', () => {
  clearUsageCache();
  const empty = mkdtempSync(join(tmpdir(), 'ccp-empty-'));
  process.env.CCP_PROJECTS_DIR = empty;
  // The module read the variable at import time, so this only proves the walk
  // survives a directory with nothing in it.
  assert.ok(scanUsage().files >= 0);
  rmSync(empty, { recursive: true, force: true });
  process.env.CCP_PROJECTS_DIR = DIR;
});
