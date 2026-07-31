#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { dirname, join, resolve } = path;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prefixIndex = process.argv.indexOf('--prefix');
if (prefixIndex !== -1 && !process.argv[prefixIndex + 1]) {
  throw new Error('--prefix requires a directory path.');
}
const prefix = prefixIndex === -1
  ? join(homedir(), '.local')
  : resolve(process.argv[prefixIndex + 1]);
const npmExec = process.env.npm_execpath;
if (!npmExec) throw new Error('Run this installer through npm run mcp:install-local.');
const npmArgs = [
  'install',
  '--global',
  '--install-links=true',
  '--prefix',
  prefix,
  join(root, 'tools', 'mcp-server'),
];

execFileSync(process.execPath, [npmExec, ...npmArgs], { stdio: 'inherit' });

if (process.platform === 'darwin' && !process.argv.includes('--no-monitor')) {
  const installer = join(
    prefix,
    'lib',
    'node_modules',
    'crystalball-mcp',
    'install-monitor.mjs',
  );
  execFileSync(process.execPath, [installer], { stdio: 'inherit' });
}

console.log(`Installed Crystal Ball agent commands in ${join(prefix, 'bin')}.`);
