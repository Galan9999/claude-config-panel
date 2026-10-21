// Estado e interfaz del panel: navegación, listados, detalle y edición.
import { $, esc } from './util.js';
import { explain } from './permissions.js';
import { md } from './markdown.js';

let DATA = null, view = 'resumen', cur = null, text = '', orig = '', tab = 'ui';
let PEOPLE = null, personaAbierta = null, FLOWS = null;

/* ----- arranque ----- */
async function boot() {
  DATA = await (await fetch('/api/items')).json();
  const navs = [['resumen', '◉', 'Resumen', '']]
    .concat(Object.entries(DATA.kinds).map(([k, v]) => [k, v.icon, v.label, DATA.counts[k]]))
    .concat([['flujos', '⇢', 'Flujos', ''], ['diagnostico', '✓', 'Diagnóstico', ''],
      ['personas', '☻', 'Personas', '']]);
  $('#nav').innerHTML = navs.map(([k, ic, lab, n]) =>
    '<div class="nav" data-v="' + k + '"><span class="ic">' + ic + '</span>' + lab +
    (n === '' ? '' : '<span class="n">' + n + '</span>') + '</div>').join('');
  $('#nav').onclick = (e) => { const el = e.target.closest('.nav'); if (el) go(el.dataset.v); };
  go('resumen');
}
function go(v) { view = v; cur = null; personaAbierta = null;
  document.querySelectorAll('.nav').forEach((e) => e.classList.toggle('on', e.dataset.v === v));
  if (v === 'resumen') renderResumen();
  else if (v === 'personas') renderPersonas();
  else if (v === 'flujos') renderFlujos();
  else if (v === 'diagnostico') renderDiagnostico();
  else renderList(v);
  window.scrollTo(0, 0); $('#main').scrollTop = 0; }

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

/* ----- diagnóstico ----- */

const SEV = { alta: 'err', media: 'warn', baja: '' };

