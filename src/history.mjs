// Quién creó y quién ha tocado cada pieza de configuración.
//
// Sólo hay respuesta para lo que está versionado. ~/.claude no es un repo y los
// settings.local.json están en .gitignore, así que de esos no se puede saber más
// que la fecha del fichero. Es mejor decirlo que inventar un autor.

import { execFileSync } from 'node:child_process';

const REC = '\x1e'; // separador de commit
const FLD = '\x1f'; // separador de campo

/**
 * Convierte la salida de `git log --numstat` en historial. Separado de la
 * llamada a git para poder probarlo sin montar un repo.
 */
export function parseGitLog(stdout) {
  const commits = [];
  for (const chunk of stdout.split(REC)) {
    if (!chunk.trim()) continue;
    const [head, ...rest] = chunk.split('\n');
    const [hash, author, email, date, ...subject] = head.split(FLD);
    if (!hash) continue;
    let added = 0, removed = 0;
    const files = [];
    for (const l of rest) {
      const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(l);
      if (!m) continue;
      const a = m[1] === '-' ? 0 : Number(m[1]);
      const r = m[2] === '-' ? 0 : Number(m[2]);
      added += a; removed += r;
      files.push({ path: m[3], added: a, removed: r });
    }
    commits.push({ hash, author, email, date, subject: subject.join(FLD), added, removed, files });
  }
  return commits;
}

/** Resume una lista de commits: quién la creó, quién la tocó por última vez. */
export function summarize(commits) {
  if (!commits.length) return null;
  const byAuthor = new Map();
  for (const c of commits) byAuthor.set(c.author, (byAuthor.get(c.author) || 0) + 1);
  return {
    // git log llega del más nuevo al más viejo: el creador es el último.
    creator: { author: commits.at(-1).author, date: commits.at(-1).date },
    lastChange: commits[0],
    commits: commits.length,
    authors: [...byAuthor].map(([author, n]) => ({ author, commits: n }))
      .sort((a, b) => b.commits - a.commits),
  };
}

/**
 * Historial de un fichero dentro de un repo.
 * @returns {{tracked: boolean, reason?: string, history?: object, changes?: object[]}}
 */
export function fileHistory(repo, relPath, limit = 10) {
  if (!repo || !relPath) return { tracked: false, reason: 'fuera de un repositorio' };
  let out;
  try {
    out = execFileSync('git', ['-C', repo, 'log', '--follow', '--numstat',
      '--format=' + REC + '%H' + FLD + '%an' + FLD + '%ae' + FLD + '%aI' + FLD + '%s',
      '-n', String(limit), '--', relPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 4e6 });
  } catch {
    return { tracked: false, reason: 'git no pudo leer el historial' };
  }
  const commits = parseGitLog(out);
  if (!commits.length) {
    return { tracked: false, reason: 'sin seguimiento en git (nuevo o ignorado)' };
  }
  return { tracked: true, history: summarize(commits), changes: commits };
}

/* ---------- autoría de todo un repo de una sola pasada ---------- */

const indexes = new Map(); // repo -> { head, index }

/**
 * Un `git log` por fichero cuesta 60 ms. Con 177 piezas eso es demasiado, así
 * que aquí se pide el historial de `.claude` entero de una vez y se indexa por
 * ruta. Se usa `--no-renames`: seguir renombrados sólo funciona fichero a
 * fichero, y para el perfil de cada persona interesa quién trajo la pieza tal y
 * como está hoy. La vista de detalle sí usa `--follow`, que es más preciso.
 *
 * @returns {Map<string, object[]>} ruta relativa -> commits, del más nuevo al más viejo
 */
export function repoIndex(repo, paths = ['.claude', 'CLAUDE.md']) {
  if (!repo) return new Map();
  let head = '';
  try {
    head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return new Map(); }

  const key = repo + '\u0000' + paths.join('\u0000');
  const cached = indexes.get(key);
  if (cached && cached.head === head) return cached.index;

  let out = '';
  try {
    out = execFileSync('git', ['-C', repo, 'log', '--numstat', '--no-renames',
      '--format=' + REC + '%H' + FLD + '%an' + FLD + '%ae' + FLD + '%aI' + FLD + '%s',
      '--', ...paths],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 6e7 });
  } catch { return new Map(); }

  const index = new Map();
  for (const c of parseGitLog(out)) {
    for (const f of c.files) {
      if (!index.has(f.path)) index.set(f.path, []);
      index.get(f.path).push({ ...c, added: f.added, removed: f.removed, files: undefined });
    }
  }
  indexes.set(key, { head, index });
  return index;
}

export function clearIndexCache() { indexes.clear(); }

