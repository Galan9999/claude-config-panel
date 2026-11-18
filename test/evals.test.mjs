import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findBenches, readResult, readBench, estimateCost, coverage, benchForItem,
  FALLBACK_RUN_COST } from '../src/evals.mjs';

const ROOT = mkdtempSync(join(tmpdir(), 'ccp-evals-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));

// A real skill somewhere, and a bench that symlinks it rather than copying it.
const repo = join(ROOT, 'repo', '.claude', 'skills', 'owns-the-resource');
mkdirSync(repo, { recursive: true });
writeFileSync(join(repo, 'SKILL.md'), '---\nname: owns-the-resource\n---\nbody\n');

const bench = join(ROOT, 'bank', 'owns-the-resource');
mkdirSync(join(bench, '.claude-plugin'), { recursive: true });
mkdirSync(join(bench, 'skills'), { recursive: true });
mkdirSync(join(bench, 'evals', '1-positivo', 'graders'), { recursive: true });
mkdirSync(join(bench, 'evals', '2-negativo'), { recursive: true });
mkdirSync(join(bench, 'evals', 'results', '2026-10-20T11-13-52-315Z'), { recursive: true });
writeFileSync(join(bench, '.claude-plugin', 'plugin.json'),
  JSON.stringify({ name: 'owns-the-resource', version: '0.0.1' }));
writeFileSync(join(bench, 'evals', '1-positivo', 'prompt.md'), 'prompt');
writeFileSync(join(bench, 'evals', '1-positivo', 'graders', 'criteria.md'), '---\ntype: llm\n---\nrubric');
writeFileSync(join(bench, 'evals', '2-negativo', 'prompt.md'), 'prompt');
symlinkSync(repo, join(bench, 'skills', 'owns-the-resource'));

const result = {
  schemaVersion: 1, claudeVersion: '2.1.300', startedAt: '2026-10-20T11:13:52.315Z',
  durationSeconds: 312, costUsd: 2.64, partial: false,
  suite: { ablation: 'with-without', judgeModel: 'sonnet', threshold: 1, concurrency: 2 },
  cases: [
    { name: '1-positivo', runsPerCase: 3,
      graders: [{ name: 'criteria', type: 'llm', weight: 1 }, { name: 'disparo', type: 'tool_used', weight: 1 }],
      arms: { with: [
        { graders: [{ name: 'criteria', passed: true }, { name: 'disparo', passed: true }] },
        { graders: [{ name: 'criteria', passed: true }, { name: 'disparo', passed: true }] },
        { graders: [{ name: 'criteria', passed: true }, { name: 'disparo', passed: true }] },
      ] },
      aggregates: { score: 1, passRate: 1, scoreWithout: 0, passRateWithout: 0, delta: 1 } },
    { name: '2-negativo', runsPerCase: 3,
      graders: [{ name: 'criteria', type: 'llm', weight: 1 }, { name: 'disparo', type: 'tool_used', weight: 1 }],
      arms: { with: [
        { graders: [{ name: 'criteria', passed: true }, { name: 'disparo', passed: false }] },
        { graders: [{ name: 'criteria', passed: true }, { name: 'disparo', passed: false }] },
        { graders: [{ name: 'criteria', passed: true }, { name: 'disparo', passed: false }] },
      ] },
      aggregates: { score: 1, passRate: 1, scoreWithout: 0.3333, delta: 0.6667 } },
  ],
  aggregates: { casesTotal: 2, casesPassed: 2, overallScore: 1, overallPassRate: 1, meanDelta: 0.8334 },
};
writeFileSync(join(bench, 'evals', 'results', '2026-10-20T11-13-52-315Z', 'aggregate-result.json'),
  JSON.stringify(result));

test('a bench is a folder with a plugin manifest and an evals directory', () => {
  // Both banks: a bench is a bench whether it ships a skill or an agent.
  const found = findBenches(ROOT, 4);
  assert.deepEqual(found, [abench, bench]);
});

test('a folder with a manifest but no evals is not a bench', () => {
  const lone = join(ROOT, 'bank', 'not-a-bench', '.claude-plugin');
  mkdirSync(lone, { recursive: true });
  writeFileSync(join(lone, 'plugin.json'), '{"name":"x"}');
  assert.deepEqual(findBenches(join(ROOT, 'bank'), 4), [bench]);
});

test('the result is read down to the per-case delta', () => {
  const r = readResult(join(bench, 'evals', 'results', '2026-10-20T11-13-52-315Z', 'aggregate-result.json'));
  assert.equal(r.meanDelta, 0.8334);
  assert.equal(r.judgeModel, 'sonnet');
  assert.equal(r.cases[0].delta, 1);
  assert.equal(r.cases[1].scoreWithout, 0.3333);
});

test('firing is counted from the tool_used grader, whose type lives on the case', () => {
  const r = readResult(join(bench, 'evals', 'results', '2026-10-20T11-13-52-315Z', 'aggregate-result.json'));
  assert.equal(r.cases[0].triggered, 3);
  assert.equal(r.cases[0].triggerRuns, 3);
  // The negative case staying quiet is the skill behaving, not a failure.
  assert.equal(r.cases[1].triggered, 0);
  assert.equal(r.cases[1].triggerRuns, 3);
});

test('a result that is not the shape we know returns null, not half a reading', () => {
  const bad = join(ROOT, 'bad.json');
  writeFileSync(bad, JSON.stringify({ cases: 'nope' }));
  assert.equal(readResult(bad), null);
  assert.equal(readResult(join(ROOT, 'missing.json')), null);
});

test('the bench reports its cases, its link and the case with no grader', () => {
  const b = readBench(bench);
  assert.equal(b.name, 'owns-the-resource');
  assert.deepEqual(b.cases, ['1-positivo', '2-negativo']);
  assert.deepEqual(b.casesWithoutGrader, ['2-negativo']);
  assert.equal(b.skills[0].linked, true);
  assert.equal(b.skills[0].dangling, false);
  assert.ok(b.latest.result.meanDelta);
});

test('the cost estimate prefers this bench s own history over the documented figure', () => {
  const b = readBench(bench);
  // 2 cases x 3 runs x 2 arms = 12 agent runs for $2.64.
  assert.ok(Math.abs(b.estimate.perRun - 2.64 / 12) < 1e-9);
  assert.match(b.estimate.from, /own/);
  const three = estimateCost(b, { runs: 3 });
  assert.ok(Math.abs(three.usd - b.estimate.usd * 3) < 1e-9);
  assert.equal(estimateCost(b, { runs: 1, ablation: 'none' }).arms, 1);
});

test('with no history it falls back to the documented per-run cost, and says so', () => {
  const fresh = join(ROOT, 'bank', 'fresh');
  mkdirSync(join(fresh, '.claude-plugin'), { recursive: true });
  mkdirSync(join(fresh, 'evals', 'only-case'), { recursive: true });
  writeFileSync(join(fresh, '.claude-plugin', 'plugin.json'), '{"name":"fresh"}');
  const b = readBench(fresh);
  assert.equal(b.estimate.perRun, FALLBACK_RUN_COST);
  assert.match(b.estimate.from, /documented/);
  assert.equal(b.latest, null);
});

test('coverage ties a bench to the skill it links, and names the rest', () => {
  const items = [
    { id: '1', kind: 'skill', name: 'owns-the-resource', path: join(repo, 'SKILL.md'), scope: 'x', displayPath: 'x' },
    { id: '2', kind: 'skill', name: 'unmeasured', path: join(ROOT, 'repo', '.claude', 'skills', 'unmeasured', 'SKILL.md'), scope: 'x', displayPath: 'x' },
    { id: '3', kind: 'config', name: 'settings.json', path: 'y', scope: 'x', displayPath: 'y' },
  ];
  const { covered, uncovered } = coverage(items, [readBench(bench)]);
  assert.equal(covered.length, 1);
  assert.equal(covered[0].name, 'owns-the-resource');
  assert.equal(covered[0].meanDelta, 0.8334);
  assert.deepEqual(uncovered.map((u) => u.name), ['unmeasured']);
});

test('a skill page finds its bench, and anything that is not a skill does not', () => {
  const benches = [readBench(bench)];
  const skill = { kind: 'skill', path: join(repo, 'SKILL.md') };
  assert.equal(benchForItem(skill, benches).name, 'owns-the-resource');
  assert.equal(benchForItem({ kind: 'config', path: 'y' }, benches), null);
  assert.equal(benchForItem(null, benches), null);
});

test('a broken symlink is reported rather than silently measured', () => {
  const b2 = join(ROOT, 'bank', 'dangling');
  mkdirSync(join(b2, '.claude-plugin'), { recursive: true });
  mkdirSync(join(b2, 'skills'), { recursive: true });
  mkdirSync(join(b2, 'evals'), { recursive: true });
  writeFileSync(join(b2, '.claude-plugin', 'plugin.json'), '{"name":"dangling"}');
  symlinkSync(join(ROOT, 'gone'), join(b2, 'skills', 'gone'));
  assert.equal(readBench(b2).skills[0].dangling, true);
});

test('the run count comes from the arm, not from the suite default', () => {
  // `--runs 1` still writes runsPerCase: 3 while each arm holds one entry.
  const one = JSON.parse(JSON.stringify(result));
  one.cases.forEach((c) => { c.runsPerCase = 3; c.arms.with = [c.arms.with[0]]; });
  const path = join(ROOT, 'one-run.json');
  writeFileSync(path, JSON.stringify(one));
  const r = readResult(path);
  assert.equal(r.cases[0].runs, 1, 'a single-run arm must not report three');
  assert.equal(r.cases[0].declaredRuns, 3, 'the declared value is kept, clearly labelled');
});

test('the cost estimate divides by the runs that actually happened', () => {
  const b = readBench(bench);
  // 2 cases x 3 real runs x 2 arms = 12 agent runs for $2.64.
  assert.ok(Math.abs(b.estimate.perRun - 2.64 / 12) < 1e-9);
});

// ---------------------------------------------------------------------------
// Agents. The bench ships them copied, not symlinked, because a symlink under
// `agents/` is silently not loaded — the suite runs and every case scores zero
// with no error to say the agent was never there.
//
// They get a bank of their own so the skill bench's discovery test keeps
// asserting on exactly one directory.

const AGENT_BODY = '---\nname: code-reviewer\ntools: Read, Grep\n---\nreview the diff\n';
const agentFile = join(ROOT, 'repo', '.claude', 'agents', 'code-reviewer.md');
mkdirSync(join(ROOT, 'repo', '.claude', 'agents'), { recursive: true });
writeFileSync(agentFile, AGENT_BODY);

const abench = join(ROOT, 'abank', 'agent-code-reviewer');
mkdirSync(join(abench, '.claude-plugin'), { recursive: true });
mkdirSync(join(abench, 'agents'), { recursive: true });
mkdirSync(join(abench, 'evals', 'revision-diff', 'graders'), { recursive: true });
writeFileSync(join(abench, '.claude-plugin', 'plugin.json'),
  JSON.stringify({ name: 'agent-code-reviewer', version: '0.0.1' }));
writeFileSync(join(abench, 'evals', 'revision-diff', 'prompt.md'), 'prompt');
writeFileSync(join(abench, 'evals', 'revision-diff', 'graders', 'disparo.md'),
  '---\ntype: tool_used\ntool: Agent\n---\n');
writeFileSync(join(abench, 'agents', 'code-reviewer.md'), AGENT_BODY);

const agentItem = { id: 'a1', kind: 'agent', name: 'code-reviewer', scope: 'backend',
  path: agentFile, displayPath: '~/repo/.claude/agents/code-reviewer.md' };

test('a bench reads the agents it ships, named by their frontmatter', () => {
  const b = readBench(abench);
  assert.equal(b.agents.length, 1);
  assert.equal(b.agents[0].name, 'code-reviewer');
  assert.equal(b.agents[0].file, 'code-reviewer.md');
  assert.equal(b.agents[0].linked, false, 'a copy is the correct shape for an agent');
});

test('the frontmatter name wins over the filename, because the harness dispatches by it', () => {
  const odd = join(ROOT, 'abank', 'odd-name');
  mkdirSync(join(odd, '.claude-plugin'), { recursive: true });
  mkdirSync(join(odd, 'agents'), { recursive: true });
  mkdirSync(join(odd, 'evals'), { recursive: true });
  writeFileSync(join(odd, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'odd-name' }));
  writeFileSync(join(odd, 'agents', 'whatever.md'), '---\nname: real-name\n---\nbody\n');
  assert.equal(readBench(odd).agents[0].name, 'real-name');
});

test('an agent item is tied to its bench by name, since a copy has no path back', () => {
  const benches = [readBench(bench), readBench(abench)];
  const hit = benchForItem(agentItem, benches);
  assert.equal(hit.name, 'agent-code-reviewer');
  assert.equal(hit.via, 'copy');
  assert.equal(hit.stale, false);
});

test('a copy that no longer matches the live agent is reported as stale', () => {
  // Edit the real agent; the bench still holds yesterday's text.
  writeFileSync(agentFile, AGENT_BODY + '\nand also check the P0 list\n');
  const hit = benchForItem(agentItem, [readBench(abench)]);
  assert.equal(hit.stale, true, 'measuring a version you have already edited is not a measurement');
  writeFileSync(agentFile, AGENT_BODY);
});

test('a symlinked agent is reported as not loaded, not as a working bench', () => {
  const broken = join(ROOT, 'abank', 'linked-agent');
  mkdirSync(join(broken, '.claude-plugin'), { recursive: true });
  mkdirSync(join(broken, 'agents'), { recursive: true });
  mkdirSync(join(broken, 'evals'), { recursive: true });
  writeFileSync(join(broken, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'linked-agent' }));
  symlinkSync(agentFile, join(broken, 'agents', 'code-reviewer.md'));
  const b = readBench(broken);
  assert.equal(b.agents[0].linked, true);
  assert.equal(benchForItem(agentItem, [b]).via, 'symlink (not loaded)');
});

