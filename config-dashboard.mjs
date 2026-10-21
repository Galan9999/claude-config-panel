#!/usr/bin/env node
// Panel de Claude — ver y entender toda la configuración de Claude Code:
// ajustes, skills, agentes, comandos, hooks y tareas programadas.
//
//   node config-dashboard.mjs [--port 7337] [--worktrees] [ruta/a/tus/repos ...]
//
// Sin argumentos busca proyectos con carpeta .claude/ en las carpetas habituales
// (~/code, ~/dev, ~/projects, ~/Desktop, ~/Documents...). Funciona en cualquier
// Mac o Linux con Node 18+; no necesita instalar nada.
// Sin dependencias. Escucha sólo en 127.0.0.1 y sólo puede escribir en los
// ficheros que descubre al arrancar. Cada guardado deja copia en
// ~/.claude/backups/config-dashboard/

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, basename, dirname, relative } from 'node:path';

const HOME = homedir();
const CLAUDE = join(HOME, '.claude');
const BACKUPS = join(CLAUDE, 'backups', 'config-dashboard');

const argv = process.argv.slice(2);
const pIdx = argv.indexOf('--port');
const PORT = pIdx !== -1 ? Number(argv[pIdx + 1]) : Number(process.env.PORT || 7337);
const extraRoots = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--port');
// Dónde buscar proyectos: argumentos > CLAUDE_CFG_ROOTS > carpetas habituales
// que existan en esta máquina. Así funciona en el ordenador de cualquiera.
const COMMON_ROOTS = ['Desktop/dades', 'code', 'dev', 'projects', 'proyectos',
  'src', 'repos', 'work', 'Desktop', 'Documents'];
function defaultRoots() {
  const found = COMMON_ROOTS.map((r) => join(HOME, r)).filter((p) => existsSync(p));
  return found.length ? found : [HOME];
}
const SCAN_ROOTS = extraRoots.length
  ? extraRoots
  : (process.env.CLAUDE_CFG_ROOTS ? process.env.CLAUDE_CFG_ROOTS.split(':') : defaultRoots());

const WITH_WORKTREES = argv.includes('--worktrees');
let SKIPPED = [];
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor', 'coverage', '.turbo', 'tmp']);

/* ---------- utilidades ---------- */

const tilde = (p) => p.replace(HOME, '~');

