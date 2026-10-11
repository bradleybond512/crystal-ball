/** Hardening follow-up: the persisted forecast blob is validated, never cast. */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

const memory = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, String(value)); },
  removeItem: (key: string) => { memory.delete(key); },
  clear: () => memory.clear(),
};

import { parsePersistedPrediction, parsePersistedPredictions } from '../forecast-calibration-load.ts';
import { _resetCalibrationForTests, getCalibrationStore } from '../forecast-calibration-adapter.ts';
import type { PredictionRecord } from '../forecast-calibration.ts';
import { estimateHierarchicalBaseRate } from '../hierarchical-base-rate.ts';
import { estimatePersistenceBaseline } from '../persistence-baseline.ts';
import { auditResolutionQuality } from '../resolution-quality-audit.ts';
import { forecastFromEvidence } from '../evidence-projection.ts';
import { getEvidenceOutbox, resetEvidenceOutboxForTests } from '../evidence-outbox.ts';
import { setEvidenceChangeHandler } from '../evidence-bus.ts';

const KEY = 'crystalball-forecast-calibration-v1';
const T0 = 1_790_000_000_000;

function good(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fc-1', sourceId: 'analyst-loop', domain: 'markets', claim: 'c', probability: 0.6,
    predictedAt: T0, resolveBy: T0 + 1000, status: 'pending', ...overrides,
  };
}

beforeEach(() => {
  memory.clear();
  _resetCalibrationForTests();
  resetEvidenceOutboxForTests();
  setEvidenceChangeHandler(null);
});

afterEach(() => {
  memory.clear();
  _resetCalibrationForTests();
  resetEvidenceOutboxForTests();
  setEvidenceChangeHandler(null);
});

test('invalid entries are dropped instead of reaching the store', () => {
  memory.set(KEY, JSON.stringify([
    good(),
    good({ id: 'fc-p', probability: 1.5 }),
    good({ id: 'fc-n', probability: 'high' }),
    good({ id: 'fc-s', status: 'resolved_maybe' }),
    good({ id: 'fc-t', predictedAt: 'yesterday' }),
    good({ id: '' }),
    { id: 'fc-x' },
    'not a record',
    null,
  ]));
  assert.deepEqual(getCalibrationStore().all().map((r) => r.id), ['fc-1']);
});

test('only known fields survive, and nested shapes are checked', () => {
  const parsed = parsePersistedPrediction(good({
    __proto__polluted: true,
    extra: 'dropped',
    criteria: { kind: 'market_move', symbol: 'SPY' },
    resolutionProvenance: { resolverId: 'r', kind: 'proxy', evidence: [{ sourceIds: ['a'] }, 'junk'] },
    algorithmVersion: 'v1',
  }));
  assert.ok(parsed);
  assert.equal((parsed as Record<string, unknown>).extra, undefined);
  assert.equal(parsed.criteria?.kind, 'market_move');
  assert.equal(parsed.resolutionProvenance?.evidence.length, 1);
  const badNested = parsePersistedPrediction(good({ criteria: { kind: 'rm -rf' }, resolutionProvenance: { resolverId: 'r', kind: 'guess' } }));
  assert.equal(badNested?.criteria, undefined);
  assert.equal(badNested?.resolutionProvenance, undefined);
});

test('a corrupt or non-array blob loads as empty, and the cap keeps the newest', () => {
  memory.set(KEY, '{not json');
  assert.equal(getCalibrationStore().all().length, 0);
  _resetCalibrationForTests();
  memory.set(KEY, JSON.stringify({ records: [good()] }));
  assert.equal(getCalibrationStore().all().length, 0);
  const many = Array.from({ length: 5 }, (_, i) => good({ id: `fc-${i}`, predictedAt: T0 + i }));
  assert.deepEqual(parsePersistedPredictions(many, 3).map((r) => r.id), ['fc-2', 'fc-3', 'fc-4']);
});

// Every integration fixture traverses the real storage key, singleton and clones.
// No test below mocks a baseline, scoring, audit, projection or capture function.
const TARGET_KEY = 'mode:loader-fixture';
const target = good({
  id: 'target', domain: 'security', targetKey: TARGET_KEY,
  predictedAt: T0 + 100_000, resolveBy: T0 + 101_000,
}) as PredictionRecord;

