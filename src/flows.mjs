// Flows: sequences of numbered commands that form a pipeline.
//
// The point is not to describe the flow in words all over again. If a team has
// `.claude/commands/deploy/1.plan.md … 4.ship.md`, the order, each phase's
// model and what each one is allowed to do are already in the files. Drawing it
// from there means the diagram cannot go stale: rename a phase and the panel
// follows. There is no second source of truth to maintain.

/** `deploy:3.verify` -> { folder: 'deploy', order: 3, slug: 'verify' }. null if not a phase. */
export function parsePhase(name) {
  const m = /^([^:]+):(\d+)\.(.+)$/.exec(name || '');
  return m ? { folder: m[1], order: Number(m[2]), slug: m[3] } : null;
}

/** A `_NAME.md` inside a commands folder is documentation, not a command. */
export function isFolderDoc(name) {
  return /^[^:]+:_/.test(name || '');
}

/** Groups commands into flows by folder, ordered by their number. */
export function groupFlows(commands) {
  const flows = new Map();
  for (const c of commands) {
    const p = parsePhase(c.name);
    if (!p) continue;
    if (!flows.has(p.folder)) flows.set(p.folder, { folder: p.folder, scope: c.scope, repo: c.repo, phases: [], docs: [] });
    flows.get(p.folder).phases.push({ ...p, item: c });
  }
  for (const c of commands) {
    if (!isFolderDoc(c.name)) continue;
    const folder = c.name.split(':')[0];
    if (flows.has(folder)) flows.get(folder).docs.push(c);
  }
  for (const f of flows.values()) f.phases.sort((a, b) => a.order - b.order);
  // A single numbered command is not a pipeline.
  return [...flows.values()].filter((f) => f.phases.length > 1);
}

// The verb can sit anywhere in the name, bounded by _ or -:
// slack_send_message, notion-update-page, trash_thread.
const OUTWARD = /(^|[_-])(send|create|update|delete|trash|post|reply|forward|schedule|publish|merge|close)([_-]|$)/i;

/** The tool's own name inside `mcp__<server>__<tool>`. */
const mcpTool = (t) => t.split('__').slice(2).join('__');

/**
 * Splits out the tools a phase may use without asking, flagging the ones that
 * act outside the machine. That a ship phase writes to a tracker and opens PRs
 * unprompted is exactly what reading the flow in prose does not tell you.
 */
export function parseTools(allowedTools) {
  const tools = String(allowedTools || '').split(',').map((t) => t.trim()).filter(Boolean);
  return {
    tools,
    outward: tools.filter((t) => t.startsWith('mcp__') && OUTWARD.test(mcpTool(t))),
    agents: tools.includes('Task'),
  };
}

/** References to commands like `/deploy:3.verify` that appear in a text. */
export function findCommandRefs(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/\/([a-z0-9_-]+):([a-z0-9_.-]+)/gi)) {
    out.add(m[1] + ':' + m[2]);
  }
  return [...out];
}

/**
 * Configuration paths quoted in a text, to check whether they still exist.
 * Folders are left out: many are created on the fly when the flow runs
 * (`.claude/tickets/`), so their absence means nothing.
 */
export function findConfigPaths(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/(?:^|[\s"'`(])((?:\.claude|apps\/[a-z0-9-]+\/\.claude)\/[\w./-]+)/gi)) {
    const path = m[1].replace(/[.,:;)]+$/, '');
    if (path.endsWith('/')) continue;
    out.add(path);
  }
  return [...out];
}

/**
 * `/deploy:N`, `/deploy:<phase>` and `/deploy:X` are placeholders in prose, not
 * commands. Flagging them as broken floods the report and buries the real ones.
 */
const IS_PLACEHOLDER = (phase) => /^[A-Z]$|^[A-Z]{1,3}[-_]|^<|^\{/.test(phase) || /^(n|x|fase|phase|cmd)$/i.test(phase);

/**
 * Broken references: commands quoted that do not exist.
 * @param {string[]} refs  what the text quotes
 * @param {Set<string>} known  command names that actually exist
 */
export function brokenRefs(refs, known) {
  // Only folders we know about: `/api:something` from another context is not a
  // broken command, it is simply not about this.
  const folders = new Set([...known].map((n) => n.split(':')[0]));
  return refs.filter((r) => {
    const [folder, ...rest] = r.split(':');
    const phase = rest.join(':');
    return folders.has(folder) && !known.has(r) && !IS_PLACEHOLDER(phase);
  });
}
