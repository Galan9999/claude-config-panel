// The agent map: every piece of the Claude Code setup that can start, call or
// watch another one, and the edges between them. Built from the real config on
// each request, so it cannot drift from what is on disk.
//
// An edge is "measured" when the text says it in a form Claude Code acts on —
// `/x`, `Skill(x)`, `subagent_type: x`, `mcp__server__tool`, a hook matcher, a
// routine's prompt. It is `assumed` when it rests on a bare mention (an agent's
// name in prose, "Notion" without a tool call, a phase name that matches a
// command): likely, but nobody guarantees Claude reads it that way.
//
// Read-only: nothing here writes, and the live overlay only reads state.json,
// ~/.claude/sessions and ~/.claude/hooks/titles.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename } from 'node:path';
import { HOME, CLAUDE, tilde } from './paths.mjs';
import { read } from './fsutil.mjs';
import { findCommandRefs, brokenRefs } from './flows.mjs';
import { BUILTIN } from './tools.mjs';

/** The seven ways pieces interact, plus the structural "provides". Also the legend. */
export const EDGE_TYPES = {
  open: { label: 'opens a chat', how: 'The chat-menu mod, with open or open_group: one terminal window per chat, each with its own context.' },
  invoke: { label: 'invokes a skill or command', how: 'Skill or /x: the instructions load into the same conversation and the same context.' },
  delegate: { label: 'delegates to a subagent', how: 'Agent: the subagent works in an isolated context and only a summary comes back.' },
  hook: { label: 'fires a hook', how: 'PreToolUse, Stop, SessionStart…: runs on its own when the event happens; it can block the action or inject context.' },
  schedule: { label: 'schedules', how: 'A desktop app routine, launchd, /loop or /schedule: it starts without you.' },
  mcp: { label: 'calls an MCP', how: 'A tool from an MCP server or a claude.ai connector: Notion, Slack, GitHub…' },
  state: { label: 'reads or writes shared state', how: 'The coordinator\'s state.json, the .sdd/ Living Context: what chats leave for one another.' },
  provides: { label: 'provides', how: 'Structure, not interaction: a mod ships a command, a launcher holds a routine.' },
};

/** Node types, in left-to-right flow order. */
export const NODE_TYPES = {
  launcher: { label: 'Launchers', col: 0 },
  routine: { label: 'Routines', col: 1 },
  role: { label: 'Chats with a role', col: 2 },
  mod: { label: 'Mods', col: 2 },
  chat: { label: 'Chats', col: 3 },
  command: { label: 'Commands', col: 4 },
  skill: { label: 'Skills', col: 5 },
  agent: { label: 'Subagents', col: 6 },
  event: { label: 'Events', col: 7 },
  tool: { label: 'Tools', col: 7 },
  hook: { label: 'Hooks', col: 8 },
  mcp: { label: 'MCP servers', col: 9 },
  state: { label: 'Shared state', col: 9 },
};

/** Where the SDD coordinator keeps its state, relative to the project that runs it. */
export const SDD_STATE_REL = join('.sdd', '_conductor', 'state.json');
/**
 * Where the coordinator's state lives: the option, then the environment, then
 * the first scanned project that has one. Nothing is hard-coded, so the panel
 * finds it wherever the coordinator runs.
 * @returns {string|null}
 */
export function sddStatePath(opt, env = process.env, projects = [], exists = existsSync) {
  if (opt || env.CCP_SDD_STATE || env.CHAT_MENU_SDD_STATE) return opt || env.CCP_SDD_STATE || env.CHAT_MENU_SDD_STATE;
  for (const p of projects) { const f = join(p, SDD_STATE_REL); if (exists(f)) return f; }
  return null;
}

const untilde = (p) => (p && p.startsWith('~/') ? join(HOME, p.slice(2)) : p);
const norm = (s) => String(s).toLowerCase().replace(/^claude_ai_/, '').replace(/[_\s]+/g, '-');

