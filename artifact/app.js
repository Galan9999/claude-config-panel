// Claude Config Panel — the artifact edition.
//
// Each person reads their own folders in the browser (or loads the JSON the
// Node collector wrote), sees the same views the local panel has, and can ask
// Claude to audit it. What is saved goes to that person's private space in the
// artifact's database: nobody else, the owner included, can read it.

import {
  DEFAULT_EXCLUDE, discoverRoots, readScope, listTranscripts, scanUsage, shapeUsage, readBench,
  newContext, assemble, mcpFromClaudeJson, validateSnapshot, excludedBy, compilePatterns,
} from './core.js';
import { explain, MODES, autoModeGrant, classifierNote } from './permissions.js';
import { advise, scopeAdvice } from './advice.js';
import { esc, fdate, fwhen } from './util.js';
import { t, LANGS, getLang, setLang } from './i18n.js';

const $ = (s, r = document) => r.querySelector(s);
const main = () => $('#main');

/* ------------------------------------------------------------------ state */

const S = {
  snap: null, saved: false, savedAt: null, origin: null,
  db: null, user: null, sample: null, downloads: null, uid: null, capsReady: false, loadingSaved: false,
  found: { scopes: [], benches: [], transcripts: null, claudeJson: null, roots: [] },
  pick: new Set(), patterns: [...DEFAULT_EXCLUDE], name: '', countUsage: true,
  building: null, stop: false,
  audits: [], audit: null, auditing: null, auditLang: 'en', auditScope: 'all',
  filters: { kind: 'skill', scope: 'all', q: '' },
};

try { const p = JSON.parse(localStorage.getItem('ccp.prefs') || 'null'); if (p) { S.patterns = p.patterns || S.patterns; S.name = p.name || ''; S.auditLang = p.lang || 'en'; if (p.ui) setLang(p.ui); } } catch { /* storage unavailable */ }
const savePrefs = () => { try { localStorage.setItem('ccp.prefs', JSON.stringify({ patterns: S.patterns, name: S.name, lang: S.auditLang, ui: getLang() })); } catch { /* storage unavailable */ } };

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}

/* ------------------------------------------------------------------ views */

const VIEWS = [
  ['overview', 'Overview', '◎'],
  ['pieces', 'Pieces', '◆'],
  ['permissions', 'Permissions', '⚿'],
  ['automation', 'Runs on its own', '⚡'],
  ['routines', 'Routines', '◷'],
  ['mcp', 'MCP servers', '⌘'],
  ['mods', 'Mods', '◫'],
  ['usage', 'Usage', '▤'],
  ['evals', 'Skill evals', '△'],
  ['audit', 'Audit', '✓'],
  ['load', 'Load my config', '⇪'],
];
const route = () => { const h = location.hash.replace('#', ''); return VIEWS.some((v) => v[0] === h) ? h : (S.snap ? 'overview' : 'load'); };
const go = (v) => { if (location.hash !== '#' + v) location.hash = v; else render(); };
window.addEventListener('hashchange', () => render());

function nav() {
  const v = route();
  const counts = S.snap ? {
    pieces: allItems().length,
    permissions: allSettings().reduce((a, s) => a + s.permissions.allow.length, 0),
    automation: allHooks().length + allItems().filter((i) => i.kind === 'task').length,
    mods: allMods().length,
    mcp: allMcp().length,
    routines: allItems().filter((i) => i.kind === 'task').length + ((S.snap.routines && S.snap.routines.cloud) || []).length,
    evals: (S.snap.benches || []).length,
    audit: S.audits.length || '',
  } : {};
  $('#nav').innerHTML = VIEWS.map(([id, label, ic], i) =>
    (id === 'load' ? '<div class="navsep"></div>' : '') +
    '<button class="nav' + (id === v ? ' on' : '') + '" data-go="' + id + '"' + (id === v ? ' aria-current="page"' : '') + '>' +
    '<span class="ic" aria-hidden="true">' + ic + '</span>' + t(label) +
    (counts[id] !== undefined && counts[id] !== '' ? '<span class="n">' + counts[id] + '</span>' : '') + '</button>').join('');
  const who = S.snap
    ? esc(S.snap.person && S.snap.person.name ? S.snap.person.name : 'Your config') + '<br>' + fdate(S.snap.generatedAt) +
      ' · ' + (S.saved ? 'saved, private' : 'not saved')
    : t('Your Claude Code setup, read in your browser.');
  $('#who').innerHTML = who + '<div class="langs" role="group" aria-label="' + t('Language') + '">' + LANGS.map(([c, n]) =>
    '<button class="chip' + (c === getLang() ? ' on' : '') + '" data-act="lang" data-l="' + c + '">' + n + '</button>').join('') + '</div>';
}

function render() {
  nav();
  const v = route();
  const m = main();
  if (v !== 'load' && v !== 'audit' && !S.snap) { m.innerHTML = emptyState(); return; }
  m.innerHTML = ({ overview: vOverview, pieces: vPieces, permissions: vPermissions, automation: vAutomation, mods: vMods, mcp: vMcp, routines: vRoutines,
    usage: vUsage, evals: vEvals, audit: vAudit, load: vLoad })[v]();
  if (v === 'load') wireLoad();
  m.scrollTop = 0;
}

document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); go(g.dataset.go); return; }
  const a = e.target.closest('[data-act]');
  if (a && ACTIONS[a.dataset.act]) { e.preventDefault(); ACTIONS[a.dataset.act](a); }
});

/* ---------------------------------------------------------- data helpers */

const allItems = () => (S.snap ? S.snap.scopes.flatMap((s) => s.items.map((i) => ({ ...i, scope: s.label, scopeKind: s.kind }))) : []);
const allSettings = () => (S.snap ? S.snap.scopes.flatMap((s) => s.settings.map((x) => ({ ...x, scope: s.label, isGlobal: s.kind === 'global' }))) : []);
const allMods = () => (S.snap ? S.snap.scopes.flatMap((s) => s.mods || []) : []);
const allHooks = () => allSettings().flatMap((s) => s.hooks.map((h) => ({ ...h, scope: s.scope, file: s.file })));
const allMcp = () => (S.snap ? [...S.snap.scopes.flatMap((s) => s.mcp.map((m) => ({ ...m, scope: s.label }))), ...(S.snap.globalMcp || []).map((m) => ({ ...m, scope: m.project || '~/.claude.json' }))] : []);
const pct = (v) => (typeof v === 'number' ? Math.round(v * 100) + '%' : '—');
const signed = (v) => (typeof v === 'number' ? (v > 0 ? '+' : '') + Math.round(v * 100) + ' pts' : '—');
const usageOf = (name) => {
  const u = S.snap && S.snap.usage; if (!u) return null;
  return u.skills.find((s) => s.name === name) || u.skills.find((s) => s.name.endsWith(':' + name)) || null;
};
const manual = (it) => it.meta && (it.meta['disable-model-invocation'] === 'true' || it.meta['disable-model-invocation'] === true);
const KIND = { skill: 'Skills', agent: 'Agents', command: 'Commands', hook: 'Hook scripts', task: 'Scheduled tasks', config: 'Settings & instructions' };
const hasTrigger = (d) => /\b(use (it |this )?(when|for|to)|when the user|úsal[ao]|cuando|whenever|trigger)/i.test(d || '');

function emptyState() {
  return '<h1>Nothing loaded yet</h1><p class="lede">This panel shows what your Claude Code is set up to do: skills, agents, commands, ' +
    'permissions, hooks, MCP servers, how often each skill fires and what your evals measured. It reads your folders in this browser ' +
    'and keeps what you save private to you.</p>' + loadSteps() +
    '<p style="margin-top:18px"><button class="btn pri" data-go="load">Load my config</button></p>';
}

function loadSteps() {
  return '<div class="steps">' +
    '<div class="step"><div class="k">Step 1</div><b>Drop your folders</b><div class="desc">Your <code>~/.claude</code> and the folders where you keep repos. ' +
    'Every <code>.claude</code> inside is found. Nothing is uploaded while you look.</div></div>' +
    '<div class="step"><div class="k">Step 2</div><b>Check what goes in</b><div class="desc">Untick personal folders, edit the exclusion list. ' +
    'Tokens, keys, emails and env values are replaced before anything is kept.</div></div>' +
    '<div class="step"><div class="k">Step 3</div><b>Save it, privately</b><div class="desc">Saved to your own space on this page. ' +
    'Nobody else can open it, including whoever shared the page. Then run an audit.</div></div></div>';
}

/* ----------------------------------------------------------------- mods */

function modCard(m) {
  const chips = (arr, cls) => arr.map((x) => '<span class="tag' + (cls ? ' ' + cls : '') + '">' + esc(x) + '</span>').join(' ');
  const row = (label, body) => body ? '<div class="desc"><b>' + label + '</b> ' + body + '</div>' : '';
  return '<div class="card"><div class="ttl">' + esc(m.name) + (m.version ? ' <span class="tag">v' + esc(m.version) + '</span>' : '') +
    ' <span class="tag ' + (m.active ? 'ok' : '') + '">' + t(m.active ? 'active' : 'not loaded') + '</span></div>' +
    (m.description ? '<div class="desc">' + esc(m.description) + '</div>' : '<div class="desc" style="opacity:.6">No description.</div>') +
    row('Commands', chips(m.commands)) +
    row('Tools', m.tools.length ? m.tools.length + ' for the model · ' + chips(m.tools.slice(0, 6).map((t) => t.replace(/^mcp__[^_]+(?:-[^_]+)*__/, ''))) +
      (m.tools.length > 6 ? ' …' : '') : '') +
    row('Hooks', chips(m.hooks.map((h) => h.event + (h.count > 1 ? ' ×' + h.count : '')))) +
    row('Draws', chips(m.surfaces)) +
    row('Reaches', chips(m.reach, 'warn')) +
    (m.active && m.activeVia ? '<div class="desc muted">Loaded through ' + esc(m.activeVia) + '.</div>' : '') +
    (!m.hasManifest ? '<div class="desc muted">No .claude-plugin/plugin.json: Claude Code will not load it.</div>' : '') +
    '<details><summary class="muted">' + m.fileCount + ' file' + (m.fileCount === 1 ? '' : 's') + ' · ' + m.sourceLines + ' lines of hooks</summary>' +
    '<div class="mono" style="font-size:12px;line-height:1.6">' + m.files.map(esc).join('<br>') + '</div></details></div>';
}

