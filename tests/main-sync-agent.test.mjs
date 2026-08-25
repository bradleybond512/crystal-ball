import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import * as mainSyncAgent from '../scripts/setup-main-sync-agent.mjs';
import {
  buildSyncPaths,
  collectCheckStates,
  collectStatusCheckRollupStates,
  determineSyncAction,
  evaluateRequiredChecks,
  findMergedPullRequestForCommit,
} from '../scripts/sync-main-to-mac.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const syncScriptPath = path.join(repoRoot, 'scripts', 'sync-main-to-mac.mjs');
const setupScriptPath = path.join(repoRoot, 'scripts', 'setup-main-sync-agent.mjs');
const packageJsonPath = path.join(repoRoot, 'package.json');
const {
  DEFAULT_INTERVAL_SECONDS,
  buildLaunchAgentPlist,
} = mainSyncAgent;

function readIfExists(filePath) {
  if (!existsSync(filePath)) {
 return '';
  }
  return readFileSync(filePath, 'utf8');
}

test('main sync helper paths stay inside the dedicated sync root', () => {
  assert.deepEqual(buildSyncPaths('/Users/bradleybond/.crystalball-main-sync'), {
 syncRoot: '/Users/bradleybond/.crystalball-main-sync',
 repoDir: '/Users/bradleybond/.crystalball-main-sync/repo',
 stateFile: '/Users/bradleybond/.crystalball-main-sync/state.json',
 statusFile: '/Users/bradleybond/.crystalball-main-sync/status.json',
 lockFile: '/Users/bradleybond/.crystalball-main-sync/sync.lock',
 logDir: '/Users/bradleybond/.crystalball-main-sync/logs',
  });
});

test('main sync can fall back to a merged PR status rollup when merge-commit checks are sparse', () => {
  const requiredChecks = [
 'release-integrity',
 'typecheck',
 'Analyze (actions)',
 'Analyze (javascript-typescript)',
 'Analyze (rust)',
 'actionlint',
 'secret-scan',
  ];

  const mergeCommitStates = collectCheckStates({
 check_runs: [
 { name: 'Analyze (actions)', conclusion: 'success' },
 { name: 'Analyze (javascript-typescript)', conclusion: 'success' },
 { name: 'Analyze (rust)', conclusion: 'success' },
 { name: 'Analyze (python)', conclusion: 'success' },
 ],
  }, { statuses: [] });
  assert.deepEqual(evaluateRequiredChecks(requiredChecks, mergeCommitStates), {
 isGreen: false,
 missing: ['release-integrity', 'typecheck', 'actionlint', 'secret-scan'],
 nonSuccess: [],
  });

  const prRollupStates = collectStatusCheckRollupStates([
 { __typename: 'CheckRun', name: 'release-integrity', conclusion: 'SUCCESS' },
 { __typename: 'CheckRun', name: 'typecheck', conclusion: 'SUCCESS' },
 { __typename: 'CheckRun', name: 'Analyze (actions)', conclusion: 'SUCCESS' },
 { __typename: 'CheckRun', name: 'Analyze (javascript-typescript)', conclusion: 'SUCCESS' },
 { __typename: 'CheckRun', name: 'Analyze (rust)', conclusion: 'SUCCESS' },
 { __typename: 'CheckRun', name: 'actionlint', conclusion: 'SUCCESS' },
 { __typename: 'CheckRun', name: 'secret-scan', conclusion: 'SUCCESS' },
  ]);
  assert.deepEqual(evaluateRequiredChecks(requiredChecks, prRollupStates), {
 isGreen: true,
 missing: [],
 nonSuccess: [],
  });
});

test('main sync can identify the merged pull request that produced a main commit', () => {
  const pull = findMergedPullRequestForCommit([
 {
 number: 91,
 merged_at: '2026-03-30T04:00:00Z',
 merge_commit_sha: '3dc674eb7cb5d6bc55d29a503169b0b6f0fc0435',
 base: { ref: 'main' },
 },
 {
 number: 92,
 merged_at: '2026-03-30T17:13:22Z',
 merge_commit_sha: '0d629b8ff7b57e5235868e5c5fd641cae6020760',
 base: { ref: 'main' },
 },
  ], '0d629b8ff7b57e5235868e5c5fd641cae6020760', 'main');

  assert.equal(pull?.number, 92);
});

test('main sync launch agent plist runs Node on a fixed interval', () => {
  const plist = buildLaunchAgentPlist({
 label: 'com.bradleybond.crystalball.main-sync',
 nodePath: '/opt/homebrew/bin/node',
 syncScriptPath: '/Users/bradleybond/developer/crystalball/scripts/sync-main-to-mac.mjs',
 syncRoot: '/Users/bradleybond/.crystalball-main-sync',
 logDir: '/Users/bradleybond/.crystalball-main-sync/logs',
 intervalSeconds: 60,
  });

  assert.match(plist, /<string>com\.bradleybond\.crystalball\.main-sync<\/string>/);
  assert.match(plist, /<string>\/opt\/homebrew\/bin\/node<\/string>/);
  assert.match(plist, /sync-main-to-mac\.mjs/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>StartInterval<\/key>\s*<integer>60<\/integer>/);
  assert.match(plist, /<string>[^<]+\/\.cargo\/bin:\/opt\/homebrew\/bin:/);
  assert.doesNotMatch(plist, /<string>undefined<\/string>/);
});

