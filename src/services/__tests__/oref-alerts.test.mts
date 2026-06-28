import assert from 'node:assert/strict';
import test from 'node:test';

import { isValidOrefAlertsResponse } from '../oref-alerts.ts';

// Round-5 audit: a 200 with a malformed body (alerts-less object / HTML) was cast
// `as OrefAlertsResponse` and cached before any validation, so the bad object was
// served from cache as a fresh "no rocket sirens" all-clear. This guard runs
// before the cache write.

test('isValidOrefAlertsResponse: accepts a well-formed response (incl. empty alerts)', () => {
  assert.equal(isValidOrefAlertsResponse({ configured: true, alerts: [], historyCount24h: 0, timestamp: 't' }), true);
  assert.equal(isValidOrefAlertsResponse({ alerts: [{ id: '1' }] }), true);
});

test('isValidOrefAlertsResponse: rejects a malformed 200 body', () => {
  assert.equal(isValidOrefAlertsResponse({}), false);                 // no alerts field
  assert.equal(isValidOrefAlertsResponse({ alerts: 'oops' }), false); // alerts not an array
  assert.equal(isValidOrefAlertsResponse({ alerts: null }), false);
  assert.equal(isValidOrefAlertsResponse('<html>error</html>'), false);
  assert.equal(isValidOrefAlertsResponse(null), false);
  assert.equal(isValidOrefAlertsResponse(undefined), false);
});
