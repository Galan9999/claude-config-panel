// The Map view: the agent system drawn from /api/agentmap, in three tabs.
//  - Static: every piece, one column per kind, every connection in one ink.
//  - Live:   the static map plus the chats running now (refreshes itself).
//  - Flow:   only the pieces that interact, left to right, one arrow style per
//            kind of interaction, with the legend that explains each one.
// Plain SVG, no library. Everything read from disk goes through esc().
import { esc, fwhen } from './util.js';

const COL_W = 236, NODE_W = 184, NODE_H = 30, ROW_H = 40, PAD_X = 24, PAD_Y = 46;
const STATIC_ORDER = ['launcher', 'routine', 'role', 'chat', 'mod', 'command', 'skill', 'agent', 'hook', 'event', 'tool', 'mcp', 'state'];
const TYPE_ICON = { launcher: '◷', routine: '↻', role: '★', chat: '▭', mod: '◫', command: '/', skill: '◆', agent: '◇', hook: '⚡', event: '!', tool: '⚒', mcp: '⇄', state: '▤' };

let ui = { tab: 'flow', data: null, hidden: new Set(), assumed: true, lonely: false, sel: null, trace: null, timer: null, zoom: 1, fitted: false, scope: 'all' };
const ZMIN = 0.2, ZMAX = 3;

export async function renderMap(main) {
  ui = { ...ui, data: null, sel: null, trace: null, fitted: false };
  main.innerHTML = '<h1>Agent map</h1><p class="lede">Loading…</p>';
  main.onclick = (e) => onClick(e, main);
  main.onchange = (e) => onChange(e, main);
  await load(main);
}

async function load(main) {
  try {
    const r = await fetch('/api/agentmap' + (ui.tab === 'live' ? '?live=1' : ''));
    ui.data = await r.json();
  } catch (e) {
    main.innerHTML = '<h1>Agent map</h1><div class="msg err">' + esc(String(e)) + '</div>';
    return;
  }
  draw(main);
  clearInterval(ui.timer);
  if (ui.tab === 'live') {
    ui.timer = setInterval(() => {
      // Stop once the user has left the tab or the view.
      if (!document.body.contains(main.querySelector('.map-root')) || ui.tab !== 'live') return clearInterval(ui.timer);
      load(main);
    }, 15000);
  }
}

/* ------------------------------------------------------------------ model */

/** The scopes the scope filter lets through, or null for all. */
function allowedScopes() {
  if (ui.scope === 'all') return null;
  const [mode, ...rest] = ui.scope.split(':');
  const s = rest.join(':');
  return new Set(mode === 'eff' ? ['Global', s] : [s]);
}
const inScope = (scopes, allowed) => !allowed || !scopes || !scopes.length || scopes.some((s) => allowed.has(s));

function visible() {
  const d = ui.data;
  const allowed = allowedScopes();
  const interaction = (e) => e.type !== 'provides';
  let edges = d.edges.filter((e) => ui.assumed || !e.assumed);
  if (ui.tab === 'flow') edges = edges.filter(interaction);
  let nodes = d.nodes.filter((n) => !ui.hidden.has(n.type) && inScope(n.scopes, allowed));
  if (ui.tab !== 'live') nodes = nodes.filter((n) => !n.id.startsWith('live:'));
  const ids = new Set(nodes.map((n) => n.id));
  edges = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  // Shared pieces (events, tools, launchers) have no scope: they only show when something in scope uses them.
  if (ui.tab === 'flow' || !ui.lonely) nodes = nodes.filter((n) => linked.has(n.id) || n.live);
  else nodes = nodes.filter((n) => linked.has(n.id) || n.live || (n.scopes && n.scopes.length));
  if (ui.trace) {
    const keep = reach(ui.trace, edges);
    nodes = nodes.filter((n) => keep.has(n.id));
    edges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  }
  return { nodes, edges };
}

