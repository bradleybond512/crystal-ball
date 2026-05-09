/**
 * Threshold plumbing for the new event kinds (wildfire-frp, air-quality,
 * market) plus assertions that thresholds passed via DecideOptions
 * actually move the cutoffs at runtime.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { decideNotification } from '../push-notifier.ts';
import { DEFAULT_THRESHOLDS, type ThresholdConfig } from '@/services/config/alert-thresholds';

function withDefaults(over: Partial<ThresholdConfig> = {}): ThresholdConfig {
  return {
    seismic: { ...DEFAULT_THRESHOLDS.seismic, ...over.seismic },
    geomagnetic: { ...DEFAULT_THRESHOLDS.geomagnetic, ...over.geomagnetic },
    wildfire: { ...DEFAULT_THRESHOLDS.wildfire, ...over.wildfire },
    airQuality: { ...DEFAULT_THRESHOLDS.airQuality, ...over.airQuality },
    economic: { ...DEFAULT_THRESHOLDS.economic, ...over.economic },
    hurricane: { ...DEFAULT_THRESHOLDS.hurricane, ...over.hurricane },
  };
}

// ── Wildfire FRP ───────────────────────────────────────────────────────────

test('wildfire-frp fires when FRP ≥ threshold and within radius', () => {
  const decision = decideNotification(
    { kind: 'wildfire-frp', frpMw: 200, lat: 41, lon: -86, distanceKm: 30 },
    { thresholds: withDefaults({ wildfire: { pushMinFRP: 100, radiusKm: 50 } }) },
  );
  assert.equal(decision.shouldFire, true);
  assert.equal(decision.payload?.threatType, 'wildfire_extreme');
  assert.match(decision.payload?.body ?? '', /FRP 200/);
  assert.match(decision.payload?.body ?? '', /30 km/);
});

test('wildfire-frp suppressed when FRP below threshold', () => {
  const decision = decideNotification(
    { kind: 'wildfire-frp', frpMw: 50, lat: 41, lon: -86, distanceKm: 30 },
    { thresholds: withDefaults({ wildfire: { pushMinFRP: 100, radiusKm: 50 } }) },
  );
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'wildfire-frp-below-threshold');
});

test('wildfire-frp suppressed when distance > radiusKm', () => {
  const decision = decideNotification(
    { kind: 'wildfire-frp', frpMw: 500, lat: 41, lon: -86, distanceKm: 300 },
    { thresholds: withDefaults({ wildfire: { pushMinFRP: 100, radiusKm: 50 } }) },
  );
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'wildfire-out-of-radius');
});

test('wildfire-frp fires regardless of radius when distanceKm is null', () => {
  const decision = decideNotification(
    { kind: 'wildfire-frp', frpMw: 500, lat: 41, lon: -86, distanceKm: null },
    { thresholds: withDefaults() },
  );
  assert.equal(decision.shouldFire, true);
  assert.match(decision.payload?.body ?? '', /unknown distance/);
});

// ── Air quality ────────────────────────────────────────────────────────────

test('air-quality fires when AQI ≥ threshold', () => {
  const decision = decideNotification(
    { kind: 'air-quality', aqi: 175, pollutant: 'pm2_5', station: 'La Porte' },
    { thresholds: withDefaults({ airQuality: { pushMinAQI: 150 } }) },
  );
  assert.equal(decision.shouldFire, true);
  assert.match(decision.payload?.title ?? '', /AQI 175/);
});

test('air-quality suppressed when AQI < threshold', () => {
  const decision = decideNotification(
    { kind: 'air-quality', aqi: 120 },
    { thresholds: withDefaults({ airQuality: { pushMinAQI: 150 } }) },
  );
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'aqi-below-threshold');
});

test('air-quality threatLevel ladders critical at AQI 300+', () => {
  const high = decideNotification(
    { kind: 'air-quality', aqi: 220 },
    { thresholds: withDefaults({ airQuality: { pushMinAQI: 50 } }) },
  );
  const critical = decideNotification(
    { kind: 'air-quality', aqi: 320 },
    { thresholds: withDefaults({ airQuality: { pushMinAQI: 50 } }) },
  );
  assert.equal(high.payload?.threatLevel, 'high');
  assert.equal(critical.payload?.threatLevel, 'critical');
});

// ── Market ─────────────────────────────────────────────────────────────────

test('market fires on VIX above threshold', () => {
  const decision = decideNotification(
    { kind: 'market', vix: 35 },
    { thresholds: withDefaults({ economic: { pushMinVIX: 30, ofrFsiSigmas: 2.0 } }) },
  );
  assert.equal(decision.shouldFire, true);
  assert.match(decision.payload?.body ?? '', /VIX 35\.0/);
});

test('market fires on OFR FSI above sigma threshold', () => {
  const decision = decideNotification(
    { kind: 'market', ofrFsiSigmas: 2.5 },
    { thresholds: withDefaults({ economic: { pushMinVIX: 30, ofrFsiSigmas: 2.0 } }) },
  );
  assert.equal(decision.shouldFire, true);
  assert.match(decision.payload?.body ?? '', /OFR FSI 2\.5σ/);
});

test('market suppressed when both VIX and OFR FSI are below threshold', () => {
  const decision = decideNotification(
    { kind: 'market', vix: 18, ofrFsiSigmas: 0.5 },
    { thresholds: withDefaults({ economic: { pushMinVIX: 30, ofrFsiSigmas: 2.0 } }) },
  );
  assert.equal(decision.shouldFire, false);
  assert.equal(decision.reason, 'market-below-threshold');
});

// ── Threshold plumbing ─────────────────────────────────────────────────────

test('explicit thresholds override the persisted defaults at decide time', () => {
  // Same M6.4 input — at the strict default it fires, but raise pushMin
  // to 7 and it must be suppressed.
  const fires = decideNotification(
    { kind: 'seismic', magnitude: 6.4, place: 'X' },
    { thresholds: withDefaults({ seismic: { pushMinMagnitude: 5, voiceMinMagnitude: 7 } }) },
  );
  const suppressed = decideNotification(
    { kind: 'seismic', magnitude: 6.4, place: 'X' },
    { thresholds: withDefaults({ seismic: { pushMinMagnitude: 7, voiceMinMagnitude: 8 } }) },
  );
  assert.equal(fires.shouldFire, true);
  assert.equal(suppressed.shouldFire, false);
  assert.equal(suppressed.reason, 'magnitude-below-threshold');
});

test('hurricane gating obeys configurable pushMinCategory', () => {
  const event = { kind: 'hurricane', nhcStorm: { name: 'Test', category: 2 } } as const;
  const lenient = decideNotification(event,
    { thresholds: withDefaults({ hurricane: { pushMinCategory: 2 } }) });
  const strict = decideNotification(event,
    { thresholds: withDefaults({ hurricane: { pushMinCategory: 4 } }) });
  assert.equal(lenient.shouldFire, true);
  assert.equal(strict.shouldFire, false);
  assert.equal(strict.reason, 'hurricane-below-threshold');
});

test('geomagnetic Kp 7 fires under default thresholds (pushMinKp=7)', () => {
  const decision = decideNotification(
    { kind: 'geomagnetic', kpIndex: 7 },
    { thresholds: withDefaults() },
  );
  assert.equal(decision.shouldFire, true);
  assert.equal(decision.payload?.meta?.gLevel, 'G3');
});
