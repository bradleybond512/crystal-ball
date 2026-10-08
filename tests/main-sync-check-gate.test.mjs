// R4-SEC-003 / R4-SEC-009: main-sync's install gate must not weaken when branch
// protection's required-check list is emptied or shrunk, must see check runs
// beyond the first API page, and must judge a re-run by its newest attempt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  PINNED_REQUIRED_CHECKS,
  buildRequiredChecks,
  collectCheckStates,
  collectStatusCheckRollupStates,
  evaluateRequiredChecks,
  parseCheckRunLines,
  verifyRemoteChecks,
} from '../scripts/sync-main-to-mac.mjs';

const SHA = 'a'.repeat(40);
const OPTIONS = { repoSlug: 'owner/repo', branch: 'main' };

function successRun(name, id, completedAt = '2026-09-30T10:00:00Z') {
  return { id, name, status: 'completed', conclusion: 'success', completed_at: completedAt };
}

/**
 * Fake `gh`: answers the four calls verifyRemoteChecks makes. `checkRunPages`
 * is an array of pages; with --paginate + --jq '.check_runs[]' gh prints every
 * run from every page as one JSON object per line, so the fake does the same,
 * and returns only page 1 if --paginate is missing.
 */
function fakeGh({ remoteChecks, checkRunPages, statuses = [], pulls = [], pr = null }) {
  const calls = [];
  const run = (command, args) => {
    assert.equal(command, 'gh');
    calls.push(args);
    const path = args.find((arg) => typeof arg === 'string' && arg.startsWith('repos/'));
    if (args[0] === 'pr') return JSON.stringify(pr);
    if (path.endsWith('/protection/required_status_checks')) {
      return JSON.stringify({ checks: remoteChecks.map((context) => ({ context })) });
    }
    if (path.includes('/check-runs')) {
      const pages = args.includes('--paginate') ? checkRunPages : checkRunPages.slice(0, 1);
      if (args.includes('--jq')) return pages.flat().map((entry) => JSON.stringify(entry)).join('\n');
      return JSON.stringify({ check_runs: pages[0] ?? [] });
    }
    if (path.includes('/status')) return JSON.stringify({ statuses });
    if (path.endsWith('/pulls')) return JSON.stringify(pulls);
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  return { run, calls };
}

function allPinnedGreen(startId = 1) {
  return PINNED_REQUIRED_CHECKS.map((name, index) => successRun(name, startId + index));
}

test('the pinned minimum is exactly the approved set and leaves out the advisory audits', () => {
  assert.deepEqual([...PINNED_REQUIRED_CHECKS], [
    'typecheck', 'secret-scan', 'actionlint', 'integrity-checks', 'release-doctor', 'cross-agent-review',
    'targeted-tests', 'Semgrep static analysis', 'cargo-deny', 'sidecar-http-guardrail', 'ESLint', 'static-lint',
    'smoke',
  ]);
  assert.ok(Object.isFrozen(PINNED_REQUIRED_CHECKS));
  for (const advisory of ['npm-audit', 'cargo-audit']) {
    assert.ok(!PINNED_REQUIRED_CHECKS.includes(advisory), `${advisory} must not be pinned`);
  }
});

test('buildRequiredChecks unions pinned and remote checks and reports gaps', () => {
  assert.deepEqual(buildRequiredChecks([]), {
    requiredChecks: [...PINNED_REQUIRED_CHECKS],
    remoteEmpty: true,
    missingFromRemote: [...PINNED_REQUIRED_CHECKS],
  });
  assert.deepEqual(buildRequiredChecks(undefined).requiredChecks, [...PINNED_REQUIRED_CHECKS]);

  const extra = buildRequiredChecks(['typecheck', 'release-integrity', '', null]);
  assert.deepEqual(extra.requiredChecks, [...PINNED_REQUIRED_CHECKS, 'release-integrity']);
  assert.equal(extra.remoteEmpty, false);
  assert.ok(!extra.missingFromRemote.includes('typecheck'));
  assert.ok(extra.missingFromRemote.includes('smoke'));
});

test('an empty protection list cannot make an unchecked commit look green', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const gh = fakeGh({ remoteChecks: [], checkRunPages: [[]] });
  await assert.rejects(
    verifyRemoteChecks(OPTIONS, SHA, gh.run),
    (error) => {
      assert.match(error.message, /Required GitHub checks are not green/);
      for (const name of PINNED_REQUIRED_CHECKS) assert.ok(error.message.includes(name), name);
      return true;
    },
  );
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /lists no required checks; enforcing the pinned minimum set/);
});

