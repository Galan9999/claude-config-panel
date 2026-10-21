import { readdirSync, readFileSync } from 'node:fs';

/** readdir que devuelve [] en vez de lanzar: hay carpetas que no podemos leer. */
export function ls(dir) {
  try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

/** readFile que devuelve '' en vez de lanzar. */
export function read(p) {
  try { return readFileSync(p, 'utf8'); } catch { return ''; }
}

/**
 * Lee el frontmatter YAML de un .md. Sólo pares `clave: valor` de una línea,
 * que es todo lo que usan las skills y los agentes de Claude Code.
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
 * Las primeras líneas de comentario de un script son su documentación.
 * Se salta el shebang y para en la primera línea de código.
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
