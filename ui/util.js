// Ayudas mínimas compartidas por los módulos de la interfaz.
export const $ = (s, r = document) => r.querySelector(s);

/** Escapa texto antes de meterlo en HTML. Úsalo SIEMPRE con datos leídos de disco. */
export const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
