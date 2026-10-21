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
    for (const l of rest) {
      const m = /^(\d+|-)\t(\d+|-)\t/.exec(l);
      if (!m) continue;
      if (m[1] !== '-') added += Number(m[1]);
      if (m[2] !== '-') removed += Number(m[2]);
    }
    commits.push({ hash, author, email, date, subject: subject.join(FLD), added, removed });
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
