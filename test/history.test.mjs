import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGitLog, summarize, fileHistory } from '../src/history.mjs';

const REC = '\x1e', FLD = '\x1f';
const log = (...rows) => rows.map(([h, a, e, d, s, stat]) =>
  REC + [h, a, e, d, s].join(FLD) + '\n\n' + (stat ?? '')).join('');

test('parses a commit with its line counts', () => {
  const c = parseGitLog(log(['abc123', 'Sam Ortiz', 'sam@example.com', '2026-10-16T16:24:35+02:00',
    'docs(standards): add alias', '1\t0\t.claude/skills/code-standards/SKILL.md\n']));
  assert.equal(c.length, 1);
  const { files, ...rest } = c[0];
  assert.deepEqual(rest, {
    hash: 'abc123', author: 'Sam Ortiz', email: 'sam@example.com',
    date: '2026-10-16T16:24:35+02:00', subject: 'docs(standards): add alias',
    added: 1, removed: 0,
  });
  assert.deepEqual(files, [{ path: '.claude/skills/code-standards/SKILL.md', added: 1, removed: 0 }]);
});

test('adds up lines when a commit touches several files', () => {
  const c = parseGitLog(log(['a', 'X', 'x@x', '2026-01-01T00:00:00Z', 's', '3\t1\tuno\n10\t2\tdos\n']));
  assert.equal(c[0].added, 13);
  assert.equal(c[0].removed, 3);
});

test('does not blow up on binaries, which git marks with dashes', () => {
  const c = parseGitLog(log(['a', 'X', 'x@x', '2026-01-01T00:00:00Z', 's', '-\t-\timagen.png\n']));
  assert.equal(c[0].added, 0);
  assert.equal(c[0].removed, 0);
});

test('a subject containing the separator is not split', () => {
  const c = parseGitLog(log(['a', 'X', 'x@x', '2026-01-01T00:00:00Z', 'fix: a' + FLD + 'b', '']));
  assert.equal(c[0].subject, 'fix: a' + FLD + 'b');
});

test('empty output gives an empty list', () => {
  assert.deepEqual(parseGitLog(''), []);
  assert.deepEqual(parseGitLog('\n  \n'), []);
});

test('the creator is the oldest commit, not the first in the list', () => {
  const s = summarize([
    { author: 'Sam', date: '2026-10-16T00:00:00Z', hash: 'b', subject: 'cambio' },
    { author: 'Alex', date: '2026-10-05T00:00:00Z', hash: 'a', subject: 'crea' },
  ]);
  assert.equal(s.creator.author, 'Alex');
  assert.equal(s.creator.date, '2026-10-05T00:00:00Z');
  assert.equal(s.lastChange.author, 'Sam');
  assert.equal(s.commits, 2);
});

test('authors come out ordered by number of changes', () => {
  const s = summarize([
    { author: 'A', date: '3', hash: '3' }, { author: 'B', date: '2', hash: '2' },
    { author: 'A', date: '1', hash: '1' },
  ]);
  assert.deepEqual(s.authors, [{ author: 'A', commits: 2 }, { author: 'B', commits: 1 }]);
});

test('no commits means no summary', () => {
  assert.equal(summarize([]), null);
});

test('outside a repo it says so instead of inventing it', () => {
  const r = fileHistory(null, '.claude/settings.json');
  assert.equal(r.tracked, false);
  assert.match(r.reason, /outside a repository/);
});

import { buildPeople } from '../src/history.mjs';

test('parseGitLog also returns the files of each commit', () => {
  const c = parseGitLog(log(['a', 'X', 'x@x', '2026-01-01T00:00:00Z', 's', '3\t1\tuno.md\n10\t2\tdos.md\n']));
  assert.deepEqual(c[0].files, [
    { path: 'uno.md', added: 3, removed: 1 },
    { path: 'dos.md', added: 10, removed: 2 },
  ]);
});

const commit = (author, email, date, hash) => ({ author, email, date, hash, subject: 's' });

test('the creator is whoever made the oldest commit, not the last', () => {
  const idx = new Map([['.claude/skills/a/SKILL.md', [
    commit('Sam', 'sam@example.com', '2026-10-16T00:00:00Z', 'b'),
    commit('Alex', 'alex@example.com', '2026-10-05T00:00:00Z', 'a'),
  ]]]);
  const people = buildPeople(
    [{ id: '1', kind: 'skill', name: 'a', title: 'a', scope: 'repo', repo: '/r', relPath: '.claude/skills/a/SKILL.md' }],
    () => idx);
  const carles = people.find((p) => p.email === 'alex@example.com');
  const sergi = people.find((p) => p.email === 'sam@example.com');
  assert.equal(carles.created.length, 1);
  assert.equal(carles.modified.length, 0);
  assert.equal(sergi.created.length, 0);
  assert.equal(sergi.modified.length, 1, 'whoever did not create it but touched it counts as a modification');
});

