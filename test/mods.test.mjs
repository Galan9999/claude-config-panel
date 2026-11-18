import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverMods } from '../src/mods.mjs';
import { describeMod, modActive, splitPluginDirs } from '../ui/mods.js';

test('describeMod reads what a hooks module registers', () => {
  const src = `on('session.start', async () => { await $.command.register({ name: 'chat', description: 'x' }); await $.ui.status('a') })
  on('ui.render', { component: 'Pane' }, h); on('ui.render', { component: 'AbovePrompt' }, h)
  const TOOLS = [{\n name: 'sessions',\n description: 'd' }]; $.tool.register(t)`;
  const m = describeMod({ dir: 'demo', manifest: { name: 'demo', version: '1.0.0' }, sources: [src], commandFiles: ['other'], files: ['a'], active: true });
  assert.deepEqual(m.commands, ['/chat', '/other']);
  assert.deepEqual(m.tools, ['mcp__demo__sessions']);
  assert.deepEqual(m.hooks, [{ event: 'session.start', count: 1 }, { event: 'ui.render', count: 2 }]);
  assert.ok(m.surfaces.includes('panel') && m.surfaces.includes('band above the prompt') && m.surfaces.includes('status line'));
});

test('modActive follows CLAUDE_CODE_PLUGIN_DIRS and enabledPlugins', () => {
  assert.equal(modActive('a', 'a', splitPluginDirs('~/.claude/mods/a:/x/b'), {}).active, true);
  assert.equal(modActive('c', 'c', [], { 'c@m': true }).via, 'enabledPlugins');
  assert.equal(modActive('d', 'd', [], { 'd@m': false }).active, false);
});

test('discoverMods lists mods, marks the active one and redacts secrets', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mods-'));
  const mod = join(home, 'mods', 'demo');
  mkdirSync(join(mod, '.claude-plugin'), { recursive: true });
  mkdirSync(join(mod, 'hooks'));
  writeFileSync(join(mod, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'demo', version: '0.1.0', description: 'uses token=abcdef1234567890abcdef' }));
  writeFileSync(join(mod, 'hooks', 'hooks.json'), '{"modules":["./register.tsx"]}');
  writeFileSync(join(mod, 'hooks', 'register.tsx'), "export const register = on => { on('tool.call', h) }");
  mkdirSync(join(home, 'mods', 'idle'));
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: '~/.claude/mods/demo' } }));
  const mods = await discoverMods(home);
  assert.deepEqual(mods.map((m) => [m.name, m.active]), [['demo', true], ['idle', false]]);
  assert.equal(mods[0].hooks[0].event, 'tool.call');
  assert.ok(!JSON.stringify(mods).includes('abcdef1234567890'));
});