test('coverage counts agents alongside skills, and keeps the kind', () => {
  const items = [
    { id: '1', kind: 'skill', name: 'owns-the-resource', scope: 'x',
      path: join(repo, 'SKILL.md'), displayPath: 'x' },
    agentItem,
    { id: '3', kind: 'agent', name: 'lp-dev-worker', scope: 'backend',
      path: join(ROOT, 'repo', '.claude', 'agents', 'lp-dev-worker.md'), displayPath: 'y' },
    { id: '4', kind: 'hook', name: 'hooks/pretty.sh', scope: 'x', path: 'z', displayPath: 'z' },
  ];
  const { covered, uncovered } = coverage(items, [readBench(bench), readBench(abench)]);
  assert.deepEqual(covered.map((c) => c.name).sort(), ['code-reviewer', 'owns-the-resource']);
  assert.equal(covered.find((c) => c.name === 'code-reviewer').kind, 'agent');
  assert.deepEqual(uncovered.map((u) => u.name), ['lp-dev-worker']);
  assert.ok(!covered.concat(uncovered).some((r) => r.kind === 'hook'),
    'a hook has nothing a bench could measure, so it is not counted as uncovered');
});

test('the estimate projects the ablation the bench actually runs with', () => {
  // A bench measuring an agent has to run with `--ablation none`, so quoting
  // two arms would double its price.
  const single = JSON.parse(JSON.stringify(result));
  single.suite.ablation = 'none';
  single.costUsd = 1.2;
  single.cases.forEach((c) => { delete c.arms.without; });
  const dir = join(abench, 'evals', 'results', '2026-10-28T11-18-08-416Z');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'aggregate-result.json'), JSON.stringify(single));

  const b = readBench(abench);
  assert.equal(b.estimate.arms, 1, 'one arm, because that is how it was run');
  assert.equal(b.estimate.ablation, 'none');
  // 2 cases x 3 runs x 1 arm = 6 agent runs for $1.20.
  assert.ok(Math.abs(b.estimate.perRun - 1.2 / 6) < 1e-9);
  assert.ok(Math.abs(estimateCost(b, { runs: 3 }).usd - 1 * 3 * 1 * (1.2 / 6)) < 1e-9);
  // An explicit answer still wins over the bench's history.
  assert.equal(estimateCost(b, { runs: 3, ablation: 'with-without' }).arms, 2);
});

test('a bench that has never run still quotes two arms, the usual default', () => {
  const fresh = join(ROOT, 'abank', 'never-run');
  mkdirSync(join(fresh, '.claude-plugin'), { recursive: true });
  mkdirSync(join(fresh, 'evals', 'one'), { recursive: true });
  writeFileSync(join(fresh, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'never-run' }));
  assert.equal(readBench(fresh).estimate.arms, 2);
});
