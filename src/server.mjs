import { createServer } from 'node:http';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { existsSync as fileExists } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BACKUPS, HOME, tilde } from './paths.mjs';
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { read } from './fsutil.mjs';
import { KIND_INFO } from './labels.mjs';
import { discover } from './discover.mjs';
import { discoverMods } from './mods.mjs';
import { fileHistory, repoIndex, buildPeople, mergeIdentities, clearIndexCache } from './history.mjs';
import { groupFlows, parseTools, findCommandRefs, findConfigPaths, brokenRefs, isFolderDoc } from './flows.mjs';
import { findingsMentioning } from './findings.mjs';
import { currentFor, runsFor, readRun, saveRun, deleteRun, listSlugs } from './audits.mjs';
import { discoverEvals, coverage, benchForItem, estimateCost, caseDetail } from './evals.mjs';
import { scanUsage, usageForItems, benchCandidates } from './usage.mjs';
import { applyPermissionOp, permissionSummary } from './permedit.mjs';
import { readTools, mcpServers, connectorsInRules } from './tools.mjs';
import { buildAgentMap, readLive, overlayLive, sddStatePath, EDGE_TYPES, NODE_TYPES } from './agentmap.mjs';
import { readRoutines } from './routines.mjs';

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
  // The settings files the scan found: the only ones the permission editor writes.
  const settingsFiles = () => state.items.filter((i) => i.kind === 'config' && i.format === 'json' && i.editable);
  const permissionEntry = (it) => {
    let obj = null, error = null;
    try { obj = JSON.parse(read(it.path) || '{}'); } catch (e) { error = e.message; }
    return { id: it.id, scope: it.scope, name: it.name, title: it.title, path: tilde(it.path),
      isGlobal: it.scope === 'Global', error, ...(obj ? permissionSummary(obj) : { defaultMode: 'default', allow: [], ask: [], deny: [] }) };
  };

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
        if (!porRepo.has(it.repo)) porRepo.set(it.repo, currentFor(it.repo).doc);
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

    // Read-only: the panel lists mods, it never edits them.
    if (req.method === 'GET' && url.pathname === '/api/mods') {
      return send(res, 200, { mods: await discoverMods() });
    }

    if (req.method === 'GET' && url.pathname === '/api/findings') {
      const repos = [...new Set(state.items.filter((i) => i.repo).map((i) => i.repo))];
      const informes = [];
      for (const repo of repos) {
        const { doc, errors, path, source, slug } = currentFor(repo);
        if (!doc && !errors.length) continue;
        // Each finding is linked to the piece it concerns, when we can find it.
        const findings = (doc ? doc.findings : []).map((f) => {
          const piece = state.items.find((i) => i.repo === repo && i.relPath === f.path);
          return { ...f, itemId: piece ? piece.id : null, pieceName: piece ? piece.name : null };
        });
        informes.push({ repo, repoLabel: tilde(repo), path, source, slug,
          generatedAt: doc && doc.generatedAt, tool: doc && doc.tool,
          summary: doc && doc.summary, notChecked: (doc && doc.notChecked) || [],
          findings, errors });
      }
      return send(res, 200, { informes });
    }

    // The auditor's own tab: every stored run, by repo, newest first. Audits
    // live in ~/.claude/audits so a report never lands inside the
    // configuration it is reporting on.
    if (req.method === 'GET' && url.pathname === '/api/audits') {
      const slug = url.searchParams.get('slug'), run = url.searchParams.get('run');
      if (slug && run) {
        const { doc, errors, path } = readRun(slug, run);
        return send(res, doc ? 200 : 422, { doc, errors, path: tilde(path), slug, run });
      }
      // Keyed by the folder that owns the `.claude`, not by the git root: in a
      // monorepo, apps/web has its own configuration and deserves its own
      // audit, and it would otherwise disappear behind the repo it sits in.
      const scopes = [...new Set(state.items.filter((i) => i.project).map((i) => i.project))].sort();
      const seen = new Set();
      const audited = scopes.map((repo) => {
        const cur = currentFor(repo);
        seen.add(cur.slug);
        return { repo, repoLabel: tilde(repo), slug: cur.slug, source: cur.source,
          path: cur.path, errors: cur.errors, runs: cur.runs,
          generatedAt: cur.doc && cur.doc.generatedAt,
          summary: cur.doc && cur.doc.summary,
          findings: cur.doc ? cur.doc.findings.length : 0,
          questions: cur.doc && Array.isArray(cur.doc.questions) ? cur.doc.questions.length : 0,
          notChecked: cur.doc ? cur.doc.notChecked.length : 0,
          worst: cur.doc ? ['high', 'medium', 'low'].find(
            (sev) => cur.doc.findings.some((f) => f.severity === sev)) || null : null };
      });
      // A repo that was audited and then moved or deleted still has a history,
      // and losing sight of it would be the panel hiding its own data.
      const orphans = [];
      for (const s of listSlugs()) {
        if (seen.has(s)) continue;
        const runs = runsFor(s);
        if (runs.length) orphans.push({ slug: s, runs, orphan: true });
      }
      return send(res, 200, { audited, orphans });
    }

    if (req.method === 'POST' && url.pathname === '/api/audits') {
      if (!/^application\/json\b/.test(req.headers['content-type'] || '')) {
        return send(res, 415, { error: 'se requiere content-type: application/json' });
      }
      let payload;
      try { payload = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'invalid request' }); }
      if (payload && payload.delete) {
        const gone = deleteRun(payload.slug, payload.run);
        return send(res, gone ? 200 : 404, gone ? { deleted: true } : { error: 'no such run' });
      }
      const saved = saveRun(payload);
      return send(res, saved.ok ? 200 : 422,
        saved.ok ? { slug: saved.slug, path: tilde(saved.path) } : { error: 'invalid report', errors: saved.errors });
    }

    // Evals: the only measurement that says whether a skill changes anything.
    // The bench lives outside the audited repo (a `.claude` folder is not a
    // plugin), so it is discovered on its own and tied back by the symlink
    // each bench keeps to the real skill.
    // One case, in full: the prompt, the rubric and what each arm answered.
    // Loaded on demand — a score teaches nobody anything on its own, but the
    // whole case is far too much to ship with the listing.
    if (req.method === 'GET' && url.pathname === '/api/evals/case') {
      const bench = url.searchParams.get('bench'), name = url.searchParams.get('case');
      const { benches } = discoverEvals(options);
      const b = benches.find((x) => x.name === bench);
      if (!b) return send(res, 404, { error: 'no such bench' });
      const detail = caseDetail(b.path, name || '');
      return send(res, detail ? 200 : 404, detail || { error: 'no such case' });
    }

    if (req.method === 'GET' && url.pathname === '/api/evals') {
      const { benches } = discoverEvals(options);
      const runsWanted = Number(url.searchParams.get('runs')) || 3;
      const shaped = benches.map((b) => ({
        name: b.name, version: b.version, displayPath: b.displayPath, bank: b.bank,
        cases: b.cases, casesWithoutGrader: b.casesWithoutGrader,
        skills: b.skills.map((s) => ({ name: s.name, linked: s.linked, dangling: s.dangling,
          target: s.target ? tilde(s.target) : null })),
        agents: b.agents.map((a) => ({ name: a.name, file: a.file, linked: a.linked,
          dangling: a.dangling })),
        latest: b.latest ? { name: b.latest.name, ...b.latest.result } : null,
        history: b.runs.filter((r) => r.result).map((r) => ({ name: r.name,
          startedAt: r.result.startedAt, overallScore: r.result.overallScore,
          meanDelta: r.result.meanDelta, costUsd: r.result.costUsd,
          judgeModel: r.result.judgeModel, ablation: r.result.ablation,
          durationSeconds: r.result.durationSeconds })),
        estimate: b.estimate,
        estimateSerious: estimateCost(b, { runs: runsWanted }),
      }));
      const cov = coverage(state.items, benches);
      // Usage is the half of the picture that fills in by itself; the tab is
      // where the two meet, because usage is what says which skill is worth
      // paying to measure next.
      const usage = scanUsage();
      const { rows, silent, manual } = usageForItems(state.items, usage);
      return send(res, 200, { benches: shaped, ...cov,
        usage: { rows, silentCount: silent.length, manualCount: manual,
          sessions: usage.files, distinct: usage.skills.length,
          candidates: benchCandidates(rows, cov.covered.map((c) => c.name)) } });
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

    // What Claude can reach for, and what your settings say about each built-in tool.
    if (req.method === 'GET' && url.pathname === '/api/tools') {
      const files = settingsFiles().map((it) => ({ ...permissionEntry(it), fullPath: it.path,
        label: (it.scope === 'Global' ? 'Global' : it.scope) + ' · ' + it.name }));
      const projects = [...new Set(state.items.filter((i) => i.project).map((i) => i.project))];
      return send(res, 200, readTools({ settingsFiles: files, projects, mods: await discoverMods() }));
    }

    // Everything on a schedule, and how it is launched. Read-only.
    if (req.method === 'GET' && url.pathname === '/api/routines') {
      return send(res, 200, readRoutines());
    }

    // The agent map: who opens, invokes, delegates to, hooks, schedules or
    // calls whom. Rebuilt from disk on every request; ?live=1 adds the chats
    // running now. Read-only.
    if (req.method === 'GET' && url.pathname === '/api/agentmap') {
      state = discover(options);
      const files = settingsFiles().map((it) => ({ ...permissionEntry(it), label: (it.scope === 'Global' ? 'Global' : it.scope) + ' · ' + it.name }));
      const projects = [...new Set(state.items.filter((i) => i.project).map((i) => i.project))];
      const statePath = sddStatePath(options.sddState, process.env, projects);
      let sddState = null;
      try { sddState = statePath ? JSON.parse(read(statePath) || 'null') : null; } catch { /* broken: no roles */ }
      const map = buildAgentMap({
        items: state.items,
        mods: options.mods || await discoverMods(),
        routines: options.routines || readRoutines(),
        mcp: mcpServers({ projects }),
        connectors: connectorsInRules(files),
        sddState,
      });
      if (url.searchParams.get('live') === '1') {
        overlayLive(map, readLive({ statePath, sessionsDir: options.sessionsDir, titlesDir: options.titlesDir, isAlive: options.isAlive }));
      }
      return send(res, 200, { ...map, edgeTypes: EDGE_TYPES, nodeTypes: NODE_TYPES });
    }

    // Where the configuration is read from. GET says which folders are scanned
    // and what each project found holds; POST changes them for this run. Only
    // what is read changes: nothing is written to disk.
    const sourcesPayload = () => {
      const all = discover({ ...options, exclude: [] });
      const left = new Set(options.exclude || []);
      const roots = (options.scanRoots || []).map(tilde);
      const piece = (i) => ({ kind: i.kind, name: i.name });
      return {
        home: '~', roots, depth: options.depth ?? 5,
        mode: roots.length === 1 && roots[0] === '~' ? 'everything' : 'chosen',
        global: { label: '~/.claude', files: all.items.filter((i) => i.scope === 'Global').map(piece) },
        projects: all.projects.map((p) => ({ path: p, label: tilde(p), included: !left.has(p),
          files: all.items.filter((i) => i.project === p).map(piece) })),
        skipped: all.skipped,
      };
    };
    if (req.method === 'GET' && url.pathname === '/api/sources') return send(res, 200, sourcesPayload());
    if (req.method === 'POST' && url.pathname === '/api/sources') {
      if (!/^application\/json\b/.test(req.headers['content-type'] || '')) {
        return send(res, 415, { error: 'se requiere content-type: application/json' });
      }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'invalid request' }); }
      if (!body || typeof body !== 'object') return send(res, 400, { error: 'invalid request' });
      if (body.roots !== undefined) {
        if (!Array.isArray(body.roots) || !body.roots.length || body.roots.length > 30) return send(res, 400, { error: 'roots: between 1 and 30 folders' });
        const roots = [];
        for (const r of body.roots) {
          const p = String(r || '').trim().replace(/^~(?=$|\/)/, HOME);
          let ok = false;
          try { ok = isAbsolute(p) && statSync(p).isDirectory(); } catch { /* missing */ }
          if (!ok) return send(res, 422, { error: 'not a folder: ' + r });
          roots.push(p);
        }
        options.scanRoots = [...new Set(roots)];
      }
      if (body.exclude !== undefined) {
        if (!Array.isArray(body.exclude) || body.exclude.length > 500) return send(res, 400, { error: 'exclude: a list of project paths' });
        options.exclude = body.exclude.map(String);
      }
      state = discover(options);
      return send(res, 200, sourcesPayload());
    }

    // Every permission rule of every settings file, read from disk now.
    if (req.method === 'GET' && url.pathname === '/api/permissions') {
      return send(res, 200, { files: settingsFiles().map(permissionEntry) });
    }

    // One edit to one settings file: re-read from disk, apply, back up, write.
    if (req.method === 'POST' && url.pathname === '/api/permissions') {
      if (!/^application\/json\b/.test(req.headers['content-type'] || '')) {
        return send(res, 415, { error: 'se requiere content-type: application/json' });
      }
      let payload;
      try { payload = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'invalid request' }); }
      const it = settingsFiles().find((x) => payload && x.id === String(payload.id));
      if (!it) return send(res, 403, { error: 'cannot write here' });
      let obj;
      try { obj = JSON.parse(read(it.path) || '{}'); } catch (e) { return send(res, 409, { error: 'the file is not valid JSON now: ' + e.message }); }
      const r = applyPermissionOp(obj, payload);
      if (r.error) return send(res, 422, { error: r.error, file: permissionEntry(it) });
      if (!r.changed) return send(res, 200, { ok: true, changed: false, file: permissionEntry(it) });
      try {
        const copy = backup(it.path);
        writeFileSync(it.path, JSON.stringify(r.obj, null, 2) + '\n', 'utf8');
        return send(res, 200, { ok: true, changed: true, backup: tilde(copy), file: permissionEntry(it) });
      } catch (e) { return send(res, 500, { error: String(e.message) }); }
    }

    if (req.method === 'GET' && url.pathname === '/api/item') {
      const it = state.items[Number(url.searchParams.get('id'))];
      if (!it) return send(res, 404, { error: 'not found' });
      // History costs one git log per file: only when a piece is opened.
      // The auditor's review is shown beside the piece, without changing it.
      const { doc } = it.repo ? currentFor(it.repo) : { doc: null };
      const all = doc ? doc.findings : [];
      const findings = all.filter((f) => f.path === it.relPath);
      const mentions = findingsMentioning(all, it.relPath);
      return send(res, 200, { ...it, content: read(it.path),
        git: fileHistory(it.repo, it.relPath), findings, mentions,
        bench: benchForItem(it, discoverEvals(options).benches),
        usage: it.kind === 'skill'
          ? usageForItems([it], scanUsage()).rows[0] : null });
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
