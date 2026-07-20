import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRegimeContext,
  DEFAULT_REGIME_MAX_AGE_MS,
  emptyRegimeContext,
  FORECAST_TO_OBSERVATION_DOMAINS,
  REGIME_FACTOR_BOTH,
  REGIME_FACTOR_ONE,
  REGIME_WINDOW_MULTIPLIER,
  regimeFactorFor,
  windowMultiplierFor,
} from '../regime-coupling';
import type { RegimeShift } from '../../cognition/regime-detection';
import { CorrelateEngine, type CorrelationRule } from '../../intelligence/correlate-engine';
import { SituationStoreV2 } from '../../intelligence/situation-store-v2';
import type { ObservationEvent } from '../../../types/intelligence';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 6, 1, 12, 0, 0);

function shift(detectedAt: number, direction: RegimeShift['direction'] = 'up'): RegimeShift {
  return {
    metric: 'test-metric' as never,
    detectedAt,
    triggerValue: 1,
    runLength: 5,
    changeProbability: 0.9,
    direction,
    explanation: 'test shift',
  };
}

test('buildRegimeContext projects forecast domains onto observation domains', () => {
  const ctx = buildRegimeContext({ cyber: shift(T0) }, T0 + HOUR);
  assert.ok(ctx.shifted.has('cyber'));
  assert.ok(ctx.shifted.has('infrastructure'));
  assert.ok(!ctx.shifted.has('weather'));
  assert.equal(ctx.shifted.get('cyber')!.forecastDomain, 'cyber');
});

test('stale shifts age out of the context', () => {
  const ctx = buildRegimeContext(
    { cyber: shift(T0) },
    T0 + DEFAULT_REGIME_MAX_AGE_MS + 1,
  );
  assert.equal(ctx.shifted.size, 0);
});

test('non-finite detectedAt is dropped, not crashing', () => {
  const ctx = buildRegimeContext({ cyber: shift(Number.NaN) }, T0);
  assert.equal(ctx.shifted.size, 0);
});

test('regimeFactorFor: both / one / neither shifted', () => {
  const ctx = buildRegimeContext({ cyber: shift(T0), disaster: shift(T0) }, T0 + HOUR);
  assert.equal(regimeFactorFor('cyber', 'weather', ctx), REGIME_FACTOR_BOTH);
  assert.equal(regimeFactorFor('cyber', 'markets', ctx), REGIME_FACTOR_ONE);
  assert.equal(regimeFactorFor('markets', 'aviation', ctx), 1);
});

test('empty context is neutral everywhere', () => {
  const ctx = emptyRegimeContext();
  assert.equal(regimeFactorFor('cyber', 'weather', ctx), 1);
  assert.equal(windowMultiplierFor(['cyber'], ctx), 1);
  assert.equal(windowMultiplierFor([], ctx), 1);
});

test('windowMultiplierFor widens only rules touching a shifted domain', () => {
  const ctx = buildRegimeContext({ cyber: shift(T0) }, T0 + HOUR);
  assert.equal(windowMultiplierFor(['cyber', 'markets'], ctx), REGIME_WINDOW_MULTIPLIER);
  assert.equal(windowMultiplierFor(['weather'], ctx), 1);
  // Any-domain rules widen too while something is shifting.
  assert.equal(windowMultiplierFor([], ctx), REGIME_WINDOW_MULTIPLIER);
});

test('every forecast domain has an observation-domain projection', () => {
  for (const domains of Object.values(FORECAST_TO_OBSERVATION_DOMAINS)) {
    assert.ok(domains.length > 0);
  }
});

// ── engine integration ───────────────────────────────────────────────────

function obs(id: string, domain: string, timestamp: number): ObservationEvent {
  return {
    id, sourceId: 'src', domain, timestamp, severity: 'HIGH',
    title: id, raw: null, entityIds: [], tags: [],
  };
}