function resolved(id: string, window: number, overrides: Record<string, unknown> = {}) {
  return good({
    id, domain: 'security', targetKey: TARGET_KEY, status: 'resolved_true',
    predictedAt: T0 + window * 2_000, resolveBy: T0 + window * 2_000 + 1_000,
    resolvedAt: T0 + window * 2_000 + 500, ...overrides,
  });
}

function evidence(overrides: Record<string, unknown> = {}) {
  return { sourceIds: ['fixture-feed'], observedAt: T0 + 2_250, supportsOutcome: true, ...overrides };
}

function provenance(overrides: Record<string, unknown> = {}) {
  return { resolverId: 'fixture-resolver', kind: 'direct', evidence: [evidence()], ...overrides };
}

function load(rows: readonly unknown[]) {
  memory.set(KEY, JSON.stringify(rows));
  _resetCalibrationForTests();
  return getCalibrationStore();
}

function legacyFalse() {
  return resolved('legacy-false', 0, { status: 'resolved_false' });
}

function launderingFixture() {
  return [legacyFalse(), resolved('invalid-numeric-proxy', 1, {
    resolutionProvenance: { resolverId: 123, kind: 'proxy', evidence: [] },
  })];
}

test('P01 actual load rejects numeric-resolver proxy without admitting its scored label', () => {
  const store = load(launderingFixture());
  assert.deepEqual(store.all().map(r => r.id), ['legacy-false']);
  assert.deepEqual(store.brier(), { score: 0.36, resolvedCount: 1, evaluated: 1 });
});

// Separate tests deliberately reload the fixture: an admission red cannot hide
// the consumer assertion required to prove provenance laundering is prevented.
test('P01 real hierarchical baseline cannot train on stripped numeric proxy provenance', () => {
  assert.deepEqual(estimateHierarchicalBaseRate(target, load(launderingFixture()).all(), { minGlobalResolved: 1 }), {
    probability: 1 / 3, globalProbability: 1 / 3,
  });
});

test('P01 real persistence baseline cannot train on stripped numeric proxy provenance', () => {
  assert.deepEqual(estimatePersistenceBaseline(target, load(launderingFixture()).all()), {
    probability: 1 / 3, sampleCount: 1,
  });
});

test('P01 real audit cannot relabel invalid numeric proxy history as manual', () => {
  const summary = auditResolutionQuality(load(launderingFixture()).all(), T0 + 200_000).summary;
  assert.deepEqual({ total: summary.total, resolved: summary.resolved, origins: summary.origins }, {
    total: 1, resolved: 1, origins: { direct: 0, proxy: 0, manual: 1 },
  });
  assert.equal(summary.malformed, 0);
});

const invalidProvenance: readonly [string, unknown][] = [
  ['numeric-proxy-resolver', provenance({ resolverId: 123, kind: 'proxy', evidence: [] })],
  ['numeric-direct-resolver', provenance({ resolverId: 123 })],
  ['unknown-kind', provenance({ kind: 'guess' })],
  ['null', null], ['false', false], ['number', 0], ['string', 'direct'], ['array', []],
  ['missing-evidence', { resolverId: 'fixture-resolver', kind: 'direct' }],
  ...[null, {}, 'evidence'].map((value, i) => [`nonarray-evidence-${i}`, provenance({ evidence: value })] as [string, unknown]),
  ['primitive-evidence', provenance({ evidence: ['junk'] })],
  ['null-evidence-item', provenance({ evidence: [null] })],
  ['mixed-evidence', provenance({ evidence: [evidence(), 'junk'] })],
  ['object-without-fields', provenance({ evidence: [{}] })],
  ...[null, 'fixture-feed', [7]].map((sourceIds, i) => [`sourceIds-${i}`, provenance({ evidence: [evidence({ sourceIds })] })] as [string, unknown]),
  ['missing-observedAt', provenance({ evidence: [{ sourceIds: ['fixture-feed'] }] })],
  ...[null, 'yesterday'].map((observedAt, i) => [`observedAt-${i}`, provenance({ evidence: [evidence({ observedAt })] })] as [string, unknown]),
  ...(['value', 'reference', 'supportsOutcome'] as const).flatMap(field =>
    [null, field === 'reference' ? 7 : 'wrong-type'].map((value, i) =>
      [`optional-${field}-${i}`, provenance({ evidence: [evidence({ [field]: value })] })] as [string, unknown])),
];

