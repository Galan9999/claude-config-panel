import { createServer } from 'node:http';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { existsSync as fileExists } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BACKUPS, tilde } from './paths.mjs';
import { read } from './fsutil.mjs';
import { KIND_INFO } from './labels.mjs';
import { discover } from './discover.mjs';
import { fileHistory, repoIndex, buildPeople, mergeIdentities, clearIndexCache } from './history.mjs';
import { groupFlows, parseTools, findCommandRefs, findConfigPaths, brokenRefs, isFolderDoc } from './flows.mjs';
import { loadFindings, findingsMentioning } from './findings.mjs';

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

/** Backs the file up before overwriting. Returns the backup's path. */
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
 * Does this request come from the panel's own page?
 *
 * The panel listens on 127.0.0.1, but that does NOT protect it from the browser:
 * any open website can POST to it. With `content-type: text/plain` that would be
 * a simple request, no preflight, and the browser would let it through even
 * though it cannot read the response — the write would already have happened.
 * And id 0 is ~/.claude/settings.json, where a hook runs by itself in the next
 * session.
 *
 * Three checks close it:
 *  - `Host` must be ours, which also stops DNS rebinding on GETs;
 *  - `Origin`, when present, must be ours;
 *  - the body must declare `application/json`, which forces a preflight that the
 *    browser blocks since we return no CORS headers.
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
  // The piece list is also the write allowlist: saving is only possible to
  // files the scan found.
  let state = discover(options);

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (!sameOrigin(req, port)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Request rejected: it did not come from the panel.');
    }

    if (req.method === 'GET' && url.pathname === '/api/items') {
      state = discover(options);
      // Mark in the listing which pieces have findings: otherwise you have to
      // open them one by one to find out.
      const porRepo = new Map();
      for (const it of state.items) {
        if (!it.repo || !it.relPath) continue;
        if (!porRepo.has(it.repo)) porRepo.set(it.repo, loadFindings(it.repo).doc);
        const doc = porRepo.get(it.repo);
        if (!doc) continue;
        const mine = doc.findings.filter((f) => f.path === it.relPath);
        // A finding about a hook declared inside settings.json talks about a
        // script living in another file. If it names it, it concerns it too.
        const mentions = findingsMentioning(doc.findings, it.relPath);
        if (mine.length) {
          it.findings = mine.length;
          it.worst = ['high', 'medium', 'low'].find((s) => mine.some((f) => f.severity === s));
        }
        if (mentions.length) it.mentionedIn = mentions.length;
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
        // Each finding is linked to the piece it concerns, when we can find it.
        const findings = (doc ? doc.findings : []).map((f) => {
          const piece = state.items.find((i) => i.repo === repo && i.relPath === f.path);
          return { ...f, itemId: piece ? piece.id : null, pieceName: piece ? piece.name : null };
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
      const agents = state.items.filter((i) => i.kind === 'agent');

      const flows = groupFlows(commands).map((f) => ({
        folder: f.folder,
        scope: f.scope,
        docs: f.docs.map((d) => ({ id: d.id, name: d.name, path: d.displayPath })),
        phases: f.phases.map(({ order, slug, item }) => {
          const text = read(item.path);
          const t = parseTools(item.meta && item.meta['allowed-tools']);
          return {
            order, slug, id: item.id, name: item.name,
            title: (item.meta && item.meta.description) || item.description || '',
            model: (item.meta && item.meta.model) || null,
            hint: (item.meta && item.meta['argument-hint']) || null,
            ...t,
            // Which of the repo's agents this phase mentions by name.
            invokes: agents.filter((a) => a.repo === item.repo && text.includes(a.name))
              .map((a) => ({ id: a.id, name: a.name })),
          };
        }),
      }));

      // Drift: what the docs or the phases quote that no longer exists.
      const drift = [];
      for (const it of state.items) {
        if (it.format !== 'md' || !it.repo) continue;
        const text = read(it.path);
        for (const ref of brokenRefs(findCommandRefs(text), known)) {
          drift.push({ type: 'missing-command', id: it.id, where: it.displayPath, what: '/' + ref });
        }
        for (const p of findConfigPaths(text)) {
          if (!fileExists(join(it.repo, p))) {
            drift.push({ type: 'missing-path', id: it.id, where: it.displayPath, what: p });
          }
        }
      }
      return send(res, 200, { flows, drift });
    }

    if (req.method === 'GET' && url.pathname === '/api/people') {
      clearIndexCache();
      // One repo at a time: a monorepo's history is large, and mixing repos in
      // the same profile says nothing useful.
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
        pieces: items.length,
        // Pieces outside git have no authorship: say so, do not apportion it.
        noHistory: state.items.filter((i) => !i.repo || !i.relPath).length,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/item') {
      const it = state.items[Number(url.searchParams.get('id'))];
      if (!it) return send(res, 404, { error: 'not found' });
      // History costs one git log per file: only when a piece is opened.
      // The auditor's review is shown beside the piece, without changing it.
      const { doc } = it.repo ? loadFindings(it.repo) : { doc: null };
      const all = doc ? doc.findings : [];
      const findings = all.filter((f) => f.path === it.relPath);
      const mentions = findingsMentioning(all, it.relPath);
      return send(res, 200, { ...it, content: read(it.path),
        git: fileHistory(it.repo, it.relPath), findings, mentions });
    }

    if (req.method === 'POST' && url.pathname === '/api/item') {
      // Requiring it forces a preflight on any cross-origin request.
      if (!/^application\/json\b/.test(req.headers['content-type'] || '')) {
        return send(res, 415, { error: 'se requiere content-type: application/json' });
      }
      let payload;
      try { payload = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'invalid request' }); }
      const it = state.items[Number(payload.id)];
      if (!it || !it.editable) return send(res, 403, { error: 'cannot write here' });
      if (it.format === 'json') {
        try { JSON.parse(payload.content); }
        catch (e) { return send(res, 400, { error: 'invalid JSON: ' + e.message }); }
      }
      try {
        const copy = backup(it.path);
        writeFileSync(it.path, payload.content, 'utf8');
        return send(res, 200, { ok: true, backup: tilde(copy) });
      } catch (e) { return send(res, 500, { error: String(e.message) }); }
    }

    // Static files from ui/. No subfolders and no ../, so no path traversal.
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const ext = extname(name);
    const file = join(UI_DIR, name);
    if (req.method === 'GET' && TYPES[ext] && !name.includes('/') && existsSync(file)) {
      res.writeHead(200, { 'content-type': TYPES[ext] + '; charset=utf-8' });
      return res.end(readFileSync(file));
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found')
  });
}
