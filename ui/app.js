// Panel state and interface: navigation, listings, detail and editing.
import { $, esc } from './util.js';
import { explain } from './permissions.js';
import { md } from './markdown.js';

let DATA = null, view = 'overview', cur = null, text = '', orig = '', tab = 'ui';
let PEOPLE = null, openPerson = null, FLOWS = null;

/* ----- boot ----- */
async function boot() {
  DATA = await (await fetch('/api/items')).json();
  const navs = [['overview', '◉', 'Overview', '']]
    .concat(Object.entries(DATA.kinds).map(([k, v]) => [k, v.icon, v.label, DATA.counts[k]]))
    .concat([['flows', '⇢', 'Flows', ''], ['diagnostics', '✓', 'Diagnostics', ''],
      ['people', '☻', 'People', '']]);
  $('#nav').innerHTML = navs.map(([k, ic, lab, n]) =>
    '<div class="nav" data-v="' + k + '"><span class="ic">' + ic + '</span>' + lab +
    (n === '' ? '' : '<span class="n">' + n + '</span>') + '</div>').join('');
  $('#nav').onclick = (e) => { const el = e.target.closest('.nav'); if (el) go(el.dataset.v); };
  go('overview');
}
function go(v) { view = v; cur = null; openPerson = null;
  document.querySelectorAll('.nav').forEach((e) => e.classList.toggle('on', e.dataset.v === v));
  if (v === 'overview') renderOverview();
  else if (v === 'people') renderPeople();
  else if (v === 'flows') renderFlows();
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

/* ----- diagnostics ----- */

const SEV = { high: 'err', medium: 'warn', low: '' };

async function renderDiagnostics() {
  $('#main').innerHTML = '<h1>Diagnostics</h1><p class="lede">Looking for audit reports…</p>';
  const { informes } = await (await fetch('/api/findings')).json();

  let h = '<h1>Diagnostics</h1><p class="lede">What the audit said about this configuration. ' +
    'The panel does not compute it: an auditor produces it and it is stored in ' +
    '<code>.claude/audit/findings.json</code>. Here it is only read and shown beside what you have.</p>';

  if (!informes.length) {
    h += '<div class="card"><div class="ttl">No audit yet</div>' +
      '<div class="desc" style="margin-bottom:8px">Ask an auditing agent for one from the repo you want ' +
      'reviewed. It writes its report to <code>.claude/audit/findings.json</code> and the panel picks it up.</div>' +
      copyBlock('Audit this repo\'s Claude configuration. Read only, report first.') + '</div>';
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
      fdate(inf.generatedAt) + ' · ' +
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

const fdate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

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

function jsonUI() {
  const p = parsed();
  if (!p) return '<div class="card"><div class="msg err">This JSON is not valid. Fix it in the JSON tab.</div></div>';
  const perm = p.permissions || {}, allow = perm.allow || [], deny = perm.deny || [];
  const modes = [['default', 'Normal — asks for permission according to the rules'],
    ['plan', 'Plan — must show you the plan before touching anything'],
    ['acceptEdits', 'Auto-edit — accepts file changes without asking'],
    ['bypassPermissions', 'No brakes — asks nothing (dangerous)']];
  let h = '<div class="card"><div class="ttl">How a session starts in this scope</div>' +
    '<div class="desc" style="margin-bottom:10px">This is the control point: it decides whether Claude can start editing straight away or has to go through you.</div>' +
    '<select id="mode">' + modes.map(([v, l]) =>
      '<option value="' + v + '"' + ((perm.defaultMode || 'default') === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>';

  const section = (titleTxt, descTxt, rules, key) => {
    let s = '<div class="card"><div class="ttl">' + titleTxt + ' <span class="tag">' + rules.length + '</span></div>' +
      '<div class="desc" style="margin-bottom:6px">' + descTxt + '</div>';
    if (!rules.length) s += '<div class="desc" style="opacity:.6">No rules.</div>';
    rules.forEach((r, i) => {
      const e = explain(r);
      s += '<div class="perm"><code>' + esc(r) + '</code><div class="ex">' + esc(e.text) +
        (e.level === 'broad' ? ' <span class="tag warn">broad</span>' : '') +
        (e.level === 'outbound' ? ' <span class="tag err">outbound</span>' : '') +
        '</div><span class="x" data-del="' + key + ':' + i + '">&times;</span></div>';
    });
    s += '<div class="row"><input type="text" id="add_' + key + '" placeholder="Bash(npm test *)">' +
      '<button class="ghost" data-add="' + key + '">Add</button></div></div>';
    return s;
  };
  h += section('What it can do without asking you', 'Every rule is an open door. The fewer and the narrower, the better.', allow, 'allow');
  h += section('What it is forbidden to do', 'This always wins over the above.', deny, 'deny');

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

  const rest = Object.entries(p).filter(([k]) => !['permissions', 'hooks'].includes(k));
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
