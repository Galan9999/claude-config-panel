// Snapshot core: turns a folder tree into a redacted, shareable description of
// someone's Claude Code setup.
//
// The same file runs in two places: in the browser, when a person drops their
// folders on the artifact page, and in Node, inside the optional collector. Both
// hand it a tiny file-system adapter, so both produce exactly the same JSON.
// Nothing here touches the network.
//
// Privacy is decided here and only here:
//  - settings files are never copied: permissions, hooks, MCP names and env KEY
//    names are extracted, every value goes through `redact`;
//  - the global CLAUDE.md and every settings.local.json contribute metadata only;
//  - text that does travel (skills, agents, commands, hook scripts) is redacted
//    by pattern and capped;
//  - anything whose path or name matches an exclusion pattern is dropped, and
//    only the pattern and a count are recorded, never the name.

import { describeMod, modActive, splitPluginDirs } from './mods.js';

export const SCHEMA = 'ccp-snapshot/1';
export const VERSION = '1.0.0';

/** Folders that never hold configuration and are expensive to walk. */
export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor',
  'coverage', '.turbo', 'tmp', '.venv', 'venv', '__pycache__', '.cache', 'Library', '.Trash',
  '.npm', '.pnpm-store', 'Pods', 'target']);

/** Inside ~/.claude only these entries are ever opened. */
const GLOBAL_KEEP = new Set(['settings.json', 'settings.local.json', 'CLAUDE.md', 'skills',
  'agents', 'commands', 'scheduled-tasks', 'hooks', 'scripts', 'mods', 'projects']);

/** Matched, case-insensitive, against scope folders, piece paths and names. */
export const DEFAULT_EXCLUDE = ['gmail', 'correo', 'personal', 'formaci', 'vueling',
  '\\.bak', '\\.log$', '\\.save$', '\\.pre-', '\\.orig$', 'backups?/'];

export const MAX_TEXT = 40000;   // characters of one piece that travel
const MAX_READ = 600000;         // bytes: bigger files are listed, not read
export const DEFAULT_DEPTH = 6;

/* ------------------------------------------------------------------ redaction */

const looksSecret = (v) => v.length >= 16 || /\d/.test(v);
const mixed = (v) => /\d/.test(v) && /[a-z]/.test(v) && /[A-Z]/.test(v);

