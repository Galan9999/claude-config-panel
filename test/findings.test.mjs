import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFindings, sortFindings } from '../src/findings.mjs';

const ok = () => ({
  version: 1,
  generatedAt: '2026-10-21T16:00:00.000Z',
  tool: 'auditor-config',
  scope: { path: '~/repos/backend', kind: 'repo' },
  summary: 'Drop Bash(bash *) from allow.',
  findings: [{
    id: 'wildcard-bash-permission',
    severity: 'high',
    category: 'broad-permission',
    title: 'Bash(bash *) allows running any script',
    path: '.claude/settings.local.json',
    line: 4,
    what: 'The rule lets any file be executed.',
    proposal: 'Replace it with the three concrete invocations in use.',
    autofix: { kind: 'remove-permission', file: '.claude/settings.local.json', rule: 'Bash(bash *)' },
  }],
  notChecked: [],
});

test('a correct report passes', () => {
  assert.deepEqual(validateFindings(ok()), { ok: true, errors: [] });
});

test('autofix may be null', () => {
  const d = ok(); d.findings[0].autofix = null;
  assert.equal(validateFindings(d).ok, true);
});

test('line is optional', () => {
  const d = ok(); delete d.findings[0].line;
  assert.equal(validateFindings(d).ok, true);
});

test('requires version 1', () => {
  const d = ok(); d.version = 2;
  assert.match(validateFindings(d).errors.join(), /version must be 1/);
});

test('requires notChecked even when empty', () => {
  const d = ok(); delete d.notChecked;
  assert.match(validateFindings(d).errors.join(), /notChecked/);
});

test('rejects invented severity and category', () => {
  const d = ok(); d.findings[0].severity = 'critical'; d.findings[0].category = 'weird-thing';
  const e = validateFindings(d).errors.join();
  assert.match(e, /severity/);
  assert.match(e, /category is unknown/);
});

test('rejects duplicate ids: otherwise the same finding opens two tickets', () => {
  const d = ok(); d.findings.push({ ...d.findings[0] });
  assert.match(validateFindings(d).errors.join(), /is duplicated/);
});

test('rejects an id that is not a slug', () => {
  const d = ok(); d.findings[0].id = 'Broad Permission';
  assert.match(validateFindings(d).errors.join(), /slug/);
});

test('rejects a proposal that only says "review"', () => {
  const d = ok(); d.findings[0].proposal = 'Review this permission.';
  assert.match(validateFindings(d).errors.join(), /cannot be "review"/);
});

test('rejects a date that is not a date', () => {
  const d = ok(); d.generatedAt = 'ayer';
  assert.match(validateFindings(d).errors.join(), /ISO date/);
});

test('does not blow up on garbage', () => {
  for (const v of [null, 42, 'texto', []]) assert.equal(validateFindings(v).ok, false);
});

test('a report with no findings is valid', () => {
  const d = ok(); d.findings = []; d.summary = 'Nothing to fix.';
  assert.equal(validateFindings(d).ok, true);
});

test('sortFindings orders by severity', () => {
  const f = [{ severity: 'low' }, { severity: 'high' }, { severity: 'medium' }];
  assert.deepEqual(sortFindings(f).map((x) => x.severity), ['high', 'medium', 'low']);
});

test('a finding may carry its tracker page', () => {
  const d = ok();
  d.findings[0].notion = { url: 'https://notion.so/abc', recurrences: 3 };
  assert.equal(validateFindings(d).ok, true);
});

test('rejects a tracker entry with no url or absurd recurrences', () => {
  const a = ok(); a.findings[0].notion = { recurrences: 1 };
  assert.match(validateFindings(a).errors.join(), /notion\.url/);
  const b = ok(); b.findings[0].notion = { url: 'https://n.so/x', recurrences: 0 };
  assert.match(validateFindings(b).errors.join(), /recurrences/);
});

import { pieceKeys, findingsMentioning } from '../src/findings.mjs';

test('a piece is recognised by its path and by its filename', () => {
  assert.deepEqual(pieceKeys('.claude/hooks/prettier-on-write.sh'),
    ['.claude/hooks/prettier-on-write.sh', 'prettier-on-write.sh']);
});

test('names half a configuration shares are no good for matching', () => {
  assert.deepEqual(pieceKeys('.claude/skills/x/SKILL.md'), ['.claude/skills/x/SKILL.md']);
  assert.deepEqual(pieceKeys('CLAUDE.md'), []);
  assert.deepEqual(pieceKeys('.claude/settings.local.json'), ['.claude/settings.local.json']);
});

test('finds the finding that talks about a script even when it hangs off another file', () => {
  const f = [{
    path: '.claude/settings.local.json', severity: 'high', title: 'Hook de Prettier duplicado',
    what: 'El mismo matcher lanza dos Prettier.',
    proposal: 'En ese caso ampliar prettier-on-write.sh, no duplicarlo.',
  }];
  assert.equal(findingsMentioning(f, '.claude/hooks/prettier-on-write.sh').length, 1);
});

test('a finding does not mention itself', () => {
  const f = [{ path: 'a/prettier-on-write.sh', severity: 'high', title: 'x',
    what: 'prettier-on-write.sh falla', proposal: 'arreglarlo' }];
  assert.deepEqual(findingsMentioning(f, 'a/prettier-on-write.sh'), []);
});
