import assert from 'node:assert/strict';
import test from 'node:test';

import { clusterFacts } from '../situation-clustering.ts';
import type { NormalizedFact, SourceAttestation } from '../types.ts';

const NOW = 1_745_000_000_000;

function source(providerId: string): SourceAttestation {
  return { providerId, observedAt: NOW };
}

function quakeFact(overrides: Partial<NormalizedFact> = {}): NormalizedFact {
  return {
    id: 'q-1',
    domain: 'space',
    eventType: 'earthquake',
    claim: 'M5.5 quake',
    severity: 'moderate',
    occurredAt: NOW,
    lat: 35.68,
    lon: 139.69,
    locationPrecision: 'point',
    entities: ['JP'],
    sources: [source('usgs')],
    ...overrides,
  };
}

function weatherFact(overrides: Partial<NormalizedFact> = {}): NormalizedFact {
  return {
    id: 'w-1',
    domain: 'weather',
    eventType: 'severe-thunderstorm',
    claim: 'Severe TS warning',
    severity: 'high',
    occurredAt: NOW,
    lat: 41.6,
    lon: -86.7,
    locationPrecision: 'local',
    entities: ['US-IN'],
    sources: [source('nws')],
    ...overrides,
  };
}

// ── Basic clustering ────────────────────────────────────────────────────

test('cluster: two close facts in same domain merge into one situation', () => {
  const a = quakeFact();
  const b = quakeFact({
    id: 'q-2',
    claim: 'M5.4 aftershock',
    occurredAt: NOW + 30 * 60 * 1000,
    lat: 35.70,
    lon: 139.71,
    sources: [source('jma')],
  });
  const result = clusterFacts([a, b]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0]!.factIds.sort(), ['q-1', 'q-2']);
});

test('cluster: distant facts do not merge', () => {
  const a = quakeFact();
  const b = quakeFact({
    id: 'q-2',
    lat: -33.86, // Sydney — 7000+ km from Tokyo
    lon: 151.21,
    entities: ['AU'],
  });
  const result = clusterFacts([a, b]);
  assert.equal(result.length, 2);
});

test('cluster: time-distant facts do not merge', () => {
  const a = quakeFact();
  const b = quakeFact({
    id: 'q-2',
    occurredAt: NOW + 24 * 60 * 60 * 1000, // a day later
  });
  const result = clusterFacts([a, b]);
  assert.equal(result.length, 2);
});

test('cluster: different domains do not merge by default', () => {
  // Even at the same coordinates: a quake and a weather event aren't
  // the "same situation" unless they share an entity.
  const a = quakeFact({ entities: ['XX-1'] });
  const b = weatherFact({
    lat: a.lat,
    lon: a.lon,
    entities: ['XX-2'], // no shared entity
  });
  const result = clusterFacts([a, b]);
  assert.equal(result.length, 2);
});

test('cluster: cross-domain facts WITH shared entity DO merge (compound situations)', () => {
  // Plan invariant: cross-domain situations are first-class.
  const quake = quakeFact({ entities: ['JP'] });
  const tsunami: NormalizedFact = {
    id: 't-1',
    domain: 'humanitarian',
    eventType: 'tsunami-warning',
    claim: 'Tsunami warning for east coast',
    severity: 'critical',
    occurredAt: NOW + 5 * 60 * 1000,
    lat: 35.68,
    lon: 139.69,
    locationPrecision: 'country',
    entities: ['JP'],
    sources: [source('jma')],
  };
  const result = clusterFacts([quake, tsunami]);
  assert.equal(result.length, 1);
  const sit = result[0]!;
  assert.deepEqual(sit.domains.sort(), ['humanitarian', 'space']);
});

// ── requireSameEventType option ────────────────────────────────────────

test('cluster: requireSameEventType=true keeps different events apart even when close', () => {
  const ts = weatherFact();
  const tornado = weatherFact({
    id: 'w-2',
    eventType: 'tornado-warning',
    claim: 'Tornado warning',
    occurredAt: NOW + 10 * 60 * 1000,
  });
  const merged = clusterFacts([ts, tornado]);
  assert.equal(merged.length, 1, 'default should merge same-domain near facts');
  const split = clusterFacts([ts, tornado], { requireSameEventType: true });
  assert.equal(split.length, 2);
});

// ── Title + drivers ─────────────────────────────────────────────────────

test('title: single fact uses its claim verbatim', () => {
  const result = clusterFacts([quakeFact()]);
  assert.equal(result[0]!.title, 'M5.5 quake');
});

test('title: multi-member uses top severity claim + "+N more"', () => {
  const a = quakeFact({ severity: 'low' });
  const b = quakeFact({
    id: 'q-2',
    severity: 'critical',
    claim: 'M7.1 mainshock',
    occurredAt: NOW + 1000,
  });
  const result = clusterFacts([a, b]);
  assert.equal(result[0]!.title, 'M7.1 mainshock (+1 more)');
});

test('topDrivers: sorted by severity then recency', () => {
  const facts: NormalizedFact[] = [
    quakeFact({ id: 'q-low', severity: 'low', claim: 'low-severity claim' }),
    quakeFact({ id: 'q-crit', severity: 'critical', claim: 'critical claim', occurredAt: NOW - 60 * 1000 }),
    quakeFact({ id: 'q-mod', severity: 'moderate', claim: 'moderate claim' }),
  ];
  const result = clusterFacts(facts);
  assert.equal(result[0]!.topDrivers[0], 'critical claim');
  assert.equal(result[0]!.topDrivers[1], 'moderate claim');
});

// ── Trend ───────────────────────────────────────────────────────────────

