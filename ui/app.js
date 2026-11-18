// Panel state and interface: navigation, listings, detail and editing.
import { $, esc, fdate, fwhen } from './util.js';
import { explain, MODES, autoModeGrant, classifierNote } from './permissions.js';
import { advise, scopeAdvice, FAMILIES, SYNTAX, LISTS } from './advice.js';
import { DIAGNOSES, RUNS, VARIANCE, LIMITS, LOOP } from './evalguide.js';
import { md } from './markdown.js';
import { renderPermissions } from './permview.js';
import { renderTools } from './toolsview.js';
import { renderRoutines } from './routinesview.js';
import { renderMap } from './mapview.js';
import { renderSources, reapplySources, savedSources } from './sourcesview.js';

let DATA = null, view = 'overview', cur = null, text = '', orig = '', tab = 'ui';
let MODS = null, PEOPLE = null, openPerson = null, FLOWS = null;

/* ----- boot ----- */
async function boot(landing) {
  // The folders chosen last time live in this browser; a restarted server has forgotten them.
  if (landing === undefined) await reapplySources();
  DATA = await (await fetch('/api/items')).json();
  try { MODS = (await (await fetch('/api/mods')).json()).mods; } catch { MODS = []; }
  const navs = [['overview', '◉', 'Overview', ''], ['sources', '⇩', 'Sources', '']]
    .concat(Object.entries(DATA.kinds).map(([k, v]) => [k, v.icon, v.label, DATA.counts[k]]))
    .concat([['mods', '◫', 'Mods', MODS === null ? '' : MODS.length], ['map', '⌘', 'Agent map', ''], ['flows', '⇢', 'Flows', ''], ['tools', '⚒', 'Tools', ''], ['routines', '◷', 'Routines', ''], ['permissions', '⚿', 'Permissions', ''], ['guide', '?', 'Permissions guide', ''],
      ['audits', '⎔', 'Auditor', ''], ['evals', '◎', 'Evals', ''],
      ['readevals', '◈', 'Leer un eval', ''],
      ['diagnostics', '✓', 'Diagnostics', ''], ['people', '☻', 'People', '']]);
  $('#nav').innerHTML = navs.map(([k, ic, lab, n]) =>
    '<div class="nav" data-v="' + k + '"><span class="ic">' + ic + '</span>' + lab +
    (n === '' ? '' : '<span class="n">' + n + '</span>') + '</div>').join('');
  $('#nav').onclick = (e) => { const el = e.target.closest('.nav'); if (el) go(el.dataset.v); };
  // Nothing read yet, or never chosen where to read from: start by choosing.
  const nothing = !DATA.items.some((i) => i.scope !== 'Global');
  go(landing || (nothing || !savedSources() ? 'sources' : 'overview'));
}
function go(v) { view = v; cur = null; openPerson = null;
  document.querySelectorAll('.nav').forEach((e) => e.classList.toggle('on', e.dataset.v === v));
  $('#main').onchange = null; $('#main').oninput = null; $('#main').onclick = null;
  if (v === 'overview') renderOverview();
  else if (v === 'permissions') renderPermissions($('#main'));
  else if (v === 'tools') renderTools($('#main'));
  else if (v === 'routines') renderRoutines($('#main'));
  else if (v === 'map') renderMap($('#main'));
  else if (v === 'sources') renderSources($('#main'), () => boot('sources'));
  else if (v === 'people') renderPeople();
  else if (v === 'mods') renderMods();
  else if (v === 'flows') renderFlows();
  else if (v === 'guide') renderGuide();
  else if (v === 'audits') renderAudits();
  else if (v === 'evals') renderEvals();
  else if (v === 'readevals') renderEvalGuide();
  else if (v === 'diagnostics') renderDiagnostics();
  else renderList(v);
  window.scrollTo(0, 0); $('#main').scrollTop = 0; }

/* ----- overview ----- */
function renderOverview() {
  const scopes = DATA.scopes;
  let h = '<h1>What Claude is configured to do</h1><p class="lede">Each piece loads at a different moment and under ' +
    'different rules. This is everything on your machine, grouped by kind of piece instead of by file.</p><div class="grid">';
  for (const [k, v] of Object.entries(DATA.kinds)) {
    h += '<div class="card clk" data-go="' + k + '"><div class="kpi">' + DATA.counts[k] + '</div>' +
      '<div class="ttl" style="margin-top:2px">' + v.icon + ' ' + v.label + '</div>' +
      '<div class="desc">' + esc(v.blurb) + '</div></div>';
  }
  h += '</div><h2 class="sec">Scopes found (' + scopes.length + ')</h2><div class="card">' +
    scopes.map((s) => '<span class="tag" style="margin:0 6px 6px 0;display:inline-block">' + esc(s) + '</span>').join('') +
    ((DATA.skipped || []).length ? '<div class="desc" style="margin-top:11px">' + DATA.skipped.length +
      ' worktrees skipped because they share their repo\'s config. Start with <code>--worktrees</code> to include them.</div>' : '') +
    '</div>';

  h += '<h2 class="sec">Review all of this with Claude</h2>' +
    '<div class="hint"><b>A panel shows you what you have; it does not tell you whether it is right.</b> ' +
    'For that, run an audit: Claude reads these pieces and reports what is redundant, what overlaps and what never fires.</div>' +
    '<div class="card"><div class="ttl">Full audit</div>' +
    '<div class="desc">Paste this into Claude Code inside the repo you want reviewed.</div>' +
    copyBlock('Audit this repo\'s Claude configuration: skills, agents, commands, hooks and ' +
      'permissions. Tell me what overlaps, what never fires, which permission is broader than it ' +
      'needs to be and which hook acts without me seeing it. Report first, change nothing.') + '</div>';
  $('#main').innerHTML = h;
  $('#main').onclick = (e) => {
    const c = e.target.closest('[data-go]'); if (c) return go(c.dataset.go);
    copyHandler(e);
  };
}
function copyBlock(t) { return '<pre class="copy" data-copy>' + esc(t) + '</pre>'; }
function copyHandler(e) {
  const p = e.target.closest('[data-copy]');
  if (!p) return;
  navigator.clipboard.writeText(p.textContent).then(() => {
    const old = p.style.borderColor; p.style.borderColor = 'var(--ok)';
    setTimeout(() => { p.style.borderColor = old; }, 700);
  });
}

/* ----- permissions guide ----- */

// How a verdict is shown. The words matter: "reconsider" is a prompt to think,
// not a claim that the rule is a vulnerability, and the panel has no way to
// know why you added it.
const VERDICT = {
  keep:   ['reasonable', ''],
  narrow: ['narrow it', 'warn'],
  drop:   ['redundant', ''],
  avoid:  ['reconsider', 'err'],
};

/** The per-rule "why is this like this, and what else could it be" block. */
function adviceBlock(rule, key, isGlobal, fileName) {
  const a = advise(rule), sc = scopeAdvice(rule, key, fileName, isGlobal);
  const [label, cls] = VERDICT[a.verdict] || VERDICT.keep;
  return '<details class="adv"><summary>why it is like this, and what else it could be</summary>' +
    '<div class="advbody"><div class="advhead">' + esc(a.family) +
    ' <span class="tag ' + cls + '">' + label + '</span></div>' +
    '<p>' + esc(a.why) + '</p>' +
    '<p' + (sc.ok ? '' : ' class="warn-text"') + '><b>Where it lives. </b>' + esc(sc.text) + '</p>' +
    (a.better.length
      ? '<div class="advhead">Instead of this one</div>' + a.better.map((b) =>
        '<div class="swap"><code>' + esc(b.rule) + '</code><span>' + esc(b.note) + '</span></div>').join('')
      : '') +
    '</div></details>';
}

function renderGuide() {
  let h = '<h1>Permissions, and why they end up the shape they are</h1>' +
    '<p class="lede">The rules in your settings are not a preference list: each one is a standing ' +
    'answer to a question Claude would otherwise have asked you. This is what the syntax really ' +
    'means, which commands are wider than they look, and where a rule belongs.</p>';

  h += '<h2 class="sec">How a rule is matched</h2><div class="grid">' +
    SYNTAX.map(([t, d]) => '<div class="card"><div class="ttl">' + esc(t) + '</div>' +
      '<div class="desc">' + esc(d) + '</div></div>').join('') + '</div>';

  h += '<h2 class="sec">The lists, and what each is for</h2><div class="card"><table>' +
    '<tr><th>Key</th><th>What it does</th></tr>' +
    LISTS.map(([k, d]) => '<tr><td><code>' + esc(k) + '</code></td><td>' + esc(d) + '</td></tr>').join('') +
    '</table></div>';

  h += '<h2 class="sec">Command families</h2>' +
    '<div class="hint"><b>A wildcard is worth exactly the widest command line it admits.</b> ' +
    'These are the families where that is much wider than the rule looks, because the program ' +
    'can be pointed at something else, or because a flag changes what it does.</div>';
  for (const f of FAMILIES) {
    const [label, cls] = VERDICT[f.verdict] || VERDICT.keep;
    const sample = f.better(f.progs[0]);
    h += '<div class="card"><div class="ttl">' + esc(f.label) +
      ' <span class="tag ' + cls + '">' + label + '</span></div>' +
      '<div class="desc" style="margin:4px 0 9px">' + esc(f.why) + '</div>' +
      '<div class="chips">' + f.progs.map((p) => '<code>' + esc(p) + '</code>').join('') + '</div>' +
      (sample.length ? '<div class="advhead" style="margin-top:11px">Write this instead</div>' +
        sample.map((b) => '<div class="swap"><code>' + esc(b.rule) + '</code><span>' +
          esc(b.note) + '</span></div>').join('') : '') + '</div>';
  }

  h += '<h2 class="sec">Before you add one</h2><div class="card">' +
    '<ol class="rules">' + [
      'What exactly was prompting you? Write that command, not the program that ran it.',
      'Would the exact invocation do? A rule with no star never surprises you later.',
      'What else does this prefix admit? Say the worst command line that still matches it out loud.',
      'Does it belong to this project or to you? An allow rule goes in the project\'s settings.local.json; your global file reaches every repo you open.',
      'Would you rather see it than ban it? That is what the ask list is for, and almost nobody uses it.',
      'Is the prompt even coming from a rule? In auto mode the classifier decides, and an allow rule will not move it.',
    ].map((q) => '<li>' + esc(q) + '</li>').join('') + '</ol></div>';

  $('#main').innerHTML = h;
  $('#main').onclick = copyHandler;
}

/* ----- diagnostics ----- */

const SEV = { high: 'err', medium: 'warn', low: '' };

async function renderDiagnostics() {
  $('#main').innerHTML = '<h1>Diagnostics</h1><p class="lede">Looking for audit reports…</p>';
  const { informes } = await (await fetch('/api/findings')).json();

  let h = '<h1>Diagnostics</h1><p class="lede">The latest audit of each scope, shown next to the ' +
    'pieces it is about. The panel does not compute it: an auditor writes it to ' +
    '<code>~/.claude/audits/</code> and it is only read here. For the history, the open questions ' +
    'and how to run one, go to <b>Auditor</b>.</p>';

  if (!informes.length) {
    h += '<div class="card"><div class="ttl">No audit yet</div>' +
      '<div class="desc" style="margin-bottom:8px">The <b>Auditor</b> tab lists every scope the panel ' +
      'can see, with the prompt that audits it. A report lands in <code>~/.claude/audits/</code>, ' +
      'never inside the configuration it is about.</div>' +
      copyBlock('Audit this repo\'s Claude configuration with the auditor-config agent. Read only, report first.') + '</div>';
    $('#main').innerHTML = h;
    $('#main').onclick = copyHandler;
    return;
  }

  for (const inf of informes) {
    if (inf.errors.length) {
      h += '<div class="card"><div class="ttl">' + esc(inf.repoLabel) + '<span class="tag err">invalid</span></div>' +
        '<div class="desc">' + esc(inf.path) + ' does not match the schema: ' + esc(inf.errors.join('; ')) + '</div></div>';
      continue;
    }
    const count = { high: 0, medium: 0, low: 0 };
    inf.findings.forEach((f) => { count[f.severity] += 1; });

    h += '<h2 class="sec">' + esc(inf.repoLabel) + ' · ' + inf.findings.length + ' findings</h2>' +
      '<div class="hint"><b>If you only do one thing:</b> ' + esc(inf.summary) + '</div>' +
      '<div class="card"><div class="desc">Audited by <code>' + esc(inf.tool) + '</code> on ' +
      fwhen(inf.generatedAt) + ' · ' +
      Object.entries(count).filter(([, n]) => n).map(([s, n]) =>
        '<span class="tag ' + SEV[s] + '">' + n + ' ' + s + '</span>').join(' ') + '</div></div>';

    for (const f of inf.findings) {
      h += '<div class="card"><div class="ttl"><span class="tag ' + SEV[f.severity] + '">' + esc(f.severity) + '</span>' +
        esc(f.title) + '<span class="tag">' + esc(f.category) + '</span></div>' +
        '<div class="desc" style="margin-top:6px">' + esc(f.what) + '</div>' +
        '<div class="desc" style="margin-top:6px"><b>What to do:</b> ' + esc(f.proposal) + '</div>' +
        '<div class="desc" style="margin-top:8px"><code>' + esc(f.path) + (f.line ? ':' + f.line : '') + '</code>' +
        (f.itemId ? ' <span class="rule clk" data-id="' + esc(f.itemId) + '" style="cursor:pointer">Open the piece</span>' : '') +
        (f.autofix ? ' <span class="tag acc">mechanical fix</span>' : '') + '</div>' +
        (f.notion ? '<div class="desc" style="margin-top:7px"><a href="' + esc(f.notion.url) +
          '" target="_blank" rel="noopener">Finding in the tracker</a></div>' +
          copyBlock('/lp:task --from-finding ' + f.notion.url) : '') +
        '</div>';
    }

    if (inf.notChecked.length) {
      h += '<div class="card"><div class="ttl">What the auditor could not check<span class="tag">' +
        inf.notChecked.length + '</span></div><div class="desc" style="margin-bottom:8px">' +
        'This is here on purpose: it is the difference between an honest report and one that fills gaps.</div><ul class="md">' +
        inf.notChecked.map((n) => '<li style="color:var(--dim);font-size:13px;margin-bottom:6px">' + esc(n) + '</li>').join('') +
        '</ul></div>';
    }
  }

  $('#main').innerHTML = h;
  $('#main').onclick = (e) => {
    const c = e.target.closest('[data-id]');
    if (c) return openItem(c.dataset.id);
    copyHandler(e);
  };
}

