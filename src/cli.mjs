import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { HOME, tilde } from './paths.mjs';
import { COMMON_ROOTS } from './discover.mjs';

export const USAGE = `Panel de Claude — ver y entender tu configuración de Claude Code

  claude-config-panel [opciones] [ruta/a/tus/repos ...]

Opciones:
  --port <n>     Puerto donde escuchar (por defecto 7337)
  --worktrees    Incluye los worktrees enlazados, omitidos por defecto
  -h, --help     Esta ayuda
  -v, --version  Versión

Sin rutas busca proyectos con carpeta .claude/ en las carpetas habituales
(~/code, ~/dev, ~/projects, ~/Desktop, ~/Documents...). También puedes
indicarlas con la variable de entorno CLAUDE_CFG_ROOTS, separadas por ':'.

Escucha sólo en 127.0.0.1 y guarda copia de cada fichero antes de modificarlo.`;

/** Carpetas habituales que existan de verdad en esta máquina. */
export function defaultRoots(home = HOME) {
  const found = COMMON_ROOTS.map((r) => join(home, r)).filter(existsSync);
  return found.length ? found : [home];
}

export function parseArgs(argv, env = {}) {
  const opts = { port: 7337, withWorktrees: false, help: false, version: false, scanRoots: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') { opts.port = Number(argv[++i]); continue; }
    if (a === '--worktrees') { opts.withWorktrees = true; continue; }
    if (a === '-h' || a === '--help') { opts.help = true; continue; }
    if (a === '-v' || a === '--version') { opts.version = true; continue; }
    if (a.startsWith('-')) throw new Error('Opción desconocida: ' + a);
    rest.push(a);
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
    throw new Error('Puerto inválido: usa un número entre 1 y 65535');
  }
  opts.scanRoots = rest.length ? rest
    : (env.CLAUDE_CFG_ROOTS ? env.CLAUDE_CFG_ROOTS.split(':') : defaultRoots());
  return opts;
}

export function startupMessage({ port, scanRoots }, { items, skipped }) {
  const lines = ['Panel de Claude  →  http://127.0.0.1:' + port];
  if (!items.length) {
    lines.push('No he encontrado configuración de Claude en ' + scanRoots.map(tilde).join(', '));
    lines.push('Pásale la ruta: claude-config-panel /ruta/a/tus/repos');
    return lines.join('\n');
  }
  lines.push('Piezas encontradas: ' + items.length +
    (skipped.length ? '  ·  ' + skipped.length + ' worktrees omitidos (--worktrees para incluirlos)' : ''));
  return lines.join('\n');
}
