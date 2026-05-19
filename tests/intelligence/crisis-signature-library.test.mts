/**
 * Tests for CrisisSignatureLibrary — fingerprint-driven scoring of
 * crisis patterns over an observation window.
 *
 * The service is built with injectable storage so the tests never
 * touch real localStorage.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CrisisSignatureLibrary,
  MATCH_THRESHOLD,
  MAX_CUSTOM_SIGNATURES,
  STORAGE_KEY,
  __internals,
  getCrisisSignatureLibrary,
  type CrisisSignature,
  type SignatureFeature,
  type StorageLike,
} from '../../src/services/intelligence/crisis-signature-library.ts';
import type { ObservationEvent, ObservationSeverity } from '../../src/types/intelligence.ts';

// ── Fakes ─────────────────────────────────────────────────────────────

function makeFakeStorage(seed: Record<string, string> = {}): StorageLike & {
  raw: Map<string, string>;
} {
  const raw = new Map<string, string>(Object.entries(seed));
  return {
    raw,
    getItem(key: string): string | null { return raw.get(key) ?? null; },
    setItem(key: string, value: string): void { raw.set(key, value); },
    removeItem(key: string): void { raw.delete(key); },
  };
}

const NOW = 1_745_000_000_000;

function obs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'o-1',
    sourceId: 'test',
    domain: 'finance',
    timestamp: NOW,
    severity: 'HIGH',
    title: 'fixture',
    raw: {},
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function feature(
  featureType: SignatureFeature['featureType'],
  weight: number,
  params: Record<string, unknown>,
): SignatureFeature {
  return { featureType, weight, params };
}

function customSignature(overrides: Partial<CrisisSignature> = {}): CrisisSignature {
  return {
    id: 'cust-1',
    name: 'Test',
    domain: 'finance',
    fingerprint: [feature('domain-elevation', 1, { domain: 'finance', minCount: 1 })],
    historicalExamples: [],
    avgLeadTimeHours: 10,
    confidence: 0.5,
    ...overrides,
  };
}

// ── Built-in catalog ─────────────────────────────────────────────────

test('built-in catalog contains 8 signatures', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  const all = lib.getSignatures();
  assert.equal(all.length, 8);
});

test('built-in catalog covers the spec\'s 8 named patterns', () => {
  const names = __internals.BUILT_IN_SIGNATURES.map((s) => s.name.toLowerCase());
  for (const expected of [
    'financial contagion',
    'pandemic emergence',
    'coup pattern',
    'regional conflict escalation',
    'supply chain cascade',
    'cyber infrastructure attack',
    'natural disaster compound',
    'social unrest spread',
  ]) {
    assert.ok(names.includes(expected), `missing built-in: ${expected}`);
  }
});

test('every built-in signature has a non-empty fingerprint and lead time', () => {
  for (const sig of __internals.BUILT_IN_SIGNATURES) {
    assert.ok(sig.fingerprint.length > 0, `${sig.id} has no features`);
    assert.ok(sig.avgLeadTimeHours > 0, `${sig.id} has zero lead time`);
    const totalWeight = sig.fingerprint.reduce((acc, f) => acc + f.weight, 0);
    assert.ok(totalWeight > 0, `${sig.id} has zero total weight`);
  }
});

test('built-in signatures use only the four supported feature types', () => {
  const valid: ReadonlySet<string> = new Set(['domain-elevation', 'entity-spike', 'geo-cluster', 'time-pattern']);
  for (const sig of __internals.BUILT_IN_SIGNATURES) {
    for (const feat of sig.fingerprint) {
      assert.ok(valid.has(feat.featureType), `${sig.id} uses bogus featureType ${feat.featureType}`);
    }
  }
});

test('getSignature returns built-in by id', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  const sig = lib.getSignature('builtin-cyber-infrastructure-attack');
  assert.ok(sig);
  assert.equal(sig.name, 'Cyber infrastructure attack');
});

test('getSignature returns undefined for unknown id', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  assert.equal(lib.getSignature('does-not-exist'), undefined);
});

// ── addSignature / removeSignature ───────────────────────────────────

test('addSignature stores a custom signature and returns a defensive copy', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  const stored = lib.addSignature(customSignature());
  assert.equal(lib.getSignatures().length, 9, 'built-ins + 1 custom');
  stored.name = 'mutated';
  assert.equal(lib.getSignature('cust-1')?.name, 'Test');
});

test('addSignature replacing same id updates in place', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature());
  lib.addSignature(customSignature({ name: 'v2' }));
  assert.equal(lib.getSignatures().length, 9);
  assert.equal(lib.getSignature('cust-1')?.name, 'v2');
});

test('removeSignature returns true on success and false for unknown', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature());
  assert.equal(lib.removeSignature('cust-1'), true);
  assert.equal(lib.removeSignature('cust-1'), false);
});

test('removeSignature does not touch built-ins', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  assert.equal(lib.removeSignature('builtin-financial-contagion'), false);
  assert.ok(lib.getSignature('builtin-financial-contagion'));
});

test('custom signature cap at MAX_CUSTOM_SIGNATURES evicts oldest', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  for (let i = 0; i < MAX_CUSTOM_SIGNATURES + 10; i += 1) {
    lib.addSignature(customSignature({ id: `c-${i}` }));
  }
  assert.equal(lib.getSignatures().length - 8, MAX_CUSTOM_SIGNATURES);
  assert.equal(lib.getSignature('c-0'), undefined, 'oldest custom should be evicted');
});

// ── matchSignatures: feature evaluators ──────────────────────────────

test('matchSignatures: domain-elevation fires when severity + count thresholds met', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature({
    id: 'cust-de', fingerprint: [
      feature('domain-elevation', 1, { domain: 'finance', minCount: 3, minSeverity: 'HIGH' }),
    ],
  }));
  const events: ObservationEvent[] = Array.from({ length: 4 }, (_, i) => obs({ id: `o-${i}`, severity: 'HIGH' }));
  const matches = lib.matchSignatures(events);
  assert.ok(matches.some((m) => m.signature.id === 'cust-de'));
});

test('matchSignatures: domain-elevation skips events with severity below threshold', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature({
    id: 'cust-de', fingerprint: [
      feature('domain-elevation', 1, { domain: 'finance', minCount: 2, minSeverity: 'CRITICAL' }),
    ],
  }));
  const events: ObservationEvent[] = Array.from({ length: 5 }, (_, i) => obs({ id: `o-${i}`, severity: 'HIGH' }));
  const matches = lib.matchSignatures(events).filter((m) => m.signature.id === 'cust-de');
  assert.equal(matches.length, 0);
});

test('matchSignatures: domain-elevation requires matching domain', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature({
    id: 'cust-de', fingerprint: [
      feature('domain-elevation', 1, { domain: 'cyber', minCount: 1 }),
    ],
  }));
  const events: ObservationEvent[] = [obs({ domain: 'finance' })];
  assert.equal(lib.matchSignatures(events).filter((m) => m.signature.id === 'cust-de').length, 0);
});

test('matchSignatures: entity-spike fires when an entity appears minCount times', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature({
    id: 'cust-es', fingerprint: [feature('entity-spike', 1, { minCount: 3 })],
  }));
  const events: ObservationEvent[] = Array.from({ length: 4 }, (_, i) => obs({
    id: `o-${i}`, entityIds: ['acme-corp'],
  }));
  assert.ok(lib.matchSignatures(events).some((m) => m.signature.id === 'cust-es'));
});

test('matchSignatures: entity-spike with explicit entityId filters', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature({
    id: 'cust-es', fingerprint: [feature('entity-spike', 1, { entityId: 'target', minCount: 2 })],
  }));
  const noise: ObservationEvent[] = Array.from({ length: 5 }, (_, i) => obs({
    id: `o-${i}`, entityIds: ['noise'],
  }));
  assert.equal(lib.matchSignatures(noise).filter((m) => m.signature.id === 'cust-es').length, 0);
  noise.push(obs({ id: 'o-t1', entityIds: ['target'] }));
  noise.push(obs({ id: 'o-t2', entityIds: ['target'] }));
  assert.ok(lib.matchSignatures(noise).some((m) => m.signature.id === 'cust-es'));
});

test('matchSignatures: geo-cluster fires when fixed centre matches enough nearby observations', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature({
    id: 'cust-gc', fingerprint: [
      feature('geo-cluster', 1, { lat: 35.6762, lon: 139.6503, radiusKm: 50, minCount: 3 }),
    ],
  }));
  const events: ObservationEvent[] = [
    obs({ id: 'o-1', location: { lat: 35.68, lon: 139.65 } }),
    obs({ id: 'o-2', location: { lat: 35.69, lon: 139.66 } }),
    obs({ id: 'o-3', location: { lat: 35.70, lon: 139.67 } }),
  ];
  assert.ok(lib.matchSignatures(events).some((m) => m.signature.id === 'cust-gc'));
});

test('matchSignatures: geo-cluster anchored to any observation finds dense clusters', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature({
    id: 'cust-gc', fingerprint: [
      feature('geo-cluster', 1, { radiusKm: 50, minCount: 3 }),
    ],
  }));
  const events: ObservationEvent[] = [
    obs({ id: 'o-1', location: { lat: 0, lon: 0 } }),
    obs({ id: 'o-2', location: { lat: 35.68, lon: 139.65 } }),
    obs({ id: 'o-3', location: { lat: 35.69, lon: 139.66 } }),
    obs({ id: 'o-4', location: { lat: 35.70, lon: 139.67 } }),
  ];
  assert.ok(lib.matchSignatures(events).some((m) => m.signature.id === 'cust-gc'));
});

test('matchSignatures: geo-cluster needs at least minCount located observations', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature({
    id: 'cust-gc', fingerprint: [feature('geo-cluster', 1, { minCount: 3, radiusKm: 50 })],
  }));
  const events: ObservationEvent[] = [obs({ id: 'o-1' /* no location */ })];
  assert.equal(lib.matchSignatures(events).filter((m) => m.signature.id === 'cust-gc').length, 0);
});

