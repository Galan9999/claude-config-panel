// Flujos: secuencias de comandos numerados que forman un pipeline.
//
// La idea es no volver a contar el flujo con palabras. Si un equipo tiene
// `.claude/commands/lpb/1.read.md … 7.close.md`, el orden, el modelo de cada
// fase y lo que cada una puede hacer ya están en los ficheros. Dibujarlos desde
// ahí significa que el diagrama no puede quedarse obsoleto: si alguien renombra
// una fase, el panel lo refleja: no hay segunda fuente de verdad que mantener.

/** `lpb:3.dev` -> { folder: 'lpb', order: 3, slug: 'dev' }. null si no es una fase. */
export function parsePhase(name) {
  const m = /^([^:]+):(\d+)\.(.+)$/.exec(name || '');
  return m ? { folder: m[1], order: Number(m[2]), slug: m[3] } : null;
}

/** Un `_NOMBRE.md` dentro de una carpeta de comandos es documentación, no un comando. */
export function isFolderDoc(name) {
  return /^[^:]+:_/.test(name || '');
}

/** Agrupa los comandos en flujos por carpeta, ordenados por su número. */
export function groupFlows(commands) {
  const flows = new Map();
  for (const c of commands) {
    const p = parsePhase(c.name);
    if (!p) continue;
    if (!flows.has(p.folder)) flows.set(p.folder, { folder: p.folder, scope: c.scope, repo: c.repo, phases: [], docs: [] });
    flows.get(p.folder).phases.push({ ...p, item: c });
  }
  for (const c of commands) {
    if (!isFolderDoc(c.name)) continue;
    const folder = c.name.split(':')[0];
    if (flows.has(folder)) flows.get(folder).docs.push(c);
  }
  for (const f of flows.values()) f.phases.sort((a, b) => a.order - b.order);
  // Un solo comando numerado no es un pipeline.
  return [...flows.values()].filter((f) => f.phases.length > 1);
}

// El verbo va en cualquier posición del nombre, con _ o - alrededor:
// slack_send_message, notion-update-page, trash_thread.
const OUTWARD = /(^|[_-])(send|create|update|delete|trash|post|reply|forward|schedule|publish|merge|close)([_-]|$)/i;

/** Nombre de la herramienta dentro de `mcp__<servidor>__<herramienta>`. */
const mcpTool = (t) => t.split('__').slice(2).join('__');

/**
 * Separa las herramientas que una fase puede usar sin preguntar, marcando las
 * que actúan fuera de la máquina. Que `5.sync` escriba en Notion y abra PRs sin
 * confirmación es justo lo que no se ve leyendo el flujo en prosa.
 */
export function parseTools(allowedTools) {
  const tools = String(allowedTools || '').split(',').map((t) => t.trim()).filter(Boolean);
  return {
    tools,
    outward: tools.filter((t) => t.startsWith('mcp__') && OUTWARD.test(mcpTool(t))),
    agents: tools.includes('Task'),
  };
}

/** Referencias a comandos del tipo `/lpb:3.dev` que aparecen en un texto. */
export function findCommandRefs(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/\/([a-z0-9_-]+):([a-z0-9_.-]+)/gi)) {
    out.add(m[1] + ':' + m[2]);
  }
  return [...out];
}

/**
 * Rutas de configuración citadas en un texto, para comprobar si siguen
 * existiendo. Se dejan fuera las carpetas: muchas se crean al vuelo cuando el
 * flujo corre (`.claude/tickets/`), así que que falten no significa nada.
 */
export function findConfigPaths(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/(?:^|[\s"'`(])((?:\.claude|apps\/[a-z0-9-]+\/\.claude)\/[\w./-]+)/gi)) {
    const ruta = m[1].replace(/[.,:;)]+$/, '');
    if (ruta.endsWith('/')) continue;
    out.add(ruta);
  }
  return [...out];
}

/**
 * `/lpb:N`, `/lpb:<fase>` y `/lpb:X` son huecos de la prosa, no comandos.
 * Marcarlos como rotos llena el informe de ruido y entierra los de verdad.
 */
const ES_HUECO = (fase) => /^[A-Z]$|^[A-Z]{1,3}[-_]|^<|^\{/.test(fase) || /^(n|x|fase|phase|cmd)$/i.test(fase);

/**
 * Referencias rotas: comandos citados que no existen.
 * @param {string[]} refs  lo que cita el texto
 * @param {Set<string>} known  nombres de comando que existen de verdad
 */
export function brokenRefs(refs, known) {
  // Sólo nos metemos con las carpetas que conocemos: `/api:algo` de otro
  // contexto no es un comando roto, es que no va de esto.
  const folders = new Set([...known].map((n) => n.split(':')[0]));
  return refs.filter((r) => {
    const [folder, ...resto] = r.split(':');
    const fase = resto.join(':');
    return folders.has(folder) && !known.has(r) && !ES_HUECO(fase);
  });
}
