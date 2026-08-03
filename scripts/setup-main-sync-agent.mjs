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
const DEFAULT_INTERVAL_SECONDS = 60;
const LAUNCHCTL_PATH = '/bin/launchctl';
export const REQUIRED_NODE_MAJOR = 22;
const NODE_FORMULA = `node@${REQUIRED_NODE_MAJOR}`;
const UNSTABLE_NODE_PATH = /\/(?:Cellar|\.nvm\/versions\/node|\.fnm\/node-versions)\//;
const TRUSTED_NODE_DIRECTORIES = new Set([
  `/opt/homebrew/opt/${NODE_FORMULA}/bin`,
  `/usr/local/opt/${NODE_FORMULA}/bin`,
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
]);

function escapeXml(value) {
  return String(value)
 .replaceAll('&', '&amp;')
 .replaceAll('<', '&lt;')
 .replaceAll('>', '&gt;')
 .replaceAll('"', '&quot;')
 .replaceAll("'", '&apos;');
}

export function buildStableNodeCandidates({ execPath = '', envPath = '' } = {}) {
  const candidates = [
 `/opt/homebrew/opt/${NODE_FORMULA}/bin/node`,
 `/usr/local/opt/${NODE_FORMULA}/bin/node`,
  ];
  const cellarMatch = execPath.match(/^(.*)\/Cellar\/(node@\d+)\/[^/]+\/bin\/node$/);
  if (cellarMatch?.[2] === NODE_FORMULA) {
 candidates.unshift(`${cellarMatch[1]}/opt/${cellarMatch[2]}/bin/node`);
  }
  for (const directory of envPath.split(path.delimiter).filter(Boolean)) {
 const candidate = path.join(directory, 'node');
 if (TRUSTED_NODE_DIRECTORIES.has(directory) && !UNSTABLE_NODE_PATH.test(candidate)) {
 candidates.push(candidate);
 }
  }
  if (execPath && TRUSTED_NODE_DIRECTORIES.has(path.dirname(execPath)) && !UNSTABLE_NODE_PATH.test(execPath)) {
 candidates.push(execPath);
  }
  return [...new Set(candidates)];
}

function probeNodeMajor(nodePath) {
  const result = spawnSync(nodePath, ['--version'], { encoding: 'utf8', stdio: 'pipe' });
  if ((result.status ?? 1) !== 0) return null;
  const match = result.stdout.trim().match(/^v(\d+)\./);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function selectStableNodePath(candidates, probe = probeNodeMajor) {
  for (const candidate of candidates) {
 try {
 if (!UNSTABLE_NODE_PATH.test(candidate) && probe(candidate) === REQUIRED_NODE_MAJOR) {
 return candidate;
 }
 } catch {
 // Try the next stable candidate.
 }
  }
  throw new Error('Could not find a stable Node 22 executable; install node@22 and rerun setup');
}

export function buildLaunchAgentPath(nodePath, homeDir = os.homedir()) {
  return [...new Set([
 path.dirname(nodePath),
 '/opt/homebrew/bin',
 '/opt/homebrew/sbin',
 '/usr/local/bin',
 '/usr/bin',
 '/bin',
 '/usr/sbin',
 '/sbin',
 path.join(homeDir, '.cargo', 'bin'),
  ])].join(path.delimiter);
}

export function buildLaunchAgentPlist({ label, nodePath, syncScriptPath, syncRoot, logDir, intervalSeconds, envPath }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
 <string>${escapeXml(nodePath)}</string>
 <string>${escapeXml(syncScriptPath)}</string>
 <string>--sync-root</string>
 <string>${escapeXml(syncRoot)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
 <key>PATH</key>
 <string>${escapeXml(envPath)}</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>${escapeXml(repoRoot)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${intervalSeconds}</integer>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(logDir, 'main-sync.stdout.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(logDir, 'main-sync.stderr.log'))}</string>
</dict>
</plist>
`;
}

function validateOptions(options) {
  if (!Number.isInteger(options.intervalSeconds) || options.intervalSeconds < 30) {
 throw new Error('intervalSeconds must be an integer >= 30');
  }
  return options;
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

  for (let index = 0; index < argv.length; index += 1) {
 const arg = argv[index];
 if (arg === '--sync-root') {
 const nextRoot = argv[index + 1] ?? '';
 index += 1;
 const nextPaths = buildSyncPaths(nextRoot);
 options.syncRoot = nextPaths.syncRoot;
 options.logDir = nextPaths.logDir;
 continue;
 }
 if (arg.startsWith('--sync-root=')) {
 const nextPaths = buildSyncPaths(arg.slice('--sync-root='.length));
 options.syncRoot = nextPaths.syncRoot;
 options.logDir = nextPaths.logDir;
 continue;
 }
 if (arg === '--launch-agent-path') {
 options.launchAgentPath = argv[index + 1] ?? '';
 index += 1;
 continue;
 }
 if (arg.startsWith('--launch-agent-path=')) {
 options.launchAgentPath = arg.slice('--launch-agent-path='.length);
 continue;
 }
 if (arg === '--interval-seconds') {
 options.intervalSeconds = Number.parseInt(argv[index + 1] ?? '', 10);
 index += 1;
 continue;
 }
 if (arg.startsWith('--interval-seconds=')) {
 options.intervalSeconds = Number.parseInt(arg.slice('--interval-seconds='.length), 10);
 continue;
 }
 if (arg === '--no-start') {
 options.start = false;
 continue;
 }
 throw new Error(`Unknown argument: ${arg}`);
  }

  return validateOptions(options);
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
  const nodePath = selectStableNodePath(buildStableNodeCandidates({
 execPath: process.execPath,
 envPath: process.env.PATH,
  }));
  const envPath = buildLaunchAgentPath(nodePath);
  await mkdir(path.dirname(options.launchAgentPath), { recursive: true });
  await mkdir(options.logDir, { recursive: true });
  const plist = buildLaunchAgentPlist({
 label: options.label,
 nodePath,
 syncScriptPath: path.join(repoRoot, 'scripts', 'sync-main-to-mac.mjs'),
 syncRoot: options.syncRoot,
 logDir: options.logDir,
 intervalSeconds: options.intervalSeconds,
 envPath,
  });
  await writeFile(options.launchAgentPath, plist);
  await chmod(options.launchAgentPath, 0o644);
  return nodePath;
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
  const nodePath = await installLaunchAgent(options);
  if (options.start) {
 reloadLaunchAgent(options.launchAgentPath, options.label);
  }
  console.log(JSON.stringify({
 label: options.label,
 launchAgentPath: options.launchAgentPath,
 syncRoot: options.syncRoot,
 nodePath,
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
