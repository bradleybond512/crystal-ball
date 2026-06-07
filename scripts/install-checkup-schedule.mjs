#!/usr/bin/env node
/* eslint-disable sonarjs/no-os-command-from-path -- dev-tooling: writes a plist only */
/**
 * A2 — Install a daily macOS LaunchAgent that runs `npm run checkup`
 * and appends output to ~/Library/Logs/crystalball-checkup.log.
 *
 * Usage:
 *   node scripts/install-checkup-schedule.mjs          # install (runs at 9 am daily)
 *   node scripts/install-checkup-schedule.mjs --remove # uninstall
 *   node scripts/install-checkup-schedule.mjs --hour 7 # custom hour (0-23)
 */

import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { resolve, dirname } = path;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'com.bradleybond.crystalball.checkup';
const PLIST_PATH = `${process.env.HOME}/Library/LaunchAgents/${LABEL}.plist`;
const LOG_PATH = `${process.env.HOME}/Library/Logs/crystalball-checkup.log`;

const args = process.argv.slice(2);
const remove = args.includes('--remove');
const hourArg = args.indexOf('--hour');
const hour = hourArg === -1 ? 9 : Number.parseInt(args[hourArg + 1] ?? '9', 10);

if (remove) {
  if (existsSync(PLIST_PATH)) {
    try {
      execFileSync('launchctl', ['unload', PLIST_PATH]);
    } catch { /* not loaded — that's fine */ }
    rmSync(PLIST_PATH);
    console.log(`Removed ${PLIST_PATH}`);
  } else {
    console.log('LaunchAgent not installed — nothing to remove.');
  }
  process.exit(0);
}

const nodeExec = process.execPath;
const checkupScript = resolve(root, 'scripts/checkup.mjs');

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeExec}</string>
    <string>${checkupScript}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_PATH}</string>
  <key>WorkingDirectory</key>
  <string>${root}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
</dict>
</plist>
`;

writeFileSync(PLIST_PATH, plist, { mode: 0o644 });
try {
  execFileSync('launchctl', ['load', PLIST_PATH]);
  console.log(`Installed daily checkup at ${hour}:00 → ${LOG_PATH}`);
  console.log(`To remove: node scripts/install-checkup-schedule.mjs --remove`);
} catch (error) {
  console.log(`Plist written to ${PLIST_PATH}`);
  console.log(`Load manually: launchctl load ${PLIST_PATH}`);
  console.error(`launchctl load failed: ${String(error)}`);
}