test('trend: severity climbing over time → rising', () => {
  const facts: NormalizedFact[] = [
    quakeFact({ id: 'q-1', severity: 'info', occurredAt: NOW - 60 * 60 * 1000 }),
    quakeFact({ id: 'q-2', severity: 'low', occurredAt: NOW - 30 * 60 * 1000 }),
    quakeFact({ id: 'q-3', severity: 'high', occurredAt: NOW - 5 * 60 * 1000 }),
    quakeFact({ id: 'q-4', severity: 'critical', occurredAt: NOW }),
  ];
  const result = clusterFacts(facts);
  assert.equal(result[0]!.trend, 'rising');
});

test('trend: severity calming → falling', () => {
  const facts: NormalizedFact[] = [
    quakeFact({ id: 'q-1', severity: 'critical', occurredAt: NOW - 60 * 60 * 1000 }),
    quakeFact({ id: 'q-2', severity: 'high', occurredAt: NOW - 30 * 60 * 1000 }),
    quakeFact({ id: 'q-3', severity: 'low', occurredAt: NOW - 10 * 60 * 1000 }),
    quakeFact({ id: 'q-4', severity: 'info', occurredAt: NOW }),
  ];
  const result = clusterFacts(facts);
  assert.equal(result[0]!.trend, 'falling');
});

test('trend: flat severity → steady', () => {
  const facts: NormalizedFact[] = [
    quakeFact({ id: 'q-1', severity: 'moderate', occurredAt: NOW - 60 * 60 * 1000 }),
    quakeFact({ id: 'q-2', severity: 'moderate', occurredAt: NOW - 30 * 60 * 1000 }),
    quakeFact({ id: 'q-3', severity: 'moderate' }),
  ];
  const result = clusterFacts(facts);
  assert.equal(result[0]!.trend, 'steady');
});

test('trend: single-member situation is steady (insufficient data)', () => {
  const result = clusterFacts([quakeFact()]);
  assert.equal(result[0]!.trend, 'steady');
});

// ── Centroid ────────────────────────────────────────────────────────────

test('centroid: averages member coordinates', () => {
  // Within 50 km of each other so they cluster into one situation.
  const a = quakeFact({ id: 'q-1', lat: 35.50, lon: 139.50 });
  const b = quakeFact({ id: 'q-2', lat: 35.70, lon: 139.70 });
  const result = clusterFacts([a, b]);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.centroid!.lat, 35.6);
  assert.equal(result[0]!.centroid!.lon, 139.6);
});

test('centroid: undefined when no member has coords', () => {
  const a: NormalizedFact = {
    id: 'macro-1',
    domain: 'macro',
    eventType: 'rate-decision',
    claim: 'Fed +25bp',
    severity: 'moderate',
    occurredAt: NOW,
    locationPrecision: 'global',
    entities: ['USD'],
    sources: [source('fed')],
  };
  const result = clusterFacts([a]);
  assert.equal(result[0]!.centroid, undefined);
});

// ── Time window ─────────────────────────────────────────────────────────

test('timeWindow: spans earliest to latest member occurredAt', () => {
  const a = quakeFact({ occurredAt: NOW - 60 * 60 * 1000 });
  const b = quakeFact({ id: 'q-2', occurredAt: NOW });
  const result = clusterFacts([a, b]);
  assert.equal(result[0]!.timeWindow.from, NOW - 60 * 60 * 1000);
  assert.equal(result[0]!.timeWindow.to, NOW);
});

// ── Confidence + providers ─────────────────────────────────────────────

test('confidence: blended truth scores in 0-1', () => {
  const result = clusterFacts([quakeFact()]);
  assert.ok(result[0]!.confidence >= 0 && result[0]!.confidence <= 1);
});

test('contributingProviders: deduped across members', () => {
  const a = quakeFact({ sources: [source('usgs')] });
  const b = quakeFact({ id: 'q-2', sources: [source('usgs'), source('emsc')] });
  const result = clusterFacts([a, b]);
  assert.deepEqual(result[0]!.contributingProviders.sort(), ['emsc', 'usgs']);
});

// ── Contradictions surfaced, not averaged away ─────────────────────────

test('contradictions: collected from member contradictedBy', () => {
  const a = quakeFact({ contradictedBy: ['retraction-1'] });
  const b = quakeFact({ id: 'q-2', contradictedBy: ['retraction-2'] });
  const result = clusterFacts([a, b]);
  assert.deepEqual(
    result[0]!.contradictingFactIds.sort(),
    ['retraction-1', 'retraction-2'],
  );
});

// ── Custom score injection ─────────────────────────────────────────────

test('option: scoreOf override is used for confidence', () => {
  const result = clusterFacts([quakeFact()], { scoreOf: () => 0.42 });
  assert.equal(result[0]!.confidence, 0.42);
});

// ── Sorting / determinism ──────────────────────────────────────────────

test('output: sorted with strongest situation first', () => {
  const big = quakeFact({
    id: 'q-big',
    severity: 'critical',
    sources: [source('a'), source('b'), source('c')],
  });
  const small = quakeFact({
    id: 'q-small',
    severity: 'low',
    occurredAt: NOW + 24 * 60 * 60 * 1000, // separate situation
    lat: -10,
    lon: 100,
    entities: ['ID'],
  });
  const result = clusterFacts([big, small]);
  assert.equal(result.length, 2);
  assert.equal(result[0]!.factIds[0], 'q-big');
});

test('determinism: same input → same output', () => {
  const a = clusterFacts([quakeFact(), weatherFact()]);
  const b = clusterFacts([quakeFact(), weatherFact()]);
  assert.deepEqual(a, b);
});
