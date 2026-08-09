import test from 'node:test';
import assert from 'node:assert/strict';

import { runSafeguardDemo } from '../safeguard-demo.mjs';

test('safeguard demo is synthetic, read-only, deterministic, and fail-closed', () => {
  const access = [];
  const options = {
    network: () => access.push('network'),
    readSecret: () => access.push('secret'),
    readState: () => access.push('state'),
    writeState: () => access.push('write'),
  };

  const first = runSafeguardDemo(options);
  const second = runSafeguardDemo(options);
  assert.deepEqual(first, second);
  assert.deepEqual(access, []);
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.synthetic, true);
  assert.equal(first.readOnly, true);
  assert.equal(first.passed, true);
  assert.deepEqual(first.checks.map((check) => check.code), [
    'quarantine_blocks_derived',
    'direct_source_remains_available',
    'raw_files_denied',
    'secrets_denied',
    'mutation_denied',
    'network_denied',
  ]);
  assert.ok(first.checks.every((check) => check.passed));
});
