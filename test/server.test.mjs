// Tests for the HTTP contract. These are regressions for a real vulnerability:
// the panel listens on 127.0.0.1, but that does not protect it from an open
// website, which can POST to it without a preflight and write files.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createPanelServer } from '../src/server.mjs';

let server, port, base;

before(async () => {
  server = createPanelServer({ scanRoots: [], withWorktrees: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  base = 'http://127.0.0.1:' + port;
  // createPanelServer validates against options.port, so the test server is
  // rebuilt once we know the effective port.
  await new Promise((r) => server.close(r));
  server = createPanelServer({ scanRoots: [], withWorktrees: false, port });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
});

after(() => new Promise((r) => server.close(r)));

// fetch() will not set the Host header: it is a forbidden name. To test DNS
// rebinding we have to drop down to node:http.
const raw = (path, headers = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('error', reject);
  req.end();
});

const permPost = (body, headers = {}) => fetch(base + '/api/permissions', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('the permissions inventory lists settings files with their three lists', async () => {
  const r = await fetch(base + '/api/permissions');
  assert.equal(r.status, 200);
  const { files } = await r.json();
  assert.ok(Array.isArray(files));
  for (const f of files) for (const k of ['allow', 'ask', 'deny']) assert.ok(Array.isArray(f[k]));
});

test('a permission edit needs application/json', async () => {
  const r = await fetch(base + '/api/permissions', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(r.status, 415);
});

test('a permission edit to a file the scan did not find is refused', async () => {
  assert.equal((await permPost({ id: '99999', op: 'add', list: 'allow', rule: 'Bash(ls)' })).status, 403);
});

test('a permission edit from another origin is refused', async () => {
  assert.equal((await permPost({ id: '0', op: 'mode', value: 'plan' }, { origin: 'http://evil.example.com' })).status, 403);
});

test('an invalid edit is refused before anything is written', async () => {
  const { files } = await (await fetch(base + '/api/permissions')).json();
  const f = files.find((x) => !x.error);
  if (!f) return;
  const r = await permPost({ id: f.id, op: 'explode', list: 'allow', rule: 'Bash(ls)' });
  assert.equal(r.status, 422);
  assert.match((await r.json()).error, /unknown operation/);
});

const post = (headers, body) => fetch(base + '/api/item', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body ?? { id: '0', content: 'x' }),
});

test('the page is served', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
});

test('the inventory responds', async () => {
  const r = await fetch(base + '/api/items');
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok(Array.isArray(d.items));
});

test('rejects a foreign Host: closes DNS rebinding', async () => {
  const r = await raw('/api/items', { host: 'evil.example.com' });
  assert.equal(r.status, 403);
  assert.match(r.body, /did not come from the panel/);
});

test('accepts its own Host', async () => {
  assert.equal((await raw('/api/items', { host: '127.0.0.1:' + port })).status, 200);
  assert.equal((await raw('/api/items', { host: 'localhost:' + port })).status, 200);
});

test('rejects a POST carrying an Origin from another site', async () => {
  const r = await post({ origin: 'https://evil.example.com' });
  assert.equal(r.status, 403);
});

test('rejects a POST without a JSON content-type: this is what skipped the preflight', async () => {
  const r = await fetch(base + '/api/item', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ id: '0', content: 'hook malicioso' }),
  });
  assert.equal(r.status, 415);
});

test('accepts the Origin of the panel itself', async () => {
  // It reaches the write check, which is what we want: the rejection is no
  // longer about where it came from but about that piece not existing.
  const r = await post({ origin: base }, { id: '99999', content: 'x' });
  assert.match((await r.json()).error, /cannot write here/);
});

test('does not write to a piece that does not exist', async () => {
  const r = await post({}, { id: '99999', content: 'x' });
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /cannot write here/);
});

test('does not serve files outside ui/', async () => {
  for (const p of ['/../package.json', '/..%2Fpackage.json', '/src/server.mjs']) {
    assert.equal((await fetch(base + p)).status, 404, p + ' should give 404');
  }
});

/* ----- the audit store over HTTP ----- */

test('lists the scopes it can audit, with no report of their own', async () => {
  const r = await fetch(base + '/api/audits');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.audited) && Array.isArray(j.orphans));
});

test('refuses a report that does not match the schema instead of storing it', async () => {
  const r = await fetch(base + '/api/audits', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1, summary: '' }),
  });
  assert.equal(r.status, 422);
  const j = await r.json();
  assert.ok(j.errors.length);
});

test('a report POST without a JSON content-type is rejected like any other write', async () => {
  const r = await fetch(base + '/api/audits', {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}',
  });
  assert.equal(r.status, 415);
});

test('asking for a run that does not exist says so rather than 500ing', async () => {
  const r = await fetch(base + '/api/audits?slug=nope&run=nope.json');
  assert.equal(r.status, 422);
  const j = await r.json();
  assert.equal(j.doc, null);
});
