import { readdirSync, readFileSync } from 'node:fs';

/** readdir that returns [] instead of throwing: some folders we cannot read. */
export function ls(dir) {
  try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

/** readFile that returns '' instead of throwing. */
export function read(p) {
  try { return readFileSync(p, 'utf8'); } catch { return ''; }
}

/**
 * Reads the YAML frontmatter of a .md file. Single-line `key: value` pairs only,
 * which is all Claude Code skills and agents use.
 */
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * A script's leading comment lines are its documentation.
 * Skips the shebang and stops at the first line of code.
 */
export function scriptDoc(text) {
  const out = [];
  for (const l of text.split(/\r?\n/)) {
    if (/^#!/.test(l)) continue;
    const m = /^\s*(?:#|\/\/)\s?(.*)$/.exec(l);
    if (m) { out.push(m[1]); continue; }
    if (!l.trim() && out.length === 0) continue;
    break;
  }
  return out.join(' ').trim();
}
