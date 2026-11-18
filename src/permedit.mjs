// Permission edits as pure functions over a parsed settings object, so the
// server can apply them to the file as it is on disk at that moment (never to
// a copy the page loaded minutes ago), and the tests can check them alone.

export const LISTS = ['allow', 'ask', 'deny'];
export const MODES = ['default', 'plan', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions'];

/** Why a rule string cannot be written, or null. */
export function badRule(rule) {
  if (typeof rule !== 'string' || !rule.trim()) return 'empty rule';
  if (rule.length > 500) return 'rule too long';
  if (/[\n\r\0]/.test(rule)) return 'a rule is one line';
  if (!/^(mcp__[\w.-]+|[A-Za-z]+(\([\s\S]*\))?)$/.test(rule.trim())) return 'not a rule: use Tool or Tool(pattern), e.g. Bash(npm test *)';
  return null;
}

/**
 * Applies one edit. Returns { obj, changed, error }: `obj` is a new object,
 * the input is never mutated.
 *   { op: 'add',    list, rule }
 *   { op: 'remove', list, rule }
 *   { op: 'move',   list, rule, to }
 *   { op: 'mode',   value }          ('default' removes the key)
 */
export function applyPermissionOp(input, edit) {
  const obj = structuredClone(input && typeof input === 'object' && !Array.isArray(input) ? input : {});
  const perm = obj.permissions && typeof obj.permissions === 'object' ? obj.permissions : (obj.permissions = {});
  const e = edit || {};
  const list = (k) => (Array.isArray(perm[k]) ? perm[k] : (perm[k] = []));
  const tidy = () => { for (const k of LISTS) if (Array.isArray(perm[k]) && !perm[k].length) delete perm[k]; };

  if (e.op === 'mode') {
    if (!MODES.includes(e.value)) return { error: 'unknown mode' };
    const before = perm.defaultMode;
    if (e.value === 'default') delete perm.defaultMode; else perm.defaultMode = e.value;
    return { obj, changed: before !== perm.defaultMode };
  }
  if (!LISTS.includes(e.list)) return { error: 'list must be allow, ask or deny' };
  const err = badRule(e.rule);
  if (err) return { error: err };
  const rule = e.rule.trim();

  if (e.op === 'add') {
    if (list(e.list).includes(rule)) return { obj, changed: false };
    const elsewhere = LISTS.find((k) => k !== e.list && Array.isArray(perm[k]) && perm[k].includes(rule));
    if (elsewhere) return { error: 'already in ' + elsewhere + ': move it instead' };
    list(e.list).push(rule);
    return { obj, changed: true };
  }
  if (e.op === 'remove' || e.op === 'move') {
    const arr = Array.isArray(perm[e.list]) ? perm[e.list] : [];
    const i = arr.indexOf(rule);
    if (i < 0) return { error: 'the rule is no longer in ' + e.list + ' (the file changed): reload' };
    if (e.op === 'move') {
      if (!LISTS.includes(e.to) || e.to === e.list) return { error: 'move to allow, ask or deny' };
      arr.splice(i, 1);
      if (!list(e.to).includes(rule)) list(e.to).push(rule);
    } else {
      arr.splice(i, 1);
    }
    tidy();
    return { obj, changed: true };
  }
  return { error: 'unknown operation' };
}

/** The permission part of a settings file, as the view shows it. */
export function permissionSummary(obj) {
  const perm = (obj && obj.permissions) || {};
  const out = { defaultMode: perm.defaultMode || 'default' };
  for (const k of LISTS) out[k] = Array.isArray(perm[k]) ? perm[k].filter((r) => typeof r === 'string') : [];
  return out;
}
