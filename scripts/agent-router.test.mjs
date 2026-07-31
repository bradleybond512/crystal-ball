import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

function route(request) {
  return JSON.parse(execFileSync(
    process.execPath,
    ['scripts/agent-router.mjs', '--request', request],
    { encoding: 'utf8' },
  ));
}

test('does not route signal work to release engineering', () => {
  const result = route('add a calibrated correlation signal to the intelligence timeline');

  assert.ok(result.agents.includes('correlation_engineer'));
  assert.ok(result.agents.includes('prediction_engineer'));
  assert.ok(!result.agents.includes('release_engineer'));
});

test('routes signing and notarization work to release engineering', () => {
  const result = route('sign and notarize the macOS release');

  assert.ok(result.agents.includes('release_engineer'));
  assert.equal(result.human_design_approval, true);
});