const anyRule: CorrelationRule = {
  id: 'r', name: 'r', description: 'r', domains: ['cyber', 'infrastructure'],
  timeWindowMs: 2 * HOUR, matchFn: () => true, edgeType: 'causal-candidate',
};

test('engine: window multiplier admits pairs beyond the base window', () => {
  const ctx = buildRegimeContext({ cyber: shift(T0) }, T0 + HOUR);
  const engine = new CorrelateEngine({
    windowMultiplierFor: (rule) => windowMultiplierFor(rule.domains, ctx),
  });
  engine.registerRule(anyRule);
  // Gap 2.5h: outside the 2h base window, inside the widened 3h window.
  const pairs = engine.correlate(
    [obs('a', 'cyber', T0), obs('b', 'infrastructure', T0 + 2.5 * HOUR)],
    new Date(T0 + 3 * HOUR),
  ).pairs;
  assert.equal(pairs.length, 1);
  const base = new CorrelateEngine();
  base.registerRule(anyRule);
  const basePairs = base.correlate(
    [obs('a', 'cyber', T0), obs('b', 'infrastructure', T0 + 2.5 * HOUR)],
    new Date(T0 + 3 * HOUR),
  ).pairs;
  assert.equal(basePairs.length, 0);
});

test('engine: regime factor reaches the confidence breakdown', () => {
  const ctx = buildRegimeContext({ cyber: shift(T0) }, T0 + HOUR);
  const engine = new CorrelateEngine({
    regimeFactorFor: (a, b) => regimeFactorFor(a.domain, b.domain, ctx),
  });
  engine.registerRule(anyRule);
  const pair = engine.correlate(
    [obs('a', 'cyber', T0), obs('b', 'infrastructure', T0 + HOUR)],
    new Date(T0 + HOUR),
  ).pairs[0]!;
  assert.equal(pair.confidenceDetail!.factors.regime, REGIME_FACTOR_BOTH);
});

test('engine: broken window provider is neutralized (NaN / 0 / 99)', () => {
  for (const bad of [Number.NaN, 0, 99]) {
    const engine = new CorrelateEngine({ windowMultiplierFor: () => bad });
    engine.registerRule(anyRule);
    // Gap 2.5h: base window 2h. NaN/0 → neutral (no pair). 99 → clamped ×2
    // (4h window → pair admitted).
    const pairs = engine.correlate(
      [obs('a', 'cyber', T0), obs('b', 'infrastructure', T0 + 2.5 * HOUR)],
      new Date(T0 + 3 * HOUR),
    ).pairs;
    assert.equal(pairs.length, bad === 99 ? 1 : 0);
  }
});

test('store seam: setRegimeProvider drives the default engine', () => {
  const store = new SituationStoreV2({ clock: () => T0 + HOUR });
  const ctx = buildRegimeContext({ disaster: shift(T0) }, T0 + HOUR);
  store.setRegimeProvider({
    factorFor: (a, b) => regimeFactorFor(a, b, ctx),
    windowMultiplierFor: (d) => windowMultiplierFor(d, ctx),
  });
  let seen: number | undefined;
  store.setPairListener((pairs) => {
    seen = pairs[0]?.confidenceDetail?.factors.regime;
  });
  // weather-wildfire built-in: red-flag NWS + wildfire sharing an entity.
  store.ingest([
    { ...obs('w1', 'weather', T0), sourceId: 'nws-alerts', tags: ['red-flag-warning'], entityIds: ['county:X'] },
    { ...obs('f1', 'weather', T0 + HOUR), sourceId: 'inciweb-wildfire', tags: ['wildfire'], entityIds: ['county:X'] },
  ]);
  assert.equal(seen, REGIME_FACTOR_BOTH);
  store.setRegimeProvider();
});

test('deterministic: same shifts + now produce identical contexts', () => {
  const a = buildRegimeContext({ finance: shift(T0) }, T0 + HOUR);
  const b = buildRegimeContext({ finance: shift(T0) }, T0 + HOUR);
  assert.deepEqual([...a.shifted.entries()], [...b.shifted.entries()]);
});
