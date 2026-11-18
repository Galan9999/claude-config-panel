// What a mod registers, read from its source. Pure: no DOM, no Node, no fs.
//
// Shared by the local app (src/discover.mjs) and the artifact scanner
// (artifact/core.js), so both describe a mod the same way. The caller reads the
// files and decides what counts as "active"; this only parses text.
//
// A mod is a folder in ~/.claude/mods/<name>/ with .claude-plugin/plugin.json,
// hooks/hooks.json ({ modules: [...] }) and the hooks module itself
// (hooks/register.tsx). Everything it does is declared by calls on `on(...)`
// and `$.…`, so a few patterns over the source are enough. It is a reading of
// the text, not an execution: a name built at run time will not show up.

const uniq = (a) => [...new Set(a)];

/** Events the module hooks, with how many hooks each. */
function hookEvents(src) {
  const m = new Map();
  for (const x of src.matchAll(/\bon\(\s*['"`]([a-z]+(?:\.[a-z]+)*)['"`]/g)) m.set(x[1], (m.get(x[1]) || 0) + 1);
  return [...m].map(([event, count]) => ({ event, count }));
}

/** Slash commands registered with $.command.register({ name }). */
function commandsOf(src) {
  return uniq([...src.matchAll(/command\.register\(\s*\{\s*name:\s*['"`]([^'"`]+)['"`]/g)].map((x) => '/' + x[1]));
}

/**
 * Tools the model can call. A mod usually keeps them in a table and registers
 * them in a loop, so a literal `$.tool.register({ name })` is rarely there:
 * when the module registers tools at all, the entries are the `name: '…'`
 * followed by a `description:` that are not commands.
 */
function toolsOf(src, mod) {
  if (!/\btool\.register\(/.test(src)) return [];
  const cmds = new Set(commandsOf(src).map((c) => c.slice(1)));
  const out = [];
  for (const x of src.matchAll(/\bname:\s*['"`]([\w-]+)['"`],\s*\n\s*description:/g)) if (!cmds.has(x[1])) out.push(x[1]);
  return uniq(out).map((n) => 'mcp__' + mod + '__' + n);
}

/** The text of the string literals in a chunk of source, joined: `'a ' +\n 'b'` → `a b`. */
function literalText(chunk) {
  const parts = [];
  for (const x of chunk.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`]*)`/g)) parts.push(x[1] ?? x[2] ?? x[3] ?? '');
  return parts.join('').replace(/\\(['"`\\])/g, '$1').replace(/\s+/g, ' ').trim();
}

/** Each tool with the description the model reads, taken from the `description:` that follows its name. */
function toolDetailsOf(src, mod) {
  const names = new Set(toolsOf(src, mod).map((t) => t.replace(/^mcp__.+?__/, '')));
  const out = [];
  for (const x of src.matchAll(/\bname:\s*['"`]([\w-]+)['"`],\s*\n\s*description:([\s\S]*?)(?:,\s*\n\s*(?:inputSchema|input_schema|parameters)\b|\n\s*\},?\s*\n)/g)) {
    if (!names.has(x[1]) || out.some((o) => o.name === x[1])) continue;
    out.push({ name: x[1], full: 'mcp__' + mod + '__' + x[1], description: literalText(x[2]) });
  }
  for (const n of names) if (!out.some((o) => o.name === n)) out.push({ name: n, full: 'mcp__' + mod + '__' + n, description: '' });
  return out;
}

/** Slash commands with their description, from $.command.register({ name, description }). */
function commandDetailsOf(src) {
  const out = [];
  for (const x of src.matchAll(/command\.register\(\s*\{\s*name:\s*['"`]([^'"`]+)['"`]\s*,\s*description:([\s\S]*?)(?:,\s*[A-Za-z]+\s*:|\}\s*\))/g)) {
    out.push({ name: '/' + x[1], description: literalText(x[2]) });
  }
  return out;
}

/** Surfaces it draws on: panes, a band above the prompt, rows under a tool call, status line, toasts. */
function surfacesOf(src) {
  const s = [];
  if (/component:\s*['"`]Pane['"`]/.test(src) || /\$\.ui\.open\(/.test(src)) s.push('panel');
  if (/component:\s*['"`]AbovePrompt['"`]/.test(src)) s.push('band above the prompt');
  if (/component:\s*['"`]ToolUse['"`]/.test(src)) s.push('row under tool calls');
  if (/\$\.ui\.status\(/.test(src)) s.push('status line');
  if (/\$\.ui\.toast\(/.test(src)) s.push('toasts');
  if (/\$\.audio\.play\(/.test(src)) s.push('sound');
  return s;
}

/** Other capabilities worth knowing about before turning a mod on. */
function reachOf(src) {
  const r = [];
  if (/\$\.process\./.test(src)) r.push('runs processes');
  if (/\$\.fs\./.test(src)) r.push('reads or writes files');
  if (/\$\.model\./.test(src)) r.push('calls a model');
  if (/\$\.clock\./.test(src)) r.push('runs on a timer');
  if (/\$\.agent\./.test(src)) r.push('registers a subagent');
  return r;
}

/**
 * @param {object} i
 * @param {string} i.dir           folder name (what the mod is called on disk)
 * @param {object|null} i.manifest parsed .claude-plugin/plugin.json
 * @param {string[]} i.sources     text of each hooks module
 * @param {string[]} i.commandFiles markdown commands the mod ships (commands/*.md names)
 * @param {string[]} i.files       every file path inside the mod, relative, junk excluded
 * @param {boolean} i.active       is the mod loaded by the user's settings
 * @param {string|null} i.activeVia how (so the page can say it)
 */
export function describeMod({ dir, manifest, sources, commandFiles = [], files = [], active, activeVia = null }) {
  const name = (manifest && manifest.name) || dir;
  const src = sources.join('\n');
  const events = hookEvents(src);
  const slash = uniq([...commandsOf(src), ...commandFiles.map((c) => '/' + c)]);
  return {
    name, dir,
    version: (manifest && manifest.version) || null,
    description: (manifest && manifest.description) || '',
    hasManifest: !!manifest,
    active: !!active, activeVia,
    hooks: events, hookCount: events.reduce((a, e) => a + e.count, 0),
    commands: slash,
    tools: toolsOf(src, name),
    toolDetails: toolDetailsOf(src, name),
    commandDetails: commandDetailsOf(src),
    surfaces: surfacesOf(src),
    reach: reachOf(src),
    files, fileCount: files.length,
    sourceLines: src ? src.split('\n').length : 0,
  };
}

/**
 * Is the folder loaded? Claude Code takes extra plugin folders from the
 * CLAUDE_CODE_PLUGIN_DIRS variable (the one in settings.json's `env` counts)
 * and from the plugins listed in `enabledPlugins`.
 * @param {string} dir mod folder name
 * @param {string[]} pluginDirs entries of CLAUDE_CODE_PLUGIN_DIRS, split on : and ,
 * @param {Record<string, boolean>} enabled settings.json enabledPlugins
 */
export function modActive(dir, name, pluginDirs, enabled) {
  const hit = pluginDirs.find((p) => p.replace(/\/+$/, '').split('/').pop() === dir);
  if (hit) return { active: true, via: 'CLAUDE_CODE_PLUGIN_DIRS' };
  const key = Object.keys(enabled || {}).find((k) => k.split('@')[0] === name && enabled[k] === true);
  if (key) return { active: true, via: 'enabledPlugins' };
  return { active: false, via: null };
}

export const splitPluginDirs = (v) => String(v || '').split(/[:,]/).map((s) => s.trim()).filter(Boolean);
