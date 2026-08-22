import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPlaceBrief,
  buildPlaceBriefFingerprint,
  buildStormPreparednessCacheKey,
  deserializeCachedPlaceBrief,
} from '../src/services/place-briefs.ts';
import type { LocalLogisticsSnapshot, LogisticsNode } from '../src/services/local-logistics-types.ts';
import type { SavedPlace } from '../src/services/saved-places.ts';

const NOW = Date.parse('2026-08-14T14:00:00.000Z');

const place: SavedPlace = {
  id: 'home', name: 'Home', lat: 41.61, lon: -86.72, radiusKm: 50,
  tags: ['home'], priority: 0, notes: '', offlinePinned: true, primary: true,
  source: 'manual', sortIndex: 1, createdAt: NOW, updatedAt: NOW,
};

const node: LogisticsNode = {
  id: 'fema:shelter:1', kind: 'shelter', category: 'shelter', name: 'North Shelter',
  lat: 41.62, lon: -86.72, distanceKm: 1.1, sourceRefs: [{ provider: 'fema', recordId: '1' }],
  capabilities: {}, source: 'FEMA Open Shelters', freshness: 'fresh', hazardCompatibility: 'evacuation',
  fetchedAt: new Date(NOW), operational: 'closed', inventory: 'unknown', power: 'unknown', access: 'unknown',
  verification: 'official', observedAt: new Date(NOW), retrievedAt: new Date(NOW),
  expiresAt: new Date('2030-08-14T15:00:00.000Z'), confidence: 'high',
  sourceUrl: 'https://gis.fema.gov/example', directoryOnly: false,
};

const snapshot: LocalLogisticsSnapshot = {
  schemaVersion: 2,
  queryFingerprint: 'v2|41.61000|-86.72000|25.00|shelter|3',
  placeId: 'home', placeName: 'Home', effectiveRadiusKm: 25, countyFips: '18091',
  categories: ['shelter'], sites: [], observations: [], nodes: [node],
  areaConditions: [{
    id: 'odin:18091:utility', type: 'power_outage', coverage: 'reported', countyFips: '18091',
    county: 'LaPorte', state: 'Indiana', customersOut: 42, observedAt: new Date(NOW),
    retrievedAt: new Date(NOW), expiresAt: new Date(NOW + 30 * 60_000), source: 'ornl-odin',
  }],
  providers: [], fetchedAt: new Date(NOW), isStale: false, isExpired: false,
  staleAgeMs: 0, source: 'network',
};

test('Lifelines enriches a place brief without promoting its headline or threat severity', () => {
  const brief = buildPlaceBrief(place, [], [], null, null, snapshot, NOW + 60_000, {
    packStatus: 'ready', changes: [],
  });

  assert.equal(brief.severity, 'low');
  assert.match(brief.headline, /No recent critical alerts/);
  assert.ok(brief.items.some((item) => item.label === 'Offline readiness' && /ready offline/.test(item.value)));
  assert.ok(brief.items.some((item) => /power context/.test(item.label) && /42 customers reported out/.test(item.value)));
  assert.ok(brief.items.some((item) => item.label === 'Known collection gaps' && /fuel stock/.test(item.value)));
});

test('absence of an accepted ODIN condition is explicit unknown, never an all-clear', () => {
  const brief = buildPlaceBrief(place, [], [], null, null, {
    ...snapshot,
    areaConditions: [],
  }, NOW + 60_000);
  const power = brief.items.find((item) => item.label === 'County power coverage');
  assert.ok(power);
  assert.match(power.value, /Unknown/);
  assert.match(power.value, /does not mean power is on/);
});

test('offline brief cache is bound to exact place geography and a short safety age', () => {
  const brief = buildPlaceBrief(place, [], [], null, null, snapshot, NOW);
  const cached = {
    schemaVersion: 2,
    placeId: place.id,
    placeFingerprint: buildPlaceBriefFingerprint(place),
    headline: brief.headline,
    severity: brief.severity,
    items: brief.items,
    generatedAtMs: NOW,
  };
  assert.ok(deserializeCachedPlaceBrief(cached, place, NOW + 5 * 60_000));

  const moved = { ...place, lat: place.lat + 0.5, updatedAt: place.updatedAt + 1 };
  assert.equal(deserializeCachedPlaceBrief(cached, moved, NOW + 5 * 60_000), null);
  assert.equal(deserializeCachedPlaceBrief(cached, place, NOW + 30 * 60_000), null);
});

test('storm preparedness memoization changes on same-ID coordinate or radius edits', () => {
  const original = buildStormPreparednessCacheKey(place, NOW);
  assert.notEqual(original, buildStormPreparednessCacheKey({ ...place, lat: place.lat + 0.5 }, NOW));
  assert.notEqual(original, buildStormPreparednessCacheKey({ ...place, radiusKm: place.radiusKm + 10 }, NOW));
});