const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, () => '[redacted:private-key]'],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, () => '[redacted:anthropic-key]'],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, () => '[redacted:api-key]'],
  [/\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}/g, () => '[redacted:github-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, () => '[redacted:github-token]'],
  [/\bglpat-[A-Za-z0-9_-]{16,}/g, () => '[redacted:gitlab-token]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, () => '[redacted:slack-token]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, () => '[redacted:aws-key]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, () => '[redacted:google-key]'],
  [/\b(?:ntn|secret)_[A-Za-z0-9]{30,}/g, () => '[redacted:notion-token]'],
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g, () => '[redacted:stripe-key]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, () => '[redacted:jwt]'],
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/g, (m, k) => k + ' [redacted]'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@'"]+:[^\s/@'"]+@/gi, (m, s) => s + '[redacted]@'],
  // key = value, key: value, "key": "value" for anything that names a secret
  [/((?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|token|secret|client[_-]?secret|password|passwd|pwd|private[_-]?key|access[_-]?key|credentials?)["']?\s*[:=]\s*["']?)([^\s"'`,;)}]+)/gi,
    (m, k, v) => (looksSecret(v) ? k + '[redacted]' : m)],
  // UPPER_CASE env assignments whose name looks sensitive: FOO_TOKEN=abc
  [/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PAT|DSN|CREDENTIALS?)=)(\S+)/g, (m, k) => k + '[redacted]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => (/\.(png|jpe?g|svg|gif|webp)$/i.test(m) ? m : '[email]')],
  [/\b[A-Fa-f0-9]{32,}\b/g, () => '[redacted:hex]'],
  [/\b[A-Za-z0-9_-]{36,}\b/g, (m) => (mixed(m) ? '[redacted:token]' : m)],
  // a home folder names the person: /Users/jane/x -> ~/x
  [/(?:\/Users|\/home)\/[^/\s"'`]+/g, () => '~'],
  [/[A-Z]:\\Users\\[^\\\s"'`]+/g, () => '~'],
  // the same home folder, as Claude Code encodes it in project folder names
  [/-(?:Users|home)-[A-Za-z0-9._]+/g, () => '-~'],
];

/** Redacts one string. `stats.redactions` counts what was replaced. */
export function redact(text, stats) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const [re, fn] of PATTERNS) {
    out = out.replace(re, (...args) => {
      const r = fn(...args);
      if (r !== args[0] && stats && !/^~/.test(r)) stats.redactions += 1;
      return r;
    });
  }
  return out;
}

/** A short, stable fingerprint (cyrb53) — identical in Node and the browser. */
export function fingerprint(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export function compilePatterns(list) {
  return (list || []).map((p) => String(p).trim()).filter(Boolean).map((p) => {
    try { return { src: p, re: new RegExp(p, 'i') }; } catch { return { src: p, re: new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }; }
  });
}

/** The first pattern a string matches, or null. */
export function excludedBy(str, compiled) {
  for (const p of compiled) if (p.re.test(str)) return p.src;
  return null;
}

/* ----------------------------------------------------------- reading pieces */

/** YAML frontmatter, single-line `key: value` pairs only. */
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || '');
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/** A script's leading comment lines are its documentation. */
export function scriptDoc(text) {
  const out = [];
  for (const l of (text || '').split(/\r?\n/)) {
    if (/^#!/.test(l)) continue;
    const m = /^\s*(?:#|\/\/)\s?(.*)$/.exec(l);
    if (m) { out.push(m[1]); continue; }
    if (!l.trim() && out.length === 0) continue;
    break;
  }
  return out.join(' ').trim();
}

const lineCount = (t) => (t ? t.split(/\r?\n/).length : 0);
const cap = (t) => (t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '\n\n[… cut at ' + MAX_TEXT + ' characters]' : t);

/* ------------------------------------------------------------------ settings */

const strs = (a, stats) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').map((x) => redact(x, stats)) : []);

/** Like `strs`, dropping (and counting) the entries an exclusion pattern matches. */
function kept(a, stats, compiled, excluded) {
  return strs((Array.isArray(a) ? a : []).filter((x) => {
    const w = typeof x === 'string' && excludedBy(x, compiled);
    if (w) excluded(w);
    return !w;
  }), stats);
}

/** The parts of an MCP server definition worth auditing; values never travel. */
export function mcpServer(name, def, stats) {
  def = def && typeof def === 'object' ? def : {};
  let url = null;
  if (typeof def.url === 'string') {
    try { const u = new URL(def.url); url = u.origin + (u.pathname !== '/' ? '/…' : ''); } catch { url = '[unparsed url]'; }
  }
  const cmd = typeof def.command === 'string' ? redact(def.command, stats) : null;
  return {
    name,
    type: def.type || (url ? 'http' : cmd ? 'stdio' : null),
    command: cmd,
    args: strs(def.args, stats).map((a) => (a.length > 120 ? a.slice(0, 120) + '…' : a)),
    url,
    envKeys: def.env && typeof def.env === 'object' ? Object.keys(def.env) : [],
    headerKeys: def.headers && typeof def.headers === 'object' ? Object.keys(def.headers) : [],
  };
}

/**
 * Everything auditable in a settings.json, and nothing else. Unknown keys are
 * listed by name so the audit knows they exist without seeing their values.
 */
export function extractSettings(json, stats, compiled, excluded) {
  const s = json && typeof json === 'object' ? json : {};
  const p = s.permissions || {};
  const hooks = [];
  for (const [event, groups] of Object.entries(s.hooks || {})) {
    for (const g of Array.isArray(groups) ? groups : []) {
      for (const h of (g && Array.isArray(g.hooks) ? g.hooks : [])) {
        const w = excludedBy(String(g.matcher || ''), compiled) || excludedBy(String(h.command || h.prompt || ''), compiled);
        if (w) { excluded(w); continue; }
        hooks.push({ event, matcher: g.matcher ?? null, type: h.type || 'command',
          command: redact(String(h.command || h.prompt || ''), stats),
          timeout: typeof h.timeout === 'number' ? h.timeout : null, async: h.async === true });
      }
    }
  }
  const mcp = [];
  for (const [name, def] of Object.entries(s.mcpServers || {})) {
    const why = excludedBy(name, compiled);
    if (why) { excluded(why); continue; }
    mcp.push(mcpServer(name, def, stats));
  }
  const am = s.autoMode && typeof s.autoMode === 'object' ? s.autoMode : null;
  const KNOWN = new Set(['permissions', 'hooks', 'mcpServers', 'autoMode', 'env', 'model',
    'enabledPlugins', 'statusLine', 'enabledMcpjsonServers', 'disabledMcpjsonServers',
    'enableAllProjectMcpServers', 'includeCoAuthoredBy', 'outputStyle', 'theme']);
  return {
    permissions: {
      defaultMode: p.defaultMode || null,
      allow: kept(p.allow, stats, compiled, excluded), ask: kept(p.ask, stats, compiled, excluded),
      deny: kept(p.deny, stats, compiled, excluded),
      additionalDirectories: kept(p.additionalDirectories, stats, compiled, excluded),
    },
    autoMode: am ? {
      classifyAllShell: am.classifyAllShell === true,
      environment: strs(am.environment, stats), allow: strs(am.allow, stats),
      soft_deny: strs(am.soft_deny, stats), hard_deny: strs(am.hard_deny, stats), deny: strs(am.deny, stats),
    } : null,
    hooks,
    mcp,
    envKeys: s.env && typeof s.env === 'object' ? Object.keys(s.env) : [],
    model: typeof s.model === 'string' ? s.model : null,
    enabledPlugins: s.enabledPlugins && typeof s.enabledPlugins === 'object'
      ? Object.entries(s.enabledPlugins).filter(([, v]) => v).map(([k]) => k)
        .filter((k) => !excludedBy(k, compiled)) : [],
    enabledMcpjsonServers: kept(s.enabledMcpjsonServers, stats, compiled, excluded),
    statusLine: s.statusLine && s.statusLine.command ? redact(String(s.statusLine.command), stats) : null,
    otherKeys: Object.keys(s).filter((k) => !KNOWN.has(k)),
  };
}

/* ------------------------------------------------------------------ the walk */
//
// fs adapter, provided by the caller:
//   list(h)   -> Promise<[{name, kind: 'dir'|'file', h}]>
//   text(h)   -> Promise<string>
//   meta(h)   -> Promise<{size, mtime}>
//   chunks(h) -> AsyncIterable<string>        (only used for transcripts)

const MD_KINDS = { skills: 'skill', agents: 'agent', commands: 'command', 'scheduled-tasks': 'task' };
const INNER = ['SKILL.md', 'AGENT.md', 'index.md'];

async function listMap(fs, h) {
  const m = new Map();
  for (const e of await fs.list(h)) m.set(e.name, e);
  return m;
}

/** Reads one claude folder (global or a project's .claude). */
async function readClaudeDir(fs, cdir, isGlobal) {
  const files = [];   // {rel, kind, name, h}
  const top = await listMap(fs, cdir);
  for (const f of ['settings.json', 'settings.local.json', 'CLAUDE.md']) {
    const e = top.get(f);
    if (e && e.kind === 'file') files.push({ rel: f, kind: 'config', name: f, h: e.h });
  }
  for (const [dir, kind] of Object.entries(MD_KINDS)) {
    if (kind === 'task' && !isGlobal) continue;
    const d = top.get(dir);
    if (!d || d.kind !== 'dir') continue;
    for (const e of await fs.list(d.h)) {
      if (e.kind === 'file' && e.name.endsWith('.md')) {
        files.push({ rel: dir + '/' + e.name, kind, name: e.name.replace(/\.md$/, ''), h: e.h });
        continue;
      }
      if (e.kind !== 'dir') continue;
      const inside = await listMap(fs, e.h);
      const inner = [...INNER, e.name + '.md'].find((n) => inside.has(n) && inside.get(n).kind === 'file');
      if (inner) {
        files.push({ rel: dir + '/' + e.name + '/' + inner, kind, name: e.name, h: inside.get(inner).h,
          extra: [...inside.keys()].filter((n) => n !== inner) });
        continue;
      }
      for (const [n, sub] of inside) {
        if (sub.kind === 'file' && n.endsWith('.md')) {
          files.push({ rel: dir + '/' + e.name + '/' + n, kind, name: e.name + ':' + n.replace(/\.md$/, ''), h: sub.h });
        }
      }
    }
  }
  for (const dir of ['hooks', 'scripts']) {
    const d = top.get(dir);
    if (!d || d.kind !== 'dir') continue;
    for (const e of await fs.list(d.h)) {
      if (e.kind === 'file') files.push({ rel: dir + '/' + e.name, kind: 'hook', name: dir + '/' + e.name, h: e.h });
    }
  }
  return { files, projects: isGlobal && top.get('projects') && top.get('projects').kind === 'dir' ? top.get('projects').h : null };
}

/** A ~/.claude is told apart from a project's .claude by what only it holds. */
function looksGlobal(m) {
  return m.has('projects') || m.has('history.jsonl') || m.has('sessions') || m.has('plugins') || m.has('statsig');
}

function remoteFrom(gitConfig) {
  const m = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(gitConfig || '');
  if (!m) return null;
  const gh = /github\.com[:/](.+?)(?:\.git)?$/.exec(m[1]);
  if (gh) return 'https://github.com/' + gh[1];
  return m[1].replace(/\/\/[^@/]+@/, '//').replace(/\.git$/, '');
}

/**
 * Finds every Claude configuration under the given roots.
 *
 * @param roots [{h, name, label}] — `label` is how the root is shown (a path
 *   with ~, or just the folder name in the browser)
 * @returns raw scopes (still holding file handles) plus benches and transcripts
 */
export async function discoverRoots(fs, roots, { depth = DEFAULT_DEPTH, onProgress } = {}) {
  const scopes = [], benches = [];
  let transcripts = null, seen = 0;

  async function asGlobal(h, label) {
    const r = await readClaudeDir(fs, h, true);
    scopes.push({ label: '~/.claude', isGlobal: true, base: null, cdir: h, files: r.files, remote: null, rootLabel: label });
    if (r.projects) transcripts = r.projects;
  }

  async function walk(h, label, d, remote) {
    const m = await listMap(fs, h);
    seen += 1;
    if (onProgress && seen % 50 === 0) onProgress({ folders: seen });
    const git = m.get('.git');
    if (git && git.kind === 'file' && d < depth) return;          // linked worktree: its config is the main repo's
    if (git && git.kind === 'dir') {
      const g = await listMap(fs, git.h);
      if (g.get('config')) remote = remoteFrom(await fs.text(g.get('config').h)) || remote;
    }
    if (m.get('.claude-plugin') && m.get('evals') && m.get('evals').kind === 'dir') {
      benches.push({ label, h, m });
      return;
    }
    const c = m.get('.claude');
    if (c && c.kind === 'dir') {
      const inner = await listMap(fs, c.h);
      if (looksGlobal(inner)) await asGlobal(c.h, label + '/.claude');
      else {
        const r = await readClaudeDir(fs, c.h, false);
        const extra = [];
        if (m.get('CLAUDE.md') && m.get('CLAUDE.md').kind === 'file') extra.push({ rel: 'CLAUDE.md', kind: 'config', name: 'CLAUDE.md', h: m.get('CLAUDE.md').h, root: true });
        if (m.get('.mcp.json') && m.get('.mcp.json').kind === 'file') extra.push({ rel: '.mcp.json', kind: 'mcpjson', name: '.mcp.json', h: m.get('.mcp.json').h, root: true });
        scopes.push({ label, isGlobal: false, base: h, cdir: c.h, remote,
          files: [...r.files.map((f) => ({ ...f, rel: '.claude/' + f.rel })), ...extra] });
      }
    }
    if (d <= 0) return;
    for (const [name, e] of m) {
      if (e.kind !== 'dir' || name === '.claude' || SKIP_DIRS.has(name)) continue;
      if (name.startsWith('.') && name !== '.config') continue;
      await walk(e.h, label + '/' + name, d - 1, remote);
    }
  }

  for (const r of roots) {
    if (r.name === '.claude') {
      const m = await listMap(fs, r.h);
      if (looksGlobal(m)) { await asGlobal(r.h, r.label); continue; }
      // A project's .claude dropped on its own: the project is its parent, unknown here.
      const res = await readClaudeDir(fs, r.h, false);
      scopes.push({ label: r.label.replace(/\/?\.claude$/, '') || '(a project)', isGlobal: false, base: null, cdir: r.h,
        remote: null, files: res.files.map((f) => ({ ...f, rel: '.claude/' + f.rel })) });
      continue;
    }
    await walk(r.h, r.label, depth, null);
  }
  return { scopes, benches, transcripts };
}

/* --------------------------------------------------------------- the pieces */

/**
 * Reads and redacts the files of one scope.
 * @returns {{label, kind, remote, settings[], mcp[], items[]}} or null when excluded
 */
export async function readScope(fs, scope, ctx) {
  const { stats, compiled, excluded } = ctx;
  const whole = scope.isGlobal ? null : excludedBy(scope.label, compiled);
  if (whole) { excluded(whole); return null; }
  const items = [], settings = [], mcp = [];
  for (const f of scope.files) {
    const why = excludedBy(f.rel, compiled) || excludedBy(f.name, compiled);
    if (why) { excluded(why); continue; }
    const meta = await fs.meta(f.h).catch(() => ({ size: 0, mtime: null }));
    const big = meta.size > MAX_READ;
    const raw = big ? '' : await fs.text(f.h).catch(() => '');
    const base = { kind: f.kind, name: f.name, path: f.rel, size: meta.size, mtime: meta.mtime, lines: lineCount(raw) };

    if (f.kind === 'mcpjson') {
      try {
        const j = JSON.parse(raw);
        for (const [name, def] of Object.entries(j.mcpServers || {})) {
          const w = excludedBy(name, compiled);
          if (w) { excluded(w); continue; }
          mcp.push({ ...mcpServer(name, def, stats), source: '.mcp.json' });
        }
      } catch { /* unreadable .mcp.json: nothing to report */ }
      continue;
    }
    if (f.kind === 'config' && f.name.endsWith('.json')) {
      let j = null;
      try { j = JSON.parse(raw); } catch { /* reported below */ }
      const s = j ? extractSettings(j, stats, compiled, excluded) : null;
      if (s) {
        settings.push({ file: f.name, path: f.rel, local: f.name === 'settings.local.json', ...s });
        for (const m of s.mcp) mcp.push({ ...m, source: f.rel });
      }
      items.push({ ...base, title: f.name, description: j ? '' : 'Could not be parsed as JSON.', metaOnly: true });
      continue;
    }
    if (f.kind === 'config') {   // CLAUDE.md
      const metaOnly = scope.isGlobal;
      items.push({ ...base, title: f.name, description: metaOnly ? 'Global instructions: only the size travels.' : '',
        metaOnly, content: metaOnly ? undefined : cap(redact(raw, stats)),
        headings: metaOnly ? undefined : (raw.match(/^#{1,3} .+$/gm) || []).slice(0, 40).map((x) => redact(x, stats)) });
      continue;
    }
    if (f.kind === 'hook') {
      items.push({ ...base, title: f.name.split('/').pop(), description: redact(scriptDoc(raw), stats),
        content: big ? undefined : cap(redact(raw, stats)), fingerprint: raw ? fingerprint(raw) : null });
      continue;
    }
    const fm = frontmatter(raw);
    const meta2 = {};
    for (const [k, v] of Object.entries(fm)) meta2[k] = redact(v, stats);
    items.push({ ...base, title: meta2.name || f.name, description: meta2.description || '', meta: meta2,
      content: cap(redact(raw, stats)), fingerprint: raw ? fingerprint(raw) : null,
      extraFiles: f.extra ? f.extra.filter((n) => !excludedBy(n, compiled)).slice(0, 30) : undefined });
  }
  const mods = scope.isGlobal ? await readMods(fs, scope, ctx) : [];
  return { label: scope.label, kind: scope.isGlobal ? 'global' : 'project', remote: scope.remote,
    settings, mcp, items, mods };
}

/* ---------------------------------------------------------------------- mods */

const MOD_FILES_MAX = 120;

/** Every file inside a mod, relative, without the junk that is not the mod's own. */
async function modFiles(fs, h, rel, depth, out, ctx) {
  for (const e of await fs.list(h)) {
    if (out.length >= MOD_FILES_MAX) return;
    if (SKIP_DIRS.has(e.name) || e.name === 'types' || e.name.endsWith('.pyc') || e.name === '.DS_Store') continue;
    const path = rel ? rel + '/' + e.name : e.name;
    const why = excludedBy(path, ctx.compiled);
    if (why) { ctx.excluded(why); continue; }
    if (e.kind === 'file') out.push(path);
    else if (depth > 0) await modFiles(fs, e.h, path, depth - 1, out, ctx);
  }
}

/**
 * Reads ~/.claude/mods/*: what each mod is and what it registers. The module's
 * source is read to find that out but never travels; only names do, and every
 * string goes through `redact` like the rest.
 */
export async function readMods(fs, scope, ctx) {
  const { stats, compiled, excluded } = ctx;
  const top = await listMap(fs, scope.cdir);
  const root = top.get('mods');
  if (!root || root.kind !== 'dir') return [];
  // Which folders does the user's own settings load?
  let pluginDirs = [], enabled = {};
  const st = (scope.files || []).find((f) => f.rel === 'settings.json');
  if (st) {
    try {
      const j = JSON.parse(await fs.text(st.h));
      pluginDirs = splitPluginDirs(j.env && j.env.CLAUDE_CODE_PLUGIN_DIRS);
      enabled = (j.enabledPlugins && typeof j.enabledPlugins === 'object') ? j.enabledPlugins : {};
    } catch { /* unreadable settings: nothing is marked active */ }
  }
  const text = async (e) => {
    const m = await fs.meta(e.h).catch(() => ({ size: 0 }));
    return m.size > MAX_READ ? '' : fs.text(e.h).catch(() => '');
  };
  const mods = [];
  for (const d of await fs.list(root.h)) {
    if (d.kind !== 'dir' || d.name.startsWith('.')) continue;
    const why = excludedBy('mods/' + d.name, compiled);
    if (why) { excluded(why); continue; }
    const m = await listMap(fs, d.h);
    const cp = m.get('.claude-plugin') && m.get('.claude-plugin').kind === 'dir' ? await listMap(fs, m.get('.claude-plugin').h) : new Map();
    let manifest = null;
    if (cp.get('plugin.json')) { try { manifest = JSON.parse(await text(cp.get('plugin.json'))); } catch { manifest = null; } }
    const hooksDir = m.get('hooks') && m.get('hooks').kind === 'dir' ? await listMap(fs, m.get('hooks').h) : new Map();
    let modules = [];
    if (hooksDir.get('hooks.json')) {
      try { const hj = JSON.parse(await text(hooksDir.get('hooks.json'))); modules = Array.isArray(hj.modules) ? hj.modules : []; } catch { /* no modules */ }
    }
    const sources = [];
    for (const mod of modules.slice(0, 5)) {
      const e = hooksDir.get(String(mod).replace(/^\.\/+/, ''));
      if (e && e.kind === 'file') sources.push(await text(e));
    }
    const cmdDir = m.get('commands') && m.get('commands').kind === 'dir' ? await fs.list(m.get('commands').h) : [];
    const commandFiles = cmdDir.filter((e) => e.kind === 'file' && e.name.endsWith('.md')).map((e) => e.name.replace(/\.md$/, ''));
    const files = [];
    await modFiles(fs, d.h, '', 3, files, ctx);
    const name = (manifest && manifest.name) || d.name;
    const act = modActive(d.name, name, pluginDirs, enabled);
    const r = describeMod({ dir: d.name, manifest, sources, commandFiles, files, active: act.active, activeVia: act.via });
    const rd = (v) => redact(v, stats);
    mods.push({ ...r, name: rd(r.name), dir: rd(r.dir), description: rd(r.description), version: r.version && rd(String(r.version)),
      hooks: r.hooks.map((x) => ({ ...x, event: rd(x.event) })), commands: r.commands.map(rd), tools: r.tools.map(rd),
      files: r.files.map(rd) });
  }
  return mods.sort((a, b) => (a.active === b.active ? (a.name < b.name ? -1 : 1) : a.active ? -1 : 1));
}

/* --------------------------------------------------------------------- usage */

const RX = {
  skill: /"name":"Skill","input":\{"skill":"([^"]+)"/g,
  tool: /"type":"tool_use","id":"[^"]*","name":"([^"]+)"/g,
  agent: /"subagent_type":"([^"]+)"/g,
  command: /<command-name>\/?([^<\s]+)<\/command-name>/g,
  ts: /"timestamp":"([^"]+)"/,
  cwd: /"cwd":"([^"]+)"/,
};

function bump(map, key, when) {
  const r = map.get(key) || { calls: 0, sessions: 0, last: null };
  r.calls += 1;
  if (when && (!r.last || when > r.last)) r.last = when;
  map.set(key, r);
  return r;
}

/** Usage of one transcript, from its lines. */
export function scanTranscriptText(text, acc) {
  for (const line of text.split('\n')) {
    if (!line) continue;
    const when = acc.needTs || line.includes('"name":"Skill"') ? (RX.ts.exec(line) || [])[1] : null;
    if (when) {
      if (!acc.first || when < acc.first) acc.first = when;
      if (!acc.last || when > acc.last) acc.last = when;
      acc.needTs = false;
    }
    if (!acc.cwd) { const c = RX.cwd.exec(line); if (c) acc.cwd = c[1]; }
    if (line.includes('"tool_use"')) {
      for (const m of line.matchAll(RX.tool)) bump(acc.tools, m[1], when);
      if (line.includes('"name":"Skill"')) for (const m of line.matchAll(RX.skill)) bump(acc.skills, m[1], when);
      if (line.includes('"subagent_type"')) for (const m of line.matchAll(RX.agent)) bump(acc.agents, m[1], when);
    }
    if (line.includes('<command-name>') && line.includes('"type":"user"')) {
      for (const m of line.matchAll(RX.command)) bump(acc.commands, m[1], when);
    }
  }
}

export function newTranscriptAcc() {
  return { skills: new Map(), tools: new Map(), agents: new Map(), commands: new Map(), cwd: null, first: null, last: null, needTs: true };
}

/** Lists transcripts under ~/.claude/projects: top-level files are sessions. */
export async function listTranscripts(fs, projectsH) {
  const out = [];
  async function rec(h, depth, project) {
    for (const e of await fs.list(h)) {
      if (e.kind === 'dir') await rec(e.h, depth + 1, project ?? e.name);
      else if (e.name.endsWith('.jsonl')) out.push({ h: e.h, project, sub: depth > 1 });
    }
  }
  await rec(projectsH, 0, null);
  return out;
}

/**
 * Reads every transcript in chunks and keeps only counts.
 * `shouldStop()` lets the page cancel a long scan.
 */
export async function scanUsage(fs, files, { onProgress, shouldStop } = {}) {
  const sessions = [];
  const all = { skills: new Map(), tools: new Map(), agents: new Map(), commands: new Map() };
  let done = 0, bytes = 0;
  for (const f of files) {
    if (shouldStop && shouldStop()) break;
    const acc = newTranscriptAcc();
    let carry = '';
    try {
      for await (const chunk of fs.chunks(f.h)) {
        bytes += chunk.length;
        const text = carry + chunk;
        const cut = text.lastIndexOf('\n');
        if (cut < 0) { carry = text; continue; }
        scanTranscriptText(text.slice(0, cut), acc);
        carry = text.slice(cut + 1);
      }
      if (carry) scanTranscriptText(carry, acc);
    } catch { /* unreadable transcript: skip */ }
    for (const k of Object.keys(all)) {
      for (const [name, r] of acc[k]) {
        const a = all[k].get(name) || { calls: 0, sessions: 0, last: null };
        a.calls += r.calls; a.sessions += 1;
        if (r.last && (!a.last || r.last > a.last)) a.last = r.last;
        all[k].set(name, a);
      }
    }
    if (!f.sub) sessions.push({ first: acc.first, last: acc.last, cwd: acc.cwd });
    done += 1;
    if (onProgress && (done % 10 === 0 || done === files.length)) onProgress({ done, total: files.length, bytes });
  }
  return { sessions, all, files: done, totalFiles: files.length };
}

/** Turns raw counts into what travels: names filtered, paths shortened, no prompts. */
export function shapeUsage(raw, ctx, scopeLabels) {
  if (!raw) return null;
  const { compiled, excluded, stats } = ctx;
  const rows = (m, limit) => [...m].filter(([n]) => {
    const w = excludedBy(n, compiled); if (w) { excluded(w); return false; } return true;
  }).map(([name, r]) => ({ name: redact(name, stats), ...r })).sort((a, b) => b.calls - a.calls).slice(0, limit);
  const byDay = new Map(), byProject = new Map();
  let hidden = 0;
  for (const s of raw.sessions) {
    if (s.first) { const d = s.first.slice(0, 10); byDay.set(d, (byDay.get(d) || 0) + 1); }
    const cwd = s.cwd ? redact(s.cwd, null) : null;
    if (!cwd) continue;
    if (excludedBy(cwd, compiled)) { hidden += 1; continue; }
    const home = [...scopeLabels].sort((a, b) => b.length - a.length)
      .find((l) => cwd === l || cwd.startsWith(l + '/'));
    const key = home || cwd.split('/').slice(0, 5).join('/');
    byProject.set(key, (byProject.get(key) || 0) + 1);
  }
  const tools = rows(raw.all.tools, 400);
  const mcpServers = new Map();
  for (const t of tools) {
    const m = /^mcp__(.+?)__/.exec(t.name);
    if (m) mcpServers.set(m[1], (mcpServers.get(m[1]) || 0) + t.calls);
  }
  return {
    sessions: raw.sessions.length,
    transcripts: raw.files,
    first: raw.sessions.reduce((a, s) => (s.first && (!a || s.first < a) ? s.first : a), null),
    last: raw.sessions.reduce((a, s) => (s.last && (!a || s.last > a) ? s.last : a), null),
    byDay: [...byDay].sort(),
    byProject: [...byProject].map(([label, sessions]) => ({ label, sessions })).sort((a, b) => b.sessions - a.sessions).slice(0, 30),
    hiddenSessions: hidden,
    skills: rows(raw.all.skills, 300),
    agents: rows(raw.all.agents, 100),
    commands: rows(raw.all.commands, 150),
    tools: tools.filter((t) => !t.name.startsWith('mcp__')).slice(0, 40),
    mcpServers: [...mcpServers].map(([name, calls]) => ({ name, calls })).sort((a, b) => b.calls - a.calls),
  };
}

/* --------------------------------------------------------------------- evals */

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Normalises one `aggregate-result.json` (same rules as the panel's). */
export function readResult(j) {
  if (!j || typeof j !== 'object' || !Array.isArray(j.cases) || !j.aggregates) return null;
  const suite = j.suite || {};
  const cases = j.cases.map((c) => {
    const ag = c.aggregates || {};
    const withArm = Array.isArray((c.arms || {}).with) ? c.arms.with : [];
    const types = new Map((c.graders || []).map((g) => [g.name, g.type]));
    let fired = 0, total = 0;
    for (const run of withArm) {
      const g = ((run && run.graders) || []).find((x) => x && types.get(x.name) === 'tool_used');
      if (!g) continue;
      total += 1; if (g.passed) fired += 1;
    }
    return { name: c.name, runs: withArm.length || (c.runsPerCase ?? null),
      score: num(ag.score), scoreWithout: num(ag.scoreWithout), delta: num(ag.delta), passRate: num(ag.passRate),
      graders: (c.graders || []).map((g) => ({ name: g.name, type: g.type, weight: g.weight })),
      triggered: fired, triggerRuns: total, errored: withArm.filter((r) => r && r.error).length };
  });
  return {
    startedAt: j.startedAt || null, claudeVersion: j.claudeVersion || null,
    costUsd: num(j.costUsd), durationSeconds: num(j.durationSeconds), partial: j.partial === true,
    ablation: suite.ablation || null, judgeModel: suite.judgeModel || null, threshold: num(suite.threshold),
    casesTotal: j.aggregates.casesTotal ?? cases.length, casesPassed: j.aggregates.casesPassed ?? null,
    overallScore: num(j.aggregates.overallScore), overallPassRate: num(j.aggregates.overallPassRate),
    meanDelta: num(j.aggregates.meanDelta), cases,
  };
}

/** One bench: cases, what it measures, and every stored run. */
export async function readBench(fs, b, ctx) {
  const { compiled, excluded, stats } = ctx;
  if (excludedBy(b.label, compiled)) { excluded(excludedBy(b.label, compiled)); return null; }
  const m = b.m;
  let plugin = {};
  const cp = await listMap(fs, m.get('.claude-plugin').h);
  if (cp.get('plugin.json')) { try { plugin = JSON.parse(await fs.text(cp.get('plugin.json').h)); } catch { /* keep going */ } }
  const ev = await listMap(fs, m.get('evals').h);
  const cases = [], casesWithoutGrader = [];
  for (const [n, e] of ev) {
    if (e.kind !== 'dir' || n === 'results') continue;
    cases.push(n);
    const inside = await listMap(fs, e.h);
    const g = inside.get('graders');
    if (!g || !(await fs.list(g.h)).length) casesWithoutGrader.push(n);
  }
  const runs = [];
  const res = ev.get('results');
  if (res && res.kind === 'dir') {
    for (const e of await fs.list(res.h)) {
      if (e.kind !== 'dir') continue;
      const inside = await listMap(fs, e.h);
      const f = inside.get('aggregate-result.json');
      if (!f) continue;
      let r = null;
      try { r = readResult(JSON.parse(await fs.text(f.h))); } catch { /* skip */ }
      if (r) runs.push({ name: e.name, result: r });
    }
  }
  runs.sort((a, b2) => (a.name < b2.name ? 1 : -1));
  const skills = m.get('skills') && m.get('skills').kind === 'dir' ? (await fs.list(m.get('skills').h)).map((e) => e.name) : [];
  const agents = [];
  if (m.get('agents') && m.get('agents').kind === 'dir') {
    for (const e of await fs.list(m.get('agents').h)) {
      if (!e.name.endsWith('.md')) continue;
      const body = await fs.text(e.h).catch(() => '');
      agents.push({ name: frontmatter(body).name || e.name.replace(/\.md$/, ''), file: e.name, fingerprint: body ? fingerprint(body) : null });
    }
  }
  return {
    name: plugin.name || b.label.split('/').pop(), version: plugin.version || null,
    path: redact(b.label, stats), cases: cases.sort(), casesWithoutGrader, skills, agents,
    latest: runs[0] ? { name: runs[0].name, ...runs[0].result } : null,
    history: runs.map((r) => ({ name: r.name, startedAt: r.result.startedAt, overallScore: r.result.overallScore,
      meanDelta: r.result.meanDelta, costUsd: r.result.costUsd, ablation: r.result.ablation,
      judgeModel: r.result.judgeModel, casesTotal: r.result.casesTotal })),
  };
}

/* ------------------------------------------------------------------ assembly */

export function newContext(patterns) {
  const stats = { redactions: 0 };
  const counts = new Map();
  return {
    stats,
    compiled: compilePatterns(patterns),
    patterns: [...patterns],
    excluded: (p) => counts.set(p, (counts.get(p) || 0) + 1),
    counts,
  };
}

/**
 * The snapshot that leaves the machine (or the page's memory). Every string in
 * it has already passed through `redact`.
 */
export function assemble({ ctx, scopes, usage, benches, person, source, extraMcp = [], routines = null }) {
  return {
    schema: SCHEMA,
    collectorVersion: VERSION,
    source,
    generatedAt: new Date().toISOString(),
    person: { name: person && person.name ? String(person.name).slice(0, 80) : null },
    scopes,
    globalMcp: extraMcp,
    routines,   // cloud routines and session loops: not on disk, filled in by whoever generates the snapshot
    usage,
    benches: benches.filter(Boolean),
    privacy: {
      patterns: ctx.patterns,
      excluded: [...ctx.counts].map(([pattern, count]) => ({ pattern, count })),
      redactions: ctx.stats.redactions,
      rules: [
        'Settings files are never copied: only permissions, hooks, MCP server names and env key names.',
        'The global CLAUDE.md and every settings.local.json travel as metadata or extracted rules only.',
        'Tokens, keys, passwords, emails and home-folder names are replaced by pattern.',
        'Transcripts contribute counts only: no prompt, answer or file content.',
      ],
    },
  };
}

/** Pulls the MCP servers out of ~/.claude.json (it also holds account data: nothing else is read). */
export function mcpFromClaudeJson(text, ctx) {
  let j;
  try { j = JSON.parse(text); } catch { return []; }
  const out = [];
  for (const [name, def] of Object.entries((j && j.mcpServers) || {})) {
    const w = excludedBy(name, ctx.compiled);
    if (w) { ctx.excluded(w); continue; }
    out.push({ ...mcpServer(name, def, ctx.stats), source: '~/.claude.json', project: null });
  }
  for (const [path, p] of Object.entries((j && j.projects) || {})) {
    for (const [name, def] of Object.entries((p && p.mcpServers) || {})) {
      const short = redact(path, null);
      const w = excludedBy(name, ctx.compiled) || excludedBy(short, ctx.compiled);
      if (w) { ctx.excluded(w); continue; }
      out.push({ ...mcpServer(name, def, ctx.stats), source: '~/.claude.json', project: short });
    }
  }
  return out;
}

/** Light validation of a snapshot someone loads from a file. */
export function validateSnapshot(s) {
  if (!s || typeof s !== 'object') return 'The file is not a JSON object.';
  if (s.schema !== SCHEMA) return 'This is not a snapshot from the collector (schema ' + JSON.stringify(s.schema) + ').';
  if (!Array.isArray(s.scopes)) return 'The snapshot has no scopes.';
  return null;
}
