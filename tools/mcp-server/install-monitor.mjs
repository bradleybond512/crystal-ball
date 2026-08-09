#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  installMonitorLaunchAgent,
  MONITOR_LABEL,
  renderMonitorLaunchAgent,
} from './launch-agent.mjs';

if (process.platform !== 'darwin') {
  throw new Error('The Crystal Ball background monitor installer currently supports macOS.');
}

const args = process.argv.slice(2);
const remove = args.includes('--remove');
const intervalIndex = args.indexOf('--interval-seconds');
const intervalSeconds = intervalIndex === -1
  ? 900
  : Number.parseInt(args[intervalIndex + 1], 10);
const graceIndex = args.indexOf('--stopped-grace-seconds');
const stoppedGraceSeconds = graceIndex === -1
  ? intervalSeconds * 2
  : Number.parseInt(args[graceIndex + 1], 10);
const userHome = homedir();
const launchAgentsDir = join(userHome, 'Library', 'LaunchAgents');
const plistPath = join(launchAgentsDir, `${MONITOR_LABEL}.plist`);
const logPath = join(userHome, 'Library', 'Logs', 'crystalball-mcp-monitor.log');
const domain = `gui/${process.getuid()}`;
const service = `${domain}/${MONITOR_LABEL}`;

if (remove) {
  try {
    execFileSync('launchctl', ['bootout', service], { stdio: 'ignore' });
  } catch {
    // The job may not be loaded yet.
  }
  if (existsSync(plistPath)) rmSync(plistPath);
  console.log(`Removed ${MONITOR_LABEL}.`);
  process.exit(0);
}

const runnerPath = realpathSync(join(dirname(fileURLToPath(import.meta.url)), 'monitor-once.mjs'));
const plist = renderMonitorLaunchAgent({
  nodePath: process.execPath,
  runnerPath,
  logPath,
  intervalSeconds,
  stoppedGraceSeconds,
});

mkdirSync(launchAgentsDir, { recursive: true });
mkdirSync(dirname(logPath), { recursive: true });
installMonitorLaunchAgent({ domain, plist, plistPath, service });
console.log(`Installed ${MONITOR_LABEL}; interval ${intervalSeconds} seconds.`);
