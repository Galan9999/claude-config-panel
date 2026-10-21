import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFindings, sortFindings } from '../src/findings.mjs';

const ok = () => ({
  version: 1,
  generatedAt: '2026-10-21T16:00:00.000Z',
  tool: 'auditor-config',
  scope: { path: '~/repos/backend', kind: 'repo' },
  summary: 'Quitar Bash(bash *) del allow.',
  findings: [{
    id: 'permiso-bash-comodin',
    severity: 'alta',
    category: 'permiso-amplio',
    title: 'Bash(bash *) permite ejecutar cualquier script',
    path: '.claude/settings.local.json',
    line: 4,
    what: 'La regla deja correr cualquier fichero.',
    proposal: 'Sustituirla por las tres invocaciones concretas que se usan.',
    autofix: { kind: 'quitar-permiso', file: '.claude/settings.local.json', rule: 'Bash(bash *)' },
  }],
  notChecked: [],
});

test('un informe correcto pasa', () => {
  assert.deepEqual(validateFindings(ok()), { ok: true, errors: [] });
});

test('autofix puede ser null', () => {
  const d = ok(); d.findings[0].autofix = null;
  assert.equal(validateFindings(d).ok, true);
});

test('line es opcional', () => {
  const d = ok(); delete d.findings[0].line;
  assert.equal(validateFindings(d).ok, true);
});

test('exige version 1', () => {
  const d = ok(); d.version = 2;
  assert.match(validateFindings(d).errors.join(), /version debe ser 1/);
});

test('exige notChecked aunque esté vacío', () => {
  const d = ok(); delete d.notChecked;
  assert.match(validateFindings(d).errors.join(), /notChecked/);
});

test('rechaza severidad y categoría inventadas', () => {
  const d = ok(); d.findings[0].severity = 'crítica'; d.findings[0].category = 'cosa-rara';
  const e = validateFindings(d).errors.join();
  assert.match(e, /severity/);
  assert.match(e, /category desconocida/);
});

test('rechaza ids repetidos: si no, se abren dos tickets del mismo hallazgo', () => {
  const d = ok(); d.findings.push({ ...d.findings[0] });
  assert.match(validateFindings(d).errors.join(), /id repetido/);
});

test('rechaza un id que no es slug', () => {
  const d = ok(); d.findings[0].id = 'Permiso Amplio';
  assert.match(validateFindings(d).errors.join(), /slug/);
});

test('rechaza una propuesta que sólo dice "revisar"', () => {
  const d = ok(); d.findings[0].proposal = 'Revisar este permiso.';
  assert.match(validateFindings(d).errors.join(), /no puede ser "revisar"/);
});

test('rechaza una fecha que no es fecha', () => {
  const d = ok(); d.generatedAt = 'ayer';
  assert.match(validateFindings(d).errors.join(), /fecha ISO/);
});

test('no revienta con basura', () => {
  for (const v of [null, 42, 'texto', []]) assert.equal(validateFindings(v).ok, false);
});

test('un informe sin hallazgos es válido', () => {
  const d = ok(); d.findings = []; d.summary = 'Nada que arreglar.';
  assert.equal(validateFindings(d).ok, true);
});

test('sortFindings ordena por severidad', () => {
  const f = [{ severity: 'baja' }, { severity: 'alta' }, { severity: 'media' }];
  assert.deepEqual(sortFindings(f).map((x) => x.severity), ['alta', 'media', 'baja']);
});

test('un hallazgo puede llevar su página de Notion', () => {
  const d = ok();
  d.findings[0].notion = { url: 'https://notion.so/abc', recurrences: 3 };
  assert.equal(validateFindings(d).ok, true);
});

test('rechaza un notion sin url o con recurrencias absurdas', () => {
  const a = ok(); a.findings[0].notion = { recurrences: 1 };
  assert.match(validateFindings(a).errors.join(), /notion\.url/);
  const b = ok(); b.findings[0].notion = { url: 'https://n.so/x', recurrences: 0 };
  assert.match(validateFindings(b).errors.join(), /recurrences/);
});

import { clavesDePieza, hallazgosQueCitan } from '../src/findings.mjs';

test('una pieza se reconoce por su ruta y por su nombre de fichero', () => {
  assert.deepEqual(clavesDePieza('.claude/hooks/prettier-on-write.sh'),
    ['.claude/hooks/prettier-on-write.sh', 'prettier-on-write.sh']);
});

test('los nombres que lleva media configuración no valen para cruzar', () => {
  assert.deepEqual(clavesDePieza('.claude/skills/x/SKILL.md'), ['.claude/skills/x/SKILL.md']);
  assert.deepEqual(clavesDePieza('CLAUDE.md'), []);
  assert.deepEqual(clavesDePieza('.claude/settings.local.json'), ['.claude/settings.local.json']);
});

test('encuentra el hallazgo que habla de un script aunque cuelgue de otro fichero', () => {
  const f = [{
    path: '.claude/settings.local.json', severity: 'alta', title: 'Hook de Prettier duplicado',
    what: 'El mismo matcher lanza dos Prettier.',
    proposal: 'En ese caso ampliar prettier-on-write.sh, no duplicarlo.',
  }];
  assert.equal(hallazgosQueCitan(f, '.claude/hooks/prettier-on-write.sh').length, 1);
});

test('un hallazgo no se cita a sí mismo', () => {
  const f = [{ path: 'a/prettier-on-write.sh', severity: 'alta', title: 'x',
    what: 'prettier-on-write.sh falla', proposal: 'arreglarlo' }];
  assert.deepEqual(hallazgosQueCitan(f, 'a/prettier-on-write.sh'), []);
});
