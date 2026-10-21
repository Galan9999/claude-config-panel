import { createServer } from 'node:http';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKUPS, tilde } from './paths.mjs';
import { read } from './fsutil.mjs';
import { KIND_INFO } from './labels.mjs';
import { discover } from './discover.mjs';

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

/** Guarda una copia previa antes de sobrescribir. Devuelve la ruta de la copia. */
export function backup(path) {
  mkdirSync(BACKUPS, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const flat = tilde(path).replace(/[/\\~]/g, '_').replace(/^_+/, '');
  const dest = join(BACKUPS, flat + '.' + ts + '.bak');
  copyFileSync(path, dest);
  return dest;
}

const send = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

function readBody(req) {
  return new Promise((ok, no) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 4e6) no(new Error('cuerpo demasiado grande')); });
    req.on('end', () => ok(d));
    req.on('error', no);
  });
}

/**
 * ¿Viene la petición de la propia página del panel?
 *
 * El panel escucha en 127.0.0.1, pero eso NO lo protege del navegador: cualquier
 * web abierta puede hacerle un POST. Con `content-type: text/plain` sería una
 * "simple request", sin preflight, y el navegador la dejaría salir aunque no
 * pueda leer la respuesta — la escritura ya habría ocurrido. Y el id 0 es
 * ~/.claude/settings.json, donde un hook se ejecuta solo en la siguiente sesión.
 *
 * Tres comprobaciones lo cierran:
 *  - `Host` debe ser el nuestro, lo que además frena el DNS rebinding en los GET;
 *  - `Origin`, cuando viene, debe ser el nuestro;
 *  - el cuerpo debe declararse `application/json`, que obliga a preflight y, como
 *    no devolvemos cabeceras CORS, el navegador lo bloquea.
 */
function sameOrigin(req, port) {
  const allowed = ['127.0.0.1:' + port, 'localhost:' + port, '[::1]:' + port];
  if (!allowed.includes(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin && !allowed.some((a) => origin === 'http://' + a)) return false;
  return true;
}

export function createPanelServer(options = {}) {
  const port = options.port ?? 7337;
  // La lista de piezas es también la lista blanca de escritura: sólo se puede
  // guardar en ficheros que el escaneo haya encontrado.
  let state = discover(options);

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (!sameOrigin(req, port)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Petición rechazada: no viene del panel.');
    }

    if (req.method === 'GET' && url.pathname === '/api/items') {
      state = discover(options);
      const counts = Object.fromEntries(
        Object.keys(KIND_INFO).map((k) => [k, state.items.filter((i) => i.kind === k).length]));
      return send(res, 200, {
        kinds: KIND_INFO, counts, items: state.items, skipped: state.skipped,
        scopes: [...new Set(state.items.map((i) => i.scope))],
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/item') {
      const it = state.items[Number(url.searchParams.get('id'))];
      if (!it) return send(res, 404, { error: 'no encontrado' });
      return send(res, 200, { ...it, content: read(it.path) });
    }

    if (req.method === 'POST' && url.pathname === '/api/item') {
      // Exigirlo obliga a preflight en cualquier petición de otro origen.
      if (!/^application\/json\b/.test(req.headers['content-type'] || '')) {
        return send(res, 415, { error: 'se requiere content-type: application/json' });
      }
      let payload;
      try { payload = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'petición inválida' }); }
      const it = state.items[Number(payload.id)];
      if (!it || !it.editable) return send(res, 403, { error: 'no se puede escribir aquí' });
      if (it.format === 'json') {
        try { JSON.parse(payload.content); }
        catch (e) { return send(res, 400, { error: 'JSON inválido: ' + e.message }); }
      }
      try {
        const copy = backup(it.path);
        writeFileSync(it.path, payload.content, 'utf8');
        return send(res, 200, { ok: true, backup: tilde(copy) });
      } catch (e) { return send(res, 500, { error: String(e.message) }); }
    }

    // Estáticos de ui/. Sin subcarpetas y sin ../, así no hay travesía de rutas.
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const ext = extname(name);
    const file = join(UI_DIR, name);
    if (req.method === 'GET' && TYPES[ext] && !name.includes('/') && existsSync(file)) {
      res.writeHead(200, { 'content-type': TYPES[ext] + '; charset=utf-8' });
      return res.end(readFileSync(file));
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  });
}
