// The agent map, from invented fixtures: no real config is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildAgentMap, readLive, overlayLive, sddStatePath, EDGE_TYPES } from '../src/agentmap.mjs';

const A = '~/repo-a', B = '~/repo-b', G = 'Global';

const dir = mkdtempSync(join(tmpdir(), 'agentmap-'));
const file = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };

const items = [
  { kind: 'command', name: 'acme:3.dev', path: file('dev.md', 'Run the tests, then delegate:\nAgent with subagent_type: "acme-worker".\nWhen done, /acme:4.qa. Write the phase to .sdd/notes.md.'), description: 'Build it' },
  { kind: 'command', name: 'acme:4.qa', path: file('qa.md', 'Hand it to the code-reviewer agent for a second look, then /acme:5.sync.'), description: 'QA' },
  { kind: 'command', name: 'acme:5.sync', path: file('sync.md', 'Call mcp__claude_ai_Notion__notion-update-page and tell the team on Slack.'), description: 'Sync' },
  { kind: 'command', name: 'acme:_README', role: 'doc', path: file('readme.md', '/acme:3.dev'), description: '' },
  { kind: 'skill', name: 'conductor', path: file('conductor.md', 'Open one chat per ticket with mcp__chat-menu__open_group and keep state.json up to date. Every 5 minutes, /loop.'), description: 'Coordinates tickets' },
  { kind: 'skill', name: 'helper', path: file('helper.md', 'Nothing here.'), description: '' },
  { kind: 'agent', name: 'acme-worker', path: file('worker.md', 'Load `helper` first.'), description: 'Writes the code' },
  { kind: 'agent', name: 'code-reviewer', path: file('reviewer.md', 'Review.'), description: 'Reviews' },
  { kind: 'hook', name: 'hooks/run-tests.sh', path: join(dir, 'run-tests.sh'), description: 'Runs the tests after every edit.' },
  { kind: 'config', format: 'json', name: 'settings.json', displayPath: '~/x/settings.json', path: file('settings.json', JSON.stringify({ hooks: {
    PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: '~/x/hooks/run-tests.sh' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
    PreToolUse: [{ matcher: 'mcp__claude_ai_Slack__send', hooks: [{ type: 'command', command: 'guard.sh' }] }],
  } })) },
];
// Every piece gets a scope; the extra ones exist to trip each audit check.
const scopeOf = { 'acme:': A, conductor: G, helper: G, 'acme-worker': A, 'code-reviewer': A };
for (const it of items) it.scope = it.scope || Object.entries(scopeOf).find(([k]) => it.name.startsWith(k))?.[1] || G;
items.push(
  { kind: 'skill', name: 'helper', scope: A, path: file('helper-a.md', 'Repo copy.'), description: '' },
  { kind: 'command', name: 'beta:go', scope: B, path: file('beta.md', 'Then /acme:4.qa, and /acme:9.nope. Agent with subagent_type: "ghost-agent". Also subagent_type: "general-purpose".'), description: '' },
  { kind: 'skill', name: 'launcher', scope: G, path: file('launcher.md', 'Start with /acme:3.dev.'), description: '' },
  { kind: 'agent', name: 'lonely-agent', scope: G, path: file('lonely.md', 'Alone.'), description: '' },
  { kind: 'config', format: 'json', scope: A, name: 'settings.json', displayPath: '~/repo-a/.claude/settings.json',
    path: file('settings-a.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Edti', hooks: [{ type: 'command', command: 'x.sh' }] }] } })) },
);
const mods = [{ name: 'chat-menu', dir: 'chat-menu', active: true, description: 'Chats.', commands: ['/chat'],
  hooks: [{ event: 'session.start', count: 1 }], toolDetails: [{ name: 'open' }, { name: 'open_group' }, { name: 'sessions' }] }];
