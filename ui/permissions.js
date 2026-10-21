// Traduce una regla de permisos de Claude Code a una frase en castellano,
// y la marca cuando es más amplia de lo que parece o actúa fuera de la máquina.
const TOOLS = {
  Bash: 'ejecutar comandos en la terminal',
  Read: 'leer ficheros',
  Write: 'crear o sobrescribir ficheros',
  Edit: 'modificar ficheros',
  MultiEdit: 'modificar varios trozos de un fichero',
  NotebookEdit: 'modificar notebooks de Jupyter',
  Glob: 'buscar ficheros por nombre',
  Grep: 'buscar texto dentro de los ficheros',
  WebFetch: 'descargar el contenido de una web',
  WebSearch: 'buscar en internet',
  Task: 'lanzar subagentes',
  TodoWrite: 'gestionar su lista de tareas'
};
const CMD_HINT = {
  git:'git', npm:'npm', pnpm:'pnpm', yarn:'yarn', node:'Node', python3:'Python', bash:'bash',
  grep:'grep', cat:'cat', ls:'ls', find:'find', echo:'echo', pwd:'pwd', which:'which',
  rm:'rm', chmod:'chmod', jq:'jq', docker:'Docker', gh:'la CLI de GitHub', nx:'Nx'
};
const BROAD = new Set(['bash','sh','zsh','node','python3','python','eval','npx','pnpm dlx']);

export function explain(rule) {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(rule);
  if (mcp) {
    const out = /send|post|create|delete|trash|update|write|reply|forward|schedule/i.test(mcp[2]);
    return { text: 'Herramienta ' + mcp[2] + ' del conector externo. ' +
      (out ? 'Actúa hacia fuera: puede enviar o cambiar algo en ese servicio.' : 'Sólo consulta datos de ese servicio.'),
      level: out ? 'outbound' : 'normal' };
  }
  const m = /^([A-Za-z]+)(?:\((.*)\))?$/.exec(rule);
  if (!m) return { text: 'Regla sin reconocer.', level: 'normal' };
  const [, tool, arg] = m;
  const base = TOOLS[tool] || ('usar la herramienta ' + tool);
  if (!arg) return { text: 'Puede ' + base + ' sin preguntar.', level: 'normal' };
  if (tool !== 'Bash') {
    const where = arg === '**' ? 'en cualquier ruta' : 'en ' + arg;
    return { text: 'Puede ' + base + ' ' + where + ' sin preguntar.', level: arg === '**' ? 'broad' : 'normal' };
  }
  const prog = arg.trim().split(/\s+/)[0].replace(/[*:]/g, '');
  const name = CMD_HINT[prog] || prog;
  const open = /\*$/.test(arg.trim());
  let txt = 'Puede ejecutar ' + name + (open ? ' con cualquier argumento' : ' exactamente así') + ', sin preguntar.';
  let level = 'normal';
  if (BROAD.has(prog)) { level = 'broad'; txt += ' Ojo: eso permite correr cualquier script, así que en la práctica es un permiso muy amplio.'; }
  if (/^rm\b/.test(arg)) { level = 'broad'; txt += ' Borra ficheros.'; }
  return { text: txt, level };
}
