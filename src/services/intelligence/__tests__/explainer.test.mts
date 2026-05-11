import assert from 'node:assert/strict';
import test from 'node:test';

import { explain } from '../explainer.ts';
import type { ObservationEvent, Correlation } from '../explainer.ts';

// ── Factory helpers ────────────────────────────────────────────────────────

function eq(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'eq-1',
    domain: 'earthquake',
    title: 'M6.5 earthquake near Tokyo',
    severity: 'high',
    sources: ['USGS', 'JMA'],
    magnitude: 6.5,
    depth: 35,
    location: 'near Tokyo, Japan',
    nearestCity: 'Tokyo',
    nearestCityDistKm: 42,
    ...overrides,
  };
}

function wf(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'wf-1',
    domain: 'wildfire',
    title: 'Caldor Fire update',
    severity: 'critical',
    sources: ['NIFC', 'CAL FIRE'],
    fireName: 'Caldor Fire',
    acres: 221_835,
    containmentPct: 76,
    fireBehavior: 'moderate',
    windSpeedMph: 15,
    ...overrides,
  };
}

function av(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'av-1',
    domain: 'aviation',
    title: 'UAL123 squawking 7700',
    severity: 'critical',
    sources: ['FlightAware', 'ADS-B Exchange'],
    callsign: 'UAL123',
    aircraftType: 'B737',
    squawkCode: '7700',
    location: 'Chicago O\'Hare',
    ...overrides,
  };
}

function wx(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'wx-1',
    domain: 'weather',
    title: 'Tornado Warning — La Porte County',
    severity: 'critical',
    sources: ['NWS'],
    eventType: 'Tornado',
    area: 'La Porte County, IN',
    expiresAt: new Date('2026-05-11T18:45:00Z').getTime(),
    conditions: 'Rotation detected on radar near Westville.',
    ...overrides,
  };
}

function ais(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'ais-1',
    domain: 'maritime',
    title: 'AIS dark gap — MV Poseidon',
    severity: 'high',
    sources: ['MarineTraffic', 'Global Fishing Watch'],
    vesselName: 'MV Poseidon',
    vesselType: 'Bulk Carrier',
    flag: 'Marshall Islands',
    behavior: 'AIS dark gap (6 hours)',
    location: 'Gulf of Oman',
    maritimeContext: 'Last known position near sanctioned anchorage.',
    ...overrides,
  };
}

function generic(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'gen-1',
    domain: 'generic',
    title: 'Critical BGP route leak detected',
    severity: 'high',
    sources: ['BGPmon'],
    location: 'North America',
    ...overrides,
  };
}

// ── Earthquake domain ──────────────────────────────────────────────────────

test('earthquake: why contains magnitude and depth', () => {
  const result = explain(eq());
  assert.match(result.why, /M6\.5/);
  assert.match(result.why, /35km depth/);
});

test('earthquake: why mentions nearest city and distance', () => {
  const result = explain(eq());
  assert.match(result.why, /Tokyo/);
  assert.match(result.why, /42km/);
});

test('earthquake: shaking description is catastrophic for M7+', () => {
  const result = explain(eq({ magnitude: 7.8, depth: 10 }));
  assert.match(result.why, /catastrophic/i);
});

test('earthquake: shaking description is minor for M<4', () => {
  const result = explain(eq({ magnitude: 3.2 }));
  assert.match(result.why, /minor shaking/i);
});

// ── Wildfire domain ────────────────────────────────────────────────────────

test('wildfire: why contains fire name, acres, containment', () => {
  const result = explain(wf());
  assert.match(result.why, /Caldor Fire/);
  assert.match(result.why, /221/); // acres (locale-formatted)
  assert.match(result.why, /76% contained/);
});

test('wildfire: why mentions wind speed', () => {
  const result = explain(wf());
  assert.match(result.why, /15mph/);
});

test('wildfire: falls back to title when no fireName', () => {
  const result = explain(wf({ fireName: undefined }));
  assert.match(result.why, /Caldor Fire update/);
});

// ── Aviation domain ────────────────────────────────────────────────────────

test('aviation: why contains callsign, squawk code, and meaning', () => {
  const result = explain(av());
  assert.match(result.why, /UAL123/);
  assert.match(result.why, /7700/);
  assert.match(result.why, /general emergency/i);
});

test('aviation: squawk 7500 → hijacking', () => {
  const result = explain(av({ squawkCode: '7500' }));
  assert.match(result.why, /hijacking/i);
});

