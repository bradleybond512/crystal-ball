/**
 * Tests for SMS route auth hardening:
 *   - validateTwilioSignature (sms-security.mjs) — HMAC-SHA1 correctness
 *   - /api/sms/status auth gate (integration)
 *   - /api/sms/command CSRF Origin rejection (integration)
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { createHmac } from 'node:crypto';

// ── Integration test helpers ────────────────────────────────────────────────

const TEST_TOKEN = 'sms-auth-test-token-xyz';
process.env.LOCAL_API_TOKEN ??= TEST_TOKEN;
import { createLocalApiServer } from '../local-api-server.mjs';

const silentLogger = { log() {}, warn() {}, error() {} };

async function withServer(fn) {
  const app = await createLocalApiServer({ port: 0, logger: silentLogger });
  const { port } = await app.start();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn(base);
  } finally {
    await app.close();
  }
}

// ── /api/sms/status — bearer-auth gate ──────────────────────────────────────

test('/api/sms/status: returns 401 without bearer token', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/sms/status`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.ok(body.error);
  });
});

test('/api/sms/status: returns 200 with valid bearer token', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/sms/status`, {
      headers: { authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.enabled === 'boolean');
    assert.ok(typeof body.uptimeMs === 'number');
  });
});

// ── /api/sms/command — CSRF Origin rejection ────────────────────────────────

test('/api/sms/command: rejects request with Origin header and no bearer token (CSRF)', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/sms/command`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'origin': 'http://evil.example.com',
      },
      body: JSON.stringify({ from: '+15551234567', body: 'STATUS' }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.ok(body.error);
  });
});

test('/api/sms/command: allows request with Origin header when bearer token is valid', async () => {
  await withServer(async (base) => {
    // Trusted local caller (bearer token) bypasses CSRF check;
    // SMS is disabled by default so the next gate returns 503.
    const res = await fetch(`${base}/api/sms/command`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'origin': 'http://127.0.0.1',
        'authorization': `Bearer ${process.env.LOCAL_API_TOKEN}`,
      },
      body: JSON.stringify({ from: '+15551234567', body: 'STATUS' }),
    });
    // 503 means it passed CSRF and reached the enabled check (SMS disabled by default)
    assert.equal(res.status, 503);
  });
});

test('/api/sms/command: allows request with no Origin header (Twilio webhook pattern)', async () => {
  await withServer(async (base) => {
    // No Origin header — should reach the enabled check, not be blocked by CSRF
    const res = await fetch(`${base}/api/sms/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: '+15551234567', body: 'STATUS' }),
    });
    // 503 means it passed CSRF and reached the enabled check (SMS disabled by default)
    assert.equal(res.status, 503);
  });
});

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
