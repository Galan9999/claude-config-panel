// What Claude can reach for: the tools Claude Code ships, the MCP servers and
// connectors that add more, the tools mods register, and the plugins that bring
// skills, agents, commands, hooks or servers of their own. For each built-in
// tool, what your settings say about it, rule by rule.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mcpServer } from '../artifact/core.js';
import { tilde } from './paths.mjs';

// [name, group, what it does, does it ask by default]
export const BUILTIN = [
  ['Bash', 'Run code', 'Runs a command in your shell: any program, script or pipeline. The tool every other language (Python, Node, AppleScript…) goes through.', true],
  ['Read', 'Files', 'Reads a file, image, PDF or notebook.', false],
  ['Write', 'Files', 'Creates a file or overwrites it whole.', true],
  ['Edit', 'Files', 'Replaces exact text inside a file.', true],
  ['NotebookEdit', 'Files', 'Changes a cell of a Jupyter notebook.', true],
  ['Glob', 'Files', 'Finds files by name pattern.', false],
  ['Grep', 'Files', 'Searches text inside files (ripgrep).', false],
  ['WebFetch', 'Web', 'Downloads a web page and reads it.', true],
  ['WebSearch', 'Web', 'Searches the internet.', true],
  ['Agent', 'Delegation', 'Starts a subagent with its own context (also written Task in older rules).', false],
  ['Skill', 'Delegation', 'Loads a skill\'s instructions into the conversation.', false],
  ['AskUserQuestion', 'Talking to you', 'Shows you a multiple-choice question.', false],
  ['TodoWrite', 'Talking to you', 'Keeps the visible task list of the session.', false],
  ['EnterPlanMode', 'Talking to you', 'Switches the session to plan mode (look, do not touch).', false],
  ['ExitPlanMode', 'Talking to you', 'Shows you the plan and asks to start.', false],
  ['CronCreate', 'Runs later', 'Schedules a prompt inside this session (/loop with an interval). Lost when the session closes.', false],
  ['ScheduleWakeup', 'Runs later', 'Self-paced /loop: the session wakes itself up after a delay.', false],
  ['Monitor', 'Runs later', 'Watches a command\'s output and wakes the session on a condition.', false],
  ['RemoteTrigger', 'Runs later', 'Creates or runs cloud routines on your claude.ai account.', true],
  ['SendMessage', 'Delegation', 'Messages another running agent or session.', false],
];

const RULE = /^([A-Za-z]+)(?:\(([\s\S]*)\))?$/;

/** Rules in each settings file that name this tool, by list. */
function rulesFor(tool, files) {
  const out = [];
  const alias = tool === 'Agent' ? ['Agent', 'Task'] : [tool];
  for (const f of files) for (const list of ['allow', 'ask', 'deny']) for (const r of f[list] || []) {
    const m = RULE.exec(r);
    if (m && alias.includes(m[1])) out.push({ rule: r, list, file: f.label, whole: !m[2] || ['*', '**', '/**', '//**'].includes(m[2]) });
  }
  return out;
}

/** The effective default for a built-in: deny beats ask beats allow, for whole-tool rules. */
function stateOf(asks, rules) {
  const whole = (l) => rules.some((r) => r.whole && r.list === l);
  if (whole('deny')) return 'forbidden';
  if (whole('ask')) return 'always asks';
  if (whole('allow')) return 'allowed';
  if (rules.length) return asks ? 'asks, except the allowed patterns' : 'free, with some rules';
  return asks ? 'asks you' : 'free (never asks)';
}

function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }

/** MCP servers declared on disk: ~/.claude.json (user and per-project) and each project's .mcp.json. */
export function mcpServers({ claudeJson = join(homedir(), '.claude.json'), projects = [] } = {}) {
  const out = [];
  const j = readJson(claudeJson) || {};
  for (const [name, def] of Object.entries(j.mcpServers || {})) out.push({ ...mcpServer(name, def, null), source: '~/.claude.json', scope: 'user: every project' });
  for (const [path, p] of Object.entries(j.projects || {})) {
    for (const [name, def] of Object.entries((p && p.mcpServers) || {})) out.push({ ...mcpServer(name, def, null), source: '~/.claude.json', scope: 'local: only in ' + tilde(path) });
  }
  for (const proj of projects) {
    const m = readJson(join(proj, '.mcp.json'));
    for (const [name, def] of Object.entries((m && m.mcpServers) || {})) out.push({ ...mcpServer(name, def, null), source: tilde(join(proj, '.mcp.json')), scope: 'project: shared through git' });
  }
  return out;
}