test('the same human under two names is grouped by email', () => {
  const idx = new Map([['f.md', [
    commit('Alex Rivera', 'alex@example.com', '2026-10-10T00:00:00Z', 'b'),
    commit('alex', 'alex@example.com', '2026-10-01T00:00:00Z', 'a'),
  ]]]);
  const people = buildPeople([{ id: '1', kind: 'skill', name: 'f', title: 'f', scope: 'r', repo: '/r', relPath: 'f.md' }], () => idx);
  assert.equal(people.length, 1);
  assert.deepEqual(people[0].names.sort(), ['Alex Rivera', 'alex']);
  assert.equal(people[0].name, 'Alex Rivera', 'keeps the most recent name');
  assert.equal(people[0].commits, 2);
});

test('touching a piece twice does not count it twice as modified', () => {
  const idx = new Map([['f.md', [
    commit('Sam', 'sam@example.com', '2026-10-16T00:00:00Z', 'c'),
    commit('Sam', 'sam@example.com', '2026-10-12T00:00:00Z', 'b'),
    commit('Alex', 'alex@example.com', '2026-10-05T00:00:00Z', 'a'),
  ]]]);
  const sergi = buildPeople([{ id: '1', kind: 'skill', name: 'f', title: 'f', scope: 'r', repo: '/r', relPath: 'f.md' }], () => idx)
    .find((p) => p.email === 'sam@example.com');
  assert.equal(sergi.modified.length, 1);
  assert.equal(sergi.commits, 2);
});

test('pieces outside a repo are left out', () => {
  assert.deepEqual(buildPeople([{ id: '1', kind: 'skill', name: 'g', repo: null, relPath: null }], () => new Map()), []);
});

test('orders by pieces created', () => {
  const idx = new Map([
    ['a.md', [commit('A', 'a@x', '2026-01-01T00:00:00Z', '1')]],
    ['b.md', [commit('A', 'a@x', '2026-01-02T00:00:00Z', '2')]],
    ['c.md', [commit('B', 'b@x', '2026-01-03T00:00:00Z', '3')]],
  ]);
  const items = ['a', 'b', 'c'].map((n, i) => ({ id: String(i), kind: 'skill', name: n, title: n, scope: 'r', repo: '/r', relPath: n + '.md' }));
  assert.deepEqual(buildPeople(items, () => idx).map((p) => p.email), ['a@x', 'b@x']);
});

import { identityKeys, mergeIdentities } from '../src/history.mjs';

test('the GitHub address loses its numeric prefix', () => {
  assert.ok(identityKeys({ email: '113125369+arivera@users.noreply.github.com', names: [] })
    .includes('n:arivera'));
});

test('generic local parts merge nobody', () => {
  const k = identityKeys({ email: 'admin@empresa.com', names: [] });
  assert.ok(!k.some((x) => x.startsWith('n:')), 'admin@ must not merge two different people');
});

test('accents do not split the same name', () => {
  assert.deepEqual(identityKeys({ email: '', names: ['Luis Fuentes'] }),
    identityKeys({ email: '', names: ['Luis Fuentes'] }));
});

const person = (name, email, names, created = [], commits = 1) => ({
  id: email, name, email, names, created, modified: [], commits,
  first: '2026-01-01T00:00:00Z', last: '2026-01-01T00:00:00Z',
});

test('merges the work address, the GitHub one and the laptop one', () => {
  const m = mergeIdentities([
    person('alex', 'alex@example.com', ['alex', 'arivera']),
    person('Alex Rivera', '113125369+arivera@users.noreply.github.com', ['Alex Rivera']),
    person('Alex Rivera', 'alex@macbook-air.local', ['Alex Rivera']),
  ]);
  assert.equal(m.length, 1, 'las tres identidades son la misma persona');
  assert.equal(m[0].emails.length, 3);
  assert.equal(m[0].commits, 3);
});

test('merges by name when the addresses look nothing alike', () => {
  const m = mergeIdentities([
    person('Sam Ortiz', 'sam@example.com', ['Sam Ortiz']),
    person('Sam Ortiz', '80685759+SamOrtiz@users.noreply.github.com', ['Sam Ortiz']),
  ]);
  assert.equal(m.length, 1);
});

test('does not merge two different people', () => {
  const m = mergeIdentities([
    person('Sam Ortiz', 'sam@example.com', ['Sam Ortiz']),
    person('Luis Fuentes', 'luis@example.com', ['Luis Fuentes']),
    person('Dana Lee', 'dana@example.com', ['Dana Lee']),
  ]);
  assert.equal(m.length, 3);
});

test('what one identity created is not counted as modified by another of the same person', () => {
  const a = person('alex', 'alex@example.com', ['alex'], [{ id: '7', kind: 'skill', name: 'x' }]);
  const b = person('Alex', 'alex@example.com', ['Alex']);
  b.modified = [{ id: '7', kind: 'skill', name: 'x' }];
  const m = mergeIdentities([a, b]);
  assert.equal(m.length, 1);
  assert.equal(m[0].created.length, 1);
  assert.equal(m[0].modified.length, 0, 'creating it and touching it is not creating it and also modifying it');
});

test('keeps the name from the most recent activity', () => {
  const viejo = person('alex', 'alex@example.com', ['alex']);
  const nuevo = { ...person('Alex Rivera', 'alex@example.com', ['Alex Rivera']), last: '2026-10-01T00:00:00Z' };
  assert.equal(mergeIdentities([viejo, nuevo])[0].name, 'Alex Rivera');
});