const routines = {
  desktop: [{ name: 'nightly', file: file('nightly.md', 'Run /acme:5.sync.'), enabled: true, schedule: { text: 'Every day at 08:00' } }],
  launchd: [{ name: 'com.x.digest', plist: '~/Library/LaunchAgents/x.plist', command: 'claude -p "/conductor"', enabled: true, schedule: { text: 'Weekdays' } }],
};
const mcp = [{ name: 'github', transport: 'stdio', scope: 'user', source: '~/.claude.json' }];
const connectors = [{ server: 'claude_ai_Notion', name: 'Notion', kind: 'claude.ai connector' }, { server: 'claude_ai_Slack', name: 'Slack', kind: 'claude.ai connector' }];
const sddState = { coordinator: { session_id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'conductor' }, reviewer: { session_id: '', name: '' },
  groups: { g1: { tickets: ['T-1'] } }, tickets: { 'T-1': { group: 'g1', phase: '3.dev', chats: { back: { session_id: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'back-1' } } } } };

const map = buildAgentMap({ items, mods, routines, mcp, connectors, sddState });
const has = (from, to, type) => map.edges.find((e) => e.from === from && e.to === to && e.type === type);

test('every node has a type, a name, an origin and a description field', () => {
  for (const n of map.nodes) {
    for (const k of ['id', 'type', 'name', 'origin', 'description']) assert.ok(k in n, n.id + ' lacks ' + k);
  }
  for (const e of map.edges) assert.ok(EDGE_TYPES[e.type], 'unknown edge type ' + e.type);
});

test('a folder _README is not a node', () => {
  assert.ok(!map.nodes.some((n) => n.name === 'acme:_README'));
});

test('subagent_type is a measured delegation, a bare name an assumed one', () => {
  const sure = has('command:acme:3.dev', 'agent:acme-worker', 'delegate');
  assert.ok(sure && !sure.assumed);
  const guess = has('command:acme:4.qa', 'agent:code-reviewer', 'delegate');
  assert.ok(guess && guess.assumed);
});

test('/ns:cmd chains the phases', () => {
  assert.ok(has('command:acme:3.dev', 'command:acme:4.qa', 'invoke'));
  assert.ok(has('command:acme:4.qa', 'command:acme:5.sync', 'invoke'));
});

test('a backticked skill name is an assumed invocation', () => {
  const e = has('agent:acme-worker', 'skill:helper', 'invoke');
  assert.ok(e && e.assumed);
});

test('mcp__ calls reach the connector; a bare mention is assumed', () => {
  const notion = has('command:acme:5.sync', 'mcp:Notion', 'mcp');
  assert.ok(notion && !notion.assumed);
  assert.deepEqual(notion.labels, ['notion-update-page']);
  const slack = has('command:acme:5.sync', 'mcp:Slack', 'mcp');
  assert.ok(slack && slack.assumed);
});

test('a mod open tool is an "opens a chat" edge, and the mod ships its commands', () => {
  assert.ok(has('skill:conductor', 'mod:chat-menu', 'open'));
  assert.ok(has('mod:chat-menu', 'chat:A new chat', 'open'));
  assert.ok(has('mod:chat-menu', 'command:chat', 'provides'));
  assert.ok(has('mod:chat-menu', 'event:session.start', 'hook'));
});

test('shared state and /loop are detected', () => {
  assert.ok(has('skill:conductor', 'state:Coordinator state.json', 'state'));
  assert.ok(has('command:acme:3.dev', 'state:Living Context .sdd/', 'state'));
  assert.ok(has('skill:conductor', 'launcher:/loop in a session', 'schedule'));
});

test('hook matchers point at the tools and the event, with the script documented', () => {
  const hook = map.nodes.find((n) => n.type === 'hook' && n.name.startsWith('PostToolUse'));
  assert.ok(hook.name.includes('run-tests.sh'));
  assert.match(hook.description, /Runs the tests/);
  assert.ok(has(hook.id, 'tool:Edit', 'hook'));
  assert.ok(has(hook.id, 'tool:Write', 'hook'));
  assert.ok(has(hook.id, 'event:PostToolUse', 'hook'));
  const stop = map.nodes.find((n) => n.type === 'hook' && n.name.startsWith('Stop'));
  assert.ok(has(stop.id, 'event:Stop', 'hook'));
  const guard = map.nodes.find((n) => n.type === 'hook' && n.name.startsWith('PreToolUse'));
  assert.ok(has(guard.id, 'mcp:Slack', 'hook'));
});

