// Cómo se llama cada cosa de cara al usuario. Un fichero `settings.local.json`
// no le dice nada a nadie; "Configuración local del proyecto" sí.

/** @returns {[titulo: string, descripcion: string]} */
export function describeConfig(file, isGlobal) {
  if (file === 'CLAUDE.md') return isGlobal
    ? ['Instrucciones permanentes (global)', 'Reglas que Claude lee en todas tus sesiones, estés en el proyecto que estés. Es tu manual de estilo con él.']
    : ['Instrucciones del proyecto', 'Reglas que Claude lee sólo al trabajar en este proyecto: convenciones, comandos, cosas que no debe tocar.'];
  if (file === 'settings.json') return isGlobal
    ? ['Configuración global', 'La base para todos los proyectos: permisos, hooks, apariencia. Lo que pongas en un proyecto manda sobre esto.']
    : ['Configuración del proyecto', 'Se versiona en git, así que la comparte todo el equipo. Lo que vale para cualquiera que trabaje aquí.'];
  if (file === 'settings.local.json') return isGlobal
    ? ['Configuración global privada', 'Como la global, pero sólo tuya. Útil para permisos que no quieres dejar fijos.']
    : ['Configuración local del proyecto', 'Sólo tuya: está en .gitignore y no la ve el equipo. Aquí van tus preferencias personales en este repo.'];
  return [file, ''];
}

export const KIND_INFO = {
  config:  { label: 'Configuración', one: 'ajuste',  icon: '⚙',  blurb: 'Permisos, hooks y preferencias. La global vale para todo; cada proyecto afina encima.' },
  skill:   { label: 'Skills',        one: 'skill',   icon: '◆',  blurb: 'Instrucciones que Claude carga sólo cuando hacen falta. Su descripción es lo que decide si se activa o no.' },
  agent:   { label: 'Agentes',       one: 'agente',  icon: '◇',  blurb: 'Subagentes con su propio contexto y sus propias herramientas, para delegar trabajo acotado.' },
  command: { label: 'Comandos',      one: 'comando', icon: '/',  blurb: 'Los que invocas tú escribiendo barra. Hacen siempre lo mismo, sin depender de que Claude decida.' },
  hook:    { label: 'Hooks y scripts', one: 'script', icon: '⚡', blurb: 'Lo que se ejecuta solo, sin pedirte permiso, cuando ocurre un evento. La pieza que más conviene revisar.' },
  task:    { label: 'Tareas programadas', one: 'tarea', icon: '◷', blurb: 'Se lanzan por calendario, sin que tú estés delante.' },
};

/** La vista de personas no es un tipo de pieza, pero navega igual. */
export const PEOPLE_INFO = {
  label: 'Personas', icon: '◉',
  blurb: 'Quién ha construido la configuración de estos repos: qué creó cada uno y qué ha tocado después.',
};
