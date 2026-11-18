// Node collector — the optional path, for whoever has Node 18+.
//
// It produces the same snapshot as the page (same core), plus one thing a
// browser cannot read: who created and who last touched each versioned piece,
// from git. Nothing is sent anywhere; the JSON goes to stdout.
//
//   node collect.mjs [folders...] > my-claude-config.json
//
// With no folders it reads ~/.claude and the usual project folders.
// Options: --no-usage, --depth <n>, --exclude <regex> (repeatable), --name <name>

import { readdirSync, readFileSync, statSync, existsSync, createReadStream } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  discoverRoots, readScope, listTranscripts, scanUsage, shapeUsage, readBench, newContext,
  assemble, mcpFromClaudeJson, DEFAULT_EXCLUDE, DEFAULT_DEPTH,
} from './core.js';

const HOME = homedir();
const tilde = (p) => (p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p);
const COMMON = ['Desktop/dades', 'code', 'dev', 'projects', 'proyectos', 'src', 'repos', 'work', 'Desktop', 'Documents'];

const fsAdapter = {
  async list(h) {
    try {
      return readdirSync(h, { withFileTypes: true }).map((e) => {
        const full = join(h, e.name);
        let kind = e.isDirectory() ? 'dir' : e.isFile() ? 'file' : null;
        if (e.isSymbolicLink()) { try { const s = statSync(full); kind = s.isDirectory() ? 'dir' : 'file'; } catch { kind = null; } }
        return kind ? { name: e.name, kind, h: full } : null;
      }).filter(Boolean);
    } catch { return []; }
  },
  async text(h) { return readFileSync(h, 'utf8'); },
  async meta(h) { const s = statSync(h); return { size: s.size, mtime: s.mtime.toISOString() }; },
  chunks(h) { return createReadStream(h, { encoding: 'utf8', highWaterMark: 1 << 20 }); },
};

function parse(argv) {
  const o = { roots: [], usage: true, depth: DEFAULT_DEPTH, exclude: [], name: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-usage') o.usage = false;
    else if (a === '--depth') o.depth = Number(argv[++i]);
    else if (a === '--exclude') o.exclude.push(argv[++i]);
    else if (a === '--name') o.name = argv[++i];
    else if (a === '-h' || a === '--help') { process.stderr.write(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 12).join('\n') + '\n'); process.exit(0); }
    else o.roots.push(a.replace(/^~(?=\/|$)/, HOME));
  }
  if (!o.roots.length) o.roots = COMMON.map((r) => join(HOME, r)).filter(existsSync);
  return o;
}

/** Who created and who last touched each file under a scope, from one git log. */
function authorship(base) {
  let out = '';
  try {
    out = execFileSync('git', ['-C', base, 'log', '--no-renames', '--relative', '--name-only',
      '--format=%x1e%an%x1f%aI', '--', '.claude', 'CLAUDE.md', '.mcp.json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 6e7 });
  } catch { return new Map(); }
  const idx = new Map();
  for (const chunk of out.split('\x1e')) {
    const [head, ...files] = chunk.split('\n');
    if (!head) continue;
    const [author, date] = head.split('\x1f');
    for (const f of files) {
      if (!f.trim()) continue;
      if (!idx.has(f)) idx.set(f, []);
      idx.get(f).push({ author, date });
    }
  }
  const res = new Map();
  for (const [f, cs] of idx) {
    const authors = [...new Set(cs.map((c) => c.author))];
    res.set(f, { createdBy: cs.at(-1).author, created: cs.at(-1).date, lastBy: cs[0].author, last: cs[0].date, commits: cs.length, authors });
  }
  return res;
}

async function main() {
  const o = parse(process.argv.slice(2));
  const log = (m) => process.stderr.write(m + '\n');
  const ctx = newContext([...DEFAULT_EXCLUDE, ...o.exclude]);

  const roots = [];
  if (existsSync(join(HOME, '.claude'))) roots.push({ h: join(HOME, '.claude'), name: '.claude', label: '~/.claude' });
  for (const r of o.roots) roots.push({ h: r, name: basename(r), label: tilde(r) });
  log('Reading ' + roots.map((r) => r.label).join(', ') + ' …');

  const found = await discoverRoots(fsAdapter, roots, { depth: o.depth });
  const seen = new Set();
  const scopes = [];
  for (const s of found.scopes) {
    const key = s.isGlobal ? 'global' : s.label;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = await readScope(fsAdapter, s, ctx);
    if (!r) continue;
    if (s.base) {
      const who = authorship(s.base);
      for (const it of r.items) if (who.has(it.path)) it.git = who.get(it.path);
    }
    scopes.push(r);
  }

  let usage = null;
  if (o.usage && found.transcripts) {
    const files = await listTranscripts(fsAdapter, found.transcripts);
    log('Counting usage in ' + files.length + ' transcripts (counts only) …');
    const raw = await scanUsage(fsAdapter, files, {
      onProgress: ({ done, total }) => { if (done % 200 === 0) log('  ' + done + '/' + total); },
    });
    usage = shapeUsage(raw, ctx, scopes.map((s) => s.label));
  }

  const benches = [];
  const benchSeen = new Set();
  for (const b of found.benches) {
    if (benchSeen.has(b.label)) continue;
    benchSeen.add(b.label);
    benches.push(await readBench(fsAdapter, b, ctx));
  }

  const claudeJson = join(HOME, '.claude.json');
  const extraMcp = existsSync(claudeJson) ? mcpFromClaudeJson(readFileSync(claudeJson, 'utf8'), ctx) : [];

  let name = o.name;
  if (!name) { try { name = execFileSync('git', ['config', '--global', 'user.name'], { encoding: 'utf8' }).trim(); } catch { name = null; } }

  const snap = assemble({ ctx, scopes, usage, benches, person: { name }, source: 'node', extraMcp });
  process.stdout.write(JSON.stringify(snap) + '\n');
  const pieces = scopes.reduce((a, s) => a + s.items.length, 0);
  log('Done: ' + scopes.length + ' scopes, ' + pieces + ' pieces, ' + benches.filter(Boolean).length + ' eval benches, ' +
    ctx.stats.redactions + ' values redacted, ' + [...ctx.counts.values()].reduce((a, b) => a + b, 0) + ' items excluded.');
  log('Load the file on the Claude Config Panel page.');
}

main().catch((e) => { process.stderr.write('Collector failed: ' + e.message + '\n'); process.exit(1); });
