import assert from 'node:assert/strict';
import test from 'node:test';

import { isTrustedOAuthMessage } from '../s2-underground-helpers.ts';

const ORIGIN = 'http://127.0.0.1:46123';
const POPUP = { name: 'patreon-oauth' }; // stands in for the opened window
const GOOD_DATA = { type: 'patreon-oauth', ok: true, access_token: 'tok' };

test('accepts a message from the right origin, right source, right type', () => {
  assert.equal(
    isTrustedOAuthMessage({ origin: ORIGIN, source: POPUP, data: GOOD_DATA }, ORIGIN, POPUP),
    true,
  );
});

test('rejects a message from a foreign origin (token-injection guard)', () => {
  assert.equal(
    isTrustedOAuthMessage(
      { origin: 'https://evil.example', source: POPUP, data: GOOD_DATA },
      ORIGIN,
      POPUP,
    ),
    false,
  );
});

test('rejects a message from a different window/source even if origin matches', () => {
  const otherFrame = { name: 'attacker-frame' };
  assert.equal(
    isTrustedOAuthMessage({ origin: ORIGIN, source: otherFrame, data: GOOD_DATA }, ORIGIN, POPUP),
    false,
  );
});

test('rejects when the expected source is null (no popup opened yet)', () => {
  assert.equal(
    isTrustedOAuthMessage({ origin: ORIGIN, source: POPUP, data: GOOD_DATA }, ORIGIN, null),
    false,
  );
});

test('rejects a message without the patreon-oauth type tag', () => {
  assert.equal(
    isTrustedOAuthMessage(
      { origin: ORIGIN, source: POPUP, data: { ok: true, access_token: 'tok' } },
      ORIGIN,
      POPUP,
    ),
    false,
  );
});

test('rejects malformed / null data without throwing', () => {
  assert.equal(isTrustedOAuthMessage({ origin: ORIGIN, source: POPUP, data: null }, ORIGIN, POPUP), false);
  assert.equal(isTrustedOAuthMessage({ origin: ORIGIN, source: POPUP, data: 'oops' }, ORIGIN, POPUP), false);
});
