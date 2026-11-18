import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, fdate, fwhen } from '../ui/util.js';

test('esc neutralises the four characters that break out of HTML', () => {
  assert.equal(esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(0), '0', 'zero is a value, not an absence');
});

// `fwhen` is what the usage tables show for "last fired". The question behind
// that cell is almost always "was that this morning or last week", so the
// recent end is named and the rest is dated.

/** An ISO string for a local wall-clock time, however the machine is set. */
const localIso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  .toISOString().replace('Z', '');

const at = (daysAgo, h, m) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return localIso(d);
};

test('today and yesterday are named, not dated', () => {
  assert.equal(fwhen(at(0, 9, 5)), 'today 09:05');
  assert.equal(fwhen(at(1, 23, 40)), 'yesterday 23:40');
});

test('further back carries the date as well as the clock', () => {
  const out = fwhen(at(6, 14, 30));
  assert.match(out, /\d{4}, 14:30$/);
  assert.ok(!out.startsWith('today') && !out.startsWith('yesterday'));
});

test('the boundary is the calendar day, not twenty-four hours', () => {
  // One minute past midnight is today; one minute before it is yesterday.
  // Counting elapsed hours instead would call both of them "today".
  assert.equal(fwhen(at(0, 0, 1)), 'today 00:01');
  assert.equal(fwhen(at(1, 23, 59)), 'yesterday 23:59');
});

test('a missing or unparseable stamp does not render as Invalid Date', () => {
  assert.equal(fwhen(null), '—');
  assert.equal(fwhen(''), '—');
  assert.equal(fwhen('not a date'), 'not a date');
});

test('fdate stays date-only, because most of what it labels is a span', () => {
  const out = fdate('2026-10-28T22:29:19.342Z');
  assert.match(out, /^\d{1,2} \w{3} 2026$/);
  assert.ok(!/\d{2}:\d{2}/.test(out));
});
