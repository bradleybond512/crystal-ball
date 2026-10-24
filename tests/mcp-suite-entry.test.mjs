// Result-oracle tests use synthetic TAP strings, never pretend installed success.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFinalTap, runFixedSuite, SUITE_STAGES, validateStageResult } from './helpers/mcp-suite-entry.mjs';

function tap({ tests = 2, suites = 0, pass = tests, fail = 0, cancelled = 0, skipped = 0, todo = 0 } = {}) {
  return `TAP version 13\nok 1 - first\nok 2 - second\n1..2\n# tests ${tests}\n# suites ${suites}\n# pass ${pass}\n# fail ${fail}\n# cancelled ${cancelled}\n# skipped ${skipped}\n# todo ${todo}\n# duration_ms 12.5\n`;
}
function result(overrides = {}) {
  return { status: 0, signal: null, error: null, timedOut: false, aborted: false, overflowed: false,
    cleanupError: null, stdout: tap(), stderr: '', ...overrides };
}

test('a complete positive clean final top-level inner TAP summary is accepted and counted separately', () => {
  assert.deepEqual(validateStageResult(result()), { tests: 2, suites: 0, pass: 2, fail: 0, cancelled: 0, skipped: 0, todo: 0, duration_ms: 12.5 });
  const earlier = tap({ tests: 7 });
  assert.equal(parseFinalTap(earlier + tap({ tests: 3 })).tests, 3, 'only the final column-zero summary supplies counts');
});

test('exit-zero failed inner TAP is rejected rather than certifying the wrapper status', () => {
  assert.throws(() => validateStageResult(result({ stdout: tap({ pass: 1, fail: 1 }) })), /1 fail tests/);
});
test('exit-zero skipped-only, cancelled and todo inner TAP are rejected', () => {
  for (const name of ['skipped', 'cancelled', 'todo']) {
    assert.throws(() => validateStageResult(result({ stdout: tap({ tests: 1, pass: 0, [name]: 1 }) })), new RegExp(`1 ${name} tests`));
  }
});
test('empty, zero-test, nested-only and truncated summaries cannot certify execution', () => {
  const nested = tap().split('\n').map((line) => `    ${line}`).join('\n');
  for (const stdout of ['', tap({ tests: 0, pass: 0 }), nested, tap().replace('# duration_ms 12.5\n', '')]) {
    assert.throws(() => validateStageResult(result({ stdout })), /Missing|Truncated|positive/);
  }
});
test('malformed count, absent positive plan and trailing test records are rejected', () => {
  for (const stdout of [tap().replace('# pass 2', '# pass NaN'), tap().replace('1..2', '1..0'), tap() + 'ok 3 - late\n']) {
    assert.throws(() => validateStageResult(result({ stdout })), /Malformed|Missing|trailing/);
  }
});
test('nonzero status, signal and timeout override otherwise clean TAP', () => {
  assert.throws(() => validateStageResult(result({ status: 23 })), /exited 23/);
  assert.throws(() => validateStageResult(result({ status: null, signal: 'SIGTERM' })), /terminated by SIGTERM/);
  assert.throws(() => validateStageResult(result({ timedOut: true })), /timed out/);
});
test('launch errors, abort, output overflow and owned cleanup errors override clean TAP', () => {
  assert.throws(() => validateStageResult(result({ error: new Error('fixture ENOENT') })), /launch failed/);
  assert.throws(() => validateStageResult(result({ aborted: true })), /aborted/);
  assert.throws(() => validateStageResult(result({ overflowed: true })), /capture limit/);
  assert.throws(() => validateStageResult(result({ cleanupError: new Error('fixture group still alive') })), /cleanup failed/);
});
test('stdout or stderr TAP bailout remains red even with exit-zero passing summary', () => {
  assert.throws(() => validateStageResult(result({ stdout: 'Bail out! fixture\n' + tap() })), /bailout/);
  assert.throws(() => validateStageResult(result({ stderr: '  Bail out! descendant\n' })), /bailout/);
});
test('the suite map is finite and frozen and cannot launch arbitrary or inherited identifiers', async (t) => {
  assert.deepEqual(Object.keys(SUITE_STAGES), ['untrusted', 'companion', 'install-smoke', 'sidecar-remaining', 'health-contract']);
  assert.equal(SUITE_STAGES.untrusted.length, 2);
  assert.deepEqual(SUITE_STAGES.untrusted[0].slice(0, 3), ['--import', 'tsx', '--test']);
  assert.equal(SUITE_STAGES.untrusted[0].length, 6);
  assert.equal(SUITE_STAGES.untrusted[1].length, 6);
  assert.equal(SUITE_STAGES.companion[0].length, 7);
  assert.deepEqual(SUITE_STAGES['install-smoke'][0], ['--test', 'tools/mcp-server/__tests__/install-smoke.test.mjs']);
  assert.equal(SUITE_STAGES['sidecar-remaining'].length, 2);
  assert.equal(SUITE_STAGES['sidecar-remaining'][0].length, 33);
  assert.deepEqual(SUITE_STAGES['sidecar-remaining'][1].slice(0, 3), ['--import', 'tsx', '--test']);
  assert.equal(SUITE_STAGES['sidecar-remaining'][1].length, 5);
  assert.equal(SUITE_STAGES['health-contract'].length, 2);
  assert.deepEqual(SUITE_STAGES['health-contract'][0].slice(0, 2), ['--test', 'tests/sidecar-health-runtime.test.mjs']);
  assert.deepEqual(SUITE_STAGES['health-contract'][1].slice(0, 5), ['--import', 'tsx', '--import', './tests/panels/register-hook.mjs', '--test']);
  for (const stages of Object.values(SUITE_STAGES)) {
    assert.equal(Object.isFrozen(stages), true);
    for (const args of stages) assert.equal(Object.isFrozen(args), true);
  }
  for (const suite of ['__proto__', 'constructor', 'caller-test', '--npm-script']) await assert.rejects(runFixedSuite(suite, t), /Unknown fixed/);
});