/** Everything downstream of a node, following interactions. */
function reach(start, edges) {
  const out = new Set([start]);
  const q = [start];
  while (q.length) {
    const cur = q.shift();
    for (const e of edges) if (e.from === cur && !out.has(e.to)) { out.add(e.to); q.push(e.to); }
  }
  return out;
}

/** Column per node, rows ordered to cut crossings (two barycentre sweeps). */
function layout(nodes, edges) {
  const colOf = ui.tab === 'flow'
    ? (n) => n.col
    : (n) => STATIC_ORDER.indexOf(n.type);
  const cols = [...new Set(nodes.map(colOf))].sort((a, b) => a - b);
  const byCol = new Map(cols.map((c) => [c, nodes.filter((n) => colOf(n) === c).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))]));
  const pos = new Map();
  const place = () => cols.forEach((c, ci) => byCol.get(c).forEach((n, ri) => pos.set(n.id, { x: PAD_X + ci * COL_W, y: PAD_Y + ri * ROW_H, ci, ri })));
  place();
  for (let pass = 0; pass < 2; pass++) {
    for (const c of cols) {
      const list = byCol.get(c);
      const score = new Map(list.map((n) => {
        const ys = edges.filter((e) => e.to === n.id || e.from === n.id).map((e) => pos.get(e.to === n.id ? e.from : e.to)).filter(Boolean).map((p) => p.ri);
        return [n.id, ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : pos.get(n.id).ri];
      }));
      list.sort((a, b) => score.get(a.id) - score.get(b.id));
      place();
    }
  }
  const heads = cols.map((c, ci) => ({ x: PAD_X + ci * COL_W, label: ui.tab === 'flow' ? colLabel(byCol.get(c)) : (ui.data.nodeTypes[STATIC_ORDER[c]] || {}).label }));
  const rows = Math.max(1, ...cols.map((c) => byCol.get(c).length));
  return { pos, heads, w: PAD_X * 2 + cols.length * COL_W - (COL_W - NODE_W), h: PAD_Y + rows * ROW_H + 20 };
}

function colLabel(list) {
  return [...new Set(list.map((n) => (ui.data.nodeTypes[n.type] || {}).label || n.type))].join(' · ');
}

/* ------------------------------------------------------------------ drawing */

