// Findings schema for an audit of a Claude Code configuration.
//
// This is the contract between whoever audits (a Claude agent, cc-audit,
// anything) and whoever acts on the findings (this panel, a ticket creator).
// Which is why it is validated here and nothing is assumed: the producer is a
// language model or a third-party tool.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FINDINGS_PATH = join('.claude', 'audit', 'findings.json');
export const SEVERITIES = ['high', 'medium', 'low'];
export const CATEGORIES = ['broad-permission', 'outbound-permission', 'unused-permission',
  'skill-never-fires', 'overlap', 'bloated-prompt', 'unbounded-hook', 'orphan', 'other'];

const isStr = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * Validates a findings report.
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateFindings(doc) {
  const errors = [];
  const bad = (m) => errors.push(m);

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, errors: ['the report is not an object'] };
  }
  if (doc.version !== 1) bad('version must be 1');
  if (!isStr(doc.generatedAt) || Number.isNaN(Date.parse(doc.generatedAt))) bad('generatedAt must be an ISO date');
  if (!isStr(doc.tool)) bad('tool is missing');
  if (!isStr(doc.summary)) bad('summary is missing');

  const sc = doc.scope;
  if (!sc || typeof sc !== 'object') bad('scope is missing');
  else {
    if (!isStr(sc.path)) bad('scope.path is missing');
    if (!['repo', 'global'].includes(sc.kind)) bad('scope.kind must be repo or global');
  }

  if (!Array.isArray(doc.notChecked)) bad('notChecked must be an array (empty if there is nothing)');
  if (!Array.isArray(doc.findings)) return { ok: false, errors: [...errors, 'findings must be an array'] };

  const seen = new Set();
  doc.findings.forEach((f, i) => {
    const at = 'findings[' + i + ']';
    if (!f || typeof f !== 'object') return bad(at + ' is not an object');
    if (!isStr(f.id) || !/^[a-z0-9-]+$/.test(f.id)) bad(at + '.id must be a lowercase slug');
    else if (seen.has(f.id)) bad(at + '.id is duplicated: ' + f.id);
    else seen.add(f.id);
    if (!SEVERITIES.includes(f.severity)) bad(at + '.severity must be ' + SEVERITIES.join('/'));
    if (!CATEGORIES.includes(f.category)) bad(at + '.category is unknown: ' + f.category);
    if (!isStr(f.title)) bad(at + '.title is empty');
    else if (f.title.length > 100) bad(at + '.title is over 100 characters');
    if (!isStr(f.path)) bad(at + '.path is empty');
    if (f.line !== undefined && (!Number.isInteger(f.line) || f.line < 1)) bad(at + '.line must be a positive integer');
    if (!isStr(f.what)) bad(at + '.what is empty');
    if (!isStr(f.proposal)) bad(at + '.proposal is empty');
    else if (/^review\b/i.test(f.proposal.trim())) bad(at + '.proposal cannot be "review": say what to do');
    if (f.notion !== undefined && f.notion !== null) {
      if (typeof f.notion !== 'object') bad(at + '.notion must be an object or null');
      else {
        if (!isStr(f.notion.url)) bad(at + '.notion.url is empty');
        if (f.notion.recurrences !== undefined &&
            (!Number.isInteger(f.notion.recurrences) || f.notion.recurrences < 1)) {
          bad(at + '.notion.recurrences must be a positive integer');
        }
      }
    }
    if (f.autofix !== undefined && f.autofix !== null) {
      if (typeof f.autofix !== 'object') bad(at + '.autofix must be an object or null');
      else {
        if (!['remove-permission', 'replace-permission', 'add-timeout'].includes(f.autofix.kind)) {
          bad(at + '.autofix.kind is unknown');
        }
        if (!isStr(f.autofix.file)) bad(at + '.autofix.file is empty');
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

/** Sorts by severity, keeping the producer's order within each level. */
export function sortFindings(findings) {
  return [...findings].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
}

/**
 * Reads a scope's report, if there is one.
 * @returns {{doc: object|null, errors: string[], path: string}}
 */
export function loadFindings(scopePath) {
  const path = join(scopePath, FINDINGS_PATH);
  if (!existsSync(path)) return { doc: null, errors: [], path };
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return { doc: null, errors: ['invalid JSON: ' + e.message], path }; }
  const { ok, errors } = validateFindings(parsed);
  return { doc: ok ? parsed : null, errors, path };
}

/* ---------- matching findings to pieces that are not their file ---------- */

// Names half a configuration shares: matching on these would link anything to
// anything.
const GENERIC_NAMES = new Set(['skill.md', 'agent.md', 'index.md', 'claude.md', 'readme.md',
  'settings.json', 'settings.local.json', 'launch.json', 'package.json']);

/**
 * The strings by which a piece can be recognised inside a finding's text: its
 * path, and its filename when that is distinctive. A finding about a hook
 * declared in `settings.json` talks about a script that lives elsewhere, and
 * usually names it as `prettier-on-write.sh`, not by its full path.
 */
export function pieceKeys(relPath) {
  if (!relPath) return [];
  const base = relPath.split('/').pop();
  return [relPath, base]
    .filter((k, i, a) => a.indexOf(k) === i)
    .filter((k) => k.length >= 8 && !GENERIC_NAMES.has(k.toLowerCase()));
}

/** Findings on other files that talk about this piece. */
export function findingsMentioning(findings, relPath) {
  const keys = pieceKeys(relPath);
  if (!keys.length) return [];
  return findings.filter((f) => {
    if (f.path === relPath) return false;
    const text = f.title + ' ' + f.what + ' ' + f.proposal;
    return keys.some((k) => text.includes(k));
  });
}
