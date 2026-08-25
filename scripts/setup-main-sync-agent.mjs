#!/usr/bin/env node
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { buildSyncPaths } from './sync-main-to-mac.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const DEFAULT_LABEL = 'com.bradleybond.crystalball.main-sync';
const LAUNCHCTL_PATH = '/bin/launchctl';
const SYSTEM_EXECUTABLE_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
export const DEFAULT_INTERVAL_SECONDS = 300;

export function buildLaunchAgentEnvironmentPath(homeDir = os.homedir()) {
  return `${path.join(homeDir, '.cargo', 'bin')}:${SYSTEM_EXECUTABLE_PATH}`;
}

export function buildLaunchAgentPlist({ label, nodePath, syncScriptPath, syncRoot, logDir, intervalSeconds, envPath = buildLaunchAgentEnvironmentPath() }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
 <string>${nodePath}</string>
 <string>${syncScriptPath}</string>
 <string>--sync-root</string>
 <string>${syncRoot}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
 <key>PATH</key>
 <string>${envPath}</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>${repoRoot}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${intervalSeconds}</integer>
  <key>StandardOutPath</key>
  <string>${path.join(logDir, 'main-sync.stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(logDir, 'main-sync.stderr.log')}</string>
</dict>
</plist>
`;
}

function applyArgument(options, argv, index) {
  const arg = argv[index];
  if (arg === '--sync-root' || arg.startsWith('--sync-root=')) {
    const inline = arg.startsWith('--sync-root=');
    const value = inline ? arg.slice('--sync-root='.length) : argv[index + 1] ?? '';
    const nextPaths = buildSyncPaths(value);
    options.syncRoot = nextPaths.syncRoot;
    options.logDir = nextPaths.logDir;
    return index + (inline ? 0 : 1);
  }
  if (arg === '--launch-agent-path' || arg.startsWith('--launch-agent-path=')) {
    const inline = arg.startsWith('--launch-agent-path=');
    options.launchAgentPath = inline ? arg.slice('--launch-agent-path='.length) : argv[index + 1] ?? '';
    return index + (inline ? 0 : 1);
  }
  if (arg === '--interval-seconds' || arg.startsWith('--interval-seconds=')) {
    const inline = arg.startsWith('--interval-seconds=');
    const value = inline ? arg.slice('--interval-seconds='.length) : argv[index + 1] ?? '';
    options.intervalSeconds = Number.parseInt(value, 10);
    return index + (inline ? 0 : 1);
  }
  throw new Error(`Unknown argument: ${arg}`);
}

function parseArgs(argv) {
  const syncPaths = buildSyncPaths();
  const options = {
 syncRoot: syncPaths.syncRoot,
 logDir: syncPaths.logDir,
 launchAgentPath: path.join(os.homedir(), 'Library', 'LaunchAgents', `${DEFAULT_LABEL}.plist`),
 label: DEFAULT_LABEL,
 intervalSeconds: DEFAULT_INTERVAL_SECONDS,
 start: true,
  };

  let index = 0;
  while (index < argv.length) {
    if (argv[index] === '--no-start') {
      options.start = false;
      index += 1;
      continue;
    }
    index = applyArgument(options, argv, index) + 1;
  }

  if (!Number.isInteger(options.intervalSeconds) || options.intervalSeconds < 30) {
 throw new Error('intervalSeconds must be an integer >= 30');
  }

  return options;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
 encoding: 'utf8',
 stdio: 'pipe',
 ...options,
  });
  if ((result.status ?? 1) !== 0) {
 throw new Error(result.stderr?.trim() || result.stdout?.trim() || `${command} ${args.join(' ')} failed`);
  }
}

async function installLaunchAgent(options) {
  await mkdir(path.dirname(options.launchAgentPath), { recursive: true });
  await mkdir(options.logDir, { recursive: true });
  const plist = buildLaunchAgentPlist({
 label: options.label,
 nodePath: process.execPath,
 syncScriptPath: path.join(repoRoot, 'scripts', 'sync-main-to-mac.mjs'),
 syncRoot: options.syncRoot,
 logDir: options.logDir,
 intervalSeconds: options.intervalSeconds,
  });
  await writeFile(options.launchAgentPath, plist);
  await chmod(options.launchAgentPath, 0o644);
}

function reloadLaunchAgent(launchAgentPath, label) {
  const uid = process.getuid?.();
  if (!uid) {
 throw new Error('Could not determine user id for launchctl bootstrap');
  }
  spawnSync(LAUNCHCTL_PATH, ['bootout', `gui/${uid}`, launchAgentPath], { stdio: 'ignore' });
  runCommand(LAUNCHCTL_PATH, ['bootstrap', `gui/${uid}`, launchAgentPath]);
  runCommand(LAUNCHCTL_PATH, ['enable', `gui/${uid}/${label}`]);
  runCommand(LAUNCHCTL_PATH, ['kickstart', '-k', `gui/${uid}/${label}`]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await installLaunchAgent(options);
  if (options.start) {
 reloadLaunchAgent(options.launchAgentPath, options.label);
  }
  console.log(JSON.stringify({
 label: options.label,
 launchAgentPath: options.launchAgentPath,
 syncRoot: options.syncRoot,
 intervalSeconds: options.intervalSeconds,
 started: options.start,
  }, null, 2));
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  try {
    await main();
  } catch (error) {
    console.error(`[setup-main-sync-agent] Failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
