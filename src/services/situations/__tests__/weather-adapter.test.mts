import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { weatherAlertsToSituations } from '../weather-adapter';
import type { WeatherAlert } from '@/services/weather';

const NOW = 1_745_000_000_000;

function fakeAlert(overrides: Partial<WeatherAlert> = {}): WeatherAlert {
  return {
    id: 'NWS.IND.1',
    event: 'Severe Thunderstorm Warning',
    severity: 'Severe',
    headline: 'Severe Thunderstorm Warning in effect for La Porte and St. Joseph until 4 PM EDT',
    description: 'Damaging winds and large hail likely.',
    areaDesc: 'La Porte; St. Joseph',
    onset: new Date(NOW + 15 * 60_000),
    expires: new Date(NOW + 90 * 60_000),
    coordinates: [
      [-86.7, 41.6],
      [-86.5, 41.7],
      [-86.4, 41.5],
      [-86.7, 41.6],
    ],
    centroid: [-86.6, 41.6],
    ...overrides,
  };
}

describe('weatherAlertsToSituations — empty input', () => {
  it('returns an empty array for no alerts', () => {
    assert.deepEqual(weatherAlertsToSituations({ alerts: [], now: () => NOW }), []);
  });
});

describe('weatherAlertsToSituations — severity mapping', () => {
  it('maps Extreme → emergency', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [fakeAlert({ severity: 'Extreme' })],
      now: () => NOW,
    });
    assert.equal(s?.severity, 'emergency');
  });

  it('maps Severe → critical', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [fakeAlert({ severity: 'Severe' })],
      now: () => NOW,
    });
    assert.equal(s?.severity, 'critical');
  });

  it('maps Moderate → elevated', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [fakeAlert({ severity: 'Moderate' })],
      now: () => NOW,
    });
    assert.equal(s?.severity, 'elevated');
  });

  it('maps Minor → watch', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [fakeAlert({ severity: 'Minor' })],
      now: () => NOW,
    });
    assert.equal(s?.severity, 'watch');
  });

  it('maps Unknown → fyi', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [fakeAlert({ severity: 'Unknown' })],
      now: () => NOW,
    });
    assert.equal(s?.severity, 'fyi');
  });
});

describe('weatherAlertsToSituations — urgency from time-to-onset', () => {
  it('imminent onset (< 15 min) → high urgency', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [fakeAlert({ onset: new Date(NOW + 5 * 60_000) })],
      now: () => NOW,
    });
    assert.ok((s?.urgency ?? 0) > 0.85);
  });

  it('distant onset (> 90 min) → low urgency', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [fakeAlert({ onset: new Date(NOW + 120 * 60_000) })],
      now: () => NOW,
    });
    assert.ok((s?.urgency ?? 1) <= 0.3);
  });
});

describe('weatherAlertsToSituations — user exposure', () => {
  it('saved place within 25 km → high exposure', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [fakeAlert()],
      savedPlaces: [{ id: 'home', name: 'La Porte', lat: 41.61, lon: -86.72 }],
      now: () => NOW,
    });
    assert.ok((s?.userExposure ?? 0) > 0.9);
    assert.equal(s?.personalImpact.level, 'severe');
    assert.ok(s?.personalImpact.reasons.length ?? 0 > 0);
  });

  it('saved place > 200 km → low exposure', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [fakeAlert()],
      savedPlaces: [{ id: 'home', name: 'Denver', lat: 39.7, lon: -104.99 }],
      now: () => NOW,
    });
    assert.ok((s?.userExposure ?? 1) <= 0.15);
  });

  it('no saved places → minimal exposure with empty reasons', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [fakeAlert()],
      now: () => NOW,
    });
    assert.equal(s?.userExposure, 0.1);
    assert.deepEqual(s?.personalImpact.reasons, []);
  });
});

describe('weatherAlertsToSituations — diagnostics trace', () => {
  it('includes the severity rationale string', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [fakeAlert({ severity: 'Severe' })],
      now: () => NOW,
    });
    assert.match(s?.diagnosticsTrace.severityRationale ?? '', /score|tier|severe/i);
  });

  it('lists NWS as the contributing source', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [fakeAlert()],
      now: () => NOW,
    });
    assert.equal(s?.diagnosticsTrace.sourceContributions.NWS, 1.0);
  });

  it('records thresholdsCrossed', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [fakeAlert()],
      now: () => NOW,
    });
    assert.ok((s?.diagnosticsTrace.thresholdsCrossed.length ?? 0) > 0);
  });
});

describe('weatherAlertsToSituations — recommended actions', () => {
  it('critical/emergency situations include an immediate-shelter action', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [fakeAlert({ severity: 'Extreme' })],
      now: () => NOW,
    });
    assert.ok(s?.recommendedActions.some((a) => a.urgency === 'immediate'));
  });

  it('Minor severity includes a monitor-only action', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [fakeAlert({ severity: 'Minor' })],
      now: () => NOW,
    });
    assert.ok(s?.recommendedActions.every((a) => a.urgency === 'monitor' || a.urgency === 'fyi'));
  });
});

describe('weatherAlertsToSituations — output shape', () => {
  it('produces a JSON-serializable Situation', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [fakeAlert()],
      now: () => NOW,
    });
    assert.doesNotThrow(() => JSON.stringify(s));
  });

  it('namespaces the id with weather: prefix', () => {
    const [s] = weatherAlertsToSituations({
      alerts: [fakeAlert({ id: 'abc' })],
      now: () => NOW,
    });
    assert.equal(s?.id, 'weather:abc');
  });
});
