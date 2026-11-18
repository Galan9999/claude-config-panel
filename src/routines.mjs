// Everything that runs on a schedule, and how it gets launched.
//
// Three launchers leave something on disk:
//  - the Claude desktop app's scheduled tasks: the prompt is a SKILL.md in
//    ~/.claude/scheduled-tasks/<id>/, but the schedule, the folder it runs in,
//    whether it is on and the permissions approved for it live in the app's own
//    scheduled-tasks.json (Application Support). A folder with no entry there is
//    a prompt nobody schedules;
//  - macOS launchd agents (~/Library/LaunchAgents) whose command is, or calls,
//    Claude: they run with the Mac awake even when the app is closed;
// Two do not: `/loop` and session cron jobs live in a running session's memory,
// and cloud routines live in your claude.ai account. The view says so instead of
// pretending there are none.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { frontmatter } from '../artifact/core.js';
import { tilde } from './paths.mjs';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n) => String(n).padStart(2, '0');

/** One cron field → the set of values it admits. */
function field(spec, lo, hi) {
  const out = new Set();
  for (const part of String(spec).split(',')) {
    const [range, stepS] = part.split('/');
    const step = stepS ? Number(stepS) : 1;
    let a = lo, b = hi;
    if (range !== '*') {
      const [x, y] = range.split('-').map(Number);
      a = x; b = y === undefined ? (stepS ? hi : x) : y;
    }
    if (![a, b, step].every(Number.isFinite) || step < 1) return null;
    for (let v = a; v <= b; v += step) out.add(v === 7 && hi === 7 ? 0 : v);
  }
  return out;
}

export function parseCron(expr) {
  const f = String(expr || '').trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [mi, ho, dom, mo, dow] = [field(f[0], 0, 59), field(f[1], 0, 23), field(f[2], 1, 31), field(f[3], 1, 12), field(f[4], 0, 7)];
  if (![mi, ho, dom, mo, dow].every(Boolean)) return null;
  return { mi, ho, dom, mo, dow, domAny: f[2] === '*', dowAny: f[4] === '*', raw: f };
}

/** "Every day at 09:00", "Weekdays at 08:15", or the expression itself when it is unusual. */
export function cronText(expr) {
  const c = parseCron(expr);
  if (!c) return 'Schedule "' + expr + '" (not a cron expression the panel can read)';
  const [m, h] = c.raw;
  const simpleTime = /^\d+$/.test(m) && /^\d+$/.test(h);
  const at = simpleTime ? ' at ' + pad(h) + ':' + pad(m) : '';
  if (!simpleTime) {
    if (/^\*\/\d+$/.test(m) && h === '*') return 'Every ' + m.slice(2) + ' minutes';
    if (/^\d+$/.test(m) && h === '*') return 'Every hour at minute ' + m;
    return 'Cron "' + expr + '"';
  }
  if (c.domAny && c.raw[3] === '*') {
    if (c.dowAny) return 'Every day' + at;
    const d = [...c.dow].sort();
    if (d.join() === '1,2,3,4,5') return 'Weekdays (Mon–Fri)' + at;
    return 'Every ' + d.map((x) => DAYS[x]).join(', ') + at;
  }
  if (!c.domAny && c.raw[3] === '*' && c.dowAny) return 'Every month on day ' + c.raw[2] + at;
  return 'Cron "' + expr + '"' + at;
}