test('matchSignatures: geo-cluster ignores observations outside the radius', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature({
    id: 'cust-gc', fingerprint: [
      feature('geo-cluster', 1, { lat: 0, lon: 0, radiusKm: 10, minCount: 2 }),
    ],
  }));
  const events: ObservationEvent[] = [
    obs({ id: 'o-1', location: { lat: 0, lon: 0 } }),
    obs({ id: 'o-2', location: { lat: 40, lon: 40 } }),
  ];
  assert.equal(lib.matchSignatures(events).filter((m) => m.signature.id === 'cust-gc').length, 0);
});

test('matchSignatures: time-pattern fires on a tight cluster of events', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature({
    id: 'cust-tp', fingerprint: [feature('time-pattern', 1, { windowMinutes: 60, minCount: 4 })],
  }));
  const events: ObservationEvent[] = Array.from({ length: 5 }, (_, i) => obs({
    id: `o-${i}`, timestamp: NOW + i * 600_000, // every 10 minutes
  }));
  assert.ok(lib.matchSignatures(events).some((m) => m.signature.id === 'cust-tp'));
});

test('matchSignatures: time-pattern does not fire when events are spread too thin', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature({
    id: 'cust-tp', fingerprint: [feature('time-pattern', 1, { windowMinutes: 60, minCount: 4 })],
  }));
  const events: ObservationEvent[] = Array.from({ length: 5 }, (_, i) => obs({
    id: `o-${i}`, timestamp: NOW + i * 90 * 60_000, // 90 minutes apart
  }));
  assert.equal(lib.matchSignatures(events).filter((m) => m.signature.id === 'cust-tp').length, 0);
});