const LAUNCHERS = {
  desktop: ['Desktop app scheduler', 'Claude desktop app: starts a session in the task\'s folder at the scheduled time, only while the app is open.'],
  launchd: ['launchd', 'macOS launch agents: run a command (usually claude -p) at fixed times, with no app open.'],
  loop: ['/loop in a session', '/loop, CronCreate or ScheduleWakeup: repeats inside one open session and dies with it.'],
  cloud: ['/schedule (cloud)', 'Cloud routines on claude.ai: run on Anthropic\'s servers, with your connectors and a fresh checkout.'],
};
const STATES = {
  conductor: ['Coordinator state.json', 'The SDD coordinator\'s state: groups, tickets, phases, and the session_id of every chat with a role.'],
  sdd: ['Living Context .sdd/', 'The repo\'s .sdd/ folder: specs, decisions and notes the phases leave for the next one.'],
};

/**
 * @param {object} i
 * @param {object[]} i.items     discover() items (skills, agents, commands, hook scripts, configs)
 * @param {object[]} [i.mods]    discoverMods() records
 * @param {{desktop: object[], launchd: object[]}} [i.routines] readRoutines()
 * @param {object[]} [i.mcp]     mcpServers()
 * @param {object[]} [i.connectors] connectorsInRules()
 * @param {object} [i.sddState]  parsed state.json, for the role nodes
 * @param {(p: string) => string} [i.readText]
 * @returns {{nodes: object[], edges: object[]}}
 */