function edgePath(a, b) {
  const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
  if (b.ci > a.ci) {
    const dx = Math.max(40, (x2 - x1) / 2);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2 - 6},${y2}`;
  }
  // Same column or backwards: loop out on the right and come back in on the right side.
  const xr = Math.max(x1, b.x + NODE_W) + 34 + Math.abs(a.ri - b.ri) * 2;
  return `M${x1},${y1} C${xr},${y1} ${xr},${y2} ${b.x + NODE_W + 6},${y2}`;
}

function svg(nodes, edges) {
  const { pos, heads, w, h } = layout(nodes, edges);
  const sel = ui.sel;
  const flagged = new Map();
  for (const f of ui.data.findings || []) for (const id of f.nodes) if (!flagged.has(id) || f.severity === 'high') flagged.set(id, f.severity);
  const near = sel ? new Set(edges.filter((e) => e.from === sel || e.to === sel).flatMap((e) => [e.from, e.to])) : null;
  const typed = ui.tab !== 'static';
  const markers = Object.keys(ui.data.edgeTypes).map((t) =>
    `<marker id="m-${t}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="mk e-${typed ? t : 'plain'}"/></marker>`).join('');
  let s = `<svg class="map-svg" width="${Math.round(w * ui.zoom)}" height="${Math.round(h * ui.zoom)}" data-w="${w}" data-h="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Agent map"><defs>${markers}</defs>`;
  s += heads.map((hd) => `<text class="map-head" x="${hd.x}" y="22">${esc(hd.label)}</text>`).join('');
  for (const e of edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    const on = sel && (e.from === sel || e.to === sel);
    const cls = ['edge', 'e-' + (typed ? e.type : 'plain'), e.assumed ? 'assumed' : '', sel ? (on ? 'hi' : 'dim') : ''].join(' ');
    const tip = (ui.data.edgeTypes[e.type] || {}).label + (e.labels && e.labels.length ? ': ' + e.labels.join(', ') : '') + (e.assumed ? ' (assumed)' : '');
    s += `<path class="${cls}" d="${edgePath(a, b)}" marker-end="url(#m-${typed ? e.type : 'plain'})"><title>${esc(tip)}</title></path>`;
  }
  for (const n of nodes) {
    const p = pos.get(n.id);
    const cls = ['node', 't-' + n.type, n.id === sel ? 'sel' : '', near && !near.has(n.id) ? 'dim' : '', n.live ? 'live' : '', n.live === false ? 'idle' : '', n.active === false || n.enabled === false ? 'off' : ''].join(' ');
    const name = n.name.length > 24 ? n.name.slice(0, 23) + '…' : n.name;
    s += `<g class="${cls}" data-node="${esc(n.id)}" transform="translate(${p.x},${p.y})" tabindex="0">` +
      `<title>${esc(n.name + (n.description ? ' — ' + n.description.slice(0, 200) : ''))}</title>` +
      `<rect width="${NODE_W}" height="${NODE_H}" rx="7"/>` +
      `<text class="ic" x="11" y="19">${TYPE_ICON[n.type] || '•'}</text>` +
      `<text x="27" y="19">${esc(name)}</text>` +
      (n.live ? `<circle class="pulse" cx="${NODE_W - 10}" cy="${NODE_H / 2}" r="4"/>` : '') +
      (flagged.has(n.id) ? `<circle class="flag f-${flagged.get(n.id)}" cx="${NODE_W - (n.live ? 22 : 10)}" cy="${NODE_H / 2}" r="4"><title>Has audit findings</title></circle>` : '') + '</g>';
  }
  return s + '</svg>';
}

function legend() {
  const types = ui.data.edgeTypes;
  const row = (t, extra = '') => `<div class="lg-row"><svg width="46" height="12"><line x1="2" y1="6" x2="38" y2="6" class="edge e-${t} ${extra}" marker-end="url(#m-${t})"/></svg>` +
    `<div><b>${esc(types[t] ? types[t].label : 'assumed')}</b><div class="small muted">${esc(types[t] ? types[t].how : '')}</div></div></div>`;
  if (ui.tab === 'static') {
    return '<div class="map-legend card"><div class="ttl">How to read it</div><div class="small muted">Static shows what exists and that two pieces are connected, ' +
      'in one ink. The <b>Flow</b> tab says how: one arrow style per kind of interaction. Faint lines are <b>assumed</b>: they rest on a bare mention, not on a call Claude Code acts on.</div></div>';
  }
  return '<div class="map-legend card"><div class="ttl">Arrows</div>' + Object.keys(types).filter((t) => t !== 'provides' || ui.tab !== 'flow').map((t) => row(t)).join('') +
    `<div class="lg-row"><svg width="46" height="12"><line x1="2" y1="6" x2="38" y2="6" class="edge e-invoke assumed"/></svg><div><b>faint = assumed</b><div class="small muted">A bare mention (an agent\'s name in prose, "Notion" with no tool call, a phase that matches a command name). Likely, not guaranteed.</div></div></div></div>`;
}