test('routines hang from their launcher and reach what their prompt runs', () => {
  assert.ok(has('launcher:Desktop app scheduler', 'routine:nightly', 'schedule'));
  assert.ok(has('routine:nightly', 'command:acme:5.sync', 'invoke'));
  assert.ok(has('launcher:launchd', 'routine:com.x.digest', 'schedule'));
  assert.ok(has('routine:com.x.digest', 'skill:conductor', 'invoke'));
});

test('roles come from state.json keys with a session_id', () => {
  assert.ok(map.nodes.some((n) => n.id === 'role:coordinator'));
  assert.ok(map.nodes.some((n) => n.id === 'role:reviewer'));
  assert.ok(!map.nodes.some((n) => n.id === 'role:groups'));
});

test('flow columns go launcher → command → agent → mcp', () => {
  const col = (id) => map.nodes.find((n) => n.id === id).col;
  assert.ok(col('launcher:launchd') < col('command:acme:3.dev'));
  assert.ok(col('command:acme:3.dev') < col('agent:acme-worker'));
  assert.ok(col('agent:acme-worker') < col('mcp:Notion'));
});

test('a missing or empty input builds an empty map, not an error', () => {
  const empty = buildAgentMap({});
  assert.deepEqual(empty, { nodes: [], edges: [] });
});

test('the state path is configurable, else found in a scanned project, never hard-coded', () => {
  assert.equal(sddStatePath('/a/state.json', {}), '/a/state.json');
  assert.equal(sddStatePath(undefined, { CCP_SDD_STATE: '/b' }), '/b');
  assert.equal(sddStatePath(undefined, {}, ['/p1', '/p2'], (f) => f === '/p2/.sdd/_conductor/state.json'), '/p2/.sdd/_conductor/state.json');
  assert.equal(sddStatePath(undefined, {}, ['/p1'], () => false), null);
});

// --- live
const liveDir = mkdtempSync(join(tmpdir(), 'agentmap-live-'));
const sessions = join(liveDir, 'sessions'), titles = join(liveDir, 'titles');
mkdirSync(sessions); mkdirSync(titles);
const statePath = join(liveDir, 'state.json');
writeFileSync(statePath, JSON.stringify(sddState));
writeFileSync(join(sessions, '101.json'), JSON.stringify({ pid: 101, sessionId: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'conductor', cwd: '/x' }));
writeFileSync(join(sessions, '102.json'), JSON.stringify({ pid: 102, sessionId: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'back-1', cwd: '/x' }));
writeFileSync(join(sessions, '103.json'), JSON.stringify({ pid: 103, sessionId: 'cccccccc-0000-0000-0000-000000000003', name: 'other', cwd: '/y' }));
writeFileSync(join(sessions, '104.json'), JSON.stringify({ pid: 104, sessionId: 'dead', name: 'gone' }));
writeFileSync(join(sessions, 'junk.json'), '{');
writeFileSync(join(titles, 'bbbbbbbb-0000-0000-0000-000000000002'), 'Back: T-1 build it\n');
const isAlive = (pid) => pid !== 104;

test('readLive joins running sessions with roles, tickets, phases and titles', () => {
  const live = readLive({ statePath, sessionsDir: sessions, titlesDir: titles, isAlive });
  assert.equal(live.stateFound, true);
  const by = Object.fromEntries(live.sessions.map((s) => [s.sid, s]));
  assert.equal(by['aaaaaaaa-0000-0000-0000-000000000001'].role, 'coordinator');
  const back = by['bbbbbbbb-0000-0000-0000-000000000002'];
  assert.deepEqual([back.ticket, back.side, back.phase, back.title, back.alive], ['T-1', 'back', '3.dev', 'Back: T-1 build it', true]);
  assert.equal(by['cccccccc-0000-0000-0000-000000000003'].alive, true);
  assert.ok(!by.dead, 'a dead pid is not live');
});