/* ----- auditor ----- */

// Audits are kept in ~/.claude/audits, one folder per repo, one file per run.
// Nothing is written into the configuration being audited: a report is an
// opinion about the config, not part of it.
let runView = null;

function auditPrompt(repoLabel, slug) {
  return 'Audit the Claude configuration of ' + repoLabel + ' with the auditor-config agent.\n' +
    'Store the report at ~/.claude/audits/' + slug + '/<generatedAt>.json ' +
    '(the ISO timestamp with : and . replaced by -). Write nothing inside the repo.\n' +
    'Include the questions block: for every rule, hook or skill whose reason you cannot read ' +
    'off the files, ask me what it is for, say what the answer decides, and offer the answers.';
}

async function renderAudits() {
  $('#main').innerHTML = '<h1>Auditor</h1><p class="lede">Reading the audit history…</p>';
  const { audited, orphans } = await (await fetch('/api/audits')).json();

  let h = '<h1>Auditor</h1><p class="lede">Every audit ever run, by repo, kept in ' +
    '<code>~/.claude/audits/</code> — outside the configuration it is about. A report is one ' +
    'opinion from one day: the history is what tells you whether anything actually changed.</p>';

  const never = audited.filter((a) => !a.generatedAt);
  const done = audited.filter((a) => a.generatedAt);

  for (const a of done) {
    const sev = a.worst ? '<span class="tag ' + SEV[a.worst] + '">' + a.worst + '</span>' : '';
    h += '<div class="card"><div class="ttl">' + esc(a.repoLabel) + ' ' + sev +
      (a.source === 'repo' ? '<span class="tag warn" title="Still inside the repo, at ' +
        esc(a.path) + '. The next run lands in the store.">in-repo report</span>' : '') +
      '</div>' +
      '<div class="desc" style="margin:4px 0 9px">' + esc(a.summary || '') + '</div>' +
      '<div class="desc">' + fwhen(a.generatedAt) + ' · ' +
      '<span class="tag">' + a.findings + ' findings</span> ' +
      (a.questions ? '<span class="tag acc">' + a.questions + ' questions for you</span> ' : '') +
      (a.notChecked ? '<span class="tag">' + a.notChecked + ' not checked</span> ' : '') +
      '<span class="tag">' + a.runs.length + ' run' + (a.runs.length === 1 ? '' : 's') + '</span></div>' +
      '<div class="row" style="margin-top:10px">' +
      a.runs.slice(0, 6).map((r, i) => '<button class="ghost" data-run="' + esc(a.slug) + '|' + esc(r.file) + '">' +
        (i === 0 ? 'Latest' : fwhen(r.generatedAt)) + '</button>').join('') +
      (a.source === 'repo' ? '<button class="ghost" data-import="' + esc(a.repo) + '">Move it into the store</button>' : '') +
      '</div>' + copyBlock(auditPrompt(a.repoLabel, a.slug)) + '</div>';
  }

  if (never.length) {
    h += '<h2 class="sec">Never audited (' + never.length + ')</h2>' +
      '<div class="hint"><b>An unaudited scope is not a clean one.</b> These have configuration ' +
      'the panel can see and no report to go with it.</div>';
    for (const a of never) {
      h += '<div class="card"><div class="ttl">' + esc(a.repoLabel) + '</div>' +
        copyBlock(auditPrompt(a.repoLabel, a.slug)) + '</div>';
    }
  }

  if (orphans.length) {
    h += '<h2 class="sec">History with no repo in view (' + orphans.length + ')</h2>' +
      '<div class="card"><div class="desc">Audited once, and the folder is no longer in the scan: ' +
      'moved, renamed or deleted. The reports are kept rather than quietly dropped.</div>' +
      orphans.map((o) => '<div class="row" style="margin-top:9px"><code>' + esc(o.slug) + '</code>' +
        o.runs.slice(0, 4).map((r) => '<button class="ghost" data-run="' + esc(o.slug) + '|' +
          esc(r.file) + '">' + fwhen(r.generatedAt) + '</button>').join('') + '</div>').join('') +
      '</div>';
  }

  $('#main').innerHTML = h;
  $('#main').onclick = (e) => {
    const r = e.target.closest('[data-run]');
    if (r) { const [slug, file] = r.dataset.run.split('|'); return openRun(slug, file); }
    const im = e.target.closest('[data-import]');
    if (im) return importLegacy(im.dataset.import);
    copyHandler(e);
  };
}

/** Copies an old in-repo report into the store, so the history starts there. */
async function importLegacy(repo) {
  const { informes } = await (await fetch('/api/findings')).json();
  const inf = informes.find((i) => i.repo === repo);
  if (!inf) return;
  const doc = { version: 1, generatedAt: inf.generatedAt, tool: inf.tool,
    scope: { path: inf.repoLabel, kind: 'repo' }, summary: inf.summary,
    findings: inf.findings.map(({ itemId, pieceName, ...f }) => f), notChecked: inf.notChecked };
  await fetch('/api/audits', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(doc) });
  renderAudits();
}

async function openRun(slug, file) {
  $('#main').innerHTML = '<h1>Audit</h1><p class="lede">Loading the run…</p>';
  const { doc, errors, path } = await (await fetch('/api/audits?slug=' +
    encodeURIComponent(slug) + '&run=' + encodeURIComponent(file))).json();
  runView = { slug, file };

  if (!doc) {
    $('#main').innerHTML = '<div class="back" data-back>← Auditor</div><h1>Audit</h1>' +
      '<div class="card"><div class="msg err">' + esc(path) + ' does not match the schema: ' +
      esc((errors || []).join('; ')) + '</div></div>';
    $('#main').onclick = () => go('audits');
    return;
  }

  const count = { high: 0, medium: 0, low: 0 };
  doc.findings.forEach((f) => { count[f.severity] += 1; });
  let h = '<div class="back" data-back>← Auditor</div>' +
    '<h1>' + esc(doc.scope.path) + '</h1>' +
    '<p class="lede">' + esc(doc.summary) + '</p>' +
    '<div class="card"><div class="desc"><code>' + esc(doc.tool) + '</code> · ' + fdate(doc.generatedAt) +
    ' · ' + Object.entries(count).filter(([, n]) => n).map(([s, n]) =>
      '<span class="tag ' + SEV[s] + '">' + n + ' ' + s + '</span>').join(' ') +
    '</div><div class="desc" style="margin-top:7px">Stored at <code>' + esc(path) + '</code></div></div>';

  const qs = Array.isArray(doc.questions) ? doc.questions : [];
  if (qs.length) {
    h += '<h2 class="sec">What it needs you to answer (' + qs.length + ')</h2>' +
      '<div class="hint"><b>These are the ones no amount of reading settles.</b> A rule is not ' +
      'wrong because it is wide; it is wrong when nothing you do needs it that wide. Only you ' +
      'know which. Answer them and the proposals below stop being guesses.</div>';
    for (const q of qs) {
      const linked = doc.findings.find((f) => f.id === q.findingId);
      h += '<div class="card"><div class="ttl">' + esc(q.question) + '</div>' +
        '<div class="desc" style="margin:6px 0 8px"><code>' + esc(q.about) + '</code> in <code>' +
        esc(q.path) + '</code></div>' +
        '<div class="desc"><b>What your answer decides. </b>' + esc(q.whyItMatters) + '</div>' +
        '<ul class="rules" style="margin-top:8px">' +
        q.options.map((o) => '<li>' + esc(o) + '</li>').join('') + '</ul>' +
        (linked ? '<div class="desc" style="margin-top:7px">Finding: <code>' + esc(linked.id) + '</code></div>' : '') +
        '</div>';
    }
    h += '<div class="card"><div class="ttl">Answer them all in one go</div>' +
      '<div class="desc" style="margin-bottom:8px">Paste this into Claude Code in that repo. It ' +
      'asks you one at a time, writes the agreed changes, and opens a PR with them.</div>' +
      copyBlock('Walk me through the open questions in ~/.claude/audits/' + slug + '/' + file +
        '. One at a time, with your recommendation first. When we are done, apply the agreed ' +
        'changes on a branch and open a PR; leave the ones we did not agree on untouched and ' +
        'say which they were.') + '</div>';
  }

  h += '<h2 class="sec">Findings (' + doc.findings.length + ')</h2>';
  for (const f of doc.findings) {
    h += '<div class="card"><div class="ttl"><span class="tag ' + SEV[f.severity] + '">' +
      esc(f.severity) + '</span>' + esc(f.title) + '<span class="tag">' + esc(f.category) + '</span></div>' +
      '<div class="desc" style="margin-top:6px">' + esc(f.what) + '</div>' +
      '<div class="desc" style="margin-top:6px"><b>What to do:</b> ' + esc(f.proposal) + '</div>' +
      '<div class="desc" style="margin-top:8px"><code>' + esc(f.path) + (f.line ? ':' + f.line : '') + '</code>' +
      (f.autofix ? ' <span class="tag acc">mechanical fix</span>' : '') + '</div></div>';
  }

  if (doc.notChecked.length) {
    h += '<h2 class="sec">What it could not check (' + doc.notChecked.length + ')</h2>' +
      '<div class="card"><div class="desc" style="margin-bottom:8px">The honest part of the ' +
      'report. Each of these is a thing you still have to settle by hand.</div><ul class="rules">' +
      doc.notChecked.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul></div>';
  }

  $('#main').innerHTML = h;
  $('#main').onclick = (e) => {
    if (e.target.closest('[data-back]')) return go('audits');
    copyHandler(e);
  };
}

/* ----- evals ----- */

// A skill that never fires is dead weight; a skill that fires and changes
// nothing is worse, because it reads like coverage. The only number that
// answers either question is the delta between the arm that had the skill and
// the arm that did not. Everything on this page is arranged around that.
const n2 = (v) => (typeof v === 'number' ? v.toFixed(2) : '—');

