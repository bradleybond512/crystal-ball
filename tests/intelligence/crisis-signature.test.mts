/**
 * Tests for CrisisSignatureLibrary — pattern fingerprinting for the
 * 8 built-in crisis types.
 *
 * Pure service tests. Stubs localStorage at module load + a fake
 * CorrelationStore so the domain-cascade feature is fully controllable.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const __storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => __storage.get(k) ?? null,
  setItem: (k: string, v: string) => { __storage.set(k, v); },
  removeItem: (k: string) => { __storage.delete(k); },
  clear: () => { __storage.clear(); },
  get length() { return __storage.size; },
  key: (i: number) => [...__storage.keys()][i] ?? null,
} as Storage;

import {
  CrisisSignatureLibrary,
  __internals,
  __resetCrisisSignatureLibrarySingleton,
  getCrisisSignatureLibrary,
  type CrisisSignature,
  type PatternFeature,
  type SignatureMatch,
} from '../../src/services/intelligence/crisis-signature.ts';
import type { ObservationEvent, ObservationSeverity } from '../../src/services/intelligence/observation-adapters.ts';
import type { CorrelatedPair, EdgeType } from '../../src/services/intelligence/correlate-engine.ts';
import { CorrelationStore } from '../../src/services/intelligence/correlation-store.ts';

// ── Helpers ───────────────────────────────────────────────────────────

const NOW = 1_745_000_000_000;
const HOUR = 60 * 60 * 1000;

function makeObs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: `obs-${Math.random().toString(36).slice(2, 8)}`,
    sourceId: 'src-a',
    domain: 'weather',
    timestamp: NOW,
    severity: 'MEDIUM',
    title: 'fixture',
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function makeStoreWith(pairs: CorrelatedPair[] = []): CorrelationStore {
  const store = new CorrelationStore({ storage: null });
  for (const p of pairs) store.add(p);
  return store;
}

function makePair(
  domainA: string,
  domainB: string,
  edgeType: EdgeType = 'co-located',
): CorrelatedPair {
  return {
    ruleId: 'test-rule',
    edgeType,
    confidence: 0.8,
    eventA: makeObs({ id: `a-${Math.random()}`, domain: domainA }),
    eventB: makeObs({ id: `b-${Math.random()}`, domain: domainB }),
    detectedAt: new Date(NOW),
  };
}

function freshLibrary(
  options: ConstructorParameters<typeof CrisisSignatureLibrary>[0] = {},
): CrisisSignatureLibrary {
  __storage.clear();
  return new CrisisSignatureLibrary({
    clock: () => NOW,
    correlationStore: makeStoreWith(),
    ...options,
  });
}

// Pre-built feature sets the tests reuse for the synthetic signature.
const ALL_FEATURES: PatternFeature[] = [
  { featureType: 'rapid-severity-escalation', weight: 1.0, required: false },
  { featureType: 'multi-source-corroboration', weight: 1.0, required: false },
  { featureType: 'geographic-clustering', weight: 1.0, required: false },
  { featureType: 'domain-cascade', weight: 1.0, required: false },
  { featureType: 'temporal-clustering', weight: 1.0, required: false },
  { featureType: 'entity-recurrence', weight: 1.0, required: false },
];

function makeSyntheticSignature(features: PatternFeature[] = ALL_FEATURES): CrisisSignature {
  return {
    id: 'synthetic',
    name: 'Synthetic signature',
    description: 'used by tests',
    domain: 'weather',
    patternFeatures: features,
    historicalExamples: ['fixture'],
    avgDurationHours: 1,
    peakSeverity: 'HIGH',
    cascadeRisk: [],
    confidenceThreshold: 0.5,
  };
}

// ── Built-in catalog ─────────────────────────────────────────────────

test('built-in catalog exposes 8 signatures with the documented ids', () => {
  const ids = __internals.BUILT_IN_SIGNATURES.map((s) => s.id).sort();
  assert.deepEqual(ids, [
    'financial-contagion',
    'infrastructure-cyberattack',
    'major-earthquake-cascade',
    'maritime-conflict-escalation',
    'pacific-tsunami-precursor',
    'pandemic-emergence',
    'solar-geomagnetic-storm',
    'wildfire-firestorm',
  ]);
});

test('every built-in signature has a non-empty pattern + cascade list', () => {
  for (const s of __internals.BUILT_IN_SIGNATURES) {
    assert.ok(s.patternFeatures.length > 0, `${s.id} has no patternFeatures`);
    assert.ok(s.historicalExamples.length > 0, `${s.id} has no historicalExamples`);
    assert.ok(s.cascadeRisk.length > 0, `${s.id} has no cascadeRisk`);
    assert.ok(s.confidenceThreshold > 0 && s.confidenceThreshold <= 1);
  }
});

test('getAllSignatures returns defensive copies', () => {
  const lib = freshLibrary();
  const sigs = lib.getAllSignatures();
  sigs[0]!.name = 'mutated';
  const refetched = lib.getAllSignatures();
  assert.notEqual(refetched[0]!.name, 'mutated');
});

test('getSignature returns undefined for unknown id', () => {
  const lib = freshLibrary();
  assert.equal(lib.getSignature('does-not-exist'), undefined);
});

test('getSignature returns the canonical entry by id', () => {
  const lib = freshLibrary();
  const s = lib.getSignature('financial-contagion');
  assert.ok(s);
  assert.equal(s!.domain, 'finance');
});

// ── Feature detectors ────────────────────────────────────────────────

test('rapid-severity-escalation true when severity rises ≥2 bands within 2h', () => {
  const obs = [
    makeObs({ id: 'a', severity: 'LOW', timestamp: NOW }),
    makeObs({ id: 'b', severity: 'CRITICAL', timestamp: NOW + 30 * 60 * 1000 }),
  ];
  assert.equal(__internals.detectRapidEscalation(obs), true);
});

test('rapid-severity-escalation false when escalation exceeds 2h window', () => {
  const obs = [
    makeObs({ id: 'a', severity: 'LOW', timestamp: NOW }),
    makeObs({ id: 'b', severity: 'CRITICAL', timestamp: NOW + 3 * HOUR }),
  ];
  assert.equal(__internals.detectRapidEscalation(obs), false);
});

test('rapid-severity-escalation false for a single observation', () => {
  assert.equal(__internals.detectRapidEscalation([makeObs()]), false);
});

test('multi-source-corroboration true at exactly 3 distinct sources', () => {
  const obs = [
    makeObs({ sourceId: 's1' }),
    makeObs({ sourceId: 's2' }),
    makeObs({ sourceId: 's3' }),
  ];
  assert.equal(__internals.detectMultiSourceCorroboration(obs), true);
});

test('multi-source-corroboration false at 2 distinct sources', () => {
  const obs = [
    makeObs({ sourceId: 's1' }),
    makeObs({ sourceId: 's2' }),
    makeObs({ sourceId: 's2' }),
  ];
  assert.equal(__internals.detectMultiSourceCorroboration(obs), false);
});

test('geographic-clustering true when ≥3 observations share a 500km radius', () => {
  const obs = [
    makeObs({ location: { lat: 35.0, lon: 139.0 } }),
    makeObs({ location: { lat: 35.5, lon: 139.5 } }),
    makeObs({ location: { lat: 36.0, lon: 140.0 } }),
  ];
  assert.equal(__internals.detectGeographicClustering(obs), true);
});

test('geographic-clustering false when observations span the globe', () => {
  const obs = [
    makeObs({ location: { lat: 35, lon: 139 } }),
    makeObs({ location: { lat: -33, lon: 151 } }),
    makeObs({ location: { lat: 40, lon: -74 } }),
  ];
  assert.equal(__internals.detectGeographicClustering(obs), false);
});

test('geographic-clustering false when fewer than 3 observations carry a location', () => {
  const obs = [
    makeObs({ location: { lat: 35, lon: 139 } }),
    makeObs(),
  ];
  assert.equal(__internals.detectGeographicClustering(obs), false);
});

test('domain-cascade true when correlation store has cross-domain pairs', () => {
  const store = makeStoreWith([makePair('weather', 'infrastructure')]);
  const obs = [makeObs({ domain: 'weather' }), makeObs({ domain: 'infrastructure' })];
  assert.equal(__internals.detectDomainCascade(obs, store), true);
});

test('domain-cascade false when no correlations match the observation domains', () => {
  const store = makeStoreWith([makePair('cyber', 'finance')]);
  const obs = [makeObs({ domain: 'weather' }), makeObs({ domain: 'wildfire' })];
  assert.equal(__internals.detectDomainCascade(obs, store), false);
});

test('domain-cascade false when only one domain is present', () => {
  const store = makeStoreWith([makePair('weather', 'infrastructure')]);
  const obs = [makeObs({ domain: 'weather' }), makeObs({ domain: 'weather' })];
  assert.equal(__internals.detectDomainCascade(obs, store), false);
});

test('temporal-clustering true when ≥5 observations fall inside a 1h window', () => {
  const obs = Array.from({ length: 5 }, (_, i) => makeObs({ id: `o-${i}`, timestamp: NOW + i * 10 * 60 * 1000 }));
  assert.equal(__internals.detectTemporalClustering(obs), true);
});

test('temporal-clustering false when observations span > 1h', () => {
  const obs = Array.from({ length: 5 }, (_, i) => makeObs({ id: `o-${i}`, timestamp: NOW + i * 30 * 60 * 1000 }));
  assert.equal(__internals.detectTemporalClustering(obs), false);
});

test('entity-recurrence true when the same entity appears ≥3 times', () => {
  const obs = [
    makeObs({ entityIds: ['vessel-1'] }),
    makeObs({ entityIds: ['vessel-1'] }),
    makeObs({ entityIds: ['vessel-1', 'other'] }),
  ];
  assert.equal(__internals.detectEntityRecurrence(obs), true);
});

test('entity-recurrence false when no entity reaches the threshold', () => {
  const obs = [
    makeObs({ entityIds: ['e1'] }),
    makeObs({ entityIds: ['e2'] }),
    makeObs({ entityIds: ['e3'] }),
  ];
  assert.equal(__internals.detectEntityRecurrence(obs), false);
});

// ── Match scoring ───────────────────────────────────────────────────

test('matchObservations returns matches sorted by descending score', () => {
  // Two synthetic signatures: one all-match, one half-match.
  const allMatch = makeSyntheticSignature();
  const halfMatch: CrisisSignature = {
    ...makeSyntheticSignature([
      { featureType: 'rapid-severity-escalation', weight: 1.0, required: false },
      { featureType: 'entity-recurrence', weight: 1.0, required: false },
    ]),
    id: 'half',
    name: 'Half match',
  };
  const lib = freshLibrary({ signatures: [halfMatch, allMatch] });
  // Construct observations that satisfy every feature so allMatch wins.
  const obs = buildHotCluster();
  const matches = lib.matchObservations(obs);
  assert.ok(matches.length >= 1);
  assert.ok(matches[0]!.matchScore >= (matches[1]?.matchScore ?? 0));
});

test('matchScore is matchedWeight / totalWeight for a fully-matched set', () => {
  const lib = freshLibrary({
    signatures: [makeSyntheticSignature()],
    correlationStore: makeStoreWith([makePair('weather', 'infrastructure')]),
  });
  const matches = lib.matchObservations(buildHotCluster());
  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.matchScore, 1);
  assert.equal(matches[0]!.confidence, 'high');
});

test('matchedFeatures + missingFeatures partition every pattern feature', () => {
  const lib = freshLibrary({
    signatures: [makeSyntheticSignature()],
    correlationStore: makeStoreWith([makePair('weather', 'infrastructure')]),
  });
  const matches = lib.matchObservations(buildHotCluster());
  const m = matches[0]!;
  assert.equal(m.matchedFeatures.length + m.missingFeatures.length, 6);
});

test('matchObservations excludes signatures with zero matched features', () => {
  const lib = freshLibrary({ signatures: [makeSyntheticSignature()] });
  // Single observation cannot satisfy any feature ≥ threshold.
  const matches = lib.matchObservations([makeObs({ id: 'lone' })]);
  assert.equal(matches.length, 0);
});

test('required features missing pin the match to "low" confidence', () => {
  const sig = makeSyntheticSignature([
    { featureType: 'rapid-severity-escalation', weight: 1.0, required: true },
    { featureType: 'multi-source-corroboration', weight: 1.0, required: false },
    { featureType: 'temporal-clustering', weight: 1.0, required: false },
  ]);
  const lib = freshLibrary({ signatures: [sig] });
  // Multi-source + temporal clustering, but no rapid escalation.
  const obs: ObservationEvent[] = [
    makeObs({ sourceId: 's1', timestamp: NOW }),
    makeObs({ sourceId: 's2', timestamp: NOW + 5_000 }),
    makeObs({ sourceId: 's3', timestamp: NOW + 10_000 }),
    makeObs({ sourceId: 's4', timestamp: NOW + 15_000 }),
    makeObs({ sourceId: 's5', timestamp: NOW + 20_000 }),
  ];
  const matches = lib.matchObservations(obs);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.confidence, 'low');
});

test('confidence bands: >=0.8 high, [0.5, 0.8) medium, <0.5 low', () => {
  assert.equal(__internals.confidenceFor(0.85), 'high');
  assert.equal(__internals.confidenceFor(0.8), 'high');
  assert.equal(__internals.confidenceFor(0.65), 'medium');
  assert.equal(__internals.confidenceFor(0.5), 'medium');
  assert.equal(__internals.confidenceFor(0.49), 'low');
  assert.equal(__internals.confidenceFor(0), 'low');
});

// ── Persistence + reads ────────────────────────────────────────────

test('getRecentMatches returns newest-first up to the limit', () => {
  const lib = freshLibrary({ signatures: [makeSyntheticSignature()] });
  lib.matchObservations(buildHotCluster());
  lib.matchObservations(buildHotCluster());
  lib.matchObservations(buildHotCluster());
  const recent = lib.getRecentMatches(2);
  assert.equal(recent.length, 2);
});

test('getRecentMatches(0) returns an empty array', () => {
  const lib = freshLibrary({ signatures: [makeSyntheticSignature()] });
  lib.matchObservations(buildHotCluster());
  assert.deepEqual(lib.getRecentMatches(0), []);
});

test('matches persist across library instances', () => {
  __storage.clear();
  const a = new CrisisSignatureLibrary({
    signatures: [makeSyntheticSignature()],
    correlationStore: makeStoreWith([makePair('weather', 'infrastructure')]),
    clock: () => NOW,
  });
  a.matchObservations(buildHotCluster());
  const b = new CrisisSignatureLibrary({
    signatures: [makeSyntheticSignature()],
    correlationStore: makeStoreWith([makePair('weather', 'infrastructure')]),
    clock: () => NOW,
  });
  assert.ok(b.getRecentMatches(5).length > 0);
});

test('corrupt persisted payload is ignored without throwing', () => {
  __storage.clear();
  __storage.set('wm-crisis-signatures', 'not-json');
  const lib = new CrisisSignatureLibrary({ clock: () => NOW });
  assert.doesNotThrow(() => lib.getRecentMatches(5));
  assert.equal(lib.getRecentMatches(5).length, 0);
});

test('recent-match ring buffer caps at MAX_RECENT_MATCHES', () => {
  const lib = freshLibrary({
    signatures: [makeSyntheticSignature()],
    correlationStore: makeStoreWith([makePair('weather', 'infrastructure')]),
  });
  const cap = __internals.MAX_RECENT_MATCHES;
  // Each match pushes one row; over-fill the buffer.
  for (let i = 0; i < cap + 10; i += 1) lib.matchObservations(buildHotCluster());
  assert.ok(lib.getRecentMatches(cap + 10).length <= cap);
});

// ── Subscribe ───────────────────────────────────────────────────────

test('subscribe fires on every successful match pass', () => {
  const lib = freshLibrary({ signatures: [makeSyntheticSignature()] });
  let calls = 0;
  lib.subscribe(() => { calls += 1; });
  lib.matchObservations(buildHotCluster());
  lib.matchObservations(buildHotCluster());
  assert.equal(calls, 2);
});

test('subscribe does not fire when no signatures match', () => {
  const lib = freshLibrary({ signatures: [makeSyntheticSignature()] });
  let calls = 0;
  lib.subscribe(() => { calls += 1; });
  lib.matchObservations([makeObs({ id: 'lone' })]);
  assert.equal(calls, 0);
});

test('subscribe returns an unsubscribe fn', () => {
  const lib = freshLibrary({ signatures: [makeSyntheticSignature()] });
  let calls = 0;
  const off = lib.subscribe(() => { calls += 1; });
  lib.matchObservations(buildHotCluster());
  off();
  lib.matchObservations(buildHotCluster());
  assert.equal(calls, 1);
});

test('subscribe listener exceptions are isolated', () => {
  const lib = freshLibrary({ signatures: [makeSyntheticSignature()] });
  let second = false;
  lib.subscribe(() => { throw new Error('boom'); });
  lib.subscribe(() => { second = true; });
  lib.matchObservations(buildHotCluster());
  assert.equal(second, true);
});

// ── Singleton ───────────────────────────────────────────────────────

test('getCrisisSignatureLibrary returns a stable singleton', () => {
  __resetCrisisSignatureLibrarySingleton();
  const a = getCrisisSignatureLibrary();
  const b = getCrisisSignatureLibrary();
  assert.equal(a, b);
});

// ── Helpers (local) ─────────────────────────────────────────────────

/** Build a 5-observation cluster that satisfies every PatternFeature
 *  the synthetic signature lists. */
