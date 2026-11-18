// Interface language: English (the source strings), Spanish and Catalan.
// `t(s)` looks the English string up and falls back to it, so a string nobody
// has translated yet still shows, in English, instead of an empty hole.

export const LANGS = [['en', 'English'], ['es', 'Español'], ['ca', 'Català']];
let lang = 'en';
export const getLang = () => lang;
export const setLang = (l) => { lang = LANGS.some((x) => x[0] === l) ? l : 'en'; };

const ES = {
  'Overview': 'Resumen', 'Pieces': 'Piezas', 'Permissions': 'Permisos', 'Runs on its own': 'Se ejecuta solo',
  'Mods': 'Mods', 'MCP servers': 'Servidores MCP', 'Routines': 'Rutinas', 'Usage': 'Uso', 'Skill evals': 'Evals de skills',
  'Audit': 'Auditoría', 'Load my config': 'Cargar mi config',
  'Skills': 'Skills', 'Agents': 'Agentes', 'Commands': 'Comandos', 'Hook scripts': 'Scripts de hooks',
  'Scheduled tasks': 'Tareas programadas', 'Settings & instructions': 'Ajustes e instrucciones', 'Hooks': 'Hooks',
  'Every place': 'Todos los ámbitos', 'Place': 'Ámbito', 'Filter by name or description': 'Filtrar por nombre o descripción',
  'Everything Claude can load, by type, grouped by the place it comes from. A skill fires only from its description, so the description is shown first.':
    'Todo lo que Claude puede cargar, por tipo y agrupado por el ámbito de donde viene. Una skill solo se activa por su descripción, así que se muestra primero.',
  'Nothing of this kind.': 'Nada de este tipo.',
  'Hooks declared in settings': 'Hooks declarados en los ajustes', 'Hook and helper scripts': 'Scripts de hooks y auxiliares',
  'Status line': 'Línea de estado', 'None.': 'Ninguno.', 'When': 'Cuándo', 'Matcher': 'Filtro', 'Runs': 'Ejecuta', 'Timeout': 'Tiempo límite', 'Where': 'Dónde',
  'Hooks and scheduled tasks act while you are not looking. This is the part of a configuration that deserves the most attention and usually gets the least.':
    'Los hooks y las tareas programadas actúan sin que mires. Es la parte de una configuración que merece más atención y suele recibir menos.',
  'Changes Claude Code makes to its own interface and behaviour: panels, bands, status line, toasts, commands and hooks on tool calls. They live in ~/.claude/mods/ and run as you, so what each one registers is worth a read. This lists them; it does not edit them.':
    'Cambios que Claude Code hace sobre su propia interfaz y comportamiento: paneles, bandas, línea de estado, avisos, comandos y hooks sobre llamadas a herramientas. Viven en ~/.claude/mods/ y se ejecutan como tú, así que conviene leer qué registra cada uno. Aquí se listan; no se editan.',
  'active': 'activo', 'not loaded': 'sin cargar', 'Commands ': 'Comandos ', 'Tools': 'Herramientas', 'Draws': 'Dibuja', 'Reaches': 'Alcance',
  'No mods found.': 'No se han encontrado mods.',
  'Where MCP servers are declared, grouped by place. Values of env variables and headers are never read into this page, only their names.':
    'Dónde se declaran los servidores MCP, agrupados por ámbito. Los valores de variables de entorno y cabeceras nunca llegan a esta página, solo sus nombres.',
  'Server': 'Servidor', 'Secrets it needs': 'Secretos que necesita', 'none': 'ninguno',
  'No MCP servers in the files you loaded. Add ~/.claude.json on the Load page to include the ones Claude Code keeps there.':
    'No hay servidores MCP en los ficheros cargados. Añade ~/.claude.json en la página de carga para incluir los que Claude Code guarda ahí.',
  'Everything that fires on a schedule: the local ones are files in ~/.claude/scheduled-tasks, the cloud ones live in your claude.ai account. Each shows its definition.':
    'Todo lo que se dispara por horario: las locales son ficheros de ~/.claude/scheduled-tasks y las de la nube viven en tu cuenta de claude.ai. Cada una muestra su definición.',
  'Local routines': 'Rutinas locales', 'Cloud routines': 'Rutinas en la nube', 'Session loops': 'Loops de sesión',
  'Schedule': 'Horario', 'Next run': 'Próxima ejecución', 'Last run': 'Última ejecución', 'Definition': 'Definición', 'enabled': 'activa', 'paused': 'pausada',
  'No cloud routines in this snapshot. They are read from your claude.ai account when the config is generated with Claude Code.':
    'No hay rutinas en la nube en esta captura. Se leen de tu cuenta de claude.ai cuando la config se genera con Claude Code.',
  '/loop and session cron jobs live in the memory of a running session, not in a file, so there is nothing to scan; this lists the ones that were active when the config was generated.':
    'Los /loop y los cron de sesión viven en la memoria de una sesión en marcha, no en un fichero, así que no hay nada que escanear; aquí salen los que estaban activos al generar la config.',
  'None active then.': 'Ninguno activo entonces.',
  'Language': 'Idioma',
  'Your Claude Code setup, read in your browser.': 'Tu configuración de Claude Code, leída en tu navegador.',
  'files': 'ficheros', 'lines of hooks': 'líneas de hooks',
};