function ls(dir) { try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; } }
function read(p) { try { return readFileSync(p, 'utf8'); } catch { return ''; } }

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (mm) out[mm[1]] = mm[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

// Primeras líneas de comentario de un script = su descripción.
function scriptDoc(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const l of lines) {
    if (/^#!/.test(l)) continue;
    const m = /^\s*(?:#|\/\/)\s?(.*)$/.exec(l);
    if (m) { out.push(m[1]); continue; }
    if (!l.trim() && out.length === 0) continue;
    break;
  }
  return out.join(' ').trim();
}

const remoteCache = new Map();
function gitRemote(repo) {
  if (remoteCache.has(repo)) return remoteCache.get(repo);
  let web = null;
  try {
    const url = execFileSync('git', ['-C', repo, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const m = /github\.com[:/](.+?)(?:\.git)?$/.exec(url);
    if (m) web = 'https://github.com/' + m[1];
  } catch {}
  remoteCache.set(repo, web);
  return web;
}

function isRepo(dir) {
  try {
    const top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return top === dir ? dir : null;
  } catch { return null; }
}

/* ---------- nombres y explicaciones en castellano ---------- */

function describeConfig(file, isGlobal) {
  if (file === 'CLAUDE.md') return isGlobal
    ? ['Instrucciones permanentes (global)', 'Reglas que Claude lee en todas tus sesiones, estés en el proyecto que estés. Es tu manual de estilo con él.']
    : ['Instrucciones del proyecto', 'Reglas que Claude lee sólo al trabajar en este proyecto: convenciones, comandos, cosas que no debe tocar.'];
  if (file === 'settings.json') return isGlobal
    ? ['Configuración global', 'La base para todos los proyectos: permisos, hooks, apariencia. Lo que pongas en un proyecto manda sobre esto.']
    : ['Configuración del proyecto', 'Se versiona en git, así que la comparte todo el equipo. Lo que vale para cualquiera que trabaje aquí.'];
  if (file === 'settings.local.json') return isGlobal
    ? ['Configuración global privada', 'Como la global, pero sólo tuya. Útil para permisos que no quieres dejar fijos.']
    : ['Configuración local del proyecto', 'Sólo tuya: está en .gitignore y no la ve el equipo. Aquí van tus preferencias personales en este repo.'];
  return [file, ''];
}

const KIND_INFO = {
  config:  { label: 'Configuración', one: 'ajuste',  icon: '⚙',  blurb: 'Permisos, hooks y preferencias. La global vale para todo; cada proyecto afina encima.' },
  skill:   { label: 'Skills',        one: 'skill',   icon: '◆',  blurb: 'Instrucciones que Claude carga sólo cuando hacen falta. Su descripción es lo que decide si se activa o no.' },
  agent:   { label: 'Agentes',       one: 'agente',  icon: '◇',  blurb: 'Subagentes con su propio contexto y sus propias herramientas, para delegar trabajo acotado.' },
  command: { label: 'Comandos',      one: 'comando', icon: '/',  blurb: 'Los que invocas tú escribiendo barra. Hacen siempre lo mismo, sin depender de que Claude decida.' },
  hook:    { label: 'Hooks y scripts', one: 'script', icon: '⚡', blurb: 'Lo que se ejecuta solo, sin pedirte permiso, cuando ocurre un evento. La pieza que más conviene revisar.' },
  task:    { label: 'Tareas programadas', one: 'tarea', icon: '◷', blurb: 'Se lanzan por calendario, sin que tú estés delante.' },
};

/* ---------- descubrimiento ---------- */

let ITEMS = [];
const push = (it) => { ITEMS.push(it); return it; };

function mdFolder(dir, kind, scope, repo, editable = true) {
  for (const e of ls(dir)) {
    let path = null, name = e.name;
    if (e.isDirectory()) {
      for (const cand of ['SKILL.md', 'AGENT.md', 'index.md', e.name + '.md']) {
        if (existsSync(join(dir, e.name, cand))) { path = join(dir, e.name, cand); break; }
      }
      if (!path) {
        // comandos agrupados en subcarpeta: lp/foo.md -> lp:foo
        for (const sub of ls(join(dir, e.name))) {
          if (sub.isFile() && sub.name.endsWith('.md')) {
            const p = join(dir, e.name, sub.name);
            const fm = frontmatter(read(p));
            push({ kind, scope, repo, editable, path: p,
                   name: e.name + ':' + sub.name.replace(/\.md$/, ''),
                   title: fm.name || sub.name.replace(/\.md$/, ''),
                   description: fm.description || '', meta: fm });
          }
        }
        continue;
      }
    } else if (e.isFile() && e.name.endsWith('.md')) {
      path = join(dir, e.name);
      name = e.name.replace(/\.md$/, '');
    } else continue;

    const fm = frontmatter(read(path));
    push({ kind, scope, repo, editable, path, name,
           title: fm.name || name, description: fm.description || '', meta: fm });
  }
}

function scanClaudeDir(base, scope, repo, isGlobal) {
  const cdir = isGlobal ? base : join(base, '.claude');
  if (!existsSync(cdir)) return;

  for (const f of ['settings.json', 'settings.local.json', 'CLAUDE.md']) {
    const p = join(cdir, f);
    if (!existsSync(p)) continue;
    const [title, description] = describeConfig(f, isGlobal);
    push({ kind: 'config', scope, repo, editable: true, path: p, name: f,
           title, description, format: f.endsWith('.json') ? 'json' : 'md' });
  }
  // CLAUDE.md en la raíz del proyecto (fuera de .claude/)
  if (!isGlobal && existsSync(join(base, 'CLAUDE.md'))) {
    const [title, description] = describeConfig('CLAUDE.md', false);
    push({ kind: 'config', scope, repo, editable: true, path: join(base, 'CLAUDE.md'),
           name: 'CLAUDE.md', title, description, format: 'md' });
  }

  mdFolder(join(cdir, 'skills'), 'skill', scope, repo);
  mdFolder(join(cdir, 'agents'), 'agent', scope, repo);
  mdFolder(join(cdir, 'commands'), 'command', scope, repo);
  if (isGlobal) mdFolder(join(cdir, 'scheduled-tasks'), 'task', scope, repo);

  for (const d of ['hooks', 'scripts']) {
    for (const e of ls(join(cdir, d))) {
      if (!e.isFile()) continue;
      const p = join(cdir, d, e.name);
      push({ kind: 'hook', scope, repo, editable: true, path: p, name: d + '/' + e.name,
             title: e.name, description: scriptDoc(read(p)), format: 'text' });
    }
  }
}

function walk(dir, depth, out) {
  if (depth < 0) return out;
  for (const e of ls(dir)) {
    if (!e.isDirectory() || SKIP.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.name === '.claude') { out.push(dirname(full)); continue; }
    walk(full, depth - 1, out);
  }
  return out;
}

function discover() {
  ITEMS = [];
  remoteCache.clear();
  scanClaudeDir(CLAUDE, 'Global', null, true);

  const projects = new Set();
  for (const root of SCAN_ROOTS) walk(root, 3, []).forEach((p) => projects.add(p));
  if (!projects.size) console.log('Aviso: no he encontrado ningún proyecto con carpeta .claude/ en ' +
    SCAN_ROOTS.map(tilde).join(', ') + '. Pásale la ruta: node config-dashboard.mjs /ruta/a/tus/repos');
  SKIPPED = [];
  for (const proj of [...projects].sort()) {
    // Un worktree enlazado tiene .git como FICHERO, no como carpeta: su config
    // es la misma del repo principal, así que por defecto no la duplicamos.
    const dotgit = join(proj, '.git');
    const isWorktree = existsSync(dotgit) && statSync(dotgit).isFile();
    if (isWorktree && !WITH_WORKTREES) { SKIPPED.push(tilde(proj)); continue; }
    scanClaudeDir(proj, tilde(proj) + (isWorktree ? '  (worktree)' : ''), proj, false);
  }

  ITEMS.forEach((it, i) => {
    it.id = String(i);
    it.displayPath = tilde(it.path);
    it.remote = it.repo ? gitRemote(it.repo) : null;
    it.relPath = it.repo ? relative(it.repo, it.path) : null;
    if (!it.format) it.format = 'md';
    try { const s = statSync(it.path); it.size = s.size; it.mtime = s.mtime.toISOString(); } catch {}
  });
  return ITEMS;
}

/* ---------- http ---------- */

function backup(path) {
  mkdirSync(BACKUPS, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const flat = tilde(path).replace(/[/\\~]/g, '_').replace(/^_+/, '');
  const dest = join(BACKUPS, flat + '.' + ts + '.bak');
  copyFileSync(path, dest);
  return dest;
}

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(s);
}

function body(req) {
  return new Promise((ok, no) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 4e6) no(new Error('demasiado grande')); });
    req.on('end', () => ok(d));
    req.on('error', no);
  });
}

