import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  airQualityToObservation,
  airQualityToObservations,
  type AirQualitySample,
} from '../air-quality-adapter.ts';
import { airQualityWildfireRule } from '../../built-in-correlation-rules.ts';
import type { ObservationEvent } from '@/types/intelligence';

const NOW = Date.UTC(2026, 6, 19, 12, 0, 0);

function sample(over: Partial<AirQualitySample> = {}): AirQualitySample {
  return {
    id: 'nwi', lat: 41.6, lon: -87.3, aqi: 160, actionDay: false,
    reportingArea: 'Northwest Indiana', at: NOW, source: 'airnow', ...over,
  };
}

// ── Adapter: severity + tags ──────────────────────────────────────────────

test('adapter: Unhealthy AQI → HIGH with aqi-unhealthy + smoke-relevant tags', () => {
  const o = airQualityToObservation(sample({ aqi: 160 }))!;
  assert.equal(o.severity, 'HIGH');
  assert.equal(o.sourceId, 'airnow');
  assert.equal(o.domain, 'weather');
  assert.ok(o.tags.includes('aqi-unhealthy'));
  assert.ok(o.tags.includes('smoke-relevant'));
  assert.deepEqual(o.location, { lat: 41.6, lon: -87.3, radiusKm: 40 });
});

test('adapter: Very Unhealthy / Hazardous → CRITICAL', () => {
  assert.equal(airQualityToObservation(sample({ aqi: 210 }))!.severity, 'CRITICAL');
  assert.equal(airQualityToObservation(sample({ aqi: 320 }))!.severity, 'CRITICAL');
});

test('adapter: USG AQI → MEDIUM', () => {
  assert.equal(airQualityToObservation(sample({ aqi: 120 }))!.severity, 'MEDIUM');
});

test('adapter: an Action Day is never ranked below HIGH even at USG AQI', () => {
  const o = airQualityToObservation(sample({ aqi: 120, actionDay: true }))!;
  assert.equal(o.severity, 'HIGH');
  assert.ok(o.tags.includes('action-day'));
  assert.ok(o.tags.includes('smoke-relevant'));
  assert.match(o.title, /Action Day/);
});

test('adapter: clean/Moderate air with no action day → undefined (not correlated)', () => {
  assert.equal(airQualityToObservation(sample({ aqi: 40, actionDay: false })), undefined);
  assert.equal(airQualityToObservation(sample({ aqi: 80, actionDay: false })), undefined);
});

test('adapter: missing coordinates → undefined', () => {
  assert.equal(airQualityToObservation(sample({ aqi: 200, lat: Number.NaN })), undefined);
});

test('adapter: adaptMany drops the undefined (clean) samples', () => {
  const out = airQualityToObservations([sample({ aqi: 160 }), sample({ id: 'clean', aqi: 30 })]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 'airnow-aq-nwi');
});

// ── Correlation rule: AirNow ↔ FIRMS ─────────────────────────────────────

function obs(over: Partial<ObservationEvent>): ObservationEvent {
  return {
    id: 'x', sourceId: 'airnow', domain: 'weather', timestamp: NOW,
    location: { lat: 41.6, lon: -87.3, radiusKm: 40 }, severity: 'HIGH',
    title: 't', raw: {}, entityIds: [], tags: ['air-quality', 'smoke-relevant'], ...over,
  };
}

test('rule: unhealthy AirNow air within 150km of a wildfire matches', () => {
  const air = obs({ id: 'aq', sourceId: 'airnow', tags: ['air-quality', 'aqi-unhealthy', 'smoke-relevant'] });
  const fire = obs({ id: 'fire', sourceId: 'nasa-firms', tags: ['wildfire'], location: { lat: 41.9, lon: -87.6, radiusKm: 5 } });
  assert.equal(airQualityWildfireRule.matchFn(air, fire), true);
});

test('rule: no match when the fire is far (>150km) away', () => {
  const air = obs({ id: 'aq', sourceId: 'airnow', tags: ['air-quality', 'smoke-relevant'] });
  const fire = obs({ id: 'fire', sourceId: 'nasa-firms', tags: ['wildfire'], location: { lat: 30.0, lon: -95.0, radiusKm: 5 } });
  assert.equal(airQualityWildfireRule.matchFn(air, fire), false);
});

test('rule: no match when air quality is not smoke-relevant, or the other side is not a fire', () => {
  const cleanAir = obs({ id: 'aq', sourceId: 'airnow', tags: ['air-quality'] });
  const fire = obs({ id: 'fire', sourceId: 'nasa-firms', tags: ['wildfire'] });
  assert.equal(airQualityWildfireRule.matchFn(cleanAir, fire), false);
  const air = obs({ id: 'aq', sourceId: 'airnow', tags: ['air-quality', 'smoke-relevant'] });
  const quake = obs({ id: 'eq', sourceId: 'usgs-earthquake', tags: ['earthquake'] });
  assert.equal(airQualityWildfireRule.matchFn(air, quake), false);
});
