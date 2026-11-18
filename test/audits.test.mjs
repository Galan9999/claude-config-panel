import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The store is a folder in the user's home; point it somewhere disposable
// before the module reads the variable.
const DIR = mkdtempSync(join(tmpdir(), 'ccp-audits-'));
process.env.CCP_AUDITS_DIR = DIR;
const { slugFor, runFileName, runsFor, readRun, saveRun, deleteRun, currentFor, listSlugs } =
  await import('../src/audits.mjs');

after(() => rmSync(DIR, { recursive: true, force: true }));

const report = (over = {}) => ({
  version: 1,
  generatedAt: '2026-10-27T10:00:00.000Z',
  tool: 'auditor-config',
  scope: { path: '/tmp/some-repo', kind: 'repo' },
  summary: 'Narrow the two wildcard rules.',
  findings: [{ id: 'wildcard-bash', severity: 'high', category: 'broad-permission',
    title: 'Bash(bash *) allows any script', path: '.claude/settings.json',
    what: 'The rule names the shell, not a command.', proposal: 'Replace it with the two scripts actually run.',
    autofix: null }],
  notChecked: [],
  ...over,
});

test('a slug is stable, readable and derived from the path', () => {
  assert.equal(slugFor('/tmp/some-repo'), 'tmp-some-repo');
  assert.equal(slugFor('/tmp/some-repo'), slugFor('/tmp/some-repo'));
  assert.notEqual(slugFor('/tmp/other-repo'), slugFor('/tmp/some-repo'));
});

test('run files sort chronologically', () => {
  const a = runFileName('2026-10-27T10:00:00.000Z');
  const b = runFileName('2026-10-28T10:00:00.000Z');
  assert.ok(a < b);
  assert.match(a, /\.json$/);
});

test('a valid report is stored and read back', () => {
  const saved = saveRun(report());
  assert.equal(saved.ok, true);
  assert.ok(existsSync(saved.path));
  const runs = runsFor(saved.slug);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].findings, 1);
  assert.equal(readRun(saved.slug, runs[0].file).doc.summary, 'Narrow the two wildcard rules.');
});

test('an invalid report is refused instead of corrupting the history', () => {
  const bad = saveRun(report({ summary: '' }));
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length);
});

test('runs accumulate, newest first', () => {
  saveRun(report({ generatedAt: '2026-10-29T10:00:00.000Z', summary: 'Later run.' }));
  const runs = runsFor(slugFor('/tmp/some-repo'));
  assert.equal(runs.length, 2);
  assert.equal(runs[0].generatedAt, '2026-10-29T10:00:00.000Z');
});

test('the current report for a repo is the newest stored run', () => {
  const cur = currentFor('/tmp/some-repo');
  assert.equal(cur.source, 'store');
  assert.equal(cur.doc.summary, 'Later run.');
  assert.equal(cur.runs.length, 2);
});

test('a repo never audited into the store still shows its in-repo report', () => {
  const repo = mkdtempSync(join(tmpdir(), 'ccp-repo-'));
  mkdirSync(join(repo, '.claude', 'audit'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'audit', 'findings.json'),
    JSON.stringify(report({ scope: { path: repo, kind: 'repo' }, summary: 'Legacy report.' })));
  const cur = currentFor(repo);
  assert.equal(cur.source, 'repo');
  assert.equal(cur.doc.summary, 'Legacy report.');
  rmSync(repo, { recursive: true, force: true });
});

test('a run can be deleted, and a bad name cannot', () => {
  const runs = runsFor(slugFor('/tmp/some-repo'));
  assert.equal(deleteRun(slugFor('/tmp/some-repo'), runs[0].file), true);
  assert.equal(deleteRun('../escape', 'x.json'), false);
  assert.equal(deleteRun(slugFor('/tmp/some-repo'), '../../etc/passwd'), false);
});

test('questions ride along with a report', () => {
  const withQ = report({ generatedAt: '2026-10-30T10:00:00.000Z', questions: [{
    id: 'why-bash-wildcard', about: 'Bash(bash *)', path: '.claude/settings.json',
    question: 'Which script were you running when this rule stopped the prompts?',
    whyItMatters: 'The answer turns one wildcard into one exact rule, or removes it.',
    options: ['Name the script', 'I do not remember — drop it', 'Keep it, I run many'],
    findingId: 'wildcard-bash' }] });
  const saved = saveRun(withQ);
  assert.equal(saved.ok, true);
  assert.equal(readRun(saved.slug, runsFor(saved.slug)[0].file).doc.questions.length, 1);
});

test('a question that does not ask anything is refused', () => {
  const bad = saveRun(report({ generatedAt: '2026-10-31T10:00:00.000Z', questions: [{
    id: 'not-a-question', about: 'x', path: 'y',
    question: 'This is a statement.', whyItMatters: 'nothing', options: ['a', 'b'] }] }));
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /actually ask/.test(e)));
});

test('the store lists the repos it holds', () => {
  assert.ok(listSlugs().includes(slugFor('/tmp/some-repo')));
});