function buildHotCluster(): ObservationEvent[] {
  return [
    makeObs({ id: 'h1', sourceId: 's1', severity: 'LOW' as ObservationSeverity, timestamp: NOW, domain: 'weather',
      location: { lat: 35, lon: 139 }, entityIds: ['e-1'] }),
    makeObs({ id: 'h2', sourceId: 's2', severity: 'HIGH' as ObservationSeverity, timestamp: NOW + 10 * 60 * 1000, domain: 'weather',
      location: { lat: 35.5, lon: 139.5 }, entityIds: ['e-1'] }),
    makeObs({ id: 'h3', sourceId: 's3', severity: 'CRITICAL' as ObservationSeverity, timestamp: NOW + 20 * 60 * 1000, domain: 'infrastructure',
      location: { lat: 36, lon: 140 }, entityIds: ['e-1'] }),
    makeObs({ id: 'h4', sourceId: 's4', severity: 'MEDIUM' as ObservationSeverity, timestamp: NOW + 30 * 60 * 1000, domain: 'weather',
      location: { lat: 35.2, lon: 139.2 }, entityIds: ['e-1'] }),
    makeObs({ id: 'h5', sourceId: 's5', severity: 'HIGH' as ObservationSeverity, timestamp: NOW + 40 * 60 * 1000, domain: 'weather',
      location: { lat: 35.8, lon: 139.8 }, entityIds: ['e-1'] }),
  ];
}

// Teardown — keep singletons + storage clean for unrelated suites.
test('teardown', () => {
  __resetCrisisSignatureLibrarySingleton();
  __storage.clear();
  const _m: SignatureMatch | undefined = undefined;
  void _m;
  assert.ok(true);
});
