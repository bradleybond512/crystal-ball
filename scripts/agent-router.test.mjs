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

test('routes trivial documentation work to the mechanical engineer', () => {
  const result = route('fix a typo in the README');

  assert.equal(result.tier, 'mechanical');
  assert.deepEqual(result.agents, ['mechanical_engineer']);
  assert.deepEqual(result.targeted_checks, []);
});

test('does not treat substrings inside documentation words as domains', () => {
  for (const request of [
    'update capitalization in README',
    'fix the roadmap documentation',
    'correct package documentation',
  ]) {
    const result = route(request);
    assert.equal(result.tier, 'mechanical', request);
    assert.deepEqual(result.agents, ['mechanical_engineer'], request);
  }
});

test('never lets documentation wording downgrade substantive security work', () => {
  const result = route('Document and fix Tauri secret permissions');

  assert.equal(result.tier, 'high_assurance');
  assert.ok(result.agents.includes('tauri_security_engineer'));
  assert.ok(!result.agents.includes('mechanical_engineer'));
});

test('routes package metadata changes through high assurance', () => {
  const result = route('Format package.json');

  assert.equal(result.tier, 'high_assurance');
  assert.ok(result.agents.includes('release_engineer'));
});
