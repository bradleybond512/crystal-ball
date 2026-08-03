import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import * as mainSyncSetup from '../scripts/setup-main-sync-agent.mjs';
import {
  buildSyncPaths,
  collectCheckStates,
  collectStatusCheckRollupStates,
  evaluateRequiredChecks,
  findMergedPullRequestForCommit,
} from '../scripts/sync-main-to-mac.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const syncScriptPath = path.join(repoRoot, 'scripts', 'sync-main-to-mac.mjs');
const setupScriptPath = path.join(repoRoot, 'scripts', 'setup-main-sync-agent.mjs');
const packageJsonPath = path.join(repoRoot, 'package.json');
const { buildLaunchAgentPlist } = mainSyncSetup;

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

test('main sync required Node major matches the repository runtime policy', () => {
  const configuredMajor = Number.parseInt(
 readFileSync(path.join(repoRoot, '.node-version'), 'utf8').trim(),
 10,
  );
  assert.equal(mainSyncSetup.REQUIRED_NODE_MAJOR, configuredMajor);
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

test('main sync selects a stable Node 22 launcher instead of a Homebrew Cellar path', () => {
  assert.equal(typeof mainSyncSetup.buildStableNodeCandidates, 'function');
  assert.equal(typeof mainSyncSetup.selectStableNodePath, 'function');

  const candidates = mainSyncSetup.buildStableNodeCandidates({
 execPath: '/opt/homebrew/Cellar/node@22/22.23.1/bin/node',
 envPath: '/Users/test-user/bin:/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/opt/node@22/bin:/usr/bin:/bin',
  });
  assert.ok(candidates.includes('/opt/homebrew/opt/node@22/bin/node'));
  assert.equal(candidates.some(candidate => candidate.includes('/Cellar/')), false);
  assert.equal(candidates.includes('/Users/test-user/bin/node'), false);

  const selected = mainSyncSetup.selectStableNodePath(candidates, candidate => (
 candidate === '/opt/homebrew/opt/node@22/bin/node' ? 22 : 26
  ));
  assert.equal(selected, '/opt/homebrew/opt/node@22/bin/node');
});

test('main sync refuses to install without a compatible stable Node launcher', () => {
  assert.equal(typeof mainSyncSetup.selectStableNodePath, 'function');
  assert.throws(
 () => mainSyncSetup.selectStableNodePath(
 ['/opt/homebrew/bin/node', '/usr/local/bin/node'],
 () => 26,
 ),
 /stable Node 22 executable/,
  );
});

test('main sync launch PATH contains only stable tool directories', () => {
  assert.equal(typeof mainSyncSetup.buildLaunchAgentPath, 'function');

  const launchPath = mainSyncSetup.buildLaunchAgentPath(
 '/opt/homebrew/opt/node@22/bin/node',
 '/Users/test-user',
  );
  assert.deepEqual(launchPath.split(':'), [
 '/opt/homebrew/opt/node@22/bin',
 '/opt/homebrew/bin',
 '/opt/homebrew/sbin',
 '/usr/local/bin',
 '/usr/bin',
 '/bin',
 '/usr/sbin',
 '/sbin',
 '/Users/test-user/.cargo/bin',
  ]);
  assert.doesNotMatch(launchPath, /Cellar|plugins|unknown\/bin/);
});

test('main sync launch agent plist runs validated Node on a fixed interval', () => {
  const plist = buildLaunchAgentPlist({
 label: 'com.bradleybond.crystalball.main-sync&test',
 nodePath: '/opt/homebrew/opt/node@22/bin/node',
 syncScriptPath: '/Users/bradleybond/developer/crystalball/scripts/sync-main-to-mac<&>.mjs',
 syncRoot: '/Users/bradleybond/.crystalball-main-sync<&>',
 logDir: '/Users/bradleybond/.crystalball-main-sync/logs<&>',
 intervalSeconds: 60,
 envPath: '/opt/homebrew/opt/node@22/bin:/usr/bin:/bin',
  });

  assert.match(plist, /<string>com\.bradleybond\.crystalball\.main-sync&amp;test<\/string>/);
  assert.match(plist, /<string>\/opt\/homebrew\/opt\/node@22\/bin\/node<\/string>/);
  assert.match(plist, /sync-main-to-mac&lt;&amp;&gt;\.mjs/);
  assert.doesNotMatch(plist, /<string>[^<]*<&/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>StartInterval<\/key>\s*<integer>60<\/integer>/);
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
