import { homedir } from 'node:os';
import { join } from 'node:path';

export const HOME = homedir();
export const CLAUDE = join(HOME, '.claude');
export const BACKUPS = join(CLAUDE, 'backups', 'config-dashboard');

/** Acorta /Users/alguien/x a ~/x para enseñarlo por pantalla. */
export const tilde = (p) => p.replace(HOME, '~');