function details(nodes, edges) {
  const d = ui.data;
  const n = d.nodes.find((x) => x.id === ui.sel);
  if (!n) return '<div class="map-side card"><div class="small muted">Click a piece to see what it is and who it talks to. ' +
    '«Trace from here» keeps only what it sets in motion.</div></div>';
  const byId = new Map(d.nodes.map((x) => [x.id, x]));
  const all = d.edges.filter((e) => ui.assumed || !e.assumed);
  const list = (arr, other) => arr.length ? arr.map((e) => {
    const o = byId.get(e[other]);
    return `<div class="map-link"><span class="sw e-${e.type}"></span><span class="small muted">${esc(d.edgeTypes[e.type].label)}</span> ` +
      `<a data-node="${esc(e[other])}">${esc(o ? o.name : e[other])}</a>${e.assumed ? ' <span class="tag warn">assumed</span>' : ''}` +
      (e.labels && e.labels.length ? ` <span class="small muted">· ${esc(e.labels.join(', '))}</span>` : '') +
      (e.evidence ? `<div class="small muted mono">${esc(e.evidence)}</div>` : '') + '</div>';
  }).join('') : '<div class="small muted">—</div>';
  const s = n.session;
  return '<div class="map-side card">' +
    `<div class="ttl">${TYPE_ICON[n.type] || ''} ${esc(n.name)} <span class="tag">${esc((d.nodeTypes[n.type] || {}).label || n.type)}</span>` +
    (n.live ? ' <span class="tag acc">running</span>' : n.live === false ? ' <span class="tag">not running</span>' : '') + '</div>' +
    (n.description ? `<div class="desc">${esc(n.description)}</div>` : '') +
    (n.schedule ? `<div class="small">Schedule: ${esc(n.schedule)}</div>` : '') +
    (s ? `<div class="small" style="margin-top:6px">${[s.title && 'Title: ' + esc(s.title), s.ticket && 'Ticket: ' + esc(s.ticket + ' · ' + s.side), s.phase && 'Phase: ' + esc(s.phase), s.status && 'Status: ' + esc(s.status), s.cwd && 'Folder: <span class="mono">' + esc(s.cwd) + '</span>', '<span class="mono muted">' + esc(s.sid) + '</span>'].filter(Boolean).join('<br>')}</div>` : '') +
    (n.origins && n.origins.length ? `<div class="small muted mono" style="margin-top:6px">${n.origins.map(esc).join('<br>')}</div>` : '') +
    `<div class="row"><button class="ghost" data-trace="${esc(n.id)}">Trace from here</button>${ui.trace ? '<button class="ghost" data-trace="">Show all</button>' : ''}</div>` +
    ((d.findings || []).some((f) => f.nodes.includes(n.id)) ? '<h2 class="sec">Audit</h2>' + (d.findings || []).filter((f) => f.nodes.includes(n.id))
      .map((f) => `<div class="map-link"><span class="tag ${f.severity === 'high' ? 'err' : f.severity === 'medium' ? 'warn' : ''}">${esc(f.severity)}</span> ${esc(f.title)}</div>`).join('') : '') +
    (n.scopes && n.scopes.length ? `<div class="small" style="margin-top:6px">Scope: ${n.scopes.map((x) => '<span class="tag">' + esc(x) + '</span>').join(' ')}</div>` : '') +
    '<h2 class="sec">Talks to</h2>' + list(all.filter((e) => e.from === n.id), 'to') +
    '<h2 class="sec">Is reached by</h2>' + list(all.filter((e) => e.to === n.id), 'from') + '</div>';
}

function liveBanner() {
  const l = ui.data.live;
  if (!l) return '';
  const chats = ui.data.nodes.filter((n) => n.session && n.live);
  return '<div class="card"><div class="ttl">' + l.running + ' chats running now</div><div class="small muted">' +
    (l.stateFound ? 'Coordinator state: <span class="mono">' + esc(l.statePath) + '</span>' : (l.statePath ? 'No coordinator state at <span class="mono">' + esc(l.statePath) + '</span>' : 'No scanned project has a <span class="mono">.sdd/_conductor/state.json</span>') + ': roles and phases unknown (start the panel with --sdd-state to point at one).') +
    ' · read ' + esc(fwhen(l.readAt)) + ' · refreshes every 15 s</div>' +
    (chats.length ? '<table class="map-live"><tr><th>Chat</th><th>Role</th><th>Ticket</th><th>Phase</th><th>Status</th></tr>' + chats.map((n) => {
      const s = n.session;
      return `<tr data-node="${esc(n.id)}"><td>${esc(s.title || s.name || s.sid.slice(0, 8))}</td><td>${esc(s.role || '')}</td><td>${esc(s.ticket ? s.ticket + ' · ' + s.side : '')}</td><td>${esc(s.phase || '')}</td><td>${esc(s.status || '')}</td></tr>`;
    }).join('') + '</table>' : '') + '</div>';
}

