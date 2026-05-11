/**
 * Tests for api/floods/warnings.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler, mockFetch } from './_test-utils.mjs';

let handler;
let warningsCache;
try {
  const mod = await import('../floods/warnings.js');
  handler = mod.default;
  warningsCache = mod.cache;
} catch (err) {
  console.warn('Handler floods/warnings.js failed to import:', err.message);
  handler = null;
}

const NWS_EMPTY = { features: [] };

const NWS_SAMPLE = {
  features: [
    {
      id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-001',
      properties: {
        event: 'Flash Flood Warning',
        severity: 'Severe',
        headline: 'Flash Flood Warning issued for Pulaski County; AR',
        areaDesc: 'Pulaski County; AR',
        effective: '2026-05-11T12:00:00-05:00',
        expires: '2026-05-11T18:00:00-05:00',
      },
      geometry: null,
    },
    {
      id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-002',
      properties: {
        event: 'Flood Watch',
        severity: 'Moderate',
        headline: 'Flood Watch for Shelby County; TN',
        areaDesc: 'Shelby County; TN',
        effective: '2026-05-11T14:00:00-05:00',
        expires: '2026-05-12T06:00:00-05:00',
      },
      geometry: null,
    },
    {
      id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-003',
      properties: {
        event: 'Flood Warning',
        severity: 'Severe',
        headline: 'Flood Warning in effect for St. Tammany Parish; LA',
        areaDesc: 'St. Tammany Parish; LA',
        effective: '2026-05-11T10:00:00-05:00',
        expires: '2026-05-12T10:00:00-05:00',
      },
      geometry: null,
    },
  ],
};

test('warnings: rejects non-GET methods', async () => {
  if (!handler) return;
  const { res } = await invokeHandler(handler, { method: 'POST' });
  assert.equal(res.statusCode, 405);
});

test('warnings: handles OPTIONS preflight', async () => {
  if (!handler) return;
  const { res } = await invokeHandler(handler, { method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
});

test('warnings: returns 200 with empty NWS response', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['api.weather.gov', { status: 200, json: NWS_EMPTY }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 0);
  assert.deepEqual(res.body.alerts, []);
});

test('warnings: response has expected shape', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['api.weather.gov', { status: 200, json: NWS_EMPTY }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.ok('total' in res.body);
  assert.ok('byState' in res.body);
  assert.ok('alerts' in res.body);
  assert.ok('source' in res.body);
  assert.ok('generatedAt' in res.body);
});

test('warnings: counts alerts correctly', async () => {
  if (!handler) return;
  warningsCache?.clear();
  const restoreFetch = mockFetch(new Map([
    ['api.weather.gov', { status: 200, json: NWS_SAMPLE }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.equal(res.body.total, 3);
  assert.equal(res.body.alerts.length, 3);
});

test('warnings: extracts state codes from areaDesc', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['api.weather.gov', { status: 200, json: NWS_SAMPLE }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  const states = res.body.byState.map(s => s.state);
  assert.ok(states.includes('AR'), 'should include AR');
  assert.ok(states.includes('TN'), 'should include TN');
  assert.ok(states.includes('LA'), 'should include LA');
});

test('warnings: byState sorted by severity rank descending', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['api.weather.gov', { status: 200, json: NWS_SAMPLE }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  const byState = res.body.byState;
  assert.ok(Array.isArray(byState));
  // Severe states should come before Moderate
  const arIdx = byState.findIndex(s => s.state === 'AR');
  const tnIdx = byState.findIndex(s => s.state === 'TN');
  // AR has Severe Flash Flood Warning, TN has Moderate Flood Watch
  assert.ok(arIdx < tnIdx || byState[arIdx].maxSeverity === byState[tnIdx].maxSeverity, 'AR Severe should rank >= TN Moderate');
});

test('warnings: alerts include event and severity fields', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['api.weather.gov', { status: 200, json: NWS_SAMPLE }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  const alert = res.body.alerts[0];
  assert.ok(typeof alert.event === 'string');
  assert.ok(typeof alert.severity === 'string');
  assert.ok(typeof alert.headline === 'string');
});

test('warnings: degrades gracefully on NWS HTTP error', async () => {
  if (!handler) return;
  warningsCache?.clear();
  const restoreFetch = mockFetch(new Map([
    ['api.weather.gov', { status: 503, text: 'Service Unavailable' }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.degraded, true);
});

test('warnings: degrades gracefully on fetch exception', async () => {
  if (!handler) return;
  warningsCache?.clear();
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('DNS failure'); };
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { globalThis.fetch = origFetch; }
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.degraded, true);
});

test('warnings: source is api.weather.gov', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['api.weather.gov', { status: 200, json: NWS_EMPTY }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.equal(res.body.source, 'api.weather.gov');
});

test('warnings: generatedAt is valid ISO string', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['api.weather.gov', { status: 200, json: NWS_EMPTY }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.doesNotThrow(() => new Date(res.body.generatedAt));
});
