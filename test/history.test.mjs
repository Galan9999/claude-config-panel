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
  const { files, ...rest } = c[0];
  assert.deepEqual(rest, {
    hash: 'abc123', author: 'Sergi Nadal', email: 's@x.com',
    date: '2026-10-16T16:24:35+02:00', subject: 'docs(standards): add alias',
    added: 1, removed: 0,
  });
  assert.deepEqual(files, [{ path: '.claude/skills/code-standards/SKILL.md', added: 1, removed: 0 }]);
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

import { buildPeople } from '../src/history.mjs';

test('parseGitLog devuelve también los ficheros de cada commit', () => {
  const c = parseGitLog(log(['a', 'X', 'x@x', '2026-01-01T00:00:00Z', 's', '3\t1\tuno.md\n10\t2\tdos.md\n']));
  assert.deepEqual(c[0].files, [
    { path: 'uno.md', added: 3, removed: 1 },
    { path: 'dos.md', added: 10, removed: 2 },
  ]);
});

const commit = (author, email, date, hash) => ({ author, email, date, hash, subject: 's' });

test('crea quien hizo el commit más antiguo, no el último', () => {
  const idx = new Map([['.claude/skills/a/SKILL.md', [
    commit('Sergi', 's@lp.com', '2026-10-16T00:00:00Z', 'b'),
    commit('Carles', 'c@lp.com', '2026-10-05T00:00:00Z', 'a'),
  ]]]);
  const people = buildPeople(
    [{ id: '1', kind: 'skill', name: 'a', title: 'a', scope: 'repo', repo: '/r', relPath: '.claude/skills/a/SKILL.md' }],
    () => idx);
  const carles = people.find((p) => p.email === 'c@lp.com');
  const sergi = people.find((p) => p.email === 's@lp.com');
  assert.equal(carles.created.length, 1);
  assert.equal(carles.modified.length, 0);
  assert.equal(sergi.created.length, 0);
  assert.equal(sergi.modified.length, 1, 'quien no la creó pero la tocó cuenta como modificación');
});

test('el mismo humano con dos nombres se agrupa por email', () => {
  const idx = new Map([['f.md', [
    commit('Carles Galan', 'c@lp.com', '2026-10-10T00:00:00Z', 'b'),
    commit('cgala', 'c@lp.com', '2026-10-01T00:00:00Z', 'a'),
  ]]]);
  const people = buildPeople([{ id: '1', kind: 'skill', name: 'f', title: 'f', scope: 'r', repo: '/r', relPath: 'f.md' }], () => idx);
  assert.equal(people.length, 1);
  assert.deepEqual(people[0].names.sort(), ['Carles Galan', 'cgala']);
  assert.equal(people[0].name, 'Carles Galan', 'se queda con el nombre más reciente');
  assert.equal(people[0].commits, 2);
});

test('quien toca una pieza dos veces no la cuenta dos veces como modificada', () => {
  const idx = new Map([['f.md', [
    commit('Sergi', 's@lp.com', '2026-10-16T00:00:00Z', 'c'),
    commit('Sergi', 's@lp.com', '2026-10-12T00:00:00Z', 'b'),
    commit('Carles', 'c@lp.com', '2026-10-05T00:00:00Z', 'a'),
  ]]]);
  const sergi = buildPeople([{ id: '1', kind: 'skill', name: 'f', title: 'f', scope: 'r', repo: '/r', relPath: 'f.md' }], () => idx)
    .find((p) => p.email === 's@lp.com');
  assert.equal(sergi.modified.length, 1);
  assert.equal(sergi.commits, 2);
});

test('las piezas sin repo no entran', () => {
  assert.deepEqual(buildPeople([{ id: '1', kind: 'skill', name: 'g', repo: null, relPath: null }], () => new Map()), []);
});