test('a protection list that drops a pinned check still requires it', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const remoteChecks = PINNED_REQUIRED_CHECKS.filter((name) => name !== 'secret-scan');
  const runs = allPinnedGreen().filter((run) => run.name !== 'secret-scan');
  const gh = fakeGh({ remoteChecks, checkRunPages: [runs] });
  await assert.rejects(verifyRemoteChecks(OPTIONS, SHA, gh.run), /missing \[secret-scan\]/);
  assert.match(warn.mock.calls[0].arguments[0], /does not require secret-scan; main-sync still does/);
});

test('a commit with every pinned and remote check green verifies from the commit', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const gh = fakeGh({
    remoteChecks: [...PINNED_REQUIRED_CHECKS, 'release-integrity'],
    checkRunPages: [[...allPinnedGreen(), successRun('release-integrity', 99)]],
  });
  const result = await verifyRemoteChecks(OPTIONS, SHA, gh.run);
  assert.equal(result.verificationSource, 'commit');
  assert.deepEqual(result.requiredChecks, [...PINNED_REQUIRED_CHECKS, 'release-integrity']);
});

test('check runs on a later API page are read (pagination)', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const filler = Array.from({ length: 100 }, (_, index) => successRun(`Analyze shard ${index}`, 1000 + index));
  const pinned = allPinnedGreen();
  const gh = fakeGh({
    remoteChecks: [...PINNED_REQUIRED_CHECKS],
    checkRunPages: [filler, pinned],
  });
  const result = await verifyRemoteChecks(OPTIONS, SHA, gh.run);
  assert.equal(result.verificationSource, 'commit');

  const checkRunCall = gh.calls.find((args) => args.some((arg) => String(arg).includes('/check-runs')));
  assert.ok(checkRunCall.includes('--paginate'));
  assert.ok(checkRunCall.some((arg) => String(arg).endsWith('/check-runs?per_page=100')));
  assert.deepEqual(checkRunCall.slice(-2), ['--jq', '.check_runs[]']);
});

test('parseCheckRunLines reads one JSON object per line and skips blank lines', () => {
  assert.deepEqual(parseCheckRunLines('{"name":"a"}\n\n{"name":"b"}\n'), [{ name: 'a' }, { name: 'b' }]);
  assert.deepEqual(parseCheckRunLines(''), []);
  assert.deepEqual(parseCheckRunLines(undefined), []);
  assert.throws(() => parseCheckRunLines('{"name":'), SyntaxError);
});

test('the newest check run decides, whichever order the API lists them in', () => {
  const failedFirst = { id: 1, name: 'smoke', conclusion: 'failure', completed_at: '2026-09-30T09:00:00Z' };
  const rerunGreen = { id: 2, name: 'smoke', conclusion: 'success', completed_at: '2026-09-30T10:00:00Z' };
  assert.equal(collectCheckStates([failedFirst, rerunGreen], { statuses: [] }).get('smoke'), 'success');
  assert.equal(collectCheckStates([rerunGreen, failedFirst], { statuses: [] }).get('smoke'), 'success');

  const greenFirst = { ...failedFirst, conclusion: 'success' };
  const rerunRed = { ...rerunGreen, conclusion: 'failure' };
  assert.equal(collectCheckStates({ check_runs: [greenFirst, rerunRed] }, { statuses: [] }).get('smoke'), 'failure');
  assert.equal(collectCheckStates({ check_runs: [rerunRed, greenFirst] }, { statuses: [] }).get('smoke'), 'failure');

  const inProgress = { id: 3, name: 'smoke', status: 'in_progress', conclusion: null, started_at: '2026-09-30T11:00:00Z' };
  assert.equal(collectCheckStates([greenFirst, inProgress], { statuses: [] }).get('smoke'), 'in_progress');
});

