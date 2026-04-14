#!/usr/bin/env node
// Install cb-control SessionStart/Stop hooks into ~/.claude/settings.json.
// Idempotent: running twice does not duplicate entries.
//
// Usage:
//   node scripts/install-hooks.mjs            # install
//   node scripts/install-hooks.mjs --uninstall

import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SETTINGS = join(homedir(), '.claude', 'settings.json');
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const HOOKS_DIR = join(ROOT, 'hooks');

const START_HOOK = `node ${join(HOOKS_DIR, 'session-start.mjs')}`;
const STOP_HOOK = `node ${join(HOOKS_DIR, 'session-stop.mjs')}`;

const uninstall = process.argv.includes('--uninstall');

function loadSettings() {
  if (!existsSync(SETTINGS)) return {};
  try { return JSON.parse(readFileSync(SETTINGS, 'utf8')); }
  catch (err) {
    console.error('Could not parse existing settings.json:', err.message);
    process.exit(1);
  }
}

function writeSettings(obj) {
  mkdirSync(dirname(SETTINGS), { recursive: true });
  writeFileSync(SETTINGS, JSON.stringify(obj, null, 2) + '\n');
}

function ensureMatcherList(settings, event) {
  settings.hooks ??= {};
  settings.hooks[event] ??= [];
  let entry = settings.hooks[event].find((e) => e.matcher === '*' || e.matcher == null);
  if (!entry) {
    entry = { matcher: '*', hooks: [] };
    settings.hooks[event].push(entry);
  }
  entry.hooks ??= [];
  return entry;
}

function addHook(settings, event, command) {
  const entry = ensureMatcherList(settings, event);
  if (entry.hooks.some((h) => h.type === 'command' && h.command === command)) return false;
  entry.hooks.push({ type: 'command', command });
  return true;
}

function removeHook(settings, event, command) {
  if (!settings.hooks?.[event]) return false;
  let changed = false;
  for (const entry of settings.hooks[event]) {
    if (!entry.hooks) continue;
    const before = entry.hooks.length;
    entry.hooks = entry.hooks.filter((h) => h.command !== command);
    if (entry.hooks.length !== before) changed = true;
  }
  return changed;
}

// Make hooks executable for good measure
try {
  chmodSync(join(HOOKS_DIR, 'session-start.mjs'), 0o755);
  chmodSync(join(HOOKS_DIR, 'session-stop.mjs'), 0o755);
} catch {}

const settings = loadSettings();

if (uninstall) {
  const a = removeHook(settings, 'SessionStart', START_HOOK);
  const b = removeHook(settings, 'Stop', STOP_HOOK);
  if (a || b) { writeSettings(settings); console.log('Removed cb-control hooks.'); }
  else console.log('No cb-control hooks to remove.');
} else {
  const a = addHook(settings, 'SessionStart', START_HOOK);
  const b = addHook(settings, 'Stop', STOP_HOOK);
  if (a || b) { writeSettings(settings); console.log('Installed cb-control hooks in ' + SETTINGS); }
  else console.log('cb-control hooks already installed.');
}