test('ordena por piezas creadas', () => {
  const idx = new Map([
    ['a.md', [commit('A', 'a@x', '2026-01-01T00:00:00Z', '1')]],
    ['b.md', [commit('A', 'a@x', '2026-01-02T00:00:00Z', '2')]],
    ['c.md', [commit('B', 'b@x', '2026-01-03T00:00:00Z', '3')]],
  ]);
  const items = ['a', 'b', 'c'].map((n, i) => ({ id: String(i), kind: 'skill', name: n, title: n, scope: 'r', repo: '/r', relPath: n + '.md' }));
  assert.deepEqual(buildPeople(items, () => idx).map((p) => p.email), ['a@x', 'b@x']);
});

import { identityKeys, mergeIdentities } from '../src/history.mjs';

test('el local del correo de GitHub pierde el prefijo numérico', () => {
  assert.ok(identityKeys({ email: '113125369+Galan9999@users.noreply.github.com', names: [] })
    .includes('n:galan9999'));
});

test('los locales genéricos no sirven para unir a nadie', () => {
  const k = identityKeys({ email: 'admin@empresa.com', names: [] });
  assert.ok(!k.some((x) => x.startsWith('n:')), 'admin@ no debe unir a dos personas distintas');
});

test('los acentos no separan al mismo nombre', () => {
  assert.deepEqual(identityKeys({ email: '', names: ['Lluís Filella'] }),
    identityKeys({ email: '', names: ['Lluis Filella'] }));
});

const persona = (name, email, names, created = [], commits = 1) => ({
  id: email, name, email, names, created, modified: [], commits,
  first: '2026-01-01T00:00:00Z', last: '2026-01-01T00:00:00Z',
});

test('une el correo del trabajo, el de GitHub y el del portátil', () => {
  const m = mergeIdentities([
    persona('cgala', 'carles@legalpigeon.com', ['cgala', 'cgalan9']),
    persona('Carles Galan Bertran', '113125369+Galan9999@users.noreply.github.com', ['Carles Galan Bertran']),
    persona('Carles Galan Bertran', 'cgala@macbook-air.local', ['Carles Galan Bertran']),
  ]);
  assert.equal(m.length, 1, 'las tres identidades son la misma persona');
  assert.equal(m[0].emails.length, 3);
  assert.equal(m[0].commits, 3);
});

test('une por nombre cuando los correos no se parecen', () => {
  const m = mergeIdentities([
    persona('Sergi Nadal', 'sergi@legalpigeon.com', ['Sergi Nadal']),
    persona('Sergi Nadal', '80685759+SergiNadal@users.noreply.github.com', ['Sergi Nadal']),
  ]);
  assert.equal(m.length, 1);
});

test('no funde a dos personas distintas', () => {
  const m = mergeIdentities([
    persona('Sergi Nadal', 'sergi@legalpigeon.com', ['Sergi Nadal']),
    persona('Lluís Filella', 'lluis@legalpigeon.com', ['Lluís Filella']),
    persona('Alvaro Moya', 'alvaro@lidr.co', ['Alvaro Moya']),
  ]);
  assert.equal(m.length, 3);
});

test('lo que creó una identidad no cuenta como modificado por otra suya', () => {
  const a = persona('cgala', 'carles@lp.com', ['cgala'], [{ id: '7', kind: 'skill', name: 'x' }]);
  const b = persona('Carles', 'carles@lp.com', ['Carles']);
  b.modified = [{ id: '7', kind: 'skill', name: 'x' }];
  const m = mergeIdentities([a, b]);
  assert.equal(m.length, 1);
  assert.equal(m[0].created.length, 1);
  assert.equal(m[0].modified.length, 0, 'crearla y tocarla no es crearla y además modificarla');
});

test('se queda con el nombre de la actividad más reciente', () => {
  const viejo = persona('cgala', 'c@lp.com', ['cgala']);
  const nuevo = { ...persona('Carles Galan', 'c@lp.com', ['Carles Galan']), last: '2026-10-01T00:00:00Z' };
  assert.equal(mergeIdentities([viejo, nuevo])[0].name, 'Carles Galan');
});
