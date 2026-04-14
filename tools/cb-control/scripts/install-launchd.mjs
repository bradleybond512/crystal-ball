#!/usr/bin/env node
// Install cb-control as a macOS launchd user agent (boots at login, respawns).
//
//   node scripts/install-launchd.mjs                # install + load
//   node scripts/install-launchd.mjs --uninstall    # unload + remove

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (platform() !== 'darwin') {
  console.error('launchd installer is macOS-only. On Linux, use systemd --user.');
  process.exit(1);
}

const LABEL = 'com.cb-control';
const AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents');
const PLIST = join(AGENTS_DIR, `${LABEL}.plist`);
const LOG_DIR = join(homedir(), 'Library', 'Logs');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const ENTRY = join(ROOT, 'server', 'index.mjs');

const HOST = process.env.CB_CONTROL_HOST ?? '0.0.0.0';
const PORT = process.env.CB_CONTROL_PORT ?? '46987';

const uninstall = process.argv.includes('--uninstall');

function which(bin) {
  try { return execSync(`command -v ${bin}`, { encoding: 'utf8' }).trim(); }
  catch { return null; }
}

function load() {
  try { execSync(`launchctl load -w ${PLIST}`, { stdio: 'inherit' }); } catch {}
}
function unload() {
  try { execSync(`launchctl unload -w ${PLIST}`, { stdio: 'inherit' }); } catch {}
}

if (uninstall) {
  if (!existsSync(PLIST)) { console.log('Nothing to uninstall.'); process.exit(0); }
  unload();
  unlinkSync(PLIST);
  console.log('Uninstalled ' + PLIST);
  process.exit(0);
}

const node = which('node');
if (!node) {
  console.error('Could not find `node` on PATH. Install Node 20+ first.');
  process.exit(1);
}

mkdirSync(AGENTS_DIR, { recursive: true });
mkdirSync(LOG_DIR, { recursive: true });

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${ENTRY}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CB_CONTROL_HOST</key><string>${HOST}</string>
    <key>CB_CONTROL_PORT</key><string>${PORT}</string>
    <key>PATH</key><string>${process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'}</string>
  </dict>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(LOG_DIR, 'cb-control.log')}</string>
  <key>StandardErrorPath</key><string>${join(LOG_DIR, 'cb-control.err.log')}</string>
</dict>
</plist>
`;

// If a prior copy is loaded, unload it so the new plist takes effect.
if (existsSync(PLIST)) unload();

writeFileSync(PLIST, plist);
console.log('Wrote ' + PLIST);
load();
console.log('Loaded. Logs: ' + join(LOG_DIR, 'cb-control.log'));
console.log('Daemon URL: http://' + (HOST === '0.0.0.0' ? '<tailscale-host>' : HOST) + ':' + PORT);
