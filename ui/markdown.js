// Minimal Markdown renderer: headings, lists, tables, quotes, code and inline
// formatting. Enough for SKILL.md and CLAUDE.md, with no dependencies.
import { esc } from './util.js';

const BT = String.fromCharCode(96);

export function md(src) {
  const fence = BT + BT + BT;
  src = src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const blocks = [];
  src = src.replace(new RegExp(fence + '([a-z]*)\\n([\\s\\S]*?)' + fence, 'g'), (m, lang, code) => {
    blocks.push(code); return '@@CB' + (blocks.length - 1) + '@@';
  });
  const inline = (s) => esc(s)
    .replace(new RegExp(BT + '([^' + BT + ']+)' + BT, 'g'), '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const out = [];
  let list = null, inTable = false;
  for (const raw of src.split(/\r?\n/)) {
    const l = raw.trimEnd();
    const cb = /^@@CB(\d+)@@$/.exec(l.trim());
    if (cb) { if (list) { out.push('</' + list + '>'); list = null; }
      out.push('<pre><code>' + esc(blocks[+cb[1]]) + '</code></pre>'); continue; }
    if (/^\|.*\|$/.test(l)) {
      if (/^\|[\s:|-]+\|$/.test(l)) continue;
      const cells = l.slice(1, -1).split('|').map((c) => inline(c.trim()));
      if (!inTable) { out.push('<table><tr>' + cells.map((c) => '<th>' + c + '</th>').join('') + '</tr>'); inTable = true; }
      else out.push('<tr>' + cells.map((c) => '<td>' + c + '</td>').join('') + '</tr>');
      continue;
    }
    if (inTable) { out.push('</table>'); inTable = false; }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) { if (list) { out.push('</' + list + '>'); list = null; }
      out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); continue; }
    if (/^(-{3,}|\*{3,})$/.test(l)) { out.push('<hr>'); continue; }
    const q = /^>\s?(.*)$/.exec(l);
    if (q) { out.push('<blockquote>' + inline(q[1]) + '</blockquote>'); continue; }
    const ul = /^[-*+]\s+(.*)$/.exec(l), ol = /^\d+[.)]\s+(.*)$/.exec(l);
    if (ul || ol) {
      const want = ul ? 'ul' : 'ol';
      if (list !== want) { if (list) out.push('</' + list + '>'); out.push('<' + want + '>'); list = want; }
      out.push('<li>' + inline((ul || ol)[1]) + '</li>'); continue;
    }
    if (list) { out.push('</' + list + '>'); list = null; }
    if (l.trim()) out.push('<p>' + inline(l) + '</p>');
  }
  if (list) out.push('</' + list + '>');
  if (inTable) out.push('</table>');
  return out.join('');
}
