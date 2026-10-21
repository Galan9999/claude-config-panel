import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGitLog, summarize, fileHistory } from '../src/history.mjs';

const REC = '\x1e', FLD = '\x1f';
const log = (...rows) => rows.map(([h, a, e, d, s, stat]) =>
  REC + [h, a, e, d, s].join(FLD) + '\n\n' + (stat ?? '')).join('');

test('parsea un commit con su recuento de líneas', () => {
  const c = parseGitLog(log(['abc123', 'Sergi Nadal', 's@x.com', '2026-10-16T16:24:35+02:00',
    'docs(standards): add alias', '1\t0\t.claude/skills/code-standards/SKILL.md\n']));
  assert.equal(c.length, 1);
  assert.deepEqual({ ...c[0] }, {
    hash: 'abc123', author: 'Sergi Nadal', email: 's@x.com',
    date: '2026-10-16T16:24:35+02:00', subject: 'docs(standards): add alias',
    added: 1, removed: 0,
  });
});

test('suma las líneas cuando el commit toca varios ficheros', () => {
  const c = parseGitLog(log(['a', 'X', 'x@x', '2026-01-01T00:00:00Z', 's', '3\t1\tuno\n10\t2\tdos\n']));
  assert.equal(c[0].added, 13);
  assert.equal(c[0].removed, 3);
});

test('no revienta con binarios, que git marca con guiones', () => {
  const c = parseGitLog(log(['a', 'X', 'x@x', '2026-01-01T00:00:00Z', 's', '-\t-\timagen.png\n']));
  assert.equal(c[0].added, 0);
  assert.equal(c[0].removed, 0);
});

test('un asunto con el separador dentro no se parte', () => {
  const c = parseGitLog(log(['a', 'X', 'x@x', '2026-01-01T00:00:00Z', 'fix: a' + FLD + 'b', '']));
  assert.equal(c[0].subject, 'fix: a' + FLD + 'b');
});

test('salida vacía da lista vacía', () => {
  assert.deepEqual(parseGitLog(''), []);
  assert.deepEqual(parseGitLog('\n  \n'), []);
});

test('el creador es el commit más antiguo, no el primero de la lista', () => {
  const s = summarize([
    { author: 'Sergi', date: '2026-10-16T00:00:00Z', hash: 'b', subject: 'cambio' },
    { author: 'Carles', date: '2026-10-05T00:00:00Z', hash: 'a', subject: 'crea' },
  ]);
  assert.equal(s.creator.author, 'Carles');
  assert.equal(s.creator.date, '2026-10-05T00:00:00Z');
  assert.equal(s.lastChange.author, 'Sergi');
  assert.equal(s.commits, 2);
});

test('los autores salen ordenados por número de cambios', () => {
  const s = summarize([
    { author: 'A', date: '3', hash: '3' }, { author: 'B', date: '2', hash: '2' },
    { author: 'A', date: '1', hash: '1' },
  ]);
  assert.deepEqual(s.authors, [{ author: 'A', commits: 2 }, { author: 'B', commits: 1 }]);
});

test('sin commits no hay resumen', () => {
  assert.equal(summarize([]), null);
});

test('fuera de un repo lo dice en vez de inventárselo', () => {
  const r = fileHistory(null, '.claude/settings.json');
  assert.equal(r.tracked, false);
  assert.match(r.reason, /fuera de un repositorio/);
});
