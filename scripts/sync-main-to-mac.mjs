#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-vars, sonarjs/cognitive-complexity, sonarjs/no-os-command-from-path, sonarjs/no-nested-template-literals, unicorn/prefer-top-level-await */
import { constants as fsConstants } from 'node:fs';
import { access, open, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { hashDirectory, verifyAppBundle } from './install-built-app.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const DEFAULT_SYNC_ROOT = path.join(os.homedir(), '.crystalball-main-sync');
const DEFAULT_REMOTE_URL = 'https://github.com/bradleybond512/crystal-ball.git';
const DEFAULT_REPO_SLUG = 'bradleybond512/crystal-ball';
const DEFAULT_BRANCH = 'main';
const DEFAULT_INSTALL_PATH = path.join(os.homedir(), 'Applications', 'Crystal Ball.app');
const SYSTEM_EXECUTABLE_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

export const NPM_VERIFICATION_COMMANDS = [
  ['run', 'lockfile:check'],
  ['ci'],
  ['run', 'version:check'],
  ['run', 'typecheck:all'],
  ['run', 'build'],
  ['run', 'desktop:build:app:full'],
];

export function assertSupportedMainSyncNode(version = process.versions.node) {
  const major = Number.parseInt(String(version).split('.')[0], 10);
  if (major !== 22) {
 throw new Error(`Node 22 is required for main sync; running Node ${version}`);
  }
}

export function buildLaunchAgentEnvironmentPath(homeDir = os.homedir()) {
  return `${path.join(homeDir, '.cargo', 'bin')}:${SYSTEM_EXECUTABLE_PATH}`;
}

export function buildMainSyncToolchain(nodePath = process.execPath, env = process.env) {
  if (typeof nodePath !== 'string' || !path.isAbsolute(nodePath)) {
 throw new Error('Main sync requires an absolute Node executable path');
  }
  if (!env || typeof env.PATH !== 'string' || env.PATH.length === 0) {
 throw new Error('Main sync requires a non-empty PATH for subprocesses');
  }
  const nodeDir = path.dirname(nodePath);
  return {
 nodePath,
 npmPath: path.join(nodeDir, 'npm'),
 env: {
 ...env,
 PATH: `${nodeDir}:${env.PATH}`,
 },
  };
}

export async function validatePinnedNodeToolchain(nodePath = process.execPath, env = process.env) {
  assertSupportedMainSyncNode();
  const toolchain = buildMainSyncToolchain(nodePath, env);
  try {
 await access(toolchain.npmPath, fsConstants.X_OK);
  } catch {
 throw new Error(`Selected Node toolchain has no executable npm sibling at ${toolchain.npmPath}`);
  }
  return toolchain;
}

export function buildSyncPaths(syncRoot = DEFAULT_SYNC_ROOT) {
  return {
 syncRoot,
 repoDir: path.join(syncRoot, 'repo'),
 stateFile: path.join(syncRoot, 'state.json'),
 statusFile: path.join(syncRoot, 'status.json'),
 lockFile: path.join(syncRoot, 'sync.lock'),
 logDir: path.join(syncRoot, 'logs'),
  };
}

function parseArgs(argv) {
  const paths = buildSyncPaths();
  const options = {
 syncRoot: paths.syncRoot,
 repoDir: paths.repoDir,
 stateFile: paths.stateFile,
 statusFile: paths.statusFile,
 lockFile: paths.lockFile,
 logDir: paths.logDir,
 repoSlug: DEFAULT_REPO_SLUG,
 remoteUrl: DEFAULT_REMOTE_URL,
 branch: DEFAULT_BRANCH,
 installPath: DEFAULT_INSTALL_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
 const arg = argv[index];
 if (arg === '--sync-root') {
 const nextRoot = argv[index + 1] ?? '';
 index += 1;
 Object.assign(options, buildSyncPaths(nextRoot));
 continue;
 }
 if (arg.startsWith('--sync-root=')) {
 Object.assign(options, buildSyncPaths(arg.slice('--sync-root='.length)));
 continue;
 }
 if (arg === '--repo') {
 options.repoSlug = argv[index + 1] ?? '';
 index += 1;
 continue;
 }
 if (arg.startsWith('--repo=')) {
 options.repoSlug = arg.slice('--repo='.length);
 continue;
 }
 if (arg === '--remote-url') {
 options.remoteUrl = argv[index + 1] ?? '';
 index += 1;
 continue;
 }
 if (arg.startsWith('--remote-url=')) {
 options.remoteUrl = arg.slice('--remote-url='.length);
 continue;
 }
 if (arg === '--branch') {
 options.branch = argv[index + 1] ?? '';
 index += 1;
 continue;
 }
 if (arg.startsWith('--branch=')) {
 options.branch = arg.slice('--branch='.length);
 continue;
 }
 if (arg === '--install-path') {
 options.installPath = argv[index + 1] ?? '';
 index += 1;
 continue;
 }
 if (arg.startsWith('--install-path=')) {
 options.installPath = arg.slice('--install-path='.length);
 continue;
 }
 throw new Error(`Unknown argument: ${arg}`);
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
  return result.stdout.trim();
}

function runLoggedCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
 stdio: 'inherit',
 ...options,
  });
  if ((result.status ?? 1) !== 0) {
 throw new Error(`${command} ${args.join(' ')} failed with status ${result.status ?? 1}`);
  }
}

