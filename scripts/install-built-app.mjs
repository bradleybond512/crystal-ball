#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const DEFAULT_APP_PATH = path.join(repoRoot, 'src-tauri', 'target', 'release', 'bundle', 'macos', 'Crystal Ball.app');
const DEFAULT_INSTALL_PATH = path.join(os.homedir(), 'Applications', 'Crystal Ball.app');
const EXPECTED_BUNDLE_ID = 'com.bradleybond.crystalball';
const APP_PROCESS_TIMEOUT_MS = 15_000;
const APP_PROCESS_POLL_INTERVAL_MS = 100;
const VALUE_OPTION_FIELDS = new Map([
  ['--app', 'appPath'],
  ['--install-path', 'installPath'],
  ['--sha256', 'expectedSha256'],
  ['--local-sha', 'localSha'],
  ['--state-file', 'stateFile'],
]);

const DEFAULT_SYNC_STATE_FILE = path.join(os.homedir(), '.crystalball-main-sync', 'state.json');

export function parseArgs(argv) {
  const options = {
 appPath: DEFAULT_APP_PATH,
 installPath: DEFAULT_INSTALL_PATH,
 expectedSha256: '',
 relaunch: false,
 localSha: '', // git SHA of the locally built commit
 stateFile: DEFAULT_SYNC_STATE_FILE,
  };

  for (let i = 0; i < argv.length; i += 1) {
 const arg = argv[i];
 if (arg === '--relaunch') {
 options.relaunch = true;
 continue;
 }

 const separatorIndex = arg.indexOf('=');
 const optionName = separatorIndex === -1 ? arg : arg.slice(0, separatorIndex);
 const field = VALUE_OPTION_FIELDS.get(optionName);
 if (!field) {
   throw new Error(`Unknown argument: ${arg}`);
 }

 options[field] = separatorIndex === -1
   ? argv[++i] ?? ''
   : arg.slice(separatorIndex + 1);
  }

  return options;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
 encoding: 'utf8',
 ...options,
  });
  if ((result.status ?? 1) !== 0) {
 throw new Error(result.stderr?.trim() || `${command} ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

export async function hashDirectory(dirPath) {
  const hash = createHash('sha256');
  const stack = [dirPath];
  while (stack.length > 0) {
 const current = stack.pop();
 const entries = runCommand('find', [current, '-mindepth', '1', '-maxdepth', '1']).split('\n').filter(Boolean).sort();
 for (const entry of entries) {
 const relative = path.relative(dirPath, entry);
 const entryStat = await stat(entry);
 hash.update(relative);
 if (entryStat.isDirectory()) {
 stack.push(entry);
 continue;
 }
 hash.update(await readFile(entry));
 }
  }
  return hash.digest('hex');
}

export function getInfoPlistPath(appPath) {
  return path.join(appPath, 'Contents', 'Info.plist');
}

export async function verifyAppBundle(appPath, expectedSha256 = '') {
  await stat(appPath);
  runCommand('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  const bundleId = runCommand('plutil', [
 '-extract',
 'CFBundleIdentifier',
 'raw',
 '-o',
 '-',
 getInfoPlistPath(appPath),
  ]);
  if (bundleId !== EXPECTED_BUNDLE_ID) {
 throw new Error(`Unexpected bundle identifier: ${bundleId}`);
  }
  if (expectedSha256) {
 const actualSha = await hashDirectory(appPath);
 if (actualSha !== expectedSha256) {
 throw new Error(`Bundle checksum mismatch: ${actualSha} != ${expectedSha256}`);
 }
  }
}

export function buildSwapPaths(installPath) {
  const parent = path.dirname(installPath);
  const bundleName = path.basename(installPath);
  return {
 parent,
 staged: path.join(parent, `${bundleName}.main-sync-staged`),
 backup: path.join(parent, `${bundleName}.main-sync-backup`),
  };
}

async function installAppBundle(sourceApp, installPath) {
  const { staged, backup } = buildSwapPaths(installPath);
  await rm(staged, { recursive: true, force: true });
  await rm(backup, { recursive: true, force: true });
  await cp(sourceApp, staged, { recursive: true });
  await verifyAppBundle(staged);

  try {
 await rename(installPath, backup);
  } catch (error) {
 if (error?.code !== 'ENOENT') {
 throw error;
 }
  }

  try {
 await rename(staged, installPath);
 await rm(backup, { recursive: true, force: true });
  } catch (error) {
 await rm(installPath, { recursive: true, force: true }).catch(() => {});
 if (await stat(backup).then(() => true).catch(() => false)) {
 await rename(backup, installPath).catch(() => {});
 }
 throw error;
  }
}

// Write the locally-built git SHA into the sync state file so the canonical
// main-sync agent knows a local build is installed and can avoid overwriting it.
async function writeLocalBuildSha(stateFile, localSha, installPath) {
  if (!localSha) return;
  let existing = {};
  try { existing = JSON.parse(await readFile(stateFile, 'utf8')); } catch { /* new file */ }
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify({ ...existing, localBuildSha: localSha, localInstalledAt: new Date().toISOString(), installPath }, null, 2)}\n`);
}

function isAppProcessRunning(installPath, processCommands) {
  const executablePath = path.join(installPath, 'Contents', 'MacOS', 'crystalball');
  return processCommands
 .split('\n')
 .map((command) => command.trim())
 .some((command) => command === executablePath || command.startsWith(`${executablePath} `));
}

export async function waitForAppProcess(
  installPath,
  shouldBeRunning,
  {
 timeoutMs = APP_PROCESS_TIMEOUT_MS,
 pollIntervalMs = APP_PROCESS_POLL_INTERVAL_MS,
 readProcessCommands = () => runCommand('/bin/ps', ['-axo', 'command=']),
  } = {},
) {
  const startedAt = Date.now();
  while (true) {
 const isRunning = isAppProcessRunning(installPath, readProcessCommands());
 if (isRunning === shouldBeRunning) {
   return;
 }
 if (Date.now() - startedAt >= timeoutMs) {
   const action = shouldBeRunning ? 'start' : 'exit';
   throw new Error(`Crystal Ball app process did not ${action} within ${timeoutMs}ms`);
 }
 await delay(pollIntervalMs);
  }
}

async function stopRunningApp(installPath) {
  spawnSync('/usr/bin/osascript', ['-e', 'tell application "Crystal Ball" to quit'], { stdio: 'ignore' });
  await waitForAppProcess(installPath, false);
}

async function relaunchApp(installPath) {
  runCommand('/usr/bin/open', ['-a', installPath]);
  await waitForAppProcess(installPath, true);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'crystalball-main-sync-'));
  try {
 const stagedSource = path.join(tempRoot, path.basename(options.appPath));
 await cp(options.appPath, stagedSource, { recursive: true });
 await verifyAppBundle(stagedSource, options.expectedSha256);
 await stopRunningApp(options.installPath);
 await installAppBundle(stagedSource, options.installPath);
 if (options.relaunch) await relaunchApp(options.installPath);
 await writeLocalBuildSha(options.stateFile, options.localSha, options.installPath);
 const localBuildSuffix = options.localSha ? ` (local build ${options.localSha.slice(0, 8)})` : '';
 console.log(`[install-built-app] Installed ${options.installPath}${localBuildSuffix}`);
  } finally {
 await rm(tempRoot, { recursive: true, force: true });
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  try {
 await main();
  } catch (error) {
 console.error(`[install-built-app] Failed: ${error instanceof Error ? error.message : String(error)}`);
 process.exitCode = 1;
  }
}