/** Connectors and servers your permission rules mention (claude.ai connectors are not on disk). */
export function connectorsInRules(files) {
  const map = new Map();
  for (const f of files) for (const list of ['allow', 'ask', 'deny']) for (const r of f[list] || []) {
    const m = /^mcp__(.+?)__(.+)$/.exec(r);
    if (!m) continue;
    const [, server, tool] = m;
    const cloud = /^claude_ai_(.+)$/.exec(server);
    const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(server);
    const key = server;
    if (!map.has(key)) map.set(key, { server, name: cloud ? cloud[1].replace(/_/g, ' ') : uuid ? 'claude.ai connector ' + server.slice(0, 8) + '…' : server,
      kind: cloud || uuid ? 'claude.ai connector' : 'MCP server', tools: [] });
    map.get(key).tools.push({ tool, list, file: f.label });
  }
  return [...map.values()];
}

/** Installed plugins, whether settings turn them on, and what each ships. */
export function plugins({ claudeDir = join(homedir(), '.claude'), enabled = {} } = {}) {
  const inst = readJson(join(claudeDir, 'plugins', 'installed_plugins.json'));
  const all = (inst && (inst.plugins || inst)) || {};
  const out = [];
  const keys = new Set([...Object.keys(all), ...Object.keys(enabled)]);
  for (const key of keys) {
    if (key === 'version') continue;
    const entries = Array.isArray(all[key]) ? all[key] : all[key] ? [all[key]] : [];
    const latest = entries.find((e) => e.scope === 'user') || entries[entries.length - 1] || null;
    const ships = [];
    if (latest && latest.installPath && existsSync(latest.installPath)) {
      for (const d of ['skills', 'agents', 'commands', 'hooks']) {
        const p = join(latest.installPath, d);
        if (existsSync(p)) { let n = 0; try { n = readdirSync(p).filter((x) => !x.startsWith('.')).length; } catch { /* unreadable */ } ships.push(n + ' ' + d); }
      }
      if (existsSync(join(latest.installPath, '.mcp.json'))) ships.push('MCP servers');
    }
    const [name, market] = key.split('@');
    out.push({ key, name, marketplace: market || '', enabled: enabled[key] === true, explicitlyOff: enabled[key] === false,
      installed: entries.length > 0, versions: entries.map((e) => (e.version || '?') + ' (' + (e.scope || '?') + (e.projectPath ? ': ' + tilde(e.projectPath) : '') + ')'),
      path: latest && latest.installPath ? tilde(latest.installPath) : null, ships });
  }
  return out.sort((a, b) => (b.enabled - a.enabled) || a.key.localeCompare(b.key));
}

export function readTools({ settingsFiles, projects, mods, claudeDir, claudeJson }) {
  const global = settingsFiles.find((f) => f.isGlobal && f.name === 'settings.json');
  let enabled = {};
  if (global) { const j = readJson(global.fullPath); enabled = (j && j.enabledPlugins) || {}; }
  return {
    builtin: BUILTIN.map(([name, group, what, asks]) => {
      const rules = rulesFor(name, settingsFiles);
      return { name, group, what, asksByDefault: asks, rules, state: stateOf(asks, rules) };
    }),
    mcp: mcpServers({ claudeJson, projects }),
    connectors: connectorsInRules(settingsFiles),
    modTools: (mods || []).filter((m) => m.tools && m.tools.length).map((m) => ({ mod: m.name, active: m.active, tools: m.toolDetails || m.tools.map((t) => ({ name: t })) })),
    plugins: plugins({ claudeDir, enabled }),
  };
}
