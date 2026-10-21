// Translates a Claude Code permission rule into a plain-language sentence, and
// flags it when it is broader than it looks or acts outside the machine.
const TOOLS = {
  Bash: 'run commands in the terminal',
  Read: 'read files',
  Write: 'create or overwrite files',
  Edit: 'modify files',
  MultiEdit: 'modify several parts of a file',
  NotebookEdit: 'modify Jupyter notebooks',
  Glob: 'find files by name',
  Grep: 'search text inside files',
  WebFetch: 'download the contents of a web page',
  WebSearch: 'search the internet',
  Task: 'spawn subagents',
  TodoWrite: 'manage its task list',
};
const CMD_HINT = {
  git: 'git', npm: 'npm', pnpm: 'pnpm', yarn: 'yarn', node: 'Node', python3: 'Python', bash: 'bash',
  grep: 'grep', cat: 'cat', ls: 'ls', find: 'find', echo: 'echo', pwd: 'pwd', which: 'which',
  rm: 'rm', chmod: 'chmod', jq: 'jq', docker: 'Docker', gh: 'the GitHub CLI', nx: 'Nx',
};
const BROAD = new Set(['bash', 'sh', 'zsh', 'node', 'python3', 'python', 'eval', 'npx', 'pnpm dlx']);

export function explain(rule) {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(rule);
  if (mcp) {
    const out = /send|post|create|delete|trash|update|write|reply|forward|schedule/i.test(mcp[2]);
    return { text: 'The ' + mcp[2] + ' tool from an external connector. ' +
      (out ? 'It acts outward: it can send or change something in that service.'
           : 'It only reads data from that service.'),
      level: out ? 'outbound' : 'normal' };
  }
  const m = /^([A-Za-z]+)(?:\((.*)\))?$/.exec(rule);
  if (!m) return { text: 'Rule not recognised.', level: 'normal' };
  const [, tool, arg] = m;
  const base = TOOLS[tool] || ('use the ' + tool + ' tool');
  if (!arg) return { text: 'Can ' + base + ' without asking.', level: 'normal' };
  if (tool !== 'Bash') {
    const where = arg === '**' ? 'anywhere' : 'in ' + arg;
    return { text: 'Can ' + base + ' ' + where + ' without asking.', level: arg === '**' ? 'broad' : 'normal' };
  }
  const prog = arg.trim().split(/\s+/)[0].replace(/[*:]/g, '');
  const name = CMD_HINT[prog] || prog;
  const open = /\*$/.test(arg.trim());
  let txt = 'Can run ' + name + (open ? ' with any argument' : ' exactly like this') + ', without asking.';
  let level = 'normal';
  if (BROAD.has(prog)) { level = 'broad'; txt += ' Careful: that allows running any script, so in practice it is a very broad grant.'; }
  if (/^rm\b/.test(arg)) { level = 'broad'; txt += ' It deletes files.'; }
  return { text: txt, level };
}
