// Builds the publishable folder: the page, its modules, and a single-file collector.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');
mkdirSync(out, { recursive: true });
// The single-file collector cannot import: the shared mods reader goes inline.
const modsSrc = readFileSync(join(here, '..', 'ui', 'mods.js'), 'utf8').replace(/^export /gm, '');
const core = modsSrc + '\n' + readFileSync(join(here, 'core.js'), 'utf8').replace(/import \{[^}]*\} from '\.\/mods\.js';\n/, '');
const node = readFileSync(join(here, 'collect-node.mjs'), 'utf8')
  .replace(/import \{[^}]*\} from '\.\/core\.js';\n/, '');
writeFileSync(join(out, 'collect.mjs'), '#!/usr/bin/env node\n// ---- core (shared with the page) ----\n' + core + '\n// ---- collector ----\n' + node);
for (const f of ['index.html', 'app.js', 'core.js', 'i18n.js']) copyFileSync(join(here, f), join(out, f));
for (const f of ['permissions.js', 'advice.js', 'util.js', 'mods.js', 'sources.js']) copyFileSync(join(here, '..', 'ui', f), join(out, f));
console.log('built', out);
