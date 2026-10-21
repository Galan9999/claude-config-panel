#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, startupMessage, USAGE } from '../src/cli.mjs';
import { createPanelServer } from '../src/server.mjs';
import { discover } from '../src/discover.mjs';

const pkg = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

let opts;
try {
  opts = parseArgs(process.argv.slice(2), process.env);
} catch (e) {
  console.error(e.message + '\n\n' + USAGE);
  process.exit(1);
}
if (opts.help) { console.log(USAGE); process.exit(0); }
if (opts.version) { console.log(pkg.version); process.exit(0); }

const server = createPanelServer(opts);
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('El puerto ' + opts.port + ' está ocupado. Prueba con --port ' + (opts.port + 1) + '.');
    process.exit(1);
  }
  throw e;
});
server.listen(opts.port, '127.0.0.1', () => {
  console.log(startupMessage(opts, discover(opts)));
  console.log('Copias de seguridad en ~/.claude/backups/config-dashboard/  ·  Ctrl+C para parar');
});
