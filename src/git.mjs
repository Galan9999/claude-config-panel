import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const remotes = new Map();

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** URL web del remoto `origin` si está en GitHub, o null. Cacheada por repo. */
export function gitRemote(repo) {
  if (remotes.has(repo)) return remotes.get(repo);
  let web = null;
  try {
    const m = /github\.com[:/](.+?)(?:\.git)?$/.exec(git(repo, ['remote', 'get-url', 'origin']));
    if (m) web = 'https://github.com/' + m[1];
  } catch { /* sin remoto, o sin git */ }
  remotes.set(repo, web);
  return web;
}

export function clearRemoteCache() { remotes.clear(); }

/**
 * Un worktree enlazado tiene .git como FICHERO, no como carpeta. Su configuración
 * es la misma del repo principal, así que por defecto no la contamos dos veces.
 */
export function isLinkedWorktree(dir) {
  const dotgit = join(dir, '.git');
  return existsSync(dotgit) && statSync(dotgit).isFile();
}