function vMods() {
  const mods = allMods();
  return '<h1>Mods</h1><p class="lede">' + t('Changes Claude Code makes to its own interface and behaviour: panels, bands, status line, toasts, commands and hooks on tool calls. They live in ~/.claude/mods/ and run as you, so what each one registers is worth a read. This lists them; it does not edit them.') + '</p>' +
    (mods.length ? '<div class="stack">' + mods.map(modCard).join('') + '</div>'
      : '<p class="muted">No mods found. They are read from <code>~/.claude/mods/</code>; if you loaded your config before this section existed, load it again.</p>');
}

/* ------------------------------------------------------------- overview */

function attention() {
  const out = [];
  const st = allSettings();
  const broad = [], outbound = [], globalAllow = [];
  for (const s of st) {
    for (const r of s.permissions.allow) {
      const e = explain(r), a = advise(r);
      if (e.level === 'broad' || a.verdict === 'avoid') broad.push(r);
      if (e.level === 'outbound') outbound.push(r);
      if (s.isGlobal) globalAllow.push(r);
    }
  }
  if (broad.length) out.push(['err', broad.length + ' allow rule' + (broad.length > 1 ? 's are' : ' is') + ' wider than it looks', broad.slice(0, 4).join(' · '), 'permissions']);
  if (outbound.length) out.push(['warn', outbound.length + ' rule' + (outbound.length > 1 ? 's act' : ' acts') + ' outside your machine without asking', outbound.slice(0, 3).join(' · '), 'permissions']);
  if (globalAllow.length) out.push(['warn', globalAllow.length + ' allow rules live in a global file', 'They apply in every repo you open, including one you clone to read for five minutes.', 'permissions']);
  const wide = allHooks().filter((h) => !h.matcher || h.matcher === '*');
  if (wide.length) out.push(['warn', wide.length + ' hook' + (wide.length > 1 ? 's run' : ' runs') + ' on every matching event', wide.slice(0, 3).map((h) => h.event).join(' · '), 'automation']);
  const noTimeout = allHooks().filter((h) => h.type === 'command' && h.timeout == null);
  if (noTimeout.length) out.push(['', noTimeout.length + ' hook' + (noTimeout.length > 1 ? 's have' : ' has') + ' no timeout', 'A hung script holds the session until the default limit.', 'automation']);
  const skills = allItems().filter((i) => i.kind === 'skill');
  const noTrig = skills.filter((s) => !manual(s) && !hasTrigger(s.description));
  if (noTrig.length) out.push(['warn', noTrig.length + ' skill descriptions never say when to use them', 'A skill fires only from its description. ' + noTrig.slice(0, 4).map((s) => s.name).join(', '), 'pieces']);
  if (S.snap.usage) {
    const silent = skills.filter((s) => !manual(s) && !usageOf(s.name));
    if (silent.length) out.push(['', silent.length + ' skills have never fired', 'Across ' + S.snap.usage.sessions + ' sessions. ' + silent.slice(0, 4).map((s) => s.name).join(', '), 'usage']);
  }
  const long = allItems().filter((i) => ['skill', 'agent', 'command'].includes(i.kind) && i.lines > 150);
  if (long.length) out.push(['', long.length + ' prompts are over 150 lines', 'Every line is context spent each time they load.', 'pieces']);
  const flat = (S.snap.benches || []).filter((b) => b.latest && typeof b.latest.meanDelta === 'number' && b.latest.meanDelta <= 0 && b.latest.ablation !== 'none');
  if (flat.length) out.push(['warn', flat.length + ' measured skill' + (flat.length > 1 ? 's do' : ' does') + ' not change the answer', flat.map((b) => b.name).join(', '), 'evals']);
  return out;
}

