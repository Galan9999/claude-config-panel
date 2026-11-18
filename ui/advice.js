// Why a rule is written the way it is, and what a narrower version of it would
// look like. `permissions.js` says what a rule grants; this says whether you
// want to grant it, and names the rule that does the same job with less room.
//
// None of this is taste. A Bash pattern is a prefix string match with no
// flag-level analysis: the rule is as wide as the widest command line its
// prefix admits, and the families below are the cases where that gap is big
// enough to change what the rule means. Everything else gets the generic
// reading rather than an invented warning.

/** Tools whose argument is a path pattern, not a command. */
const PATH_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * Command families, in the order they are tried. `progs` are matched against
 * the first word of the pattern; `subs`, when present, against the second.
 *
 * verdict: keep | narrow | drop | avoid
 */
export const FAMILIES = [
  {
    id: 'interpreter',
    label: 'Interpreters, shells and package runners',
    progs: ['bash', 'sh', 'zsh', 'fish', 'node', 'deno', 'bun', 'python', 'python3', 'py',
      'ruby', 'perl', 'php', 'osascript', 'npx', 'bunx', 'uvx', 'eval', 'source', 'exec'],
    verdict: 'avoid',
    why: 'The rule names the interpreter, but what runs is the file handed to it — including a ' +
      'file written one second earlier. This is not "can run Node", it is "can run any code on ' +
      'this machine", and every other rule in the list stops meaning anything next to it.',
    better: (prog) => [
      { rule: 'Bash(' + prog + ' scripts/the-one-you-run.mjs)',
        note: 'Name the script. If there are three of them, write three rules: they cost nothing.' },
    ],
  },
  {
    id: 'runner',
    label: 'Task runners',
    progs: ['npm', 'pnpm', 'yarn', 'make', 'just', 'task', 'rake', 'gradle', 'mvn', 'nx', 'turbo', 'bundle'],
    verdict: 'narrow',
    why: 'A rule like "npm run *" does not grant npm. It grants whatever the repo says those ' +
      'scripts mean today, and the repo can change them — a dependency bump or a merge is ' +
      'enough. The permission stays the same while what it permits moves.',
    better: (prog) => [
      { rule: 'Bash(' + prog + ' test)', note: 'One rule per script you actually run, spelled out.' },
      { rule: 'Bash(' + prog + ' run build)', note: 'Exact, so a renamed script asks again instead of running.' },
    ],
  },
  {
    id: 'network',
    label: 'Anything that talks to the network',
    progs: ['curl', 'wget', 'nc', 'ncat', 'ssh', 'scp', 'sftp', 'rsync', 'ftp', 'telnet', 'http', 'httpie'],
    verdict: 'avoid',
    why: 'These send as readily as they fetch: curl with -d posts whatever it is given wherever ' +
      'it is pointed. An allow rule here is a standing export channel for everything readable on ' +
      'the machine, and it reads as innocent in a diff.',
    better: () => [
      { rule: 'WebFetch', note: 'Reads a page and cannot post. If the job is fetching, this is the tool.' },
    ],
  },
  {
    id: 'destructive',
    label: 'Irreversible local commands',
    progs: ['rm', 'rmdir', 'shred', 'dd', 'mkfs', 'chown', 'chmod', 'sudo', 'doas', 'kill', 'pkill', 'killall'],
    verdict: 'avoid',
    why: 'There is no undo, and a prefix match cannot tell a build folder from a home directory: ' +
      'it sees "rm -rf " or "chmod -R 777 " and stops reading. What comes after is settled when ' +
      'the command runs, which is already past the only moment you could have objected.',
    better: () => [
      { rule: 'Bash(rm -rf /)', note: 'As a deny rule, not an allow one. Deny beats allow, in every mode.' },
    ],
  },
  {
    id: 'find',
    label: 'find and xargs',
    progs: ['find', 'xargs'],
    verdict: 'avoid',
    why: 'find is not a read-only command. "find . -exec <anything> {} \\;" runs that anything ' +
      'once per match, and -delete removes. A find rule is an interpreter rule wearing a ' +
      'different name, which is why it so often survives a review that would have caught bash.',
    better: () => [
      { rule: 'Glob(**)', note: 'The Glob tool finds files by name and cannot execute anything.' },
    ],
  },
  {
    id: 'infra',
    label: 'Cloud and container CLIs',
    progs: ['docker', 'kubectl', 'helm', 'terraform', 'pulumi', 'aws', 'gcloud', 'az', 'heroku',
      'fly', 'vercel', 'railway', 'supabase'],
    verdict: 'avoid',
    why: 'These act on something other people share, and the effect does not stop at your ' +
      'machine. The destructive verbs sit one word away from the harmless ones: kubectl get and ' +
      'kubectl delete match the same prefix.',
    better: (prog) => [
      { rule: 'Bash(' + prog + ' get *)', note: 'Pin the verb, not the binary, and only the reading ones.' },
    ],
  },
  {
    id: 'git',
    label: 'git',
    progs: ['git'],
    verdict: 'narrow',
    why: 'A git wildcard admits flag forms that the checks behind a plain "git status" reject. ' +
      '"git log --output=f" and "git diff --output=f" write files anywhere, "git branch -D" ' +
      'deletes, "git push --force" rewrites what the rest of the team has. The subcommand being ' +
      'read-only says nothing: the flags decide.',
    better: () => [
      { rule: 'Bash(git status)', note: 'Exact rules for the ones you run constantly.' },
      { rule: 'Bash(git log --oneline -20)', note: 'The invocation you actually use, flags included.' },
      { rule: 'Bash(git push --force*)', note: 'In deny, so no later allow rule can bring it back.' },
    ],
  },
  {
    id: 'gh',
    label: 'The GitHub CLI',
    progs: ['gh', 'glab'],
    verdict: 'narrow',
    why: 'A rule like "gh pr *" covers gh pr view and gh pr list, and in the same breath gh pr ' +
      'merge, gh pr close and gh pr comment — things other people see, in their name. "gh api *" ' +
      'is the whole API, DELETE included.',
    better: () => [
      { rule: 'Bash(gh pr view)', note: 'Reads one PR and nothing else.' },
      { rule: 'Bash(gh pr list)', note: 'Add one line per read-only subcommand you use.' },
      { rule: 'Bash(gh pr diff)', note: 'Still read-only, still cheap to grant.' },
    ],
  },
  {
    id: 'builtin-safe',
    label: 'Commands Claude Code already allows',
    // The only family that applies to an exact rule too: the point is that the
    // line is redundant, and a star has nothing to do with it.
    alsoExact: true,
    progs: ['ls', 'cat', 'pwd', 'which', 'echo', 'head', 'tail', 'wc', 'stat', 'file',
      'basename', 'dirname', 'date', 'whoami', 'uname', 'tree', 'grep', 'rg', 'sort', 'uniq',
      'diff', 'du', 'df', 'realpath', 'readlink'],
    verdict: 'drop',
    why: 'Plain read-only commands run without a prompt already, from a built-in allowlist. A ' +
      'rule for them grants nothing you did not have and costs you a line to re-read every time ' +
      'you audit this file. If one of these is still asking, something is denying it — the rule ' +
      'is not what is missing. One caveat: a rule matches the whole command line, so anything ' +
      'written after the command is inside the prefix too, a redirection into your shell profile ' +
      'included.',
    better: () => [],
  },
];

