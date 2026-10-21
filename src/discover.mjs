import { existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { CLAUDE, tilde } from './paths.mjs';
import { ls, read, frontmatter, scriptDoc } from './fsutil.mjs';
import { gitRemote, clearRemoteCache, isLinkedWorktree, repoRoot } from './git.mjs';
import { describeConfig } from './labels.mjs';

/** Carpetas que nunca contienen configuración y cuestan caro de recorrer. */
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor', 'coverage', '.turbo', 'tmp']);

/** Dónde buscar proyectos cuando nadie dice lo contrario. */
export const COMMON_ROOTS = ['Desktop/dades', 'code', 'dev', 'projects', 'proyectos',
  'src', 'repos', 'work', 'Desktop', 'Documents'];

/** Cuántos niveles bajamos por defecto. 4 no bastan: en un monorepo la config
 *  de un paquete vive en `<repo>/apps/<paquete>/.claude`, que son 4 desde la
 *  carpeta que contiene los repos. */
export const DEFAULT_DEPTH = 5;

/**
 * Busca carpetas `.claude/` hasta `depth` niveles por debajo de `dir`.
 *
 * Un proyecto puede contener otros: encontrar `.claude` en un repo no impide
 * seguir bajando, porque los paquetes de un monorepo tienen la suya. Lo que sí
 * se corta son los worktrees enlazados, y se cortan enteros: si no, cada uno
 * aportaría además una copia de la config de cada paquete que contiene.
 *
 * @returns {{projects: string[], worktrees: string[]}}
 */
export function findProjects(dir, depth, { withWorktrees = false } = {},
  acc = { projects: [], worktrees: [] }) {
  if (depth < 0) return acc;
  for (const e of ls(dir)) {
    if (!e.isDirectory() || SKIP.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.name === '.claude') { acc.projects.push(dirname(full)); continue; }
    if (isLinkedWorktree(full) && !withWorktrees) { acc.worktrees.push(full); continue; }
    findProjects(full, depth - 1, { withWorktrees }, acc);
  }
  return acc;
}

/** Lee una carpeta de skills/agentes/comandos, en sus dos formas habituales. */
function collectMarkdown(dir, kind, scope, repo, items) {
  const add = (path, name) => {
    const fm = frontmatter(read(path));
    items.push({ kind, scope, repo, editable: true, path, name, format: 'md',
      title: fm.name || name, description: fm.description || '', meta: fm });
  };
  for (const e of ls(dir)) {
    if (e.isFile() && e.name.endsWith('.md')) { add(join(dir, e.name), e.name.replace(/\.md$/, '')); continue; }
    if (!e.isDirectory()) continue;
    // <nombre>/SKILL.md y equivalentes
    const inner = ['SKILL.md', 'AGENT.md', 'index.md', e.name + '.md']
      .map((c) => join(dir, e.name, c)).find(existsSync);
    if (inner) { add(inner, e.name); continue; }
    // comandos agrupados: lp/foo.md -> lp:foo
    for (const sub of ls(join(dir, e.name))) {
      if (sub.isFile() && sub.name.endsWith('.md')) {
        add(join(dir, e.name, sub.name), e.name + ':' + sub.name.replace(/\.md$/, ''));
      }
    }
  }
}

function collectScope(base, scope, repo, isGlobal, items) {
  const cdir = isGlobal ? base : join(base, '.claude');
  if (!existsSync(cdir)) return;

  for (const f of ['settings.json', 'settings.local.json', 'CLAUDE.md']) {
    const path = join(cdir, f);
    if (!existsSync(path)) continue;
    const [title, description] = describeConfig(f, isGlobal);
    items.push({ kind: 'config', scope, repo, editable: true, path, name: f, title, description,
      format: f.endsWith('.json') ? 'json' : 'md' });
  }
  // Muchos proyectos dejan el CLAUDE.md en la raíz, fuera de .claude/
  if (!isGlobal && existsSync(join(base, 'CLAUDE.md'))) {
    const [title, description] = describeConfig('CLAUDE.md', false);
    items.push({ kind: 'config', scope, repo, editable: true, path: join(base, 'CLAUDE.md'),
      name: 'CLAUDE.md', title, description, format: 'md' });
  }

  collectMarkdown(join(cdir, 'skills'), 'skill', scope, repo, items);
  collectMarkdown(join(cdir, 'agents'), 'agent', scope, repo, items);
  collectMarkdown(join(cdir, 'commands'), 'command', scope, repo, items);
  if (isGlobal) collectMarkdown(join(cdir, 'scheduled-tasks'), 'task', scope, repo, items);

  for (const d of ['hooks', 'scripts']) {
    for (const e of ls(join(cdir, d))) {
      if (!e.isFile()) continue;
      const path = join(cdir, d, e.name);
      items.push({ kind: 'hook', scope, repo, editable: true, path, name: d + '/' + e.name,
        title: e.name, description: scriptDoc(read(path)), format: 'text' });
    }
  }
}

/**
 * Recorre la configuración global y la de cada proyecto bajo `scanRoots`.
 * @returns {{items: object[], skipped: string[]}}
 */
export function discover({ scanRoots = [], withWorktrees = false, depth = DEFAULT_DEPTH } = {}) {
  clearRemoteCache();
  const items = [];
  const projects = new Set(), skipped = new Set();
  collectScope(CLAUDE, 'Global', null, true, items);

  for (const root of scanRoots) {
    const acc = findProjects(root, depth, { withWorktrees });
    acc.projects.forEach((p) => projects.add(p));
    acc.worktrees.forEach((p) => skipped.add(tilde(p)));
  }

  for (const proj of [...projects].sort()) {
    const worktree = isLinkedWorktree(proj);
    if (worktree && !withWorktrees) { skipped.add(tilde(proj)); continue; }
    collectScope(proj, tilde(proj) + (worktree ? '  (worktree)' : ''), proj, false, items);
  }

  items.forEach((it, i) => {
    it.id = String(i);
    it.displayPath = tilde(it.path);
    // `project` es la carpeta con .claude/; `repo` es la raíz de git, que en un
    // monorepo no son la misma: apps/web es proyecto pero no repo.
    it.project = it.repo;
    it.repo = it.repo ? repoRoot(it.repo) : null;
    it.remote = it.repo ? gitRemote(it.repo) : null;
    it.relPath = it.repo ? relative(it.repo, it.path) : null;
    try { const s = statSync(it.path); it.size = s.size; it.mtime = s.mtime.toISOString(); } catch { /* ya no está */ }
  });
  return { items, skipped: [...skipped].sort() };
}