discover();

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(HTML);
  }

  if (url.pathname === '/api/items') {
    discover();
    const counts = {};
    for (const k of Object.keys(KIND_INFO)) counts[k] = ITEMS.filter((i) => i.kind === k).length;
    return json(res, 200, {
      kinds: KIND_INFO,
      counts,
      items: ITEMS.map(({ meta, ...rest }) => ({ ...rest, meta: meta || {} })),
      scopes: [...new Set(ITEMS.map((i) => i.scope))],
      skipped: SKIPPED,
    });
  }

  if (url.pathname === '/api/item' && req.method === 'GET') {
    const it = ITEMS[Number(url.searchParams.get('id'))];
    if (!it) return json(res, 404, { error: 'no encontrado' });
    return json(res, 200, { ...it, content: read(it.path) });
  }

  if (url.pathname === '/api/item' && req.method === 'POST') {
    let p;
    try { p = JSON.parse(await body(req)); } catch { return json(res, 400, { error: 'petición inválida' }); }
    const it = ITEMS[Number(p.id)];
    if (!it || !it.editable) return json(res, 403, { error: 'no se puede escribir aquí' });
    if (it.format === 'json') {
      try { JSON.parse(p.content); } catch (e) { return json(res, 400, { error: 'JSON inválido: ' + e.message }); }
    }
    try {
      const b = backup(it.path);
      writeFileSync(it.path, p.content, 'utf8');
      return json(res, 200, { ok: true, backup: tilde(b) });
    } catch (e) { return json(res, 500, { error: String(e.message) }); }
  }

  res.writeHead(404); res.end('not found');
}).listen(PORT, '127.0.0.1', () => {
  console.log('Panel de Claude  →  http://127.0.0.1:' + PORT);
  console.log('Piezas encontradas: ' + ITEMS.length +
    (SKIPPED.length ? '  ·  ' + SKIPPED.length + ' worktrees omitidos (--worktrees para incluirlos)' : '') +
    '  ·  backups en ~/.claude/backups/config-dashboard/');
});

/* ---------- interfaz ---------- */