const BY_PROG = new Map();
for (const f of FAMILIES) for (const p of f.progs) if (!BY_PROG.has(p)) BY_PROG.set(p, f);

/** First word of a Bash pattern, with the wildcard punctuation taken off. */
function program(arg) {
  return (arg || '').trim().split(/\s+/)[0].replace(/[*:]+$/, '').toLowerCase();
}

/**
 * What to think about one rule.
 *
 * @returns {{verdict: string, family: string, why: string, better: {rule: string, note: string}[]}}
 */
export function advise(rule) {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(rule);
  if (mcp) {
    const out = /send|post|create|delete|trash|update|write|reply|forward|schedule/i.test(mcp[2]);
    return {
      verdict: out ? 'narrow' : 'keep',
      family: 'An external connector',
      why: 'A connector rule matches the mcp__server__tool string and nothing else: it is not ' +
        'bound to the server config behind that name, and server names are not unique. Granted ' +
        'in your global file, it pre-approves any future server that happens to name a tool the ' +
        'same.' + (out ? ' This one acts outward, so what it approves is visible to other people.' : ''),
      better: [{ rule: rule, note: 'Same rule, written in that project\'s .claude/settings.local.json instead.' }],
    };
  }

  const m = /^([A-Za-z]+)(?:\((.*)\))?$/.exec(rule);
  if (!m) {
    return { verdict: 'narrow', family: 'Unrecognised',
      why: 'The panel cannot read this rule, and a rule Claude Code cannot read either grants ' +
        'nothing. Check it against a rule you know works.', better: [] };
  }
  const [, tool, arg] = m;

  if (PATH_TOOLS.has(tool)) {
    const everywhere = !arg || arg === '**' || arg === '*';
    if (!everywhere) {
      return { verdict: 'keep', family: 'A path rule',
        why: 'Scoped to a path, which is what you want: the tool can work where you work and ' +
          'asks everywhere else.', better: [] };
    }
    const writes = WRITE_TOOLS.has(tool);
    return {
      verdict: writes ? 'avoid' : 'narrow',
      family: 'A path rule with no path',
      why: '** is the whole machine, not the project: ~/.ssh, ~/.aws, your password manager\'s ' +
        'export folder, every other repo and everything you have ever downloaded. ' +
        (writes ? 'With a writing tool it also means overwriting any of them.'
          : 'Reading is where a prompt injection gets the material it then tries to send somewhere.'),
      better: [
        { rule: tool + '(src/**)', note: 'The folders the work actually happens in.' },
        { rule: tool + '(./**)', note: 'Or lean on permissions.additionalDirectories, which says it once for every tool.' },
      ],
    };
  }

  if (tool !== 'Bash') {
    return { verdict: 'keep', family: 'A tool rule',
      why: 'Grants the tool itself, with no argument to narrow. Worth keeping only if you would ' +
        'have answered yes to the prompt every time anyway.', better: [] };
  }

  if (!arg) {
    return { verdict: 'avoid', family: 'Every command there is',
      why: 'A bare Bash rule is the whole terminal without a prompt. Whatever you added it for, ' +
        'that thing has a name — write the name.', better: [] };
  }

  // A family's warning is about what a prefix lets through, so it only applies
  // to a pattern that has a prefix to let anything through.
  const prog = program(arg);
  const open = /\*/.test(arg);
  const fam = BY_PROG.get(prog);
  if (fam && (open || fam.alsoExact)) {
    return { verdict: fam.verdict, family: fam.label, why: fam.why, better: fam.better(prog) };
  }

  if (open) {
    return {
      verdict: 'narrow', family: 'A wildcard on a command the panel does not know',
      why: 'The match is on the text before the star and stops there: no flag is read, no ' +
        'subcommand is checked. Whatever this program can do with the arguments you did not ' +
        'write down, the rule allows.',
      better: [{ rule: 'Bash(' + arg.trim().replace(/\s*\*$/, '') + ')',
        note: 'The exact invocation, if it is always the same one.' }],
    };
  }
  return { verdict: 'keep', family: 'An exact command',
    why: 'No wildcard, so it approves this command line and nothing adjacent to it. This is the ' +
      'shape a permission rule should have.', better: [] };
}

