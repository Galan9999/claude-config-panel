// Where the configuration comes from: shared by the local app and the artifact
// edition, so both explain the two ways to load it the same way.
//  - Everything on this computer, then filter out what you do not want.
//  - Only the folders you choose.
// And a prompt to paste into Claude Code, which finds the folders for you.

/** What a scope holds, by kind, from items that carry `kind` and `name`. */
export function summarize(files) {
  const order = ['config', 'skill', 'agent', 'command', 'hook', 'task'];
  const by = new Map();
  for (const f of files || []) {
    const k = f.kind || 'other';
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(f.name || f.rel || '');
  }
  return [...by.entries()]
    .sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99))
    .map(([kind, names]) => ({ kind, count: names.length, names: [...new Set(names)].sort() }));
}

export const KIND_LABEL = { config: 'settings & instructions', skill: 'skills', agent: 'agents', command: 'commands', hook: 'hooks & scripts', task: 'scheduled tasks' };

/** One line: "3 skills · 2 agents · 4 commands". */
export function summaryLine(files) {
  const s = summarize(files);
  return s.length ? s.map((x) => x.count + ' ' + (KIND_LABEL[x.kind] || x.kind)).join(' · ') : 'nothing Claude reads';
}

/**
 * A prompt for Claude Code that lists the folders holding configuration, so
 * you know what to load. Read-only: it only lists.
 * @param {'everything'|'chosen'} mode
 * @param {string[]} [folders] for 'chosen': where to look
 */
export function findPrompt(mode = 'everything', folders = []) {
  const where = mode === 'chosen' && folders.length
    ? 'under these folders only: ' + folders.join(', ')
    : 'under my home folder (~), including ~/.claude itself';
  return [
    'Find every folder ' + where + ' that holds Claude Code configuration:',
    'a .claude/ folder, a CLAUDE.md, or a .mcp.json. Skip node_modules, .git, build output,',
    'Library, caches and git worktrees (a .git file, not a folder).',
    '',
    'Only read and list: do not open file contents, do not change anything.',
    '',
    'Answer with:',
    '1. One absolute path per line, ready to paste, ~/.claude first.',
    '2. Under each, one short line: how many skills, agents, commands, hooks and settings files it has.',
    '3. At the end, any folder that looks personal or sensitive, so I can leave it out.',
  ].join('\n');
}