for (const status of ['resolved_true', 'resolved_false']) {
  for (const [label, metadata] of invalidProvenance) {
    test(`resolved provenance rejects whole ${status} row: ${label}`, () => {
      const rows = [legacyFalse(), resolved('bad', 1, { status, resolutionProvenance: metadata }),
        resolved('good-after', 2, { status: 'resolved_false' })];
      for (const order of [rows, [...rows].reverse()]) {
        const store = load(order);
        assert.doesNotThrow(() => { store.all(); store.get('bad'); store.toJson(); });
        assert.deepEqual(store.all().map(r => r.id), ['legacy-false', 'good-after']);
        assert.equal(store.get('bad'), undefined);
        assert.equal(store.brier().evaluated, 2);
        assert.equal(auditResolutionQuality(store.all(), T0 + 200_000).summary.resolved, 2);
      }
    });
  }
}

test('helper presence and finite checks cover values JSON cannot represent', () => {
  for (const status of ['resolved_true', 'resolved_false']) {
    for (const field of ['resolutionProvenance', 'criteria']) {
      assert.equal(parsePersistedPrediction(resolved('own-undefined', 1, { status, [field]: undefined })), null, `${status} own ${field}`);
    }
    for (const observedAt of [NaN, Infinity, -Infinity]) {
      assert.equal(parsePersistedPrediction(resolved('nonfinite-observed', 1, {
        status, resolutionProvenance: provenance({ evidence: [evidence({ observedAt })] }),
      })), null);
    }
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.equal(parsePersistedPrediction(resolved('nonfinite-value', 1, {
        status, resolutionProvenance: provenance({ evidence: [evidence({ value })] }),
      })), null);
    }
    for (const field of ['value', 'reference', 'supportsOutcome']) {
      assert.equal(parsePersistedPrediction(resolved('own-undefined-evidence-field', 1, {
        status, resolutionProvenance: provenance({ evidence: [evidence({ [field]: undefined })] }),
      })), null, `own undefined ${field}`);
    }
  }
  for (const probability of [NaN, Infinity, -Infinity, -0.01, 1.01, null]) {
    assert.equal(parsePersistedPrediction(good({ probability })), null);
  }
  for (const field of ['predictedAt', 'resolveBy']) {
    for (const value of [NaN, Infinity, -Infinity, null, 'yesterday']) {
      assert.equal(parsePersistedPrediction(good({ [field]: value })), null);
    }
  }
  for (const field of ['id', 'sourceId', 'domain']) {
    for (const value of ['', null, 7]) assert.equal(parsePersistedPrediction(good({ [field]: value })), null);
  }
  assert.equal(parsePersistedPrediction(good({ claim: 7 })), null);
  for (const probability of [0, 1]) assert.equal(parsePersistedPrediction(good({ probability }))?.probability, probability);
});

test('actual load retains legacy absence as usable evidence and strips only unknown top-level fields', () => {
  const store = load([legacyFalse(), good({ id: 'legacy-pending', extra: 'unsafe' })]);
  assert.deepEqual(store.all().map(r => r.id), ['legacy-false', 'legacy-pending']);
  assert.equal((store.get('legacy-pending') as unknown as Record<string, unknown>).extra, undefined);
  assert.deepEqual(estimateHierarchicalBaseRate(target, store.all(), { minGlobalResolved: 1 }), { probability: 1 / 3, globalProbability: 1 / 3 });
  assert.deepEqual(estimatePersistenceBaseline(target, store.all()), { probability: 1 / 3, sampleCount: 1 });
  const audit = auditResolutionQuality(store.all(), T0 + 200_000).summary;
  assert.equal(audit.total, 2);
  assert.equal(audit.resolved, 1);
  assert.deepEqual(audit.origins, { direct: 0, proxy: 0, manual: 1 });
});