function draw(main) {
  const d = ui.data;
  const { nodes, edges } = visible();
  const counts = {};
  for (const n of d.nodes) if (ui.tab === 'live' || !n.id.startsWith('live:')) counts[n.type] = (counts[n.type] || 0) + 1;
  const assumedN = d.edges.filter((e) => e.assumed).length;
  const allowed = allowedScopes();
  const findings = (d.findings || []).filter((f) => inScope(f.scopes, allowed));
  const tabs = [['flow', 'Flow'], ['static', 'Static'], ['live', 'Live'], ['audit', 'Audit' + (findings.length ? ' (' + findings.length + ')' : '')]];
  const scopeSel = '<label class="chk">Scope <select data-scope class="map-scope"><option value="all">Everything</option>' +
    (d.scopes || []).map((sc) => sc === 'Global'
      ? `<option value="only:Global"${ui.scope === 'only:Global' ? ' selected' : ''}>Global only</option>`
      : `<option value="eff:${esc(sc)}"${ui.scope === 'eff:' + sc ? ' selected' : ''}>${esc(sc)}: as Claude sees it there (+ global)</option>` +
        `<option value="only:${esc(sc)}"${ui.scope === 'only:' + sc ? ' selected' : ''}>${esc(sc)} only</option>`).join('') + '</select></label>';
  let h = '<div class="map-root"><h1>Agent map</h1><p class="lede">How the pieces of your setup start, call and watch one another, read from the config on disk. ' +
    'A connection is drawn only when the text of a piece names the other one; when it is only a guess, it is drawn faint and marked assumed.</p>';
  h += '<div class="tabs">' + tabs.map(([k, l]) => `<div class="tab${ui.tab === k ? ' on' : ''}" data-tab="${k}">${l}</div>`).join('') + '</div>';
  if (ui.tab === 'live') h += liveBanner();
  if (ui.tab === 'audit') {
    h += '<div class="map-filters">' + scopeSel + '</div>' + auditList(findings) + '</div>';
    main.innerHTML = h;
    return;
  }
  h += '<div class="map-filters">' + scopeSel + STATIC_ORDER.filter((t) => counts[t]).map((t) =>
    `<label class="chk"><input type="checkbox" data-type="${t}"${ui.hidden.has(t) ? '' : ' checked'}> ${TYPE_ICON[t]} ${esc((d.nodeTypes[t] || {}).label || t)} <span class="muted">${counts[t]}</span></label>`).join('') +
    `<label class="chk"><input type="checkbox" data-opt="assumed"${ui.assumed ? ' checked' : ''}> assumed edges <span class="muted">${assumedN}</span></label>` +
    (ui.tab !== 'flow' ? `<label class="chk"><input type="checkbox" data-opt="lonely"${ui.lonely ? ' checked' : ''}> unconnected pieces</label>` : '') + '</div>';
  if (ui.trace) {
    const t = d.nodes.find((n) => n.id === ui.trace);
    h += `<div class="msg warn">Showing only what <b>${esc(t ? t.name : ui.trace)}</b> sets in motion. <a data-trace="">Show all</a></div>`;
  }
  h += '<div class="map-body"><div class="map-stage"><div class="map-zoom">' +
    '<button class="ghost" data-zoom="out" title="Zoom out (⌘/Ctrl + wheel)">−</button>' +
    '<span class="map-zl">' + Math.round(ui.zoom * 100) + '%</span>' +
    '<button class="ghost" data-zoom="in" title="Zoom in (⌘/Ctrl + wheel)">+</button>' +
    '<button class="ghost" data-zoom="fit" title="Fit the whole map in view">Fit</button>' +
    '<button class="ghost" data-zoom="reset" title="Actual size">100%</button>' +
    '<span class="small muted">Pinch or ⌘/Ctrl + wheel to zoom · drag the background to move</span></div>' +
    '<div class="map-canvas">' + (nodes.length ? svg(nodes, edges) : '<div class="small muted" style="padding:20px">Nothing to draw with these filters.</div>') + '</div></div>' +
    '<div class="map-aside">' + details(nodes, edges) + legend() + '</div></div>';
  h += `<div class="small muted">${nodes.length} pieces and ${edges.length} connections shown, of ${d.nodes.length} and ${d.edges.length}.</div></div>`;
  const old = main.querySelector('.map-canvas');
  const scroll = old ? [old.scrollLeft, old.scrollTop] : null;
  main.innerHTML = h;
  const canvas = main.querySelector('.map-canvas');
  wireCanvas(main, canvas);
  // The first time, a map wider than the screen opens fitted rather than cut.
  if (!ui.fitted && canvas.querySelector('.map-svg')) { ui.fitted = true; if (fitZoom(canvas) < 1) return setZoom(main, fitZoom(canvas)); }
  if (scroll) [canvas.scrollLeft, canvas.scrollTop] = scroll;
}

