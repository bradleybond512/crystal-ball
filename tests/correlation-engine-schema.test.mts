import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  type NormalizedEvent,
  type CanonicalEntity,
  type CorrelationResult,
  type CorrelationAlert,
  EVENT_TAXONOMY,
  SEVERITY_BUCKETS,
  normalizeTimestamp,
  normalizeLocation,
} from '../src/types/correlation-engine.ts';

describe('NormalizedEvent schema', () => {
  it('EVENT_TAXONOMY contains all required event types', () => {
    const required = [
      'conflict', 'protest', 'riot', 'military_activity',
      'cyber_incident', 'internet_disruption', 'weather_disaster',
      'earthquake', 'economic_shock', 'sanctions_action',
      'shipping_disruption', 'aviation_anomaly', 'outbreak',
      'humanitarian_update', 'displacement', 'food_insecurity',
      'energy_disruption', 'wildfire', 'flooding',
    ];
    for (const t of required) {
      assert.ok(EVENT_TAXONOMY.includes(t), `Missing taxonomy entry: ${t}`);
    }
  });

  it('normalizeTimestamp returns UTC ISO string and precision', () => {
    const result = normalizeTimestamp('2026-04-14T14:00:00Z');
    assert.equal(result.utc, '2026-04-14T14:00:00.000Z');
    assert.equal(result.precision, 'exact');
  });

  it('normalizeTimestamp handles day-only precision', () => {
    const result = normalizeTimestamp('2026-04-14');
    assert.ok(result.utc.startsWith('2026-04-14'));
    assert.equal(result.precision, 'day');
  });

  it('normalizeLocation returns lat/lon/country/confidence', () => {
    const result = normalizeLocation({ lat: 12.34, lon: 56.78, country: 'Somalia' });
    assert.equal(result.lat, 12.34);
    assert.equal(result.lon, 56.78);
    assert.equal(result.country, 'Somalia');
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  });

  it('SEVERITY_BUCKETS maps score ranges to labels', () => {
    assert.equal(SEVERITY_BUCKETS(10), 'low');
    assert.equal(SEVERITY_BUCKETS(35), 'moderate');
    assert.equal(SEVERITY_BUCKETS(55), 'notable');
    assert.equal(SEVERITY_BUCKETS(75), 'high');
    assert.equal(SEVERITY_BUCKETS(95), 'critical');
  });
});
