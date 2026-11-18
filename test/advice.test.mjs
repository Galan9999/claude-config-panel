import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advise, scopeAdvice, FAMILIES, SYNTAX, LISTS } from '../ui/advice.js';

test('an interpreter rule is called out for what it really grants', () => {
  for (const rule of ['Bash(node *)', 'Bash(bash *)', 'Bash(python3 *)', 'Bash(npx *)']) {
    const a = advise(rule);
    assert.equal(a.verdict, 'avoid', rule + ' should be reconsidered');
    assert.match(a.why, /any code|file handed/);
  }
});

test('find is treated as an interpreter, not as a read', () => {
  const a = advise('Bash(find *)');
  assert.equal(a.verdict, 'avoid');
  assert.match(a.why, /-exec/);
  assert.equal(a.better[0].rule, 'Glob(**)');
});

test('a task runner rule is narrowed to the scripts you run', () => {
  const a = advise('Bash(npm run *)');
  assert.equal(a.verdict, 'narrow');
  assert.ok(a.better.some((b) => b.rule === 'Bash(npm test)'));
});

test('git and gh wildcards are narrowed, with the write verbs named', () => {
  assert.equal(advise('Bash(git log *)').verdict, 'narrow');
  assert.match(advise('Bash(git log *)').why, /--output/);
  assert.match(advise('Bash(gh pr *)').why, /merge/);
});

test('commands Claude Code already allows are reported as redundant', () => {
  const a = advise('Bash(ls *)');
  assert.equal(a.verdict, 'drop');
  assert.equal(a.better.length, 0);
});

test('an exact command is left alone', () => {
  const a = advise('Bash(npm test)');
  assert.equal(a.verdict, 'keep');
});

test('an unknown wildcard still warns that no flag is read', () => {
  const a = advise('Bash(mytool sync *)');
  assert.equal(a.verdict, 'narrow');
  assert.equal(a.better[0].rule, 'Bash(mytool sync)');
});

test('a path rule with no path is wider than a scoped one', () => {
  assert.equal(advise('Read(**)').verdict, 'narrow');
  assert.equal(advise('Write(**)').verdict, 'avoid');
  assert.equal(advise('Read(src/**)').verdict, 'keep');
});

test('a bare Bash rule is the whole terminal', () => {
  assert.equal(advise('Bash').verdict, 'avoid');
});

test('a connector rule explains that the name is all that is matched', () => {
  const a = advise('mcp__slack__slack_send_message');
  assert.match(a.why, /not unique|not bound/);
  assert.match(a.better[0].note, /settings\.local\.json/);
});

test('an unreadable rule does not blow up', () => {
  assert.ok(advise('%%%').why.length > 0);
});

test('an allow rule in the global file is flagged, in a local one is not', () => {
  assert.equal(scopeAdvice('Bash(git status)', 'allow', 'settings.json', true).ok, false);
  assert.equal(scopeAdvice('Bash(git status)', 'allow', 'settings.local.json', false).ok, true);
  assert.equal(scopeAdvice('Bash(git status)', 'allow', 'settings.json', false).ok, false);
});

test('a deny rule is at home in any scope', () => {
  assert.equal(scopeAdvice('Bash(rm -rf /)', 'deny', 'settings.json', true).ok, true);
  assert.equal(scopeAdvice('Bash(rm -rf /)', 'deny', 'settings.local.json', false).ok, true);
});

test('every family renders: a verdict the panel knows and a usable sample', () => {
  const known = new Set(['keep', 'narrow', 'drop', 'avoid']);
  for (const f of FAMILIES) {
    assert.ok(known.has(f.verdict), f.id + ' has an unknown verdict');
    assert.ok(f.progs.length && f.why.length > 40, f.id + ' is missing its copy');
    for (const b of f.better(f.progs[0])) assert.ok(b.rule && b.note, f.id + ' has an empty suggestion');
  }
});

test('no program is claimed by two families, which would make the advice arbitrary', () => {
  const seen = new Map();
  for (const f of FAMILIES) for (const p of f.progs) {
    assert.equal(seen.get(p), undefined, p + ' is in both ' + seen.get(p) + ' and ' + f.id);
    seen.set(p, f.id);
  }
});

test('the guide reference is not empty', () => {
  assert.ok(SYNTAX.length >= 5 && SYNTAX.every(([t, d]) => t && d));
  assert.ok(LISTS.some(([k]) => k === 'ask'));
});

test('a redundant command stays redundant without a wildcard', () => {
  assert.equal(advise('Bash(ls)').verdict, 'drop');
});
