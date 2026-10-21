import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { HOME, tilde } from './paths.mjs';
import { COMMON_ROOTS, DEFAULT_DEPTH } from './discover.mjs';

export const USAGE = `Claude Config Panel — see and understand your Claude Code setup

  claude-config-panel [options] [path/to/your/repos ...]

Options:
  --port <n>     Port to listen on (default 7337)
  --depth <n>    How deep to look for .claude/ folders (default ${DEFAULT_DEPTH})
  --worktrees    Include linked worktrees, skipped by default
  -h, --help     This help
  -v, --version  Version

With no paths it looks for projects with a .claude/ folder in the usual places
(~/code, ~/dev, ~/projects, ~/Desktop, ~/Documents...). You can also set them
with the CLAUDE_CFG_ROOTS environment variable, separated by ':'.

Listens on 127.0.0.1 only, and backs up every file before modifying it.`;

/** The usual project folders that actually exist on this machine. */
export function defaultRoots(home = HOME) {
  const found = COMMON_ROOTS.map((r) => join(home, r)).filter(existsSync);
  return found.length ? found : [home];
}

export function parseArgs(argv, env = {}) {
  const opts = { port: 7337, withWorktrees: false, depth: DEFAULT_DEPTH,
    help: false, version: false, scanRoots: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') { opts.port = Number(argv[++i]); continue; }
    if (a === '--worktrees') { opts.withWorktrees = true; continue; }
    if (a === '--depth') { opts.depth = Number(argv[++i]); continue; }
    if (a === '-h' || a === '--help') { opts.help = true; continue; }
    if (a === '-v' || a === '--version') { opts.version = true; continue; }
    if (a.startsWith('-')) throw new Error('Unknown option: ' + a);
    rest.push(a);
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
    throw new Error('Invalid port: use a number between 1 and 65535');
  }
  if (!Number.isInteger(opts.depth) || opts.depth < 1 || opts.depth > 12) {
    throw new Error('Invalid depth: use a number between 1 and 12');
  }
  opts.scanRoots = rest.length ? rest
    : (env.CLAUDE_CFG_ROOTS ? env.CLAUDE_CFG_ROOTS.split(':') : defaultRoots());
  return opts;
}

export function startupMessage({ port, scanRoots }, { items, skipped }) {
  const lines = ['Claude Config Panel  →  http://127.0.0.1:' + port];
  if (!items.length) {
    lines.push('No Claude configuration found in ' + scanRoots.map(tilde).join(', '));
    lines.push('Point it somewhere: claude-config-panel /path/to/your/repos');
    return lines.join('\n');
  }
  lines.push('Pieces found: ' + items.length +
    (skipped.length ? '  ·  ' + skipped.length + ' worktrees skipped (--worktrees to include them)' : ''));
  return lines.join('\n');
}
