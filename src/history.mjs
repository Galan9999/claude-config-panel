// Who created and who has touched each piece of configuration.
//
// There is only an answer for what is versioned. ~/.claude is not a repo and the
// settings.local.json files are gitignored, so for those nothing beyond the file
// timestamp is knowable. Better to say so than to invent an author.

import { execFileSync } from 'node:child_process';

const REC = '\x1e'; // commit separator
const FLD = '\x1f'; // field separator

/**
 * Turns `git log --numstat` output into history. Kept separate from the git call
 * so it can be tested without building a repo.
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

/** Summarises a list of commits: who created it, who last touched it. */
export function summarize(commits) {
  if (!commits.length) return null;
  const byAuthor = new Map();
  for (const c of commits) byAuthor.set(c.author, (byAuthor.get(c.author) || 0) + 1);
  return {
    // git log comes newest first: the creator is the last one.
    creator: { author: commits.at(-1).author, date: commits.at(-1).date },
    lastChange: commits[0],
    commits: commits.length,
    authors: [...byAuthor].map(([author, n]) => ({ author, commits: n }))
      .sort((a, b) => b.commits - a.commits),
  };
}

/**
 * History of one file inside a repo.
 * @returns {{tracked: boolean, reason?: string, history?: object, changes?: object[]}}
 */
export function fileHistory(repo, relPath, limit = 10) {
  if (!repo || !relPath) return { tracked: false, reason: 'outside a repository' };
  let out;
  try {
    out = execFileSync('git', ['-C', repo, 'log', '--follow', '--numstat',
      '--format=' + REC + '%H' + FLD + '%an' + FLD + '%ae' + FLD + '%aI' + FLD + '%s',
      '-n', String(limit), '--', relPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 4e6 });
  } catch {
    return { tracked: false, reason: 'git could not read the history' };
  }
  const commits = parseGitLog(out);
  if (!commits.length) {
    return { tracked: false, reason: 'not tracked by git (new or ignored)' };
  }
  return { tracked: true, history: summarize(commits), changes: commits };
}

/* ---------- authorship for a whole repo in one pass ---------- */

const indexes = new Map(); // repo -> { head, index }

/**
 * One `git log` per file costs 60 ms. With 177 pieces that is too much, so the
 * whole history under `.claude` is asked for at once and indexed by path.
 * `--no-renames` is used: following renames only works file by file, and for a
 * person's profile what matters is who brought the piece in as it stands today.
 * The detail view does use `--follow`, which is more precise.
 *
 * @returns {Map<string, object[]>} relative path -> commits, newest first
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
 * Groups pieces by person.
 *
 * "Created" means the oldest commit touching that path is theirs; everyone else
 * who touched it counts as a modification. People are keyed by email, because
 * the same human shows up under several names depending on the machine they
 * committed from.
 *
 * @param {object[]} items pieces with repo and relPath
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

/* ---------- merging the same person ---------- */

const GENERIC = new Set(['admin', 'dev', 'developer', 'git', 'github', 'info', 'mail',
  'me', 'noreply', 'root', 'user', 'users', 'test', 'ci', 'bot', 'action', 'actions']);

const normName = (n) => (n || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * The keys by which two identities are the same person.
 *
 * Needed because the same human commits from different places: the work email,
 * `12345+user@users.noreply.github.com` when editing on the web, and
 * `user@MacBook-Air.local` from an unconfigured laptop. None of them shares an
 * email with the others, so email alone never merges them.
 */
export function identityKeys({ email = '', names = [] }) {
  const keys = new Set();
  const mail = email.toLowerCase().trim();
  if (mail) keys.add('e:' + mail);
  // The local part of an address is a name too: "alex@MacBook-Air.local" pulls
  // the same thread as an author called "alex".
  const local = mail.split('@')[0].replace(/^\d+\+/, '');
  if (local && !GENERIC.has(local)) keys.add('n:' + normName(local));
  for (const n of names) {
    const k = normName(n);
    if (k && !GENERIC.has(k)) keys.add('n:' + k);
  }
  return [...keys];
}

/**
 * Merges identities sharing any key (union-find). Returns people carrying the
 * `emails` and `names` of all their identities, so a bad merge can be spotted
 * rather than trusted.
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
    // What one identity created does not count as modified by another of the same person.
    out.modified = out.modified.filter((m) => !seen.has(m.id));
    out.email = out.emails[0];
    merged.push(out);
  }
  return merged.sort((a, b) => b.created.length - a.created.length || b.commits - a.commits);
}
