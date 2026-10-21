// Estado e interfaz del panel: navegación, listados, detalle y edición.
import { $, esc } from './util.js';
import { explain } from './permissions.js';
import { md } from './markdown.js';

let DATA = null, view = 'resumen', cur = null, text = '', orig = '', tab = 'ui';

/* ----- arranque ----- */
async function boot() {
  DATA = await (await fetch('/api/items')).json();
  const navs = [['resumen', '◉', 'Resumen', '']].concat(
    Object.entries(DATA.kinds).map(([k, v]) => [k, v.icon, v.label, DATA.counts[k]]));
  $('#nav').innerHTML = navs.map(([k, ic, lab, n]) =>
    '<div class="nav" data-v="' + k + '"><span class="ic">' + ic + '</span>' + lab +
    (n === '' ? '' : '<span class="n">' + n + '</span>') + '</div>').join('');
  $('#nav').onclick = (e) => { const el = e.target.closest('.nav'); if (el) go(el.dataset.v); };
  go('resumen');
}
function go(v) { view = v; cur = null;
  document.querySelectorAll('.nav').forEach((e) => e.classList.toggle('on', e.dataset.v === v));
  v === 'resumen' ? renderResumen() : renderList(v); window.scrollTo(0, 0); $('#main').scrollTop = 0; }

