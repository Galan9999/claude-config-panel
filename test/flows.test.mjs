import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhase, isFolderDoc, groupFlows, parseTools, findCommandRefs, findConfigPaths, brokenRefs } from '../src/flows.mjs';

test('reconoce una fase numerada', () => {
  assert.deepEqual(parsePhase('lpb:3.dev'), { folder: 'lpb', order: 3, slug: 'dev' });
  assert.deepEqual(parsePhase('lpb:1.read'), { folder: 'lpb', order: 1, slug: 'read' });
});

test('lo que no es una fase no lo es', () => {
  for (const n of ['lpb:lesson', 'fix-ts', 'lp:task', '', null]) assert.equal(parsePhase(n), null);
});

test('_SDD_README es documentación de la carpeta, no un comando', () => {
  assert.equal(isFolderDoc('lpb:_SDD_README'), true);
  assert.equal(isFolderDoc('lpb:3.dev'), false);
});

const cmd = (name, extra = {}) => ({ name, scope: 'repo', repo: '/r', meta: {}, ...extra });

test('agrupa las fases en orden, aunque lleguen desordenadas', () => {
  const [f] = groupFlows([cmd('lpb:3.dev'), cmd('lpb:1.read'), cmd('lpb:2.refine')]);
  assert.deepEqual(f.phases.map((p) => p.order), [1, 2, 3]);
  assert.equal(f.folder, 'lpb');
});

test('un comando suelto no es un flujo', () => {
  assert.deepEqual(groupFlows([cmd('lpb:1.read'), cmd('otro:solo')]), []);
});

test('la documentación de la carpeta va con su flujo', () => {
  const [f] = groupFlows([cmd('lpb:1.read'), cmd('lpb:2.refine'), cmd('lpb:_SDD_README')]);
  assert.equal(f.phases.length, 2);
  assert.equal(f.docs.length, 1);
});

test('marca las herramientas que actúan fuera de la máquina', () => {
  const t = parseTools('Bash, Read, mcp__x__slack_send_message, mcp__x__notion-fetch, mcp__x__notion-update-page');
  assert.equal(t.tools.length, 5);
  assert.deepEqual(t.outward, ['mcp__x__slack_send_message', 'mcp__x__notion-update-page']);
  assert.equal(t.agents, false);
});

test('Task significa que la fase lanza subagentes', () => {
  assert.equal(parseTools('Task, Bash').agents, true);
});

test('sin allowed-tools no revienta', () => {
  assert.deepEqual(parseTools(undefined), { tools: [], outward: [], agents: false });
});

test('encuentra los comandos citados en un texto', () => {
  const refs = findCommandRefs('Primero /lpb:1.read y luego /lpb:2.refine model:opus');
  assert.ok(refs.includes('lpb:1.read'));
  assert.ok(refs.includes('lpb:2.refine'));
});

test('detecta un comando citado que ya no existe', () => {
  const known = new Set(['lpb:1.read', 'lpb:2.refine']);
  const refs = findCommandRefs('usa /lpb:1.read y después /lp:promote');
  assert.deepEqual(brokenRefs(refs, new Set([...known, 'lp:task'])), ['lp:promote']);
});

test('no se mete con carpetas que no son suyas', () => {
  assert.deepEqual(brokenRefs(['http:something', 'otra:cosa'], new Set(['lpb:1.read'])), []);
});

test('encuentra rutas de configuración citadas', () => {
  const p = findConfigPaths('ver `.claude/agents/lp-dev-worker.md` y apps/web/.claude/skills/x/SKILL.md.');
  assert.ok(p.includes('.claude/agents/lp-dev-worker.md'));
  assert.ok(p.includes('apps/web/.claude/skills/x/SKILL.md'));
});

test('los huecos de la prosa no son comandos rotos', () => {
  const known = new Set(['lpb:1.read']);
  for (const hueco of ['/lpb:N', '/lpb:X', '/lpb:<fase>', '/lpb:FASE']) {
    assert.deepEqual(brokenRefs(findCommandRefs('escribe ' + hueco + ' aquí'), known), [],
      hueco + ' es un hueco, no un comando');
  }
});

test('pero un comando retirado sí se marca', () => {
  assert.deepEqual(brokenRefs(findCommandRefs('usa /lpb:promote'), new Set(['lpb:1.read'])), ['lpb:promote']);
});

test('las carpetas no cuentan como rutas rotas: se crean al vuelo', () => {
  assert.deepEqual(findConfigPaths('deja el ticket en `.claude/tickets/`'), []);
  assert.deepEqual(findConfigPaths('lee `.claude/tickets/x.md`'), ['.claude/tickets/x.md']);
});
