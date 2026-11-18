// The Routines view: everything that runs on a schedule, grouped by what
// launches it, with how each launcher works, because that decides when a run
// silently does not happen (app closed, Mac asleep, session gone).
import { esc, fwhen } from './util.js';

const LAUNCHERS = [
  ['Claude desktop app', 'Scheduled tasks',
    'At the scheduled time the app starts a new Claude Code session in the task\'s folder and sends it the task\'s SKILL.md as the prompt. ' +
    'It only fires while the app is open and the Mac is awake. The prompt lives in ~/.claude/scheduled-tasks/<id>/SKILL.md; ' +
    'the schedule, folder and approved permissions live in the app\'s own scheduled-tasks.json.'],
  ['macOS launchd', 'Launch agents',
    'macOS runs a command at the times in a .plist under ~/Library/LaunchAgents, with no app open. To involve Claude, the command calls ' +
    'claude -p ("print" mode: one prompt, no chat, then exit), so whatever the run needs has to be allowed up front with flags.'],
  ['A running session', '/loop and session cron',
    '/loop and CronCreate live in the memory of one open Claude Code session: they repeat while that session stays open and vanish when it ' +
    'closes. Nothing is written to disk, so this panel cannot list them; inside the session, CronList shows its own.'],
  ['claude.ai, in the cloud', 'Cloud routines',
    'Run on Anthropic\'s servers on a cron schedule, with your Mac off. They use your claude.ai connectors and a fresh checkout, not your ' +
    'local files. They are not on disk: list them with /schedule in Claude Code, or on claude.ai.'],
];

export async function renderRoutines(main) {
  main.innerHTML = '<h1>Routines</h1><p class="lede">Loading…</p>';
  let d;
  try { d = await (await fetch('/api/routines')).json(); }
  catch (e) { main.innerHTML = '<h1>Routines</h1><div class="msg err">' + esc(String(e)) + '</div>'; return; }
  const active = d.desktop.filter((t) => t.enabled).length + d.launchd.filter((t) => t.enabled && t.loaded !== false).length;

  let h = '<h1>Routines</h1><p class="lede">Everything that runs without you starting it, and how it gets launched. ' +
    'The launcher is what decides whether a run actually happens: some need the app open, some only a Mac that is awake, ' +
    'one dies with its session.</p>';
  h += '<div class="grid">' + stat(active, 'active on this Mac') +
    stat(d.desktop.filter((t) => !t.orphan).length, 'desktop app tasks') + stat(d.launchd.length, 'launchd agents calling Claude') +
    stat(d.desktop.filter((t) => t.orphan).length, 'prompts with no schedule') + '</div>';

  h += '<h2 class="sec">The four ways something runs on its own</h2><div class="grid rt-launchers">' +
    LAUNCHERS.map(([who, what, how]) => '<div class="card"><div class="ttl">' + esc(what) + '</div><div class="small muted">' + esc(who) + '</div>' +
      '<div class="desc">' + esc(how) + '</div></div>').join('') + '</div>';

  h += '<h2 class="sec">Desktop app — scheduled tasks</h2>';
  const tasks = [...d.desktop].sort((a, b) => (b.enabled - a.enabled) || (!!a.orphan - !!b.orphan) || a.name.localeCompare(b.name));
  if (!tasks.length) h += '<div class="card"><div class="desc">None.</div></div>';
  for (const t of tasks) h += taskCard(t);

  h += '<h2 class="sec">launchd — agents that call Claude</h2>' +
    '<p class="desc">Only agents whose command, or the script it runs, calls <code>claude</code>. Others (Google updater…) are left out.</p>';
  if (!d.launchd.length) h += '<div class="card"><div class="desc">None.</div></div>';
  for (const a of d.launchd) h += agentCard(a);

  h += '<h2 class="sec">Not on disk</h2><div class="card"><div class="ttl">/loop, session cron and cloud routines</div>' +
    '<div class="desc">The panel reads files, and these leave none on this Mac. To see them: inside a session, ask for <code>CronList</code> ' +
    '(that session\'s loops); for cloud routines run <code>/schedule</code> in Claude Code or open claude.ai.</div></div>';
  main.innerHTML = h;
  main.onclick = null;
}

