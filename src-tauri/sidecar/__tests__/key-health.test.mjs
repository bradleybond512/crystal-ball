import { strict as assert } from 'node:assert';
import test from 'node:test';

import { EXPECTED_API_KEYS, wmMissingKeys } from '../local-api-server.mjs';

test('key health counts UCDP credentials injected after sidecar startup', () => {
  assert.ok(EXPECTED_API_KEYS.includes('UCDP_API_TOKEN'));

  const missing = wmMissingKeys({ UCDP_API_TOKEN: 'configured' });

  assert.equal(missing.includes('UCDP_API_TOKEN'), false);
  assert.equal(EXPECTED_API_KEYS.length - missing.length, 1);
});