async function renderDiagnostico() {
  $('#main').innerHTML = '<h1>Diagnóstico</h1><p class="lede">Buscando informes de auditoría…</p>';
  const { informes } = await (await fetch('/api/findings')).json();

  let h = '<h1>Diagnóstico</h1><p class="lede">Lo que la auditoría dijo de esta configuración. ' +
    'No lo calcula el panel: lo produce un auditor y se guarda en <code>.claude/audit/findings.json</code>. ' +
    'Aquí sólo se lee y se enseña al lado de lo que hay.</p>';

  if (!informes.length) {
    h += '<div class="card"><div class="ttl">Todavía no hay ninguna auditoría</div>' +
      '<div class="desc" style="margin-bottom:8px">Pídesela al agente <code>auditor-config</code> desde el repo ' +
      'que quieras revisar. Escribe su informe en <code>.claude/audit/findings.json</code> y el panel lo recoge solo.</div>' +
      copyBlock('Audita la configuración de Claude de este repo con el agente auditor-config. ' +
        'Sólo lectura, informe primero.') + '</div>';
    $('#main').innerHTML = h;
    $('#main').onclick = copyHandler;
    return;
  }

  for (const inf of informes) {
    if (inf.errors.length) {
      h += '<div class="card"><div class="ttl">' + esc(inf.repoLabel) + '<span class="tag err">inválido</span></div>' +
        '<div class="desc">' + esc(inf.path) + ' no cumple el esquema: ' + esc(inf.errors.join('; ')) + '</div></div>';
      continue;
    }
    const cuenta = { alta: 0, media: 0, baja: 0 };
    inf.findings.forEach((f) => { cuenta[f.severity] += 1; });

    h += '<h2 class="sec">' + esc(inf.repoLabel) + ' · ' + inf.findings.length + ' hallazgos</h2>' +
      '<div class="hint"><b>Si sólo haces una cosa:</b> ' + esc(inf.summary) + '</div>' +
      '<div class="card"><div class="desc">Auditado por <code>' + esc(inf.tool) + '</code> el ' +
      fecha(inf.generatedAt) + ' · ' +
      Object.entries(cuenta).filter(([, n]) => n).map(([s, n]) =>
        '<span class="tag ' + SEV[s] + '">' + n + ' ' + s + '</span>').join(' ') + '</div></div>';

    for (const f of inf.findings) {
      h += '<div class="card"><div class="ttl"><span class="tag ' + SEV[f.severity] + '">' + esc(f.severity) + '</span>' +
        esc(f.title) + '<span class="tag">' + esc(f.category) + '</span></div>' +
        '<div class="desc" style="margin-top:6px">' + esc(f.what) + '</div>' +
        '<div class="desc" style="margin-top:6px"><b>Qué hacer:</b> ' + esc(f.proposal) + '</div>' +
        '<div class="desc" style="margin-top:8px"><code>' + esc(f.path) + (f.line ? ':' + f.line : '') + '</code>' +
        (f.itemId ? ' <span class="rule clk" data-id="' + esc(f.itemId) + '" style="cursor:pointer">Ver la pieza</span>' : '') +
        (f.autofix ? ' <span class="tag acc">arreglo mecánico</span>' : '') + '</div>' +
        (f.notion ? '<div class="desc" style="margin-top:7px"><a href="' + esc(f.notion.url) +
          '" target="_blank" rel="noopener">Hallazgo en Notion</a></div>' +
          copyBlock('/lp:task --from-finding ' + f.notion.url) : '') +
        '</div>';
    }

    if (inf.notChecked.length) {
      h += '<div class="card"><div class="ttl">Lo que el auditor no pudo comprobar<span class="tag">' +
        inf.notChecked.length + '</span></div><div class="desc" style="margin-bottom:8px">' +
        'Está aquí a propósito: es la diferencia entre un informe honesto y uno que se lo inventa.</div><ul class="md">' +
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

/* ----- flujos ----- */

/**
 * Diagrama del pipeline, en SVG hecho a mano.
 *
 * Nada de Mermaid: traerlo significaría un CDN, y el panel no carga nada de
 * fuera. En vertical y no en horizontal porque siete fases en una fila obligan a
 * encoger la letra hasta no leerse en un panel estrecho.
 */
function diagramaFlujo(f) {
  const W = 420, ALTO = 34, HUECO = 14, M = 8;
  const alto = f.phases.length * ALTO + (f.phases.length - 1) * HUECO + M * 2;
  const esGate = (p) => /\bgate\b/i.test(p.title);

  let svg = '<svg viewBox="0 0 ' + W + ' ' + alto + '" width="100%" ' +
    'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Diagrama del flujo /' + esc(f.folder) + '">' +
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

/** Corta un texto largo por la primera frase o por `max`. */
function resumen(t, max) {
  const limpio = String(t || '').replace(/^[^—-]*[—-]\s*/, '').trim();
  const corte = limpio.split(/(?<=\.)\s/)[0];
  return corte.length > max ? corte.slice(0, max - 1) + '…' : corte;
}

async function renderFlujos() {
  $('#main').innerHTML = '<h1>Flujos</h1><p class="lede">Leyendo los comandos…</p>';
  FLOWS = await (await fetch('/api/flows')).json();
  const { flows, desvios } = FLOWS;

  let h = '<h1>Flujos</h1><p class="lede">Secuencias de comandos numerados que forman un pipeline. ' +
    'Esto no es una explicación escrita a mano: sale de los propios ficheros, así que no puede quedarse ' +
    'desfasada respecto a lo que de verdad se ejecuta.</p>';

  if (!flows.length) {
    h += '<div class="card"><div class="desc">No hay comandos numerados. Un flujo se detecta cuando una ' +
      'carpeta de comandos tiene varios ficheros <code>N.nombre.md</code>.</div></div>';
  }

  for (const f of flows) {
    h += '<h2 class="sec">/' + esc(f.folder) + ':* · ' + esc(f.scope.split('/').slice(-2).join('/')) +
      ' · ' + f.phases.length + ' fases</h2>' +
      '<div class="card diagrama">' + diagramaFlujo(f) + '</div>';
    for (const p of f.phases) {
      h += '<div class="card"><div class="ttl">' +
        '<span class="paso">' + p.order + '</span>/' + esc(f.folder) + ':' + esc(p.slug) +
        (p.model ? '<span class="tag acc">' + esc(p.model) + '</span>' : '') +
        '<span class="tag">' + p.tools.length + ' herramientas</span>' +
        (p.agents ? '<span class="tag">lanza subagentes</span>' : '') + '</div>' +
        '<div class="desc" style="margin-top:6px">' + esc(p.title) + '</div>' +
        (p.hint ? '<div class="desc" style="margin-top:5px"><code>' + esc(p.hint) + '</code></div>' : '');
      if (p.invoca.length) {
        h += '<div class="desc" style="margin-top:9px">Invoca: ' + p.invoca.map((a) =>
          '<span class="rule clk" data-id="' + esc(a.id) + '" style="cursor:pointer">◇ ' + esc(a.name) + '</span>').join(' ') + '</div>';
      }
      if (p.outward.length) {
        h += '<div class="desc" style="margin-top:9px">Puede actuar fuera sin preguntar: ' +
          p.outward.map((t) => '<span class="rule" style="border-color:var(--err);color:var(--err)">' +
            esc(t.split('__').slice(2).join('__')) + '</span>').join(' ') + '</div>';
      }
      h += '<div class="row" style="margin-top:11px"><span class="rule clk" data-id="' + esc(p.id) +
        '" style="cursor:pointer">Ver el comando</span></div></div>';
    }
    if (f.docs.length) {
      h += '<div class="card"><div class="ttl">Documentación del flujo</div>' +
        '<div class="desc">La prosa vive aquí, y manda sobre cualquier diagrama. El panel la enlaza, no la copia.</div>' +
        '<div class="rules" style="margin-top:10px">' + f.docs.map((d) =>
          '<span class="rule clk" data-id="' + esc(d.id) + '" style="cursor:pointer">' + esc(d.name) + '</span>').join('') +
        '</div></div>';
    }
  }

  const rotos = desvios.filter((d) => d.tipo === 'comando-inexistente');
  const rutas = desvios.filter((d) => d.tipo === 'ruta-inexistente');
  h += '<h2 class="sec">Desvíos · ' + desvios.length + '</h2>';
  if (!desvios.length) {
    h += '<div class="card"><div class="desc">Todo lo que citan los comandos y la documentación existe.</div></div>';
  }
  if (rotos.length) {
    h += '<div class="card"><div class="ttl">Comandos citados que no existen<span class="tag err">' + rotos.length + '</span></div>' +
      '<div class="desc" style="margin-bottom:8px">Documentación que describe algo que ya no se puede ejecutar. ' +
      'Es lo que convierte un README en una trampa.</div><table><tr><th>Cita</th><th>Dónde</th></tr>' +
      rotos.map((d) => '<tr><td class="cmd">' + esc(d.que) + '</td><td class="cmd clk" data-id="' + esc(d.id) +
        '" style="cursor:pointer">' + esc(d.donde) + '</td></tr>').join('') + '</table></div>';
  }
  if (rutas.length) {
    h += '<div class="card"><div class="ttl">Rutas citadas que no están<span class="tag warn">' + rutas.length + '</span></div>' +
      '<div class="desc" style="margin-bottom:8px">Ojo: algunas las genera el propio flujo al ejecutarse, ' +
      'así que no todas son un error. Las carpetas ya se descartan.</div><table><tr><th>Ruta</th><th>Citada en</th></tr>' +
      rutas.map((d) => '<tr><td class="cmd">' + esc(d.que) + '</td><td class="cmd clk" data-id="' + esc(d.id) +
        '" style="cursor:pointer">' + esc(d.donde) + '</td></tr>').join('') + '</table></div>';
  }

  $('#main').innerHTML = h;
  $('#main').onclick = (e) => { const c = e.target.closest('[data-id]'); if (c) openItem(c.dataset.id); };
}

/* ----- personas ----- */

const inicial = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

async function renderPersonas(repo) {
  $('#main').innerHTML = '<h1>Personas</h1><p class="lede">Leyendo el historial del repositorio…</p>';
  PEOPLE = await (await fetch('/api/people' + (repo ? '?repo=' + encodeURIComponent(repo) : ''))).json();
  const { people, repos, repoLabel, piezas, sinHistorial } = PEOPLE;

  let h = '<h1>Personas</h1><p class="lede">Quién ha construido la configuración de este repositorio: ' +
    'qué creó cada uno y qué ha tocado después. Sale del historial de git, así que sólo cubre lo versionado.</p>';

  if (repos.length > 1) {
    h += '<div class="card"><label>Repositorio</label><select id="repoSel">' + repos.map((r) =>
      '<option value="' + esc(r.repo) + '"' + (r.repo === PEOPLE.repo ? ' selected' : '') + '>' +
      esc(r.label) + ' · ' + r.items + ' piezas</option>').join('') + '</select></div>';
  }

  if (!people.length) {
    return ($('#main').innerHTML = h + '<div class="card"><div class="desc">Ninguna pieza de ' +
      esc(repoLabel || 'este ámbito') + ' está versionada, así que no hay autoría que mostrar.</div></div>');
  }

  h += '<h2 class="sec">' + esc(repoLabel) + ' · ' + piezas + ' piezas · ' + people.length + ' personas</h2>';
  for (const p of people) {
    const porTipo = (lista) => {
      const c = {};
      for (const x of lista) c[x.kind] = (c[x.kind] || 0) + 1;
      return Object.entries(c).sort((a, b) => b[1] - a[1])
        .map(([k, n]) => '<span class="tag">' + DATA.kinds[k].icon + ' ' + n + ' ' + esc(DATA.kinds[k].label.toLowerCase()) + '</span>').join(' ');
    };
    h += '<div class="card clk" data-persona="' + esc(p.id) + '">' +
      '<div class="ttl"><span class="avatar">' + esc(inicial(p.name)) + '</span>' + esc(p.name) +
      '<span class="tag acc">' + p.created.length + ' creadas</span>' +
      (p.modified.length ? '<span class="tag">' + p.modified.length + ' tocadas</span>' : '') +
      '<span class="tag">' + p.commits + ' commits</span></div>' +
      '<div class="desc" style="margin:8px 0 6px">Creó: ' + (porTipo(p.created) || '<i>nada</i>') + '</div>' +
      (p.modified.length ? '<div class="desc" style="margin-bottom:6px">Tocó: ' + porTipo(p.modified) + '</div>' : '') +
      '<div class="desc">Del ' + fecha(p.first) + ' al ' + fecha(p.last) + ' · ' +
      p.emails.map((e) => '<code>' + esc(e) + '</code>').join(' ') +
      (p.names.length > 1 ? ' · firma como ' + p.names.map(esc).join(', ') : '') + '</div></div>';
  }

  if (sinHistorial) {
    h += '<div class="card"><div class="desc">' + sinHistorial + ' piezas quedan fuera de este recuento ' +
      'porque no están en ningún repositorio (las de <code>~/.claude</code>) o están en <code>.gitignore</code> ' +
      '(los <code>settings.local.json</code>). De esas no hay autoría que recuperar.</div></div>';
  }

  $('#main').innerHTML = h;
  const sel = $('#repoSel');
  if (sel) sel.onchange = () => renderPersonas(sel.value);
  $('#main').onclick = (e) => {
    const c = e.target.closest('[data-persona]');
    if (c) return renderPersona(c.dataset.persona);
  };
}

function renderPersona(id) {
  const p = PEOPLE.people.find((x) => x.id === id);
  if (!p) return renderPersonas(PEOPLE.repo);
  personaAbierta = id;

  const grupo = (titulo, lista, vacio) => {
    if (!lista.length) return '<h2 class="sec">' + titulo + '</h2><div class="card"><div class="desc">' + vacio + '</div></div>';
    const porTipo = {};
    for (const x of lista) (porTipo[x.kind] ??= []).push(x);
    let out = '<h2 class="sec">' + titulo + ' · ' + lista.length + '</h2>';
    for (const [k, xs] of Object.entries(porTipo)) {
      out += '<div class="card"><div class="ttl">' + DATA.kinds[k].icon + ' ' + esc(DATA.kinds[k].label) +
        '<span class="tag">' + xs.length + '</span></div><div class="rules" style="margin-top:10px">' +
        xs.sort((a, b) => a.name.localeCompare(b.name)).map((x) => {
          // La misma skill puede existir en dos paquetes del monorepo: sin el
          // ámbito, el perfil enseña dos etiquetas idénticas.
          const repetido = xs.filter((y) => y.name === x.name).length > 1;
          const donde = repetido ? ' <span class="sc">' + esc(x.scope.split('/').slice(-2).join('/')) + '</span>' : '';
          return '<span class="rule clk" data-id="' + esc(x.id) + '" style="cursor:pointer">' + esc(x.name) + donde + '</span>';
        }).join('') +
        '</div></div>';
    }
    return out;
  };

  $('#main').innerHTML =
    '<div class="back" data-volver>← Personas</div>' +
    '<h1><span class="avatar big">' + esc(inicial(p.name)) + '</span>' + esc(p.name) + '</h1>' +
    '<p class="lede">' + p.created.length + ' piezas creadas, ' + p.modified.length + ' tocadas después, ' +
    p.commits + ' commits sobre la configuración. Del ' + fecha(p.first) + ' al ' + fecha(p.last) + '.</p>' +
    '<div class="path">' + p.emails.map(esc).join(' · ') +
    (p.names.length > 1 ? '<br>Firma como: ' + p.names.map(esc).join(', ') : '') + '</div>' +
    grupo('Creó', p.created, 'No ha creado ninguna pieza en este repositorio.') +
    grupo('Tocó después', p.modified, 'No ha modificado piezas de otros.');

  $('#main').onclick = (e) => {
    if (e.target.closest('[data-volver]')) return renderPersonas(PEOPLE.repo);
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
  let h = '<div class="back" data-back>← ' + (personaAbierta ? 'Perfil' : esc(DATA.kinds[cur.kind].label)) + '</div>' +
    '<h1>' + esc(cur.title) + '</h1>' +
    (cur.description ? '<p class="lede">' + esc(cur.description) + '</p>' : '') +
    '<div class="path">' + esc(cur.displayPath) + '</div>' +
    '<div class="tabs">' + tabs.map(([t, l]) =>
      '<div class="tab' + (tab === t ? ' on' : '') + '" data-t="' + t + '">' + l + '</div>').join('') + '</div>';

  h += hallazgosDeLaPieza();
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

/** La revisión del auditor, al lado de lo que hay. Va arriba del todo: es lo
 *  primero que quieres saber al abrir una pieza, no una nota a pie de página. */
function hallazgosDeLaPieza() {
  let h = '';
  if (cur.hallazgos && cur.hallazgos.length) {
    h += '<div class="card"><div class="ttl">Hallazgos de la auditoría<span class="tag err">' +
      cur.hallazgos.length + '</span></div>' +
      '<div class="desc" style="margin-bottom:10px">Lo que la última auditoría dijo de esta pieza. ' +
      'Está aquí al lado de lo que hay, sin tocar nada.</div>' +
      cur.hallazgos.map((f) => '<div class="perm" style="display:block">' +
        '<div class="ttl" style="font-size:13.5px"><span class="tag ' +
        (f.severity === 'alta' ? 'err' : f.severity === 'media' ? 'warn' : '') + '">' + esc(f.severity) + '</span>' +
        esc(f.title) + '</div>' +
        '<div class="desc" style="margin-top:4px">' + esc(f.what) + '</div>' +
        '<div class="desc" style="margin-top:4px"><b>Propuesta:</b> ' + esc(f.proposal) + '</div>' +
        (f.notion
          ? '<div class="desc" style="margin-top:7px"><a href="' + esc(f.notion.url) + '" target="_blank" rel="noopener">' +
            'Ver el hallazgo en Notion</a>' +
            (f.notion.recurrences > 1 ? ' · detectado ' + f.notion.recurrences + ' veces' : '') + '</div>' +
            copyBlock('/lp:task --from-finding ' + f.notion.url)
          : '<div class="desc" style="margin-top:7px">Aún no está en Notion. ' +
            'Lánzale la auditoría al agente <code>auditor-config</code> pidiéndole que publique.</div>') +
        '</div>').join('') + '</div>';
  }
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
    h += '<div class="card"><div class="ttl">Abrir issue en el repo</div>' +
      '<div class="desc">Para lo técnico que no pasa por la board. Si tu equipo gestiona el trabajo en ' +
      'otro sitio, el camino bueno es el hallazgo de arriba, no esto.</div>' +
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
    if (e.target.closest('[data-back]')) {
      if (personaAbierta) return renderPersona(personaAbierta);
      return go(cur.kind);
    }
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