const HTML = String.raw`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Panel de Claude</title>
<style>
:root{
  --bg:#F0EEE6; --panel:#FFFFFF; --panel2:#F7F5EF; --line:#E0DCD1; --line2:#CFC9BA;
  --tx:#1F1E1D; --dim:#6B6862; --acc:#D97757; --acc2:#C2603F; --accsoft:#FBEDE7;
  --ok:#5B8C51; --warn:#B8832B; --err:#C0442F;
  --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
}
@media(prefers-color-scheme:dark){:root{
  --bg:#1F1E1D; --panel:#262624; --panel2:#2E2D2A; --line:#393734; --line2:#4A4844;
  --tx:#F0EEE6; --dim:#A09A90; --acc:#E08A6C; --acc2:#D97757; --accsoft:#3A2A24;
  --ok:#8FBF84; --warn:#D9A84E; --err:#E0705C;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);display:flex;height:100vh;overflow:hidden;
  font:14.5px/1.6 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
aside{width:252px;flex:0 0 252px;background:var(--panel);border-right:1px solid var(--line);overflow-y:auto;padding:18px 12px}
main{flex:1;overflow-y:auto;padding:28px 34px 80px}
.brand{display:flex;align-items:center;gap:9px;padding:0 8px 18px;font-weight:600;font-size:15px}
.dot{width:13px;height:13px;border-radius:50%;background:var(--acc);flex:0 0 13px}
.nav{padding:8px 10px;border-radius:7px;cursor:pointer;display:flex;align-items:center;gap:10px;font-size:13.5px;margin-bottom:1px}
.nav:hover{background:var(--panel2)}
.nav.on{background:var(--accsoft);color:var(--acc2);font-weight:550}
.nav .ic{width:17px;text-align:center;opacity:.75;font-size:13px}
.nav .n{margin-left:auto;color:var(--dim);font-size:12px;font-variant-numeric:tabular-nums}
.nav.on .n{color:var(--acc2)}
h1{font-size:23px;margin:0 0 6px;letter-spacing:-.2px}
h2.sec{font-size:11.5px;text-transform:uppercase;letter-spacing:.9px;color:var(--dim);margin:28px 0 11px;font-weight:600}
.lede{color:var(--dim);margin:0 0 24px;max-width:66ch}
.card{background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:16px 18px;margin-bottom:11px}
.card.clk{cursor:pointer;transition:border-color .12s}
.card.clk:hover{border-color:var(--acc)}
.ttl{font-weight:600;font-size:14.5px;display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.desc{color:var(--dim);font-size:13.5px;margin-top:5px;max-width:82ch}
.tag{font:11px var(--mono);background:var(--panel2);border:1px solid var(--line);border-radius:4px;padding:1px 6px;color:var(--dim)}
.tag.acc{background:var(--accsoft);border-color:var(--acc);color:var(--acc2)}
.tag.warn{background:transparent;border-color:var(--warn);color:var(--warn)}
.tag.err{background:transparent;border-color:var(--err);color:var(--err)}
.path{font:12px var(--mono);color:var(--dim);word-break:break-all;margin-bottom:20px}
.back{color:var(--acc2);cursor:pointer;font-size:13px;display:inline-block;margin-bottom:14px}
.back:hover{text-decoration:underline}
.tabs{display:flex;gap:3px;margin-bottom:18px;border-bottom:1px solid var(--line)}
.tab{padding:8px 15px;cursor:pointer;border-bottom:2px solid transparent;color:var(--dim);font-size:13.5px}
.tab.on{color:var(--tx);border-bottom-color:var(--acc);font-weight:550}
label{display:block;font-size:12.5px;color:var(--dim);margin-bottom:6px}
select,input[type=text]{background:var(--panel2);border:1px solid var(--line2);color:var(--tx);border-radius:7px;padding:8px 10px;font:13px var(--mono);width:100%}
select:focus,input:focus,textarea:focus{outline:2px solid var(--acc);outline-offset:-1px}
.perm{display:flex;gap:11px;padding:9px 0;border-bottom:1px solid var(--line);align-items:flex-start}
.perm:last-child{border-bottom:0}
.perm code{font:12px var(--mono);background:var(--panel2);border:1px solid var(--line);border-radius:4px;padding:2px 6px;white-space:nowrap}
.perm .ex{flex:1;font-size:13px;color:var(--dim)}
.perm .x{cursor:pointer;color:var(--dim);padding:0 4px}
.perm .x:hover{color:var(--err)}
.row{display:flex;gap:9px;margin-top:12px}
textarea{width:100%;min-height:58vh;background:var(--panel2);border:1px solid var(--line2);color:var(--tx);
  border-radius:9px;padding:14px;font:12.5px/1.65 var(--mono);resize:vertical}
textarea.bad{border-color:var(--err)}
button{background:var(--acc);color:#fff;border:0;border-radius:7px;padding:9px 16px;font-size:13.5px;cursor:pointer;font-weight:500}
button:hover{background:var(--acc2)}
button.ghost{background:transparent;color:var(--tx);border:1px solid var(--line2)}
button.ghost:hover{background:var(--panel2)}
button:disabled{opacity:.38;cursor:not-allowed}
.bar{position:sticky;bottom:0;background:linear-gradient(transparent,var(--bg) 40%);padding:20px 0 6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.msg{font-size:12.5px}.msg.ok{color:var(--ok)}.msg.err{color:var(--err)}.msg.warn{color:var(--warn)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.6px}
td.cmd{font:11.5px var(--mono);color:var(--dim);word-break:break-all}
.md{max-width:78ch}
.md h1{font-size:21px;margin:22px 0 10px}.md h2{font-size:17px;margin:22px 0 9px}
.md h3{font-size:15px;margin:18px 0 7px}.md h4{font-size:13.5px;margin:16px 0 6px;color:var(--dim)}
.md p{margin:0 0 13px}.md ul,.md ol{margin:0 0 13px;padding-left:22px}.md li{margin-bottom:4px}
.md code{font:12.5px var(--mono);background:var(--panel2);border:1px solid var(--line);border-radius:4px;padding:1px 5px}
.md pre{background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:13px;overflow-x:auto;margin:0 0 14px}
.md pre code{background:0;border:0;padding:0;font-size:12px;line-height:1.6}
.md blockquote{border-left:3px solid var(--acc);margin:0 0 13px;padding:2px 0 2px 14px;color:var(--dim)}
.md hr{border:0;border-top:1px solid var(--line);margin:22px 0}
.md a{color:var(--acc2)}
.md table{margin-bottom:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:11px}
.kpi{font-size:27px;font-weight:600;letter-spacing:-.5px}
.hint{background:var(--accsoft);border:1px solid var(--acc);border-radius:9px;padding:13px 15px;font-size:13.5px;margin-bottom:16px}
.hint b{color:var(--acc2)}
pre.copy{background:var(--panel2);border:1px solid var(--line);border-radius:7px;padding:11px 13px;font:12px var(--mono);
  overflow-x:auto;margin:9px 0 0;white-space:pre-wrap;word-break:break-word}
</style></head><body>
<aside>
  <div class="brand"><span class="dot"></span>Panel de Claude</div>
  <div id="nav"></div>
</aside>
<main id="main"></main>
<script>
const BT = String.fromCharCode(96);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let DATA = null, view = 'resumen', cur = null, text = '', orig = '', tab = 'ui';

/* ----- explicar permisos en castellano ----- */
const TOOLS = {
  Bash: 'ejecutar comandos en la terminal',
  Read: 'leer ficheros',
  Write: 'crear o sobrescribir ficheros',
  Edit: 'modificar ficheros',
  MultiEdit: 'modificar varios trozos de un fichero',
  NotebookEdit: 'modificar notebooks de Jupyter',
  Glob: 'buscar ficheros por nombre',
  Grep: 'buscar texto dentro de los ficheros',
  WebFetch: 'descargar el contenido de una web',
  WebSearch: 'buscar en internet',
  Task: 'lanzar subagentes',
  TodoWrite: 'gestionar su lista de tareas'
};
const CMD_HINT = {
  git:'git', npm:'npm', pnpm:'pnpm', yarn:'yarn', node:'Node', python3:'Python', bash:'bash',
  grep:'grep', cat:'cat', ls:'ls', find:'find', echo:'echo', pwd:'pwd', which:'which',
  rm:'rm', chmod:'chmod', jq:'jq', docker:'Docker', gh:'la CLI de GitHub', nx:'Nx'
};
const BROAD = new Set(['bash','sh','zsh','node','python3','python','eval','npx','pnpm dlx']);

function explain(rule) {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(rule);
  if (mcp) {
    const out = /send|post|create|delete|trash|update|write|reply|forward|schedule/i.test(mcp[2]);
    return { text: 'Herramienta ' + mcp[2] + ' del conector externo. ' +
      (out ? 'Actúa hacia fuera: puede enviar o cambiar algo en ese servicio.' : 'Sólo consulta datos de ese servicio.'),
      level: out ? 'outbound' : 'normal' };
  }
  const m = /^([A-Za-z]+)(?:\((.*)\))?$/.exec(rule);
  if (!m) return { text: 'Regla sin reconocer.', level: 'normal' };
  const [, tool, arg] = m;
  const base = TOOLS[tool] || ('usar la herramienta ' + tool);
  if (!arg) return { text: 'Puede ' + base + ' sin preguntar.', level: 'normal' };
  if (tool !== 'Bash') {
    const where = arg === '**' ? 'en cualquier ruta' : 'en ' + arg;
    return { text: 'Puede ' + base + ' ' + where + ' sin preguntar.', level: arg === '**' ? 'broad' : 'normal' };
  }
  const prog = arg.trim().split(/\s+/)[0].replace(/[*:]/g, '');
  const name = CMD_HINT[prog] || prog;
  const open = /\*$/.test(arg.trim());
  let txt = 'Puede ejecutar ' + name + (open ? ' con cualquier argumento' : ' exactamente así') + ', sin preguntar.';
  let level = 'normal';
  if (BROAD.has(prog)) { level = 'broad'; txt += ' Ojo: eso permite correr cualquier script, así que en la práctica es un permiso muy amplio.'; }
  if (/^rm\b/.test(arg)) { level = 'broad'; txt += ' Borra ficheros.'; }
  return { text: txt, level };
}

/* ----- markdown mínimo ----- */
function md(src) {
  const fence = BT + BT + BT;
  src = src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const blocks = [];
  src = src.replace(new RegExp(fence + '([a-z]*)\\n([\\s\\S]*?)' + fence, 'g'), (m, lang, code) => {
    blocks.push(code); return '@@CB' + (blocks.length - 1) + '@@';
  });
  const inline = (s) => esc(s)
    .replace(new RegExp(BT + '([^' + BT + ']+)' + BT, 'g'), '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const out = [];
  let list = null, inTable = false;
  for (const raw of src.split(/\r?\n/)) {
    const l = raw.trimEnd();
    const cb = /^@@CB(\d+)@@$/.exec(l.trim());
    if (cb) { if (list) { out.push('</' + list + '>'); list = null; }
      out.push('<pre><code>' + esc(blocks[+cb[1]]) + '</code></pre>'); continue; }
    if (/^\|.*\|$/.test(l)) {
      if (/^\|[\s:|-]+\|$/.test(l)) continue;
      const cells = l.slice(1, -1).split('|').map((c) => inline(c.trim()));
      if (!inTable) { out.push('<table><tr>' + cells.map((c) => '<th>' + c + '</th>').join('') + '</tr>'); inTable = true; }
      else out.push('<tr>' + cells.map((c) => '<td>' + c + '</td>').join('') + '</tr>');
      continue;
    }
    if (inTable) { out.push('</table>'); inTable = false; }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) { if (list) { out.push('</' + list + '>'); list = null; }
      out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); continue; }
    if (/^(-{3,}|\*{3,})$/.test(l)) { out.push('<hr>'); continue; }
    const q = /^>\s?(.*)$/.exec(l);
    if (q) { out.push('<blockquote>' + inline(q[1]) + '</blockquote>'); continue; }
    const ul = /^[-*+]\s+(.*)$/.exec(l), ol = /^\d+[.)]\s+(.*)$/.exec(l);
    if (ul || ol) {
      const want = ul ? 'ul' : 'ol';
      if (list !== want) { if (list) out.push('</' + list + '>'); out.push('<' + want + '>'); list = want; }
      out.push('<li>' + inline((ul || ol)[1]) + '</li>'); continue;
    }
    if (list) { out.push('</' + list + '>'); list = null; }
    if (l.trim()) out.push('<p>' + inline(l) + '</p>');
  }
  if (list) out.push('</' + list + '>');
  if (inTable) out.push('</table>');
  return out.join('');
}

/* ----- arranque ----- */
async function boot() {
  DATA = await (await fetch('/api/items')).json();
  const navs = [['resumen', '◉', 'Resumen', '']].concat(
    Object.entries(DATA.kinds).map(([k, v]) => [k, v.icon, v.label, DATA.counts[k]]));
  $('#nav').innerHTML = navs.map(([k, ic, lab, n]) =>
    '<div class="nav" data-v="' + k + '"><span class="ic">' + ic + '</span>' + lab +
    (n === '' ? '' : '<span class="n">' + n + '</span>') + '</div>').join('');
  $('#nav').onclick = (e) => { const el = e.target.closest('.nav'); if (el) go(el.dataset.v); };
  go('resumen');
}
function go(v) { view = v; cur = null;
  document.querySelectorAll('.nav').forEach((e) => e.classList.toggle('on', e.dataset.v === v));
  v === 'resumen' ? renderResumen() : renderList(v); window.scrollTo(0, 0); $('#main').scrollTop = 0; }

/* ----- resumen ----- */
function renderResumen() {
  const scopes = DATA.scopes;
  let h = '<h1>Qué tiene configurado Claude</h1><p class="lede">Cada pieza se carga en un momento distinto y con reglas distintas. ' +
    'Esto es todo lo que hay en tu máquina, agrupado por tipo de pieza en vez de por fichero.</p><div class="grid">';
  for (const [k, v] of Object.entries(DATA.kinds)) {
    h += '<div class="card clk" data-go="' + k + '"><div class="kpi">' + DATA.counts[k] + '</div>' +
      '<div class="ttl" style="margin-top:2px">' + v.icon + ' ' + v.label + '</div>' +
      '<div class="desc">' + esc(v.blurb) + '</div></div>';
  }
  h += '</div><h2 class="sec">Ámbitos detectados (' + scopes.length + ')</h2><div class="card">' +
    scopes.map((s) => '<span class="tag" style="margin:0 6px 6px 0;display:inline-block">' + esc(s) + '</span>').join('') +
    ((DATA.skipped || []).length ? '<div class="desc" style="margin-top:11px">' + DATA.skipped.length +
      ' worktrees omitidos porque comparten la config de su repo. Arranca con <code>--worktrees</code> si quieres verlos.</div>' : '') +
    '</div>';

  h += '<h2 class="sec">Revisar todo esto con Claude</h2>' +
    '<div class="hint"><b>Un panel te enseña qué hay; no te dice si está bien.</b> ' +
    'Para eso lanza una auditoría: Claude lee estas piezas y te devuelve un informe de qué sobra, qué se solapa y qué nunca llega a dispararse.</div>' +
    '<div class="card"><div class="ttl">Auditoría completa</div>' +
    '<div class="desc">Pégalo en Claude Code dentro del repo que quieras revisar.</div>' +
    copyBlock('Audita la configuración de Claude de este repo con el agente auditor-config: ' +
      'skills, agentes, comandos, hooks y permisos. Dime qué se solapa, qué nunca se dispara, ' +
      'qué permiso es más amplio de lo que hace falta y qué hook actúa sin que yo lo vea. ' +
      'Informe primero, sin tocar nada.') + '</div>';
  $('#main').innerHTML = h;
  $('#main').onclick = (e) => {
    const c = e.target.closest('[data-go]'); if (c) return go(c.dataset.go);
    copyHandler(e);
  };
}
function copyBlock(t) { return '<pre class="copy" data-copy>' + esc(t) + '</pre>'; }
function copyHandler(e) {
  const p = e.target.closest('[data-copy]');
  if (!p) return;
  navigator.clipboard.writeText(p.textContent).then(() => {
    const old = p.style.borderColor; p.style.borderColor = 'var(--ok)';
    setTimeout(() => { p.style.borderColor = old; }, 700);
  });
}

/* ----- listados ----- */
function renderList(kind) {
  const info = DATA.kinds[kind];
  const items = DATA.items.filter((i) => i.kind === kind);
  const groups = {};
  items.forEach((i) => { (groups[i.scope] ??= []).push(i); });
  let h = '<h1>' + info.label + '</h1><p class="lede">' + esc(info.blurb) + '</p>';
  if (!items.length) h += '<div class="card"><div class="desc">No hay ninguna pieza de este tipo.</div></div>';
  for (const [scope, list] of Object.entries(groups)) {
    h += '<h2 class="sec">' + esc(scope) + ' · ' + list.length + '</h2>';
    for (const it of list) {
      h += '<div class="card clk" data-id="' + it.id + '"><div class="ttl">' + esc(it.title) +
        (it.name !== it.title ? ' <span class="tag">' + esc(it.name) + '</span>' : '') +
        (it.remote ? ' <span class="tag acc">repo</span>' : '') + '</div>' +
        (it.description ? '<div class="desc">' + esc(it.description.slice(0, 260)) +
          (it.description.length > 260 ? '…' : '') + '</div>' : '<div class="desc" style="opacity:.6">Sin descripción.</div>') +
        '</div>';
    }
  }
  $('#main').innerHTML = h;
  $('#main').onclick = (e) => { const c = e.target.closest('[data-id]'); if (c) openItem(c.dataset.id); };
}

/* ----- detalle ----- */
async function openItem(id) {
  cur = await (await fetch('/api/item?id=' + id)).json();
  text = cur.content; orig = cur.content;
  tab = cur.format === 'json' ? 'ui' : 'leer';
  renderItem();
}
function renderItem() {
  const dirty = text !== orig;
  const tabs = cur.format === 'json'
    ? [['ui', 'Vista'], ['raw', 'JSON']]
    : [['leer', 'Leer'], ['raw', 'Editar']];
  let h = '<div class="back" data-back>← ' + esc(DATA.kinds[cur.kind].label) + '</div>' +
    '<h1>' + esc(cur.title) + '</h1>' +
    (cur.description ? '<p class="lede">' + esc(cur.description) + '</p>' : '') +
    '<div class="path">' + esc(cur.displayPath) + '</div>' +
    '<div class="tabs">' + tabs.map(([t, l]) =>
      '<div class="tab' + (tab === t ? ' on' : '') + '" data-t="' + t + '">' + l + '</div>').join('') + '</div>';

  if (tab === 'ui' && cur.format === 'json') h += jsonUI();
  else if (tab === 'leer') h += '<div class="md">' + md(text) + '</div>' + actions();
  else h += '<textarea id="raw" spellcheck="false">' + esc(text) + '</textarea>';

  if (tab !== 'leer') h += '<div class="bar">' +
    '<button id="save"' + (dirty ? '' : ' disabled') + '>Guardar</button>' +
    '<button class="ghost" id="reset"' + (dirty ? '' : ' disabled') + '>Descartar</button>' +
    '<span class="msg' + (dirty ? ' warn' : '') + '" id="msg">' + (dirty ? 'cambios sin guardar' : '') + '</span></div>';

  $('#main').innerHTML = h;
  wire();
}

function actions() {
  let h = '<h2 class="sec">Acciones</h2>';
  const label = DATA.kinds[cur.kind].one;
  h += '<div class="card"><div class="ttl">Auditar con Claude</div>' +
    '<div class="desc">Copia esto y pégalo en Claude Code: te dice si esta pieza se dispara cuando debe y si se solapa con otra.</div>' +
    copyBlock('Audita ' + (cur.kind === 'skill' ? 'la skill' : 'el ' + label) + ' "' + cur.name + '" (' + cur.displayPath + '). ' +
      'Mira si la descripción dispara en los casos reales, si se solapa con otra pieza, si el prompt es más largo de lo necesario ' +
      'y qué obstáculos no está reportando. Informe primero, sin tocar nada.') + '</div>';
  if (cur.remote && cur.relPath) {
    const title = 'Mejorar ' + label + ': ' + cur.name;
    const bodyTxt = 'Fichero: ' + cur.relPath + '\n\nQué falla:\n- \n\nQué debería hacer:\n- \n';
    const url = cur.remote + '/issues/new?title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(bodyTxt);
    h += '<div class="card"><div class="ttl">Abrir ticket en el repo</div>' +
      '<div class="desc">Issue prellenado en ' + esc(cur.remote.replace('https://github.com/', '')) + ' con la ruta del fichero.</div>' +
      '<div class="row"><a href="' + esc(url) + '" target="_blank" rel="noopener"><button>Crear issue en GitHub</button></a></div>' +
      copyBlock('gh issue create --repo ' + cur.remote.replace('https://github.com/', '') +
        ' --title "' + title + '" --body "Fichero: ' + cur.relPath + '"') + '</div>';
  }
  return h;
}

function parsed() { try { return JSON.parse(text); } catch { return null; } }
function setObj(o) { text = JSON.stringify(o, null, 2) + '\n'; renderItem(); }

function jsonUI() {
  const p = parsed();
  if (!p) return '<div class="card"><div class="msg err">El JSON no es válido. Arréglalo en la pestaña JSON.</div></div>';
  const perm = p.permissions || {}, allow = perm.allow || [], deny = perm.deny || [];
  const modes = [['default', 'Normal — pide permiso según las reglas'],
    ['plan', 'Plan — tiene que enseñarte el plan antes de tocar nada'],
    ['acceptEdits', 'Edición automática — acepta cambios de ficheros sin preguntar'],
    ['bypassPermissions', 'Sin frenos — no pregunta nada (peligroso)']];
  let h = '<div class="card"><div class="ttl">Cómo arranca una sesión en este ámbito</div>' +
    '<div class="desc" style="margin-bottom:10px">Es el punto de control: decide si Claude puede ponerse a editar directamente o tiene que pasar por ti.</div>' +
    '<select id="mode">' + modes.map(([v, l]) =>
      '<option value="' + v + '"' + ((perm.defaultMode || 'default') === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>';

  const section = (titleTxt, descTxt, rules, key) => {
    let s = '<div class="card"><div class="ttl">' + titleTxt + ' <span class="tag">' + rules.length + '</span></div>' +
      '<div class="desc" style="margin-bottom:6px">' + descTxt + '</div>';
    if (!rules.length) s += '<div class="desc" style="opacity:.6">Ninguna regla.</div>';
    rules.forEach((r, i) => {
      const e = explain(r);
      s += '<div class="perm"><code>' + esc(r) + '</code><div class="ex">' + esc(e.text) +
        (e.level === 'broad' ? ' <span class="tag warn">amplio</span>' : '') +
        (e.level === 'outbound' ? ' <span class="tag err">sale fuera</span>' : '') +
        '</div><span class="x" data-del="' + key + ':' + i + '">&times;</span></div>';
    });
    s += '<div class="row"><input type="text" id="add_' + key + '" placeholder="Bash(npm test *)">' +
      '<button class="ghost" data-add="' + key + '">Añadir</button></div></div>';
    return s;
  };
  h += section('Lo que puede hacer sin preguntarte', 'Cada regla es una puerta abierta. Cuantas menos y más estrechas, mejor.', allow, 'allow');
  h += section('Lo que tiene prohibido', 'Esto gana siempre sobre lo anterior.', deny, 'deny');

  const rows = [];
  for (const [ev, arr] of Object.entries(p.hooks || {}))
    for (const g of arr || []) for (const hk of g.hooks || [])
      rows.push([ev, g.matcher || '(todo)', hk.command || '', hk.async ? 'en segundo plano' : (hk.timeout ? hk.timeout + 's máx' : '')]);
  if (rows.length) h += '<div class="card"><div class="ttl">Lo que se ejecuta solo <span class="tag">' + rows.length + '</span></div>' +
    '<div class="desc" style="margin-bottom:8px">Se dispara sin pedirte permiso cuando ocurre el evento. Es lo que conviene mirar con más calma.</div>' +
    '<table><tr><th>Cuándo</th><th>Sobre qué</th><th>Qué ejecuta</th><th></th></tr>' +
    rows.map((r) => '<tr><td>' + esc(r[0]) + '</td><td class="cmd">' + esc(r[1]) + '</td><td class="cmd">' +
      esc(r[2].length > 170 ? r[2].slice(0, 170) + '…' : r[2]) + '</td><td>' + esc(r[3]) + '</td></tr>').join('') +
    '</table><div class="desc" style="margin-top:9px">Para cambiarlos, pestaña JSON.</div></div>';

  const rest = Object.entries(p).filter(([k]) => !['permissions', 'hooks'].includes(k));
  if (rest.length) h += '<div class="card"><div class="ttl">Otros ajustes</div><table>' + rest.map(([k, v]) =>
    '<tr><td><code>' + esc(k) + '</code></td><td class="cmd">' + esc(typeof v === 'object' ? JSON.stringify(v) : String(v)) + '</td></tr>').join('') + '</table></div>';
  return h;
}

function wire() {
  const main = $('#main');
  main.onclick = (e) => {
    if (e.target.closest('[data-back]')) return go(cur.kind);
    const t = e.target.closest('.tab');
    if (t) { if (tab === 'raw') { const ta = $('#raw'); if (ta) text = ta.value; } tab = t.dataset.t; return renderItem(); }
    const d = e.target.closest('[data-del]');
    if (d) { const [k, i] = d.dataset.del.split(':'); const p = parsed(); p.permissions[k].splice(+i, 1); return setObj(p); }
    const a = e.target.closest('[data-add]');
    if (a) { const k = a.dataset.add, inp = $('#add_' + k), v = inp.value.trim(); if (!v) return;
      const p = parsed(); p.permissions ??= {}; p.permissions[k] ??= []; p.permissions[k].push(v); return setObj(p); }
    copyHandler(e);
  };
  const mode = $('#mode');
  if (mode) mode.onchange = () => { const p = parsed(); p.permissions ??= {};
    if (mode.value === 'default') delete p.permissions.defaultMode; else p.permissions.defaultMode = mode.value;
    setObj(p); };
  const ta = $('#raw');
  if (ta) ta.oninput = () => { text = ta.value; const d = text !== orig, m = $('#msg');
    let bad = false; if (cur.format === 'json') { try { JSON.parse(text); } catch { bad = true; } }
    ta.classList.toggle('bad', bad);
    m.textContent = bad ? 'JSON inválido' : (d ? 'cambios sin guardar' : '');
    m.className = 'msg' + (bad ? ' err' : (d ? ' warn' : ''));
    $('#save').disabled = !d || bad; $('#reset').disabled = !d; };
  const rst = $('#reset'); if (rst) rst.onclick = () => { text = orig; renderItem(); };
  const sv = $('#save'); if (sv) sv.onclick = async () => {
    const r = await (await fetch('/api/item', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: cur.id, content: text }) })).json();
    const m = $('#msg');
    if (r.error) { m.textContent = r.error; m.className = 'msg err'; return; }
    orig = text; m.textContent = 'guardado · copia en ' + r.backup; m.className = 'msg ok';
    $('#save').disabled = true; $('#reset').disabled = true; };
}
boot();
</script></body></html>`;
