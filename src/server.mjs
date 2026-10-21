import { createServer } from 'node:http';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { existsSync as hayFichero } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BACKUPS, tilde } from './paths.mjs';
import { read } from './fsutil.mjs';
import { KIND_INFO } from './labels.mjs';
import { discover } from './discover.mjs';
import { fileHistory, repoIndex, buildPeople, mergeIdentities, clearIndexCache } from './history.mjs';
import { groupFlows, parseTools, findCommandRefs, findConfigPaths, brokenRefs, isFolderDoc } from './flows.mjs';
import { loadFindings, hallazgosQueCitan } from './findings.mjs';

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
      // Marcar en el listado qué piezas tienen hallazgos: si no, hay que abrirlas
      // una a una para enterarse.
      const porRepo = new Map();
      for (const it of state.items) {
        if (!it.repo || !it.relPath) continue;
        if (!porRepo.has(it.repo)) porRepo.set(it.repo, loadFindings(it.repo).doc);
        const doc = porRepo.get(it.repo);
        if (!doc) continue;
        const propios = doc.findings.filter((f) => f.path === it.relPath);
        // Un hallazgo sobre un hook definido dentro de settings.json habla de un
        // script que vive en otro fichero. Si lo nombra, también le toca.
        const mencionan = hallazgosQueCitan(doc.findings, it.relPath);
        if (propios.length) {
          it.hallazgos = propios.length;
          it.peor = ['alta', 'media', 'baja'].find((s) => propios.some((f) => f.severity === s));
        }
        if (mencionan.length) it.mencionado = mencionan.length;
      }
      const counts = Object.fromEntries(
        Object.keys(KIND_INFO).map((k) => [k, state.items.filter((i) => i.kind === k).length]));
      return send(res, 200, {
        kinds: KIND_INFO, counts, items: state.items, skipped: state.skipped,
        scopes: [...new Set(state.items.map((i) => i.scope))],
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/findings') {
      const repos = [...new Set(state.items.filter((i) => i.repo).map((i) => i.repo))];
      const informes = [];
      for (const repo of repos) {
        const { doc, errors, path } = loadFindings(repo);
        if (!doc && !errors.length) continue;
        // Cada hallazgo se enlaza con la pieza que lo origina, si la encontramos.
        const findings = (doc ? doc.findings : []).map((f) => {
          const pieza = state.items.find((i) => i.repo === repo && i.relPath === f.path);
          return { ...f, itemId: pieza ? pieza.id : null, piezaNombre: pieza ? pieza.name : null };
        });
        informes.push({ repo, repoLabel: tilde(repo), path: tilde(path),
          generatedAt: doc && doc.generatedAt, tool: doc && doc.tool,
          summary: doc && doc.summary, notChecked: (doc && doc.notChecked) || [],
          findings, errors });
      }
      return send(res, 200, { informes });
    }

    if (req.method === 'GET' && url.pathname === '/api/flows') {
      const commands = state.items.filter((i) => i.kind === 'command');
      const known = new Set(commands.map((i) => i.name));
      const agentes = state.items.filter((i) => i.kind === 'agent');

      const flows = groupFlows(commands).map((f) => ({
        folder: f.folder,
        scope: f.scope,
        docs: f.docs.map((d) => ({ id: d.id, name: d.name, path: d.displayPath })),
        phases: f.phases.map(({ order, slug, item }) => {
          const texto = read(item.path);
          const t = parseTools(item.meta && item.meta['allowed-tools']);
          return {
            order, slug, id: item.id, name: item.name,
            title: (item.meta && item.meta.description) || item.description || '',
            model: (item.meta && item.meta.model) || null,
            hint: (item.meta && item.meta['argument-hint']) || null,
            ...t,
            // Qué agentes del repo menciona esta fase por su nombre.
            invoca: agentes.filter((a) => a.repo === item.repo && texto.includes(a.name))
              .map((a) => ({ id: a.id, name: a.name })),
          };
        }),
      }));

      // Desvíos: lo que la documentación o las fases citan y ya no existe.
      const desvios = [];
      for (const it of state.items) {
        if (it.format !== 'md' || !it.repo) continue;
        const texto = read(it.path);
        for (const ref of brokenRefs(findCommandRefs(texto), known)) {
          desvios.push({ tipo: 'comando-inexistente', id: it.id, donde: it.displayPath, que: '/' + ref });
        }
        for (const ruta of findConfigPaths(texto)) {
          if (!hayFichero(join(it.repo, ruta))) {
            desvios.push({ tipo: 'ruta-inexistente', id: it.id, donde: it.displayPath, que: ruta });
          }
        }
      }
      return send(res, 200, { flows, desvios });
    }

    if (req.method === 'GET' && url.pathname === '/api/people') {
      clearIndexCache();
      // Un repo cada vez: el historial de un monorepo es grande y mezclar repos
      // en el mismo perfil no dice nada útil.
      const repos = [...new Set(state.items.filter((i) => i.repo).map((i) => i.repo))]
        .map((repo) => ({ repo, label: tilde(repo), items: state.items.filter((i) => i.repo === repo).length }))
        .sort((a, b) => b.items - a.items);
      const chosen = url.searchParams.get('repo') || (repos[0] && repos[0].repo);
      const items = state.items.filter((i) => i.repo === chosen && i.relPath);
      const paths = [...new Set(items.map((i) => i.relPath))];
      const index = paths.length ? repoIndex(chosen, paths) : new Map();
      return send(res, 200, {
        repos, repo: chosen, repoLabel: chosen ? tilde(chosen) : null,
        people: mergeIdentities(buildPeople(items, () => index)),
        piezas: items.length,
        // Las piezas fuera de git no tienen autoría: se dice, no se reparte.
        sinHistorial: state.items.filter((i) => !i.repo || !i.relPath).length,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/item') {
      const it = state.items[Number(url.searchParams.get('id'))];
      if (!it) return send(res, 404, { error: 'no encontrado' });
      // El historial cuesta un git log por fichero: sólo al abrir la pieza.
      // La revisión del auditor se enseña al lado de la pieza, sin modificarla.
      const { doc } = it.repo ? loadFindings(it.repo) : { doc: null };
      const todos = doc ? doc.findings : [];
      const hallazgos = todos.filter((f) => f.path === it.relPath);
      const mencionan = hallazgosQueCitan(todos, it.relPath);
      return send(res, 200, { ...it, content: read(it.path),
        git: fileHistory(it.repo, it.relPath), hallazgos, mencionan });
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
