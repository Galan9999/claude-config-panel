# Panel de Claude

Un panel local para ver y entender toda la configuración de Claude Code: ajustes,
skills, agentes, comandos, hooks y tareas programadas, de la config global y de
cada repo, en la misma pantalla.

No existe ninguna interfaz que te enseñe todo esto a la vez. `/config` y
`/permissions` cubren un subconjunto y sólo en la terminal; el resto es abrir
ficheros JSON a mano. Esto lo junta.

## Cómo se usa

Necesita Node 18 o superior.

```bash
npx claude-config-panel
```

Y abres <http://127.0.0.1:7337>. Para pararlo, Ctrl+C.

Sin argumentos busca proyectos con carpeta `.claude/` en las carpetas habituales
(`~/code`, `~/dev`, `~/projects`, `~/Desktop`, `~/Documents`...). Si no encuentra
los tuyos, pásale la ruta:

```bash
npx claude-config-panel ~/mis-repos
```

| Opción | Qué hace |
|---|---|
| `--port <n>` | Puerto donde escuchar (por defecto 7337) |
| `--worktrees` | Incluye los worktrees enlazados, que por defecto se omiten porque duplican la config de su repo |
| `--help` | Ayuda |
| `CLAUDE_CFG_ROOTS=/a:/b` | Carpetas donde buscar, por variable de entorno |

## Qué resuelve

- **Ves todo lo que hay.** Encuentra sola la config global y la de cada repo con
  carpeta `.claude/`, y las agrupa por tipo de pieza en vez de por fichero.
- **Te explica cada permiso en castellano.** `Bash(node *)` deja de ser una línea
  opaca y pasa a ser *"puede ejecutar Node con cualquier argumento; ojo, eso
  permite correr cualquier script"*, con etiqueta de **amplio**. Las herramientas
  que actúan hacia fuera (enviar, publicar, borrar) salen marcadas como
  **sale fuera**.
- **Destaca lo que se ejecuta solo.** Hooks y tareas programadas en una tabla:
  qué los dispara, qué ejecutan y con qué límite de tiempo. Es la parte de la
  configuración que actúa sin que tú estés delante, y la que menos se revisa.
- **Lee y edita las skills y los agentes.** Markdown renderizado, con pestaña de
  edición y copia de seguridad automática en cada guardado.
- **Abre tickets.** Desde cualquier pieza que viva en un repo de GitHub, un issue
  prellenado con la ruta del fichero.

## Seguridad

- Escucha **sólo en 127.0.0.1**. No se expone a la red.
- Sólo puede escribir en los ficheros de configuración que ha descubierto al
  arrancar. Cualquier otra ruta se rechaza.
- Los estáticos se sirven de `ui/` sin subcarpetas ni `..`, así que no hay
  travesía de rutas.
- Cada guardado deja copia previa en `~/.claude/backups/config-dashboard/`.
- Los JSON se validan antes de escribirse: un fichero mal formado nunca llega a
  disco.

No lo expongas fuera de tu máquina: lee tu configuración de Claude, que puede
contener rutas, tokens de conectores y el contenido de tus tareas programadas.

## Un panel no sustituye a una revisión

Esto te enseña qué hay; no te dice si está bien. Para eso va bien un agente
auditor que lea las piezas e informe — qué se solapa, qué nunca se dispara, qué
permiso es más amplio de lo necesario — sin tocar nada. El panel trae el prompt
preparado en cada pieza, en "Auditar con Claude".

### El formato de hallazgos

Para que esa auditoría sirva de algo más que de lectura, su salida tiene un
contrato: `.claude/audit/findings.json`, descrito en
[`schema/findings.schema.json`](schema/findings.schema.json) y validado por
[`src/findings.mjs`](src/findings.mjs).

```json
{
  "version": 1,
  "generatedAt": "2026-10-21T16:40:00.000Z",
  "tool": "auditor-config",
  "scope": { "path": "~/repos/backend", "kind": "repo" },
  "summary": "Quitar Bash(bash *) del allow.",
  "findings": [{
    "id": "permiso-bash-comodin",
    "severity": "alta",
    "category": "permiso-amplio",
    "title": "Bash(bash *) permite ejecutar cualquier script",
    "path": ".claude/settings.local.json",
    "line": 4,
    "what": "La regla deja correr cualquier fichero.",
    "proposal": "Sustituirla por las tres invocaciones concretas que se usan.",
    "autofix": { "kind": "quitar-permiso", "file": ".claude/settings.local.json", "rule": "Bash(bash *)" }
  }],
  "notChecked": []
}
```

La validación es estricta a propósito: quien produce esto es un modelo de
lenguaje o una herramienta de terceros. Los `id` tienen que ser estables entre
auditorías —de ahí sale si un hallazgo abre ticket nuevo o ya tiene uno—, y una
`proposal` que empiece por "revisar" se rechaza: tiene que decir qué hacer.

El formato no depende de este panel. Cualquier auditor puede emitirlo, y
`cc-audit --format json` es candidato a tener un adaptador.

## Desarrollo

Sin dependencias, ni de ejecución ni de desarrollo. Todo lo que usa viene con
Node: el servidor es `node:http` y las pruebas son `node:test`.

```bash
git clone https://github.com/Galan9999/claude-config-panel
cd claude-config-panel
npm start      # arranca el panel
npm test       # 44 pruebas
```

### Estructura

```
bin/claude-config-panel.mjs   Entrada de la CLI
src/
  cli.mjs        Argumentos, ayuda y mensaje de arranque
  paths.mjs      Rutas de ~/.claude
  fsutil.mjs     Lectura tolerante, frontmatter, doc de scripts
  git.mjs        Remoto de GitHub y detección de worktrees
  labels.mjs     Los nombres en castellano de cada pieza
  discover.mjs   Recorrido del disco y catálogo de piezas
  server.mjs     Rutas HTTP, guardado y copias de seguridad
ui/
  index.html     La página
  style.css      Paleta de Claude, con modo oscuro
  app.js         Navegación, listados, detalle y edición
  markdown.js    Renderizador de Markdown
  permissions.js Traduce una regla de permisos a una frase
  util.js        Escapado de HTML y ayudas
test/            Pruebas de las funciones puras
```

La interfaz vive en ficheros `.html`, `.css` y `.js` de verdad, servidos como
estáticos. `ui/markdown.js` y `ui/permissions.js` son módulos ES sin DOM, así que
las pruebas de Node importan exactamente el mismo código que corre el navegador.

## Licencia

MIT.