function stat(n, label) { return '<div class="stat"><b>' + esc(String(n)) + '</b><span>' + esc(label) + '</span></div>'; }
const when = (iso) => (iso ? esc(fwhen(iso)) : '—');
const kv = (rows) => '<dl class="kv rt-kv">' + rows.filter(Boolean).map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>').join('') + '</dl>';

function taskCard(t) {
  const state = t.orphan ? ['no schedule', 'warn'] : t.enabled ? ['on', 'ok'] : t.schedule.kind === 'once' && t.schedule.past ? ['done (one-off)', ''] : ['paused', ''];
  let how;
  if (t.orphan) how = 'Nothing launches it. The prompt is on disk but the desktop app has no schedule for it: it was removed from the app, or the folder was copied here by hand. Schedule it again from the app, or delete the folder.';
  else if (t.schedule.kind === 'once') how = 'The app fires it once at that time, opening a session in ' + (t.cwd || 'its folder') + ' with SKILL.md as the prompt.';
  else how = 'The app opens a new session in ' + (t.cwd || 'its folder') + ' ' + t.schedule.text.toLowerCase() + ' and sends SKILL.md as the prompt. If the app is closed or the Mac asleep at that time, that run does not happen then.';
  return '<details class="piece rt-item" style="margin-top:8px"><summary><div class="sum-main"><b>' + esc(t.name) + '</b> ' +
    '<span class="tag ' + state[1] + '">' + state[0] + '</span> <span class="small muted">' + esc(t.schedule.text) + '</span>' +
    (t.description ? '<div class="desc">' + esc(t.description) + '</div>' : '') + '</div></summary><div class="body">' +
    '<div class="desc"><b>How it launches. </b>' + esc(how) + '</div>' +
    kv([
      ['Schedule', esc(t.schedule.text) + (t.schedule.expr ? ' <code>' + esc(t.schedule.expr) + '</code>' : '')],
      t.schedule.next && ['Next run', when(t.schedule.next)],
      ['Last run', when(t.lastRunAt)],
      t.cwd && ['Runs in', '<code>' + esc(t.cwd) + '</code>'],
      ['Prompt', '<code>' + esc(t.file) + '</code>' + (t.fileExists ? '' : ' <span class="tag err">missing</span>')],
      ['Approved for it', t.approved && t.approved.length ? t.approved.map((r) => '<code>' + esc(r) + '</code>').join(' ')
        : '<span class="muted">nothing extra: anything outside your settings\' rules makes it stop and wait for an answer</span>'],
      t.createdAt && ['Created', when(t.createdAt)],
    ]) + '</div></details>';
}

function agentCard(a) {
  const state = !a.enabled ? ['disabled', ''] : a.loaded === false ? ['not loaded', 'warn'] : ['loaded', 'ok'];
  return '<details class="piece rt-item" style="margin-top:8px"><summary><div class="sum-main"><b>' + esc(a.name) + '</b> ' +
    '<span class="tag ' + state[1] + '">' + state[0] + '</span> <span class="small muted">' + esc(a.schedule.text) + '</span>' +
    (a.scriptDoc ? '<div class="desc">' + esc(a.scriptDoc.slice(0, 260)) + (a.scriptDoc.length > 260 ? '…' : '') + '</div>' : '') +
    '</div></summary><div class="body">' +
    '<div class="desc"><b>How it launches. </b>macOS runs <code>' + esc(a.command) + '</code> ' + esc(a.schedule.text.toLowerCase()) +
    ', with or without the Claude app open' + (a.headless ? ', and the script calls <code>claude -p</code>: a headless run with no chat, which can only use the tools the script allows up front.' : '.') +
    (a.loaded === false ? ' It is not loaded in launchd right now, so it will not fire until it is (launchctl load).' : '') + '</div>' +
    kv([
      ['Schedule', esc(a.schedule.text)],
      ['Last output', when(a.lastOutputAt) + (a.logDir ? ' <span class="muted">(newest file in ' + esc(a.logDir) + ')</span>' : '')],
      ['Command', '<code>' + esc(a.command) + '</code>'],
      a.script && ['Script', '<code>' + esc(a.script) + '</code>'],
      ['Definition', '<code>' + esc(a.plist) + '</code>'],
      a.stdout && ['launchd output', '<code>' + esc(a.stdout) + '</code>'],
    ]) + '</div></details>';
}