/* ----- resumen ----- */
function renderResumen() {
  const scopes = DATA.scopes;
  let h = '<h1>Qué tiene configurado Claude</h1><p class="lede">Cada pieza se carga en un momento distinto y con reglas distintas. ' +
    'Esto es todo lo que hay en tu máquina, agrupado por tipo de pieza en vez de por fichero.</p><div class="grid">';
  for (const [k, v] of Object.entries(DATA.kinds)) {
    h += '<div class="card clk" data-go="' + k + '"><div class="kpi">' + DATA.counts[k] + '</div>' +
      '<div class="ttl" style="margin-top:2px">' + v.icon + ' ' + v.label + '</div>' +
      '<div class="desc">' + esc(v.blurb) + '</div></div>';
  }
  h += '</div><h2 class="sec">Ámbitos detectados (' + scopes.length + ')</h2><div class="card">' +
    scopes.map((s) => '<span class="tag" style="margin:0 6px 6px 0;display:inline-block">' + esc(s) + '</span>').join('') +
    ((DATA.skipped || []).length ? '<div class="desc" style="margin-top:11px">' + DATA.skipped.length +
      ' worktrees omitidos porque comparten la config de su repo. Arranca con <code>--worktrees</code> si quieres verlos.</div>' : '') +
    '</div>';

  h += '<h2 class="sec">Revisar todo esto con Claude</h2>' +
    '<div class="hint"><b>Un panel te enseña qué hay; no te dice si está bien.</b> ' +
    'Para eso lanza una auditoría: Claude lee estas piezas y te devuelve un informe de qué sobra, qué se solapa y qué nunca llega a dispararse.</div>' +
    '<div class="card"><div class="ttl">Auditoría completa</div>' +
    '<div class="desc">Pégalo en Claude Code dentro del repo que quieras revisar.</div>' +
    copyBlock('Audita la configuración de Claude de este repo con el agente auditor-config: ' +
      'skills, agentes, comandos, hooks y permisos. Dime qué se solapa, qué nunca se dispara, ' +
      'qué permiso es más amplio de lo que hace falta y qué hook actúa sin que yo lo vea. ' +
      'Informe primero, sin tocar nada.') + '</div>';
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

/* ----- listados ----- */
function renderList(kind) {
  const info = DATA.kinds[kind];
  const items = DATA.items.filter((i) => i.kind === kind);
  const groups = {};
  items.forEach((i) => { (groups[i.scope] ??= []).push(i); });
  let h = '<h1>' + info.label + '</h1><p class="lede">' + esc(info.blurb) + '</p>';
  if (!items.length) h += '<div class="card"><div class="desc">No hay ninguna pieza de este tipo.</div></div>';
  for (const [scope, list] of Object.entries(groups)) {
    h += '<h2 class="sec">' + esc(scope) + ' · ' + list.length + '</h2>';
    for (const it of list) {
      h += '<div class="card clk" data-id="' + it.id + '"><div class="ttl">' + esc(it.title) +
        (it.name !== it.title ? ' <span class="tag">' + esc(it.name) + '</span>' : '') +
        (it.remote ? ' <span class="tag acc">repo</span>' : '') + '</div>' +
        (it.description ? '<div class="desc">' + esc(it.description.slice(0, 260)) +
          (it.description.length > 260 ? '…' : '') + '</div>' : '<div class="desc" style="opacity:.6">Sin descripción.</div>') +
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
    ? [['ui', 'Vista'], ['raw', 'JSON']]
    : [['leer', 'Leer'], ['raw', 'Editar']];
  let h = '<div class="back" data-back>← ' + esc(DATA.kinds[cur.kind].label) + '</div>' +
    '<h1>' + esc(cur.title) + '</h1>' +
    (cur.description ? '<p class="lede">' + esc(cur.description) + '</p>' : '') +
    '<div class="path">' + esc(cur.displayPath) + '</div>' +
    '<div class="tabs">' + tabs.map(([t, l]) =>
      '<div class="tab' + (tab === t ? ' on' : '') + '" data-t="' + t + '">' + l + '</div>').join('') + '</div>';

  if (tab === 'ui' && cur.format === 'json') h += jsonUI() + historial();
  else if (tab === 'leer') h += '<div class="md">' + md(text) + '</div>' + actions();
  else h += '<textarea id="raw" spellcheck="false">' + esc(text) + '</textarea>';

  if (tab !== 'leer') h += '<div class="bar">' +
    '<button id="save"' + (dirty ? '' : ' disabled') + '>Guardar</button>' +
    '<button class="ghost" id="reset"' + (dirty ? '' : ' disabled') + '>Descartar</button>' +
    '<span class="msg' + (dirty ? ' warn' : '') + '" id="msg">' + (dirty ? 'cambios sin guardar' : '') + '</span></div>';

  $('#main').innerHTML = h;
  wire();
}

const fecha = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
};

function historial() {
  const g = cur.git || {};
  if (!g.tracked) {
    const porque = g.reason === 'fuera de un repositorio'
      ? 'Esta pieza no está dentro de un repositorio git, así que no hay autoría que mostrar: sólo la fecha del fichero.'
      : 'Git no sigue este fichero (' + esc(g.reason || 'sin historial') + '), así que no hay autoría que mostrar.';
    return '<h2 class="sec">Historial</h2><div class="card"><div class="desc">' + porque +
      (cur.mtime ? ' Modificado por última vez el ' + fecha(cur.mtime) + '.' : '') + '</div></div>';
  }
  const { creator, lastChange, commits, authors } = g.history;
  const link = (c) => cur.remote
    ? '<a href="' + esc(cur.remote) + '/commit/' + esc(c.hash) + '" target="_blank" rel="noopener">' + esc(c.hash.slice(0, 7)) + '</a>'
    : '<code>' + esc(c.hash.slice(0, 7)) + '</code>';

  let h = '<h2 class="sec">Historial</h2><div class="card">' +
    '<div class="ttl">Creada por ' + esc(creator.author) + '<span class="tag">' + fecha(creator.date) + '</span></div>' +
    '<div class="desc">Último cambio: ' + esc(lastChange.author) + ', ' + fecha(lastChange.date) + '. ' +
    commits + (commits === 1 ? ' cambio en total' : ' cambios en total') +
    (authors.length > 1 ? ', de ' + authors.length + ' personas' : '') + '.</div>';

  if (authors.length > 1) {
    h += '<div class="rules" style="margin-top:10px">' + authors.map((a) =>
      '<span class="rule">' + esc(a.author) + ' <b style="cursor:default">' + a.commits + '</b></span>').join('') + '</div>';
  }

  h += '<table style="margin-top:12px"><tr><th>Cuándo</th><th>Quién</th><th>Qué</th><th>Líneas</th></tr>' +
    g.changes.map((c) => '<tr><td>' + fecha(c.date) + '</td><td>' + esc(c.author) + '</td>' +
      '<td>' + esc(c.subject) + ' ' + link(c) + '</td>' +
      '<td class="cmd" style="white-space:nowrap">' +
      (c.added ? '<span style="color:var(--ok)">+' + c.added + '</span> ' : '') +
      (c.removed ? '<span style="color:var(--err)">−' + c.removed + '</span>' : '') + '</td></tr>').join('') +
    '</table></div>';
  return h;
}

function actions() {
  let h = historial() + '<h2 class="sec">Acciones</h2>';
  const label = DATA.kinds[cur.kind].one;
  h += '<div class="card"><div class="ttl">Auditar con Claude</div>' +
    '<div class="desc">Copia esto y pégalo en Claude Code: te dice si esta pieza se dispara cuando debe y si se solapa con otra.</div>' +
    copyBlock('Audita ' + (cur.kind === 'skill' ? 'la skill' : 'el ' + label) + ' "' + cur.name + '" (' + cur.displayPath + '). ' +
      'Mira si la descripción dispara en los casos reales, si se solapa con otra pieza, si el prompt es más largo de lo necesario ' +
      'y qué obstáculos no está reportando. Informe primero, sin tocar nada.') + '</div>';
  if (cur.remote && cur.relPath) {
    const title = 'Mejorar ' + label + ': ' + cur.name;
    const bodyTxt = 'Fichero: ' + cur.relPath + '\n\nQué falla:\n- \n\nQué debería hacer:\n- \n';
    const url = cur.remote + '/issues/new?title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(bodyTxt);
    h += '<div class="card"><div class="ttl">Abrir ticket en el repo</div>' +
      '<div class="desc">Issue prellenado en ' + esc(cur.remote.replace('https://github.com/', '')) + ' con la ruta del fichero.</div>' +
      '<div class="row"><a href="' + esc(url) + '" target="_blank" rel="noopener"><button>Crear issue en GitHub</button></a></div>' +
      copyBlock('gh issue create --repo ' + cur.remote.replace('https://github.com/', '') +
        ' --title "' + title + '" --body "Fichero: ' + cur.relPath + '"') + '</div>';
  }
  return h;
}

function parsed() { try { return JSON.parse(text); } catch { return null; } }
function setObj(o) { text = JSON.stringify(o, null, 2) + '\n'; renderItem(); }

function jsonUI() {
  const p = parsed();
  if (!p) return '<div class="card"><div class="msg err">El JSON no es válido. Arréglalo en la pestaña JSON.</div></div>';
  const perm = p.permissions || {}, allow = perm.allow || [], deny = perm.deny || [];
  const modes = [['default', 'Normal — pide permiso según las reglas'],
    ['plan', 'Plan — tiene que enseñarte el plan antes de tocar nada'],
    ['acceptEdits', 'Edición automática — acepta cambios de ficheros sin preguntar'],
    ['bypassPermissions', 'Sin frenos — no pregunta nada (peligroso)']];
  let h = '<div class="card"><div class="ttl">Cómo arranca una sesión en este ámbito</div>' +
    '<div class="desc" style="margin-bottom:10px">Es el punto de control: decide si Claude puede ponerse a editar directamente o tiene que pasar por ti.</div>' +
    '<select id="mode">' + modes.map(([v, l]) =>
      '<option value="' + v + '"' + ((perm.defaultMode || 'default') === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>';

  const section = (titleTxt, descTxt, rules, key) => {
    let s = '<div class="card"><div class="ttl">' + titleTxt + ' <span class="tag">' + rules.length + '</span></div>' +
      '<div class="desc" style="margin-bottom:6px">' + descTxt + '</div>';
    if (!rules.length) s += '<div class="desc" style="opacity:.6">Ninguna regla.</div>';
    rules.forEach((r, i) => {
      const e = explain(r);
      s += '<div class="perm"><code>' + esc(r) + '</code><div class="ex">' + esc(e.text) +
        (e.level === 'broad' ? ' <span class="tag warn">amplio</span>' : '') +
        (e.level === 'outbound' ? ' <span class="tag err">sale fuera</span>' : '') +
        '</div><span class="x" data-del="' + key + ':' + i + '">&times;</span></div>';
    });
    s += '<div class="row"><input type="text" id="add_' + key + '" placeholder="Bash(npm test *)">' +
      '<button class="ghost" data-add="' + key + '">Añadir</button></div></div>';
    return s;
  };
  h += section('Lo que puede hacer sin preguntarte', 'Cada regla es una puerta abierta. Cuantas menos y más estrechas, mejor.', allow, 'allow');
  h += section('Lo que tiene prohibido', 'Esto gana siempre sobre lo anterior.', deny, 'deny');

  const rows = [];
  for (const [ev, arr] of Object.entries(p.hooks || {}))
    for (const g of arr || []) for (const hk of g.hooks || [])
      rows.push([ev, g.matcher || '(todo)', hk.command || '', hk.async ? 'en segundo plano' : (hk.timeout ? hk.timeout + 's máx' : '')]);
  if (rows.length) h += '<div class="card"><div class="ttl">Lo que se ejecuta solo <span class="tag">' + rows.length + '</span></div>' +
    '<div class="desc" style="margin-bottom:8px">Se dispara sin pedirte permiso cuando ocurre el evento. Es lo que conviene mirar con más calma.</div>' +
    '<table><tr><th>Cuándo</th><th>Sobre qué</th><th>Qué ejecuta</th><th></th></tr>' +
    rows.map((r) => '<tr><td>' + esc(r[0]) + '</td><td class="cmd">' + esc(r[1]) + '</td><td class="cmd">' +
      esc(r[2].length > 170 ? r[2].slice(0, 170) + '…' : r[2]) + '</td><td>' + esc(r[3]) + '</td></tr>').join('') +
    '</table><div class="desc" style="margin-top:9px">Para cambiarlos, pestaña JSON.</div></div>';

  const rest = Object.entries(p).filter(([k]) => !['permissions', 'hooks'].includes(k));
  if (rest.length) h += '<div class="card"><div class="ttl">Otros ajustes</div><table>' + rest.map(([k, v]) =>
    '<tr><td><code>' + esc(k) + '</code></td><td class="cmd">' + esc(typeof v === 'object' ? JSON.stringify(v) : String(v)) + '</td></tr>').join('') + '</table></div>';
  return h;
}

function wire() {
  const main = $('#main');
  main.onclick = (e) => {
    if (e.target.closest('[data-back]')) return go(cur.kind);
    const t = e.target.closest('.tab');
    if (t) { if (tab === 'raw') { const ta = $('#raw'); if (ta) text = ta.value; } tab = t.dataset.t; return renderItem(); }
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
    m.textContent = bad ? 'JSON inválido' : (d ? 'cambios sin guardar' : '');
    m.className = 'msg' + (bad ? ' err' : (d ? ' warn' : ''));
    $('#save').disabled = !d || bad; $('#reset').disabled = !d; };
  const rst = $('#reset'); if (rst) rst.onclick = () => { text = orig; renderItem(); };
  const sv = $('#save'); if (sv) sv.onclick = async () => {
    const r = await (await fetch('/api/item', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: cur.id, content: text }) })).json();
    const m = $('#msg');
    if (r.error) { m.textContent = r.error; m.className = 'msg err'; return; }
    orig = text; m.textContent = 'guardado · copia en ' + r.backup; m.className = 'msg ok';
    $('#save').disabled = true; $('#reset').disabled = true; };
}
boot();

// Expuesto para depurar desde la consola del navegador.
Object.assign(window, { go, openItem, md, explain });
// Object.assign copiaría el valor, no el getter: DATA cambia, así que va aparte.
Object.defineProperty(window, 'DATA', { get: () => DATA });
