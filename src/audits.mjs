// Where audits live.
//
// They used to be written to `.claude/audit/findings.json` inside the audited
// repo, which put a machine-written file in the middle of the configuration the
// audit is about: it shows up in the panel as one more piece, it has to be
// gitignored or committed, and a second audit overwrites the first. They belong
// outside, in one place, keyed by repo and kept as a history.
//
// Old in-repo reports are still read, so nothing already written is lost.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { CLAUDE, tilde } from './paths.mjs';
import { validateFindings, loadFindings } from './findings.mjs';

// Overridable so the tests can write somewhere that is not your real history.
export const AUDITS = process.env.CCP_AUDITS_DIR || join(CLAUDE, 'audits');

/**
 * A stable folder name for a repo. Derived from the path so the same repo keeps
 * its history across runs, and readable so the folder can be browsed by hand.
 */
export function slugFor(repoPath) {
  const s = tilde(repoPath).replace(/^~\/?/, '').replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').toLowerCase();
  return s || basename(repoPath).toLowerCase() || 'unknown';
}

/** A file name that sorts chronologically and survives every filesystem. */
export function runFileName(generatedAt) {
  const d = new Date(generatedAt);
  const iso = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  return iso.replace(/[:.]/g, '-') + '.json';
}

/** Every run stored for one repo, newest first. */
export function runsFor(slug) {
  const dir = join(AUDITS, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort().reverse()
    .map((file) => {
      const { doc, errors } = readRun(slug, file);
      return { file, generatedAt: doc ? doc.generatedAt : null,
        tool: doc ? doc.tool : null, findings: doc ? doc.findings.length : 0,
        questions: doc && Array.isArray(doc.questions) ? doc.questions.length : 0, errors };
    });
}

/** One stored run, validated like anything else a model writes. */
export function readRun(slug, file) {
  const path = join(AUDITS, slug, file);
  if (!existsSync(path)) return { doc: null, errors: ['no such run'], path };
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return { doc: null, errors: ['invalid JSON: ' + e.message], path }; }
  const { ok, errors } = validateFindings(parsed);
  return { doc: ok ? parsed : null, errors, path };
}

/**
 * Stores a run. The caller has already validated it; this refuses anyway,
 * because a rejected write is recoverable and a corrupt history is not.
 *
 * @returns {{ok: boolean, errors: string[], path?: string, slug?: string}}
 */
export function saveRun(doc) {
  const { ok, errors } = validateFindings(doc);
  if (!ok) return { ok: false, errors };
  const slug = slugFor(doc.scope.path.replace(/^~/, process.env.HOME || '~'));
  const dir = join(AUDITS, slug);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, runFileName(doc.generatedAt));
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
  return { ok: true, errors: [], path, slug };
}

/** Drops one stored run. Used to clear a report written by mistake. */
export function deleteRun(slug, file) {
  if (!/^[a-z0-9-]+$/.test(slug) || !/^[\w.-]+\.json$/.test(file)) return false;
  const path = join(AUDITS, slug, file);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

/**
 * The report that applies to a repo right now: the newest stored run, or the
 * legacy in-repo file when the repo has never been audited into the store.
 *
 * @returns {{doc: object|null, errors: string[], path: string, source: string,
 *            slug: string, runs: object[]}}
 */
export function currentFor(repoPath) {
  const slug = slugFor(repoPath);
  const runs = runsFor(slug);
  const newest = runs.find((r) => r.generatedAt);
  if (newest) {
    const { doc, errors, path } = readRun(slug, newest.file);
    return { doc, errors, path: tilde(path), source: 'store', slug, runs };
  }
  const legacy = loadFindings(repoPath);
  return { doc: legacy.doc, errors: legacy.errors, path: tilde(legacy.path),
    source: 'repo', slug, runs };
}

/** Every repo with a stored history, whether or not it is still on disk. */
export function listSlugs() {
  if (!existsSync(AUDITS)) return [];
  return readdirSync(AUDITS, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
}
