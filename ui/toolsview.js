// The Tools view: what Claude can reach for and where each tool comes from.
// Built-in tools with what your settings say about them; MCP servers on disk;
// claude.ai connectors (not on disk: seen through your rules); tools that mods
// register; plugins and what they bring.
import { esc } from './util.js';

const STATE_TAG = {
  'allowed': 'ok', 'free (never asks)': '', 'free, with some rules': '', 'asks you': '',
  'asks, except the allowed patterns': 'acc', 'always asks': 'warn', 'forbidden': 'err',
};
const LIST_WORD = { allow: 'allowed', ask: 'asks', deny: 'forbidden' };

export async function renderTools(main) {
  main.innerHTML = '<h1>Tools</h1><p class="lede">Loading…</p>';
  let d;
  try { d = await (await fetch('/api/tools')).json(); }
  catch (e) { main.innerHTML = '<h1>Tools</h1><div class="msg err">' + esc(String(e)) + '</div>'; return; }

  const modToolCount = d.modTools.reduce((a, m) => a + m.tools.length, 0);
  let h = '<h1>Tools</h1><p class="lede">Every action Claude takes is a call to a tool. Some ship with Claude Code; ' +
    'the rest come from MCP servers, claude.ai connectors, mods and plugins. A permission rule is always about one of ' +
    'these tools: this is the list of what there is to allow or forbid.</p>';
  h += '<div class="grid">' +
    stat(d.builtin.length, 'built-in tools') + stat(d.mcp.length, 'MCP servers on disk') +
    stat(d.connectors.length, 'connectors seen in your rules') + stat(modToolCount, 'tools from mods') +
    stat(d.plugins.filter((p) => p.enabled).length + ' / ' + d.plugins.length, 'plugins on / installed') + '</div>';

  // Built-in
  h += '<h2 class="sec">Built into Claude Code</h2>' +
    '<p class="desc">The state is what your settings make of each tool across all scopes. "Asks you" is Claude Code\'s own ' +
    'default; in auto mode the classifier answers that prompt instead of you.</p>';
  const groups = {};
  for (const t of d.builtin) (groups[t.group] ??= []).push(t);
  for (const [g, list] of Object.entries(groups)) {
    h += '<div class="card" style="margin-top:10px"><div class="ttl">' + esc(g) + '</div>';
    for (const t of list) {
      h += '<div class="tl-row"><div class="tl-name"><code>' + esc(t.name) + '</code></div><div class="tl-main">' +
        '<div>' + esc(t.what) + '</div>' +
        (t.rules.length ? '<details class="tl-rules"><summary>' + t.rules.length + ' rule' + (t.rules.length > 1 ? 's' : '') + ' about it</summary>' +
          t.rules.map((r) => '<div class="small"><span class="tag ' + (r.list === 'deny' ? 'err' : r.list === 'ask' ? 'warn' : 'ok') + '">' +
            LIST_WORD[r.list] + '</span> <code>' + esc(r.rule) + '</code> <span class="muted">' + esc(r.file) + '</span></div>').join('') +
          '</details>' : '') +
        '</div><div class="tl-state"><span class="tag ' + (STATE_TAG[t.state] || '') + '">' + esc(t.state) + '</span></div></div>';
    }
    h += '</div>';
  }

  // MCP servers
  h += '<h2 class="sec">MCP servers on this machine</h2>' +
    '<p class="desc">Programs or URLs that add tools. A local (stdio) server runs as a process on your Mac with your ' +
    'permissions; a remote (http) one is a service on the internet. Secrets are never shown: only the names of the ' +
    'variables and headers each needs.</p>';
  if (!d.mcp.length) h += '<div class="card"><div class="desc">None declared in <code>~/.claude.json</code> or a project\'s <code>.mcp.json</code>.</div></div>';
  for (const m of d.mcp) {
    h += '<div class="card" style="margin-top:10px"><div class="ttl">' + esc(m.name) + ' <span class="tag">' + esc(m.type || '?') + '</span> ' +
      '<span class="tag">' + esc(m.scope) + '</span></div>' +
      '<div class="desc">' + (m.url ? 'Remote service at <code>' + esc(m.url) + '</code>.'
        : 'Local process: <code>' + esc([m.command, ...(m.args || [])].filter(Boolean).join(' ')) + '</code>') + '</div>' +
      (m.envKeys.length ? '<div class="desc small">Needs: ' + m.envKeys.map((k) => '<code>' + esc(k) + '</code>').join(' ') + '</div>' : '') +
      '<div class="desc small muted">Declared in ' + esc(m.source) + '. Its tools are named <code>mcp__' + esc(m.name) + '__&lt;tool&gt;</code>.</div></div>';
  }

  // Connectors
  h += '<h2 class="sec">claude.ai connectors and other servers named in your rules</h2>' +
    '<p class="desc">Connectors (Slack, Notion, Gmail…) are set up in your claude.ai account, not on disk, so the panel only ' +
    'knows the ones your permission rules mention. Old rules with a long id (<code>mcp__1d163d7a-…</code>) point to a ' +
    'connector by its internal id; the newer ones use its name (<code>mcp__claude_ai_Slack__…</code>).</p>';
  if (!d.connectors.length) h += '<div class="card"><div class="desc">No rule names an MCP tool.</div></div>';
  for (const c of d.connectors) {
    h += '<details class="piece" style="margin-top:8px"><summary><div class="sum-main"><b>' + esc(c.name) + '</b> <span class="tag">' + esc(c.kind) + '</span> ' +
      '<span class="small muted">' + c.tools.length + ' rule' + (c.tools.length > 1 ? 's' : '') + '</span></div></summary><div class="body">' +
      c.tools.map((t) => '<div class="small"><span class="tag ' + (t.list === 'deny' ? 'err' : t.list === 'ask' ? 'warn' : 'ok') + '">' + LIST_WORD[t.list] +
        '</span> <code>' + esc(t.tool) + '</code> <span class="muted">' + esc(t.file) + '</span></div>').join('') + '</div></details>';
  }

  // Mods
  h += '<h2 class="sec">Tools that mods register</h2>' +
    '<p class="desc">A mod can give the model tools of its own. They show up as <code>mcp__&lt;mod&gt;__&lt;tool&gt;</code> and are ' +
    'permissioned like any MCP tool. The descriptions are the ones the model reads.</p>';
  if (!d.modTools.length) h += '<div class="card"><div class="desc">No mod registers tools.</div></div>';
  for (const m of d.modTools) {
    h += '<details class="piece" style="margin-top:8px"><summary><div class="sum-main"><b>' + esc(m.mod) + '</b> ' +
      '<span class="tag ' + (m.active ? 'ok' : '') + '">' + (m.active ? 'loaded' : 'not loaded') + '</span> <span class="small muted">' +
      m.tools.length + ' tools</span></div></summary><div class="body">' +
      m.tools.map((t) => '<div class="tl-row"><div class="tl-name"><code>' + esc(t.name) + '</code></div><div class="tl-main small">' +
        esc(t.description || 'No description.') + '</div></div>').join('') + '</div></details>';
  }

  // Plugins
  h += '<h2 class="sec">Plugins</h2>' +
    '<p class="desc">Packages installed from a marketplace. An installed plugin does nothing until <code>enabledPlugins</code> ' +
    'turns it on; once on, its skills, agents, commands, hooks and servers load like your own.</p>';
  for (const p of d.plugins) {
    h += '<div class="card" style="margin-top:10px"><div class="ttl">' + esc(p.name) +
      ' <span class="tag">' + esc(p.marketplace) + '</span> <span class="tag ' + (p.enabled ? 'ok' : '') + '">' +
      (p.enabled ? 'on' : p.explicitlyOff ? 'off' : 'not enabled') + '</span>' + (p.installed ? '' : ' <span class="tag warn">not installed</span>') + '</div>' +
      (p.ships.length ? '<div class="desc">Brings: ' + esc(p.ships.join(' · ')) + '</div>' : '') +
      (p.versions.length ? '<div class="desc small muted">Versions: ' + esc(p.versions.join(', ')) + '</div>' : '') + '</div>';
  }
  main.innerHTML = h;
  main.onclick = null;
}

function stat(n, label) { return '<div class="stat"><b>' + esc(String(n)) + '</b><span>' + esc(label) + '</span></div>'; }
