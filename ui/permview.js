// The Permissions view: every rule of every settings file in one place, each
// said in plain words with the language it ends up running, and editable in
// place. Each change goes to the server, which re-reads the file, applies it,
// backs the old one up and writes: what you see is always the file on disk.
import { $, esc } from './util.js';
import { describe, sentence, LANGS, MODES } from './permissions.js';

const LIST_INFO = {
  allow: ['Allowed without asking', 'Each rule is a standing yes: Claude does it without showing you a prompt.'],
  ask: ['Always asks first', 'Forces the prompt back, even in modes that would otherwise run it on their own.'],
  deny: ['Forbidden', 'Never allowed, in any mode. Deny always wins over allow and ask.'],
};
const LEVEL_TAG = { broad: ['broad', 'warn'], outbound: ['acts outward', 'err'] };

let FILES = [], filter = { lang: '', level: '' }, armed = '', root = null;

export async function renderPermissions(main) {
  root = main;
  root.innerHTML = '<h1>Permissions</h1><p class="lede">Loading…</p>';
  try { FILES = (await (await fetch('/api/permissions')).json()).files || []; }
  catch (e) { root.innerHTML = '<h1>Permissions</h1><div class="msg err">Could not read the settings files: ' + esc(String(e)) + '</div>'; return; }
  draw();
  root.onclick = onClick;
  root.onchange = onChange;
  root.oninput = onInput;
}

function allRules() {
  const out = [];
  for (const f of FILES) for (const list of ['allow', 'ask', 'deny']) for (const r of f[list]) out.push({ f, list, r, d: describe(r) });
  return out;
}

function draw() {
  const rules = allRules();
  const counts = {};
  for (const x of rules) counts[x.d.lang] = (counts[x.d.lang] || 0) + 1;
  const nBroad = rules.filter((x) => x.d.level === 'broad' && x.list !== 'deny').length;
  const nOut = rules.filter((x) => x.d.level === 'outbound' && x.list !== 'deny').length;

  let h = '<h1>Permissions</h1><p class="lede">Every rule in every settings file, said in plain words: what it lets ' +
    'Claude do, which language it really ends up running (a Bash rule can be Python, Node or AppleScript), and how far ' +
    'it reaches. Changes are written to the file straight away, with a backup of the old one.</p>';

  h += '<div class="grid">' +
    stat(rules.length, 'rules in ' + FILES.filter((f) => f.allow.length + f.ask.length + f.deny.length).length + ' files') +
    stat(rules.filter((x) => x.list === 'allow').length, 'allowed without asking') +
    stat(nBroad, 'broad grants', 'level', 'broad') +
    stat(nOut, 'act outward', 'level', 'outbound') + '</div>';

  h += '<h2 class="sec">Languages — click one to filter</h2><div class="chips">' +
    chip('All', !filter.lang && !filter.level, 'data-lang=""') +
    Object.keys(LANGS).filter((k) => counts[k]).map((k) =>
      chip(LANGS[k].label + ' · ' + counts[k], filter.lang === k, 'data-lang="' + k + '" title="' + esc(LANGS[k].blurb) + '"')).join('') +
    '</div>';
  if (filter.lang) h += '<p class="desc">' + esc(LANGS[filter.lang].blurb) + '</p>';
  if (filter.level) h += '<p class="desc">Showing only rules tagged <b>' + esc(LEVEL_TAG[filter.level][0]) + '</b> (allowed or asked).</p>';

  const order = [...FILES].sort((a, b) => (b.isGlobal - a.isGlobal) || a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name));
  const withRules = order.filter((f) => f.allow.length + f.ask.length + f.deny.length || f.defaultMode !== 'default');
  const empty = order.filter((f) => !withRules.includes(f));
  for (const f of withRules) h += fileCard(f);
  if (empty.length) {
    h += '<details class="piece" style="margin-top:14px"><summary><div class="sum-main"><b>' + empty.length +
      ' settings files with no permission rules</b><div class="desc">Open one to add its first rule.</div></div></summary><div class="body stack">' +
      empty.map(fileCard).join('') + '</div></details>';
  }
  root.innerHTML = h;
}

