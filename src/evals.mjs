// Skill evals: did the skill actually change anything?
//
// A skill that never fires is dead weight, and a skill that fires and changes
// nothing is worse — it costs context and reads like coverage. `claude plugin
// eval` answers both: it runs each case twice, with the skill and without it,
// and the difference between the two arms is the only number that means
// anything. A case that passes in both arms is measuring the base model.
//
// The bench lives outside the audited repo, because `claude plugin eval` needs
// a directory with `.claude-plugin/plugin.json` and `.claude/` is not a plugin.
// The panel reads it where it is and ties each bench back to the real skill.

import { existsSync, readFileSync, readlinkSync, statSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename, relative } from 'node:path';
import { ls, read } from './fsutil.mjs';
import { tilde } from './paths.mjs';

/** Folders that never hold a bench and are expensive to walk. */
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor', 'coverage', '.turbo', 'tmp']);

/**
 * Cost of one agent run, in dollars. Measured on 2026-10-19 with Claude Code
 * 2.1.300; used only until a bench has runs of its own to average, which is
 * the number that actually applies to these cases on this machine.
 */
export const FALLBACK_RUN_COST = 0.075;

/** Directories holding a `.claude-plugin/plugin.json` and an `evals/` folder. */
export function findBenches(dir, depth, acc = []) {
  if (depth < 0) return acc;
  for (const e of ls(dir)) {
    if (!e.isDirectory() || SKIP.has(e.name)) continue;
    const full = join(dir, e.name);
    if (existsSync(join(full, '.claude-plugin', 'plugin.json')) && existsSync(join(full, 'evals'))) {
      acc.push(full);
      continue;
    }
    findBenches(full, depth - 1, acc);
  }
  return acc;
}

/**
 * What a bench's `skills/<name>` points at. A skill bench symlinks rather than
 * copies, so it never measures a stale version — and the link is also what
 * ties a measurement back to the skill the panel lists.
 */
function skillTargets(benchPath) {
  const out = [];
  for (const e of ls(join(benchPath, 'skills'))) {
    const p = join(benchPath, 'skills', e.name);
    let target = null, dangling = false;
    try {
      if (statSync(p, { throwIfNoEntry: false })) target = realpathSync(p);
      else { readlinkSync(p); dangling = true; }
    } catch { dangling = true; }
    out.push({ name: e.name, path: p, target, linked: isLink(p), dangling });
  }
  return out;
}

/**
 * What a bench's `agents/<name>.md` holds — and here the rule is the opposite
 * of the one for skills: **the file has to be a real copy**. A symlink under
 * `agents/` is silently not loaded. The plugin still resolves, the suite still
 * runs, and the model answers `Available agents: claude, Explore,
 * general-purpose, …` with no error anywhere to say the agent was missing. Two
 * runs scored zero before that turned up, and they read exactly like an agent
 * that fails its own rubric.
 *
 * The copy buys the load and costs freshness, so the hash is the point: it is
 * what lets the panel say the bench is measuring a version you have already
 * edited.
 */
function agentTargets(benchPath) {
  const out = [];
  for (const e of ls(join(benchPath, 'agents'))) {
    if (!e.isFile() && !isLink(join(benchPath, 'agents', e.name))) continue;
    if (!e.name.endsWith('.md')) continue;
    const p = join(benchPath, 'agents', e.name);
    const body = read(p);
    out.push({
      name: declaredName(body) || basename(e.name, '.md'),
      file: e.name,
      path: p,
      // A symlink here is a defect, not a convenience: it will not be loaded.
      linked: isLink(p),
      hash: body ? digest(body) : null,
      dangling: body === null || body === '',
    });
  }
  return out;
}

/** The `name:` of a markdown frontmatter block, which is what the harness uses. */
function declaredName(body) {
  if (!body) return null;
  const fm = /^---\n([\s\S]*?)\n---/.exec(body);
  if (!fm) return null;
  const m = /^name:\s*(.+)$/m.exec(fm[1]);
  return m ? m[1].trim() : null;
}

