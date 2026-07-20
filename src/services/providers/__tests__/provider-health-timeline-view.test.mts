import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProviderTimeline,
  buildProviderTimelines,
  DEFAULT_TIMELINE_LIMIT,
} from '../provider-health-timeline-view.ts';
import { emptyProviderHealthState, recordFetchOutcome } from '../provider-health.ts';

const T0 = 1_750_000_000_000;
const ok = (at: number) => ({ ok: true, latencyMs: 120, httpStatus: 200, at });
const fail = (at: number) => ({ ok: false, latencyMs: 0, httpStatus: 500, at, errorMessage: 'http 500' });

test('empty ring buffer yields an empty timeline with successRate 1 and no age', () => {
  const state = emptyProviderHealthState();
  const view = buildProviderTimeline(state, 'opensky', T0);
  assert.equal(view.providerId, 'opensky');
  assert.deepEqual(view.points, []);
  assert.equal(view.windowSuccessRate, 1);
  assert.equal(view.lastOutcomeAgeMs, undefined);
});

test('mixed outcomes preserve order and compute a windowed success rate', () => {
  let s = emptyProviderHealthState();
  s = recordFetchOutcome(s, 'opensky', ok(T0));
  s = recordFetchOutcome(s, 'opensky', fail(T0 + 1_000));
  s = recordFetchOutcome(s, 'opensky', ok(T0 + 2_000));
  const view = buildProviderTimeline(s, 'opensky', T0 + 5_000);
  assert.equal(view.points.length, 3);
  assert.deepEqual(view.points.map((p) => p.ok), [true, false, true]);
  assert.equal(view.windowSuccessRate, 2 / 3);
  assert.equal(view.lastOutcomeAgeMs, 3_000);
});

test('window is capped at the limit, keeping only the most recent outcomes', () => {
  let s = emptyProviderHealthState();
  for (let i = 0; i < 30; i++) s = recordFetchOutcome(s, 'opensky', ok(T0 + i * 1_000));
  const view = buildProviderTimeline(s, 'opensky', T0 + 30_000, 5);
  assert.equal(view.points.length, 5);
  // Last point is the most recent recorded outcome.
  assert.equal(view.points[view.points.length - 1]!.at, T0 + 29_000);
  assert.equal(DEFAULT_TIMELINE_LIMIT, 20);
});

test('unknown provider id returns an empty timeline (no throw)', () => {
  const state = emptyProviderHealthState();
  const view = buildProviderTimeline(state, 'not-a-real-provider', T0);
  assert.deepEqual(view.points, []);
  assert.equal(view.windowSuccessRate, 1);
});

test('buildProviderTimelines batches multiple providers', () => {
  let s = emptyProviderHealthState();
  s = recordFetchOutcome(s, 'opensky', ok(T0));
  s = recordFetchOutcome(s, 'wingbits', fail(T0));
  const views = buildProviderTimelines(s, ['opensky', 'wingbits'], T0 + 1_000);
  assert.equal(views.opensky!.windowSuccessRate, 1);
  assert.equal(views.wingbits!.windowSuccessRate, 0);
});
