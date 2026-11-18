import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIAGNOSES, RUNS, VARIANCE, LIMITS, LOOP } from '../ui/evalguide.js';

test('every diagnosis says what it means, what to do and whose fault it is', () => {
  const levels = new Set(['good', 'mid', 'bad', 'flat']);
  for (const d of DIAGNOSES) {
    assert.ok(levels.has(d.level), d.id + ' has an unknown level');
    assert.ok(d.meaning.length > 40 && d.action.length > 40, d.id + ' is missing its copy');
    assert.ok(d.culprit, d.id + ' does not name a culprit');
  }
});

test('the diagnoses cover the four things that can move', () => {
  const culprits = DIAGNOSES.map((d) => d.culprit).join(' ');
  for (const who of ['la skill', 'la rúbrica', 'el juez', 'la description']) {
    assert.ok(culprits.includes(who), 'no diagnosis blames ' + who);
  }
});

test('a case that never fired is never blamed on the skill', () => {
  const d = DIAGNOSES.find((x) => x.id === 'never-fired');
  assert.match(d.culprit, /description/);
  assert.doesNotMatch(d.action, /borra/i);
});

test('a quiet negative case is reported as correct, not as a failure', () => {
  const d = DIAGNOSES.find((x) => x.id === 'quiet-and-right');
  assert.equal(d.level, 'good');
  assert.match(d.action, /Nada/);
});

test('ids are unique, so a row cannot be shown twice', () => {
  const ids = DIAGNOSES.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('one run is never presented as evidence', () => {
  const one = RUNS.find((r) => r[0].startsWith('1 '));
  assert.equal(one[3], 'bad');
  assert.match(one[4], /No es evidencia/);
});

test('the significance figures are the exact ones, not rounded guesses', () => {
  // Fisher's exact on a clean 2x2: 1/C(2n,n) for n runs per arm.
  assert.equal(RUNS.find((r) => r[0].startsWith('3 '))[2], '5 %');     // 1/20
  assert.equal(RUNS.find((r) => r[0].startsWith('5 '))[2], '0,4 %');   // 1/252
});

test('the guide keeps the judge as a named source of variance', () => {
  assert.equal(VARIANCE.length, 2);
  assert.ok(VARIANCE.some(([src]) => /juez/.test(src)));
});

test('the limits are present and name the multiple-comparisons trap', () => {
  assert.ok(LIMITS.length >= 4);
  assert.ok(LIMITS.some(([t]) => /azar/.test(t)));
  assert.ok(LIMITS.some(([, d]) => /19 %/.test(d)));
});

test('the loop goes from free to expensive, in order', () => {
  assert.deepEqual(LOOP.map((l) => l[0]), ['1', '2', '3', '4', '5']);
  assert.match(LOOP[0][2], /gratis/);
  assert.match(LOOP[1][3], /description/);
});
