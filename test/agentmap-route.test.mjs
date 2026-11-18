// GET /api/agentmap, with the live overlay pointed at invented fixtures.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPanelServer } from '../src/server.mjs';

const dir = mkdtempSync(join(tmpdir(), 'agentmap-route-'));
const sessionsDir = join(dir, 'sessions'), titlesDir = join(dir, 'titles');
mkdirSync(sessionsDir); mkdirSync(titlesDir);
const sddState = join(dir, 'state.json');
const stateText = JSON.stringify({ coordinator: { session_id: '11111111-1111-1111-1111-111111111111', name: 'conductor' }, tickets: {} });
writeFileSync(sddState, stateText);
writeFileSync(join(sessionsDir, '7.json'), JSON.stringify({ pid: 7, sessionId: '11111111-1111-1111-1111-111111111111', name: 'conductor' }));
writeFileSync(join(titlesDir, '11111111-1111-1111-1111-111111111111'), 'Coordinator of the batch');

let server, base;
const opts = { scanRoots: [], sddState, sessionsDir, titlesDir, isAlive: (pid) => pid === 7,
  mods: [], routines: { desktop: [], launchd: [] } };

before(async () => {
  server = createPanelServer(opts);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  server = createPanelServer({ ...opts, port });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + port;
});
after(() => new Promise((r) => server.close(r)));

test('GET /api/agentmap returns nodes, edges and the legend', async () => {
  const r = await fetch(base + '/api/agentmap');
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok(Array.isArray(d.nodes) && Array.isArray(d.edges));
  assert.ok(d.edgeTypes.open && d.edgeTypes.delegate && d.edgeTypes.state);
  assert.ok(d.nodeTypes.command);
  assert.equal(d.live, undefined, 'no live data unless asked');
  assert.ok(d.nodes.some((n) => n.id === 'role:coordinator'), 'roles come from the configured state.json');
});

test('?live=1 adds the running chats with their titles', async () => {
  const d = await (await fetch(base + '/api/agentmap?live=1')).json();
  assert.equal(d.live.stateFound, true);
  assert.equal(d.live.running, 1);
  const role = d.nodes.find((n) => n.id === 'role:coordinator');
  assert.equal(role.live, true);
  assert.equal(role.session.title, 'Coordinator of the batch');
});

test('the map never writes the state it reads', async () => {
  await fetch(base + '/api/agentmap?live=1');
  assert.equal(readFileSync(sddState, 'utf8'), stateText);
});

test('the map refuses another origin like every other route', async () => {
  const r = await fetch(base + '/api/agentmap', { headers: { origin: 'http://evil.example.com' } });
  assert.equal(r.status, 403);
});