test('equal timestamps fall back to the higher run id', () => {
  const at = '2026-09-30T10:00:00Z';
  const older = { id: 5, name: 'typecheck', conclusion: 'failure', completed_at: at };
  const newer = { id: 6, name: 'typecheck', conclusion: 'success', completed_at: at };
  assert.equal(collectCheckStates([newer, older], { statuses: [] }).get('typecheck'), 'success');
  assert.equal(collectCheckStates([older, newer], { statuses: [] }).get('typecheck'), 'success');
});

test('the newest commit status and PR rollup entry decide too', () => {
  const statuses = [
    { context: 'release-doctor', state: 'failure', updated_at: '2026-09-30T09:00:00Z' },
    { context: 'release-doctor', state: 'success', updated_at: '2026-09-30T10:00:00Z' },
  ];
  assert.equal(collectCheckStates([], { statuses }).get('release-doctor'), 'success');
  assert.equal(collectCheckStates([], { statuses: statuses.toReversed() }).get('release-doctor'), 'success');

  const rollup = [
    { __typename: 'CheckRun', name: 'ESLint', conclusion: 'SUCCESS', completedAt: '2026-09-30T09:00:00Z' },
    { __typename: 'CheckRun', name: 'ESLint', conclusion: 'FAILURE', completedAt: '2026-09-30T10:00:00Z' },
  ];
  assert.equal(collectStatusCheckRollupStates(rollup).get('ESLint'), 'failure');
  assert.equal(collectStatusCheckRollupStates(rollup.toReversed()).get('ESLint'), 'failure');
});

test('a stale failure no longer blocks once the re-run is green', () => {
  const states = collectCheckStates([
    { id: 1, name: 'typecheck', conclusion: 'failure', completed_at: '2026-09-30T09:00:00Z' },
    { id: 2, name: 'typecheck', conclusion: 'success', completed_at: '2026-09-30T10:00:00Z' },
  ], { statuses: [] });
  assert.deepEqual(evaluateRequiredChecks(['typecheck'], states), { isGreen: true, missing: [], nonSuccess: [] });
});

test('the merged-PR fallback is judged against the pinned set as well', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const rollup = PINNED_REQUIRED_CHECKS
    .filter((name) => name !== 'cargo-deny')
    .map((name) => ({ __typename: 'CheckRun', name, conclusion: 'SUCCESS' }));
  const gh = fakeGh({
    remoteChecks: [],
    checkRunPages: [[]],
    pulls: [{ number: 7, merged_at: '2026-09-30T10:00:00Z', merge_commit_sha: SHA, base: { ref: 'main' } }],
    pr: { number: 7, mergedAt: '2026-09-30T10:00:00Z', baseRefName: 'main', mergeCommit: { oid: SHA }, statusCheckRollup: rollup },
  });
  await assert.rejects(verifyRemoteChecks(OPTIONS, SHA, gh.run), /PR #7: missing \[cargo-deny\]/);
});

function responseOrders(a, b) {
  return [[a, b], [b, a]];
}

function threeOrders(a, b, c) {
  return [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];
}

test('a newer queued check run blocks an older completed success in both response orders', () => {
  const completed = successRun('smoke', 10);
  const queued = { id: 11, name: 'smoke', status: 'queued', conclusion: null, started_at: null, completed_at: null };
  for (const runs of responseOrders(completed, queued)) {
    assert.equal(collectCheckStates(runs, { statuses: [] }).get('smoke'), 'queued');
  }
});

test('overlapping attempts use identity when available and block ambiguous clocks without identity', () => {
  const completed = successRun('smoke', 10);
  const active = { id: 11, name: 'smoke', status: 'in_progress', started_at: '2026-09-30T09:30:00Z' };
  for (const runs of responseOrders(completed, active)) {
    assert.equal(collectCheckStates(runs, { statuses: [] }).get('smoke'), 'in_progress');
  }
  delete completed.id;
  delete active.id;
  for (const runs of responseOrders(completed, active)) {
    assert.equal(collectCheckStates(runs, { statuses: [] }).get('smoke'), 'unknown');
  }
});

