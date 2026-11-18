// The Sources view: which folders the panel reads, and what each one holds.
// Two ways in: everything under your home folder, then untick what you do not
// want; or only the folders you list. Claude Code can find them for you.
// The choice is kept in this browser and re-applied when the server restarts.
import { esc } from './util.js';
import { summarize, summaryLine, findPrompt, KIND_LABEL } from './sources.js';

const KEY = 'ccp.sources';

export function savedSources() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function keep(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } }

const post = async (body) => {
  const r = await fetch('/api/sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
  return d;
};

/** On boot: put back the folders chosen last time, if the server forgot them. */
export async function reapplySources() {
  const s = savedSources();
  if (!s) return false;
  try {
    const cur = await (await fetch('/api/sources')).json();
    const sameRoots = JSON.stringify(cur.roots) === JSON.stringify(s.roots);
    const curOut = cur.projects.filter((p) => !p.included).map((p) => p.label).sort();
    const sameOut = JSON.stringify(curOut) === JSON.stringify([...(s.exclude || [])].sort());
    if (sameRoots && sameOut) return false;
    const fresh = sameRoots ? cur : await post({ roots: s.roots });
    const exclude = fresh.projects.filter((p) => (s.exclude || []).includes(p.label)).map((p) => p.path);
    await post({ exclude });
    return true;
  } catch { return false; }
}

let st = { d: null, mode: null, err: '', busy: false };

export async function renderSources(main, onChange) {
  main.innerHTML = '<h1>Sources</h1><p class="lede">Loading…</p>';
  try { st.d = await (await fetch('/api/sources')).json(); } catch (e) { main.innerHTML = '<h1>Sources</h1><div class="msg err">' + esc(String(e)) + '</div>'; return; }
  st.mode = st.mode || st.d.mode;
  st.err = '';
  draw(main);
  main.onclick = (e) => click(e, main, onChange);
  main.onchange = (e) => {
    if (e.target.name === 'src-mode') { st.mode = e.target.value; draw(main); }
  };
}

function scopeCard(label, files, { path, included, global } = {}) {
  const groups = summarize(files);
  return `<div class="card src-scope${included === false ? ' off' : ''}">` +
    '<div class="ttl">' + (global ? '' : `<input type="checkbox" data-proj="${esc(path)}"${included ? ' checked' : ''} aria-label="Include ${esc(label)}">`) +
    `<span class="mono">${esc(label)}</span>` + (global ? ' <span class="tag acc">global · always read</span>' : '') +
    `<span class="small muted">${esc(summaryLine(files))}</span></div>` +
    (groups.length ? '<details><summary class="small">What is in it</summary><div class="src-files">' + groups.map((g) =>
      `<div><b class="small">${esc(KIND_LABEL[g.kind] || g.kind)}</b> <span class="small muted">${g.names.map(esc).join(' · ')}</span></div>`).join('') + '</div></details>' : '') +
    '</div>';
}

function draw(main) {
  const d = st.d;
  const everything = st.mode === 'everything';
  const on = d.projects.filter((p) => p.included);
  const pieces = d.global.files.length + on.reduce((a, p) => a + p.files.length, 0);
  let h = '<h1>Sources</h1><p class="lede">Which folders the panel reads. Everything stays on this machine; changing this only changes what is read.</p>';
  h += `<div class="grid">${stat(on.length + ' of ' + d.projects.length, 'projects included')}${stat(pieces, 'pieces read')}${stat(d.roots.length, d.roots.length === 1 ? 'folder scanned' : 'folders scanned')}</div>`;

  h += '<h2 class="sec">1 · Where to look</h2><div class="grid src-modes">' +
    `<label class="card clk${everything ? ' on' : ''}"><div class="ttl"><input type="radio" name="src-mode" value="everything"${everything ? ' checked' : ''}> Everything on this computer</div>` +
    '<div class="desc">Scans your whole home folder (skipping Library, caches, node_modules and worktrees) and finds every <code>.claude</code>. Then untick what you do not want below.</div></label>' +
    `<label class="card clk${everything ? '' : ' on'}"><div class="ttl"><input type="radio" name="src-mode" value="chosen"${everything ? '' : ' checked'}> Only the folders I choose</div>` +
    '<div class="desc">Lists only what is under the folders you name: one per line, absolute or starting with <code>~/</code>. <code>~/.claude</code> is always read.</div></label></div>';
  if (!everything) {
    h += `<textarea id="src-roots" class="src-roots" spellcheck="false" placeholder="~/code&#10;~/work/my-repo">${esc((d.mode === 'chosen' ? d.roots : []).join('\n'))}</textarea>`;
  }
  h += `<div class="row"><button data-src="scan"${st.busy ? ' disabled' : ''}>${everything ? 'Scan my home folder' : 'Scan these folders'}</button>` +
    (st.busy ? '<span class="msg">Scanning…</span>' : '') + (st.err ? `<span class="msg err">${esc(st.err)}</span>` : '') + '</div>';

  h += '<h2 class="sec">Let Claude Code find them</h2><div class="card"><div class="desc" style="margin-top:0">Not sure where your configuration lives? Paste this into Claude Code: it lists the folders and what each holds, without opening or changing anything. Then paste the paths above.</div>' +
    `<pre class="src-prompt" id="src-prompt">${esc(findPrompt(st.mode, everything ? [] : d.roots))}</pre>` +
    '<div class="row"><button class="ghost" data-src="copy">Copy prompt</button><span class="msg" id="src-copied"></span></div></div>';

  h += '<h2 class="sec">2 · What goes in</h2>' +
    '<div class="row" style="margin:0 0 10px"><button class="ghost" data-src="all">All</button><button class="ghost" data-src="none">None</button>' +
    '<button data-src="apply">Apply</button><span class="small muted">Untick a project to leave it out of every view.</span></div>';
  h += scopeCard('~/.claude', d.global.files, { global: true });
  h += d.projects.length ? d.projects.map((p) => scopeCard(p.label, p.files, p)).join('')
    : '<div class="card"><div class="small muted">No project with a <code>.claude</code> folder under ' + d.roots.map((r) => '<code>' + esc(r) + '</code>').join(', ') + '.</div></div>';
  if (d.skipped.length) h += `<div class="small muted" style="margin-top:8px">${d.skipped.length} worktrees skipped (start with --worktrees to include them).</div>`;
  main.innerHTML = h;
}

const stat = (n, label) => `<div class="card"><div class="ttl" style="font-size:20px">${esc(n)}</div><div class="small muted">${esc(label)}</div></div>`;

async function click(e, main, onChange) {
  const b = e.target.closest('[data-src]');
  if (!b) return;
  const act = b.dataset.src;
  if (act === 'copy') {
    try { await navigator.clipboard.writeText(document.getElementById('src-prompt').textContent); document.getElementById('src-copied').textContent = 'Copied.'; }
    catch { document.getElementById('src-copied').textContent = 'Select the text and copy it by hand.'; }
    return;
  }
  if (act === 'all' || act === 'none') {
    main.querySelectorAll('[data-proj]').forEach((c) => { c.checked = act === 'all'; });
    return;
  }
  // Read the form before redrawing: the redraw puts the boxes back as the server has them.
  const roots = st.mode === 'everything' ? ['~']
    : (document.getElementById('src-roots') ? document.getElementById('src-roots').value : st.d.roots.join('\n')).split('\n').map((x) => x.trim()).filter(Boolean);
  const exclude = [...main.querySelectorAll('[data-proj]')].filter((c) => !c.checked).map((c) => c.dataset.proj);
  st.busy = true; st.err = ''; draw(main);
  try {
    if (act === 'scan') {
      if (!roots.length) throw new Error('Write at least one folder.');
      st.d = await post({ roots });
    }
    if (act === 'apply') st.d = await post({ exclude });
    keep({ roots: st.d.roots, exclude: st.d.projects.filter((p) => !p.included).map((p) => p.label) });
    if (onChange) await onChange();
  } catch (err) { st.err = err.message || String(err); }
  st.busy = false;
  draw(main);
}
