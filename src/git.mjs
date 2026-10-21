import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const remotes = new Map();
const roots = new Map();

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** Web URL of the `origin` remote if it is on GitHub, else null. Cached per repo. */
export function gitRemote(repo) {
  if (remotes.has(repo)) return remotes.get(repo);
  let web = null;
  try {
    const m = /github\.com[:/](.+?)(?:\.git)?$/.exec(git(repo, ['remote', 'get-url', 'origin']));
    if (m) web = 'https://github.com/' + m[1];
  } catch { /* no remote, or no git */ }
  remotes.set(repo, web);
  return web;
}

export function clearRemoteCache() { remotes.clear(); roots.clear(); }

/**
 * Root of the repository containing `dir`, or null.
 *
 * This matters more than it looks: in a monorepo, `apps/web/.claude` is a
 * project as far as the panel is concerned but NOT a repo. And `git log
 * --numstat` prints paths relative to the root, so to match history against
 * files you have to speak in the root's coordinates, not the package's.
 */
export function repoRoot(dir) {
  if (roots.has(dir)) return roots.get(dir);
  let root = null;
  try { root = git(dir, ['rev-parse', '--show-toplevel']) || null; } catch { /* not a repo */ }
  roots.set(dir, root);
  return root;
}

/**
 * A linked worktree has .git as a FILE, not a folder. Its configuration is the
 * main repo's, so by default we do not count it twice.
 */
export function isLinkedWorktree(dir) {
  const dotgit = join(dir, '.git');
  return existsSync(dotgit) && statSync(dotgit).isFile();
}
