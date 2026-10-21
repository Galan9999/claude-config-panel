// Pruebas del contrato HTTP. Son de regresión de una vulnerabilidad real:
// el panel escucha en 127.0.0.1, pero eso no lo protege de una web abierta en
// el navegador, que puede hacerle un POST sin preflight y escribirle ficheros.
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
  // createPanelServer valida contra options.port, así que el servidor de pruebas
  // se crea de nuevo una vez conocemos el puerto efectivo.
  await new Promise((r) => server.close(r));
  server = createPanelServer({ scanRoots: [], withWorktrees: false, port });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
});

after(() => new Promise((r) => server.close(r)));

// fetch() no deja poner la cabecera Host: es un nombre prohibido. Para probar
// el DNS rebinding hay que bajar a node:http.
const raw = (path, headers = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('error', reject);
  req.end();
});

const post = (headers, body) => fetch(base + '/api/item', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body ?? { id: '0', content: 'x' }),
});

test('la página se sirve', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
});

test('el inventario responde', async () => {
  const r = await fetch(base + '/api/items');
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok(Array.isArray(d.items));
});

test('rechaza un Host ajeno: cierra el DNS rebinding', async () => {
  const r = await raw('/api/items', { host: 'evil.example.com' });
  assert.equal(r.status, 403);
  assert.match(r.body, /no viene del panel/);
});

test('acepta el Host propio', async () => {
  assert.equal((await raw('/api/items', { host: '127.0.0.1:' + port })).status, 200);
  assert.equal((await raw('/api/items', { host: 'localhost:' + port })).status, 200);
});

test('rechaza un POST con Origin de otra web', async () => {
  const r = await post({ origin: 'https://evil.example.com' });
  assert.equal(r.status, 403);
});

test('rechaza un POST sin content-type JSON: esto es lo que evitaba el preflight', async () => {
  const r = await fetch(base + '/api/item', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ id: '0', content: 'hook malicioso' }),
  });
  assert.equal(r.status, 415);
});

test('acepta el Origin del propio panel', async () => {
  // Llega al control de escritura, que es lo que queremos comprobar: el rechazo
  // ya no es por procedencia sino porque esa pieza no existe.
  const r = await post({ origin: base }, { id: '99999', content: 'x' });
  assert.match((await r.json()).error, /no se puede escribir/);
});

test('no escribe en una pieza que no existe', async () => {
  const r = await post({}, { id: '99999', content: 'x' });
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /no se puede escribir/);
});

test('no sirve ficheros fuera de ui/', async () => {
  for (const p of ['/../package.json', '/..%2Fpackage.json', '/src/server.mjs']) {
    assert.equal((await fetch(base + p)).status, 404, p + ' debería dar 404');
  }
});
