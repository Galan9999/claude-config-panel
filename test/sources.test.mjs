// Where the config is read from: the shared helpers, discover's exclusion, and
// GET/POST /api/sources. Invented fixtures only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { summarize, summaryLine, findPrompt } from '../ui/sources.js';
import { discover } from '../src/discover.mjs';
import { createPanelServer } from '../src/server.mjs';

const root = mkdtempSync(join(tmpdir(), 'sources-'));
const put = (p, t) => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), t); };
put('alpha/.claude/skills/helper/SKILL.md', '---\nname: helper\ndescription: Helps.\n---\n');
put('alpha/.claude/commands/ship/1.spec.md', '---\ndescription: Spec\n---\n');
put('beta/.claude/agents/reviewer.md', '---\nname: reviewer\ndescription: Reviews.\n---\n');
const alpha = join(root, 'alpha'), beta = join(root, 'beta');

test('summarize groups by kind in a stable order', () => {
  const s = summarize([{ kind: 'agent', name: 'b' }, { kind: 'skill', name: 'a' }, { kind: 'agent', name: 'a' }]);
  assert.deepEqual(s.map((x) => [x.kind, x.count]), [['skill', 1], ['agent', 2]]);
  assert.deepEqual(s[1].names, ['a', 'b']);
  assert.equal(summaryLine([]), 'nothing Claude reads');
  assert.equal(summaryLine([{ kind: 'skill', name: 'a' }, { kind: 'command', name: 'c' }]), '1 skills · 1 commands');
});

test('the find prompt only lists, and names the folders when given', () => {
  assert.match(findPrompt('everything'), /home folder/);
  assert.match(findPrompt('everything'), /do not change anything/);
  assert.match(findPrompt('chosen', ['~/code', '~/work']), /~\/code, ~\/work/);
});

test('discover leaves excluded projects out but still reports them', () => {
  const all = discover({ scanRoots: [root] });
  assert.ok(all.projects.includes(alpha) && all.projects.includes(beta));
  const some = discover({ scanRoots: [root], exclude: [beta] });
  assert.ok(some.projects.includes(beta), 'still listed, so it can be put back');
  assert.ok(!some.items.some((i) => i.project === beta));
  assert.ok(some.items.some((i) => i.project === alpha));
});

let server, base;
before(async () => {
  server = createPanelServer({ scanRoots: [root] });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  server = createPanelServer({ scanRoots: [root], port });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + port;
});
after(() => new Promise((r) => server.close(r)));

const post = (body, type = 'application/json') => fetch(base + '/api/sources', { method: 'POST', headers: { 'content-type': type }, body: JSON.stringify(body) });

test('GET /api/sources lists each project with what it holds', async () => {
  const d = await (await fetch(base + '/api/sources')).json();
  assert.equal(d.mode, 'chosen');
  const a = d.projects.find((p) => p.path === alpha);
  assert.ok(a.included);
  assert.deepEqual(a.files.map((f) => f.kind).sort(), ['command', 'skill']);
  assert.ok(Array.isArray(d.global.files));
});

test('POST exclude leaves a project out of every view', async () => {
  const d = await (await post({ exclude: [beta] })).json();
  assert.equal(d.projects.find((p) => p.path === beta).included, false);
  const items = (await (await fetch(base + '/api/items')).json()).items;
  assert.ok(!items.some((i) => i.project === beta));
  await post({ exclude: [] });
});

test('POST roots narrows the scan and refuses what is not a folder', async () => {
  const d = await (await post({ roots: [alpha] })).json();
  assert.deepEqual(d.projects.map((p) => p.path), [alpha]);
  assert.equal((await post({ roots: [join(root, 'nope')] })).status, 422);
  assert.equal((await post({ roots: ['relative/path'] })).status, 422);
  assert.equal((await post({ roots: [] })).status, 400);
  await post({ roots: [root] });
});

test('POST /api/sources needs JSON and our origin', async () => {
  assert.equal((await post({ exclude: [] }, 'text/plain')).status, 415);
  const r = await fetch(base + '/api/sources', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example.com' }, body: '{}' });
  assert.equal(r.status, 403);
});