test('equal completion timestamps compare start times before opposing IDs', () => {
  const old = { ...successRun('smoke', 50), started_at: '2026-09-30T08:00:00Z' };
  const newer = { ...successRun('smoke', 49), conclusion: 'failure', started_at: '2026-09-30T09:00:00Z' };
  for (const runs of responseOrders(old, newer)) {
    assert.equal(collectCheckStates(runs, { statuses: [] }).get('smoke'), 'failure');
  }
});

test('determinate completion timestamps retain priority before opposing IDs', () => {
  const old = { ...successRun('smoke', 50, '2026-09-30T09:00:00Z'), conclusion: 'failure' };
  const newer = successRun('smoke', 49);
  for (const runs of responseOrders(old, newer)) {
    assert.equal(collectCheckStates(runs, { statuses: [] }).get('smoke'), 'success');
  }
});

test('a queued rollup entry without identity or clocks cannot inherit a completed success', () => {
  const completed = { __typename: 'CheckRun', name: 'smoke', conclusion: 'SUCCESS', completedAt: '2026-09-30T10:00:00Z' };
  const queued = { __typename: 'CheckRun', name: 'smoke', status: 'QUEUED', conclusion: null };
  for (const rollup of responseOrders(completed, queued)) {
    assert.equal(collectStatusCheckRollupStates(rollup).get('smoke'), 'unknown');
  }
});

test('a no-ID active run starting after the old completion is determinately newer', () => {
  const completed = { name: 'smoke', conclusion: 'success', completed_at: '2026-09-30T10:00:00Z' };
  const active = { name: 'smoke', status: 'in_progress', started_at: '2026-09-30T11:00:00Z' };
  for (const runs of responseOrders(completed, active)) {
    assert.equal(collectCheckStates(runs, { statuses: [] }).get('smoke'), 'in_progress');
  }
});

test('three mixed-metadata attempts block consistently across all response permutations', () => {
  const completed = successRun('smoke', 10);
  const queued = { id: 11, name: 'smoke', status: 'queued' };
  const unorderable = { name: 'smoke', status: 'in_progress' };
  for (const runs of threeOrders(completed, queued, unorderable)) {
    assert.equal(collectCheckStates(runs, { statuses: [] }).get('smoke'), 'unknown');
  }
});

test('an unorderable pending attempt is not forgotten between ordered successes', () => {
  const old = successRun('smoke', 10);
  const newer = successRun('smoke', 11, '2026-09-30T11:00:00Z');
  const pending = { name: 'smoke', status: 'queued' };
  for (const runs of threeOrders(old, pending, newer)) {
    assert.equal(collectCheckStates(runs, { statuses: [] }).get('smoke'), 'unknown');
  }
});

test('a determinate newer success unblocks every obsolete attempt in all permutations', () => {
  const failed = { ...successRun('smoke', 10), conclusion: 'failure', started_at: '2026-09-30T08:00:00Z' };
  const active = { name: 'smoke', status: 'in_progress', started_at: '2026-09-30T09:00:00Z' };
  const success = { ...successRun('smoke', 12, '2026-09-30T12:00:00Z'), started_at: '2026-09-30T11:00:00Z' };
  for (const runs of threeOrders(failed, active, success)) {
    assert.equal(collectCheckStates(runs, { statuses: [] }).get('smoke'), 'success');
  }
});

test('conflicting states with indistinguishable metadata block in both response orders', () => {
  const completed = { name: 'smoke', conclusion: 'success', completed_at: '2026-09-30T10:00:00Z' };
  const failed = { ...completed, conclusion: 'failure' };
  for (const runs of responseOrders(completed, failed)) {
    assert.equal(collectCheckStates(runs, { statuses: [] }).get('smoke'), 'unknown');
  }
});

test('status updates tied in time compare creation times before IDs', () => {
  const old = { context: 'smoke', state: 'success', id: 50, updated_at: '2026-09-30T10:00:00Z', created_at: '2026-09-30T08:00:00Z' };
  const newer = { ...old, state: 'failure', id: 49, created_at: '2026-09-30T09:00:00Z' };
  for (const statuses of responseOrders(old, newer)) {
    assert.equal(collectCheckStates([], { statuses }).get('smoke'), 'failure');
  }
});