// The vocabulary, with what each thing is *for*. A number nobody can define is
// a number nobody acts on, and this page is full of them.
const GLOSSARY = [
  ['bench', 'A folder with <code>.claude-plugin/plugin.json</code> and an <code>evals/</code> directory — the smallest thing <code>claude plugin eval</code> knows how to run. It lives outside the repo because a <code>.claude/</code> folder is not a plugin. How it ships the piece under test depends on the kind: a <b>skill</b> is symlinked under <code>skills/</code>, so it can never measure a version you have moved on from; an <b>agent</b> has to be <b>copied</b> under <code>agents/</code>, because a symlink there is silently not loaded. The copy goes stale, so re-copy it before a run you mean to believe — the coverage table flags it when it has drifted.'],
  ['dispatching an agent', 'A case that lists <code>Agent</code> in <code>allowed_tools</code> dispatches a bench agent by its <b>namespaced</b> name — <code>my-plugin:code-reviewer</code>, not <code>code-reviewer</code>. The bare name fails with <code>Agent type not found</code>, and the model, quite reasonably, refuses to substitute a generic agent and scores zero.'],
  ['--ablation none', 'Skips the no-plugin baseline arm. Mandatory for a case that dispatches a bench agent by name: the baseline has no plugin, so it cannot dispatch that agent even in principle, and its arm scores zero every time. The Δ would be measuring the absence of the plugin, not the agent. Read the score in absolute instead — and it halves the bill.'],
  ['case', 'One concrete situation, in <code>evals/&lt;case&gt;/prompt.md</code>: what the agent is told. Three kinds earn their keep — <b>positive</b> (the skill must fire and be right), <b>negative</b> (it must not fire, or must not invent a problem) and <b>edge</b> (the boundary where you are not sure yourself).'],
  ['grader', 'Who scores the answer. <code>llm</code> puts a judge model against your rubric and costs money. <code>tool_used</code> only checks that the Skill was invoked: it is free, and it measures <b>firing, not quality</b>. Most cases want both.'],
  ['rubric', '<code>graders/&lt;name&gt;.md</code>: numbered criteria plus an <b>explicit failure condition</b>. Without the failure line the judge waves through generic answers that happen to sound right.'],
  ['arm', 'Each case is run twice: <b>with</b> the skill loaded and <b>without</b> it. The pair is the whole experiment — one arm on its own tells you nothing about the skill.'],
  ['ablation', '<code>with-without</code> runs both arms, which is what produces Δ. <code>none</code> runs only the with-skill arm: half the cost, no Δ, so use it only while you are fixing one case.'],
  ['runs', 'Repetitions per arm. The model is not deterministic, so one run is for iterating and three is the first number worth believing.'],
  ['with', 'The score of the with-skill arm, 0 to 1, averaged over its runs and weighted by grader.'],
  ['without', 'The same case with the skill removed: the base model on its own. This is the line your skill has to beat, and a high one means the case is not hard enough to need the skill.'],
  ['Δ (delta)', '<code>with − without</code>. <b>The only number that says whether the skill earned its place.</b> Everything else on the page is context for it.'],
  ['fired', 'How many of the with-skill runs actually invoked the Skill tool, from the <code>tool_used</code> grader. It splits the two failures that look identical in a score: <b>the skill is wrong</b> versus <b>the skill never ran</b>.'],
  ['judge', 'The model that scores <code>llm</code> graders. haiku by default (~$0.001/run) and sonnet on request (~$0.009/run). A weak judge is the usual cause of a noisy result, not a weak skill.'],
  ['cost', 'Every figure on this page is the <b>token cost at API rates</b>, which is what the eval itself reports. On an API key that is a bill; on a subscription it is how much of your usage allowance the suite eats. It is the right number either way for deciding whether a suite is too heavy to run three times.'],
  ['threshold', 'The score a case must reach to count as passed. The command exits 1 when any case falls short, so it works as a gate in a script.'],
  ['pass rate', 'The share of runs that cleared the threshold. A score of 0.67 from runs that went pass/pass/fail is a different problem from three identical 0.67s.'],
];

// The four shapes a row comes in. Which one you are looking at decides what you
// touch, and most of the time it is not the skill.
const READING = [
  ['Δ high · fired n/n', 'The skill fires and changes the answer. This is what you were hoping for.',
    'Nothing. Write the case down as settled and move to the next skill.'],
  ['Δ ≈ 0 · without high', 'Both arms get it right: the case is measuring the base model, not your skill.',
    'The <b>rubric</b>. Make it ask for something specific to this repo that no model can guess — an exact helper, a measured convention.'],
  ['with low · fired n/n', 'The skill fires and still gets it wrong, or the judge disagrees with you.',
    'Re-judge with <code>--judge-model sonnet</code> first; haiku has split three near-identical answers into different verdicts. Only then the skill.'],
  ['fired 0/n · positive case', 'The skill never loaded, so the score is about the base model whatever it says.',
    'The <code>description</code> in the frontmatter, which is the only thing that activates a skill. Not the body.'],
  ['fired 0/n · negative case', 'The skill stayed quiet on a case where it should. That is the skill working.',
    'Nothing. A Δ here is base-model variance, not signal.'],
];
const pct = (v) => (typeof v === 'number' ? Math.round(v * 100) + '%' : '—');

// One cell, coloured by what the number means rather than by its size. The
// dashed border is "no reading", which is not the same as a zero.
const cell = (v, kind, extra) => '<span class="v ' + kind + '">' +
  (typeof v === 'number' ? (extra || '') + v.toFixed(2) : '—') + '</span>';
/** The with-skill score: 1.00 is the bar, half marks are a failing rubric. */
const vScore = (v) => cell(v, v === null ? 'flat' : v >= 0.999 ? 'good' : v >= 0.5 ? 'mid' : 'bad');
/** The baseline carries no verdict of its own — the delta does. */
const vBase = (v) => cell(v, 'flat');
/** The only number that says whether the skill earned its place. */
const vDelta = (d) => (typeof d !== 'number' ? cell(null, 'flat')
  : cell(d, d >= 0.5 ? 'good' : d > 0 ? 'mid' : d === 0 ? 'flat' : 'bad', d > 0 ? '+' : ''));

/**
 * The headline number for a run. With `--ablation none` there is no baseline
 * arm and so no Δ at all — that is the right setup for a bench that dispatches
 * an agent by name, and showing "no Δ" there reads like missing data when it
 * is a deliberate choice. Say which it is.
 */
function scoreTag(d, ablation, score) {
  if (ablation === 'none') {
    return (typeof score === 'number'
      ? '<span class="tag ' + (score >= 0.999 ? 'acc' : score > 0 ? 'warn' : 'err') +
        '">score ' + score.toFixed(2) + '</span>'
      : '') +
      '<span class="tag" title="--ablation none: no baseline arm, so no Δ. Read the score in ' +
      'absolute.">no baseline</span>';
  }
  return deltaTag(d);
}

function deltaTag(d) {
  if (typeof d !== 'number') return '<span class="tag">no Δ</span>';
  if (d >= 0.5) return '<span class="tag acc">Δ +' + d.toFixed(2) + '</span>';
  if (d > 0) return '<span class="tag warn">Δ +' + d.toFixed(2) + '</span>';
  return '<span class="tag err">Δ ' + d.toFixed(2) + '</span>';
}