for (const kind of ['direct', 'proxy'] as const) {
  for (const empty of [false, true]) {
    test(`actual ${kind} provenance stays structured with ${empty ? 'empty' : 'nonempty'} evidence`, () => {
      const metadata = provenance({ kind, evidence: empty ? [] : [evidence()], extra: 'retained-container' });
      const store = load([legacyFalse(), resolved('structured', 1, {
        resolutionProvenance: metadata, resolutionNote: `${kind}: fixture observation`,
      })]);
      assert.deepEqual(store.all().map(r => r.id), ['legacy-false', 'structured']);
      assert.deepEqual(store.get('structured')?.resolutionProvenance, metadata);
      const eligible = kind === 'direct' && !empty;
      const probability = eligible ? 1 / 2 : 1 / 3;
      assert.deepEqual(estimateHierarchicalBaseRate(target, store.all(), { minGlobalResolved: 1 }), { probability, globalProbability: probability });
      assert.deepEqual(estimatePersistenceBaseline(target, store.all()), { probability, sampleCount: eligible ? 2 : 1 });
      const audit = auditResolutionQuality(store.all(), T0 + 200_000).summary;
      assert.equal(audit.resolved, 2);
      assert.deepEqual(audit.origins, { direct: kind === 'direct' ? 1 : 0, proxy: kind === 'proxy' ? 1 : 0, manual: 1 });
      assert.equal(audit.malformed, kind === 'direct' && empty ? 1 : 0);
      assert.equal(audit.uncertainProxy, kind === 'proxy' ? 1 : 0);
      assert.equal(store.brier().evaluated, 2, 'degraded admitted history remains in existing Brier semantics');
    });
  }
}

for (const kind of ['direct', 'proxy'] as const) {
  for (const missingResolver of [false, true]) {
    test(`journal ${kind} reconstruction round-trips${missingResolver ? ' without resolverId' : ''}`, () => {
      const payload: Record<string, unknown> = {
        id: `journal-${kind}`, sourceId: 'analyst-loop', domain: 'security',
        probability: 0.6, predictedAt: T0 + 2_000, resolveBy: T0 + 3_000,
        resolvedAt: T0 + 2_500, status: 'resolved_true', provenanceKind: kind,
        noteOrigin: kind, targetKeyHash: 'fixture-hashed-target',
      };
      if (!missingResolver) payload.resolverId = 'fixture-resolver';
      const rebuilt = forecastFromEvidence(payload);
      assert.ok(rebuilt);
      const store = load([rebuilt]);
      assert.deepEqual(store.all().map(r => r.id), [`journal-${kind}`]);
      assert.equal(store.get(`journal-${kind}`)?.status, 'resolved_true');
      assert.deepEqual(store.get(`journal-${kind}`)?.resolutionProvenance, {
        kind, resolverId: missingResolver ? '' : 'fixture-resolver', evidence: [],
      });
      const audit = auditResolutionQuality(store.all(), T0 + 200_000).summary;
      assert.equal(audit.origins[kind], 1);
      assert.equal(audit.origins.manual, 0);
      assert.equal(estimateHierarchicalBaseRate(target, store.all(), { minGlobalResolved: 1 }), null,
        'real hierarchical history predicate excludes journal empty evidence');
      // Hashed journal targets are not applicable to mode persistence pairing;
      // the ordinary mode empty-evidence controls above test that predicate.
    });
  }
}

const safeEvent = { kind: 'event_occurrence', domains: ['security'], eventTypes: ['incident'], entitySlugs: ['fixture'], region: '', minEvidence: 1 };
const safeWarning = { kind: 'warning_verification', polygon: { rings: [[[0, 0], [1, 0], [0, 1]]] }, reportTypes: ['fixture'], sentAt: T0 };
const invalidCriteria: readonly [string, unknown][] = [
  ['null', null], ['false', false], ['array', []], ['unknown-kind', { kind: 'guess' }],
  ...(['domains', 'eventTypes', 'entitySlugs'] as const).flatMap(field =>
    [undefined, null, 'iterable-string', [7]].map((value, i) =>
      [`event-${field}-${i}`, { ...safeEvent, [field]: value }] as [string, unknown])),
  ...[undefined, null, [], {}].map((polygon, i) => [`warning-polygon-${i}`, { ...safeWarning, polygon }] as [string, unknown]),
  ...[undefined, null, 'rings', [null], ['ring'], [[null]]].map((rings, i) =>
    [`warning-rings-${i}`, { ...safeWarning, polygon: { rings } }] as [string, unknown]),
  ...[[], [0], [0, 0, 0], ['0', 0], [null, 0]].map((tuple, i) =>
    [`warning-tuple-${i}`, { ...safeWarning, polygon: { rings: [[tuple]] } }] as [string, unknown]),
  ...[undefined, null, 'reports', [7]].map((reportTypes, i) =>
    [`warning-reportTypes-${i}`, { ...safeWarning, reportTypes }] as [string, unknown]),
];