const KIND_HELP = {
  'broken-ref': 'Calls to commands that do not exist',
  'missing-agent': 'Delegations to agents that do not exist',
  'scope-mismatch': 'Calls that cross scopes',
  'shadowed': 'Same name in Global and a project',
  'assumed-only': 'Subagents reached only by prose',
  'unused-agent': 'Subagents nothing delegates to',
  'unknown-matcher': 'Hook matchers naming no known tool',
  'routine-off': 'Routines that will not run',
  'undeclared-mcp': 'MCP servers called but not declared',
};

function auditList(findings) {
  if (!findings.length) return '<div class="card"><div class="ttl">Nothing to flag in this scope</div><div class="small muted">The checks below found no problem.</div></div>' + auditHelp();
  const groups = new Map();
  for (const f of findings) { if (!groups.has(f.kind)) groups.set(f.kind, []); groups.get(f.kind).push(f); }
  const count = (sev) => findings.filter((f) => f.severity === sev).length;
  let h = '<div class="grid">' + ['high', 'medium', 'low'].map((sev) => `<div class="card"><div class="ttl">${count(sev)}</div><div class="small muted">${sev}</div></div>`).join('') + '</div>';
  for (const [kind, list] of groups) {
    h += `<h2 class="sec">${esc(KIND_HELP[kind] || kind)} · ${list.length}</h2>`;
    h += list.map((f) => `<div class="card clk map-finding" data-finding="${esc(f.nodes[0])}"><div class="ttl"><span class="tag ${f.severity === 'high' ? 'err' : f.severity === 'medium' ? 'warn' : ''}">${esc(f.severity)}</span> ${esc(f.title)}</div>` +
      `<div class="desc">${esc(f.detail)}</div>` + (f.scopes.length ? `<div class="small muted">${f.scopes.map(esc).join(' · ')}</div>` : '') + '</div>').join('');
  }
  return h + auditHelp();
}

function auditHelp() {
  return '<div class="small muted" style="margin-top:18px;max-width:80ch">These checks read only the graph: names that point nowhere, calls that cross scopes, pieces nothing reaches. ' +
    'They do not judge whether a skill is well written or a permission too broad: for that, the <a data-go-audits>Auditor</a> tab and the auditor-config agent read the whole configuration. ' +
    'Click a finding to see the piece on the map.</div>';
}