/**
 * Agrupa las piezas por persona.
 *
 * "Creó" significa que es suyo el commit más antiguo que toca esa ruta; el resto
 * de quienes la tocaron cuentan como modificaciones. Las personas se agrupan por
 * email, porque el mismo humano aparece con varios nombres (`cgala`, `Carles
 * Galan`) según la máquina desde la que haya commiteado.
 *
 * @param {object[]} items piezas con repo y relPath
 * @param {(repo: string) => Map} getIndex
 */
export function buildPeople(items, getIndex) {
  const people = new Map();
  const touch = (c) => {
    const key = (c.email || c.author).toLowerCase();
    if (!people.has(key)) {
      people.set(key, { id: key, name: c.author, email: c.email, names: new Set(),
        created: [], modified: [], commits: 0, first: c.date, last: c.date });
    }
    const p = people.get(key);
    p.names.add(c.author);
    if (c.date < p.first) p.first = c.date;
    if (c.date > p.last) { p.last = c.date; p.name = c.author; }
    return p;
  };

  for (const it of items) {
    if (!it.repo || !it.relPath) continue;
    const commits = getIndex(it.repo).get(it.relPath);
    if (!commits || !commits.length) continue;
    const ref = { id: it.id, kind: it.kind, name: it.name, title: it.title, scope: it.scope };
    const oldest = commits.at(-1);
    touch(oldest).created.push({ ...ref, date: oldest.date });
    const creator = (oldest.email || oldest.author).toLowerCase();
    const already = new Set([creator]);
    for (const c of commits) {
      const p = touch(c);
      p.commits += 1;
      const key = (c.email || c.author).toLowerCase();
      if (!already.has(key)) { already.add(key); p.modified.push({ ...ref, date: c.date }); }
    }
  }

  return [...people.values()]
    .map((p) => ({ ...p, names: [...p.names] }))
    .sort((a, b) => b.created.length - a.created.length || b.commits - a.commits);
}

/* ---------- unificar a la misma persona ---------- */

const GENERIC = new Set(['admin', 'dev', 'developer', 'git', 'github', 'info', 'mail',
  'me', 'noreply', 'root', 'user', 'users', 'test', 'ci', 'bot', 'action', 'actions']);

const normName = (n) => (n || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Claves por las que dos identidades son la misma persona.
 *
 * Hace falta porque el mismo humano commitea desde sitios distintos: el correo
 * del trabajo, el `12345+usuario@users.noreply.github.com` cuando edita en la
 * web, y el `usuario@MacBook-Air.local` de un portátil sin configurar. Ninguno
 * comparte email con los otros, así que por email solo no se juntan.
 */
export function identityKeys({ email = '', names = [] }) {
  const keys = new Set();
  const mail = email.toLowerCase().trim();
  if (mail) keys.add('e:' + mail);
  // El local del correo también es un nombre: "cgala@MacBook-Air.local" tira del
  // mismo hilo que el autor llamado "cgala".
  const local = mail.split('@')[0].replace(/^\d+\+/, '');
  if (local && !GENERIC.has(local)) keys.add('n:' + normName(local));
  for (const n of names) {
    const k = normName(n);
    if (k && !GENERIC.has(k)) keys.add('n:' + k);
  }
  return [...keys];
}

/**
 * Funde las identidades que comparten alguna clave (unión de conjuntos).
 * Devuelve personas con `emails` y `names` de todas sus identidades, para que se
 * pueda ver qué se ha fusionado y detectar una fusión mal hecha.
 */
export function mergeIdentities(people) {
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  people.forEach((p, i) => parent.set('p:' + i, 'p:' + i));
  const byKey = new Map();
  people.forEach((p, i) => {
    for (const k of identityKeys(p)) {
      if (!parent.has(k)) parent.set(k, k);
      union('p:' + i, k);
      if (byKey.has(k)) union('p:' + i, 'p:' + byKey.get(k));
      else byKey.set(k, i);
    }
  });

  const groups = new Map();
  people.forEach((p, i) => {
    const root = find('p:' + i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(p);
  });

  const merged = [];
  for (const group of groups.values()) {
    const seen = new Set();
    const out = {
      id: group[0].id,
      name: group[0].name,
      emails: [], names: [], created: [], modified: [],
      commits: 0, first: group[0].first, last: group[0].last,
    };
    for (const p of group) {
      if (p.email && !out.emails.includes(p.email)) out.emails.push(p.email);
      for (const n of p.names) if (!out.names.includes(n)) out.names.push(n);
      out.commits += p.commits;
      if (p.first < out.first) out.first = p.first;
      if (p.last > out.last) { out.last = p.last; out.name = p.name; }
      for (const c of p.created) { out.created.push(c); seen.add(c.id); }
      for (const m of p.modified) out.modified.push(m);
    }
    // Lo que una identidad creó no cuenta como modificado por otra de la misma persona.
    out.modified = out.modified.filter((m) => !seen.has(m.id));
    out.email = out.emails[0];
    merged.push(out);
  }
  return merged.sort((a, b) => b.created.length - a.created.length || b.commits - a.commits);
}