for (const status of ['pending', 'expired', 'resolved_true', 'resolved_false']) {
  for (const [label, criteria] of invalidCriteria) {
    test(`criteria isolation ${status}: ${label}`, () => {
      const bad = resolved('unsafe-criteria', 1, { status, criteria });
      const neighbors = [legacyFalse(), resolved('good-after', 2, { status: 'resolved_false' })];
      const isResolved = status.startsWith('resolved_');
      for (const rows of [[neighbors[0], bad, neighbors[1]], [neighbors[1], bad, neighbors[0]]]) {
        const store = load(rows);
        assert.doesNotThrow(() => { store.all(); store.get('unsafe-criteria'); store.toJson(); });
        assert.deepEqual(store.all().map(r => r.id), isResolved
          ? ['legacy-false', 'good-after'] : ['legacy-false', 'unsafe-criteria', 'good-after']);
        if (!isResolved) assert.equal(store.get('unsafe-criteria')?.criteria, undefined);
        assert.equal(store.brier().evaluated, 2);
        assert.equal(auditResolutionQuality(store.all(), T0 + 200_000).summary.resolved, 2);
      }
    });
  }
}

test('safe event/warning criteria retain arrays and finite coordinate tuples through real cloning', () => {
  for (const criteria of [safeEvent, { ...safeEvent, domains: [], eventTypes: [], entitySlugs: [] }, safeWarning,
    { ...safeWarning, polygon: { rings: [] }, reportTypes: [] }]) {
    const store = load([good({ criteria })]);
    assert.deepEqual(store.get('fc-1')?.criteria, criteria);
    assert.deepEqual(store.toJson()[0]?.criteria, criteria);
  }
  for (const tuple of [[NaN, 0], [0, Infinity], [-Infinity, 0]]) {
    assert.equal(parsePersistedPrediction(resolved('nonfinite-tuple', 1, {
      criteria: { ...safeWarning, polygon: { rings: [[tuple]] } },
    })), null);
  }
});

test('structurally valid resolved evidence preserves audit-visible semantic defects and nested fields', () => {
  const item = evidence({ sourceIds: [], value: 0, reference: '', supportsOutcome: false, extra: 'retained' });
  const metadata = provenance({ evidence: [item] });
  const store = load([resolved('shape-only', 1, { resolutionProvenance: metadata, resolutionNote: 'direct: fixture' })]);
  assert.deepEqual(store.get('shape-only')?.resolutionProvenance, metadata);
  const summary = auditResolutionQuality(store.all(), T0 + 200_000).summary;
  assert.equal(summary.resolved, 1);
  assert.equal(summary.origins.direct, 1);
  assert.equal(summary.malformed, 1, 'loader shape admission does not certify audit quality');
});