/** The next time a cron expression fires after `from`, in local time; null past ~2 months. */
export function nextCron(expr, from = new Date()) {
  const c = parseCron(expr);
  if (!c) return null;
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 62; i++) {
    const domOk = c.dom.has(d.getDate()), dowOk = c.dow.has(d.getDay());
    const dayOk = c.domAny && c.dowAny ? true : c.domAny ? dowOk : c.dowAny ? domOk : domOk || dowOk;
    if (c.mi.has(d.getMinutes()) && c.ho.has(d.getHours()) && c.mo.has(d.getMonth() + 1) && dayOk) return d;
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
function listDirs(path) { try { return readdirSync(path, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } }
const iso = (v) => (v == null ? null : typeof v === 'number' ? new Date(v).toISOString() : String(v));

/** Every scheduled-tasks.json the desktop app keeps (one per account/organization). */
function desktopTaskFiles(appSupport) {
  const root = join(appSupport, 'claude-code-sessions');
  const out = [];
  for (const a of listDirs(root)) for (const b of listDirs(join(root, a))) {
    const p = join(root, a, b, 'scheduled-tasks.json');
    if (existsSync(p)) out.push(p);
  }
  return out;
}

export function readDesktopTasks({ claudeDir, appSupport, now = new Date() }) {
  const folders = new Map();
  const tdir = join(claudeDir, 'scheduled-tasks');
  for (const id of listDirs(tdir)) {
    const file = join(tdir, id, 'SKILL.md');
    let fm = {}, mtime = null;
    try { fm = frontmatter(readFileSync(file, 'utf8')); mtime = statSync(file).mtime.toISOString(); } catch { /* no SKILL.md */ }
    folders.set(id, { id, file, fm, mtime });
  }
  const tasks = [];
  const seen = new Set();
  for (const path of desktopTaskFiles(appSupport)) {
    const j = readJson(path);
    for (const t of (j && Array.isArray(j.scheduledTasks) ? j.scheduledTasks : [])) {
      if (!t || !t.id) continue;
      seen.add(t.id);
      const f = folders.get(t.id) || {};
      let schedule;
      if (t.cronExpression) {
        const next = t.enabled ? nextCron(t.cronExpression, now) : null;
        schedule = { kind: 'cron', expr: t.cronExpression, text: cronText(t.cronExpression), next: next && next.toISOString() };
      } else if (t.fireAt) {
        const at = new Date(t.fireAt);
        schedule = { kind: 'once', at: at.toISOString(), text: 'Once, on ' + at.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
          past: at < now };
      } else schedule = { kind: 'manual', text: 'No schedule: runs only when started by hand' };
      tasks.push({
        id: t.id, name: t.displayName || (f.fm && f.fm.name) || t.id,
        description: (f.fm && f.fm.description) || '',
        launcher: 'desktop', enabled: !!t.enabled, schedule,
        cwd: t.cwd ? tilde(t.cwd) : null,
        file: tilde(t.filePath || f.file || ''), fileExists: !!(t.filePath && existsSync(t.filePath)),
        createdAt: iso(t.createdAt), lastRunAt: iso(t.lastRunAt), lastScheduledFor: iso(t.lastScheduledFor),
        approved: (t.approvedPermissions || []).map((p) => p.toolName + (p.ruleContent ? '(' + p.ruleContent + ')' : '')),
        modelInvocable: !(f.fm && /^true$/i.test(f.fm['disable-model-invocation'] || '')),
        config: tilde(path),
      });
    }
  }
  for (const [id, f] of folders) {
    if (seen.has(id)) continue;
    tasks.push({ id, name: (f.fm && f.fm.name) || id, description: (f.fm && f.fm.description) || '', launcher: 'desktop',
      enabled: false, orphan: true, schedule: { kind: 'none', text: 'Not scheduled: the prompt is on disk, but the app has no schedule for it' },
      file: tilde(f.file), fileExists: existsSync(f.file), lastRunAt: null, approved: [], cwd: null, updatedAt: f.mtime });
  }
  return tasks;
}

function plistJson(path) {
  try { return JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path], { encoding: 'utf8', timeout: 4000 })); }
  catch { return null; }
}