/**
 * Whether the rule is in the right file. Scope is the part people skip, and it
 * is the part that decides how far a mistake travels.
 */
export function scopeAdvice(rule, key, fileName, isGlobal) {
  if (key === 'deny') {
    return isGlobal
      ? { ok: true, text: 'A deny in your global file holds in every project, which is exactly what a deny is for.' }
      : { ok: true, text: 'Fine here, and worth repeating in your global file if you never want it anywhere.' };
  }
  if (isGlobal) {
    return { ok: false, text: 'This grants the rule in every repo you ever open, including one you ' +
      'clone to read for five minutes. An allow rule belongs in that project\'s ' +
      '.claude/settings.local.json, where it stops at the project boundary.' };
  }
  if (fileName === 'settings.local.json') {
    return { ok: true, text: 'The right home for an allow rule: this project only, gitignored, yours.' };
  }
  return { ok: false, text: 'This file is committed, so the rule grants the same thing to everyone ' +
    'on the team and to anything running in CI with these settings. If it is a preference rather ' +
    'than a team decision, move it to settings.local.json.' };
}

/** The reference the guide view renders. Facts about matching, not advice. */
export const SYNTAX = [
  ['A rule is Tool(pattern)',
    'Bash(git status), Read(src/**), WebFetch. With no parentheses it grants the whole tool. ' +
    'A connector tool is matched by its full mcp__server__tool name.'],
  ['Bash patterns are prefix string matches',
    'No flag is parsed and no subcommand is understood. Bash(git log *) means "the command line ' +
    'starts with git log", whatever the rest of it says.'],
  ['The space before the star is the whole safety margin',
    'Bash(npm run *) stops at a word boundary. Bash(npm run*) also matches npm runfoo. A trailing ' +
    ':* means the same as a trailing space-star.'],
  ['Deny beats everything',
    'deny wins over ask, ask wins over allow, and no permission mode overrides a deny — not ' +
    'bypassPermissions, not auto. It is the only list that cannot be argued with.'],
  ['Read-only commands never needed a rule',
    'Claude Code runs plain read-only commands from a built-in allowlist. If ls or cat is still ' +
    'prompting, a deny rule or the auto-mode classifier is stopping it, and adding an allow rule ' +
    'will not change that.'],
  ['Scope decides how far a mistake travels',
    'Settings merge user < project < local, and a rule written in your global file applies in ' +
    'every repo you ever open. Only defaultMode: "auto" is restricted by file: a project cannot ' +
    'grant it.'],
];

/** What each list is for, in the order the panel shows them. */
export const LISTS = [
  ['allow', 'Runs without a prompt. Every line is a door you are leaving open while you are not looking.'],
  ['ask', 'Always prompts, even for something that would otherwise be automatic. The list people forget exists: it is how you keep one command visible without banning it.'],
  ['deny', 'Never runs, and no mode or classifier overrides it. The only guarantee in the file.'],
  ['defaultMode', 'How a session starts: asking you, planning first, accepting edits, or handing the decision to the auto-mode classifier.'],
  ['additionalDirectories', 'Folders outside the project that Claude may work in. Says it once, instead of a ** pattern per tool.'],
];