// ── matchSignatures: scoring + threshold ─────────────────────────────

test('matchSignatures: returns no matches when no features fire', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  assert.deepEqual(lib.matchSignatures([]), []);
});

test('matchSignatures: score = matchedWeight / totalWeight', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.resetForTesting();
  lib.addSignature(customSignature({
    id: 'cust-2f', fingerprint: [
      feature('domain-elevation', 0.6, { domain: 'finance', minCount: 1 }),
      feature('entity-spike', 0.4, { minCount: 5 }), // won't fire
    ],
  }));
  const matches = lib.matchSignatures([obs({ domain: 'finance' })]).filter((m) => m.signature.id === 'cust-2f');
  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.score, 0.6);
  assert.equal(matches[0]!.matchedFeatures.length, 1);
});

test('matchSignatures: score below threshold is filtered out', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature({
    id: 'cust-thin', fingerprint: [
      feature('domain-elevation', 0.3, { domain: 'finance', minCount: 1 }),
      feature('entity-spike', 0.7, { minCount: 5 }), // won't fire
    ],
  }));
  const matches = lib.matchSignatures([obs({ domain: 'finance' })]).filter((m) => m.signature.id === 'cust-thin');
  // 0.3 / 1.0 = 0.3 < 0.4 threshold
  assert.equal(matches.length, 0);
});