/* ------------------------------------------------------------------ zoom and pan */

function fitZoom(canvas) {
  const sv = canvas.querySelector('.map-svg');
  if (!sv) return 1;
  const w = Number(sv.dataset.w), h = Number(sv.dataset.h);
  return Math.max(ZMIN, Math.min(1, (canvas.clientWidth - 4) / w, (canvas.clientHeight - 4) / h));
}

/** Rescales the drawing in place, keeping the point under (ax, ay) where it is. */
function setZoom(main, z, ax, ay) {
  const canvas = main.querySelector('.map-canvas');
  const sv = canvas && canvas.querySelector('.map-svg');
  z = Math.max(ZMIN, Math.min(ZMAX, z));
  if (!sv) { ui.zoom = z; return; }
  if (ax == null) { ax = canvas.clientWidth / 2; ay = canvas.clientHeight / 2; }
  const k = z / ui.zoom;
  const px = canvas.scrollLeft + ax, py = canvas.scrollTop + ay;
  ui.zoom = z;
  sv.setAttribute('width', Math.round(Number(sv.dataset.w) * z));
  sv.setAttribute('height', Math.round(Number(sv.dataset.h) * z));
  canvas.scrollLeft = px * k - ax;
  canvas.scrollTop = py * k - ay;
  const label = main.querySelector('.map-zl');
  if (label) label.textContent = Math.round(z * 100) + '%';
}

let dragged = false;
function wireCanvas(main, canvas) {
  if (!canvas) return;
  // Pinch on a trackpad arrives as a wheel event with ctrlKey.
  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    setZoom(main, ui.zoom * Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('[data-node]')) return;
    const x0 = e.clientX, y0 = e.clientY, sl = canvas.scrollLeft, st = canvas.scrollTop;
    dragged = false;
    canvas.classList.add('panning');
    const move = (ev) => {
      if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 4) dragged = true;
      canvas.scrollLeft = sl - (ev.clientX - x0);
      canvas.scrollTop = st - (ev.clientY - y0);
    };
    const up = () => { canvas.classList.remove('panning'); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    e.preventDefault();
  });
}

/* ------------------------------------------------------------------ events */

function onClick(e, main) {
  const fd = e.target.closest('[data-finding]');
  if (fd) { ui.tab = 'static'; ui.sel = fd.dataset.finding; ui.lonely = true; ui.trace = null; ui.fitted = false; return load(main); }
  if (e.target.closest('[data-go-audits]')) { const nav = document.querySelector('.nav[data-v="audits"]'); if (nav) nav.click(); return; }
  const zb = e.target.closest('[data-zoom]');
  if (zb) {
    const z = zb.dataset.zoom;
    const canvas = main.querySelector('.map-canvas');
    return setZoom(main, z === 'in' ? ui.zoom * 1.25 : z === 'out' ? ui.zoom / 1.25 : z === 'fit' ? fitZoom(canvas) : 1);
  }
  const tab = e.target.closest('[data-tab]');
  if (tab) { ui.tab = tab.dataset.tab; ui.trace = null; ui.fitted = false; return load(main); }
  const tr = e.target.closest('[data-trace]');
  if (tr) { ui.trace = tr.dataset.trace || null; return draw(main); }
  const n = e.target.closest('[data-node]');
  if (n) { ui.sel = ui.sel === n.dataset.node ? null : n.dataset.node; return draw(main); }
  if (e.target.closest('.map-svg') && !n && !dragged) { ui.sel = null; draw(main); }
}

function onChange(e, main) {
  if ('scope' in e.target.dataset) { ui.scope = e.target.value; ui.fitted = false; return draw(main); }
  const t = e.target.dataset.type, o = e.target.dataset.opt;
  if (t) { if (e.target.checked) ui.hidden.delete(t); else ui.hidden.add(t); }
  if (o) ui[o] = e.target.checked;
  draw(main);
}