test('main sync launch agent defaults to a five-minute poll interval', () => {
  assert.equal(DEFAULT_INTERVAL_SECONDS, 300);
});

test('main sync launch agent PATH includes the current user Cargo bin directory', () => {
  assert.equal(typeof mainSyncAgent.buildLaunchAgentEnvironmentPath, 'function');
  assert.equal(
    mainSyncAgent.buildLaunchAgentEnvironmentPath('/Users/example'),
    '/Users/example/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
  );
});

test('unchanged healthy installs take the idle path before checks and workspace cleanup', () => {
  assert.equal(determineSyncAction({
    installedSha: 'abc123',
    targetSha: 'abc123',
    installedHealthy: true,
  }), 'idle');
  assert.equal(determineSyncAction({
    installedSha: 'abc123',
    targetSha: 'abc123',
    installedHealthy: false,
  }), 'build');
  assert.equal(determineSyncAction({
    installedSha: 'old123',
    targetSha: 'new456',
    installedHealthy: true,
  }), 'build');

  const syncScript = readFileSync(syncScriptPath, 'utf8');
  const fetchIndex = syncScript.indexOf('await fetchTargetSha(options)');
  const idleIndex = syncScript.indexOf('determineSyncAction({', fetchIndex);
  const prepareIndex = syncScript.indexOf('await prepareClone(options, targetSha)');
  const checksIndex = syncScript.indexOf('await verifyRemoteChecks(options, targetSha)');

  assert.ok(fetchIndex >= 0, 'the sync should fetch the remote target SHA first');
  assert.ok(idleIndex > fetchIndex, 'the sync should decide whether the target changed after fetching');
  assert.ok(prepareIndex > idleIndex, 'workspace reset and clean must occur after the unchanged fast path');
  assert.ok(checksIndex > idleIndex, 'GitHub required-check queries must occur after the unchanged fast path');
});

test('main-to-mac sync uses a local clean clone instead of a GitHub self-hosted runner workflow', () => {
  const syncScript = readIfExists(syncScriptPath);

  assert.equal(
 existsSync(syncScriptPath),
 true,
 'sync-main-to-mac.mjs should exist as the local main-to-Mac delivery entrypoint',
  );
  assert.match(
 syncScript,
 /\.crystalball-main-sync/,
 'sync-main-to-mac should use a dedicated sync root outside the working tree',
  );
  assert.match(
 syncScript,
 /repo['"`]/,
 'sync-main-to-mac should keep a dedicated clean clone directory',
  );
  assert.match(
 syncScript,
 /\['npm', \['run', 'lockfile:check'\]\][\s\S]*\['npm', \['ci'\]\][\s\S]*\['npm', \['run', 'version:check'\]\][\s\S]*\['npm', \['run', 'typecheck:all'\]\][\s\S]*\['npm', \['run', 'build'\]\][\s\S]*\['npm', \['run', 'desktop:build:app:full'\]\]/,
 'sync-main-to-mac should rerun the hard verification stack and build a local app bundle before install',
  );
  assert.match(
 syncScript,
 /install-built-app\.mjs/,
 'sync-main-to-mac should install via the verified app installer script',
  );
  assert.match(
 syncScript,
 /commits\/\$\{sha\}\/pulls[\s\S]*statusCheckRollup/,
 'sync-main-to-mac should fall back to the merged pull request check rollup when the merge commit lacks required contexts',
  );
  assert.doesNotMatch(
 syncScript,
 /self-hosted/,
 'sync-main-to-mac should no longer rely on a GitHub self-hosted runner',
  );
});

test('main sync setup installs a launch agent that runs the sync script directly', () => {
  const setupScript = readIfExists(setupScriptPath);

  assert.equal(
 existsSync(setupScriptPath),
 true,
 'setup-main-sync-agent.mjs should exist to install the local launch agent',
  );
  assert.match(
 setupScript,
 /LaunchAgents/,
 'setup-main-sync-agent should write a macOS LaunchAgent plist',
  );
  assert.match(
 setupScript,
 /StartInterval/,
 'setup-main-sync-agent should configure periodic sync execution',
  );
  assert.match(
 setupScript,
 /sync-main-to-mac\.mjs/,
 'setup-main-sync-agent should launch the sync script directly',
  );
});

test('package scripts expose the supported main sync commands', () => {
  const packageJson = readFileSync(packageJsonPath, 'utf8');

  assert.match(
 packageJson,
 /"main-sync:run": "node scripts\/sync-main-to-mac\.mjs"/,
 'package.json should expose the main sync runner',
  );
  assert.match(
 packageJson,
 /"main-sync:setup": "node scripts\/setup-main-sync-agent\.mjs"/,
 'package.json should expose the launch agent bootstrap command',
  );
  assert.doesNotMatch(
 packageJson,
 /"runner:setup": "node scripts\/setup-self-hosted-runner\.mjs"/,
 'package.json should not keep the abandoned self-hosted runner setup command',
  );
});