function vOverview() {
  const s = S.snap, items = allItems();
  const n = (k) => items.filter((i) => i.kind === k).length;
  const allow = allSettings().reduce((a, x) => a + x.permissions.allow.length, 0);
  const banner = S.saved
    ? '<div class="banner ok"><span>Saved to your private space ' + (S.savedAt ? fwhen(S.savedAt) : '') + '.</span></div>'
    : '<div class="banner"><span><b>Not saved.</b> This snapshot lives in this tab only.</span>' +
      (S.db && S.uid ? '<button class="btn pri" data-act="save">Save privately</button>' : '') +
      (S.downloads ? '<button class="btn" data-act="download">Download JSON</button>' : '') + '</div>';
  const stats = [[n('skill'), 'skills'], [n('agent'), 'agents'], [n('command'), 'commands'],
    [allHooks().length, 'hooks in settings'], [n('task'), 'scheduled tasks'], [allow, 'allow rules'],
    [allMcp().length, 'MCP servers'], [s.usage ? s.usage.sessions : '—', 'sessions read']];
  const att = attention();
  return '<h1>' + esc(s.person && s.person.name ? s.person.name + "'s setup" : 'Your setup') + '</h1>' +
    '<p class="lede">Read ' + fwhen(s.generatedAt) + ' from ' + (s.source === 'node' ? 'the Node collector' : 'this browser') + ', across ' +
    s.scopes.length + ' place' + (s.scopes.length === 1 ? '' : 's') + ' with Claude configuration.</p>' + banner +
    '<div class="grid">' + stats.map(([v, l]) => '<div class="stat"><b>' + v + '</b><span>' + l + '</span></div>').join('') + '</div>' +
    '<h2 class="sec">What needs a look</h2>' +
    (att.length ? '<div class="stack">' + att.map(([lvl, t, d, v]) =>
      '<div class="card sev ' + (lvl === 'err' ? 'high' : lvl === 'warn' ? 'medium' : 'low') + '"><div class="ttl">' + esc(t) +
      ' <button class="btn" style="margin-left:auto;padding:2px 10px;font-size:12.5px" data-go="' + v + '">Open</button></div><div class="desc">' + esc(d) + '</div></div>').join('') + '</div>'
      : '<p class="muted">Nothing the quick checks catch. Run the audit for a full read.</p>') +
    '<p class="small muted" style="margin-top:10px">These are quick local checks. <a href="#audit">The audit</a> asks Claude for the reasoning behind each one.</p>' +
    '<h2 class="sec">Where the configuration lives</h2><div class="tbl"><table><thead><tr><th>Place</th><th>Repo</th>' +
    ['skill', 'agent', 'command', 'hook'].map((k) => '<th class="num">' + KIND[k] + '</th>').join('') + '<th class="num">Rules</th></tr></thead><tbody>' +
    s.scopes.map((sc) => '<tr><td class="mono">' + esc(sc.label) + '</td><td>' + (sc.remote ? '<a href="' + esc(sc.remote) + '" target="_blank" rel="noopener">' + esc(sc.remote.replace(/^https:\/\/github\.com\//, '')) + '</a>' : '<span class="muted">—</span>') + '</td>' +
      ['skill', 'agent', 'command', 'hook'].map((k) => '<td class="num">' + (sc.items.filter((i) => i.kind === k).length || '·') + '</td>').join('') +
      '<td class="num">' + sc.settings.reduce((a, x) => a + x.permissions.allow.length + x.permissions.ask.length + x.permissions.deny.length, 0) + '</td></tr>').join('') +
    '</tbody></table></div>' + privacyNote();
}

function privacyNote() {
  const p = S.snap.privacy || {};
  const ex = (p.excluded || []).reduce((a, x) => a + x.count, 0);
  return '<h2 class="sec">What was kept out</h2><div class="card small"><div>' + (p.redactions || 0) + ' values redacted by pattern · ' + ex +
    ' items excluded by your list (' + (p.excluded || []).map((x) => '<code>' + esc(x.pattern) + '</code> ' + x.count).join(', ') + ')</div>' +
    '<ul style="margin:8px 0 0;padding-left:18px">' + (p.rules || []).map((r) => '<li class="muted">' + esc(r) + '</li>').join('') + '</ul></div>';
}

/* --------------------------------------------------------------- pieces */

function vPieces() {
  const f = S.filters;
  const items = allItems();
  const kinds = ['skill', 'agent', 'command', 'declared', 'hook', 'task', 'config'].filter((k) => (k === 'declared' ? allHooks().length : items.some((i) => i.kind === k)));
  if (!kinds.includes(f.kind)) f.kind = kinds[0];
  const scopes = [...new Set(items.map((i) => i.scope))];
  const q = f.q.toLowerCase();
  const declared = f.kind === 'declared';
  const list = declared ? allHooks().filter((h) => (f.scope === 'all' || h.scope === f.scope) && (!q || (h.event + ' ' + h.command).toLowerCase().includes(q))) : items.filter((i) => i.kind === f.kind && (f.scope === 'all' || i.scope === f.scope) &&
    (!q || (i.name + ' ' + i.description).toLowerCase().includes(q)));
  const benchFor = benchIndex();
  return '<h1>' + t('Pieces') + '</h1><p class="lede">' + t('Everything Claude can load, by type, grouped by the place it comes from. A skill fires only from its description, so the description is shown first.') + '</p>' +
    '<div class="row" style="margin-bottom:12px"><div class="chips" role="tablist">' + kinds.map((k) =>
      '<button class="chip' + (k === f.kind ? ' on' : '') + '" data-act="kind" data-k="' + k + '">' + t(KIND[k]) + ' ' + (k === 'declared' ? allHooks().length : items.filter((i) => i.kind === k).length) + '</button>').join('') + '</div></div>' +
    '<div class="row" style="margin-bottom:16px"><select id="f-scope" aria-label="' + t('Place') + '"><option value="all">' + t('Every place') + '</option>' +
    scopes.map((s) => '<option' + (s === f.scope ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select>' +
    '<input type="text" id="f-q" placeholder="' + t('Filter by name or description') + '" value="' + esc(f.q) + '" aria-label="Filter"></div>' +
    byScope(list, (i) => i.scope, (i) => (declared ? hookRow(i) : pieceRow(i, benchFor)));
}

/** Rows grouped under one heading per place, the global one first. */
function byScope(list, scopeOf, row) {
  if (!list.length) return '<p class="muted">' + t('Nothing of this kind.') + '</p>';
  const groups = new Map();
  for (const x of list) { const k = scopeOf(x); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
  const keys = [...groups.keys()].sort((a, b) => (a === '~/.claude' ? -1 : b === '~/.claude' ? 1 : a < b ? -1 : 1));
  return keys.map((k) => '<h2 class="sec"><span class="mono">' + esc(k) + '</span> · ' + groups.get(k).length + '</h2><div class="stack">' +
    groups.get(k).map(row).join('') + '</div>').join('');
}

function hookRow(h) {
  return '<div class="card"><div class="ttl"><b>' + esc(h.event) + '</b>' + (h.async ? ' <span class="tag">async</span>' : '') +
    (!h.matcher || h.matcher === '*' ? ' <span class="tag warn">every tool</span>' : ' <code>' + esc(h.matcher) + '</code>') +
    ' <span class="tag">' + esc(h.file) + '</span></div><div class="desc mono small">' + esc(h.command) + '</div></div>';
}

function benchIndex() {
  const m = new Map();
  for (const b of (S.snap.benches || [])) {
    for (const s of b.skills) m.set('skill:' + s, b);
    for (const a of b.agents) m.set('agent:' + a.name, b);
  }
  return m;
}

function pieceRow(i, benchFor) {
  const u = i.kind === 'skill' ? usageOf(i.name) : null;
  const b = benchFor.get(i.kind + ':' + i.name);
  const tags = [];
  tags.push('<span class="tag">' + esc(i.scope) + '</span>');
  if (i.kind === 'skill') {
    if (manual(i)) tags.push('<span class="tag">manual only</span>');
    else if (S.snap.usage) tags.push(u ? '<span class="tag ok">' + u.calls + ' calls</span>' : '<span class="tag warn">never fired</span>');
    if (!manual(i) && !hasTrigger(i.description)) tags.push('<span class="tag warn">no “when”</span>');
  }
  if (b) tags.push('<span class="tag acc">eval ' + (b.latest ? pct(b.latest.overallScore) : 'no runs') + '</span>');
  if (i.lines > 150 && i.kind !== 'config') tags.push('<span class="tag">' + i.lines + ' lines</span>');
  const meta = i.meta || {};
  const kv = [];
  kv.push(['File', '<span class="mono">' + esc(i.path) + '</span>']);
  if (i.lines) kv.push(['Size', i.lines + ' lines']);
  for (const k of ['model', 'tools', 'allowed-tools', 'argument-hint', 'disable-model-invocation']) if (meta[k]) kv.push([k, '<code>' + esc(meta[k]) + '</code>']);
  if (i.git) kv.push(['History', 'created by ' + esc(i.git.createdBy) + ' ' + fdate(i.git.created) + ' · last change ' + esc(i.git.lastBy) + ' ' + fdate(i.git.last) + ' · ' + i.git.commits + ' commits']);
  else if (i.mtime) kv.push(['Modified', fwhen(i.mtime)]);
  if (u) kv.push(['Fired', u.calls + ' times in ' + u.sessions + ' sessions · last ' + fwhen(u.last)]);
  if (b && b.latest) kv.push(['Eval', esc(b.name) + ': score ' + pct(b.latest.overallScore) + ', Δ ' + signed(b.latest.meanDelta) + ' (' + b.latest.casesTotal + ' cases)']);
  if (i.extraFiles && i.extraFiles.length) kv.push(['Also in folder', i.extraFiles.map((x) => '<code>' + esc(x) + '</code>').join(' ')]);
  return '<details class="piece"><summary><div class="sum-main"><div class="ttl"><span>' + esc(i.name) + '</span>' + tags.join('') + '</div>' +
    (i.description ? '<div class="desc">' + esc(i.description.length > 320 ? i.description.slice(0, 320) + '…' : i.description) + '</div>' : '') + '</div></summary>' +
    '<div class="body"><dl class="kv">' + kv.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>').join('') + '</dl>' +
    (i.headings && i.headings.length ? '<pre>' + esc(i.headings.join('\n')) + '</pre>' : '') +
    (i.content ? '<pre>' + esc(i.content) + '</pre>' : i.metaOnly ? '<p class="small muted">Only metadata was kept for this file.</p>' : '') + '</div></details>';
}

/* ---------------------------------------------------------- permissions */

const VERDICT = { keep: ['reasonable', 'ok'], narrow: ['narrow it', 'warn'], drop: ['redundant', ''], avoid: ['reconsider', 'err'] };

function adviceBlock(rule, key, isGlobal, fileName) {
  const a = advise(rule), sc = scopeAdvice(rule, key, fileName, isGlobal);
  const [label, cls] = VERDICT[a.verdict] || VERDICT.keep;
  return '<details class="adv"><summary>why it is like this, and what else it could be</summary><div class="advbody">' +
    '<div><b>' + esc(a.family) + '</b> <span class="tag ' + cls + '">' + label + '</span></div><p>' + esc(a.why) + '</p>' +
    '<p' + (sc.ok ? '' : ' class="warn-text"') + '><b>Where it lives. </b>' + esc(sc.text) + '</p>' +
    (a.better.length ? a.better.map((b) => '<div class="swap"><code>' + esc(b.rule) + '</code><span class="muted">' + esc(b.note) + '</span></div>').join('') : '') +
    '</div></details>';
}

function vPermissions() {
  const st = allSettings();
  const mode = (s) => {
    const m = s.permissions.defaultMode;
    if (!m) return '';
    const label = (MODES.find((x) => x[0] === m) || [m, m])[1];
    const g = m === 'auto' ? autoModeGrant(s.file, s.isGlobal) : null;
    return '<div class="desc"><b>Default mode:</b> ' + esc(label) + (g ? ' <span class="tag ' + (g.granted ? 'ok' : 'warn') + '">' + (g.granted ? 'granted here' : 'ignored here') + '</span><br>' + esc(g.text) : '') + '</div>';
  };
  const list = (s, key) => {
    const rules = s.permissions[key];
    if (!rules.length) return '';
    const cas = s.autoMode && s.autoMode.classifyAllShell;
    return '<h3 style="margin:14px 0 4px;font-size:13px">' + key + ' <span class="muted">' + rules.length + '</span></h3><div>' + rules.map((r) => {
      const e = explain(r), note = classifierNote(r, { classifyAllShell: cas });
      return '<div class="rule"><div class="r"><code>' + esc(r) + '</code> ' +
        (e.level === 'broad' ? '<span class="tag err">broad</span>' : e.level === 'outbound' ? '<span class="tag warn">outbound</span>' : '') +
        (note ? ' <span class="tag warn" title="' + esc(note.title) + '">' + esc(note.label) + '</span>' : '') + '</div>' +
        '<div class="x">' + esc(e.text) + (key !== 'deny' ? adviceBlock(r, key, s.isGlobal, s.file) : '') + '</div></div>';
    }).join('') + '</div>';
  };
  const am = (s) => {
    if (!s.autoMode) return '';
    const a = s.autoMode;
    return '<div class="desc"><b>Auto mode classifier:</b> ' + (a.classifyAllShell ? '<span class="tag warn">classifyAllShell on: every Bash rule is suspended in auto mode</span>' : 'Bash rules still skip the prompt') +
      ['environment', 'allow', 'soft_deny', 'hard_deny', 'deny'].filter((k) => a[k].length).map((k) => '<div><span class="muted">' + k + ':</span> ' + a[k].map((x) => '<code>' + esc(x) + '</code>').join(' ') + '</div>').join('') + '</div>';
  };
  return '<h1>Permissions</h1><p class="lede">Each rule in plain words, flagged when it is wider than it looks or acts outside your machine. A Bash rule is a prefix match: it is worth the worst command line that starts the same way.</p>' +
    '<div class="stack">' + st.map((s) => '<div class="card"><div class="ttl"><span class="mono">' + esc(s.scope) + '</span><span class="tag">' + esc(s.file) + '</span>' +
      (s.local ? '<span class="tag">yours only</span>' : s.isGlobal ? '<span class="tag acc">every project</span>' : '<span class="tag">shared with the team</span>') + '</div>' +
      mode(s) + am(s) + list(s, 'allow') + list(s, 'ask') + list(s, 'deny') +
      (s.permissions.additionalDirectories.length ? '<div class="desc"><b>Extra folders it can reach:</b> ' + s.permissions.additionalDirectories.map((d) => '<code>' + esc(d) + '</code>').join(' ') + '</div>' : '') +
      (s.envKeys.length ? '<div class="desc"><b>Environment variables set</b> (names only): ' + s.envKeys.map((k) => '<code>' + esc(k) + '</code>').join(' ') + '</div>' : '') +
      (!s.permissions.allow.length && !s.permissions.ask.length && !s.permissions.deny.length && !s.permissions.defaultMode ? '<div class="desc">No permission rules in this file.</div>' : '') +
      '</div>').join('') + '</div>';
}


/* ------------------------------------------------------------------ mcp */

function vMcp() {
  const mcp = allMcp();
  return '<h1>' + t('MCP servers') + '</h1><p class="lede">' + t('Where MCP servers are declared, grouped by place. Values of env variables and headers are never read into this page, only their names.') + '</p>' +
    (mcp.length ? byScope(mcp, (m) => m.scope, (m) => '<div class="card"><div class="ttl"><b>' + esc(m.name) + '</b> <span class="tag">' + esc(m.type || '?') + '</span>' +
      (m.source && m.source !== m.scope ? ' <span class="tag">' + esc(m.source) + '</span>' : '') + '</div>' +
      '<div class="desc mono small">' + esc(m.url || [m.command, ...(m.args || [])].filter(Boolean).join(' ')) + '</div>' +
      '<div class="desc small"><b>' + t('Secrets it needs') + '</b> ' + ([...m.envKeys, ...m.headerKeys].map((k) => '<code>' + esc(k) + '</code>').join(' ') || '<span class="muted">' + t('none') + '</span>') + '</div></div>')
      : '<p class="muted">' + t('No MCP servers in the files you loaded. Add ~/.claude.json on the Load page to include the ones Claude Code keeps there.') + '</p>');
}

/* ------------------------------------------------------------- routines */

function vRoutines() {
  const local = allItems().filter((i) => i.kind === 'task');
  const r = S.snap.routines || {};
  const cloud = r.cloud || [], loops = r.loops || [];
  const cloudCard = (c) => '<details class="piece"><summary><div class="sum-main"><div class="ttl"><span>' + esc(c.name) + '</span>' +
    '<span class="tag ' + (c.enabled ? 'ok' : '') + '">' + t(c.enabled ? 'enabled' : 'paused') + '</span></div>' +
    '<div class="desc mono small">' + esc(c.cron || '') + '</div></div></summary><div class="body"><dl class="kv">' +
    (c.nextRun ? '<dt>' + t('Next run') + '</dt><dd>' + fwhen(c.nextRun) + '</dd>' : '') +
    (c.lastRun ? '<dt>' + t('Last run') + '</dt><dd>' + fwhen(c.lastRun) + '</dd>' : '') +
    (c.connectors && c.connectors.length ? '<dt>MCP</dt><dd>' + c.connectors.map((x) => '<code>' + esc(x) + '</code>').join(' ') + '</dd>' : '') +
    '</dl><h3 class="sec">' + t('Definition') + '</h3><pre>' + esc(c.prompt || '') + '</pre></div></details>';
  return '<h1>' + t('Routines') + '</h1><p class="lede">' + t('Everything that fires on a schedule: the local ones are files in ~/.claude/scheduled-tasks, the cloud ones live in your claude.ai account. Each shows its definition.') + '</p>' +
    '<h2 class="sec">' + t('Local routines') + ' · ' + local.length + '</h2>' + byScope(local, (i) => i.scope, (i) => pieceRow(i, new Map())) +
    '<h2 class="sec">' + t('Cloud routines') + ' · ' + cloud.length + '</h2>' +
    (cloud.length ? '<div class="stack">' + cloud.map(cloudCard).join('') + '</div>' : '<p class="muted">' + t('No cloud routines in this snapshot. They are read from your claude.ai account when the config is generated with Claude Code.') + '</p>') +
    '<h2 class="sec">' + t('Session loops') + ' · ' + loops.length + '</h2><p class="small muted">' + t('/loop and session cron jobs live in the memory of a running session, not in a file, so there is nothing to scan; this lists the ones that were active when the config was generated.') + '</p>' +
    (loops.length ? '<div class="stack">' + loops.map((l) => '<div class="card"><div class="ttl mono">' + esc(l.cron || '') + '</div><div class="desc">' + esc(l.prompt || '') + '</div></div>').join('') + '</div>' : '<p class="muted">' + t('None active then.') + '</p>');
}

/* ----------------------------------------------------------- automation */

function vAutomation() {
  const hooks = allHooks();
  const scripts = allItems().filter((i) => i.kind === 'hook');
  const tasks = allItems().filter((i) => i.kind === 'task');
  const status = allSettings().filter((s) => s.statusLine);
  return '<h1>' + t('Runs on its own') + '</h1><p class="lede">' + t('Hooks and scheduled tasks act while you are not looking. This is the part of a configuration that deserves the most attention and usually gets the least.') + '</p>' +
    '<h2 class="sec">' + t('Hooks declared in settings') + '</h2>' + (hooks.length ? '<div class="tbl"><table><thead><tr><th>When</th><th>Matcher</th><th>Runs</th><th class="num">Timeout</th><th>Where</th></tr></thead><tbody>' +
      hooks.map((h) => '<tr><td><b>' + esc(h.event) + '</b>' + (h.async ? ' <span class="tag">async</span>' : '') + '</td><td>' +
        (!h.matcher || h.matcher === '*' ? '<span class="tag warn">every tool</span>' : '<code>' + esc(h.matcher) + '</code>') + '</td>' +
        '<td class="mono small" style="min-width:220px">' + esc(h.command) + '</td><td class="num">' + (h.timeout != null ? h.timeout + ' s' : '<span class="tag">default</span>') + '</td>' +
        '<td class="mono small">' + esc(h.scope) + '<br><span class="muted">' + esc(h.file) + '</span></td></tr>').join('') + '</tbody></table></div>'
      : '<p class="muted">No hooks in the settings you loaded.</p>') +
    (status.length ? '<h2 class="sec">Status line</h2>' + status.map((s) => '<div class="card small"><span class="mono">' + esc(s.scope) + '</span> runs <code>' + esc(s.statusLine) + '</code> on every refresh</div>').join('') : '') +
    '<h2 class="sec">Scheduled tasks</h2>' + (tasks.length ? '<div class="stack">' + tasks.map((t) => pieceRow(t, new Map())).join('') + '</div>' : '<p class="muted">None.</p>') +
    '<h2 class="sec">' + t('Hook and helper scripts') + '</h2>' + (scripts.length ? '<div class="stack">' + scripts.map((t) => pieceRow(t, new Map())).join('') + '</div>' : '<p class="muted">None.</p>');
}

/* ---------------------------------------------------------------- usage */

function hbars(rows, label, value, max) {
  const top = max || Math.max(1, ...rows.map(value));
  return rows.map((r) => '<div class="hbar"><span class="l mono" title="' + esc(label(r)) + '">' + esc(label(r)) + '</span><span class="t"><i style="width:' +
    Math.max(2, (value(r) / top) * 100) + '%"></i></span><span class="v">' + value(r) + '</span></div>').join('');
}

function daysChart(byDay) {
  const map = new Map(byDay);
  const days = [];
  const end = new Date(); end.setHours(0, 0, 0, 0);
  for (let i = 89; i >= 0; i--) { const d = new Date(end - i * 86400000); days.push([d.toISOString().slice(0, 10), map.get(d.toISOString().slice(0, 10)) || 0]); }
  const max = Math.max(1, ...days.map((d) => d[1]));
  const W = 900, H = 64, bw = W / days.length;
  const bars = days.map(([d, v], i) => '<rect x="' + (i * bw + 1).toFixed(1) + '" y="' + (H - 14 - (v / max) * (H - 18)).toFixed(1) + '" width="' + (bw - 2).toFixed(1) + '" height="' + ((v / max) * (H - 18)).toFixed(1) + '" rx="1.5" fill="var(--acc)"><title>' + d + ': ' + v + ' sessions</title></rect>').join('');
  return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Sessions per day, last 90 days">' +
    '<line x1="0" y1="' + (H - 13) + '" x2="' + W + '" y2="' + (H - 13) + '" stroke="var(--line)" stroke-width="1"/>' + bars +
    '<text x="0" y="' + (H - 1) + '" font-size="10" fill="var(--dim)" font-family="ui-monospace,monospace">' + days[0][0] + '</text>' +
    '<text x="' + W + '" y="' + (H - 1) + '" font-size="10" fill="var(--dim)" text-anchor="end" font-family="ui-monospace,monospace">today · peak ' + max + '/day</text></svg>';
}

function vUsage() {
  const u = S.snap.usage;
  if (!u) {
    return '<h1>Usage</h1><p class="lede">Usage comes from the transcripts in <code>~/.claude/projects</code>. Only counts are kept: which skill, agent, command and tool was called, and when.</p>' +
      '<p class="muted">This snapshot has no usage. Load your <code>~/.claude</code> with “Count usage” ticked, or run the collector without <code>--no-usage</code>.</p>';
  }
  const skills = allItems().filter((i) => i.kind === 'skill');
  const silent = skills.filter((s) => !manual(s) && !usageOf(s.name));
  const known = new Set(skills.map((s) => s.name));
  const row = (r, extra) => '<tr><td class="mono">' + esc(r.name) + (extra ? extra(r) : '') + '</td><td class="num">' + r.calls + '</td><td class="num">' + r.sessions + '</td><td class="num">' + fwhen(r.last) + '</td></tr>';
  const table = (rows, extra) => '<div class="tbl"><table><thead><tr><th>Name</th><th class="num">Calls</th><th class="num">Sessions</th><th class="num">Last</th></tr></thead><tbody>' +
    rows.map((r) => row(r, extra)).join('') + '</tbody></table></div>';
  return '<h1>Usage</h1><p class="lede">' + u.sessions + ' sessions between ' + fdate(u.first) + ' and ' + fdate(u.last) + '. Counted from the transcripts on your machine; no prompt or answer is kept.</p>' +
    '<div class="card">' + daysChart(u.byDay) + '</div>' +
    '<h2 class="sec">Where you work</h2><div class="card">' + hbars(u.byProject.slice(0, 12), (r) => r.label, (r) => r.sessions) +
    (u.hiddenSessions ? '<p class="small muted">' + u.hiddenSessions + ' sessions in excluded folders are counted in the total only.</p>' : '') + '</div>' +
    '<h2 class="sec">Skills that fired</h2>' + table(u.skills.slice(0, 40), (r) => (known.has(r.name) || [...known].some((k) => r.name.endsWith(':' + k)) ? '' : ' <span class="tag">plugin or removed</span>')) +
    '<h2 class="sec">Skills that never fired</h2>' + (silent.length ? '<div class="card"><div class="chips">' + silent.map((s) => '<span class="tag warn">' + esc(s.name) + '</span>').join('') +
      '</div><p class="small muted" style="margin:8px 0 0">A skill fires only when its description matches the moment. Skills marked manual-only are left out on purpose.</p></div>' : '<p class="muted">Every skill has fired at least once.</p>') +
    '<h2 class="sec">Subagents</h2>' + (u.agents.length ? table(u.agents.slice(0, 20)) : '<p class="muted">None dispatched.</p>') +
    '<h2 class="sec">Slash commands you typed</h2>' + (u.commands.length ? table(u.commands.slice(0, 25)) : '<p class="muted">None.</p>') +
    '<h2 class="sec">Tools</h2><div class="card">' + hbars(u.tools.slice(0, 15), (r) => r.name, (r) => r.calls) + '</div>' +
    (u.mcpServers.length ? '<h2 class="sec">MCP servers by calls</h2><div class="card">' + hbars(u.mcpServers, (r) => r.name, (r) => r.calls) + '</div>' : '');
}

/* ---------------------------------------------------------------- evals */

function vEvals() {
  const benches = S.snap.benches || [];
  const items = allItems();
  const measured = new Set();
  for (const b of benches) { b.skills.forEach((s) => measured.add('skill:' + s)); b.agents.forEach((a) => measured.add('agent:' + a.name)); }
  const u = S.snap.usage;
  const candidates = u ? u.skills.filter((r) => {
    const it = items.find((i) => i.kind === 'skill' && (i.name === r.name || r.name.endsWith(':' + i.name)));
    return it && !measured.has('skill:' + it.name);
  }).slice(0, 8) : [];
  const score = (v) => '<span class="tag ' + (v == null ? '' : v >= 0.999 ? 'ok' : v >= 0.5 ? 'warn' : 'err') + '">' + pct(v) + '</span>';
  const delta = (d, abl) => abl === 'none' ? '<span class="tag">no baseline</span>' : '<span class="tag ' + (d == null ? '' : d > 0.15 ? 'ok' : d > 0 ? 'warn' : 'err') + '">' + signed(d) + '</span>';
  const benchCard = (b) => {
    const L = b.latest;
    const stale = b.agents.map((a) => {
      const it = items.find((i) => i.kind === 'agent' && (i.name === a.name || i.title === a.name));
      return it && it.fingerprint && a.fingerprint && it.fingerprint !== a.fingerprint ? a.name : null;
    }).filter(Boolean);
    const hist = b.history.filter((h) => typeof h.overallScore === 'number').slice(0, 12).reverse();
    return '<div class="card"><div class="ttl"><h3>' + esc(b.name) + '</h3>' + (b.version ? '<span class="tag">v' + esc(b.version) + '</span>' : '') +
      b.skills.map((s) => '<span class="tag acc">skill ' + esc(s) + '</span>').join('') + b.agents.map((a) => '<span class="tag acc">agent ' + esc(a.name) + '</span>').join('') + '</div>' +
      '<div class="desc mono">' + esc(b.path) + ' · ' + b.cases.length + ' cases' + (b.casesWithoutGrader.length ? ' · <span class="warn-text">' + b.casesWithoutGrader.length + ' without a grader</span>' : '') + '</div>' +
      (stale.length ? '<div class="desc warn-text">The copy of ' + stale.map(esc).join(', ') + ' in this bench differs from the agent in your config: the bench measures an older version.</div>' : '') +
      (L ? '<div class="row" style="margin-top:10px">Latest ' + fdate(L.startedAt) + ': score ' + score(L.overallScore) + ' Δ ' + delta(L.meanDelta, L.ablation) +
        '<span class="muted small">judge ' + esc(L.judgeModel || '?') + (L.costUsd != null ? ' · $' + L.costUsd.toFixed(2) : '') + (L.partial ? ' · partial' : '') + '</span></div>' +
        '<div class="tbl" style="margin-top:10px"><table><thead><tr><th>Case</th><th class="num">With skill</th><th class="num">Without</th><th class="num">Δ</th><th class="num">Fired</th><th class="num">Runs</th></tr></thead><tbody>' +
        L.cases.map((c) => '<tr><td class="mono">' + esc(c.name) + '</td><td class="num">' + score(c.score) + '</td><td class="num">' + pct(c.scoreWithout) + '</td><td class="num">' + delta(c.delta, L.ablation) + '</td><td class="num">' +
          (c.triggerRuns ? c.triggered + '/' + c.triggerRuns : '—') + '</td><td class="num">' + (c.runs ?? '—') + (c.errored ? ' <span class="tag err">' + c.errored + ' errored</span>' : '') + '</td></tr>').join('') + '</tbody></table></div>' +
        (hist.length > 1 ? '<div class="desc">History: ' + hist.map((h) => '<span class="tag" title="' + esc(h.name) + '">' + pct(h.overallScore) + (typeof h.meanDelta === 'number' ? ' / ' + signed(h.meanDelta) : '') + '</span>').join(' → ') + '</div>' : '')
        : '<div class="desc">No runs stored yet.</div>') + '</div>';
  };
  return '<h1>Skill evals</h1><p class="lede">A skill earns its context only if the answer changes when it loads. Each case runs with the skill and without it; the difference (Δ) is the number that means something. A case that passes in both arms is measuring the base model.</p>' +
    (benches.length ? '<div class="stack">' + benches.map(benchCard).join('') + '</div>'
      : '<p class="muted">No eval benches in what you loaded. A bench is a folder with <code>.claude-plugin/plugin.json</code> and <code>evals/</code>; drop the folder that holds them on the Load page.</p>') +
    (candidates.length ? '<h2 class="sec">Worth measuring next</h2><div class="card"><p class="desc" style="margin-top:0">They fire often and nothing measures them yet.</p>' +
      hbars(candidates, (r) => r.name, (r) => r.calls) + '</div>' : '') +
    '<h2 class="sec">The loop, cheapest step first</h2><div class="steps">' +
    [['1 · Case and rubric', 'free', 'Numbered criteria and an explicit failure condition. Without one, the judge passes generic answers.'],
      ['2 · Does it fire?', '~$0.08', '<code>--case one --ablation none --runs 1</code> with only the <code>tool_used</code> grader. If it does not fire, fix the description: that is free.'],
      ['3 · Iterate the rubric', '~$0.6', '<code>--runs 1</code>, read both answers. Most of what looks like a skill failure at this stage is the rubric.'],
      ['4 · Pin it', '~$1.9', '<code>--runs 3 --judge-model sonnet</code>, once cases are stable. Then copy the improved skill back into the repo.']]
      .map(([t, c, d]) => '<div class="step"><div class="k">' + c + '</div><b>' + t + '</b><div class="desc">' + d + '</div></div>').join('') + '</div>';
}

/* ---------------------------------------------------------------- audit */

const AUDIT_RULES = `You audit a Claude Code configuration. You read and report; you never change anything.
Facts to apply, not opinions:
- A Bash(...) rule is a prefix string match: no flag or subcommand is parsed. A rule is worth the worst command line that starts the same way. Write that line before judging.
- deny beats ask, ask beats allow. Read-only commands (ls, cat, pwd, which, grep, echo) already run without a rule: an allow for them grants nothing.
- Settings merge user < project < local. An allow in ~/.claude/settings.json applies in every repo ever opened; its home is the project's .claude/settings.local.json. defaultMode "auto" is only honoured from ~/.claude/settings.json, a managed policy or --permission-mode auto.
- In auto mode a server classifier decides; autoMode.classifyAllShell=true suspends every Bash rule.
- An MCP rule matches only the string mcp__server__tool; in the global file it pre-approves any future server with that name.
- Families wider than they look: interpreters (bash, sh, node, python3, npx), task runners (npm run, pnpm, make, nx), network (curl, wget, ssh), destructive (rm, chmod, sudo, kill), find/xargs (-exec runs anything), cloud CLIs (docker, kubectl, aws), git (push --force, branch -D), gh pr * (covers merge and close), Read(**)/Write(**) (the whole machine).
- A skill fires only from its description: flag descriptions that do not say when to use them, or that compete with another for the same trigger. Use the usage counts: a skill with 0 calls that is not manual-only never fires. Quote the description and propose the rewrite.
- Hooks and scheduled tasks act on their own: matcher "*" or none, missing timeout, what happens if they fail.
- Numbered command folders (1.read, 2.refine…) are a flow: check gaps, permissions each step needs, skills that would fire mid-flow, agents with wide tools.
- Prompts over ~150 lines: say what Claude already knows or can read from the repo.
- Overlaps: two pieces doing the same; say which one goes.
- Evals: a skill measured with Δ <= 0 does not change the answer.
Order of importance: what runs on its own, broad permissions, skills that never fire, overlaps, the SDD flow, bloated prompts, orphans.
Never invent: if the data does not show something, put it in notChecked. Never propose "review X": say exactly what to change.`;

function auditPayload(snap, scopeLabel) {
  const scopes = snap.scopes.filter((s) => scopeLabel === 'all' || s.label === scopeLabel);
  const shape = (excerpt) => ({
    person: snap.person && snap.person.name,
    scopes: scopes.map((s) => ({
      place: s.label, kind: s.kind, repo: s.remote,
      settings: s.settings.map((x) => ({ file: x.file, permissions: x.permissions, autoMode: x.autoMode, hooks: x.hooks, envKeys: x.envKeys, model: x.model, enabledPlugins: x.enabledPlugins, statusLine: x.statusLine })),
      mcp: s.mcp.map((m) => ({ name: m.name, type: m.type, command: m.command, url: m.url, envKeys: m.envKeys })),
      pieces: s.items.filter((i) => i.kind !== 'config' || !i.path.endsWith('.json')).map((i) => ({
        kind: i.kind, name: i.name, path: i.path, lines: i.lines, description: i.description,
        meta: i.meta ? Object.fromEntries(Object.entries(i.meta).filter(([k]) => ['model', 'tools', 'allowed-tools', 'disable-model-invocation', 'argument-hint'].includes(k))) : undefined,
        excerpt: i.content && excerpt ? i.content.slice(0, excerpt) : undefined,
      })),
    })),
    globalMcp: scopeLabel === 'all' ? (snap.globalMcp || []).map((m) => ({ name: m.name, type: m.type, project: m.project })) : undefined,
    usage: snap.usage ? { sessions: snap.usage.sessions, skills: snap.usage.skills.slice(0, 120).map((r) => [r.name, r.calls, r.last && r.last.slice(0, 10)]),
      agents: snap.usage.agents.slice(0, 40).map((r) => [r.name, r.calls]), commands: snap.usage.commands.slice(0, 60).map((r) => [r.name, r.calls]) } : null,
    evals: (snap.benches || []).map((b) => ({ name: b.name, skills: b.skills, agents: b.agents.map((a) => a.name), cases: b.cases.length,
      latest: b.latest && { score: b.latest.overallScore, delta: b.latest.meanDelta, ablation: b.latest.ablation, judge: b.latest.judgeModel } })),
  });
  for (const ex of [1600, 900, 500, 250, 0]) {
    const text = JSON.stringify(shape(ex));
    if (new Blob([text]).size < 190000) return text;
  }
  return JSON.stringify(shape(0)).slice(0, 190000);
}

function auditPrompt(lang, scopeLabel) {
  return AUDIT_RULES + '\n\nWrite every human-readable field in ' + (lang === 'es' ? 'Spanish' : 'English') + '.\n' +
    'Reply with ONLY a JSON object of this shape:\n' +
    '{"summary": "3-5 sentences: the overall state and the 2-3 things to do first",\n' +
    ' "findings": [{"id": "lowercase-slug", "severity": "high|medium|low", "category": "broad-permission|outbound-permission|unused-permission|skill-never-fires|skill-no-measured-effect|overlap|bloated-prompt|unbounded-hook|orphan|other",\n' +
    '   "title": "under 100 chars", "place": "the place label", "path": "file the finding is about", "what": "what you saw, citing the rule or text", "proposal": "the exact change"}],\n' +
    ' "questions": ["what must the owner answer before changing something"],\n' +
    ' "notChecked": ["what this data could not show"]}\n' +
    'At most 25 findings, most severe first.\n\nThe configuration (redacted; pieces carry an excerpt of their text):\n' + auditPayload(S.snap, scopeLabel);
}

function vAudit() {
  const scopes = S.snap ? S.snap.scopes.map((s) => s.label) : [];
  const head = '<h1>Audit</h1><p class="lede">Claude reads your snapshot with the same rules the local <code>auditor-config</code> agent uses and reports what overlaps, what never fires and which permission is wider than it needs to be. It only reports; nothing in your setup changes.</p>';
  if (!S.snap) return head + '<p class="muted">Load your config first.</p><p><button class="btn pri" data-go="load">Load my config</button></p>';
  const controls = '<div class="card"><div class="row"><label for="a-scope" class="small muted">What to audit</label><select id="a-scope"><option value="all">Everything loaded</option>' +
    scopes.map((s) => '<option' + (S.auditScope === s ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select>' +
    '<label for="a-lang" class="small muted">Language</label><select id="a-lang"><option value="en"' + (S.auditLang === 'en' ? ' selected' : '') + '>English</option><option value="es"' + (S.auditLang === 'es' ? ' selected' : '') + '>Español</option></select>' +
    (S.sample ? '<button class="btn pri" data-act="audit"' + (S.auditing ? ' disabled' : '') + '>' + (S.auditing ? 'Claude is reading…' : 'Run the audit') + '</button>' : '') +
    '<button class="btn" data-act="copyprompt">Copy the prompt</button></div>' +
    (S.auditing ? '<div class="desc" id="a-progress">' + esc(S.auditing) + '</div>' : '') +
    (!S.sample ? '<p class="desc">Asking Claude from this page is not available here. Copy the prompt and paste it into Claude or Claude Code instead.</p>' : '<p class="desc">Takes a minute or two. The report is saved to your private space' + (S.db && S.uid ? '' : ' (unavailable in this view: it stays in this tab)') + '.</p>') + '</div>';
  const past = S.audits.length ? '<h2 class="sec">Earlier runs</h2><div class="chips">' + S.audits.map((a) =>
    '<button class="chip' + (S.audit && S.audit.id === a.id ? ' on' : '') + '" data-act="openaudit" data-id="' + esc(a.id) + '">' + fwhen(a.generatedAt) + ' · ' + esc(a.scope === 'all' ? 'everything' : a.scope) + ' · ' + a.findings.length + '</button>').join('') + '</div>' : '';
  return head + controls + past + (S.audit ? auditReport(S.audit) : '');
}

function auditReport(a) {
  const by = { high: [], medium: [], low: [] };
  for (const f of a.findings) (by[f.severity] || by.low).push(f);
  const sevName = { high: 'High', medium: 'Medium', low: 'Low' };
  return '<h2 class="sec">Report · ' + fwhen(a.generatedAt) + '</h2><div class="card"><p style="margin:0;max-width:80ch">' + esc(a.summary) + '</p>' +
    '<div class="row small muted" style="margin-top:8px">' + ['high', 'medium', 'low'].map((s) => by[s].length + ' ' + sevName[s].toLowerCase()).join(' · ') + '</div></div>' +
    ['high', 'medium', 'low'].filter((s) => by[s].length).map((s) => '<h2 class="sec">' + sevName[s] + '</h2><div class="stack">' + by[s].map((f) =>
      '<div class="card sev ' + s + '"><div class="ttl">' + esc(f.title) + ' <span class="tag">' + esc(f.category) + '</span></div>' +
      '<div class="desc mono">' + esc([f.place, f.path].filter(Boolean).join(' · ')) + '</div>' +
      '<p style="margin:8px 0 0;max-width:80ch">' + esc(f.what) + '</p><p style="margin:6px 0 0;max-width:80ch"><b>Change: </b>' + esc(f.proposal) + '</p></div>').join('') + '</div>').join('') +
    (a.questions && a.questions.length ? '<h2 class="sec">Questions to answer first</h2><div class="card"><ul style="margin:0;padding-left:18px">' + a.questions.map((q) => '<li>' + esc(q) + '</li>').join('') + '</ul></div>' : '') +
    (a.notChecked && a.notChecked.length ? '<h2 class="sec">Not checked</h2><div class="card small muted"><ul style="margin:0;padding-left:18px">' + a.notChecked.map((q) => '<li>' + esc(q) + '</li>').join('') + '</ul></div>' : '');
}

function cleanAudit(raw, scope) {
  const SEV = ['high', 'medium', 'low'];
  const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const findings = (Array.isArray(raw && raw.findings) ? raw.findings : []).slice(0, 40).map((f, i) => ({
    id: str(f.id) || 'f' + i, severity: SEV.includes(f.severity) ? f.severity : 'low', category: str(f.category) || 'other',
    title: str(f.title).slice(0, 140), place: str(f.place), path: str(f.path), what: str(f.what), proposal: str(f.proposal),
  })).filter((f) => f.title);
  return { id: new Date().toISOString().replace(/[:.]/g, '-'), generatedAt: new Date().toISOString(), scope,
    tool: 'claude-config-panel-artifact', summary: str(raw && raw.summary) || '(no summary)', findings,
    questions: (Array.isArray(raw && raw.questions) ? raw.questions : []).map(str).slice(0, 15),
    notChecked: (Array.isArray(raw && raw.notChecked) ? raw.notChecked : []).map(str).slice(0, 15) };
}

/* ---------------------------------------------------------------- load */

function vLoad() {
  const f = S.found;
  const compiled = compilePatterns(S.patterns);
  const scopes = f.scopes;
  const busy = S.building;
  return '<h1>Load my config</h1><p class="lede">Drop the folders where your Claude configuration lives. They are read here, in this tab. Only what you save leaves it, already redacted, and it goes to a space only you can open.</p>' +
    loadSteps() +
    '<h2 class="sec">1 · Your folders</h2>' +
    '<div class="drop" id="drop" tabindex="0"><h3>Drop folders here</h3><div class="desc" style="margin:0 auto">Your <code>~/.claude</code> and your workspace folders (one or several, any depth). ' +
    'Optionally <code>~/.claude.json</code> for MCP servers, or a JSON from the collector. In Finder, <kbd>⌘ Shift .</kbd> shows hidden folders.</div>' +
    '<div class="row" style="justify-content:center;margin-top:14px">' +
    '<label class="btn" for="in-dir">Choose a folder…</label><input id="in-dir" type="file" webkitdirectory multiple hidden>' +
    '<label class="btn" for="in-json">Load a JSON…</label><input id="in-json" type="file" accept=".json,application/json" hidden></div></div>' +
    (f.roots.length ? '<p class="small muted">Read so far: ' + f.roots.map((r) => '<code>' + esc(r) + '</code>').join(' ') + (f.claudeJson ? ' · <code>~/.claude.json</code>' : '') + (f.transcripts ? ' · transcripts found' : '') + '</p>' : '') +
    (scopes.length ? '<h2 class="sec">2 · What goes in</h2><div class="card"><div class="stack">' + scopes.map((s, i) => {
      const why = s.isGlobal ? null : excludedBy(s.label, compiled);
      return '<label class="row" style="gap:8px;align-items:flex-start"><input type="checkbox" data-scope="' + i + '"' + (S.pick.has(i) ? ' checked' : '') + '> <span><span class="mono">' + esc(s.label) + '</span> ' +
        (s.isGlobal ? '<span class="tag acc">global</span>' : '') + (s.remote ? '<span class="tag">' + esc(s.remote.replace(/^https:\/\/github\.com\//, '')) + '</span>' : '') +
        (why ? '<span class="tag warn">matches “' + esc(why) + '”</span>' : '') + '<br><span class="small muted">' + s.files.length + ' files</span></span></label>';
    }).join('') + '</div>' +
      (f.benches.length ? '<p class="small">Eval benches found: ' + f.benches.map((b) => '<code>' + esc(b.label.split('/').pop()) + '</code>').join(' ') + '</p>' : '') + '</div>' +
      '<div class="card" style="margin-top:10px"><label for="in-pat"><b>Exclusion list</b> <span class="small muted">One pattern per line, matched against folders, file paths and names (case-insensitive regex).</span></label>' +
      '<textarea id="in-pat" spellcheck="false">' + esc(S.patterns.join('\n')) + '</textarea>' +
      '<div class="row" style="margin-top:10px"><label for="in-name" class="small muted">Your name (optional)</label><input type="text" id="in-name" value="' + esc(S.name) + '" placeholder="Shown on your snapshot">' +
      (f.transcripts ? '<label class="row small" style="gap:6px"><input type="checkbox" id="in-usage"' + (S.countUsage ? ' checked' : '') + '> Count usage from transcripts (counts only; can take a minute)</label>' : '') + '</div></div>' +
      '<h2 class="sec">3 · Build it</h2><div class="row"><button class="btn pri" data-act="build"' + (busy ? ' disabled' : '') + '>Build my snapshot</button>' +
      (busy ? '<button class="btn" data-act="stop">Stop counting usage</button>' : '') + '<button class="btn" data-act="reset">Start over</button></div>' +
      (busy ? '<div class="card" style="margin-top:10px"><div class="small" id="b-msg">' + esc(busy.msg) + '</div><div class="bar" style="margin-top:6px"><i id="b-bar" style="width:' + (busy.pct || 3) + '%"></i></div></div>' : '')
      : '') +
    '<h2 class="sec">Without a browser that reads folders</h2><div class="card"><p style="margin:0">If you have Node 18 or newer, the collector does the same reading and adds who created and last changed each versioned piece (from git). It writes one JSON file and sends nothing anywhere.</p>' +
    '<div class="row" style="margin-top:10px">' + (S.downloads ? '<button class="btn" data-act="collector">Download collect.mjs</button>' : '<span class="small muted">Downloads are not available in this view.</span>') + '</div>' +
    '<pre id="cmd">node ~/Downloads/collect.mjs ~/path/to/your/repos > my-claude-config.json</pre><div class="row" style="margin-top:6px"><button class="btn" data-act="copycmd">Copy command</button>' +
    '<span class="small muted">Then “Load a JSON…” above. Options: <code>--no-usage</code>, <code>--exclude &lt;regex&gt;</code>, <code>--name "Your name"</code>.</span></div></div>' +
    (S.db && S.uid ? '<h2 class="sec">Your saved data</h2><div class="card" id="mine">' + (S.saved ? 'A snapshot from ' + fwhen(S.snap && S.snap.generatedAt) + ' and ' + S.audits.length + ' audit' + (S.audits.length === 1 ? '' : 's') + ' are saved in your private space.' +
      '<div class="row" style="margin-top:10px"><button class="btn danger" data-act="askforget">Delete my saved data</button></div>' : 'Nothing saved yet.') + '</div>' : '');
}

/* ------------------------------------------------------ browser file access */

function readAllEntries(dir) {
  return new Promise((ok) => {
    const reader = dir.createReader(), out = [];
    const next = () => reader.readEntries((batch) => { if (!batch.length) ok(out); else { out.push(...batch); next(); } }, () => ok(out));
    next();
  });
}
const fileOf = (h) => (h.file ? Promise.resolve(h.file) : new Promise((ok, no) => h.entry.file(ok, no)));
const browserFs = {
  async list(h) {
    if (h.children) return [...h.children.values()].map((c) => ({ name: c.name, kind: c.children ? 'dir' : 'file', h: c }));
    if (!h.entry || !h.entry.isDirectory) return [];
    return (await readAllEntries(h.entry)).map((e) => ({ name: e.name, kind: e.isDirectory ? 'dir' : 'file', h: { entry: e } }));
  },
  async text(h) { return (await fileOf(h)).text(); },
  async meta(h) { const f = await fileOf(h); return { size: f.size, mtime: new Date(f.lastModified).toISOString() }; },
  async *chunks(h) {
    const f = await fileOf(h);
    const r = f.stream().pipeThrough(new TextDecoderStream()).getReader();
    for (;;) { const { done, value } = await r.read(); if (done) break; yield value; }
  },
};

/** A `<input webkitdirectory>` gives a flat list: rebuild it as a tree. */
function treeFromFiles(files) {
  const roots = new Map();
  for (const f of files) {
    const parts = (f.webkitRelativePath || f.name).split('/');
    if (parts.includes('node_modules')) continue;
    let node = roots.get(parts[0]);
    if (!node) { node = { name: parts[0], children: new Map() }; roots.set(parts[0], node); }
    for (let i = 1; i < parts.length; i++) {
      if (i === parts.length - 1) node.children.set(parts[i], { name: parts[i], file: f });
      else {
        if (!node.children.has(parts[i])) node.children.set(parts[i], { name: parts[i], children: new Map() });
        node = node.children.get(parts[i]);
      }
    }
  }
  return [...roots.values()];
}

async function addRoots(roots) {
  if (!roots.length) return;
  S.building = { msg: 'Looking for Claude configuration in ' + roots.map((r) => r.name).join(', ') + '…', pct: 5 };
  render();
  try {
    const res = await discoverRoots(browserFs, roots.map((r) => ({ h: r.h, name: r.name, label: r.name })), {
      onProgress: ({ folders }) => { S.building.msg = 'Looked in ' + folders + ' folders…'; const m = $('#b-msg'); if (m) m.textContent = S.building.msg; },
    });
    const compiled = compilePatterns(S.patterns);
    for (const s of res.scopes) {
      const dupe = S.found.scopes.findIndex((x) => (s.isGlobal && x.isGlobal) || x.label === s.label);
      if (dupe >= 0) continue;
      S.found.scopes.push(s);
      if (s.isGlobal || !excludedBy(s.label, compiled)) S.pick.add(S.found.scopes.length - 1);
    }
    for (const b of res.benches) if (!S.found.benches.some((x) => x.label === b.label)) S.found.benches.push(b);
    if (res.transcripts) S.found.transcripts = res.transcripts;
    S.found.roots.push(...roots.map((r) => r.name));
    if (!res.scopes.length && !res.benches.length) toast('No .claude folder found in ' + roots.map((r) => r.name).join(', ') + '.');
  } catch (e) {
    toast('Could not read that folder: ' + e.message);
  }
  S.building = null;
  render();
}

async function loadJsonFile(file) {
  const text = await file.text();
  if (file.name === '.claude.json' || /"mcpServers"/.test(text) && !/"schema"\s*:\s*"ccp-snapshot/.test(text)) {
    S.found.claudeJson = text; toast('~/.claude.json read: its MCP servers will be included.'); render(); return;
  }
  let j;
  try { j = JSON.parse(text); } catch { toast('That file is not valid JSON.'); return; }
  const err = validateSnapshot(j);
  if (err) { toast(err); return; }
  S.snap = j; S.saved = false; S.origin = 'file';
  toast('Snapshot loaded. Save it to keep it.');
  go('overview');
}

function wireLoad() {
  const drop = $('#drop');
  if (drop) {
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('over');
      const entries = [...e.dataTransfer.items].map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
      const files = [...e.dataTransfer.files];
      const roots = [];
      for (const en of entries) {
        if (en.isDirectory) roots.push({ h: { entry: en }, name: en.name });
        else { const f = files.find((x) => x.name === en.name); if (f && /\.json$/i.test(f.name)) loadJsonFile(f); }
      }
      addRoots(roots);
    });
  }
  const dir = $('#in-dir');
  if (dir) dir.addEventListener('change', () => { addRoots(treeFromFiles([...dir.files]).map((n) => ({ h: n, name: n.name }))); dir.value = ''; });
  const js = $('#in-json');
  if (js) js.addEventListener('change', () => { if (js.files[0]) loadJsonFile(js.files[0]); js.value = ''; });
  const pat = $('#in-pat');
  if (pat) pat.addEventListener('change', () => { S.patterns = pat.value.split('\n').map((x) => x.trim()).filter(Boolean); savePrefs(); render(); });
  const nm = $('#in-name');
  if (nm) nm.addEventListener('change', () => { S.name = nm.value.trim(); savePrefs(); });
  const us = $('#in-usage');
  if (us) us.addEventListener('change', () => { S.countUsage = us.checked; });
  document.querySelectorAll('[data-scope]').forEach((c) => c.addEventListener('change', () => {
    const i = Number(c.dataset.scope); if (c.checked) S.pick.add(i); else S.pick.delete(i);
  }));
}

document.addEventListener('change', (e) => {
  if (e.target.id === 'f-scope') { S.filters.scope = e.target.value; render(); }
  if (e.target.id === 'a-scope') S.auditScope = e.target.value;
  if (e.target.id === 'a-lang') { S.auditLang = e.target.value; savePrefs(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'f-q') {
    S.filters.q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const q = $('#f-q'); if (q) { q.focus(); q.setSelectionRange(pos, pos); }
  }
});

async function build() {
  const ctx = newContext(S.patterns);
  const setMsg = (msg, pct) => { S.building = { msg, pct }; const m = $('#b-msg'), b = $('#b-bar'); if (m) m.textContent = msg; if (b) b.style.width = (pct || 3) + '%'; };
  S.stop = false;
  setMsg('Reading pieces…', 5); render();
  const scopes = [];
  const picked = S.found.scopes.filter((_, i) => S.pick.has(i));
  for (const [n, s] of picked.entries()) {
    setMsg('Reading ' + s.label + '…', 5 + (n / Math.max(1, picked.length)) * 25);
    const r = await readScope(browserFs, s, ctx);
    if (r) scopes.push(r);
  }
  const benches = [];
  for (const b of S.found.benches) benches.push(await readBench(browserFs, b, ctx));
  let usage = null;
  if (S.found.transcripts && S.countUsage) {
    setMsg('Listing transcripts…', 32);
    const files = await listTranscripts(browserFs, S.found.transcripts);
    const raw = await scanUsage(browserFs, files, {
      shouldStop: () => S.stop,
      onProgress: ({ done, total, bytes }) => setMsg('Counting usage: ' + done + ' of ' + total + ' transcripts (' + Math.round(bytes / 1e6) + ' MB read)…', 32 + (done / total) * 66),
    });
    usage = shapeUsage(raw, ctx, scopes.map((s) => s.label));
    if (raw.files < raw.totalFiles) usage.partial = true;
  }
  const extraMcp = S.found.claudeJson ? mcpFromClaudeJson(S.found.claudeJson, ctx) : [];
  S.snap = assemble({ ctx, scopes, usage, benches, person: { name: S.name }, source: 'browser', extraMcp });
  S.saved = false; S.origin = 'scan'; S.building = null;
  toast('Snapshot built: ' + scopes.reduce((a, s) => a + s.items.length, 0) + ' pieces, ' + ctx.stats.redactions + ' values redacted.');
  go('overview');
}

/* ------------------------------------------------------- private storage */

const CHUNK = 90000;
const base = () => 'data/users/' + S.uid;

async function saveSnapshot() {
  if (!S.db || !S.uid || !S.snap) return;
  const text = JSON.stringify(S.snap);
  const parts = Math.ceil(text.length / CHUNK);
  const meta = S.db.doc(base() + '/snap');
  const prev = await meta.get().catch(() => null);
  const prevParts = prev && prev.exists ? Number(prev.data().parts) || 0 : 0;
  try {
    for (let i = 0; i < parts; i++) {
      await meta.collection('parts').doc(String(i)).set({ i, data: text.slice(i * CHUNK, (i + 1) * CHUNK) });
    }
    const savedAt = new Date().toISOString();
    await meta.set({ parts, chars: text.length, generatedAt: S.snap.generatedAt, savedAt, person: (S.snap.person && S.snap.person.name) || null });
    for (let i = parts; i < prevParts; i++) await meta.collection('parts').doc(String(i)).delete().catch(() => {});
    S.saved = true; S.savedAt = savedAt;
    toast('Saved to your private space.');
  } catch (e) {
    toast(e && e.code === 'permission_denied' || e && e.code === 'invalid_argument'
      ? 'You can view this page but not save on it. Ask its owner for “can use” access.'
      : 'Could not save: ' + ((e && e.message) || e));
  }
  render();
}

async function loadSaved() {
  if (!S.db || !S.uid) return;
  S.loadingSaved = true;
  const timer = new Promise((ok) => setTimeout(() => ok('timeout'), 10000));
  const work = (async () => {
    const meta = await S.db.doc(base() + '/snap').get();
    if (meta.exists) {
      const m = meta.data();
      const parts = [];
      for (let i = 0; i < m.parts; i++) {
        const p = await S.db.doc(base() + '/snap/parts/' + i).get();
        if (!p.exists) throw new Error('part ' + i + ' missing');
        parts.push(p.data().data);
      }
      const snap = JSON.parse(parts.join(''));
      if (!validateSnapshot(snap) && !S.snap) { S.snap = snap; S.saved = true; S.savedAt = m.savedAt; S.origin = 'db'; }
    }
    const runs = await S.db.collection(base() + '/audit/runs').orderBy('generatedAt', 'desc').limit(30).get();
    S.audits = runs.docs.map((d) => d.data().report).filter(Boolean);
    if (S.audits.length && !S.audit) S.audit = S.audits[0];
  })();
  try {
    const r = await Promise.race([work, timer]);
    if (r === 'timeout') toast('Your saved data is taking long to load. It will appear when it arrives.');
  } catch (e) {
    toast('Could not read your saved data: ' + ((e && e.message) || e));
  }
  S.loadingSaved = false;
  render();
}

async function saveAudit(report) {
  S.audits.unshift(report);
  S.audit = report;
  if (!S.db || !S.uid) return;
  try { await S.db.doc(base() + '/audit').collection('runs').doc(report.id).set({ generatedAt: report.generatedAt, report }); }
  catch (e) { toast('The report is shown but could not be saved: ' + ((e && e.message) || e)); }
}

/* --------------------------------------------------------------- actions */

async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch { toast('Copy is blocked here: select the text and copy it by hand.'); }
}

const ACTIONS = {
  lang: (el) => { setLang(el.dataset.l); savePrefs(); render(); },
  kind: (el) => { S.filters.kind = el.dataset.k; render(); },
  build: () => build(),
  stop: () => { S.stop = true; },
  reset: () => { S.found = { scopes: [], benches: [], transcripts: null, claudeJson: null, roots: [] }; S.pick = new Set(); render(); },
  save: () => saveSnapshot(),
  download: async () => {
    try { await S.downloads.save({ filename: 'claude-config-' + S.snap.generatedAt.slice(0, 10) + '.json', data: JSON.stringify(S.snap, null, 1) }); }
    catch (e) { if (!e || e.code !== 'cancelled') toast('Download did not happen' + (e && e.code ? ' (' + e.code + ')' : '') + '.'); }
  },
  collector: async () => {
    try {
      const text = await (await fetch('collect.mjs')).text();
      await S.downloads.save({ filename: 'collect.mjs', data: text });
    } catch (e) { if (!e || e.code !== 'cancelled') toast('Download did not happen' + (e && e.code ? ' (' + e.code + ')' : '') + '.'); }
  },
  copycmd: () => copy($('#cmd').textContent, 'Command copied.'),
  copyprompt: () => copy(auditPrompt(S.auditLang, S.auditScope), 'Prompt copied: paste it into Claude.'),
  openaudit: (el) => { S.audit = S.audits.find((a) => a.id === el.dataset.id) || null; render(); },
  audit: async () => {
    if (!S.sample || S.auditing) return;
    S.auditing = 'Claude is reading your configuration…'; render();
    try {
      const raw = await S.sample.json(auditPrompt(S.auditLang, S.auditScope), {
        modelTier: 'complex',
        onText: ({ text }) => { S.auditing = 'Claude is writing the report… ' + text.length + ' characters so far'; const p = $('#a-progress'); if (p) p.textContent = S.auditing; },
      });
      await saveAudit(cleanAudit(raw, S.auditScope));
    } catch (e) {
      const code = e && e.code;
      toast(code === 'not_granted' ? 'Claude access was not allowed for this page. Use “Copy the prompt” instead.'
        : code === 'rate_limited' ? 'Too many requests right now. Try again in a few minutes.'
          : code === 'prompt_too_large' ? 'The snapshot is too large: audit one place at a time.'
            : 'The audit did not finish: ' + ((e && e.message) || code || e));
    }
    S.auditing = null; render();
  },
  askforget: () => {
    const box = $('#mine');
    box.innerHTML = '<div class="confirm"><span>Delete your saved snapshot and every audit? This cannot be undone.</span><button class="btn danger" data-act="forget">Delete</button><button class="btn" data-go="load">Keep it</button></div>';
  },
  forget: async () => {
    try {
      const meta = S.db.doc(base() + '/snap');
      const m = await meta.get();
      const n = m.exists ? Number(m.data().parts) || 0 : 0;
      for (let i = 0; i < n; i++) await meta.collection('parts').doc(String(i)).delete();
      await meta.delete();
      const runs = await S.db.collection(base() + '/audit/runs').get();
      for (const d of runs.docs) await S.db.doc(base() + '/audit/runs/' + d.id).delete();
      S.saved = false; S.audits = []; S.audit = null;
      toast('Deleted.');
    } catch (e) { toast('Could not delete: ' + ((e && e.message) || e)); }
    render();
  },
};

/* ------------------------------------------------------------------ boot */

render();
(async () => {
  if (!(window.claude && window.claude.use)) await new Promise((ok) => setTimeout(ok, 300));
  const use = window.claude && window.claude.use ? (n) => window.claude.use(n).catch(() => null) : () => Promise.resolve(null);
  const [db, user, sample, downloads] = await Promise.all([use('db'), use('user'), use('sample'), use('downloads')]);
  Object.assign(S, { db, user, sample, downloads, capsReady: true });
  if (user) { try { S.uid = await user.id(); } catch { S.uid = null; } }
  render();
  if (db && S.uid) loadSaved();
})();