for (const status of ['pending', 'expired']) {
  test(`nonresolved ${status} normalization preserves clone-safe evidence and both good neighbors`, () => {
    for (const unsafe of [null, {}, { sourceIds: null }, { sourceIds: 'feed' }, { sourceIds: [7] }, 'junk']) {
      const normalized = resolved('normalized', 1, {
        status, resolutionProvenance: provenance({ evidence: [unsafe, { sourceIds: ['a'] }] }),
      });
      const rows = [legacyFalse(), normalized, resolved('good-after', 2, { status: 'resolved_false' })];
      for (const order of [rows, [...rows].reverse()]) {
        const store = load(order);
        assert.deepEqual(store.all().map(r => r.id), ['legacy-false', 'normalized', 'good-after']);
        assert.deepEqual(store.get('normalized')?.resolutionProvenance?.evidence, [{ sourceIds: ['a'] }]);
        assert.doesNotThrow(() => { store.get('normalized'); store.toJson(); });
      }
    }
    for (const metadata of [null, false, 7, [], provenance({ resolverId: 7 }), provenance({ kind: 'guess' })]) {
      const record = load([good({ status, resolutionProvenance: metadata })]).get('fc-1');
      assert.ok(record);
      assert.equal(record.status, status);
      assert.equal(record.resolutionProvenance, undefined);
    }
    for (const value of [undefined, null, {}, 'evidence']) {
      const metadata = { resolverId: 'fixture-resolver', kind: 'direct', evidence: value };
      const record = load([good({ status, resolutionProvenance: metadata })]).get('fc-1');
      assert.ok(record);
      assert.equal(record.status, status);
      assert.deepEqual(record.resolutionProvenance, { resolverId: 'fixture-resolver', kind: 'direct', evidence: [] });
    }
  });
}

test('real adapter cap selects exactly the newest 500 admitted rows in ascending order', () => {
  const valid = Array.from({ length: 503 }, (_, i) => good({ id: `cap-${i}`, predictedAt: T0 + i }));
  const invalid = Array.from({ length: 5 }, (_, i) => resolved(`invalid-cap-${i}`, i, {
    predictedAt: T0 + 1_000 + i, resolutionProvenance: null,
  }));
  const rows = [...valid.slice(0, 250), ...invalid, ...valid.slice(250)].reverse();
  const store = load(rows);
  assert.deepEqual(store.all().map(r => r.id), Array.from({ length: 500 }, (_, i) => `cap-${i + 3}`));
  assert.equal(store.get('cap-2'), undefined);
  assert.equal(store.get('invalid-cap-4'), undefined);
});

test('actual load captures only admitted forecasts through the accepted outbox hook', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true,
    value: { __TAURI_INTERNALS__: {}, location: { search: '' }, navigator: {} } });
  try {
    const store = load(launderingFixture());
    const outbox = getEvidenceOutbox();
    assert.equal(outbox.hasPendingIdentity('forecast', 'legacy-false'), true, 'accepted loaded identity captured');
    assert.equal(outbox.hasPendingIdentity('forecast', 'invalid-numeric-proxy'), false, 'rejected scored identity never captured');
    const watermark = outbox.watermark();
    await outbox.materializeThrough(watermark);
    const payloads = outbox.readyThrough(watermark).map(receipt => receipt.payload);
    assert.deepEqual(payloads.map(payload => payload.id), ['legacy-false']);
    assert.equal(payloads[0]?.status, store.get('legacy-false')?.status);
  } finally {
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});


for (const status of ['resolved_true', 'resolved_false'] as const) {
  test(`optional supportsOutcome absence remains admitted for ${status}`, () => {
    const item = { sourceIds: ['fixture-feed'], observedAt: T0 + 2_250 };
    const metadata = provenance({ evidence: [item] });
    const store = load([legacyFalse(), resolved('optional-absent', 1, {
      status, resolutionProvenance: metadata, resolutionNote: 'direct: fixture observation',
    })]);
    assert.deepEqual(store.all().map(r => r.id), ['legacy-false', 'optional-absent']);
    assert.equal(store.get('optional-absent')?.status, status);
    assert.deepEqual(store.get('optional-absent')?.resolutionProvenance, metadata);
    assert.equal(Object.hasOwn(store.get('optional-absent')!.resolutionProvenance!.evidence[0]!, 'supportsOutcome'), false);
    const probability = status === 'resolved_true' ? 1 / 2 : 1 / 4;
    assert.deepEqual(estimateHierarchicalBaseRate(target, store.all(), { minGlobalResolved: 1 }), { probability, globalProbability: probability });
    assert.deepEqual(estimatePersistenceBaseline(target, store.all()), { probability, sampleCount: 2 });
    const audit = auditResolutionQuality(store.all(), T0 + 200_000).summary;
    assert.equal(audit.resolved, 2);
    assert.deepEqual(audit.origins, { direct: 1, proxy: 0, manual: 1 });
    assert.equal(audit.malformed, 0);
  });
}