test('invalid clocks and nonpositive IDs do not establish a newer attempt', () => {
  const completed = { ...successRun('smoke', 0), completed_at: 'not-a-time' };
  const queued = { id: -1, name: 'smoke', status: 'queued', started_at: 'also-not-a-time' };
  for (const runs of responseOrders(completed, queued)) {
    assert.equal(collectCheckStates(runs, { statuses: [] }).get('smoke'), 'unknown');
  }
});

test('verification rejects a pinned check with a newer queued commit attempt', async () => {
  const gh = fakeGh({
    remoteChecks: [...PINNED_REQUIRED_CHECKS],
    checkRunPages: [[...allPinnedGreen(10), { id: 100, name: 'smoke', status: 'queued', started_at: null, completed_at: null }]],
  });
  await assert.rejects(verifyRemoteChecks(OPTIONS, SHA, gh.run), /smoke=queued/);
});

test('verification rejects an ambiguous queued attempt in the merged-PR rollup', async () => {
  const rollup = PINNED_REQUIRED_CHECKS.map(name => ({
    __typename: 'CheckRun', name, conclusion: 'SUCCESS', completedAt: '2026-09-30T10:00:00Z',
  }));
  rollup.push({ __typename: 'CheckRun', name: 'smoke', status: 'QUEUED', conclusion: null });
  const gh = fakeGh({
    remoteChecks: [...PINNED_REQUIRED_CHECKS], checkRunPages: [[]],
    pulls: [{ number: 7, merged_at: '2026-09-30T10:00:00Z', merge_commit_sha: SHA, base: { ref: 'main' } }],
    pr: { number: 7, mergedAt: '2026-09-30T10:00:00Z', baseRefName: 'main', mergeCommit: { oid: SHA }, statusCheckRollup: rollup },
  });
  await assert.rejects(verifyRemoteChecks(OPTIONS, SHA, gh.run), /PR #7: non-success \[smoke=unknown\]/);
});

// Every pinned check must report on every merged PR, or main-sync would block
// installs after any PR its workflow skips. A path filter (static-lint had one
// until R4-SEC-003) or a renamed job would do exactly that, so pin both.
const PINNED_CHECK_WORKFLOWS = {
  typecheck: 'typecheck.yml',
  'secret-scan': 'secret-scan.yml',
  actionlint: 'actionlint.yml',
  'integrity-checks': 'release-integrity.yml',
  'release-doctor': 'release-integrity.yml',
  'cross-agent-review': 'cross-agent-review.yml',
  'targeted-tests': 'targeted-tests.yml',
  'Semgrep static analysis': 'sast.yml',
  'cargo-deny': 'security-audit.yml',
  'sidecar-http-guardrail': 'security-audit.yml',
  ESLint: 'eslint.yml',
  'static-lint': 'lint.yml',
  smoke: 'smoke.yml',
};

function escapeRegExp(text) {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

test('every pinned check comes from a workflow that runs on every pull request', () => {
  assert.deepEqual(Object.keys(PINNED_CHECK_WORKFLOWS).toSorted(), [...PINNED_REQUIRED_CHECKS].toSorted());
  const workflowsDir = path.join(import.meta.dirname, '..', '.github', 'workflows');
  for (const [check, file] of Object.entries(PINNED_CHECK_WORKFLOWS)) {
    const text = readFileSync(path.join(workflowsDir, file), 'utf8');
    const name = escapeRegExp(check);
    const jobName = new RegExp(String.raw`^ {4}name: ['"]?${name}['"]?\s*$`, 'm');
    const jobId = new RegExp(String.raw`^ {2}${name}:\s*$`, 'm');
    assert.ok(jobName.test(text) || jobId.test(text), `${file} no longer defines the "${check}" job`);

    const triggers = /^on:\n([\s\S]*?)^\S/m.exec(text)?.[1] ?? '';
    assert.match(triggers, /^ {2}pull_request:/m, `${file} must run on pull_request for "${check}"`);
    assert.doesNotMatch(triggers, /paths(-ignore)?:/, `${file} must not path-filter "${check}"`);
  }
});
