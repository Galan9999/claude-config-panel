import { homedir } from 'node:os';
import { join } from 'node:path';

export const HOME = homedir();
export const CLAUDE = join(HOME, '.claude');
export const BACKUPS = join(CLAUDE, 'backups', 'config-dashboard');

/** Shortens /Users/someone/x to ~/x for display. */
export const tilde = (p) => p.replace(HOME, '~');