async function pathExists(filePath) {
  return stat(filePath).then(() => true).catch(() => false);
}

async function readJson(filePath) {
  try {
 return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
 return null;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

class SyncBlockedError extends Error {}

// Lock files older than this are assumed to belong to a crashed process
// and are removed automatically so a fresh run can proceed.
const STALE_LOCK_MS = 12 * 60 * 60 * 1000; // 12 hours

async function clearStaleLock(lockFile) {
  try {
    const s = await stat(lockFile);
    if (Date.now() - s.mtimeMs > STALE_LOCK_MS) {
      await rm(lockFile, { force: true });
      console.warn('[sync-main-to-mac] removed stale lock (older than 12 h); previous run likely crashed');
    }
  } catch {
    // No lock file — nothing to do.
  }
}

async function acquireLock(lockFile) {
  await mkdir(path.dirname(lockFile), { recursive: true });
  return open(lockFile, 'wx');
}

async function fetchTargetSha(options) {
  await mkdir(path.dirname(options.repoDir), { recursive: true });

  if (await pathExists(path.join(options.repoDir, '.git'))) {
 runCommand('git', ['remote', 'set-url', 'origin', options.remoteUrl], { cwd: options.repoDir });
  } else {
 await rm(options.repoDir, { recursive: true, force: true });
 runLoggedCommand('git', ['clone', '--branch', options.branch, '--single-branch', options.remoteUrl, options.repoDir]);
  }

  // Fetch the target branch first, without tags. This always succeeds
  // and gives us the target SHA even when the local clone has stale
  // tags that would otherwise block a combined fetch.
  runCommand('git', ['fetch', 'origin', options.branch, '--prune', '--no-tags'], { cwd: options.repoDir });
  return runCommand('git', ['rev-parse', `origin/${options.branch}`], { cwd: options.repoDir });
}

async function prepareClone(options, targetSha) {
  // Then fetch tags with --force --prune-tags so a force-moved
  // historical tag (e.g., a release re-tag) doesn't fail the entire
  // sync. Active-release-tag integrity is still verified server-side
  // via the gh API check on the target SHA — local tag freshness is
  // not a security boundary, only a convenience for offline tooling.
  // If the tag-only fetch fails for any other reason, log it and
  // continue rather than blocking the install.
  const tagFetch = spawnSync(
    'git',
    ['fetch', 'origin', '--tags', '--force', '--prune-tags'],
    { cwd: options.repoDir, encoding: 'utf8' },
  );
  if ((tagFetch.status ?? 1) !== 0) {
    console.warn(`[sync-main-to-mac] tag fetch warning: ${tagFetch.stderr?.trim() || tagFetch.stdout?.trim() || 'unknown'}`);
  }
  runLoggedCommand('git', ['checkout', '--force', '-B', options.branch, `origin/${options.branch}`], {
 cwd: options.repoDir,
  });
  runLoggedCommand('git', ['reset', '--hard', targetSha], { cwd: options.repoDir });
  runLoggedCommand('git', ['clean', '-fdx'], { cwd: options.repoDir });
}

export function determineSyncAction({ installedSha, targetSha, installedHealthy }) {
  return installedSha === targetSha && installedHealthy ? 'idle' : 'build';
}

function normalizeCheckState(value) {
  return String(value ?? 'unknown').toLowerCase();
}

export function collectCheckStates(checkRunsPayload, statusPayload) {
  const states = new Map();
  for (const checkRun of checkRunsPayload?.check_runs ?? []) {
 if (checkRun?.name) {
 states.set(checkRun.name, normalizeCheckState(checkRun.conclusion ?? checkRun.status));
 }
  }
  for (const status of statusPayload?.statuses ?? []) {
 if (status?.context) {
 states.set(status.context, normalizeCheckState(status.state));
 }
  }
  return states;
}

export function collectStatusCheckRollupStates(statusCheckRollup = []) {
  const states = new Map();
  for (const entry of statusCheckRollup) {
 const name = entry?.context ?? entry?.name;
 if (!name) {
 continue;
 }
 const state = entry?.state ?? entry?.conclusion ?? entry?.status;
 states.set(name, normalizeCheckState(state));
  }
  return states;
}

export function evaluateRequiredChecks(requiredChecks, checkStates) {
  const missing = [];
  const nonSuccess = [];

  for (const checkName of requiredChecks) {
 const state = checkStates.get(checkName);
 if (!state) {
 missing.push(checkName);
 continue;
 }
 if (state !== 'success') {
 nonSuccess.push(`${checkName}=${state}`);
 }
  }

  return {
 isGreen: missing.length === 0 && nonSuccess.length === 0,
 missing,
 nonSuccess,
  };
}

function formatCheckFailure(subject, result) {
  const details = [];
  if (result.missing.length > 0) details.push(`missing [${result.missing.join(', ')}]`);
  if (result.nonSuccess.length > 0) details.push(`non-success [${result.nonSuccess.join(', ')}]`);
  return `Required GitHub checks are not green for ${subject}: ${details.join('; ')}`;
}

export function findMergedPullRequestForCommit(pulls, sha, branch) {
  return (pulls ?? []).find((pull) => (
 pull?.merged_at
 && pull?.merge_commit_sha === sha
 && pull?.base?.ref === branch
  )) ?? null;
}

function readMergedPullRequestCheckStates(repoSlug, branch, sha) {
  const pullsPayload = JSON.parse(
 runCommand('gh', ['api', `repos/${repoSlug}/commits/${sha}/pulls`]),
  );
  const mergedPull = findMergedPullRequestForCommit(pullsPayload, sha, branch);
  if (!mergedPull?.number) {
 return null;
  }

  const prPayload = JSON.parse(
 runCommand('gh', [
 'pr',
 'view',
 String(mergedPull.number),
 '--repo',
 repoSlug,
 '--json',
 'number,mergedAt,baseRefName,mergeCommit,statusCheckRollup',
 ]),
  );
  if (!prPayload?.mergedAt || prPayload?.baseRefName !== branch || prPayload?.mergeCommit?.oid !== sha) {
 return null;
  }

  return {
 prNumber: prPayload.number,
 checkStates: collectStatusCheckRollupStates(prPayload.statusCheckRollup),
  };
}

async function verifyRemoteChecks(options, sha) {
  const requiredPayload = JSON.parse(
 runCommand('gh', ['api', `repos/${options.repoSlug}/branches/${options.branch}/protection/required_status_checks`]),
  );
  const requiredChecks = (requiredPayload.checks ?? []).map((entry) => entry.context).filter(Boolean);
  const checkRunsPayload = JSON.parse(
 runCommand('gh', ['api', `repos/${options.repoSlug}/commits/${sha}/check-runs`]),
  );
  const statusPayload = JSON.parse(
 runCommand('gh', ['api', `repos/${options.repoSlug}/commits/${sha}/status`]),
  );
  const commitCheckStates = collectCheckStates(checkRunsPayload, statusPayload);
  const commitResult = evaluateRequiredChecks(requiredChecks, commitCheckStates);
  if (commitResult.isGreen) {
 return {
 requiredChecks,
 verificationSource: 'commit',
 verifiedPrNumber: null,
 };
  }

  // Auto-merged PRs created by github-actions[bot] can land on main without
  // emitting the required push workflow contexts on the merge commit itself.
  // In that case, fall back to the merged PR's status rollup, which is the
  // source GitHub used to allow the merge in the first place.
  const mergedPullVerification = readMergedPullRequestCheckStates(options.repoSlug, options.branch, sha);
  if (mergedPullVerification) {
 const prResult = evaluateRequiredChecks(requiredChecks, mergedPullVerification.checkStates);
 if (prResult.isGreen) {
 return {
 requiredChecks,
 verificationSource: 'pull_request',
 verifiedPrNumber: mergedPullVerification.prNumber,
 };
 }
 throw new SyncBlockedError(
 `${formatCheckFailure(sha, commitResult)}; ${formatCheckFailure(`PR #${mergedPullVerification.prNumber}`, prResult)}`,
 );
  }

  throw new SyncBlockedError(formatCheckFailure(sha, commitResult));
}

async function isInstalledCommitHealthy(state, installPath) {
  if (!state?.installedSha) {
 return false;
  }
  try {
 await verifyAppBundle(installPath);
 return true;
  } catch {
 return false;
  }
}

export function runVerificationAndBuild(repoDir, toolchain, run = runLoggedCommand) {
  for (const args of NPM_VERIFICATION_COMMANDS) {
 run(toolchain.npmPath, args, { cwd: repoDir, env: toolchain.env });
  }
}

async function installBuiltApp(repoDir, installPath) {
  const appPath = path.join(repoDir, 'src-tauri', 'target', 'release', 'bundle', 'macos', 'Crystal Ball.app');
  await verifyAppBundle(appPath);
  const appSha = await hashDirectory(appPath);
  runLoggedCommand(process.execPath, [
 path.join(repoDir, 'scripts', 'install-built-app.mjs'),
 '--app',
 appPath,
 '--install-path',
 installPath,
 '--sha256',
 appSha,
 '--relaunch',
  ]);
  return { appPath, appSha };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const toolchain = await validatePinnedNodeToolchain();
  const startedAt = new Date().toISOString();
  await clearStaleLock(options.lockFile);
  const lockHandle = await acquireLock(options.lockFile).catch((error) => {
 if (error?.code === 'EEXIST') {
 throw new SyncBlockedError('A main sync run is already in progress');
 }
 throw error;
  });

  try {
 await mkdir(options.logDir, { recursive: true });
 const state = await readJson(options.stateFile);
 const targetSha = await fetchTargetSha(options);

 await writeJson(options.statusFile, {
 phase: 'checking',
 startedAt,
 targetSha,
 installPath: options.installPath,
 repoDir: options.repoDir,
 });

 const installedHealthy = state?.installedSha === targetSha
 ? await isInstalledCommitHealthy(state, options.installPath)
 : false;
 if (determineSyncAction({
 installedSha: state?.installedSha,
 targetSha,
 installedHealthy,
 }) === 'idle') {
 await writeJson(options.statusFile, {
 phase: 'idle',
 checkedAt: new Date().toISOString(),
 targetSha,
 installedSha: state.installedSha,
 requiredChecks: state.requiredChecks,
 verificationSource: state.verificationSource,
 verifiedPrNumber: state.verifiedPrNumber,
 });
 return;
 }

 await prepareClone(options, targetSha);
 const { requiredChecks, verificationSource, verifiedPrNumber } = await verifyRemoteChecks(options, targetSha);

 // If a local build is installed that is NOT an ancestor of macos/main HEAD,
 // the installed version is ahead of (or diverged from) main — skip to avoid
 // overwriting a newer local build with an older remote build.
 if (state?.localBuildSha && state.localBuildSha !== targetSha) {
 const mergeBase = spawnSync(
 'git',
 ['merge-base', '--is-ancestor', state.localBuildSha, targetSha],
 { cwd: options.repoDir },
 );
 if (mergeBase.status !== 0) {
 await writeJson(options.statusFile, {
 phase: 'idle',
 checkedAt: new Date().toISOString(),
 targetSha,
 localBuildSha: state.localBuildSha,
 skippedReason: 'local-build-ahead',
 requiredChecks,
 verificationSource,
 verifiedPrNumber,
 });
 console.log(`[sync-main-to-mac] Local build ${state.localBuildSha.slice(0, 8)} is ahead of main — skipping install`);
 return;
 }
 }

 await writeJson(options.statusFile, {
 phase: 'building',
 startedAt,
 targetSha,
 requiredChecks,
 });

 await runVerificationAndBuild(options.repoDir, toolchain);
 const installResult = await installBuiltApp(options.repoDir, options.installPath);
 const finishedAt = new Date().toISOString();

 await writeJson(options.stateFile, {
 installedAt: finishedAt,
 installedSha: targetSha,
 installPath: options.installPath,
 appPath: installResult.appPath,
 appSha256: installResult.appSha,
 repoSlug: options.repoSlug,
 branch: options.branch,
 requiredChecks,
 verificationSource,
 verifiedPrNumber,
 });
 await writeJson(options.statusFile, {
 phase: 'installed',
 installedAt: finishedAt,
 targetSha,
 installPath: options.installPath,
 appSha256: installResult.appSha,
 verificationSource,
 verifiedPrNumber,
 });
 console.log(`[sync-main-to-mac] Installed ${targetSha} to ${options.installPath}`);
  } catch (error) {
 const status = error instanceof SyncBlockedError ? 'blocked' : 'failed';
 await writeJson(options.statusFile, {
 phase: status,
 checkedAt: new Date().toISOString(),
 error: error instanceof Error ? error.message : String(error),
 }).catch(() => {});
 if (error instanceof SyncBlockedError) {
 console.log(`[sync-main-to-mac] ${error.message}`);
 return;
 }
 throw error;
  } finally {
 await lockHandle?.close().catch(() => {});
 await rm(options.lockFile, { force: true }).catch(() => {});
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  main().catch((error) => {
 console.error(`[sync-main-to-mac] Failed: ${error instanceof Error ? error.message : String(error)}`);
 process.exit(1);
  });
}