function launchdSchedule(p) {
  const cal = p.StartCalendarInterval;
  if (cal) {
    const list = Array.isArray(cal) ? cal : [cal];
    const times = new Map();
    for (const c of list) {
      const t = (c.Hour != null ? pad(c.Hour) : '**') + ':' + (c.Minute != null ? pad(c.Minute) : '00');
      if (!times.has(t)) times.set(t, new Set());
      times.get(t).add(c.Weekday == null ? '*' : c.Weekday % 7);
    }
    return [...times].map(([t, days]) => {
      const d = [...days];
      if (d.includes('*')) return 'Every day at ' + t;
      const s = d.sort().join();
      return (s === '1,2,3,4,5' ? 'Weekdays (Mon–Fri)' : d.map((x) => DAYS[x]).join(', ')) + ' at ' + t;
    }).join('; ');
  }
  if (p.StartInterval) return 'Every ' + Math.round(p.StartInterval / 60) + ' minutes';
  if (p.KeepAlive) return 'Always running (relaunched if it stops)';
  if (p.RunAtLoad) return 'Once at login';
  return 'Only when started by hand';
}

/** User launchd agents whose command is Claude, or a script that calls it. */
export function readLaunchAgents({ dir = join(homedir(), 'Library/LaunchAgents'), loaded = launchctlLoaded } = {}) {
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.plist')); } catch { return []; }
  const out = [];
  for (const f of files) {
    const p = plistJson(join(dir, f));
    if (!p) continue;
    const args = p.ProgramArguments || (p.Program ? [p.Program] : []);
    const script = args.find((a) => /\.(sh|py|mjs|js|zsh|bash)$/.test(a) && existsSync(a));
    let scriptText = '';
    if (script) { try { scriptText = readFileSync(script, 'utf8').slice(0, 200000); } catch { /* unreadable */ } }
    const callsClaude = /\bclaude\b/.test(args.join(' ')) || /(^|[\s/"'])claude(\s+-p|\s+--print|\s|$)/m.test(scriptText);
    if (!callsClaude) continue;
    // The script often writes its own dated logs next to launchd's: the newest file in those folders is the last run.
    const logDirs = [...new Set([p.StandardOutPath, p.StandardErrorPath].filter(Boolean).map((x) => x.replace(/\/[^/]*$/, '')))];
    const last = [];
    for (const d of logDirs) {
      try { for (const f of readdirSync(d)) { try { last.push(statSync(join(d, f)).mtime); } catch { /* gone */ } } } catch { /* no folder */ }
    }
    out.push({
      id: p.Label || f, name: p.Label || f, launcher: 'launchd',
      plist: tilde(join(dir, f)), command: args.map((a) => tilde(a)).join(' '),
      script: script ? tilde(script) : null,
      scriptDoc: scriptText ? (scriptText.split('\n').filter((l) => /^#(?!!)/.test(l)).slice(0, 6).map((l) => l.replace(/^#\s?/, '')).join(' ').trim()) : '',
      headless: /(claude|\$\{?[A-Z_]*CLAUDE[A-Z_]*\}?)"?\s+(-p|--print)\b/.test(scriptText + ' ' + args.join(' ')),
      schedule: { kind: 'launchd', text: launchdSchedule(p) },
      enabled: !p.Disabled, loaded: loaded(p.Label),
      stdout: p.StandardOutPath ? tilde(p.StandardOutPath) : null, stderr: p.StandardErrorPath ? tilde(p.StandardErrorPath) : null,
      lastOutputAt: last.length ? new Date(Math.max(...last.map(Number))).toISOString() : null,
      logDir: logDirs.length ? tilde(logDirs[0]) : null,
    });
  }
  return out;
}

function launchctlLoaded(label) {
  if (!label) return null;
  try { execFileSync('/bin/launchctl', ['list', label], { stdio: 'ignore', timeout: 3000 }); return true; } catch { return false; }
}

export function readRoutines({ claudeDir = join(homedir(), '.claude'),
  appSupport = join(homedir(), 'Library/Application Support/Claude'), launchAgents, now = new Date() } = {}) {
  return {
    desktop: readDesktopTasks({ claudeDir, appSupport, now }),
    launchd: readLaunchAgents(launchAgents ? { dir: launchAgents } : {}),
    generatedAt: now.toISOString(),
  };
}