test('matchSignatures: exactly at MATCH_THRESHOLD is included', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature({
    id: 'cust-edge', fingerprint: [
      feature('domain-elevation', 0.4, { domain: 'finance', minCount: 1 }),
      feature('entity-spike', 0.6, { minCount: 5 }), // won't fire
    ],
  }));
  const matches = lib.matchSignatures([obs({ domain: 'finance' })]).filter((m) => m.signature.id === 'cust-edge');
  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.score, MATCH_THRESHOLD);
});

test('matchSignatures: leadTimeEstimateHours shrinks as score grows', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature({
    id: 'cust-lead',
    avgLeadTimeHours: 100,
    fingerprint: [
      feature('domain-elevation', 1, { domain: 'finance', minCount: 1 }),
      feature('entity-spike', 1, { minCount: 5 }),
    ],
  }));
  const partial = lib.matchSignatures([obs({ domain: 'finance' })]).find((m) => m.signature.id === 'cust-lead')!;
  // score = 0.5, lead = 100 * (1 - 0.5) = 50
  assert.equal(partial.score, 0.5);
  assert.equal(partial.leadTimeEstimateHours, 50);
});

test('matchSignatures: leadTimeEstimateHours floors at 0 for full matches', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature({
    id: 'cust-full', avgLeadTimeHours: 24,
    fingerprint: [feature('domain-elevation', 1, { domain: 'finance', minCount: 1 })],
  }));
  const match = lib.matchSignatures([obs({ domain: 'finance' })]).find((m) => m.signature.id === 'cust-full')!;
  assert.equal(match.score, 1);
  assert.equal(match.leadTimeEstimateHours, 0);
});

test('matchSignatures: results sorted by score descending', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature({
    id: 'cust-half', fingerprint: [
      feature('domain-elevation', 0.5, { domain: 'finance', minCount: 1 }),
      feature('entity-spike', 0.5, { minCount: 5 }),
    ],
  }));
  lib.addSignature(customSignature({
    id: 'cust-full', fingerprint: [
      feature('domain-elevation', 1, { domain: 'finance', minCount: 1 }),
    ],
  }));
  const matches = lib.matchSignatures([obs({ domain: 'finance' })])
    .filter((m) => m.signature.id.startsWith('cust-'));
  assert.equal(matches[0]!.signature.id, 'cust-full');
  assert.equal(matches[1]!.signature.id, 'cust-half');
});

test('matchSignatures: includes only the features that actually matched', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature({
    id: 'cust-partial', fingerprint: [
      feature('domain-elevation', 0.5, { domain: 'finance', minCount: 1 }),
      feature('entity-spike', 0.5, { minCount: 5 }), // won't fire
    ],
  }));
  const match = lib.matchSignatures([obs({ domain: 'finance' })])
    .find((m) => m.signature.id === 'cust-partial')!;
  assert.equal(match.matchedFeatures.length, 1);
  assert.equal(match.matchedFeatures[0]!.featureType, 'domain-elevation');
});

test('matchSignatures: returned matches are defensive copies', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  lib.addSignature(customSignature({
    id: 'cust-copy', fingerprint: [feature('domain-elevation', 1, { domain: 'finance', minCount: 1 })],
  }));
  const match = lib.matchSignatures([obs({ domain: 'finance' })])
    .find((m) => m.signature.id === 'cust-copy')!;
  match.signature.name = 'mutated';
  assert.equal(lib.getSignature('cust-copy')?.name, 'Test');
});

test('matchSignatures: built-in financial contagion fires on a synthetic finance burst', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  const events: ObservationEvent[] = [];
  for (let i = 0; i < 6; i += 1) {
    events.push(obs({
      id: `f-${i}`,
      domain: 'finance',
      severity: 'HIGH' as ObservationSeverity,
      timestamp: NOW + i * 60_000,
      entityIds: ['svb', 'jpm', 'bofa'],
    }));
  }
  const matches = lib.matchSignatures(events);
  assert.ok(matches.some((m) => m.signature.id === 'builtin-financial-contagion'));
});

