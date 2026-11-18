import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cronText, nextCron, readDesktopTasks } from '../src/routines.mjs';

test('common cron expressions read as plain words', () => {
  assert.equal(cronText('0 9 * * *'), 'Every day at 09:00');
  assert.equal(cronText('15 8 * * 1-5'), 'Weekdays (Mon–Fri) at 08:15');
  assert.equal(cronText('*/30 * * * *'), 'Every 30 minutes');
  assert.equal(cronText('0 7 1 * *'), 'Every month on day 1 at 07:00');
  assert.match(cronText('not cron'), /not a cron expression/);
});

test('the next run is the next matching minute, in local time', () => {
  const from = new Date(2026, 10, 18, 9, 30); // Wed 18 Nov 2026 09:30 local
  const n = nextCron('0 9 * * *', from);
  assert.equal(n.getDate(), 19);
  assert.equal(n.getHours(), 9);
  assert.equal(n.getMinutes(), 0);
  const wk = nextCron('0 9 * * 1-5', new Date(2026, 10, 20, 10, 0)); // Friday after 9
  assert.equal(wk.getDay(), 1, 'skips the weekend');
});

test('desktop tasks join the app\'s schedule with the prompt on disk, and flag prompts nobody schedules', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccp-rt-'));
  const claude = join(root, 'claude'), app = join(root, 'app');
  for (const id of ['daily', 'orphan']) {
    mkdirSync(join(claude, 'scheduled-tasks', id), { recursive: true });
    writeFileSync(join(claude, 'scheduled-tasks', id, 'SKILL.md'), '---\nname: ' + id + '\ndescription: the ' + id + ' one\n---\nbody');
  }
  const cfg = join(app, 'claude-code-sessions', 'acc', 'org');
  mkdirSync(cfg, { recursive: true });
  writeFileSync(join(cfg, 'scheduled-tasks.json'), JSON.stringify({ scheduledTasks: [
    { id: 'daily', cronExpression: '0 9 * * *', enabled: true, filePath: join(claude, 'scheduled-tasks', 'daily', 'SKILL.md'),
      cwd: '/repo', lastRunAt: '2026-11-18T08:00:00Z', approvedPermissions: [{ toolName: 'Bash', ruleContent: 'pnpm audit *' }] },
  ] }));
  const tasks = readDesktopTasks({ claudeDir: claude, appSupport: app, now: new Date(2026, 10, 18, 12, 0) });
  const daily = tasks.find((t) => t.id === 'daily'), orphan = tasks.find((t) => t.id === 'orphan');
  assert.equal(daily.schedule.text, 'Every day at 09:00');
  assert.ok(daily.schedule.next);
  assert.deepEqual(daily.approved, ['Bash(pnpm audit *)']);
  assert.equal(daily.description, 'the daily one');
  assert.equal(orphan.orphan, true);
  assert.equal(orphan.enabled, false);
});