function stat(n, label, key, val) {
  const attr = key ? ' data-' + key + '="' + val + '" style="cursor:pointer" title="Filter"' : '';
  return '<div class="stat"' + attr + '><b>' + n + '</b><span>' + esc(label) + '</span></div>';
}
function chip(txt, on, attr) { return '<button class="chip' + (on ? ' on' : '') + '" ' + attr + '>' + esc(txt) + '</button>'; }

function visible(list, d) {
  if (filter.lang && d.lang !== filter.lang) return false;
  if (filter.level && (d.level !== filter.level || list === 'deny')) return false;
  return true;
}

function fileCard(f) {
  let h = '<div class="card pv-file" style="margin-top:14px"><div class="ttl">' + esc(f.title || f.name) +
    ' <span class="tag">' + esc(f.isGlobal ? 'Global' : f.scope) + '</span></div>' +
    '<div class="desc"><code>' + esc(f.path) + '</code></div>';
  if (f.error) return h + '<div class="msg err" style="margin-top:8px">Not valid JSON right now: ' + esc(f.error) + '. Fix it in its JSON tab.</div></div>';

  h += '<div class="row" style="margin-top:10px"><label class="small muted" for="mode_' + f.id + '">How a session starts here</label>' +
    '<select id="mode_' + f.id + '" data-mode="' + f.id + '">' + MODES.map(([v, l]) =>
      '<option value="' + v + '"' + (f.defaultMode === v ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></div>';
  if (f.defaultMode === 'auto' && !(f.isGlobal && f.name === 'settings.json')) {
    h += '<div class="desc warn-text">"auto" written here is ignored: only ~/.claude/settings.json, a managed policy or --permission-mode auto can turn auto mode on.</div>';
  }

  for (const list of ['allow', 'ask', 'deny']) {
    const rows = f[list].map((r) => ({ r, d: describe(r) })).filter((x) => visible(list, x.d));
    if (!f[list].length && (filter.lang || filter.level)) continue;
    const [t, blurb] = LIST_INFO[list];
    h += '<div class="pv-list"><div class="pv-head pv-' + list + '">' + t + ' <span class="tag">' + f[list].length + '</span>' +
      '<span class="small muted"> — ' + blurb + '</span></div>';
    if (!f[list].length) h += '<div class="desc" style="opacity:.6">No rules.</div>';
    else if (!rows.length) h += '<div class="desc" style="opacity:.6">None match the filter.</div>';
    for (const { r, d } of rows) h += ruleRow(f, list, r, d);
    h += '</div>';
  }

  h += '<div class="pv-add"><div class="row"><select data-addlist="' + f.id + '">' +
    ['allow', 'ask', 'deny'].map((k) => '<option value="' + k + '">' + LIST_INFO[k][0] + '</option>').join('') + '</select>' +
    '<input type="text" data-addrule="' + f.id + '" placeholder="Bash(pnpm test *)  ·  Read(~/notes/**)  ·  mcp__server__tool" style="flex:1;min-width:220px">' +
    '<button class="btn pri" data-add="' + f.id + '">Add rule</button></div>' +
    '<div class="pv-preview small" data-preview="' + f.id + '"></div></div>';
  return h + '</div>';
}

function ruleRow(f, list, r, d) {
  const key = f.id + '|' + list + '|' + r;
  const tag = d.level !== 'normal' && list !== 'deny' ? '<span class="tag ' + LEVEL_TAG[d.level][1] + '">' + LEVEL_TAG[d.level][0] + '</span>' : '';
  const moves = ['allow', 'ask', 'deny'].filter((k) => k !== list);
  return '<div class="pv-rule">' +
    '<div class="pv-lang pv-l-' + d.lang + '" title="' + esc(LANGS[d.lang].blurb) + '">' + esc(d.langLabel) + '</div>' +
    '<div class="pv-main"><code>' + esc(r) + '</code> ' + tag +
    '<div class="pv-say">' + esc(sentence(r, list)) + '</div>' +
    (d.what ? '<div class="small muted">' + esc(d.what) + '</div>' : '') +
    (d.scope ? '<div class="small muted"><b>Reach:</b> ' + esc(d.scope) + '</div>' : '') +
    d.notes.map((n) => '<div class="small ' + (d.level === 'normal' ? 'muted' : 'warn-text') + '">' + esc(n) + '</div>').join('') +
    '</div><div class="pv-act">' +
    '<select data-move="' + esc(key) + '" aria-label="Move rule"><option value="">Move to…</option>' +
    moves.map((k) => '<option value="' + k + '">' + LIST_INFO[k][0] + '</option>').join('') + '</select>' +
    (armed === key
      ? '<button class="btn danger" data-del="' + esc(key) + '">Confirm delete</button>'
      : '<button class="btn" data-arm="' + esc(key) + '" title="Delete this rule">Delete</button>') +
    '</div></div>';
}

const parseKey = (k) => { const i = k.indexOf('|'), j = k.indexOf('|', i + 1); return { id: k.slice(0, i), list: k.slice(i + 1, j), rule: k.slice(j + 1) }; };

async function send(body) {
  let r;
  try {
    r = await (await fetch('/api/permissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  } catch (e) { r = { error: String(e) }; }
  if (r.file) FILES = FILES.map((f) => (f.id === r.file.id ? r.file : f));
  armed = '';
  draw();
  toast(r.error ? 'Not saved: ' + r.error : r.changed ? 'Saved · backup at ' + r.backup : 'Nothing to change', !!r.error);
  return r;
}

function toast(msg, bad) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast'; if (bad) t.style.background = 'var(--err)';
  t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3500);
}

function onClick(e) {
  const lang = e.target.closest('[data-lang]');
  if (lang) { filter = { lang: lang.dataset.lang, level: '' }; return draw(); }
  const lvl = e.target.closest('[data-level]');
  if (lvl) { filter = { lang: '', level: filter.level === lvl.dataset.level ? '' : lvl.dataset.level }; return draw(); }
  const arm = e.target.closest('[data-arm]');
  if (arm) { armed = arm.dataset.arm; return draw(); }
  const del = e.target.closest('[data-del]');
  if (del) { const k = parseKey(del.dataset.del); return send({ id: k.id, op: 'remove', list: k.list, rule: k.rule }); }
  const add = e.target.closest('[data-add]');
  if (add) {
    const id = add.dataset.add, inp = root.querySelector('[data-addrule="' + id + '"]'), sel = root.querySelector('[data-addlist="' + id + '"]');
    if (inp && inp.value.trim()) return send({ id, op: 'add', list: sel.value, rule: inp.value.trim() });
  }
  if (armed && !e.target.closest('.pv-act')) { armed = ''; draw(); }
}

function onChange(e) {
  const mv = e.target.closest('[data-move]');
  if (mv && mv.value) { const k = parseKey(mv.dataset.move); return send({ id: k.id, op: 'move', list: k.list, rule: k.rule, to: mv.value }); }
  const md = e.target.closest('[data-mode]');
  if (md) return send({ id: md.dataset.mode, op: 'mode', value: md.value });
  const al = e.target.closest('[data-addlist]');
  if (al) preview(al.dataset.addlist);
}

function onInput(e) {
  const inp = e.target.closest('[data-addrule]');
  if (inp) preview(inp.dataset.addrule);
}

function preview(id) {
  const inp = root.querySelector('[data-addrule="' + id + '"]'), out = root.querySelector('[data-preview="' + id + '"]');
  const list = root.querySelector('[data-addlist="' + id + '"]').value;
  const v = inp.value.trim();
  if (!v) { out.innerHTML = ''; return; }
  const d = describe(v);
  out.innerHTML = '<span class="pv-lang pv-l-' + d.lang + '">' + esc(d.langLabel) + '</span> <b>' + esc(sentence(v, list)) + '</b>' +
    (d.scope ? ' <span class="muted">' + esc(d.scope) + '</span>' : '') +
    d.notes.map((n) => '<div class="' + (d.level === 'normal' ? 'muted' : 'warn-text') + '">' + esc(n) + '</div>').join('');
}
