// ~/.claude/mods for the local app. The reading is the artifact scanner's own
// (artifact/core.js readMods), so the two describe a mod the same way and apply
// the same secret redaction and exclusions.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CLAUDE } from './paths.mjs';
import { readMods, newContext, DEFAULT_EXCLUDE } from '../artifact/core.js';

const fsAdapter = {
  async list(h) {
    try {
      return readdirSync(h, { withFileTypes: true }).map((e) => {
        const full = join(h, e.name);
        let kind = e.isDirectory() ? 'dir' : e.isFile() ? 'file' : null;
        if (e.isSymbolicLink()) { try { kind = statSync(full).isDirectory() ? 'dir' : 'file'; } catch { kind = null; } }
        return kind ? { name: e.name, kind, h: full } : null;
      }).filter(Boolean);
    } catch { return []; }
  },
  async text(h) { return readFileSync(h, 'utf8'); },
  async meta(h) { const s = statSync(h); return { size: s.size, mtime: s.mtime.toISOString() }; },
};

/** @returns {Promise<object[]>} one record per folder in ~/.claude/mods */
export function discoverMods(claudeDir = CLAUDE) {
  const scope = { cdir: claudeDir, files: [{ rel: 'settings.json', h: join(claudeDir, 'settings.json') }] };
  return readMods(fsAdapter, scope, newContext(DEFAULT_EXCLUDE));
}
