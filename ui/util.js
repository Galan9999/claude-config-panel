// Minimal helpers shared by the interface modules.
export const $ = (s, r = document) => r.querySelector(s);

/** Escapes text before it goes into HTML. ALWAYS use it with data read from disk. */
export const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const fdate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * When a skill last fired, to the minute.
 *
 * `fdate` stays date-only because most of what it renders is a span — a run,
 * an audit, a range of commits — where the clock adds noise. The last firing
 * is the opposite: the question behind it is usually "was that this morning's
 * session or last week's", and a bare date cannot answer it. Today and
 * yesterday are named rather than dated, because that is the window where the
 * exact day is the one thing you already know.
 */
export const fwhen = (iso) => {
  // `new Date(null)` is the epoch, not an invalid date, so a null slips past
  // the NaN check and renders as "1 Jan 1970, 01:00". Reject the empty cases
  // before parsing.
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(new Date()) - day(d)) / 86400000);
  if (days === 0) return 'today ' + hm;
  if (days === 1) return 'yesterday ' + hm;
  return fdate(iso) + ', ' + hm;
};
