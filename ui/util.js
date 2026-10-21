// Minimal helpers shared by the interface modules.
export const $ = (s, r = document) => r.querySelector(s);

/** Escapes text before it goes into HTML. ALWAYS use it with data read from disk. */
export const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
