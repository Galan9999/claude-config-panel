# Panel de Claude

Un panel local para ver y entender toda la configuración de Claude Code: ajustes,
skills, agentes, comandos, hooks y tareas programadas, de la config global y de
cada repo, en la misma pantalla.

No existe ninguna interfaz que te enseñe todo esto a la vez. `/config` y
`/permissions` cubren un subconjunto y sólo en la terminal; el resto es abrir
ficheros JSON a mano. Esto lo junta.

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

## Cómo se usa

Necesita Node 18 o superior. No instala nada.

```bash
node config-dashboard.mjs
```

Y abres <http://127.0.0.1:7337>.

Sin argumentos busca proyectos con carpeta `.claude/` en las carpetas habituales
(`~/code`, `~/dev`, `~/projects`, `~/Desktop`, `~/Documents`...). Si no encuentra
los tuyos, pásale la ruta:

```bash
node config-dashboard.mjs ~/mis-repos
```

Opciones:

| Opción | Qué hace |
|---|---|
| `--port 8080` | Cambia el puerto (por defecto 7337) |
| `--worktrees` | Incluye los worktrees enlazados, que por defecto se omiten porque duplican la config de su repo |
| `CLAUDE_CFG_ROOTS=/a:/b` | Carpetas donde buscar, por variable de entorno |

Para pararlo, Ctrl+C.

## Seguridad

- Escucha **sólo en 127.0.0.1**. No se expone a la red.
- Sólo puede escribir en los ficheros de configuración que ha descubierto al
  arrancar. Cualquier otra ruta se rechaza.
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
