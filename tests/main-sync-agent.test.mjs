import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import * as mainSyncAgent from '../scripts/setup-main-sync-agent.mjs';
import * as syncMainToMac from '../scripts/sync-main-to-mac.mjs';
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

test('main sync accepts only the supported Node 22 major', () => {
  assert.equal(typeof syncMainToMac.assertSupportedMainSyncNode, 'function');
  assert.doesNotThrow(() => syncMainToMac.assertSupportedMainSyncNode('22.23.1'));
  for (const version of ['21.7.3', '23.0.0', '26.3.0']) {
    assert.throws(
      () => syncMainToMac.assertSupportedMainSyncNode(version),
      /Node 22 is required/,
    );
  }
});

test('main sync pins npm and subprocess PATH to the selected Node toolchain', () => {
  assert.equal(typeof syncMainToMac.buildMainSyncToolchain, 'function');
  const toolchain = syncMainToMac.buildMainSyncToolchain(
    '/opt/homebrew/Cellar/node@22/22.23.1/bin/node',
    {
      TOKEN: 'preserved',
      PATH: '/Users/example/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    },
  );

  assert.equal(
    toolchain.npmPath,
    '/opt/homebrew/Cellar/node@22/22.23.1/bin/npm',
  );
  assert.equal(
    toolchain.env.PATH,
    '/opt/homebrew/Cellar/node@22/22.23.1/bin:/Users/example/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
  );
  assert.equal(toolchain.env.TOKEN, 'preserved');
});

test('main sync rejects ambiguous toolchain paths and empty subprocess PATH values', () => {
  assert.throws(
    () => syncMainToMac.buildMainSyncToolchain('node', { PATH: '/usr/bin:/bin' }),
    /absolute Node executable path/,
  );
  assert.throws(
    () => syncMainToMac.buildMainSyncToolchain('/opt/node/bin/node', {}),
    /non-empty PATH/,
  );
});

test('main sync rejects a selected Node toolchain without an executable sibling npm', async () => {
  assert.equal(typeof syncMainToMac.validatePinnedNodeToolchain, 'function');
  await assert.rejects(
    syncMainToMac.validatePinnedNodeToolchain('/tmp/ux017-missing-node/bin/node'),
    /executable npm sibling/,
  );
});

test('main sync CLI records failure before touching the repository when the pinned toolchain is invalid', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'crystalball-main-sync-toolchain-'));
  const fakeBin = path.join(fixtureRoot, 'bin');
  const fakeLib = path.join(fixtureRoot, 'lib');
  const fakeNode = path.join(fakeBin, 'node');
  const syncRoot = path.join(fixtureRoot, 'sync-state');
  const repoDir = path.join(syncRoot, 'repo');
  const repoMarker = path.join(repoDir, 'unchanged.txt');
  const statusFile = path.join(syncRoot, 'status.json');
  mkdirSync(fakeBin);
  mkdirSync(fakeLib);
  mkdirSync(repoDir, { recursive: true });
  copyFileSync(process.execPath, fakeNode);
  chmodSync(fakeNode, 0o755);
  writeFileSync(repoMarker, 'unchanged\n');
  writeFileSync(statusFile, `${JSON.stringify({ phase: 'installed', targetSha: 'prior-success' }, null, 2)}\n`);
  const sourceLib = path.resolve(path.dirname(process.execPath), '..', 'lib');
  for (const name of readdirSync(sourceLib).filter((entry) => /^libnode.*\.dylib$/.test(entry))) {
    copyFileSync(path.join(sourceLib, name), path.join(fakeLib, name));
  }

  try {
    const result = spawnSync(fakeNode, [syncScriptPath, '--sync-root', syncRoot], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /no executable npm sibling/);
    const status = JSON.parse(readFileSync(statusFile, 'utf8'));
    assert.equal(status.phase, 'failed', 'invalid toolchains must replace stale success with a failed status');
    assert.match(status.error, /no executable npm sibling/);
    assert.equal(readFileSync(repoMarker, 'utf8'), 'unchanged\n');
    assert.deepEqual(readdirSync(repoDir), ['unchanged.txt'], 'validation failure must not mutate the repository');
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('all main sync verification commands use the pinned npm path and environment', () => {
  const calls = [];
  const toolchain = syncMainToMac.buildMainSyncToolchain(
    '/opt/homebrew/Cellar/node@22/22.23.1/bin/node',
    { PATH: '/Users/example/.cargo/bin:/usr/bin:/bin' },
  );

  syncMainToMac.runVerificationAndBuild('/tmp/main-sync-repo', toolchain, (...args) => calls.push(args));

  assert.equal(calls.length, syncMainToMac.NPM_VERIFICATION_COMMANDS.length);
  for (const [index, [command, args, options]] of calls.entries()) {
    assert.equal(command, '/opt/homebrew/Cellar/node@22/22.23.1/bin/npm');
    assert.deepEqual(args, syncMainToMac.NPM_VERIFICATION_COMMANDS[index]);
    assert.equal(options.cwd, '/tmp/main-sync-repo');
    assert.match(options.env.PATH, /^\/opt\/homebrew\/Cellar\/node@22\/22\.23\.1\/bin:/);
    assert.match(options.env.PATH, /\/Users\/example\/\.cargo\/bin/);
  }
});

test('main sync setup validates Node before replacing the LaunchAgent plist', () => {
  const setupScript = readFileSync(setupScriptPath, 'utf8');
  const mainIndex = setupScript.indexOf('async function main()');
  const guardIndex = setupScript.indexOf('assertSupportedMainSyncNode(', mainIndex);
  const installIndex = setupScript.indexOf('await installLaunchAgent(options)', mainIndex);

  assert.ok(guardIndex > mainIndex, 'setup should validate its Node runtime in main');
  assert.ok(installIndex > guardIndex, 'setup should validate Node before writing the plist');
  assert.doesNotMatch(
    setupScript,
    /envPath:\s*toolchain\.env\.PATH/,
    'the LaunchAgent PATH should remain Cargo-first; only npm subprocesses are Node-first',
  );
});

test('all main sync npm verification and build commands use the pinned toolchain', () => {
  assert.deepEqual(syncMainToMac.NPM_VERIFICATION_COMMANDS, [
    ['run', 'lockfile:check'],
    ['ci'],
    ['run', 'version:check'],
    ['run', 'typecheck:all'],
    ['run', 'build'],
    ['run', 'desktop:build:app:full'],
  ]);

  const syncScript = readFileSync(syncScriptPath, 'utf8');
  assert.match(
    syncScript,
    /run\(toolchain\.npmPath, args, \{ cwd: repoDir, env: toolchain\.env \}\)/,
    'every npm stage should execute through the pinned npm path and environment',
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
 /\['run', 'lockfile:check'\][\s\S]*\['ci'\][\s\S]*\['run', 'version:check'\][\s\S]*\['run', 'typecheck:all'\][\s\S]*\['run', 'build'\][\s\S]*\['run', 'desktop:build:app:full'\]/,
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