async function renderEvals() {
  $('#main').innerHTML = '<h1>Evals</h1><p class="lede">Looking for benches…</p>';
  const { benches, covered, uncovered, usage } = await (await fetch('/api/evals')).json();

  let h = '<h1>Evals</h1><p class="lede">Whether a skill changes anything. Each case runs twice — ' +
    'with the skill and without it — and the gap between the two arms is the only number that ' +
    'means something. A case that passes in both is measuring the base model, not your skill.</p>';

  h += '<details class="adv" open style="margin-bottom:16px"><summary>What each thing is, and ' +
    'what it is for</summary><div class="advbody"><table class="gloss">' + GLOSSARY.map(([t, d]) =>
      '<tr><td>' + esc(t) + '</td><td>' + d + '</td></tr>').join('') + '</table></div></details>';

  h += '<div class="card"><div class="ttl">How to read a result</div>' +
    '<div class="desc" style="margin:5px 0 9px">Four rows, four different problems. Which one you ' +
    'are looking at decides whether you touch the skill, the rubric or the description — and most ' +
    'of the time it is not the skill.</div><table>' +
    '<tr><th>What you see</th><th>What it means</th><th>What to change</th></tr>' + READING.map((r) =>
      '<tr><td class="cmd">' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>').join('') +
    '</table></div>';

  if (!benches.length) {
    h += '<div class="card"><div class="ttl">No bench found</div><div class="desc" style="margin-bottom:8px">' +
      'A bench is a folder with <code>.claude-plugin/plugin.json</code> and an <code>evals/</code> ' +
      'directory, outside the repo — a <code>.claude/</code> folder is not a plugin, so ' +
      '<code>claude plugin eval</code> cannot read one. The skill is symlinked in, never copied, ' +
      'so the bench can never measure a stale version.</div>' +
      copyBlock('# a skill: symlink it, so the bench never measures a stale version\n' +
        'mkdir -p bench/<skill>/.claude-plugin bench/<skill>/skills\n' +
        'ln -s <repo>/.claude/skills/<skill> bench/<skill>/skills/<skill>\n' +
        'cd bench/<skill> && claude plugin eval init --bare 1-positivo\n\n' +
        '# an agent: COPY it — a symlink under agents/ is silently not loaded\n' +
        'mkdir -p bench/<agent>/.claude-plugin bench/<agent>/agents\n' +
        'cp <repo>/.claude/agents/<agent>.md bench/<agent>/agents/\n' +
        'cd bench/<agent> && claude plugin eval init --bare revision\n' +
        '# dispatch it as <bench-name>:<agent>, and run with --ablation none') + '</div>';
  }

  for (const b of benches) {
    const r = b.latest;
    h += '<div class="card"><div class="ttl">' + esc(b.name) +
      (r ? ' ' + scoreTag(r.meanDelta, r.ablation, r.overallScore)
         : ' <span class="tag warn">never run</span>') +
      '<span class="tag">' + b.cases.length + ' case' + (b.cases.length === 1 ? '' : 's') + '</span>' +
      (b.history.length ? '<span class="tag">' + b.history.length + ' runs</span>' : '') + '</div>';

    const broken = b.skills.filter((s) => s.dangling);
    // The two kinds want opposite things, so they are rendered apart: a skill
    // must be linked, an agent must be copied.
    const lines = b.skills.map((s) => '<code>' + esc(s.name) + '</code>' +
      (s.dangling ? ' <span class="tag err">broken link</span>'
        : s.linked ? ' → <code>' + esc(s.target || '') + '</code>'
          : ' <span class="tag warn">copied, not linked</span>'))
      .concat((b.agents || []).map((a) => '<code>' + esc(a.name) + '</code>' +
        ' <span class="tag">agent</span>' +
        (a.linked ? ' <span class="tag err">symlinked — not loaded</span>'
          : a.dangling ? ' <span class="tag err">empty file</span>' : '')));
    h += '<div class="desc" style="margin:4px 0 9px">' + lines.join('<br>') + '</div>';
    if (broken.length) {
      h += '<div class="desc" style="color:var(--err);margin-bottom:8px">The bench points at a ' +
        'skill that is not there any more, so this measurement is about nothing. Fix the symlink ' +
        'or drop the bench.</div>';
    }
    if ((b.agents || []).some((a) => a.linked)) {
      h += '<div class="desc" style="color:var(--err);margin-bottom:8px">A symlink under ' +
        '<code>agents/</code> is <b>not loaded</b>, and nothing says so: the plugin resolves, the ' +
        'suite runs, and every case scores zero as if the agent had failed its own rubric. ' +
        'Copy the file instead — <code>cp &lt;repo&gt;/.claude/agents/&lt;name&gt;.md agents/</code> ' +
        '— and re-copy it before any run you intend to believe.</div>';
    }

    if (r) {
      h += '<div class="desc" style="margin-bottom:9px">' + fwhen(r.startedAt) +
        ' · <span class="tag">score ' + n2(r.overallScore) + '</span>' +
        ' <span class="tag">' + r.casesPassed + '/' + r.casesTotal + ' passed</span>' +
        ' <span class="tag">judge ' + esc(r.judgeModel || 'default') + '</span>' +
        ' <span class="tag">ablation ' + esc(r.ablation || '—') + '</span>' +
        ' <span class="tag">$' + (r.costUsd || 0).toFixed(2) + '</span>' +
        ' <span class="tag">' + (r.durationSeconds || 0) + 's</span>' +
        (r.claudeVersion ? ' <span class="tag">cc ' + esc(r.claudeVersion) + '</span>' : '') +
        (r.partial ? ' <span class="tag err">partial</span>' : '') + '</div>';

      h += '<table><tr><th>Case</th>' +
        '<th title="Score of the arm that had the skill loaded, 0 to 1." class="num">with</th>' +
        '<th title="The same case without the skill: the base model on its own. This is the line the skill has to beat." class="num">without</th>' +
        '<th title="with minus without. The only number that says whether the skill earned its place." class="num">Δ</th>' +
        '<th title="How many runs of the with-skill arm actually invoked the Skill tool. Separates a wrong skill from one that never ran." class="num">fired</th>' +
        '<th title="Who scored it: llm is a judge against your rubric and costs money; tool_used only checks that the skill fired and is free.">graders</th></tr>' +
        r.cases.map((c) => {
          const quiet = c.triggerRuns && !c.triggered;
          const fireKind = !c.triggerRuns ? 'flat' : quiet ? 'flat'
            : c.triggered === c.triggerRuns ? 'good' : 'mid';
          return '<tr><td class="cmd"><span class="rule clk" style="cursor:pointer" ' +
            'data-case="' + esc(b.name) + '|' + esc(c.name) + '" ' +
            'title="Open the prompt, the rubric and what each arm answered.">' +
            esc(c.name) + '</span></td>' +
            '<td class="num">' + vScore(c.score) + '</td>' +
            '<td class="num">' + vBase(c.scoreWithout) + '</td>' +
            '<td class="num">' + (c.delta === null && r.ablation === 'none'
              ? '<span class="v flat" title="This run was done with --ablation none, so there is no second arm to compare against.">no arm</span>'
              : vDelta(c.delta)) +
              (c.delta === 0 ? ' <span class="tag" title="Both arms scored the same, so this case is measuring the base model, not your skill. Either the rubric asks for nothing specific to your repo, or the case exists to catch a false positive.">no signal</span>' : '') + '</td>' +
            '<td class="num"><span class="v ' + fireKind + '">' +
              (c.triggerRuns ? c.triggered + '/' + c.triggerRuns : '—') + '</span>' +
              (quiet ? ' <span class="tag" title="The skill stayed quiet. On a negative case that is the correct behaviour; on a positive one the description is not activating it.">quiet</span>' : '') + '</td>' +
            '<td class="cmd">' + c.graders.map((g) => esc(g.name) + ':' + esc(g.type)).join(', ') + '</td></tr>';
        }).join('') + '</table>';

      h += '<div class="casebox" id="cb-' + esc(b.name) + '"></div>';

      if (b.casesWithoutGrader.length) {
        h += '<div class="desc" style="margin-top:8px;color:var(--warn)">No grader in: ' +
          b.casesWithoutGrader.map((c) => '<code>' + esc(c) + '</code>').join(' ') +
          '. A case without a grader runs and tells you nothing.</div>';
      }
    }

    h += '<div class="desc" style="margin-top:11px"><b>What another run spends. </b>' +
      '1 run ≈ <b>$' + b.estimate.usd.toFixed(2) + '</b>, 3 runs ≈ <b>$' +
      b.estimateSerious.usd.toFixed(2) + '</b> — ' +
      b.cases.length + ' cases × ' + b.estimate.arms + ' arm' +
      (b.estimate.arms === 1 ? '' : 's') +
      (b.estimate.ablation === 'none'
        ? ' <span class="tag" title="This bench runs with --ablation none, so there is no baseline arm to pay for">--ablation none</span> '
        : '') +
      ' × $' + b.estimate.perRun.toFixed(3) +
      ' per agent run, taken from ' + esc(b.estimate.from) + '. ' +
      '<span title="The figure is the token cost at API rates, which is what the run itself ' +
      'reports. On an API key that is a bill; on a subscription it is how much of your usage ' +
      'allowance the run eats. Either way it is the honest measure of how heavy a suite is.">' +
      'Tokens at API rates, not necessarily a bill.</span></div>';

    h += copyBlock('cd ' + b.displayPath + '\n' +
      'claude plugin eval . --runs 1 --no-publish --trust-plugin \\\n' +
      '  --report /tmp/' + b.name + '.html --json /tmp/' + b.name + '.json');
    h += copyBlock('cd ' + b.displayPath + '\n' +
      'claude plugin eval . --runs 3 -j 2 --judge-model sonnet --no-publish --trust-plugin \\\n' +
      '  --report /tmp/' + b.name + '.html');

    if (b.history.length > 1) {
      h += '<div class="advhead" style="margin-top:11px">Every run</div><table>' +
        '<tr><th>When</th><th class="num">score</th><th class="num">Δ</th><th>judge</th>' +
        '<th>ablation</th><th class="num" title="Token cost at API rates, as the run reported it.">$</th>' +
        '<th class="num" title="Wall-clock seconds.">s</th></tr>' +
        b.history.map((x) => '<tr><td>' + fwhen(x.startedAt) + '</td><td class="num">' + vScore(x.overallScore) +
          '</td><td class="num">' + vDelta(x.meanDelta) + '</td><td>' + esc(x.judgeModel || '—') + '</td><td>' +
          esc(x.ablation || '—') + '</td><td class="num">' + (x.costUsd || 0).toFixed(2) + '</td><td class="num">' +
          (x.durationSeconds || 0) + '</td></tr>').join('') + '</table>';
    }
    h += '</div>';
  }

  // Usage is the half nobody has to pay for, and it decides where the paid
  // half should go next.
  const u = usage || { rows: [], candidates: [] };
  h += '<h2 class="sec">What actually fires</h2>' +
    '<div class="hint"><b>This one fills in by itself.</b> Every Skill invocation is already in ' +
    'your session transcripts, going back to the day you installed each skill — no run, no cost. ' +
    'It answers a different question from an eval, and it comes first: <b>does it fire at all</b>, ' +
    'before <b>does it help when it fires</b>. An eval on a skill that never fires is paying to ' +
    'measure the base model.</div>' +
    '<div class="card"><div class="ttl">Across ' + u.sessions + ' sessions on this machine' +
    ' <span class="tag acc">' + u.distinct + ' fired</span>' +
    ' <span class="tag warn">' + u.silentCount + ' never</span>' +
    (u.manualCount ? ' <span class="tag" title="disable-model-invocation: these cannot be ' +
      'triggered by their description by design, so silence is not a verdict on them.">' +
      u.manualCount + ' manual-only</span>' : '') + '</div>';

  const fired = u.rows.filter((r) => r.calls);
  if (fired.length) {
    h += '<table><tr><th>Skill</th>' +
      '<th title="Times the Skill tool was invoked, across every project." class="num">calls</th>' +
      '<th title="How many separate sessions used it. Twenty calls in one session is one occasion, not twenty." class="num">sessions</th>' +
      '<th>last</th><th>scope</th></tr>' +
      fired.slice(0, 15).map((r) => '<tr><td class="cmd"><span class="rule clk" data-id="' +
        esc(r.id) + '" style="cursor:pointer">' + esc(r.name) + '</span></td>' +
        '<td class="num"><span class="v good">' + r.calls + '</span></td>' +
        '<td class="num"><span class="v flat">' + r.sessions + '</span></td>' +
        '<td>' + fwhen(r.last) + '</td><td class="cmd">' + esc(r.scope) + '</td></tr>').join('') +
      '</table>';
  }

  if (u.candidates && u.candidates.length) {
    h += '<div class="advhead" style="margin-top:13px">Worth measuring next</div>' +
      '<div class="desc" style="margin-bottom:7px">These fire often enough for a measurement to be ' +
      'about something, and nothing measures them yet. Start at the top.</div>' +
      '<table><tr><th class="num">calls</th><th>Skill</th><th>scope</th><th>last</th></tr>' +
      u.candidates.map((c) => '<tr><td class="num"><span class="v good">' + c.calls + '</span></td>' +
        '<td class="cmd"><span class="rule clk" data-id="' + esc(c.id) + '" style="cursor:pointer">' +
        esc(c.name) + '</span>' + (c.scopes > 1 ? ' <span class="tag">' + c.scopes + ' scopes</span>' : '') +
        '</td><td class="cmd">' + esc(c.scope) + '</td><td>' + fwhen(c.last) + '</td></tr>').join('') +
      '</table>';
  }

  const silent = u.rows.filter((r) => !r.calls && !r.manual);
  if (silent.length) {
    h += '<details class="adv" style="margin-top:11px"><summary>the ' + silent.length +
      ' that never fired</summary><div class="advbody">' +
      '<div class="desc" style="margin-bottom:8px">Silence is not proof a skill is useless — only ' +
      'that its <code>description</code> is not activating it. Rewrite the description as ' +
      '"Use when &lt;situation&gt;", or delete it. Skills marked manual-only are excluded: they ' +
      'are not supposed to fire on their own.</div><div class="chips">' +
      silent.map((r) => '<code class="clk" data-id="' + esc(r.id) + '" style="cursor:pointer">' +
        esc(r.name) + '</code>').join('') + '</div></div></details>';
  }
  h += '</div>';

  h += '<h2 class="sec">What is measured, and what is not</h2>' +
    '<div class="card"><div class="ttl">Measured <span class="tag acc">' + covered.length +
    '</span> · not measured <span class="tag">' + uncovered.length + '</span></div>' +
    '<div class="desc" style="margin:6px 0 9px">Skills and agents both. Coverage is not the goal — ' +
    'most pieces are not worth the money. The ones that are: high cost of being ignored, a ' +
    'checkable answer, and no external IO. Everything that needs Notion, Slack or a live service ' +
    'is expensive and non-deterministic, and belongs out of the bench.</div>';
  if (covered.length) {
    h += '<table><tr><th>Piece</th><th>Kind</th><th>Bench</th><th class="num">Δ</th>' +
      '<th>Last run</th></tr>' +
      covered.map((c) => '<tr><td class="cmd"><span class="rule clk" data-id="' + esc(c.id) +
        '" style="cursor:pointer">' + esc(c.name) + '</span>' +
        (c.stale ? ' <span class="tag err" title="The bench holds an older copy than the file ' +
          'the panel shows, so the last run measured a version you have already edited">stale copy</span>' : '') +
        (c.via === 'symlink (not loaded)'
          ? ' <span class="tag err" title="A symlinked agent is never loaded">not loaded</span>' : '') +
        '</td><td>' + esc(c.kind) + '</td><td class="cmd">' + esc(c.bench) +
        '</td><td class="num">' + (c.ablation === 'none'
          ? scoreTag(null, 'none', c.overallScore) : vDelta(c.meanDelta)) +
        '</td><td>' + fwhen(c.startedAt) + '</td></tr>').join('') +
      '</table>';
  }
  h += '<details class="adv" style="margin-top:10px"><summary>the ' + uncovered.length +
    ' with no bench</summary><div class="advbody"><div class="chips">' +
    uncovered.map((u) => '<code class="clk" data-id="' + esc(u.id) + '" style="cursor:pointer">' +
      esc(u.name) + '</code>').join('') + '</div></div></details></div>';

  $('#main').innerHTML = h;
  $('#main').onclick = (e) => {
    const k = e.target.closest('[data-case]');
    if (k) { const [bench, name] = k.dataset.case.split('|'); return showCase(bench, name); }
    const c = e.target.closest('[data-id]');
    if (c) return openItem(c.dataset.id);
    copyHandler(e);
  };
}

/** The question, the rubric and both answers — a score explains nothing alone. */
async function showCase(bench, name) {
  const box = document.getElementById('cb-' + bench);
  if (!box) return;
  if (box.dataset.open === name) { box.innerHTML = ''; box.dataset.open = ''; return; }
  box.dataset.open = name;
  box.innerHTML = '<div class="card"><div class="desc">Loading the case…</div></div>';
  const d = await (await fetch('/api/evals/case?bench=' + encodeURIComponent(bench) +
    '&case=' + encodeURIComponent(name))).json();
  if (d.error) { box.innerHTML = '<div class="card"><div class="msg err">' + esc(d.error) + '</div></div>'; return; }

  const a = d.answers;
  let x = '<div class="card casecard"><div class="ttl">' + esc(d.name) +
    ' <span class="x" data-case="' + esc(bench) + '|' + esc(name) + '" style="float:right;cursor:pointer">&times;</span></div>';

  x += '<div class="advhead" style="margin-top:9px">1 · The question put to the model</div>' +
    '<div class="desc" style="margin-bottom:5px">This is the whole input. The run starts in an ' +
    'empty folder, so anything not written here does not exist for the model.</div>' +
    '<pre class="case">' + esc(d.prompt.body) + '</pre>' +
    (d.prompt.options ? '<div class="desc" style="margin-top:4px">Run options: <code>' +
      esc(d.prompt.options.replace(/\n/g, ' · ')) + '</code></div>' : '');

  x += '<div class="advhead" style="margin-top:14px">2 · How it is scored</div>';
  for (const g of d.graders) {
    x += '<div class="desc" style="margin:7px 0 3px"><code>' + esc(g.name) + '</code> ' +
      '<span class="tag">' + esc(g.type) + '</span>' +
      (g.tool ? ' <span class="tag">' + esc(g.tool) + '</span>' : '') +
      (g.type === 'llm' ? ' <span class="desc">a judge model reads the answer against this text</span>'
        : g.type === 'tool_used' ? ' <span class="desc">free: checks the tool was invoked, nothing else</span>' : '') +
      '</div>' + (g.body ? '<pre class="case">' + esc(g.body) + '</pre>' : '');
  }

  if (a) {
    const one = (arm, label, note) => {
      const r = arm && arm[0];
      if (!r) return '<div class="desc">No run for this arm.</div>';
      return '<div class="armbox"><div class="advhead">' + label + ' ' + vScore(r.score) + '</div>' +
        '<div class="desc" style="margin-bottom:5px">' + note + '</div>' +
        '<pre class="case">' + esc(r.answer || '(no answer recorded)') + '</pre></div>';
    };
    x += '<div class="advhead" style="margin-top:14px">3 · What each arm answered</div>' +
      '<div class="desc" style="margin-bottom:6px">Same question, twice. The difference between ' +
      'these two columns <b>is</b> the delta — read them side by side and the number stops being ' +
      'abstract.</div><div class="arms">' +
      one(a.withArm, 'With the skill', 'The skill was loaded into this run.') +
      one(a.withoutArm, 'Without it', 'The base model on its own. This is the line the skill has to beat.') +
      '</div>';

    x += '<div class="advhead" style="margin-top:14px">4 · What the judge said</div>';
    for (const v of (a.withArm[0] || { verdicts: [] }).verdicts) {
      x += '<div class="desc" style="margin-top:6px"><code>' + esc(v.name) + '</code> ' +
        (v.passed ? '<span class="tag" style="color:var(--ok);border-color:var(--ok)">pass</span>'
          : '<span class="tag err">fail</span>') +
        (v.withOnly ? ' <span class="tag" title="Measures that the skill fired; it is an indicator, not part of the score.">indicator only</span>' : '') +
        ' ' + esc(v.explanation || '') +
        (v.votes ? ' <span class="tag" title="Three independent judge votes. A split is the judge being noisy, not the skill.">' +
          v.votes.map((t) => (t ? 'T' : 'F')).join(' ') + '</span>' : '') + '</div>';
    }
    if (a.judgeModel) {
      x += '<div class="desc" style="margin-top:9px;opacity:.75">Judged by <code>' +
        esc(a.judgeModel) + '</code>. A split vote on near-identical answers is usually the judge, ' +
        'not the skill: re-run the case with <code>--judge-model sonnet</code> before changing anything.</div>';
    }
  }
  box.innerHTML = x + '</div>';
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* ----- reading an eval ----- */

// A score is not a verdict on a skill. It is the output of an instrument with
// four moving parts — prompt, rubric, judge, model — and reading a result is
// working out which of the four moved. This page is that, on one screen.
const LVL = { good: 'good', mid: 'mid', bad: 'bad', flat: 'flat' };
const pill = (txt, lvl) => '<span class="v ' + (LVL[lvl] || 'flat') +
  '" style="min-width:0">' + esc(txt) + '</span>';

function renderEvalGuide() {
  let h = '<h1>Leer un eval</h1><p class="lede">Un número no dice si una skill es buena. Dice que ' +
    'una respuesta coincidió con una rúbrica, juzgada por un modelo, ante una pregunta concreta. ' +
    'Saber leerlo es saber <b>cuál de esas cuatro piezas se movió</b>: la skill, la rúbrica, el ' +
    'juez o el modelo.</p>';

  h += '<div class="hint"><b>Dos preguntas distintas, y en este orden.</b> ' +
    '<b>¿Dispara?</b> — gratis, sale de tus transcripts, y si la respuesta es no, nada más importa: ' +
    'lo que falla es la <code>description</code>. <b>¿Aporta cuando dispara?</b> — cuesta dinero y ' +
    'es lo que mide un eval. Pagar la segunda sin haber contestado la primera es pagar por medir ' +
    'al modelo base.</div>';

  h += '<h2 class="sec">El diagnóstico, forma por forma</h2>' +
    '<div class="desc" style="margin-bottom:11px">Busca tu fila por las tres primeras columnas. ' +
    'La cuarta te dice de quién es el problema, que casi nunca es de quien parece.</div>';
  for (const d of DIAGNOSES) {
    h += '<div class="card diag ' + d.level + '">' +
      '<div class="diagrow">' + pill('Δ ' + d.delta, d.level) +
      '<span class="tag">dispara ' + esc(d.fired) + '</span>' +
      '<span class="tag">' + esc(d.arms) + '</span>' +
      '<span class="tag' + (d.culprit === 'ninguno' ? '' : ' warn') + '">culpa: ' + esc(d.culprit) + '</span></div>' +
      '<div class="desc" style="margin-top:7px">' + esc(d.meaning) + '</div>' +
      '<div class="desc" style="margin-top:6px"><b>Qué haces. </b>' + esc(d.action) + '</div></div>';
  }

  h += '<h2 class="sec">Cuántas corridas hacen falta</h2>' +
    '<div class="card"><div class="desc" style="margin-bottom:9px">Bajo ablación ' +
    '<code>with-without</code> el grader <code>tool_used</code> no puntúa, así que cada run acaba ' +
    'siendo un pasa/no pasa. Con eso la probabilidad de que un reparto limpio salga por azar es ' +
    'exacta — test exacto de Fisher sobre la tabla 2×2.</div>' +
    '<table><tr><th>Corridas</th><th>Reparto limpio</th><th class="num">Por azar</th><th>Qué vale</th></tr>' +
    RUNS.map((r) => '<tr><td>' + esc(r[0]) + '</td><td class="cmd">' + esc(r[1]) + '</td>' +
      '<td class="num">' + pill(r[2], r[3]) + '</td><td>' + esc(r[4]) + '</td></tr>').join('') +
    '</table></div>';

  h += '<div class="card"><div class="ttl">Antes de comprar corridas, mira de dónde viene el ruido</div>' +
    '<table><tr><th>Fuente</th><th>Cómo se reduce</th><th>Cuánto cuesta</th><th></th></tr>' +
    VARIANCE.map((v) => '<tr><td>' + esc(v[0]) + '</td><td>' + esc(v[1]) + '</td>' +
      '<td class="cmd">' + esc(v[2]) + '</td><td class="desc">' + esc(v[3]) + '</td></tr>').join('') +
    '</table><div class="desc" style="margin-top:9px"><b>Arreglar el juez es más barato que ' +
    'triplicar las corridas</b>, y en este banco era la fuente dominante. Ese es el orden: sonnet ' +
    'primero, más runs después.</div></div>';

  h += '<h2 class="sec">El bucle, de lo barato a lo caro</h2>';
  for (const l of LOOP) {
    h += '<div class="card"><div class="ttl"><span class="tag acc">' + esc(l[0]) + '</span> ' +
      esc(l[1]) + ' <span class="tag">' + esc(l[2]) + '</span></div>' +
      '<div class="desc" style="margin-top:6px">' + esc(l[3]) + '</div></div>';
  }

  h += '<h2 class="sec">Lo que un eval NO te dice</h2>' +
    '<div class="hint"><b>Esta sección es parte de saber leerlo, no una nota al pie.</b> Un número ' +
    'con pinta de preciso invita a creérselo más de lo que aguanta.</div>';
  for (const [t, d] of LIMITS) {
    h += '<div class="card diag bad"><div class="ttl">' + esc(t) + '</div>' +
      '<div class="desc" style="margin-top:5px">' + esc(d) + '</div></div>';
  }

  $('#main').innerHTML = h;
  $('#main').onclick = copyHandler;
}

/* ----- flows ----- */

/**
 * The pipeline diagram, as hand-built SVG.
 *
 * No Mermaid: pulling it in would mean a CDN, and the panel loads nothing from
 * outside. Vertical rather than horizontal because seven phases in a row force
 * the type down until it cannot be read in a narrow pane.
 */
function flowDiagram(f) {
  const W = 420, ALTO = 34, HUECO = 14, M = 8;
  const alto = f.phases.length * ALTO + (f.phases.length - 1) * HUECO + M * 2;
  const esGate = (p) => /\bgate\b/i.test(p.title);

  let svg = '<svg viewBox="0 0 ' + W + ' ' + alto + '" width="100%" ' +
    'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Flow diagram for /' + esc(f.folder) + '">' +
    '<defs><marker id="pta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">' +
    '<path d="M0,0 L10,5 L0,10 z" fill="var(--line2)"/></marker></defs>';

  f.phases.forEach((p, i) => {
    const y = M + i * (ALTO + HUECO);
    const mitad = y + ALTO / 2;
    const gate = esGate(p);
    svg += '<g data-id="' + esc(p.id) + '" style="cursor:pointer">' +
      '<rect x="1" y="' + y + '" rx="7" width="' + (W - 2) + '" height="' + ALTO + '" ' +
      'fill="var(--panel)" stroke="' + (gate ? 'var(--warn)' : 'var(--line2)') + '" stroke-width="' + (gate ? 1.5 : 1) + '"/>' +
      '<circle cx="19" cy="' + mitad + '" r="9" fill="var(--acc)"/>' +
      '<text x="19" y="' + (mitad + 3.5) + '" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">' + p.order + '</text>' +
      '<text x="36" y="' + (mitad + 4) + '" font-size="12" font-weight="600" fill="var(--tx)">/' +
      esc(f.folder) + ':' + esc(p.slug) + '</text>' +
      (p.outward.length ? '<text x="' + (W - 86) + '" y="' + (mitad + 4) + '" text-anchor="end" font-size="10" ' +
        'fill="var(--err)">↗' + p.outward.length + '</text>' : '') +
      (gate ? '<text x="' + (W - 56) + '" y="' + (mitad + 4) + '" text-anchor="end" font-size="9.5" fill="var(--warn)">gate</text>' : '') +
      (p.model ? '<text x="' + (W - 10) + '" y="' + (mitad + 4) + '" text-anchor="end" font-size="10" ' +
        'font-family="ui-monospace,monospace" fill="var(--acc2)">' + esc(p.model) + '</text>' : '') +
      '</g>';

    if (i < f.phases.length - 1) {
      svg += '<line x1="19" y1="' + (y + ALTO) + '" x2="19" y2="' + (y + ALTO + HUECO - 4) + '" ' +
        'stroke="var(--line2)" stroke-width="1.2" marker-end="url(#pta)"/>';
    }
  });
  return svg + '</svg>';
}

/** Trims a long text at its first sentence, or at `max`. */
function summarise(t, max) {
  const clean = String(t || '').replace(/^[^—-]*[—-]\s*/, '').trim();
  const cut = clean.split(/(?<=\.)\s/)[0];
  return cut.length > max ? cut.slice(0, max - 1) + '…' : cut;
}

async function renderFlows() {
  $('#main').innerHTML = '<h1>Flows</h1><p class="lede">Reading the commands…</p>';
  FLOWS = await (await fetch('/api/flows')).json();
  const { flows, drift } = FLOWS;

  // Unnumbered command folders, to suggest when there is no flow at all.
  const byFolder = {};
  for (const it of DATA.items) {
    if (it.kind !== 'command' || !it.name.includes(':')) continue;
    const f = it.name.split(':')[0];
    byFolder[f] = (byFolder[f] || 0) + 1;
  }
  const loose = Object.entries(byFolder).map(([folder, n]) => ({ folder, n }))
    .sort((a, b) => b.n - a.n);

  let h = '<h1>Flows</h1><p class="lede">Sequences of numbered commands that form a pipeline. ' +
    'This is not a hand-written explanation: it comes from the files themselves, so it cannot drift ' +
    'away from what actually runs.</p>';

  if (!flows.length) {
    // This is not an error and nothing is missing: most repos do not number
    // their commands. But an empty screen reads as a broken tool, so it is
    // worth explaining what the convention is.
    h += '<div class="card"><div class="ttl">This repository has no flows, and that is normal</div>' +
      '<div class="desc" style="margin-top:7px">A flow is nothing you install or declare: it is a ' +
      '<b>naming convention</b>. The exact rule: <b>two or more</b> files in the same commands folder ' +
      'whose name starts with <code>&lt;number&gt;.</code>. The number only sets the order — they need not ' +
      'be consecutive nor start at 1, so you can leave gaps for phases you add later.</div>' +
      '<pre class="copy" style="cursor:default">.claude/commands/deploy/\n' +
      '  1.check.md\n  2.build.md\n  3.ship.md</pre>' +
      '<div class="desc" style="margin-top:10px">That alone renders <code>/deploy:*</code> with its three ' +
      'phases, each one\'s model and what it can do outside your machine without asking. No folder is ' +
      'hardcoded: it works with whatever you name yours.</div>' +
      '<div class="desc" style="margin-top:10px">If your commands are not a sequence, you do not need this ' +
      'section. The panel never invents a flow that is not there.</div></div>';

    if (loose.length) {
      h += '<div class="card"><div class="ttl">Command folders you do have<span class="tag">' +
        loose.length + '</span></div>' +
        '<div class="desc" style="margin-bottom:9px">In case one of them is really a sequence that is only ' +
        'missing the numbers.</div><div class="rules">' +
        loose.map((c) => '<span class="rule">' + esc(c.folder) + ' <b>' + c.n + '</b></span>').join('') +
        '</div></div>';
    }
  }

  for (const f of flows) {
    h += '<h2 class="sec">/' + esc(f.folder) + ':* · ' + esc(f.scope.split('/').slice(-2).join('/')) +
      ' · ' + f.phases.length + ' phases</h2>' +
      '<div class="card diagrama">' + flowDiagram(f) + '</div>';
    for (const p of f.phases) {
      h += '<div class="card"><div class="ttl">' +
        '<span class="paso">' + p.order + '</span>/' + esc(f.folder) + ':' + esc(p.slug) +
        (p.model ? '<span class="tag acc">' + esc(p.model) + '</span>' : '') +
        '<span class="tag">' + p.tools.length + ' tools</span>' +
        (p.agents ? '<span class="tag">spawns subagents</span>' : '') + '</div>' +
        '<div class="desc" style="margin-top:6px">' + esc(p.title) + '</div>' +
        (p.hint ? '<div class="desc" style="margin-top:5px"><code>' + esc(p.hint) + '</code></div>' : '');
      if (p.invokes.length) {
        h += '<div class="desc" style="margin-top:9px">Invokes: ' + p.invokes.map((a) =>
          '<span class="rule clk" data-id="' + esc(a.id) + '" style="cursor:pointer">◇ ' + esc(a.name) + '</span>').join(' ') + '</div>';
      }
      if (p.outward.length) {
        h += '<div class="desc" style="margin-top:9px">Can act outward without asking: ' +
          p.outward.map((t) => '<span class="rule" style="border-color:var(--err);color:var(--err)">' +
            esc(t.split('__').slice(2).join('__')) + '</span>').join(' ') + '</div>';
      }
      h += '<div class="row" style="margin-top:11px"><span class="rule clk" data-id="' + esc(p.id) +
        '" style="cursor:pointer">Open the command</span></div></div>';
    }
    if (f.docs.length) {
      h += '<div class="card"><div class="ttl">Flow documentation</div>' +
        '<div class="desc">The prose lives here, and it outranks any diagram. The panel links it, it does not copy it.</div>' +
        '<div class="rules" style="margin-top:10px">' + f.docs.map((d) =>
          '<span class="rule clk" data-id="' + esc(d.id) + '" style="cursor:pointer">' + esc(d.name) + '</span>').join('') +
        '</div></div>';
    }
  }

  const broken = drift.filter((d) => d.type === 'missing-command');
  const paths = drift.filter((d) => d.type === 'missing-path');
  h += '<h2 class="sec">Drift · ' + drift.length + '</h2>';
  if (!drift.length) {
    h += '<div class="card"><div class="desc">Everything the commands and the documentation quote exists.</div></div>';
  }
  if (broken.length) {
    h += '<div class="card"><div class="ttl">Commands quoted that do not exist<span class="tag err">' + broken.length + '</span></div>' +
      '<div class="desc" style="margin-bottom:8px">Documentation describing something nobody can run any more. ' +
      'This is what turns a README into a trap.</div><table><tr><th>Quoted</th><th>Where</th></tr>' +
      broken.map((d) => '<tr><td class="cmd">' + esc(d.what) + '</td><td class="cmd clk" data-id="' + esc(d.id) +
        '" style="cursor:pointer">' + esc(d.where) + '</td></tr>').join('') + '</table></div>';
  }
  if (paths.length) {
    h += '<div class="card"><div class="ttl">Paths quoted that are not there<span class="tag warn">' + paths.length + '</span></div>' +
      '<div class="desc" style="margin-bottom:8px">Careful: some are created by the flow itself when it runs, ' +
      'so not all of them are errors. Folders are already discarded.</div><table><tr><th>Path</th><th>Quoted in</th></tr>' +
      paths.map((d) => '<tr><td class="cmd">' + esc(d.what) + '</td><td class="cmd clk" data-id="' + esc(d.id) +
        '" style="cursor:pointer">' + esc(d.where) + '</td></tr>').join('') + '</table></div>';
  }

  $('#main').innerHTML = h;
  $('#main').onclick = (e) => { const c = e.target.closest('[data-id]'); if (c) openItem(c.dataset.id); };
}

/* ----- people ----- */

const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

async function renderPeople(repo) {
  $('#main').innerHTML = '<h1>People</h1><p class="lede">Reading the repository history…</p>';
  PEOPLE = await (await fetch('/api/people' + (repo ? '?repo=' + encodeURIComponent(repo) : ''))).json();
  const { people, repos, repoLabel, pieces, noHistory } = PEOPLE;

  let h = '<h1>People</h1><p class="lede">Who built this repository\'s configuration: what each person ' +
    'created and what they touched afterwards. It comes from git history, so it only covers what is versioned.</p>';

  if (repos.length > 1) {
    h += '<div class="card"><label>Repository</label><select id="repoSel">' + repos.map((r) =>
      '<option value="' + esc(r.repo) + '"' + (r.repo === PEOPLE.repo ? ' selected' : '') + '>' +
      esc(r.label) + ' · ' + r.items + ' pieces</option>').join('') + '</select></div>';
  }

  if (!people.length) {
    return ($('#main').innerHTML = h + '<div class="card"><div class="desc">No piece of ' +
      esc(repoLabel || 'this scope') + ' is versioned, so there is no authorship to show.</div></div>');
  }

  h += '<h2 class="sec">' + esc(repoLabel) + ' · ' + pieces + ' pieces · ' + people.length + ' people</h2>';
  for (const p of people) {
    const byKind = (list) => {
      const c = {};
      for (const x of list) c[x.kind] = (c[x.kind] || 0) + 1;
      return Object.entries(c).sort((a, b) => b[1] - a[1])
        .map(([k, n]) => '<span class="tag">' + DATA.kinds[k].icon + ' ' + n + ' ' + esc(DATA.kinds[k].label.toLowerCase()) + '</span>').join(' ');
    };
    h += '<div class="card clk" data-persona="' + esc(p.id) + '">' +
      '<div class="ttl"><span class="avatar">' + esc(initials(p.name)) + '</span>' + esc(p.name) +
      '<span class="tag acc">' + p.created.length + ' created</span>' +
      (p.modified.length ? '<span class="tag">' + p.modified.length + ' touched</span>' : '') +
      '<span class="tag">' + p.commits + ' commits</span></div>' +
      '<div class="desc" style="margin:8px 0 6px">Created: ' + (byKind(p.created) || '<i>nothing</i>') + '</div>' +
      (p.modified.length ? '<div class="desc" style="margin-bottom:6px">Touched: ' + byKind(p.modified) + '</div>' : '') +
      '<div class="desc">From ' + fdate(p.first) + ' to ' + fdate(p.last) + ' · ' +
      p.emails.map((e) => '<code>' + esc(e) + '</code>').join(' ') +
      (p.names.length > 1 ? ' · signs as ' + p.names.map(esc).join(', ') : '') + '</div></div>';
  }

  if (noHistory) {
    h += '<div class="card"><div class="desc">' + noHistory + ' pieces are outside this count because they ' +
      'are in no repository (the ones under <code>~/.claude</code>) or are gitignored (the ' +
      '<code>settings.local.json</code> files). For those there is no authorship to recover.</div></div>';
  }

  $('#main').innerHTML = h;
  const sel = $('#repoSel');
  if (sel) sel.onchange = () => renderPeople(sel.value);
  $('#main').onclick = (e) => {
    const c = e.target.closest('[data-persona]');
    if (c) return renderPerson(c.dataset.persona);
  };
}

function renderPerson(id) {
  const p = PEOPLE.people.find((x) => x.id === id);
  if (!p) return renderPeople(PEOPLE.repo);
  openPerson = id;

  const group = (title, list, empty) => {
    if (!list.length) return '<h2 class="sec">' + title + '</h2><div class="card"><div class="desc">' + empty + '</div></div>';
    const byKind = {};
    for (const x of list) (byKind[x.kind] ??= []).push(x);
    let out = '<h2 class="sec">' + title + ' · ' + list.length + '</h2>';
    for (const [k, xs] of Object.entries(byKind)) {
      out += '<div class="card"><div class="ttl">' + DATA.kinds[k].icon + ' ' + esc(DATA.kinds[k].label) +
        '<span class="tag">' + xs.length + '</span></div><div class="rules" style="margin-top:10px">' +
        xs.sort((a, b) => a.name.localeCompare(b.name)).map((x) => {
          // The same skill can exist in two packages of a monorepo: without the
          // scope, the profile shows two identical tags.
          const repeated = xs.filter((y) => y.name === x.name).length > 1;
          const where = repeated ? ' <span class="sc">' + esc(x.scope.split('/').slice(-2).join('/')) + '</span>' : '';
          return '<span class="rule clk" data-id="' + esc(x.id) + '" style="cursor:pointer">' + esc(x.name) + where + '</span>';
        }).join('') +
        '</div></div>';
    }
    return out;
  };

  $('#main').innerHTML =
    '<div class="back" data-back-people>← People</div>' +
    '<h1><span class="avatar big">' + esc(initials(p.name)) + '</span>' + esc(p.name) + '</h1>' +
    '<p class="lede">' + p.created.length + ' pieces created, ' + p.modified.length + ' touched afterwards, ' +
    p.commits + ' commits on the configuration. From ' + fdate(p.first) + ' to ' + fdate(p.last) + '.</p>' +
    '<div class="path">' + p.emails.map(esc).join(' · ') +
    (p.names.length > 1 ? '<br>Signs as: ' + p.names.map(esc).join(', ') : '') + '</div>' +
    group('Created', p.created, 'Has not created any piece in this repository.') +
    group('Touched afterwards', p.modified, 'Has not modified anyone else\'s pieces.');

  $('#main').onclick = (e) => {
    if (e.target.closest('[data-back-people]')) return renderPeople(PEOPLE.repo);
    const c = e.target.closest('[data-id]');
    if (c) return openItem(c.dataset.id);
  };
}

/* ----- mods ----- */
// What each hook event means for the person using the session.
const MOD_EVENTS = {
  'session.start': 'When a session starts (or the mod reloads): sets things up, registers commands and tools.',
  'session.end': 'When the session closes.',
  'tool.call': 'Around every tool call Claude makes: can look, rewrite the call, or block it.',
  'tool.run': 'When the model calls one of the mod\'s own tools: this is the code that answers.',
  'command.run': 'When you type one of the mod\'s slash commands.',
  'prompt.submit': 'When you send a message: can read or rewrite it before Claude sees it.',
  'prompt.compose': 'While the system prompt is built: can add or change instructions Claude gets.',
  'ui.render': 'When the interface draws one of its pieces: the mod draws its panel, band or rows.',
  'ui.press': 'When you click or press a key on something the mod drew.',
  'ui.focus': 'When one of its panels gains or loses focus.',
  'ui.close': 'When you close one of its panels.',
  'model.call': 'Around calls to the model.',
};
const MOD_SURFACES = {
  'panel': 'A panel beside or above the chat.', 'band above the prompt': 'A row just above where you type.',
  'row under tool calls': 'Extra lines under a tool call in the transcript.', 'status line': 'Text in the status line.',
  'toasts': 'Short pop-up notices.', 'sound': 'Plays sounds.',
};
const MOD_REACH = {
  'runs processes': 'Starts programs on your Mac (with your user\'s permissions).',
  'reads or writes files': 'Reads or writes files on disk.', 'calls a model': 'Makes its own calls to a Claude model (they cost tokens).',
  'runs on a timer': 'Does things periodically, without you acting.', 'registers a subagent': 'Adds a subagent type Claude can delegate to.',
};

function renderMods() {
  const sec = (title, blurb, body) => (body ? '<div class="md-sec"><div class="small"><b>' + title + '</b> <span class="muted">— ' + blurb + '</span></div>' + body + '</div>' : '');
  const item = (k, v) => '<div class="md-item"><div><code>' + esc(k) + '</code></div><div>' + v + '</div></div>';
  let h = '<h1>Mods</h1><p class="lede">Changes Claude Code makes to its own interface and behaviour: panels, bands, status line, toasts, ' +
    'commands, tools for the model and hooks on what happens in the session. They live in <code>~/.claude/mods/</code> and run as you. ' +
    'Open one to see what each part does. This lists them; it does not edit them.</p>';
  if (!MODS.length) h += '<div class="card"><div class="desc">No folder in <code>~/.claude/mods/</code>.</div></div>';
  for (const m of MODS) {
    const cmdDesc = new Map((m.commandDetails || []).map((c) => [c.name, c.description]));
    const tools = m.toolDetails && m.toolDetails.length ? m.toolDetails : m.tools.map((t) => ({ name: t.replace(/^mcp__.+?__/, ''), description: '' }));
    const counts = [m.commands.length && m.commands.length + ' commands', tools.length && tools.length + ' tools', m.hookCount && m.hookCount + ' hooks'].filter(Boolean).join(' · ');
    h += '<details class="piece" style="margin-top:10px"><summary><div class="sum-main"><b>' + esc(m.name) + '</b>' +
      (m.version ? ' <span class="tag">v' + esc(m.version) + '</span>' : '') +
      ' <span class="tag ' + (m.active ? 'ok' : '') + '">' + (m.active ? 'active' : 'not loaded') + '</span>' +
      (counts ? ' <span class="small muted">' + counts + '</span>' : '') +
      '<div class="desc">' + (m.description ? esc(m.description) : 'No description.') + '</div></div></summary><div class="body">' +
      (m.active && m.activeVia ? '<div class="desc small">Loaded through <code>' + esc(m.activeVia) + '</code>' +
        (m.activeVia === 'CLAUDE_CODE_PLUGIN_DIRS' ? ' (the env block of your settings.json points Claude Code at its folder).' : '.') + '</div>' : '') +
      (!m.hasManifest ? '<div class="desc warn-text">No <code>.claude-plugin/plugin.json</code>: Claude Code will not load it.</div>' : '') +
      sec('Slash commands', 'what you can type', m.commands.map((c) => item(c, esc(cmdDesc.get(c) || 'No description.'))).join('')) +
      sec('Tools for the model', 'Claude can call these by itself; they are permissioned as mcp__' + esc(m.name) + '__<tool>',
        tools.map((t) => item(t.name, esc(t.description || 'No description.'))).join('')) +
      sec('Hooks', 'moments of the session where its code runs',
        m.hooks.map((x) => item(x.event + (x.count > 1 ? ' ×' + x.count : ''), esc(MOD_EVENTS[x.event] || 'An engine event.'))).join('')) +
      sec('Draws on', 'where you see it', m.surfaces.map((x) => item(x, esc(MOD_SURFACES[x] || ''))).join('')) +
      sec('Reach', 'what it can do beyond drawing', m.reach.map((x) => item(x, '<span class="warn-text">' + esc(MOD_REACH[x] || '') + '</span>')).join('')) +
      '<details class="tl-rules" style="margin-top:10px"><summary>' + m.fileCount + ' files · ' + m.sourceLines + ' lines of hooks</summary><div class="desc small">' +
      m.files.map(esc).join('<br>') + '</div></details></div></details>';
  }
  $('#main').innerHTML = h;
  $('#main').onclick = null;
}

/* ----- listados ----- */
function renderList(kind) {
  const info = DATA.kinds[kind];
  const items = DATA.items.filter((i) => i.kind === kind && i.role !== 'doc');
  const groups = {};
  items.forEach((i) => { (groups[i.scope] ??= []).push(i); });
  let h = '<h1>' + info.label + '</h1><p class="lede">' + esc(info.blurb) + '</p>';
  if (!items.length) h += '<div class="card"><div class="desc">There is no piece of this kind.</div></div>';
  for (const [scope, list] of Object.entries(groups)) {
    h += '<h2 class="sec">' + esc(scope) + ' · ' + list.length + '</h2>';
    for (const it of list) {
      h += '<div class="card clk" data-id="' + it.id + '"><div class="ttl">' + esc(it.title) +
        (it.name !== it.title ? ' <span class="tag">' + esc(it.name) + '</span>' : '') +
        (it.findings ? ' <span class="tag ' + SEV[it.worst] + '">' + it.findings +
          (it.findings === 1 ? ' finding' : ' findings') + '</span>' : '') +
        (it.mentionedIn ? ' <span class="tag">mentioned in ' + it.mentionedIn + '</span>' : '') + '</div>' +
        (it.description ? '<div class="desc">' + esc(it.description.slice(0, 260)) +
          (it.description.length > 260 ? '…' : '') + '</div>' : '<div class="desc" style="opacity:.6">No description.</div>') +
        '</div>';
    }
  }
  $('#main').innerHTML = h;
  $('#main').onclick = (e) => { const c = e.target.closest('[data-id]'); if (c) openItem(c.dataset.id); };
}

/* ----- detalle ----- */
async function openItem(id) {
  cur = await (await fetch('/api/item?id=' + id)).json();
  text = cur.content; orig = cur.content;
  tab = cur.format === 'json' ? 'ui' : 'leer';
  renderItem();
}
function renderItem() {
  const dirty = text !== orig;
  const tabs = cur.format === 'json'
    ? [['ui', 'Overview'], ['raw', 'JSON']]
    : [['leer', 'Read'], ['raw', 'Edit']];
  let h = '<div class="back" data-back>← ' + (openPerson ? 'Profile' : esc(DATA.kinds[cur.kind].label)) + '</div>' +
    '<h1>' + esc(cur.title) + '</h1>' +
    (cur.description ? '<p class="lede">' + esc(cur.description) + '</p>' : '') +
    '<div class="path">' + esc(cur.displayPath) + '</div>' +
    // A skill's own page is where the measurement is worth most: it is the
    // moment you are deciding whether to keep, rewrite or delete it.
    (cur.bench
      ? '<div class="card"><div class="ttl">Measured by <code>' + esc(cur.bench.name) + '</code> ' +
        scoreTag(cur.bench.meanDelta, cur.bench.ablation, cur.bench.overallScore) +
        '</div><div class="desc" style="margin-top:5px">' +
        cur.bench.cases + ' cases, ' + cur.bench.runs + ' run' + (cur.bench.runs === 1 ? '' : 's') +
        ', last on ' + fwhen(cur.bench.startedAt) + ' · score ' + n2(cur.bench.overallScore) +
        '. <span class="rule clk" data-go="evals" style="cursor:pointer">See the bench</span></div>' +
        (cur.bench.via === 'symlink (not loaded)'
          ? '<div class="desc" style="color:var(--err);margin-top:6px">The bench <b>symlinks</b> ' +
            'this agent, and a symlink under <code>agents/</code> is never loaded. Whatever that ' +
            'run scored, it was not measuring this file. Replace the link with a copy.</div>'
          : cur.bench.stale
            ? '<div class="desc" style="color:var(--warn);margin-top:6px">The bench holds an ' +
              '<b>older copy</b> than this file. The last run measured a version you have since ' +
              'edited — re-copy it before reading that number as current.</div>'
            : '') + '</div>'
      : cur.kind === 'skill' || cur.kind === 'agent'
        ? '<div class="desc" style="margin:9px 0 2px;opacity:.75">No bench measures this ' +
          cur.kind + '. Worth one if being ignored is expensive, the right answer is checkable, ' +
          'and it needs no external service.</div>'
        : '') +
    (cur.usage
      ? '<div class="desc" style="margin:4px 0 2px;opacity:.75">' + (cur.usage.calls
        ? 'Fired <b>' + cur.usage.calls + '</b> times across ' + cur.usage.sessions +
          ' sessions, last on ' + fwhen(cur.usage.last) + '.'
        : cur.usage.manual
          ? 'Never fires on its own: it is marked <code>disable-model-invocation</code>, so only you invoke it.'
          : 'Has never fired in any recorded session. Its <code>description</code> is what activates ' +
            'a skill — if you expected it to, that is the line to rewrite.') + '</div>'
      : '') +
    '<div class="tabs">' + tabs.map(([t, l]) =>
      '<div class="tab' + (tab === t ? ' on' : '') + '" data-t="' + t + '">' + l + '</div>').join('') + '</div>';

  h += pieceFindings();
  if (tab === 'ui' && cur.format === 'json') h += jsonUI() + history();
  else if (tab === 'leer') h += '<div class="md">' + md(text) + '</div>' + actions();
  else h += '<textarea id="raw" spellcheck="false">' + esc(text) + '</textarea>';

  // The bar only when there is something to save. It used to sit there with the
  // buttons greyed out in the structured view and on leaving the editor without
  // touching anything, implying there were pending changes.
  if (tab !== 'leer') h += '<div class="bar' + (dirty ? '' : ' oculta') + '">' +
    '<button id="save"' + (dirty ? '' : ' disabled') + '>Save</button>' +
    '<button class="ghost" id="reset"' + (dirty ? '' : ' disabled') + '>Discard</button>' +
    '<span class="msg' + (dirty ? ' warn' : '') + '" id="msg">' + (dirty ? 'unsaved changes' : '') + '</span></div>';

  $('#main').innerHTML = h;
  wire();
}


function history() {
  const g = cur.git || {};
  if (!g.tracked) {
    const why = g.reason === 'outside a repository'
      ? 'This piece is not inside a git repository, so there is no authorship to show: only the file date.'
      : 'Git does not track this file (' + esc(g.reason || 'no history') + '), so there is no authorship to show.';
    return '<h2 class="sec">History</h2><div class="card"><div class="desc">' + why +
      (cur.mtime ? ' Last modified on ' + fdate(cur.mtime) + '.' : '') + '</div></div>';
  }
  const { creator, lastChange, commits, authors } = g.history;
  const link = (c) => cur.remote
    ? '<a href="' + esc(cur.remote) + '/commit/' + esc(c.hash) + '" target="_blank" rel="noopener">' + esc(c.hash.slice(0, 7)) + '</a>'
    : '<code>' + esc(c.hash.slice(0, 7)) + '</code>';

  let h = '<h2 class="sec">History</h2><div class="card">' +
    '<div class="ttl">Created by ' + esc(creator.author) + '<span class="tag">' + fdate(creator.date) + '</span></div>' +
    '<div class="desc">Last change: ' + esc(lastChange.author) + ', ' + fdate(lastChange.date) + '. ' +
    commits + (commits === 1 ? ' change in total' : ' changes in total') +
    (authors.length > 1 ? ', by ' + authors.length + ' people' : '') + '.</div>';

  if (authors.length > 1) {
    h += '<div class="rules" style="margin-top:10px">' + authors.map((a) =>
      '<span class="rule">' + esc(a.author) + ' <b style="cursor:default">' + a.commits + '</b></span>').join('') + '</div>';
  }

  h += '<table style="margin-top:12px"><tr><th>When</th><th>Who</th><th>What</th><th>Lines</th></tr>' +
    g.changes.map((c) => '<tr><td>' + fdate(c.date) + '</td><td>' + esc(c.author) + '</td>' +
      '<td>' + esc(c.subject) + ' ' + link(c) + '</td>' +
      '<td class="cmd" style="white-space:nowrap">' +
      (c.added ? '<span style="color:var(--ok)">+' + c.added + '</span> ' : '') +
      (c.removed ? '<span style="color:var(--err)">−' + c.removed + '</span>' : '') + '</td></tr>').join('') +
    '</table></div>';
  return h;
}

/** The auditor's review, beside what you have. It goes at the very top: it is
 *  the first thing you want on opening a piece, not a footnote. */
function pieceFindings() {
  let h = '';
  if (cur.findings && cur.findings.length) {
    h += '<div class="card"><div class="ttl">Audit findings<span class="tag err">' +
      cur.findings.length + '</span></div>' +
      '<div class="desc" style="margin-bottom:10px">What the last audit said about this piece. ' +
      'It sits beside what you have, changing nothing.</div>' +
      cur.findings.map((f) => '<div class="perm" style="display:block">' +
        '<div class="ttl" style="font-size:13.5px"><span class="tag ' +
        (f.severity === 'alta' ? 'err' : f.severity === 'media' ? 'warn' : '') + '">' + esc(f.severity) + '</span>' +
        esc(f.title) + '</div>' +
        '<div class="desc" style="margin-top:4px">' + esc(f.what) + '</div>' +
        '<div class="desc" style="margin-top:4px"><b>Proposal:</b> ' + esc(f.proposal) + '</div>' +
        (f.notion
          ? '<div class="desc" style="margin-top:7px"><a href="' + esc(f.notion.url) + '" target="_blank" rel="noopener">' +
            'Open the finding in the tracker</a>' +
            (f.notion.recurrences > 1 ? ' · seen ' + f.notion.recurrences + ' times' : '') + '</div>' +
            copyBlock('/lp:task --from-finding ' + f.notion.url)
          : '<div class="desc" style="margin-top:7px">Not published to a tracker yet.</div>') +
        '</div>').join('') + '</div>';
  }
  if (cur.mentions && cur.mentions.length) {
    h += '<div class="card"><div class="ttl">Mentioned in another finding<span class="tag">' +
      cur.mentions.length + '</span></div>' +
      '<div class="desc" style="margin-bottom:9px">The finding hangs off another file but talks about this ' +
      'piece. It happens with hooks: the problem is declared in <code>settings.json</code> and points at a ' +
      'script living elsewhere.</div>' +
      cur.mentions.map((f) => '<div class="perm" style="display:block">' +
        '<div class="ttl" style="font-size:13.5px"><span class="tag ' + (SEV[f.severity] || '') + '">' +
        esc(f.severity) + '</span>' + esc(f.title) + '</div>' +
        '<div class="desc" style="margin-top:4px">' + esc(f.what) + '</div>' +
        '<div class="desc" style="margin-top:4px"><b>Proposal:</b> ' + esc(f.proposal) + '</div>' +
        '<div class="desc" style="margin-top:5px">Hangs off <code>' + esc(f.path) +
        (f.line ? ':' + f.line : '') + '</code></div></div>').join('') + '</div>';
  }
  return h;
}

function actions() {
  let h = history() + '<h2 class="sec">Actions</h2>';
  const label = DATA.kinds[cur.kind].one;
  h += '<div class="card"><div class="ttl">Audit with Claude</div>' +
    '<div class="desc">Copy this into Claude Code: it tells you whether this piece fires when it should and whether it overlaps another.</div>' +
    copyBlock('Audit the ' + label + ' "' + cur.name + '" (' + cur.displayPath + '). Check whether its ' +
      'description fires in real cases, whether it overlaps another piece, whether the prompt is longer ' +
      'than it needs to be, and what obstacles it fails to report. Report first, change nothing.') + '</div>';
  if (cur.remote && cur.relPath) {
    const title = 'Improve ' + label + ': ' + cur.name;
    const bodyTxt = 'File: ' + cur.relPath + '\n\nWhat is wrong:\n- \n\nWhat it should do:\n- \n';
    const url = cur.remote + '/issues/new?title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(bodyTxt);
    h += '<div class="card"><div class="ttl">Open an issue in the repo</div>' +
      '<div class="desc">For the technical things that do not go through your team\'s board. If work is ' +
      'tracked elsewhere, the finding above is the better route.</div>' +
      '<div class="row"><a href="' + esc(url) + '" target="_blank" rel="noopener"><button>Create a GitHub issue</button></a></div>' +
      copyBlock('gh issue create --repo ' + cur.remote.replace('https://github.com/', '') +
        ' --title "' + title + '" --body "Fichero: ' + cur.relPath + '"') + '</div>';
  }
  return h;
}

function parsed() { try { return JSON.parse(text); } catch { return null; } }
function setObj(o) { text = JSON.stringify(o, null, 2) + '\n'; renderItem(); }

// The rules above are not the whole story once auto mode is on: the decision
// leaves your machine. This card is where the panel says so, because nothing
// else in the file does — `defaultMode: "auto"` is four characters that move the
// permission decision to a classifier with rules of its own.
const AUTO_SECTIONS = [
  ['environment', 'What the classifier is told about your setup before it judges anything.'],
  ['allow', 'Carved out as fine: the classifier lets these through even when a block rule looks like it fits.'],
  ['soft_deny', 'Blocked unless what you asked for clearly authorises it.'],
  ['hard_deny', 'Blocked always. Your intent does not clear these, and neither does an allow rule.'],
  ['deny', 'Your own additions to the unconditional list.'],
];

function autoCard(p, { mode, grant, auto, classifyAllShell }) {
  const off = (p.permissions || {}).disableAutoMode || p.disableAutoMode;
  const live = mode === 'auto' && grant.granted;
  let h = '<div class="card"><div class="ttl">Auto mode — who decides once it is on ' +
    (live ? '<span class="tag acc">default here</span>'
      : mode === 'auto' ? '<span class="tag warn">written here, not granted</span>' : '') +
    (off ? ' <span class="tag err">turned off</span>' : '') + '</div>' +
    '<div class="desc" style="margin-bottom:10px">In auto mode Claude stops asking you: every action ' +
    'that would have raised a prompt goes instead to a classifier on Anthropic\'s servers, which ' +
    'reads the action in context and approves it, holds it for review or blocks it. It decides from ' +
    'its own rules, not from the allow and deny lists on this page — so a rule like ' +
    '<code>Bash(gh pr *)</code> removes the prompt, and nothing more. A denial shows up in the ' +
    'session as <code>automode-blocked</code>, not as a permission prompt you can answer.</div>';

  const rows = [
    ['Default mode in this file', esc(mode) + (mode === 'auto' ? '' : ' — auto mode can still be turned on by hand, or by your global default')],
    ['Can "auto" be granted from this file', grant.granted ? 'Yes' : 'No — ' + esc(grant.text)],
    ['autoMode.classifyAllShell', classifyAllShell
      ? 'On: every Bash allow rule is suspended while auto mode runs, so every command is classified'
      : 'Off (the default): a Bash allow rule still skips the prompt, the classifier\'s hard_deny still blocks'],
    ['disableAutoMode', off ? String(off) + ' — auto mode is deliberately off in this scope' : 'Not set'],
  ];
  h += '<table>' + rows.map((r) => '<tr><td>' + r[0] + '</td><td class="cmd">' + r[1] + '</td></tr>').join('') + '</table>';

  const present = AUTO_SECTIONS.filter(([k]) => Array.isArray(auto[k]) && auto[k].length);
  if (present.length) {
    h += '<div class="desc" style="margin:13px 0 4px"><b>The classifier\'s own rules, from this file</b></div>';
    for (const [k, blurb] of present) {
      h += '<div class="desc" style="margin-top:8px"><code>autoMode.' + k + '</code> ' +
        '<span class="tag">' + auto[k].length + '</span> — ' + blurb + '</div>' +
        '<ul class="rules">' + auto[k].map((r) => '<li>' + (r === '$defaults'
          ? '<i>$defaults</i> — the shipped rules, inherited at this position'
          : esc(String(r))) + '</li>').join('') + '</ul>';
    }
  } else {
    h += '<div class="desc" style="margin-top:13px">This file adds no rules of its own, so the ' +
      'classifier runs on the ones Claude Code ships. To read them, and the ones any other scope ' +
      'adds, run:</div>' + copyBlock('claude auto-mode config');
  }
  return h + '</div>';
}

function jsonUI() {
  const p = parsed();
  if (!p) return '<div class="card"><div class="msg err">This JSON is not valid. Fix it in the JSON tab.</div></div>';
  const perm = p.permissions || {}, allow = perm.allow || [], deny = perm.deny || [], ask = perm.ask || [];
  const isGlobal = cur.scope === 'Global';
  // `manual` is the flag's name for the same thing settings call `default`.
  const mode = perm.defaultMode === 'manual' ? 'default' : (perm.defaultMode || 'default');
  const auto = p.autoMode || {};
  const classifyAllShell = auto.classifyAllShell === true;
  const grant = autoModeGrant(cur.name, isGlobal);
  let h = '<div class="card"><div class="ttl">How a session starts in this scope</div>' +
    '<div class="desc" style="margin-bottom:10px">This is the control point: it decides whether Claude can start editing straight away or has to go through you.</div>' +
    '<select id="mode">' + MODES.map(([v, l]) =>
      '<option value="' + v + '"' + (mode === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
    (mode === 'auto' && !grant.granted
      ? '<div class="desc" style="margin-top:9px;color:var(--warn)">' + esc(grant.text) + '</div>' : '') +
    '</div>';

  h += autoCard(p, { mode, grant, auto, classifyAllShell });

  const section = (titleTxt, descTxt, rules, key) => {
    let s = '<div class="card"><div class="ttl">' + titleTxt + ' <span class="tag">' + rules.length + '</span></div>' +
      '<div class="desc" style="margin-bottom:6px">' + descTxt + '</div>';
    if (!rules.length) s += '<div class="desc" style="opacity:.6">No rules.</div>';
    rules.forEach((r, i) => {
      const e = explain(r);
      const n = key === 'allow' ? classifierNote(r, { classifyAllShell }) : null;
      s += '<div class="perm"><code>' + esc(r) + '</code><div class="ex">' + esc(e.text) +
        (e.level === 'broad' ? ' <span class="tag warn">broad</span>' : '') +
        (e.level === 'outbound' ? ' <span class="tag err">outbound</span>' : '') +
        (n ? ' <span class="tag ' + n.level + '" title="' + esc(n.title) + '">' + esc(n.label) + '</span>' : '') +
        adviceBlock(r, key, isGlobal, cur.name) +
        '</div><span class="x" data-del="' + key + ':' + i + '">&times;</span></div>';
    });
    s += '<div class="row"><input type="text" id="add_' + key + '" placeholder="Bash(npm test *)">' +
      '<button class="ghost" data-add="' + key + '">Add</button></div></div>';
    return s;
  };
  h += section('What it can do without asking you',
    'Every rule is an open door. The fewer and the narrower, the better. ' +
    'In auto mode a rule here buys you the prompt, not the verdict: the classifier\'s own ' +
    'hard_deny blocks regardless' + (classifyAllShell
      ? ', and classifyAllShell suspends every Bash rule below.'
      : ', and autoMode.classifyAllShell would suspend every Bash rule below.'), allow, 'allow');
  h += section('What it must always ask about',
    'Forces the prompt back, even for something that would otherwise run on its own. The list ' +
    'almost nobody uses: it is how you keep one command visible without banning it.', ask, 'ask');
  h += section('What it is forbidden to do', 'This always wins over the above, in every mode.', deny, 'deny');

  const rows = [];
  for (const [ev, arr] of Object.entries(p.hooks || {}))
    for (const g of arr || []) for (const hk of g.hooks || [])
      rows.push([ev, g.matcher || '(everything)', hk.command || '', hk.async ? 'in the background' : (hk.timeout ? hk.timeout + 's max' : '')]);
  if (rows.length) h += '<div class="card"><div class="ttl">What runs on its own <span class="tag">' + rows.length + '</span></div>' +
    '<div class="desc" style="margin-bottom:8px">Fires without asking you when the event happens. This is what deserves the closest look.</div>' +
    '<table><tr><th>When</th><th>On what</th><th>What it runs</th><th></th></tr>' +
    rows.map((r) => '<tr><td>' + esc(r[0]) + '</td><td class="cmd">' + esc(r[1]) + '</td><td class="cmd">' +
      esc(r[2].length > 170 ? r[2].slice(0, 170) + '…' : r[2]) + '</td><td>' + esc(r[3]) + '</td></tr>').join('') +
    '</table><div class="desc" style="margin-top:9px">To change them, use the JSON tab.</div></div>';

  const rest = Object.entries(p).filter(([k]) => !['permissions', 'hooks', 'autoMode'].includes(k));
  if (rest.length) h += '<div class="card"><div class="ttl">Other settings</div><table>' + rest.map(([k, v]) =>
    '<tr><td><code>' + esc(k) + '</code></td><td class="cmd">' + esc(typeof v === 'object' ? JSON.stringify(v) : String(v)) + '</td></tr>').join('') + '</table></div>';
  return h;
}

function wire() {
  const main = $('#main');
  main.onclick = (e) => {
    if (e.target.closest('[data-back]')) {
      if (openPerson) return renderPerson(openPerson);
      return go(cur.kind);
    }
    const nav = e.target.closest('[data-go]');
    if (nav) return go(nav.dataset.go);
    const t = e.target.closest('.tab');
    if (t) {
      if (tab === 'raw') { const ta = $('#raw'); if (ta) text = ta.value; }
      tab = t.dataset.t;
      renderItem();
      // With findings and history in front of it, the editor sits far below:
      // switching tab and seeing nothing happen is disorienting. Only on a tab
      // change: renderItem() also runs when editing a permission, and moving
      // the scroll there would lose your place.
      const ta = $('#raw');
      if (tab === 'raw' && ta) {
        ta.scrollIntoView({ block: 'start', behavior: 'smooth' });
        ta.focus({ preventScroll: true });
      } else {
        $('#main').scrollTop = 0;
      }
      return;
    }
    const d = e.target.closest('[data-del]');
    if (d) { const [k, i] = d.dataset.del.split(':'); const p = parsed(); p.permissions[k].splice(+i, 1); return setObj(p); }
    const a = e.target.closest('[data-add]');
    if (a) { const k = a.dataset.add, inp = $('#add_' + k), v = inp.value.trim(); if (!v) return;
      const p = parsed(); p.permissions ??= {}; p.permissions[k] ??= []; p.permissions[k].push(v); return setObj(p); }
    copyHandler(e);
  };
  const mode = $('#mode');
  if (mode) mode.onchange = () => { const p = parsed(); p.permissions ??= {};
    if (mode.value === 'default') delete p.permissions.defaultMode; else p.permissions.defaultMode = mode.value;
    setObj(p); };
  const ta = $('#raw');
  if (ta) ta.oninput = () => { text = ta.value; const d = text !== orig, m = $('#msg');
    let bad = false; if (cur.format === 'json') { try { JSON.parse(text); } catch { bad = true; } }
    ta.classList.toggle('bad', bad);
    m.textContent = bad ? 'invalid JSON' : (d ? 'unsaved changes' : '');
    m.className = 'msg' + (bad ? ' err' : (d ? ' warn' : ''));
    $('#save').disabled = !d || bad; $('#reset').disabled = !d;
    // Appears on the first change and goes away if you undo it by hand.
    const barra = $('.bar');
    if (barra) barra.classList.toggle('oculta', !d && !bad); };
  const rst = $('#reset'); if (rst) rst.onclick = () => { text = orig; renderItem(); };
  const sv = $('#save'); if (sv) sv.onclick = async () => {
    const r = await (await fetch('/api/item', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: cur.id, content: text }) })).json();
    const m = $('#msg');
    if (r.error) { m.textContent = r.error; m.className = 'msg err'; return; }
    orig = text; m.textContent = 'saved · backup at ' + r.backup; m.className = 'msg ok';
    $('#save').disabled = true; $('#reset').disabled = true;
    // A moment to read the confirmation, then the bar retires.
    setTimeout(() => { const b = $('.bar'); if (b && text === orig) b.classList.add('oculta'); }, 2200); };
}
boot();

// Exposed for debugging from the browser console.
Object.assign(window, { go, openItem, md, explain });
// Object.assign would copy the value, not the getter: DATA changes, so it goes separately.
Object.defineProperty(window, 'DATA', { get: () => DATA });
