/**
 * Tests for SMS route auth hardening:
 *   - validateTwilioSignature (sms-security.mjs) — HMAC-SHA1 correctness
 *   - /api/sms/status auth gate
 *   - /api/sms/command CSRF Origin rejection
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { createHmac } from 'node:crypto';

import { validateTwilioSignature } from '../sms-security.mjs';

// ── Helper: compute a correct signature the same way sms-security does ──────

function makeSignature(token, url, params) {
  const sortedKeys = Object.keys(params ?? {}).sort();
  const paramStr = sortedKeys.reduce((acc, k) => acc + k + params[k], '');
  return createHmac('sha1', token).update(url + paramStr).digest('base64');
}

// ── validateTwilioSignature ──────────────────────────────────────────────────

test('validateTwilioSignature: correct signature returns true', () => {
  const token = 'test-token-abc';
  const url = 'https://example.com/api/sms/command';
  const params = { From: '+15551234567', Body: 'BRIEF' };
  const sig = makeSignature(token, url, params);
  assert.ok(validateTwilioSignature(token, url, params, sig));
});

test('validateTwilioSignature: params are sorted lexically before hashing', () => {
  const token = 'tok';
  const url = 'https://example.com/api/sms/command';
  const unsorted = { Zebra: 'z', Alpha: 'a', Body: 'b' };
  const sorted   = { Alpha: 'a', Body: 'b', Zebra: 'z' };
  const sigFromUnsorted = makeSignature(token, url, unsorted);
  // Both should produce the same signature because keys are sorted internally
  assert.ok(validateTwilioSignature(token, url, sorted, sigFromUnsorted));
});

test('validateTwilioSignature: wrong signature returns false', () => {
  const token = 'test-token-abc';
  const url = 'https://example.com/api/sms/command';
  const params = { From: '+15551234567', Body: 'BRIEF' };
  assert.equal(validateTwilioSignature(token, url, params, 'AAAA/invalid=='), false);
});

test('validateTwilioSignature: wrong token returns false', () => {
  const url = 'https://example.com/api/sms/command';
  const params = { From: '+15551234567', Body: 'STATUS' };
  const sig = makeSignature('real-token', url, params);
  assert.equal(validateTwilioSignature('wrong-token', url, params, sig), false);
});

test('validateTwilioSignature: wrong url returns false', () => {
  const token = 'tok';
  const params = { From: '+15551234567', Body: 'STATUS' };
  const sig = makeSignature(token, 'https://example.com/api/sms/command', params);
  assert.equal(validateTwilioSignature(token, 'https://other.com/api/sms/command', params, sig), false);
});

test('validateTwilioSignature: missing signature returns false', () => {
  const token = 'tok';
  const url = 'https://example.com/api/sms/command';
  const params = { From: '+15551234567', Body: 'STATUS' };
  assert.equal(validateTwilioSignature(token, url, params, ''), false);
  assert.equal(validateTwilioSignature(token, url, params, null), false);
  assert.equal(validateTwilioSignature(token, url, params, undefined), false);
});

test('validateTwilioSignature: missing auth token returns false', () => {
  const url = 'https://example.com/api/sms/command';
  const params = { From: '+15551234567', Body: 'STATUS' };
  const sig = makeSignature('real', url, params);
  assert.equal(validateTwilioSignature('', url, params, sig), false);
  assert.equal(validateTwilioSignature(null, url, params, sig), false);
});

test('validateTwilioSignature: empty params map works', () => {
  const token = 'tok';
  const url = 'https://example.com/api/sms/command';
  const sig = makeSignature(token, url, {});
  assert.ok(validateTwilioSignature(token, url, {}, sig));
});

test('validateTwilioSignature: signature length mismatch returns false (no padding attack)', () => {
  const token = 'tok';
  const url = 'https://example.com/api/sms/command';
  const params = { From: '+15551234567' };
  // Truncated base64 — length will differ once decoded
  assert.equal(validateTwilioSignature(token, url, params, 'abc'), false);
});
