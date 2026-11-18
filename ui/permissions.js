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

// ----- Auto mode -------------------------------------------------------------
// In auto mode nobody shows you the permission prompt: it goes to a classifier
// on Anthropic's servers, which approves the action, holds it for review or
// blocks it, from its own rules. That is a second decision-maker standing next
// to the lists above, so the panel has to say where each list stops being the
// last word.

/** The modes a session can start in, from the most held back to the least. */
export const MODES = [
  ['default', 'Manual — asks you before anything that is not already allowed'],
  ['plan', 'Plan — must show you the plan before touching anything'],
  ['acceptEdits', 'Auto-edit — accepts file changes without asking'],
  ['auto', 'Auto — a classifier on the server answers the prompts instead of you'],
  ['dontAsk', 'Never ask — denies whatever is not pre-approved, instead of asking'],
  ['bypassPermissions', 'No brakes — asks nothing (dangerous)'],
];

/**
 * Whether a `defaultMode: "auto"` written in this file actually grants auto
 * mode. Only that one value is restricted by where it is written: any repo you
 * clone could otherwise hand your session to a classifier the repo chose. Every
 * other mode is honoured from any scope, newest file winning.
 *
 * @returns {{granted: boolean, text: string}}
 */
export function autoModeGrant(fileName, isGlobal) {
  if (isGlobal && fileName === 'settings.json') {
    return { granted: true, text: 'This is the file auto mode is granted from. The same ' +
      '"auto" written in a project is ignored: only this file, a managed policy or starting ' +
      'with --permission-mode auto can turn it on.' };
  }
  if (isGlobal) {
    return { granted: false, text: 'Auto mode is granted from ~/.claude/settings.json, a ' +
      'managed policy or --permission-mode auto. Set "auto" there rather than here.' };
  }
  return { granted: false, text: '"defaultMode": "auto" here is ignored: the file travels with ' +
    'the repo, and only ~/.claude/settings.json, a managed policy or --permission-mode auto may ' +
    'grant auto mode. Any other mode set here does take effect, and overrides your global ' +
    'default while you work on this project.' };
}

/**
 * What an allow rule is still worth once auto mode is on. With
 * `autoMode.classifyAllShell` every Bash rule is suspended and the command goes
 * to the classifier regardless; without it the rule skips the prompt, but never
 * the classifier's own hard_deny list.
 *
 * @returns {{label: string, level: string, title: string}|null}
 */
