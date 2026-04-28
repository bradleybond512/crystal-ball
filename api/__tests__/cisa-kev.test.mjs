/**
 * Route-level coverage for api/cisa-kev.js
 *
 * Public unauthenticated catalog (no key required). Tests prove the
 * limit clamp survives non-numeric / out-of-range / zero / negative
 * inputs (Codex-style ?limit=abc bug), the response is the
 * `CyberThreat[]` array contract, and upstream failures degrade.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler, mockFetch } from './_test-utils.mjs';

const cisaKevModule = await import('../cisa-kev.js');
const handler = cisaKevModule.default;
const resetCache = cisaKevModule.__resetCacheForTests;

const MOCK_KEV_PAYLOAD = {
  catalogVersion: '2026.04.28',
  dateReleased: '2026-04-28T00:00:00.000Z',
  vulnerabilities: [
    { cveID: 'CVE-2026-0001', vendorProject: 'Acme', product: 'Widget', vulnerabilityName: 'RCE', dateAdded: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) },
    { cveID: 'CVE-2026-0002', vendorProject: 'Acme', product: 'Gadget', vulnerabilityName: 'AuthBypass', dateAdded: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) },
  ],
};

test('cisa-kev: OPTIONS returns 204', async () => {
  const { res } = await invokeHandler(handler, { method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
});

test('cisa-kev: rejects unsupported methods', async () => {
  const { res } = await invokeHandler(handler, { method: 'POST' });
  assert.equal(res.statusCode, 405);
});

test('cisa-kev: returns CyberThreat[] array on happy path', async () => {
  resetCache();
  const restore = mockFetch(new Map([['cisa.gov', { status: 200, json: MOCK_KEV_PAYLOAD }]]));
  try {
    const { res } = await invokeHandler(handler, { query: {} });
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body), 'response body must be a plain array');
    assert.ok(res.body.length > 0);
    const t = res.body[0];
    assert.equal(typeof t.id, 'string');
    assert.equal(t.type, 'exploited_vulnerability');
    assert.equal(t.source, 'cisa_kev');
    assert.match(t.indicator, /^CVE-/);
    assert.equal(t.severity, 'critical');
    assert.ok(Array.isArray(t.tags));
  } finally { restore(); }
});

test('cisa-kev: limit=abc falls back to default (does not return empty)', async () => {
  resetCache();
  const restore = mockFetch(new Map([['cisa.gov', { status: 200, json: MOCK_KEV_PAYLOAD }]]));
  try {
    const { res } = await invokeHandler(handler, { query: { limit: 'abc' } });
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length > 0, 'NaN limit must fall back to default, not slice(0, NaN) → []');
  } finally { restore(); }
});

test('cisa-kev: limit=0 falls back to default', async () => {
  resetCache();
  const restore = mockFetch(new Map([['cisa.gov', { status: 200, json: MOCK_KEV_PAYLOAD }]]));
  try {
    const { res } = await invokeHandler(handler, { query: { limit: '0' } });
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length > 0);
  } finally { restore(); }
});

test('cisa-kev: limit=-5 clamps to >= 1', async () => {
  resetCache();
  const restore = mockFetch(new Map([['cisa.gov', { status: 200, json: MOCK_KEV_PAYLOAD }]]));
  try {
    const { res } = await invokeHandler(handler, { query: { limit: '-5' } });
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body));
    // Negative limit falls back to default (200), so we get all items.
    assert.ok(res.body.length > 0);
  } finally { restore(); }
});

test('cisa-kev: limit=999999 clamps to <= 500', async () => {
  // Build a large payload to demonstrate the clamp.
  const big = { ...MOCK_KEV_PAYLOAD, vulnerabilities: Array.from({ length: 600 }, (_, i) => ({
    cveID: `CVE-2026-${String(i).padStart(5, '0')}`,
    vendorProject: 'BigCo',
    product: 'Thing',
    vulnerabilityName: 'X',
    dateAdded: new Date(Date.now() - i * 60 * 1000).toISOString().slice(0, 10),
  })) };
  resetCache();
  const restore = mockFetch(new Map([['cisa.gov', { status: 200, json: big }]]));
  try {
    const { res } = await invokeHandler(handler, { query: { limit: '999999' } });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.length <= 500, `limit clamp upper bound: got ${res.body.length}`);
  } finally { restore(); }
});

test('cisa-kev: upstream 503 returns empty array (preserves contract)', async () => {
  resetCache();
  const restore = mockFetch(new Map([['cisa.gov', { status: 503, json: {} }]]));
  try {
    const { res } = await invokeHandler(handler, { query: {} });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, []);
  } finally { restore(); }
});