const CA = {
  'Overview': 'Resum', 'Pieces': 'Peces', 'Permissions': 'Permisos', 'Runs on its own': 'S\'executa sol',
  'Mods': 'Mods', 'MCP servers': 'Servidors MCP', 'Routines': 'Rutines', 'Usage': 'Ús', 'Skill evals': 'Evals de skills',
  'Audit': 'Auditoria', 'Load my config': 'Carregar la meva config',
  'Skills': 'Skills', 'Agents': 'Agents', 'Commands': 'Comandes', 'Hook scripts': 'Scripts de hooks',
  'Scheduled tasks': 'Tasques programades', 'Settings & instructions': 'Ajustos i instruccions', 'Hooks': 'Hooks',
  'Every place': 'Tots els àmbits', 'Place': 'Àmbit', 'Filter by name or description': 'Filtra per nom o descripció',
  'Everything Claude can load, by type, grouped by the place it comes from. A skill fires only from its description, so the description is shown first.':
    'Tot el que Claude pot carregar, per tipus i agrupat per l\'àmbit d\'on ve. Una skill només s\'activa per la seva descripció, així que es mostra primer.',
  'Nothing of this kind.': 'Res d\'aquest tipus.',
  'Hooks declared in settings': 'Hooks declarats als ajustos', 'Hook and helper scripts': 'Scripts de hooks i auxiliars',
  'Status line': 'Línia d\'estat', 'None.': 'Cap.', 'When': 'Quan', 'Matcher': 'Filtre', 'Runs': 'Executa', 'Timeout': 'Temps límit', 'Where': 'On',
  'Hooks and scheduled tasks act while you are not looking. This is the part of a configuration that deserves the most attention and usually gets the least.':
    'Els hooks i les tasques programades actuen sense que miris. És la part d\'una configuració que mereix més atenció i sol rebre\'n menys.',
  'Changes Claude Code makes to its own interface and behaviour: panels, bands, status line, toasts, commands and hooks on tool calls. They live in ~/.claude/mods/ and run as you, so what each one registers is worth a read. This lists them; it does not edit them.':
    'Canvis que Claude Code fa sobre la seva pròpia interfície i comportament: panells, bandes, línia d\'estat, avisos, comandes i hooks sobre crides a eines. Viuen a ~/.claude/mods/ i s\'executen com tu, així que convé llegir què registra cadascun. Aquí es llisten; no s\'editen.',
  'active': 'actiu', 'not loaded': 'sense carregar', 'Commands ': 'Comandes ', 'Tools': 'Eines', 'Draws': 'Dibuixa', 'Reaches': 'Abast',
  'No mods found.': 'No s\'ha trobat cap mod.',
  'Where MCP servers are declared, grouped by place. Values of env variables and headers are never read into this page, only their names.':
    'On es declaren els servidors MCP, agrupats per àmbit. Els valors de variables d\'entorn i capçaleres mai arriben a aquesta pàgina, només els noms.',
  'Server': 'Servidor', 'Secrets it needs': 'Secrets que necessita', 'none': 'cap',
  'No MCP servers in the files you loaded. Add ~/.claude.json on the Load page to include the ones Claude Code keeps there.':
    'No hi ha servidors MCP als fitxers carregats. Afegeix ~/.claude.json a la pàgina de càrrega per incloure els que Claude Code guarda allà.',
  'Everything that fires on a schedule: the local ones are files in ~/.claude/scheduled-tasks, the cloud ones live in your claude.ai account. Each shows its definition.':
    'Tot el que es dispara per horari: les locals són fitxers de ~/.claude/scheduled-tasks i les del núvol viuen al teu compte de claude.ai. Cadascuna mostra la seva definició.',
  'Local routines': 'Rutines locals', 'Cloud routines': 'Rutines al núvol', 'Session loops': 'Loops de sessió',
  'Schedule': 'Horari', 'Next run': 'Propera execució', 'Last run': 'Última execució', 'Definition': 'Definició', 'enabled': 'activa', 'paused': 'en pausa',
  'No cloud routines in this snapshot. They are read from your claude.ai account when the config is generated with Claude Code.':
    'No hi ha rutines al núvol en aquesta captura. Es llegeixen del teu compte de claude.ai quan la config es genera amb Claude Code.',
  '/loop and session cron jobs live in the memory of a running session, not in a file, so there is nothing to scan; this lists the ones that were active when the config was generated.':
    'Els /loop i els cron de sessió viuen a la memòria d\'una sessió en marxa, no en un fitxer, així que no hi ha res a escanejar; aquí surten els que estaven actius en generar la config.',
  'None active then.': 'Cap actiu llavors.',
  'Language': 'Idioma',
  'Your Claude Code setup, read in your browser.': 'La teva configuració de Claude Code, llegida al navegador.',
  'files': 'fitxers', 'lines of hooks': 'línies de hooks',
};

const DICT = { es: ES, ca: CA };
export const t = (s) => (lang !== 'en' && DICT[lang] && DICT[lang][s]) || s;
