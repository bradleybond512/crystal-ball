import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SEVERITY_THRESHOLDS,
  adaptSavedPlace,
  aggregatePerPlaceThreats,
  infrastructureToIncoming,
  seismicToIncoming,
  weatherToIncoming,
  wildfireToIncoming,
  type DomainThreatSnapshot,
} from '../threat-aggregator.ts';
import type { SavedPlace as PersonalSavedPlace } from '../personal-impact.ts';

const NOW = Date.parse('2026-04-15T12:00:00Z');

const HOME: PersonalSavedPlace = {
  placeId: 'home',
  label: 'Home',
  latitude: 40,
  longitude: -75,
  role: 'home',
};

// ── adapter unit tests ────────────────────────────────────────────────

test('seismicToIncoming: M5+ pegs to the m5 threshold', () => {
  const inc = seismicToIncoming({
    id: 'us7000abcd', lat: 40.1, lon: -75, magnitude: 5.4, depthKm: 12, occurredAt: NOW, place: 'foo',
  });
  assert.equal(inc.severity, SEVERITY_THRESHOLDS.seismic.m5);
  assert.equal(inc.domain, 'seismic');
  assert.match(inc.description, /M5\.4/);
  // M5+ radius rule: 50 km.
  assert.equal(inc.location?.radiusKm, 50);
});

test('seismicToIncoming: null magnitude → severity 0', () => {
  const inc = seismicToIncoming({
    id: 'q', lat: 0, lon: 0, magnitude: null, depthKm: null, occurredAt: NOW,
  });
  assert.equal(inc.severity, 0);
});

test('seismicToIncoming: M3 picks the m3 threshold', () => {
  const inc = seismicToIncoming({
    id: 'q', lat: 0, lon: 0, magnitude: 3.4, depthKm: 5, occurredAt: NOW,
  });
  assert.equal(inc.severity, SEVERITY_THRESHOLDS.seismic.m3);
});

test('wildfireToIncoming: contained fire drops to contained-tier severity', () => {
  const inc = wildfireToIncoming({
    id: 'fire1', lat: 40, lon: -75, name: 'Foo Fire', acres: 5000,
    reportedAt: NOW, status: 'Contained',
  });
  assert.equal(inc.severity, SEVERITY_THRESHOLDS.wildfire.contained);
  assert.match(inc.description, /contained/i);
});

test('wildfireToIncoming: large active fire saturates at the cap', () => {
  const inc = wildfireToIncoming({
    id: 'fire2', lat: 40, lon: -75, name: 'Big', acres: 250_000,
    reportedAt: NOW, status: 'Active',
  });
  assert.equal(inc.severity, SEVERITY_THRESHOLDS.wildfire.max);
});

test('wildfireToIncoming: containment ≥95 still flips to contained', () => {
  const inc = wildfireToIncoming({
    id: 'fire3', lat: 40, lon: -75, name: 'Almost out', acres: 5000,
    reportedAt: NOW, status: 'Active', containment: 96,
  });
  assert.equal(inc.severity, SEVERITY_THRESHOLDS.wildfire.contained);
});

test('weatherToIncoming: NWS severity maps directly', () => {
  const inc = weatherToIncoming({
    id: 'w1', event: 'Tornado Warning', areaDesc: 'X County',
    effective: '2026-04-15T11:50:00Z', expires: '2026-04-15T12:30:00Z',
    severity: 'Extreme', centroidLat: 40.1, centroidLon: -75.1,
  });
  assert.ok(inc);
  assert.equal(inc!.severity, SEVERITY_THRESHOLDS.weather.Extreme);
  assert.equal(inc!.location?.radiusKm, 75);
});

test('weatherToIncoming: no centroid + no UGC → null (cannot match)', () => {
  const inc = weatherToIncoming({
    id: 'w2', event: 'Heat Advisory', areaDesc: 'Y',
    effective: '2026-04-15T11:00:00Z', expires: '2026-04-15T20:00:00Z',
    severity: 'Moderate',
  });
  assert.equal(inc, null);
});

test('weatherToIncoming: UGC-only event still produces a matchable IncomingEvent', () => {
  const inc = weatherToIncoming({
    id: 'w3', event: 'Air Quality Alert', areaDesc: 'Z',
    effective: '2026-04-15T08:00:00Z', expires: '2026-04-15T20:00:00Z',
    severity: 'Minor', ugcZoneId: 'PAZ001',
  });
  assert.ok(inc);
  assert.equal(inc!.location?.ugcZoneId, 'PAZ001');
});

test('infrastructureToIncoming: customer count drives severity tier', () => {
  const inc = infrastructureToIncoming({
    id: 'p1', kind: 'power', county: 'Bucks', lat: 40, lon: -75,
    outageStartedAt: NOW, affectedCustomers: 150_000,
  });
  assert.equal(inc.severity, SEVERITY_THRESHOLDS.infrastructure.huge);
  assert.deepEqual(inc.affectedUtilities, ['power']);
});