test('readLive without a state.json still lists the running chats', () => {
  const live = readLive({ statePath: join(liveDir, 'nope.json'), sessionsDir: sessions, titlesDir: titles, isAlive });
  assert.equal(live.stateFound, false);
  assert.equal(live.sessions.length, 3);
});

test('overlayLive marks the role live and wires the ticket chat to its phase', () => {
  const m = overlayLive(buildAgentMap({ items, mods, routines, mcp, connectors, sddState }),
    readLive({ statePath, sessionsDir: sessions, titlesDir: titles, isAlive }));
  assert.equal(m.nodes.find((n) => n.id === 'role:coordinator').live, true);
  const chat = m.nodes.find((n) => n.id === 'live:bbbbbbbb-0000-0000-0000-000000000002');
  assert.equal(chat.name, 'Back: T-1 build it');
  assert.ok(m.edges.find((e) => e.from === 'role:coordinator' && e.to === chat.id && e.type === 'open'));
  const phase = m.edges.find((e) => e.from === chat.id && e.to === 'command:acme:3.dev');
  assert.ok(phase && phase.assumed);
  assert.equal(m.live.running, 3);
});

// --- scopes and audit
const finding = (kind, pred = () => true) => map.findings.find((f) => f.kind === kind && pred(f));

test('every piece carries the scopes it lives in, Global first in the list', () => {
  assert.deepEqual(map.nodes.find((n) => n.id === 'skill:helper').scopes.sort(), [A, G].sort());
  assert.deepEqual(map.nodes.find((n) => n.id === 'command:acme:3.dev').scopes, [A]);
  assert.equal(map.scopes[0], G);
  assert.ok(map.scopes.includes(A) && map.scopes.includes(B));
});

test('audit: a /ns:cmd that does not exist is a high finding', () => {
  const f = finding('broken-ref');
  assert.equal(f.severity, 'high');
  assert.match(f.title, /acme:9\.nope/);
  assert.deepEqual(f.scopes, [B]);
});

test('audit: subagent_type naming no agent is high; a built-in one is not flagged', () => {
  assert.ok(finding('missing-agent', (f) => /ghost-agent/.test(f.title)));
  assert.ok(!finding('missing-agent', (f) => /general-purpose/.test(f.title)));
});

test('audit: a call into another repo is high, from Global it is low', () => {
  const cross = finding('scope-mismatch', (f) => f.nodes[0] === 'command:beta:go');
  assert.equal(cross.severity, 'high');
  const fromGlobal = finding('scope-mismatch', (f) => f.nodes[0] === 'skill:launcher');
  assert.equal(fromGlobal.severity, 'low');
});

test('audit: same name globally and in a repo is flagged as shadowed', () => {
  assert.ok(finding('shadowed', (f) => f.nodes[0] === 'skill:helper'));
});

test('audit: unused and assumed-only subagents', () => {
  assert.ok(finding('unused-agent', (f) => f.nodes[0] === 'agent:lonely-agent'));
  assert.ok(finding('assumed-only', (f) => f.nodes[0] === 'agent:code-reviewer'));
  assert.ok(!map.findings.some((f) => f.nodes[0] === 'agent:acme-worker' && /unused|assumed/.test(f.kind)));
});

test('audit: a hook matcher naming no known tool is flagged', () => {
  assert.ok(finding('unknown-matcher', (f) => /Edti/.test(f.title)));
  assert.ok(!finding('unknown-matcher', (f) => /«Edit»/.test(f.title)));
});

test('audit: findings come sorted high → low', () => {
  const order = map.findings.map((f) => ['high', 'medium', 'low'].indexOf(f.severity));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});
