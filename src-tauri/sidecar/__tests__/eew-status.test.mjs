/**
 * Sidecar tests for the /api/eew-status route (Layer 8).
 *
 * Mirrors the seismic-globe-overlays.test.mjs pattern:
 *   - Pure unit test for the sanitizer
 *   - Integration test that spins the sidecar on an ephemeral port
 */
import { strict as assert } from 'node:assert';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

process.env.LOCAL_API_TOKEN ??= 'test-token-eew-status';

import {
  createLocalApiServer,
  isValidEewTier,
  sanitizeEewAlert,
} from '../local-api-server.mjs';

// ── Pure sanitizer tests ───────────────────────────────────────────────

const NOW = 1_745_000_000_000;

function validAlert(overrides = {}) {
  return {
    eventId: 'usgs:abc',
    tier: 'TIER_3_WARNING',
    reason: 'M6.5 — M≥6.5 anywhere',
    triggeredAt: NOW,
    ...overrides,
  };
}

test('isValidEewTier accepts all 5 tiers', () => {
  assert.ok(isValidEewTier('TIER_1_INFO'));
  assert.ok(isValidEewTier('TIER_2_WATCH'));
  assert.ok(isValidEewTier('TIER_3_WARNING'));
  assert.ok(isValidEewTier('TIER_4_SEVERE'));
  assert.ok(isValidEewTier('TIER_5_EXTREME'));
});

test('isValidEewTier rejects unknown tiers', () => {
  assert.equal(isValidEewTier('TIER_6_APOCALYPSE'), false);
  assert.equal(isValidEewTier(''), false);
  assert.equal(isValidEewTier(null), false);
  assert.equal(isValidEewTier(42), false);
});

test('sanitizeEewAlert accepts a valid alert', () => {
  const out = sanitizeEewAlert(validAlert());
  assert.equal(out.eventId, 'usgs:abc');
  assert.equal(out.tier, 'TIER_3_WARNING');
});

test('sanitizeEewAlert rejects null / non-object', () => {
  assert.equal(sanitizeEewAlert(null), null);
  assert.equal(sanitizeEewAlert(42), null);
});

test('sanitizeEewAlert rejects missing eventId', () => {
  assert.equal(sanitizeEewAlert(validAlert({ eventId: '' })), null);
});

test('sanitizeEewAlert rejects unknown tier', () => {
  assert.equal(sanitizeEewAlert(validAlert({ tier: 'FOO' })), null);
});

test('sanitizeEewAlert rejects non-finite triggeredAt', () => {
  assert.equal(sanitizeEewAlert(validAlert({ triggeredAt: Number.NaN })), null);
});

test('sanitizeEewAlert truncates long reason to 500 chars', () => {
  const out = sanitizeEewAlert(validAlert({ reason: 'X'.repeat(2000) }));
  assert.equal(out.reason.length, 500);
});

test('sanitizeEewAlert keeps upgradedFrom only when it is a valid tier', () => {
  const ok = sanitizeEewAlert(validAlert({ upgradedFrom: 'TIER_1_INFO' }));
  assert.equal(ok.upgradedFrom, 'TIER_1_INFO');
  const bad = sanitizeEewAlert(validAlert({ upgradedFrom: 'BOGUS' }));
  assert.equal(bad.upgradedFrom, undefined);
});

test('sanitizeEewAlert keeps imessageStatus only when in allowlist', () => {
  const ok = sanitizeEewAlert(validAlert({ imessageStatus: 'failed' }));
  assert.equal(ok.imessageStatus, 'failed');
  const bad = sanitizeEewAlert(validAlert({ imessageStatus: 'spammed' }));
  assert.equal(bad.imessageStatus, undefined);
});

// ── Sidecar integration tests ──────────────────────────────────────────

async function startSidecar() {
  const app = await createLocalApiServer({
    port: 0,
    apiDir: undefined,
    remoteBase: 'http://127.0.0.1:1',
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();
  return { base: `http://127.0.0.1:${port}`, async close() { await app.close(); } };
}

function httpJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {
      authorization: `Bearer ${process.env.LOCAL_API_TOKEN}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const req = httpRequest({
      hostname: u.hostname,
      port: u.port,
      method,
      path: u.pathname + u.search,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
        } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

test('GET before any POST returns empty available:false', async () => {
  const sidecar = await startSidecar();
  try {
    const res = await httpJson('GET', `${sidecar.base}/api/eew-status`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.activeAlerts, []);
    assert.equal(res.body.available, false);
    assert.equal(res.body.highestTier, null);
  } finally {
    await sidecar.close();
  }
});

test('POST then GET round-trips an alert payload', async () => {
  const sidecar = await startSidecar();
  try {
    const post = await httpJson('POST', `${sidecar.base}/api/eew-status`, {
      activeAlerts: [validAlert({ eventId: 'rt', tier: 'TIER_4_SEVERE' })],
      highestTier: 'TIER_4_SEVERE',
      lastEventId: 'rt',
      asOf: NOW,
    });
    assert.equal(post.status, 200);
    assert.equal(post.body.count, 1);

    const get = await httpJson('GET', `${sidecar.base}/api/eew-status`);
    assert.equal(get.body.available, true);
    assert.equal(get.body.activeAlerts.length, 1);
    assert.equal(get.body.activeAlerts[0].tier, 'TIER_4_SEVERE');
    assert.equal(get.body.highestTier, 'TIER_4_SEVERE');
    assert.equal(get.body.lastEventId, 'rt');
  } finally {
    await sidecar.close();
  }
});

test('POST drops malformed alerts, keeps valid ones', async () => {
  const sidecar = await startSidecar();
  try {
    const res = await httpJson('POST', `${sidecar.base}/api/eew-status`, {
      activeAlerts: [
        validAlert({ eventId: 'good-1' }),
        { eventId: '', tier: 'TIER_1_INFO', reason: '', triggeredAt: NOW },
        validAlert({ eventId: 'good-2', tier: 'BOGUS' }), // bad tier → dropped
        validAlert({ eventId: 'good-3' }),
      ],
      asOf: NOW,
    });
    assert.equal(res.body.count, 2);
    const get = await httpJson('GET', `${sidecar.base}/api/eew-status`);
    assert.deepEqual(get.body.activeAlerts.map((a) => a.eventId).sort(), ['good-1', 'good-3']);
  } finally {
    await sidecar.close();
  }
});

test('POST with non-array activeAlerts returns 400', async () => {
  const sidecar = await startSidecar();
  try {
    const res = await httpJson('POST', `${sidecar.base}/api/eew-status`, { activeAlerts: 'oops' });
    assert.equal(res.status, 400);
  } finally {
    await sidecar.close();
  }
});

test('POST with invalid highestTier coerces to null instead of rejecting', async () => {
  const sidecar = await startSidecar();
  try {
    const post = await httpJson('POST', `${sidecar.base}/api/eew-status`, {
      activeAlerts: [validAlert()],
      highestTier: 'BOGUS',
      asOf: NOW,
    });
    assert.equal(post.status, 200);
    const get = await httpJson('GET', `${sidecar.base}/api/eew-status`);
    assert.equal(get.body.highestTier, null);
  } finally {
    await sidecar.close();
  }
});

test('non-POST/GET methods return 405', async () => {
  const sidecar = await startSidecar();
  try {
    const res = await httpJson('PUT', `${sidecar.base}/api/eew-status`);
    assert.equal(res.status, 405);
  } finally {
    await sidecar.close();
  }
});
