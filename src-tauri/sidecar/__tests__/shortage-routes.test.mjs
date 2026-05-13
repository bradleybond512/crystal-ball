/**
 * Sidecar shortage route helpers. Locks the request/response contract
 * exposed at /api/shortage/{state,summary,:commodity} so the renderer
 * panel and MCP server stay in sync with what the sidecar returns.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  acceptShortageStatePost,
  buildShortageStateGet,
  buildShortageSummary,
  buildShortageDetail,
} from '../local-api-server.mjs';

const NOW = Date.parse('2026-05-12T12:00:00Z');

function sampleEntry(overrides = {}) {
  return {
    commodity: 'wheat',
    riskScore: 60,
    riskLevel: 'HIGH',
    primaryDrivers: ['Rainfall 50% of normal', 'Bosphorus disrupted'],
    timeToImpact: '≤60 days',
    trend: 'deteriorating',
    forecast: {
      commodity: 'wheat',
      domain: 'food',
      region: 'global',
      horizonDays: 60,
      riskScore: 60,
      confidence: 'medium',
      drivers: [{ kind: 'production', score: 60, label: 'Rainfall low' }],
      confirmingIndicators: [],
      invalidatingIndicators: [],
      dataGaps: [],
      lastUpdated: '2026-05-12T12:00:00Z',
    },
    ...overrides,
  };
}

// ── acceptShortageStatePost ───────────────────────────────────────────────

test('acceptShortageStatePost rejects null body', () => {
  const r = acceptShortageStatePost(null, NOW);
  assert.equal(r.error, 'invalid body');
});

test('acceptShortageStatePost rejects non-object body', () => {
  const r = acceptShortageStatePost('hello', NOW);
  assert.equal(r.error, 'invalid body');
});

test('acceptShortageStatePost rejects body without entries array', () => {
  const r = acceptShortageStatePost({ foo: 'bar' }, NOW);
  assert.equal(r.error, 'entries must be an array');
});

test('acceptShortageStatePost stamps updatedAt from now when omitted', () => {
  const r = acceptShortageStatePost({ entries: [] }, NOW);
  assert.equal(r.error, undefined);
  assert.equal(r.state.updatedAt, NOW);
  assert.equal(r.state.ttlMs, 30 * 60 * 1000);
});

test('acceptShortageStatePost honors caller-supplied updatedAt + ttlMs', () => {
  const r = acceptShortageStatePost(
    { entries: [sampleEntry()], updatedAt: NOW - 1000, ttlMs: 5000 },
    NOW,
  );
  assert.equal(r.state.updatedAt, NOW - 1000);
  assert.equal(r.state.ttlMs, 5000);
  assert.equal(r.state.entries.length, 1);
});

// ── buildShortageStateGet ─────────────────────────────────────────────────

test('buildShortageStateGet returns available:false when state is null', () => {
  const r = buildShortageStateGet(null, NOW);
  assert.equal(r.available, false);
  assert.deepEqual(r.entries, []);
});

test('buildShortageStateGet reports fresh state with stale=false', () => {
  const state = { entries: [sampleEntry()], updatedAt: NOW - 1000, ttlMs: 60_000 };
  const r = buildShortageStateGet(state, NOW);
  assert.equal(r.available, true);
  assert.equal(r.stale, false);
  assert.equal(r.ageMs, 1000);
});

test('buildShortageStateGet reports stale state once age exceeds ttl', () => {
  const state = { entries: [], updatedAt: NOW - 120_000, ttlMs: 60_000 };
  const r = buildShortageStateGet(state, NOW);
  assert.equal(r.stale, true);
});

// ── buildShortageSummary ──────────────────────────────────────────────────

test('buildShortageSummary returns [] when state is null', () => {
  assert.deepEqual(buildShortageSummary(null, NOW), []);
});

test('buildShortageSummary returns [] when state is stale beyond ttl', () => {
  const state = { entries: [sampleEntry()], updatedAt: NOW - 120_000, ttlMs: 60_000 };
  assert.deepEqual(buildShortageSummary(state, NOW), []);
});

test('buildShortageSummary projects to the panel-shaped row (no full forecast)', () => {
  const state = { entries: [sampleEntry()], updatedAt: NOW, ttlMs: 60_000 };
  const r = buildShortageSummary(state, NOW);
  assert.equal(r.length, 1);
  assert.equal(r[0].commodity, 'wheat');
  assert.equal(r[0].riskScore, 60);
  assert.equal(r[0].riskLevel, 'HIGH');
  assert.deepEqual(r[0].primaryDrivers, ['Rainfall 50% of normal', 'Bosphorus disrupted']);
  assert.equal(r[0].timeToImpact, '≤60 days');
  assert.equal(r[0].trend, 'deteriorating');
  assert.equal(r[0].forecast, undefined); // summary omits the heavy forecast
});

test('buildShortageSummary defaults missing optional fields', () => {
  const partial = { commodity: 'wheat', riskScore: 1, riskLevel: 'LOW' };
  const state = { entries: [partial], updatedAt: NOW, ttlMs: 60_000 };
  const r = buildShortageSummary(state, NOW);
  assert.deepEqual(r[0].primaryDrivers, []);
  assert.equal(r[0].timeToImpact, '');
  assert.equal(r[0].trend, 'stable');
});

// ── buildShortageDetail ───────────────────────────────────────────────────

test('buildShortageDetail returns 400 when commodity is empty', () => {
  const r = buildShortageDetail({ entries: [], updatedAt: NOW, ttlMs: 1000 }, '', NOW);
  assert.equal(r.error, 'commodity required');
  assert.equal(r.status, 400);
});

test('buildShortageDetail returns 404 for an unknown commodity', () => {
  const r = buildShortageDetail({ entries: [], updatedAt: NOW, ttlMs: 1000 }, 'titanium', NOW);
  assert.equal(r.error, 'unknown commodity');
  assert.equal(r.status, 404);
});

test('buildShortageDetail returns available:false when no state is present', () => {
  const r = buildShortageDetail(null, 'wheat', NOW);
  assert.equal(r.body.available, false);
  assert.equal(r.body.forecast, null);
});

test('buildShortageDetail returns available:false when the commodity is not in state', () => {
  const state = { entries: [sampleEntry({ commodity: 'corn' })], updatedAt: NOW, ttlMs: 1000 };
  const r = buildShortageDetail(state, 'wheat', NOW);
  assert.equal(r.body.available, false);
});

test('buildShortageDetail returns the full forecast for an in-state commodity', () => {
  const e = sampleEntry();
  const state = { entries: [e], updatedAt: NOW - 5_000, ttlMs: 60_000 };
  const r = buildShortageDetail(state, 'wheat', NOW);
  assert.equal(r.body.available, true);
  assert.equal(r.body.commodity, 'wheat');
  assert.deepEqual(r.body.forecast, e.forecast);
  assert.equal(r.body.riskLevel, 'HIGH');
  assert.equal(r.body.trend, 'deteriorating');
  assert.equal(r.body.ageMs, 5_000);
});

test('buildShortageDetail accepts every full-set commodity', () => {
  const known = ['wheat', 'corn', 'rice', 'soybeans', 'diesel', 'gasoline', 'natural-gas', 'jet-fuel'];
  for (const c of known) {
    const r = buildShortageDetail(null, c, NOW);
    assert.equal(r.error, undefined, `expected ${c} to be valid`);
  }
});