test('infrastructureToIncoming: tiny outage → small tier', () => {
  const inc = infrastructureToIncoming({
    id: 'p2', kind: 'water', county: 'Bucks', lat: 40, lon: -75,
    outageStartedAt: NOW, affectedCustomers: 50,
  });
  assert.equal(inc.severity, SEVERITY_THRESHOLDS.infrastructure.small);
});

// ── aggregatePerPlaceThreats end-to-end ──────────────────────────────

test('aggregator: bucket counts split correctly across domains', () => {
  const snapshot: DomainThreatSnapshot = {
    seismic: [
      { id: 'q1', lat: 40.05, lon: -75.05, magnitude: 5.5, depthKm: 10, occurredAt: NOW },
    ],
    wildfire: [
      { id: 'f1', lat: 40.05, lon: -75.05, name: 'Local', acres: 1500, reportedAt: NOW, status: 'Active' },
    ],
    weather: [
      { id: 'w1', event: 'Severe Thunderstorm Warning', areaDesc: 'Bucks',
        effective: '2026-04-15T11:00:00Z', expires: '2026-04-15T13:00:00Z',
        severity: 'Severe', centroidLat: 40.1, centroidLon: -75.05 },
    ],
    infrastructure: [
      { id: 'p1', kind: 'power', county: 'Bucks', lat: 40.05, lon: -75.05,
        outageStartedAt: NOW, affectedCustomers: 12_000 },
    ],
  };
  const summary = aggregatePerPlaceThreats(HOME, snapshot, { now: () => NOW + 1000 });
  assert.equal(summary.placeId, 'home');
  assert.equal(summary.totalThreatCount, 4);
  assert.equal(summary.domainBreakdown.seismic, 1);
  assert.equal(summary.domainBreakdown.wildfire, 1);
  assert.equal(summary.domainBreakdown.weather, 1);
  assert.equal(summary.domainBreakdown.infrastructure, 1);
});

test('aggregator: distant events outside radius get filtered out', () => {
  // Quake 600 km away from a M3 (radius=25 km) → outside reach.
  const snapshot: DomainThreatSnapshot = {
    seismic: [
      { id: 'q-far', lat: 50, lon: -75, magnitude: 3.2, depthKm: 10, occurredAt: NOW },
    ],
  };
  const summary = aggregatePerPlaceThreats(HOME, snapshot);
  assert.equal(summary.totalThreatCount, 0);
});

test('aggregator: empty snapshot → zeros, no crash', () => {
  const summary = aggregatePerPlaceThreats(HOME, {});
  assert.equal(summary.totalThreatCount, 0);
  assert.equal(summary.severityBuckets.critical, 0);
  assert.equal(summary.topThreats.length, 0);
});

test('aggregator: topThreats capped at 5', () => {
  const fires: DomainThreatSnapshot['wildfire'] = Array.from({ length: 12 }, (_, i) => ({
    id: `f${i}`, lat: 40.05, lon: -75.05, name: `Fire ${i}`, acres: 50_000,
    reportedAt: NOW, status: 'Active',
  }));
  const summary = aggregatePerPlaceThreats(HOME, { wildfire: fires });
  assert.equal(summary.topThreats.length, 5);
  assert.ok(summary.totalThreatCount >= 12);
});

test('aggregator: severity ordering — critical first in topThreats', () => {
  const snapshot: DomainThreatSnapshot = {
    seismic: [
      { id: 'q-low', lat: 40.05, lon: -75, magnitude: 3.2, depthKm: 5, occurredAt: NOW },
    ],
    weather: [
      { id: 'w-extreme', event: 'Tornado Warning', areaDesc: 'X',
        effective: '2026-04-15T11:00:00Z', expires: '2026-04-15T12:00:00Z',
        severity: 'Extreme', centroidLat: 40.05, centroidLon: -75.05 },
    ],
  };
  const summary = aggregatePerPlaceThreats(HOME, snapshot);
  assert.equal(summary.topThreats[0]?.severity, 'critical');
});

// ── adaptSavedPlace ─────────────────────────────────────────────────

test('adaptSavedPlace: reads role from tags', () => {
  const adapted = adaptSavedPlace({ id: 'p1', name: 'X', lat: 0, lon: 0, tags: ['home', 'family'] });
  assert.equal(adapted.role, 'home');
  assert.equal(adapted.label, 'X');
});

test('adaptSavedPlace: no tags → role "other"', () => {
  const adapted = adaptSavedPlace({ id: 'p1', name: 'X', lat: 0, lon: 0 });
  assert.equal(adapted.role, 'other');
});

// ── JSON serializability ────────────────────────────────────────────

test('per-place summary is JSON-serializable', () => {
  const summary = aggregatePerPlaceThreats(HOME, {
    seismic: [{ id: 'q', lat: 40, lon: -75, magnitude: 5.5, depthKm: 10, occurredAt: NOW }],
  });
  const round = structuredClone(summary);
  assert.equal(round.placeId, 'home');
});