export function classifierNote(rule, { classifyAllShell = false } = {}) {
  if (!classifyAllShell || !/^Bash\(/.test(rule)) return null;
  return { label: 'suspended in auto mode', level: 'warn',
    title: 'autoMode.classifyAllShell is on: while auto mode is active this rule grants ' +
      'nothing and the command is sent to the classifier like any other.' };
}

// ----- What a rule means, and in which language it runs ----------------------
// `explain` gives one sentence. The Permissions view needs more: which language
// the rule ends up executing (a Bash rule may really be Python or Node), what
// the program does, and whether the rule is one exact command line or a prefix
// that admits anything after it. Everything here is read from the rule text
// alone: the panel never runs or opens what a rule points at.

export const LANGS = {
  shell:       { label: 'Shell command', blurb: 'A command-line program, run through the Bash tool in your login shell (zsh).' },
  python:      { label: 'Python',      blurb: 'Python code: the interpreter runs whatever the script or -c says.' },
  node:        { label: 'JavaScript / Node', blurb: 'JavaScript or TypeScript run by Node, or a Node tool (npm, pnpm, npx, nx, vitest…).' },
  applescript: { label: 'AppleScript', blurb: 'macOS automation: can drive any app, type keys, read windows.' },
  ruby:        { label: 'Ruby',        blurb: 'Ruby code, or a Ruby tool.' },
  perl:        { label: 'Perl',        blurb: 'Perl code.' },
  php:         { label: 'PHP',         blurb: 'PHP code.' },
  go:          { label: 'Go',          blurb: 'The Go toolchain: builds and runs Go programs.' },
  rust:        { label: 'Rust',        blurb: 'The Rust toolchain: builds and runs Rust programs.' },
  java:        { label: 'Java / JVM',  blurb: 'Java or a JVM build tool.' },
  container:   { label: 'Containers',  blurb: 'Docker and friends: runs whole images, with whatever is inside.' },
  files:       { label: 'Files',       blurb: 'Claude Code\'s own file tools. No code runs: it reads, finds or changes files.' },
  web:         { label: 'Web',         blurb: 'Claude Code\'s own web tools: fetches pages or searches the internet.' },
  mcp:         { label: 'MCP connector', blurb: 'A tool from a connector (an MCP server): it calls an outside service or a local program.' },
  claude:      { label: 'Claude Code', blurb: 'A built-in Claude Code tool that is not about files or the web.' },
  unknown:     { label: 'Unknown',     blurb: 'The panel could not read this rule.' },
};

const INTERPRETERS = {
  python: 'python', python3: 'python', pip: 'python', pip3: 'python', uv: 'python', poetry: 'python', pytest: 'python',
  node: 'node', npx: 'node', npm: 'node', pnpm: 'node', yarn: 'node', tsx: 'node', 'ts-node': 'node', bun: 'node',
  deno: 'node', nx: 'node', vitest: 'node', jest: 'node', tsc: 'node', eslint: 'node', prettier: 'node',
  bash: 'shell', sh: 'shell', zsh: 'shell',
  osascript: 'applescript',
  ruby: 'ruby', gem: 'ruby', bundle: 'ruby', rake: 'ruby',
  perl: 'perl', php: 'php', composer: 'php',
  go: 'go', cargo: 'rust', rustc: 'rust',
  java: 'java', mvn: 'java', gradle: 'java',
  docker: 'container', podman: 'container', 'docker-compose': 'container',
};
// Programs that execute code handed to them, so `prog *` admits anything.
const RUNS_ANY = new Set(['python', 'python3', 'node', 'bash', 'sh', 'zsh', 'osascript', 'ruby', 'perl', 'php',
  'deno', 'bun', 'npx', 'tsx', 'ts-node', 'eval', 'exec', 'xargs', 'env', 'sudo', 'uv']);
const EXT_LANG = { py: 'python', js: 'node', mjs: 'node', cjs: 'node', ts: 'node', mts: 'node', sh: 'shell',
  zsh: 'shell', bash: 'shell', rb: 'ruby', pl: 'perl', php: 'php', scpt: 'applescript', applescript: 'applescript' };

const WHAT = {
  git: 'version control: status, diffs, commits, branches and pushes',
  gh: 'GitHub from the terminal: pull requests, issues, workflow runs and raw API calls',
  grep: 'search text inside files (read-only)', rg: 'search text inside files (read-only)',
  cat: 'print a file\'s contents (read-only)', head: 'print the start of a file (read-only)',
  tail: 'print the end of a file (read-only)', ls: 'list folders (read-only)', pwd: 'print the current folder (read-only)',
  echo: 'print text (harmless on its own, but it can write a file with >)', which: 'find where a program lives (read-only)',
  find: 'find files (and, with -exec or -delete, act on them)', wc: 'count lines (read-only)',
  sed: 'edit text in a stream, or in place with -i', awk: 'process text (a small language of its own)',
  jq: 'read and reshape JSON', chmod: 'change file permissions', chown: 'change file owners',
  rm: 'delete files', mv: 'move or rename files', cp: 'copy files', mkdir: 'create folders', touch: 'create empty files',
  curl: 'make HTTP requests to any address (can upload data)', wget: 'download from any address',
  heroku: 'the Heroku CLI: apps, config vars, logs, releases', brew: 'install software with Homebrew',
  npm: 'run npm: install packages and run package.json scripts', pnpm: 'run pnpm: install packages and run package.json scripts',
  yarn: 'run yarn: install packages and run package.json scripts', npx: 'download and run any npm package',
  nx: 'run tasks of the Nx monorepo (tests, builds…)', vitest: 'run tests', jest: 'run tests', tsc: 'type-check TypeScript',
  eslint: 'lint code', prettier: 'format code', make: 'run Makefile targets', open: 'open files, apps or URLs on the Mac',
  kill: 'stop processes', ps: 'list processes (read-only)', lsof: 'list open files and ports (read-only)',
  docker: 'run and manage containers', osascript: 'run AppleScript: drive apps, windows and keystrokes',
  sleep: 'wait', date: 'print the date (read-only)', env: 'run a program with a changed environment',
  sudo: 'run anything as administrator', ssh: 'log into another machine', scp: 'copy files to or from another machine',
  python: 'run Python code', python3: 'run Python code', node: 'run JavaScript', bash: 'run a shell script',
  sh: 'run a shell script', zsh: 'run a shell script',
};
const READ_ONLY = new Set(['grep', 'rg', 'cat', 'head', 'tail', 'ls', 'pwd', 'which', 'wc', 'ps', 'lsof', 'date']);

const TOOL_WHAT = {
  Read: ['files', 'read files'], Write: ['files', 'create or overwrite files'], Edit: ['files', 'modify files'],
  MultiEdit: ['files', 'modify several parts of a file'], NotebookEdit: ['files', 'modify Jupyter notebooks'],
  Glob: ['files', 'find files by name'], Grep: ['files', 'search text inside files'],
  WebFetch: ['web', 'download the contents of web pages'], WebSearch: ['web', 'search the internet'],
  Task: ['claude', 'spawn subagents'], Agent: ['claude', 'spawn subagents'], TodoWrite: ['claude', 'manage its task list'],
  Skill: ['claude', 'load skills'],
};

const base = (p) => p.replace(/^.*\//, '');

/** Splits a Bash rule's argument into the program that really runs and what follows. */
export function parseCommand(arg) {
  let s = arg.trim();
  let open = false;
  if (/:\*$/.test(s)) { s = s.slice(0, -2); open = true; }        // legacy `prefix:*`
  else if (/(^|\s)\*$/.test(s)) { s = s.replace(/\s*\*$/, ''); open = true; }
  else if (/\*/.test(s)) open = true;                              // a wildcard in the middle
  const toks = s.split(/\s+/).filter(Boolean);
  const wrappers = [];
  const vars = [];
  let i = 0;
  // `GH_TOKEN=*gh pr view`: the wildcard value swallows the space, so the program is glued to it.
  if (toks[0] && /^[A-Za-z_][A-Za-z0-9_]*=\*[A-Za-z./]/.test(toks[0])) {
    const [, name, prog] = /^([A-Za-z_][A-Za-z0-9_]*)=\*(.+)$/.exec(toks[0]);
    vars.push(name); toks[0] = prog;
  }
  // VAR=value prefixes, and env/sudo in front, are not the program: look past them.
  for (;;) {
    if (i < toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) { vars.push(toks[i].split('=')[0]); i++; continue; }
    if (i < toks.length && ['env', 'sudo', 'nohup', 'time', 'cross-env', 'dotenv'].includes(base(toks[i])) && i + 1 < toks.length) {
      wrappers.push(base(toks[i])); i++; continue;
    }
    break;
  }
  const progPath = toks[i] || '';
  const prog = base(progPath).replace(/\*/g, '');
  const rest = toks.slice(i + 1);
  return { prog, progPath, rest, open, wrappers, vars, exact: !open };
}

/**
 * Everything the Permissions view says about one rule.
 * @returns {{lang: string, langLabel: string, kind: string, action: string, scope: string,
 *   level: 'normal'|'broad'|'outbound', notes: string[], program?: string, script?: string, server?: string}}
 */
export function describe(rule) {
  const r = String(rule || '').trim();
  const mk = (o) => ({ notes: [], level: 'normal', scope: '', ...o, langLabel: LANGS[o.lang].label });

  const mcp = /^mcp__(.+?)__(.+)$/.exec(r);
  if (mcp) {
    const [, server, tool] = mcp;
    const out = /send|post|create|delete|trash|update|write|reply|forward|schedule|set|move|upload|publish|share|deploy|run|trigger|approve|cancel|label|modify/i.test(tool);
    const cloud = /^claude_ai_(.+)$/.exec(server);
    const plugin = /^plugin[_-](.+)$/.exec(server);
    const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(server);
    const who = cloud ? cloud[1].replace(/_/g, ' ') + ' (claude.ai connector)'
      : uuid ? 'a claude.ai connector (id ' + server.slice(0, 8) + '…)'
      : plugin ? plugin[1] + ' (from a plugin)' : server + ' (local MCP server)';
    const name = tool.replace(/[_-]+/g, ' ');
    return mk({ lang: 'mcp', kind: 'mcp', server: who, level: out ? 'outbound' : 'normal',
      action: 'use the "' + name + '" tool of ' + who,
      scope: 'This one tool only.',
      notes: [out ? 'It acts outward: it can send, create or change something in that service, in your name.'
        : 'By its name it only reads from that service.'] });
  }
  if (/^mcp__[^_]/.test(r) && !r.includes('__', 5)) {
    return mk({ lang: 'mcp', kind: 'mcp', server: r.slice(5), level: 'outbound',
      action: 'use every tool of the ' + r.slice(5) + ' MCP server', scope: 'All the server\'s tools, present and future.',
      notes: ['A whole server: includes any tool that sends or deletes.'] });
  }

  const m = /^([A-Za-z]+)(?:\(([\s\S]*)\))?$/.exec(r);
  if (!m) return mk({ lang: 'unknown', kind: 'unknown', action: 'do something the panel cannot read',
    notes: ['Check the spelling: a rule Claude Code cannot parse is ignored.'] });
  const [, tool, arg] = m;

  if (tool !== 'Bash') {
    const [lang, what] = TOOL_WHAT[tool] || ['claude', 'use the ' + tool + ' tool'];
    if (arg === undefined || arg === '' || arg === '*') {
      return mk({ lang, kind: 'tool', action: what, scope: 'Anywhere, with any input.',
        level: ['Write', 'Edit', 'MultiEdit', 'WebFetch'].includes(tool) ? 'broad' : 'normal' });
    }
    if (tool === 'Skill') return mk({ lang, kind: 'tool', action: 'load the skill ' + arg, scope: 'That skill only.' });
    const domain = /^domain:(.+)$/.exec(arg);
    if (domain) return mk({ lang, kind: 'tool', action: what + ' from ' + domain[1], scope: 'Only that domain.' });
    const anywhere = arg === '**' || arg === '/**' || arg === '~/**';
    return mk({ lang, kind: 'tool', action: what + (anywhere ? ' anywhere' : ' matching ' + arg),
      scope: anywhere ? 'Every path on the machine Claude can reach.' : 'Paths matching that pattern.',
      level: anywhere ? 'broad' : 'normal' });
  }

  if (arg === undefined || arg === '' || arg === '*') {
    return mk({ lang: 'shell', kind: 'bash', level: 'broad', action: 'run any terminal command at all',
      scope: 'Every command line.', notes: ['This is the widest rule there is.'] });
  }

  if (/;|&&|\|\||(^|[^|])\|([^|]|$)/.test(arg.replace(/'[^']*'|"[^"]*"/g, ''))) {
    const n = arg.replace(/'[^']*'|"[^"]*"/g, '').split(/;|&&|\|\||\|/).filter((x) => x.trim()).length;
    return mk({ lang: 'shell', kind: 'bash', action: 'run this one-off command line (' + n + ' commands chained)',
      scope: /\*/.test(arg) ? 'Command lines matching that text, wildcards included.' : 'Exactly this text. It almost certainly will never match again.',
      notes: ['A whole pipeline saved as a rule, most likely by answering "yes, don\'t ask again" once. It is clutter: safe to delete.'] });
  }
  const c = parseCommand(arg);
  const stem = arg.trim().replace(/\s*(:\*|\*)$/, '');
  const scope = c.exact ? 'Exactly this command line, nothing else.'
    : stem.includes('*') ? 'Any command line matching "' + arg.trim() + '": each * stands for any text, spaces included.'
    : 'Any command line that starts with "' + stem + '".';
  const notes = [];
  const wrap = c.wrappers.find((w) => w === 'env' || w === 'cross-env' || w === 'dotenv');
  if (wrap) notes.push(wrap + ' only sets up the environment: the program that runs is ' + c.prog + '.');
  if (c.vars.length) notes.push('With ' + c.vars.join(', ') + ' set in front' + (/=\*/.test(arg) ? ' (to any value)' : '') + '.');
  if (c.wrappers.includes('sudo')) notes.push('With sudo it runs as administrator.');

  // A script file named in the rule: its language is the file's, and what it does is what the file says today.
  const clean = (t) => t.replace(/\*+$/, '');
  const isScript = (t) => /\.[a-z]+$/i.test(clean(t)) && EXT_LANG[clean(t).split('.').pop().toLowerCase()];
  const firstArg = c.rest.find((t) => !t.startsWith('-'));
  const RUNNERS = ['python', 'python3', 'node', 'bash', 'sh', 'zsh', 'ruby', 'perl', 'php', 'tsx', 'ts-node', 'deno', 'bun', 'osascript'];
  const scriptRaw = isScript(c.progPath) ? c.progPath
    : RUNNERS.includes(c.prog) && firstArg && isScript(firstArg) && !c.rest.slice(0, c.rest.indexOf(firstArg)).some((t) => ['-m', '-c', '-e'].includes(t)) ? firstArg : null;
  const scriptTok = scriptRaw && clean(scriptRaw);
  const interp = INTERPRETERS[c.prog];
  let lang = interp || (/node_modules\//.test(c.progPath) ? 'node' : 'shell');
  if (scriptTok) lang = EXT_LANG[scriptTok.split('.').pop().toLowerCase()];
  if (scriptTok) {
    const fname = base(scriptTok);
    notes.unshift('What it does is whatever ' + fname + ' says today: the rule trusts the file, so whoever can edit that file decides what this permission means.');
    return mk({ lang, kind: 'bash', program: c.prog, script: scriptTok, scope,
      action: 'run the ' + LANGS[lang].label + ' script ' + fname + (c.open ? ' with any arguments' : ''),
      what: fname + ' is a ' + LANGS[lang].label + ' file at ' + scriptTok + '.',
      notes, level: c.wrappers.includes('sudo') ? 'broad' : 'normal' });
  }

  let level = 'normal';
  const what = WHAT[c.prog] ? c.prog + ': ' + WHAT[c.prog] + '.' : '';
  if (c.open && RUNS_ANY.has(c.prog)) {
    const first = c.rest[0] || '';
    if (!c.rest.length || ['-c', '-e', '--eval', '-'].includes(first)) {
      level = 'broad';
      notes.unshift(c.prog + ' runs code it is handed (a script, or -c / -e on the command line), so this admits any program at all.');
    } else if (/[/*]$/.test(first) || /\/$/.test(first.replace(/\*$/, ''))) {
      notes.unshift('Any script under ' + first.replace(/\*$/, '') + ': whatever is in that folder today, or is put there later.');
    }
  }
  if (c.prog === 'rm') { level = 'broad'; notes.push('It deletes files, and nothing goes to the Trash.'); }
  if (c.prog === 'find' && c.open) notes.push('find -exec can run any other command on what it finds.');
  const readsOnly = c.rest.some((t) => ['view', 'list', 'diff', 'checks', 'status', 'show', 'log', 'logs', 'info'].includes(t.replace(/[:*]+$/, '')))
    && !c.rest.some((t) => /^-X$|POST|PUT|PATCH|DELETE/.test(t));
  if (readsOnly && ['gh', 'heroku'].includes(c.prog)) notes.push('By its subcommand it only reads from ' + (c.prog === 'gh' ? 'GitHub' : 'Heroku') + '.');
  else if (['curl', 'wget', 'gh', 'heroku', 'ssh', 'scp'].includes(c.prog) && c.open && !/localhost|127\.0\.0\.1/.test(arg)) {
    level = level === 'broad' ? 'broad' : 'outbound';
    notes.push('It talks to outside services: it can send data or change things there.');
  }
  if (['npm', 'pnpm', 'yarn'].includes(c.prog) && c.open) notes.push('"run" executes whatever package.json defines today.');
  if (READ_ONLY.has(c.prog) && c.open) notes.push('Read-only by itself; Claude Code already runs most read-only commands without asking, so the rule may be redundant.');
  if (c.wrappers.includes('sudo')) level = 'broad';
  let shown = [c.prog, ...c.rest].join(' ').replace(/\*$/, '…');
  if (shown.length > 90) shown = shown.slice(0, 88) + '…';
  return mk({ lang, kind: 'bash', program: c.prog, scope, notes, level, what,
    action: c.rest.length ? 'run "' + shown + (c.open && !/…$/.test(shown) && !shown.includes('*') ? ' …' : '') + '"'
      : 'run ' + c.prog + (c.open ? ' with any arguments' : '') });
}

/** The sentence for a rule as it sits in a given list. */
export function sentence(rule, list) {
  const d = describe(rule);
  const a = d.action.charAt(0).toLowerCase() + d.action.slice(1);
  if (list === 'deny') return 'Never allowed to ' + a + '.';
  if (list === 'ask') return 'Always asks you before it can ' + a + '.';
  return 'Can ' + a + ' without asking you.';
}