export function buildAgentMap({ items = [], mods = [], routines = {}, mcp = [], connectors = [], sddState = null, readText = read } = {}) {
  const nodes = new Map();
  const edges = new Map();
  const node = (type, name, extra = {}) => {
    const id = type + ':' + name;
    const cur = nodes.get(id);
    const { scope, ...ex } = extra;
    extra = ex;
    if (cur) {
      if (scope && !cur.scopes.includes(scope)) cur.scopes.push(scope);
      if (extra.origin && !cur.origins.includes(extra.origin)) cur.origins.push(extra.origin);
      if (!cur.description && extra.description) cur.description = extra.description;
      return id;
    }
    const { origin, ...rest } = extra;
    nodes.set(id, { id, type, name, description: '', ...rest, origin: origin || '', origins: origin ? [origin] : [], scopes: scope ? [scope] : [] });
    return id;
  };
  const edge = (from, to, type, { assumed = false, label = '', evidence = '' } = {}) => {
    if (!from || !to || from === to) return;
    const key = from + '|' + to + '|' + type;
    const cur = edges.get(key);
    if (cur) {
      if (cur.assumed && !assumed) Object.assign(cur, { assumed, evidence: evidence || cur.evidence });
      if (label && !cur.labels.includes(label)) cur.labels.push(label);
      return;
    }
    edges.set(key, { from, to, type, assumed, labels: label ? [label] : [], evidence });
  };

  // --- pieces from the scan
  const pieces = items.filter((i) => ['command', 'skill', 'agent'].includes(i.kind) && i.role !== 'doc');
  for (const it of pieces) {
    node(it.kind, it.name, { description: it.description || '', origin: it.displayPath || tilde(it.path || ''), path: it.displayPath, scope: it.scope });
  }
  // What the scan finds wrong while it reads: refs to pieces that do not exist.
  const problems = [];
  const commands = new Set(pieces.filter((i) => i.kind === 'command').map((i) => i.name));
  const skills = new Set(pieces.filter((i) => i.kind === 'skill').map((i) => i.name));
  const agents = new Set(pieces.filter((i) => i.kind === 'agent').map((i) => i.name));

  // --- MCP servers and connectors, keyed by a normalised name so mcp__claude_ai_Notion__x finds "Notion".
  const mcpByKey = new Map();
  const addMcp = (name, description, origin, scope) => {
    const id = node('mcp', name, { description, origin, scope });
    mcpByKey.set(norm(name), id);
    return id;
  };
  for (const s of mcp) addMcp(s.name, [s.transport || s.type, s.scope].filter(Boolean).join(' · '), s.source || '', mcpScope(s));
  for (const c of connectors) mcpByKey.set(norm(c.server), addMcp(c.name, c.kind, 'permission rules', 'Global'));

  // --- mods: their slash commands and their registered tools
  const modByServer = new Map();
  for (const m of mods) {
    const tools = (m.toolDetails && m.toolDetails.length ? m.toolDetails.map((t) => t.name) : (m.tools || []).map((t) => t.split('__').pop()));
    const id = node('mod', m.name, { description: (m.description || '') + (tools.length ? (m.description ? ' ' : '') + 'Tools: ' + tools.join(', ') + '.' : ''),
      origin: '~/.claude/mods/' + (m.dir || m.name), active: m.active !== false, tools, scope: 'Global' });
    modByServer.set(norm(m.name), id);
    for (const c of m.commands || []) {
      const name = c.replace(/^\//, '');
      edge(id, node('command', name, { origin: 'mod ' + m.name, scope: 'Global' }), 'provides', { label: 'ships /' + name });
      commands.add(name);
    }
    for (const h of m.hooks || []) edge(id, node('event', h.event, { description: 'An engine event a mod listens to.' }), 'hook', { label: 'on ' + h.event, evidence: 'mod hooks module' });
    if (tools.some((t) => t === 'open' || t === 'open_group')) {
      edge(id, node('chat', 'A new chat', { description: 'A Claude Code session in its own terminal window, with its own context.' }), 'open',
        { label: tools.filter((t) => t === 'open' || t === 'open_group').join(', '), evidence: 'tools the mod registers' });
    }
  }

  // --- role chats declared in the coordinator's state
  for (const [key, v] of Object.entries(sddState && typeof sddState === 'object' ? sddState : {})) {
    if (!v || typeof v !== 'object' || Array.isArray(v) || !('session_id' in v)) continue;
    const id = node('role', key, { description: 'A chat the SDD coordinator keeps with the role «' + key + '».', origin: 'state.json' });
    edge(id, node('state', STATES.conductor[0], { description: STATES.conductor[1], origin: 'state.json' }), 'state', { label: 'declared in', evidence: 'state.json key ' + key });
  }

  // --- text scanning: what each piece names
  const scan = (from, text) => {
    if (!text) return;
    const t = String(text);
    for (const r of brokenRefs([...new Set(findCommandRefs(t).map((x) => x.replace(/[.,:;]+$/, '')))], commands)) problems.push({ kind: 'broken-ref', from, what: '/' + r });
    // /x and /ns:x, only when it is a known command or skill
    for (const m of t.matchAll(/(^|[\s`"'(>*])\/([a-z0-9][\w.-]*(?::[\w.-]+)?)/gim)) {
      const n = m[2].replace(/[.,:;]+$/, '');
      if (commands.has(n)) edge(from, 'command:' + n, 'invoke', { label: '/' + n, evidence: '/' + n });
      else if (skills.has(n)) edge(from, 'skill:' + n, 'invoke', { label: '/' + n, evidence: '/' + n });
      else if (n === 'loop') edge(from, node('launcher', LAUNCHERS.loop[0], { description: LAUNCHERS.loop[1] }), 'schedule', { label: '/loop', evidence: '/loop' });
      else if (n === 'schedule') edge(from, node('launcher', LAUNCHERS.cloud[0], { description: LAUNCHERS.cloud[1] }), 'schedule', { label: '/schedule', evidence: '/schedule' });
    }
    // Skill(x) / skill: "x"
    for (const m of t.matchAll(/\bSkill\s*\(\s*["'`]?([\w:.-]+)|\bskill["']?\s*[:=]\s*["'`]([\w:.-]+)/g)) {
      const n = m[1] || m[2];
      if (skills.has(n)) edge(from, 'skill:' + n, 'invoke', { label: 'Skill', evidence: m[0] });
      else if (commands.has(n)) edge(from, 'command:' + n, 'invoke', { label: 'Skill', evidence: m[0] });
    }
    // subagent_type: x / Agent(x)
    const explicit = new Set();
    for (const m of t.matchAll(/subagent_type["']?\s*[:=]\s*["'`]?([\w:.-]+)|\b(?:Agent|Task)\s*\(\s*["'`]?([\w:.-]+)/g)) {
      const raw = m[1] || m[2];
      const n = agents.has(raw) ? raw : raw.includes(':') && agents.has(raw.split(':').pop()) ? raw.split(':').pop() : null;
      if (n) { explicit.add(n); edge(from, 'agent:' + n, 'delegate', { label: 'Agent', evidence: m[0] }); }
      else if (!raw.includes(':') && !BUILTIN_AGENTS.has(raw) && /^[a-z][\w-]+$/i.test(raw) && /subagent_type/.test(m[0])) problems.push({ kind: 'missing-agent', from, what: raw });
    }
    // bare mention of an agent name: assumed. Only names distinctive enough (with a dash).
    for (const n of agents) {
      if (explicit.has(n) || !n.includes('-') || ('agent:' + n) === from) continue;
      if (new RegExp('(^|[^\\w-])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])').test(t)) {
        edge(from, 'agent:' + n, 'delegate', { assumed: true, label: 'named', evidence: 'mentions ' + n });
      }
    }
    // backticked skill name without a slash: assumed
    for (const m of t.matchAll(/`([a-z0-9][\w:.-]+)`/gi)) {
      if (skills.has(m[1]) && ('skill:' + m[1]) !== from) edge(from, 'skill:' + m[1], 'invoke', { assumed: true, label: 'named', evidence: '`' + m[1] + '`' });
    }
    // mcp__server__tool
    const servers = new Set();
    for (const m of t.matchAll(/mcp__([\w.-]+?)__([\w-]+)/g)) {
      const [, server, tool] = m;
      servers.add(norm(server));
      const mod = modByServer.get(norm(server));
      if (mod) {
        edge(from, mod, tool === 'open' || tool === 'open_group' ? 'open' : 'mcp', { label: tool, evidence: m[0] });
        continue;
      }
      const id = mcpByKey.get(norm(server)) || addMcp(server.replace(/^claude_ai_/, '').replace(/_/g, ' '), 'Seen in a tool call; not declared on disk.', 'tool references');
      mcpByKey.set(norm(server), id);
      edge(from, id, 'mcp', { label: tool, evidence: m[0] });
    }
    // a known MCP named in prose, with no tool call: assumed
    for (const [key, id] of mcpByKey) {
      if (servers.has(key) || key.length < 4) continue;
      const name = nodes.get(id).name;
      if (new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(t)) edge(from, id, 'mcp', { assumed: true, label: 'named', evidence: 'mentions ' + name });
    }
    // scheduling tools
    if (/\b(CronCreate|ScheduleWakeup)\b/.test(t)) edge(from, node('launcher', LAUNCHERS.loop[0], { description: LAUNCHERS.loop[1] }), 'schedule', { label: 'CronCreate', evidence: 'CronCreate / ScheduleWakeup' });
    if (/\bRemoteTrigger\b/.test(t)) edge(from, node('launcher', LAUNCHERS.cloud[0], { description: LAUNCHERS.cloud[1] }), 'schedule', { label: 'RemoteTrigger', evidence: 'RemoteTrigger' });
    // shared state
    if (/_conductor|\bstate\.json\b/.test(t)) edge(from, node('state', STATES.conductor[0], { description: STATES.conductor[1] }), 'state', { evidence: 'state.json' });
    if (/(^|[\s`"'(/])\.sdd\//m.test(t)) edge(from, node('state', STATES.sdd[0], { description: STATES.sdd[1] }), 'state', { evidence: '.sdd/' });
  };
  for (const it of pieces) scan(it.kind + ':' + it.name, readText(it.path));

  // --- hooks declared in settings files
  const scripts = items.filter((i) => i.kind === 'hook');
  for (const cfg of items.filter((i) => i.kind === 'config' && i.format === 'json')) {
    let json; try { json = JSON.parse(readText(cfg.path) || '{}'); } catch { continue; }
    const where = (cfg.displayPath || tilde(cfg.path || ''));
    for (const [event, groups] of Object.entries((json && json.hooks) || {})) {
      for (const g of Array.isArray(groups) ? groups : []) {
        const matcher = (g && g.matcher) || '';
        const cmds = (g && Array.isArray(g.hooks) ? g.hooks : []).map((h) => String(h.command || h.prompt || '')).filter(Boolean);
        const script = scripts.find((s) => cmds.some((c) => c.includes(basename(s.path || ''))));
        const name = event + (matcher ? ' · ' + matcher : '') + (script ? ' · ' + basename(script.path) : cmds.length ? ' · ' + basename(cmds[0].split(/\s+/)[0]) : '');
        const id = node('hook', name, { scope: cfg.scope, origin: where, description: (script && script.description ? script.description + ' ' : '') + cmds.join(' ; ') });
        edge(id, node('event', event, { description: 'A Claude Code hook event.' }), 'hook', { label: 'on ' + event, evidence: where });
        for (const tok of matcher.split('|').map((s) => s.trim()).filter((s) => s && s !== '*' && s !== '.*')) {
          const mm = /^mcp__([\w.-]+?)__/.exec(tok);
          const target = mm ? (modByServer.get(norm(mm[1])) || mcpByKey.get(norm(mm[1])) || addMcp(mm[1], 'Seen in a hook matcher.', where))
            : node('tool', tok, { description: 'A tool the hook matcher watches.' });
          edge(id, target, 'hook', { label: 'watches ' + tok, evidence: 'matcher ' + matcher });
          if (!mm && /^[A-Za-z]+$/.test(tok) && !KNOWN_TOOLS.has(tok)) problems.push({ kind: 'unknown-matcher', from: id, what: tok });
        }
        for (const c of cmds) scan(id, c);
      }
    }
  }

  // --- routines: launcher → routine → what its prompt calls
  for (const t of routines.desktop || []) {
    const id = node('routine', t.name, { scope: 'Global', description: t.description || '', origin: t.file || '', enabled: !!t.enabled, schedule: t.schedule && t.schedule.text });
    if (!t.orphan) edge(node('launcher', LAUNCHERS.desktop[0], { description: LAUNCHERS.desktop[1] }), id, 'schedule', { label: t.schedule && t.schedule.text, evidence: t.config || '' });
    scan(id, readText(untilde(t.file)));
  }
  for (const t of routines.launchd || []) {
    const id = node('routine', t.name, { scope: 'Global', description: t.scriptDoc || t.command || '', origin: t.plist || '', enabled: !!t.enabled, schedule: t.schedule && t.schedule.text });
    edge(node('launcher', LAUNCHERS.launchd[0], { description: LAUNCHERS.launchd[1] }), id, 'schedule', { label: t.schedule && t.schedule.text, evidence: t.plist || '' });
    scan(id, (t.command || '') + '\n' + (t.script ? readText(untilde(t.script)) : ''));
  }

  const out = { nodes: [...nodes.values()], edges: [...edges.values()] };
  for (const n of out.nodes) n.col = (NODE_TYPES[n.type] || { col: 5 }).col;
  if (!out.nodes.length) return out;
  out.scopes = [...new Set(out.nodes.flatMap((n) => n.scopes))].sort((a, b) => (b === 'Global') - (a === 'Global') || a.localeCompare(b));
  out.findings = auditMap(out, problems, routines);
  return out;
}

/** Subagent types Claude Code ships: naming them is not a broken reference. */
const BUILTIN_AGENTS = new Set(['general-purpose', 'Explore', 'Plan', 'statusline-setup', 'claude-code-guide', 'claude', 'fork', 'output-style-setup']);
/** Tool names a hook matcher can name without being a typo. */
const KNOWN_TOOLS = new Set([...BUILTIN.map((b) => b[0]), 'Task', 'MultiEdit', 'LS', 'NotebookRead', 'TodoRead', 'BashOutput', 'KillShell', 'KillBash', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'ToolSearch', 'TaskStop', 'TaskOutput']);

/** The scope an MCP server belongs to, from where it is declared. */
function mcpScope(s) {
  const scope = String(s.scope || '');
  if (scope.startsWith('user')) return 'Global';
  const local = /^local: only in (.+)$/.exec(scope);
  if (local) return local[1];
  if (scope.startsWith('project') && s.source) return String(s.source).replace(/\/\.mcp\.json$/, '');
  return 'Global';
}

const SEV = ['high', 'medium', 'low'];

/**
 * What the graph itself says is wrong or fragile. Each finding names the
 * pieces it is about, so the map can point at them, and the scopes involved,
 * so the scope filter applies to findings too.
 * @returns {{severity: string, kind: string, title: string, detail: string, nodes: string[], scopes: string[]}[]}
 */
export function auditMap(map, problems = [], routines = {}) {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const name = (id) => (byId.get(id) || { name: id }).name;
  const scopesOf = (ids) => [...new Set(ids.flatMap((id) => (byId.get(id) || { scopes: [] }).scopes))];
  const out = [];
  const add = (severity, kind, title, detail, nodes) => out.push({ severity, kind, title, detail, nodes, scopes: scopesOf(nodes) });

  for (const p of problems) {
    if (p.kind === 'broken-ref') add('high', p.kind, name(p.from) + ' calls ' + p.what + ', which does not exist',
      'The command is not in any scanned folder: renamed, deleted or a typo. Claude will not find it when it gets there.', [p.from]);
    if (p.kind === 'missing-agent') add('high', p.kind, name(p.from) + ' delegates to «' + p.what + '», which does not exist',
      'subagent_type names an agent that is neither yours nor one Claude Code ships. The Agent call will fail.', [p.from]);
    if (p.kind === 'unknown-matcher') add('medium', p.kind, 'Hook ' + name(p.from) + ' watches «' + p.what + '», which is not a known tool',
      'A matcher that matches no tool never fires. Check the spelling (tool names are case-sensitive).', [p.from]);
  }

  // A piece that only works from one repo, called from somewhere it is not.
  for (const e of map.edges) {
    if (e.assumed || !['invoke', 'delegate'].includes(e.type)) continue;
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b || !a.scopes.length || !b.scopes.length || b.scopes.includes('Global')) continue;
    if (a.scopes.some((s) => b.scopes.includes(s))) continue;
    const global = a.scopes.includes('Global');
    add(global ? 'low' : 'high', 'scope-mismatch',
      a.name + ' (' + a.scopes.join(', ') + ') calls ' + b.name + ', which only exists in ' + b.scopes.join(', '),
      global ? 'It works only when the session is in that repo; from any other folder the call finds nothing. Fine if that is the only place it runs.'
        : 'The two pieces never load in the same session: from ' + a.scopes.join(', ') + ' the call finds nothing.', [e.from, e.to]);
  }

  // Same name in the global config and in a project.
  for (const n of map.nodes) {
    if (!['skill', 'agent', 'command'].includes(n.type) || n.scopes.length < 2 || !n.scopes.includes('Global')) continue;
    add('medium', 'shadowed', n.name + ' exists both globally and in ' + n.scopes.filter((s) => s !== 'Global').join(', '),
      'Inside that project Claude sees two pieces with the same name and only one wins. Check they still say the same thing, or rename one.', [n.id]);
  }

  // Subagents: nobody delegates to them, or only by a bare mention.
  for (const n of map.nodes.filter((x) => x.type === 'agent')) {
    const inc = map.edges.filter((e) => e.to === n.id && e.type === 'delegate');
    if (!inc.length) add('low', 'unused-agent', 'Nothing delegates to ' + n.name,
      'No command, skill or agent names it. Claude may still pick it from its description; if that never happens, it is dead weight.', [n.id]);
    else if (inc.every((e) => e.assumed)) add('medium', 'assumed-only', n.name + ' is only reached by a mention in prose',
      'The callers name it but never with subagent_type. Whether it really runs depends on Claude reading the prose that way; write the call explicitly if it matters.', [n.id, ...inc.map((e) => e.from)]);
  }

  // Routines that will not run.
  for (const t of routines.desktop || []) {
    const id = 'routine:' + t.name;
    if (t.orphan) add('low', 'routine-off', t.name + ' has a prompt but no schedule', 'The SKILL.md is on disk but the desktop app has no schedule for it: it never runs.', [id]);
    else if (!t.enabled) add('low', 'routine-off', t.name + ' is disabled', 'Scheduled in the desktop app but switched off.', [id]);
  }
  for (const t of routines.launchd || []) {
    if (!t.enabled || t.loaded === false) add('low', 'routine-off', t.name + (t.enabled ? ' is not loaded in launchd' : ' is disabled'),
      'The plist exists but launchd will not run it until it is loaded and enabled.', ['routine:' + t.name]);
  }

  // MCP servers called but not declared anywhere on disk.
  for (const n of map.nodes.filter((x) => x.type === 'mcp' && /not declared|hook matcher/.test(x.description))) {
    const callers = map.edges.filter((e) => e.to === n.id).map((e) => e.from);
    add('low', 'undeclared-mcp', n.name + ' is called but not declared on disk',
      'Probably a claude.ai connector with no permission rule, or a server from a plugin. If not, the calls fail.', [n.id, ...callers]);
  }

  return out.sort((a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity) || a.kind.localeCompare(b.kind));
}

/* ------------------------------------------------------------------ live */

function psClaudePids() {
  try {
    const out = execFileSync('/bin/ps', ['-axo', 'pid=,comm='], { encoding: 'utf8', timeout: 3000 });
    const set = new Set();
    for (const line of out.split('\n')) {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (m && /(^|\/)claude(-[\w.-]+)?$/.test(m[2].trim())) set.add(Number(m[1]));
    }
    return set;
  } catch { return null; }
}

/**
 * Which chats are running now, and what the coordinator says about them.
 * @param {object} o
 * @param {string} o.statePath
 * @param {string} [o.sessionsDir] ~/.claude/sessions
 * @param {string} [o.titlesDir]   ~/.claude/hooks/titles
 * @param {(pid: number) => boolean} [o.isAlive]
 */
export function readLive({ statePath, sessionsDir = join(CLAUDE, 'sessions'), titlesDir = join(CLAUDE, 'hooks', 'titles'), isAlive } = {}) {
  let state = null;
  try { const j = statePath ? JSON.parse(readFileSync(statePath, 'utf8')) : null; state = j && typeof j === 'object' && !Array.isArray(j) ? j : null; } catch { /* none or broken */ }
  if (!isAlive) { const pids = psClaudePids(); isAlive = (pid) => (pids ? pids.has(pid) : false); }
  const title = (sid) => { const t = read(join(titlesDir, sid)).split('\n')[0].trim(); return t || null; };

  const byId = new Map();
  let files = [];
  try { files = readdirSync(sessionsDir).filter((f) => f.endsWith('.json')); } catch { /* none */ }
  for (const f of files) {
    let d; try { d = JSON.parse(readFileSync(join(sessionsDir, f), 'utf8')); } catch { continue; }
    if (!d || !d.sessionId || !Number.isInteger(d.pid) || !isAlive(d.pid)) continue;
    byId.set(d.sessionId, { sid: d.sessionId, alive: true, name: d.name || '', status: d.status || '',
      cwd: d.cwd ? tilde(d.cwd) : null, title: title(d.sessionId) });
  }
  const ensure = (sid, name) => {
    if (!byId.has(sid)) byId.set(sid, { sid, alive: false, name: name || '', status: '', cwd: null, title: title(sid) });
    return byId.get(sid);
  };
  if (state) {
    for (const [key, v] of Object.entries(state)) {
      if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.session_id !== 'string' || !v.session_id) continue;
      ensure(v.session_id, v.name).role = key;
    }
    for (const [tep, t] of Object.entries(state.tickets && typeof state.tickets === 'object' ? state.tickets : {})) {
      if (!t || typeof t !== 'object') continue;
      for (const [side, c] of Object.entries(t.chats && typeof t.chats === 'object' ? t.chats : {})) {
        if (!c || typeof c.session_id !== 'string' || !c.session_id) continue;
        Object.assign(ensure(c.session_id, c.name), { ticket: tep, side, phase: t.phase || '', group: t.group || '' });
      }
    }
  }
  return { statePath: statePath ? tilde(statePath) : null, stateFound: !!state, sessions: [...byId.values()], readAt: new Date().toISOString() };
}

/** Puts the running chats on top of the static map. Mutates and returns it. */
export function overlayLive(map, live) {
  const ids = new Set(map.nodes.map((n) => n.id));
  const commands = map.nodes.filter((n) => n.type === 'command');
  const stateId = 'state:' + STATES.conductor[0];
  const add = (n) => { if (!ids.has(n.id)) { map.nodes.push(n); ids.add(n.id); } return n.id; };
  const addEdge = (e) => map.edges.push({ labels: [], evidence: 'live', ...e, live: true });
  for (const s of live.sessions) {
    const label = s.title || s.name || s.sid.slice(0, 8);
    if (s.role) {
      const id = add({ id: 'role:' + s.role, type: 'role', name: s.role, description: 'A chat the SDD coordinator keeps with this role.', origin: 'state.json', origins: ['state.json'], scopes: [], col: NODE_TYPES.role.col });
      const n = map.nodes.find((x) => x.id === id);
      Object.assign(n, { live: s.alive, session: s });
      continue;
    }
    const id = add({ id: 'live:' + s.sid, type: 'chat', name: label, description: [s.ticket && s.ticket + ' · ' + s.side, s.phase && 'phase ' + s.phase, s.cwd].filter(Boolean).join(' · '),
      origin: s.ticket ? 'state.json' : '~/.claude/sessions', origins: [], scopes: [], col: NODE_TYPES.chat.col, live: s.alive, session: s });
    if (!s.ticket) continue;
    if (ids.has('role:coordinator')) addEdge({ from: 'role:coordinator', to: id, type: 'open', assumed: false, labels: [s.ticket + ' ' + s.side] });
    if (ids.has(stateId)) addEdge({ from: id, to: stateId, type: 'state', assumed: false, labels: ['registered'] });
    if (s.phase) {
      const p = String(s.phase).replace(/^\//, '');
      for (const c of commands.filter((c) => c.name === p || c.name.endsWith(':' + p) || c.name.split(':').pop().replace(/^\d+\./, '') === p)) {
        addEdge({ from: id, to: c.id, type: 'invoke', assumed: true, labels: ['phase ' + s.phase], evidence: 'phase name matches the command' });
      }
    }
  }
  map.live = { statePath: live.statePath, stateFound: live.stateFound, readAt: live.readAt,
    running: live.sessions.filter((s) => s.alive).length };
  return map;
}