function digest(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

function isLink(p) {
  try { readlinkSync(p); return true; } catch { return false; }
}

/** Case folders, in the order a person would read them. `results` is not one. */
function caseNames(benchPath) {
  return ls(join(benchPath, 'evals'))
    .filter((e) => e.isDirectory() && e.name !== 'results')
    .map((e) => e.name).sort();
}

/**
 * Normalises one `aggregate-result.json`. Everything the panel shows comes
 * from here, so a shape it does not recognise returns null rather than half a
 * reading.
 */
export function readResult(path) {
  let j;
  try { j = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  if (!j || typeof j !== 'object' || !Array.isArray(j.cases) || !j.aggregates) return null;

  const suite = j.suite || {};
  const cases = j.cases.map((c) => {
    const ag = c.aggregates || {};
    const arms = c.arms || {};
    const withArm = Array.isArray(arms.with) ? arms.with : [];
    // The `tool_used` grader is the one that measures firing rather than
    // quality, and it is free. Counting it separately is the difference
    // between "the skill is wrong" and "the skill never ran".
    // A run's grader entries carry only the name; the type lives on the case.
    const types = new Map((c.graders || []).map((g) => [g.name, g.type]));
    const trigger = triggerCount(withArm, types);
    return {
      name: c.name,
      // `runsPerCase` is the suite default (3), not what --runs asked for: a
      // run launched with --runs 1 still reports 3 while holding one entry per
      // arm. Count the arm. Believing the field made the cost estimate come
      // out three times cheap and showed a 1-run result as if it were three.
      runs: withArm.length || (c.runsPerCase ?? null),
      declaredRuns: c.runsPerCase ?? null,
      score: num(ag.score), scoreWithout: num(ag.scoreWithout),
      delta: num(ag.delta), passRate: num(ag.passRate),
      graders: (c.graders || []).map((g) => ({ name: g.name, type: g.type, weight: g.weight })),
      triggered: trigger.fired, triggerRuns: trigger.total,
      errored: withArm.filter((r) => r && r.error).length,
    };
  });

  return {
    startedAt: j.startedAt || null,
    claudeVersion: j.claudeVersion || null,
    costUsd: num(j.costUsd),
    durationSeconds: num(j.durationSeconds),
    partial: j.partial === true,
    ablation: suite.ablation || null,
    judgeModel: suite.judgeModel || null,
    threshold: num(suite.threshold),
    concurrency: num(suite.concurrency),
    casesTotal: j.aggregates.casesTotal ?? cases.length,
    casesPassed: j.aggregates.casesPassed ?? null,
    overallScore: num(j.aggregates.overallScore),
    overallPassRate: num(j.aggregates.overallPassRate),
    meanDelta: num(j.aggregates.meanDelta),
    cases,
  };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** How many runs of the with-skill arm actually invoked the skill. */
function triggerCount(withArm, types) {
  let fired = 0, total = 0;
  for (const run of withArm) {
    const g = (run && run.graders || []).find((x) => x && types.get(x.name) === 'tool_used');
    if (!g) continue;
    total += 1;
    if (g.passed) fired += 1;
  }
  return { fired, total };
}

/** Every stored run of a bench, newest first. */
function runsOf(benchPath) {
  const dir = join(benchPath, 'evals', 'results');
  return ls(dir)
    .filter((e) => e.isDirectory())
    .map((e) => e.name).sort().reverse()
    .map((name) => ({ name, path: join(dir, name, 'aggregate-result.json') }))
    .filter((r) => existsSync(r.path));
}

/**
 * What a run of this bench would cost, from its own history when it has one.
 * Two arms unless the ablation is off, so the estimate says which it assumed.
 */
export function estimateCost(bench, { runs = 1, ablation } = {}) {
  // What the next run will cost depends on how many arms it has, and that is
  // not a free choice: a bench that dispatches an agent by name has to run
  // with `--ablation none`, because the baseline arm has no plugin and so
  // cannot dispatch it at all. Projecting two arms over such a bench doubles
  // the quoted price. Absent an explicit answer, the honest guess is however
  // this bench was last actually run.
  const projected = ablation
    || (bench.latest && bench.latest.result && bench.latest.result.ablation)
    || 'with-without';
  const measured = bench.runs
    .map((r) => r.result)
    .filter((r) => r && r.costUsd && r.casesTotal);
  let perRun = FALLBACK_RUN_COST, from = 'the documented $0.075 per agent run';
  if (measured.length) {
    const totals = measured.map((r) => {
      const arms = r.ablation === 'none' ? 1 : 2;
      const agentRuns = r.casesTotal * (r.cases[0] ? r.cases[0].runs : 1) * arms;
      return agentRuns ? r.costUsd / agentRuns : null;
    }).filter(Boolean);
    if (totals.length) {
      perRun = totals.reduce((a, b) => a + b, 0) / totals.length;
      from = 'this bench\'s own ' + totals.length + ' run' + (totals.length === 1 ? '' : 's');
    }
  }
  const arms = projected === 'none' ? 1 : 2;
  return { usd: bench.cases.length * runs * arms * perRun, perRun, arms,
    ablation: projected, from };
}

/**
 * Reads every bench under `roots`, newest result parsed, history listed.
 *
 * @returns {{benches: object[]}}
 */
export function discoverEvals({ scanRoots = [], depth = 5 } = {}) {
  const seen = new Set();
  const benches = [];
  for (const root of scanRoots) {
    for (const path of findBenches(root, depth)) {
      if (seen.has(path)) continue;
      seen.add(path);
      benches.push(readBench(path));
    }
  }
  return { benches: benches.sort((a, b) => a.name.localeCompare(b.name)) };
}

export function readBench(path) {
  let plugin = {};
  try { plugin = JSON.parse(read(join(path, '.claude-plugin', 'plugin.json')) || '{}'); } catch { /* keep going */ }
  const runs = runsOf(path).map((r) => ({ name: r.name, path: r.path, result: readResult(r.path) }));
  const cases = caseNames(path);
  const bench = {
    name: plugin.name || basename(path),
    version: plugin.version || null,
    path, displayPath: tilde(path),
    bank: tilde(dirname(path)),
    cases,
    casesWithoutGrader: cases.filter((c) => !ls(join(path, 'evals', c, 'graders')).length),
    skills: skillTargets(path),
    agents: agentTargets(path),
    runs,
    latest: runs.find((r) => r.result) || null,
  };
  bench.estimate = estimateCost(bench, { runs: 1 });
  return bench;
}

/** Items a bench can measure. Hooks and config are not among them. */
const MEASURABLE = new Set(['skill', 'agent']);

/**
 * Finds the bench measuring one item, and how it is attached.
 *
 * The two kinds are tied back differently because they are shipped
 * differently. A skill is symlinked, so the resolved path identifies it
 * exactly. An agent has to be copied (see `agentTargets`), and a copy has no
 * path back to the original — so it is matched on the `name:` the harness
 * itself dispatches by, and the hash tells us whether the copy still matches
 * the file the panel is showing.
 */
function attach(item, benches) {
  if (!item || !MEASURABLE.has(item.kind)) return null;

  if (item.kind === 'skill') {
    const dir = dirname(item.path);
    let real = dir;
    try { real = realpathSync(dir); } catch { /* keep the literal path */ }
    for (const b of benches) {
      for (const s of b.skills) {
        if (s.target === real || s.path === dir) return { bench: b, via: 'symlink', stale: false };
      }
    }
    return null;
  }

  const body = read(item.path);
  const live = body ? digest(body) : null;
  const declared = declaredName(body) || basename(item.path, '.md');
  for (const b of benches) {
    for (const a of b.agents) {
      if (a.name !== declared && a.name !== item.name) continue;
      return {
        bench: b,
        // A symlinked agent is reported, not hidden: it is why the suite scores zero.
        via: a.linked ? 'symlink (not loaded)' : 'copy',
        stale: Boolean(live && a.hash && live !== a.hash),
      };
    }
  }
  return null;
}

/**
 * Which skills and agents the panel knows about are measured, and which are
 * not. This is the point where a bench stops being a side project and starts
 * saying something about the configuration.
 */
export function coverage(items, benches) {
  const covered = [], uncovered = [];
  for (const it of items) {
    if (!MEASURABLE.has(it.kind)) continue;
    const hit = attach(it, benches);
    const row = { id: it.id, kind: it.kind, name: it.name, scope: it.scope, path: it.displayPath };
    if (hit) {
      const r = hit.bench.latest && hit.bench.latest.result;
      covered.push({ ...row, bench: hit.bench.name, via: hit.via, stale: hit.stale,
        meanDelta: r ? r.meanDelta : null,
        // With `--ablation none` there is no Δ by design, not for lack of data.
        ablation: r ? r.ablation : null, overallScore: r ? r.overallScore : null,
        cases: hit.bench.cases.length, startedAt: r ? r.startedAt : null });
    } else {
      uncovered.push(row);
    }
  }
  return { covered, uncovered };
}

/** The bench measuring one item, if any. Used on the piece's own page. */
export function benchForItem(item, benches) {
  const hit = attach(item, benches);
  if (!hit) return null;
  const b = hit.bench;
  const r = b.latest && b.latest.result;
  return { name: b.name, path: b.displayPath, cases: b.cases.length, via: hit.via,
    stale: hit.stale, meanDelta: r ? r.meanDelta : null, ablation: r ? r.ablation : null,
    overallScore: r ? r.overallScore : null,
    startedAt: r ? r.startedAt : null, runs: b.runs.length };
}

/**
 * Everything there is to see about one case: the prompt it asks, the rubric it
 * is scored against, and what each arm actually answered.
 *
 * A score on its own teaches nobody anything. Put the question, the rubric, the
 * two answers and the judge's verdict on one page and the delta explains
 * itself — which arm got it right, and why the judge thought so.
 */
export function caseDetail(benchPath, caseName) {
  if (!/^[\w.-]+$/.test(caseName)) return null;
  const dir = join(benchPath, 'evals', caseName);
  if (!existsSync(dir)) return null;

  const raw = read(join(dir, 'prompt.md')) || '';
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  const prompt = { options: fm ? fm[1] : '', body: fm ? raw.slice(fm[0].length).trim() : raw.trim() };

  const graders = [];
  for (const e of ls(join(dir, 'graders'))) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const text = read(join(dir, 'graders', e.name)) || '';
    const g = /^---\n([\s\S]*?)\n---\n?/.exec(text);
    const head = g ? g[1] : '';
    graders.push({
      name: e.name.replace(/\.md$/, ''),
      type: (/type:\s*(\S+)/.exec(head) || [])[1] || '?',
      weight: (/weight:\s*(\S+)/.exec(head) || [])[1] || null,
      tool: (/tool:\s*(\S+)/.exec(head) || [])[1] || null,
      body: g ? text.slice(g[0].length).trim() : text.trim(),
    });
  }

  // The newest run that actually holds this case.
  const runs = runsOf(benchPath);
  let answers = null;
  for (const r of runs) {
    let j;
    try { j = JSON.parse(readFileSync(r.path, 'utf8')); } catch { continue; }
    const c = (j.cases || []).find((x) => x.name === caseName);
    if (!c) continue;
    const types = new Map((c.graders || []).map((g) => [g.name, g.type]));
    const arm = (list) => (list || []).map((run, i) => ({
      run: i + 1,
      score: num(run.score),
      turns: run.turns ?? null,
      error: run.error || null,
      // One answer is enough to read a verdict; three copies of it is noise.
      answer: i === 0 ? ((run.graders || []).find((g) => g.evidence) || {}).evidence || null : null,
      verdicts: (run.graders || []).map((g) => ({
        name: g.name, type: types.get(g.name) || '?', passed: g.passed === true,
        scored: g.scored !== false, withOnly: g.withOnly === true,
        explanation: g.explanation || null,
        votes: Array.isArray(g.judgeVotes) ? g.judgeVotes : null,
      })),
    }));
    answers = { startedAt: j.startedAt, judgeModel: (j.suite || {}).judgeModel || null,
      ablation: (j.suite || {}).ablation || null,
      aggregates: c.aggregates || null,
      withArm: arm(c.arms && c.arms.with), withoutArm: arm(c.arms && c.arms.without) };
    break;
  }

  return { name: caseName, prompt, graders, answers };
}

/** Relative path of a bench file, for display next to the bank root. */
export const inBank = (bench, p) => relative(dirname(bench.path), p);
