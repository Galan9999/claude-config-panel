// What actually fires.
//
// Evals never fill in by themselves: a suite is a lab run you launch and pay
// for. Usage is the opposite — every Skill invocation is already written to the
// session transcripts, for free, and has been since the day you installed the
// skill. The two answer different questions, in this order:
//
//   usage  — does it fire at all?       (free, accumulates while you work)
//   evals  — when it fires, does it     (costs money, you run it deliberately)
//            change the answer?
//
// Usage comes first, because an eval on a skill that never fires is money spent
// measuring the base model.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CLAUDE } from './paths.mjs';

export const PROJECTS = process.env.CCP_PROJECTS_DIR || join(CLAUDE, 'projects');

/** `"name":"Skill","input":{"skill":"lpb:1.read"` — the one shape that counts. */
const CALL = /"name":"Skill","input":\{"skill":"([^"]+)"/g;
const STAMP = /"timestamp":"([^"]+)"/;

// Transcripts are append-only and there is a gigabyte of them, so a file is
// re-read only when its size or mtime moved.
const cache = new Map();

/**
 * Every transcript on disk, with the project folder it belongs to. A project
 * keeps subfolders of its own, and skipping them lost more than half the
 * sessions, so the walk goes all the way down.
 */
function transcripts(dir = PROJECTS, project = null, out = []) {
  if (!existsSync(dir)) return out;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) transcripts(full, project ?? e.name, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push({ project: project ?? '(root)', path: full });
  }
  return out;
}

/** Skill calls in one transcript: name → {calls, last}. */
function scanFile(path) {
  let st;
  try { st = statSync(path); } catch { return new Map(); }
  const hit = cache.get(path);
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.counts;

  const counts = new Map();
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return counts; }
  // Only the lines that matched are parsed any further.
  if (text.includes('"name":"Skill"')) {
    for (const line of text.split('\n')) {
      if (!line.includes('"name":"Skill"')) continue;
      CALL.lastIndex = 0;
      let m;
      while ((m = CALL.exec(line)) !== null) {
        const name = m[1];
        const when = (STAMP.exec(line) || [])[1] || null;
        const prev = counts.get(name) || { calls: 0, last: null };
        prev.calls += 1;
        if (when && (!prev.last || when > prev.last)) prev.last = when;
        counts.set(name, prev);
      }
    }
  }
  cache.set(path, { mtime: st.mtimeMs, size: st.size, counts });
  return counts;
}

/**
 * Aggregated skill usage across every project on this machine.
 *
 * @returns {{skills: object[], sessions: number, files: number}}
 */
export function scanUsage() {
  const files = transcripts();
  const agg = new Map();
  for (const { project, path } of files) {
    for (const [name, { calls, last }] of scanFile(path)) {
      const row = agg.get(name) || { name, calls: 0, sessions: 0, last: null, projects: new Set() };
      row.calls += calls;
      row.sessions += 1;
      row.projects.add(project);
      if (last && (!row.last || last > row.last)) row.last = last;
      agg.set(name, row);
    }
  }
  const skills = [...agg.values()]
    .map((r) => ({ ...r, projects: r.projects.size }))
    .sort((a, b) => b.calls - a.calls);
  return { skills, sessions: files.length, files: files.length };
}

/**
 * Joins what fired with what exists. A skill the model is not allowed to
 * invoke never fires by design, so counting it as dead would be a lie.
 */
export function usageForItems(items, usage) {
  const byName = new Map(usage.skills.map((s) => [s.name, s]));
  const rows = [];
  for (const it of items) {
    if (it.kind !== 'skill') continue;
    const meta = it.meta || {};
    const manual = meta['disable-model-invocation'] === true ||
      meta['disable-model-invocation'] === 'true';
    // A skill is addressed either by its bare name or namespaced by its folder.
    const hit = byName.get(it.name) ||
      [...byName.values()].find((s) => s.name.endsWith(':' + it.name));
    rows.push({ id: it.id, name: it.name, scope: it.scope, manual,
      calls: hit ? hit.calls : 0, sessions: hit ? hit.sessions : 0,
      last: hit ? hit.last : null, projects: hit ? hit.projects : 0 });
  }
  rows.sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
  const silent = rows.filter((r) => !r.calls && !r.manual);
  return { rows, silent, manual: rows.filter((r) => r.manual).length };
}

/**
 * Which skills are worth paying to measure next: they fire often enough for the
 * measurement to be about something, and nothing measures them yet.
 */
export function benchCandidates(usageRows, coveredNames, limit = 8) {
  const covered = new Set(coveredNames);
  // The same skill name can exist in several scopes, and all of them match the
  // one usage row. Listing it three times would read as three candidates.
  const seen = new Map();
  for (const r of usageRows) {
    if (!r.calls || covered.has(r.name)) continue;
    const prev = seen.get(r.name);
    if (prev) { prev.scopes += 1; continue; }
    seen.set(r.name, { ...r, scopes: 1 });
  }
  return [...seen.values()].sort((a, b) => b.calls - a.calls).slice(0, limit);
}

/** Only for the tests: forget what was read. */
export function clearUsageCache() { cache.clear(); }