test('aviation: squawk 7600 → radio failure', () => {
  const result = explain(av({ squawkCode: '7600' }));
  assert.match(result.why, /radio failure/i);
});

test('aviation: unknown squawk → transponder code', () => {
  const result = explain(av({ squawkCode: '1234' }));
  assert.match(result.why, /transponder code/i);
});

// ── Weather domain ─────────────────────────────────────────────────────────

test('weather: why contains severity, event type, and area', () => {
  const result = explain(wx());
  assert.match(result.why, /Tornado/);
  assert.match(result.why, /La Porte County/);
  assert.match(result.why, /Critical/i);
});

test('weather: why contains conditions when provided', () => {
  const result = explain(wx());
  assert.match(result.why, /Rotation detected/);
});

// ── Maritime domain ────────────────────────────────────────────────────────

test('maritime: why contains vessel name, type, flag, behavior', () => {
  const result = explain(ais());
  assert.match(result.why, /MV Poseidon/);
  assert.match(result.why, /Bulk Carrier/);
  assert.match(result.why, /Marshall Islands/);
  assert.match(result.why, /AIS dark gap/);
});

test('maritime: why includes context when provided', () => {
  const result = explain(ais());
  assert.match(result.why, /sanctioned anchorage/i);
});

// ── Generic domain ─────────────────────────────────────────────────────────

test('generic: why includes severity, domain, and title', () => {
  const result = explain(generic());
  assert.match(result.why, /High/i);
  assert.match(result.why, /generic/i);
  assert.match(result.why, /BGP route leak/);
});

// ── Correlations ───────────────────────────────────────────────────────────

test('correlations: relatedEvents is empty when none provided', () => {
  const result = explain(eq());
  assert.deepEqual(result.relatedEvents, []);
});

test('correlations: related event titles appear in relatedEvents', () => {
  const corr: Correlation[] = [
    { id: 'c1', title: 'Tsunami advisory — Pacific', domain: 'weather', relevanceScore: 0.9 },
    { id: 'c2', title: 'Port closure — Yokohama', domain: 'maritime', relevanceScore: 0.5 },
  ];
  const result = explain(eq(), corr);
  assert.equal(result.relatedEvents.length, 2);
  assert.ok(result.relatedEvents.includes('Tsunami advisory — Pacific'));
  assert.ok(result.relatedEvents.includes('Port closure — Yokohama'));
});

test('correlations: sorted by relevanceScore descending', () => {
  const corr: Correlation[] = [
    { id: 'c1', title: 'Low relevance', domain: 'infra', relevanceScore: 0.2 },
    { id: 'c2', title: 'High relevance', domain: 'weather', relevanceScore: 0.95 },
  ];
  const result = explain(eq(), corr);
  assert.equal(result.relatedEvents[0], 'High relevance');
  assert.equal(result.relatedEvents[1], 'Low relevance');
});

// ── Confidence scoring ─────────────────────────────────────────────────────

test('confidence: high severity + multiple sources → high', () => {
  const result = explain(eq({ severity: 'critical', sources: ['USGS', 'JMA', 'EMSC'] }));
  assert.equal(result.confidence, 'high');
});

test('confidence: moderate severity → medium', () => {
  const result = explain(generic({ severity: 'moderate', sources: ['BGPmon'] }));
  assert.equal(result.confidence, 'medium');
});

test('confidence: low severity → low', () => {
  const result = explain(generic({ severity: 'low', sources: ['Monitor'] }));
  assert.equal(result.confidence, 'low');
});

test('confidence: high severity with single source → medium', () => {
  const result = explain(eq({ severity: 'high', sources: ['USGS'] }));
  assert.equal(result.confidence, 'medium');
});

// ── Headline and sources ───────────────────────────────────────────────────

test('headline: truncated to 120 chars with ellipsis', () => {
  const longTitle = 'A'.repeat(200);
  const result = explain(generic({ title: longTitle }));
  assert.ok(result.headline.length <= 120);
  assert.ok(result.headline.endsWith('…'));
});

test('sources: deduplicated', () => {
  const result = explain(eq({ sources: ['USGS', 'USGS', 'JMA'] }));
  assert.equal(result.sources.filter((s) => s === 'USGS').length, 1);
});

test('sources: matches event.sources', () => {
  const result = explain(av());
  assert.deepEqual(result.sources, ['FlightAware', 'ADS-B Exchange']);
});