test('matchSignatures: built-in pandemic emergence requires geo cluster', () => {
  const lib = new CrisisSignatureLibrary({ storage: makeFakeStorage() });
  const events: ObservationEvent[] = Array.from({ length: 8 }, (_, i) => obs({
    id: `p-${i}`, domain: 'biosurv', severity: 'MEDIUM' as ObservationSeverity,
    timestamp: NOW + i * 60_000,
    location: { lat: 35.0 + i * 0.05, lon: 139.0 + i * 0.05 },
  }));
  const matches = lib.matchSignatures(events);
  assert.ok(matches.some((m) => m.signature.id === 'builtin-pandemic-emergence'));
});

// ── Persistence ───────────────────────────────────────────────────────

test('custom signatures survive a fresh service instance', () => {
  const storage = makeFakeStorage();
  const lib1 = new CrisisSignatureLibrary({ storage });
  lib1.addSignature(customSignature());
  const lib2 = new CrisisSignatureLibrary({ storage });
  assert.ok(lib2.getSignature('cust-1'));
});

test('removeSignature persists across instances', () => {
  const storage = makeFakeStorage();
  const lib1 = new CrisisSignatureLibrary({ storage });
  lib1.addSignature(customSignature());
  lib1.removeSignature('cust-1');
  const lib2 = new CrisisSignatureLibrary({ storage });
  assert.equal(lib2.getSignature('cust-1'), undefined);
});

test('corrupt persistence blob is ignored', () => {
  const storage = makeFakeStorage({ [STORAGE_KEY]: 'not-json' });
  const lib = new CrisisSignatureLibrary({ storage });
  assert.equal(lib.getSignatures().length, 8);
});

test('non-array persistence payload is ignored', () => {
  const storage = makeFakeStorage({ [STORAGE_KEY]: JSON.stringify({ id: 'x' }) });
  const lib = new CrisisSignatureLibrary({ storage });
  assert.equal(lib.getSignatures().length, 8);
});

test('persistence skips malformed entries without crashing', () => {
  const storage = makeFakeStorage({
    [STORAGE_KEY]: JSON.stringify([null, { id: 42 }, customSignature()]),
  });
  const lib = new CrisisSignatureLibrary({ storage });
  assert.ok(lib.getSignature('cust-1'));
  assert.equal(lib.getSignatures().length, 9);
});

test('null storage works (no-op persistence)', () => {
  const lib = new CrisisSignatureLibrary({ storage: null });
  lib.addSignature(customSignature());
  assert.ok(lib.getSignature('cust-1'));
});

test('resetForTesting clears custom signatures + persisted blob', () => {
  const storage = makeFakeStorage();
  const lib = new CrisisSignatureLibrary({ storage });
  lib.addSignature(customSignature());
  lib.resetForTesting();
  assert.equal(lib.getSignature('cust-1'), undefined);
  assert.equal(storage.raw.has(STORAGE_KEY), false);
  // Built-ins are still present.
  assert.equal(lib.getSignatures().length, 8);
});

// ── Singleton ────────────────────────────────────────────────────────

test('CrisisSignatureLibrary.getInstance returns a stable singleton', () => {
  CrisisSignatureLibrary._resetForTests();
  const a = CrisisSignatureLibrary.getInstance();
  const b = CrisisSignatureLibrary.getInstance();
  assert.equal(a, b);
  CrisisSignatureLibrary._resetForTests();
});

test('getCrisisSignatureLibrary mirrors getInstance', () => {
  CrisisSignatureLibrary._resetForTests();
  const a = getCrisisSignatureLibrary();
  const b = CrisisSignatureLibrary.getInstance();
  assert.equal(a, b);
  CrisisSignatureLibrary._resetForTests();
});

test('singleton reset returns a fresh instance', () => {
  const a = CrisisSignatureLibrary.getInstance();
  CrisisSignatureLibrary._resetForTests();
  const b = CrisisSignatureLibrary.getInstance();
  assert.notEqual(a, b);
  CrisisSignatureLibrary._resetForTests();
});

// ── Helpers ──────────────────────────────────────────────────────────

test('__internals.haversineKm returns 0 for identical points', () => {
  assert.equal(__internals.haversineKm(0, 0, 0, 0), 0);
});

test('__internals.haversineKm scales with distance', () => {
  const tokyo = __internals.haversineKm(35.6762, 139.6503, 35.6762, 139.6503);
  const tokyoToYokohama = __internals.haversineKm(35.6762, 139.6503, 35.4437, 139.6380);
  assert.equal(tokyo, 0);
  assert.ok(tokyoToYokohama > 20 && tokyoToYokohama < 35);
});
