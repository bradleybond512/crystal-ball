/**
 * Tests for CognitiveBiasDetectorService — scans Situations +
 * Observations for cognitive bias signatures and persists the
 * advisory ledger.
 *
 * The service is built with injectable storage + clock so the tests
 * never touch real localStorage or Date.now.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CognitiveBiasDetectorService,
  DETECTIONS_STORAGE_KEY,
  MAX_DETECTIONS,
  __internals,
  __resetCognitiveBiasDetectorServiceSingleton,
  getCognitiveBiasDetectorService,
  type BiasDetection,
  type StorageLike,
} from '../../src/services/intelligence/cognitive-bias-detector.ts';
import type { ObservationEvent, Situation } from '../../src/types/intelligence.ts';

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

function fixedClock(t: number): () => number {
  return () => t;
}

function tickingClock(start: number, stepMs = 1): () => number {
  let t = start;
  return () => { t += stepMs; return t; };
}

const NOW = 1_745_000_000_000;

function makeSituation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 's-1',
    name: 'Test situation',
    status: 'active',
    severity: 'high',
    domain: 'weather',
    startedAt: NOW - 60_000,
    updatedAt: NOW - 60_000,
    observationIds: [],
    correlationIds: [],
    summary: '',
    tags: [],
    confidence: 0.5,
    ...overrides,
  };
}

function makeObservation(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'o-1',
    sourceId: 'test-source',
    domain: 'weather',
    timestamp: NOW,
    severity: 'CRITICAL',
    title: 'fixture',
    raw: {},
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

// ── Heuristic: anchoring ─────────────────────────────────────────────

test('anchoring fires when confidence > 0.9 and corroborating domains < 2', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const fired = svc.scanSituation(
    makeSituation({ confidence: 0.95 }),
    { corroboratingDomainCount: 1, hasContradictions: true },
  );
  const anchoring = fired.find((d) => d.biasType === 'anchoring');
  assert.ok(anchoring, 'anchoring should fire');
  assert.equal(anchoring?.severity, 'medium');
  assert.equal(anchoring?.targetType, 'situation');
});

test('anchoring does not fire when corroborating domains >= 2', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const fired = svc.scanSituation(
    makeSituation({ confidence: 0.92 }),
    { corroboratingDomainCount: 3, hasContradictions: true },
  );
  assert.equal(fired.find((d) => d.biasType === 'anchoring'), undefined);
});

test('anchoring does not fire when confidence <= 0.9', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const fired = svc.scanSituation(
    makeSituation({ confidence: 0.9 }),
    { corroboratingDomainCount: 0, hasContradictions: true },
  );
  assert.equal(fired.find((d) => d.biasType === 'anchoring'), undefined);
});

test('anchoring is skipped when context omits corroboratingDomainCount', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const fired = svc.scanSituation(makeSituation({ confidence: 0.92 }), { hasContradictions: true });
  assert.equal(fired.find((d) => d.biasType === 'anchoring'), undefined);
});

// ── Heuristic: availability ──────────────────────────────────────────

test('availability fires after 3+ HIGH/CRITICAL situations in a domain within 24h', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const ctx = { hasContradictions: true, corroboratingDomainCount: 5 };
  svc.scanSituation(makeSituation({ id: 's-a', severity: 'high' }), ctx);
  svc.scanSituation(makeSituation({ id: 's-b', severity: 'critical' }), ctx);
  const fired = svc.scanSituation(makeSituation({ id: 's-c', severity: 'high' }), ctx);
  const availability = fired.find((d) => d.biasType === 'availability');
  assert.ok(availability, 'availability should fire on the third HIGH/CRITICAL');
  assert.equal(availability?.severity, 'low');
});

test('availability does not fire when severity is below HIGH', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const ctx = { hasContradictions: true, corroboratingDomainCount: 5 };
  svc.scanSituation(makeSituation({ id: 'a', severity: 'moderate' }), ctx);
  svc.scanSituation(makeSituation({ id: 'b', severity: 'low' }), ctx);
  const fired = svc.scanSituation(makeSituation({ id: 'c', severity: 'info' }), ctx);
  assert.equal(fired.find((d) => d.biasType === 'availability'), undefined);
});

test('availability does not fire across different domains', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const ctx = { hasContradictions: true, corroboratingDomainCount: 5 };
  svc.scanSituation(makeSituation({ id: 'a', severity: 'high', domain: 'weather' }), ctx);
  svc.scanSituation(makeSituation({ id: 'b', severity: 'high', domain: 'maritime' }), ctx);
  const fired = svc.scanSituation(
    makeSituation({ id: 'c', severity: 'high', domain: 'maritime' }),
    ctx,
  );
  assert.equal(fired.find((d) => d.biasType === 'availability'), undefined);
});

test('availability ignores situations older than 24h', () => {
  let now = NOW;
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: () => now });
  const ctx = { hasContradictions: true, corroboratingDomainCount: 5 };
  svc.scanSituation(makeSituation({ id: 'old-a', severity: 'high' }), ctx);
  svc.scanSituation(makeSituation({ id: 'old-b', severity: 'critical' }), ctx);
  now += 25 * 60 * 60_000; // 25h later
  const fired = svc.scanSituation(makeSituation({ id: 'fresh', severity: 'high' }), ctx);
  assert.equal(fired.find((d) => d.biasType === 'availability'), undefined);
});

// ── Heuristic: confirmation ──────────────────────────────────────────

test('confirmation fires when hasContradictions is false (default)', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const fired = svc.scanSituation(makeSituation(), { corroboratingDomainCount: 5 });
  const confirmation = fired.find((d) => d.biasType === 'confirmation');
  assert.ok(confirmation);
  assert.equal(confirmation?.severity, 'low');
});

test('confirmation does not fire when hasContradictions is true', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const fired = svc.scanSituation(
    makeSituation(),
    { corroboratingDomainCount: 5, hasContradictions: true },
  );
  assert.equal(fired.find((d) => d.biasType === 'confirmation'), undefined);
});

// ── Heuristic: overconfidence ────────────────────────────────────────

test('overconfidence fires when confidence > 0.95', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const fired = svc.scanSituation(
    makeSituation({ confidence: 0.97 }),
    { hasContradictions: true, corroboratingDomainCount: 5 },
  );
  const oc = fired.find((d) => d.biasType === 'overconfidence');
  assert.ok(oc);
  assert.equal(oc?.severity, 'high');
});

test('overconfidence does not fire at exactly 0.95', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const fired = svc.scanSituation(
    makeSituation({ confidence: 0.95 }),
    { hasContradictions: true, corroboratingDomainCount: 5 },
  );
  assert.equal(fired.find((d) => d.biasType === 'overconfidence'), undefined);
});

// ── Heuristic: recency ───────────────────────────────────────────────

test('recency fires on a CRITICAL observation < 1h old', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const fired = svc.scanObservation(makeObservation({ severity: 'CRITICAL', timestamp: NOW - 30 * 60_000 }));
  const recency = fired.find((d) => d.biasType === 'recency');
  assert.ok(recency);
  assert.equal(recency?.severity, 'medium');
  assert.equal(recency?.targetType, 'observation');
});

test('recency does not fire for non-CRITICAL observations', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const fired = svc.scanObservation(makeObservation({ severity: 'HIGH', timestamp: NOW - 30 * 60_000 }));
  assert.equal(fired.length, 0);
});

test('recency does not fire for CRITICAL observations >= 1h old', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const fired = svc.scanObservation(makeObservation({ severity: 'CRITICAL', timestamp: NOW - 60 * 60_000 }));
  assert.equal(fired.length, 0);
});

test('recency does not fire when the observation is from the future', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const fired = svc.scanObservation(makeObservation({ severity: 'CRITICAL', timestamp: NOW + 5 * 60_000 }));
  assert.equal(fired.length, 0);
});

// ── Heuristic: groupthink (placeholder) ──────────────────────────────

test('groupthink heuristic is a no-op placeholder', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const all = svc.scanSituation(
    makeSituation({ confidence: 0.99 }),
    { hasContradictions: false, corroboratingDomainCount: 0 },
  );
  assert.equal(all.find((d) => d.biasType === 'groupthink'), undefined);
});

// ── Acknowledge lifecycle ───────────────────────────────────────────

test('acknowledge flips the flag and is idempotent', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const fired = svc.scanSituation(makeSituation({ confidence: 0.97 }), { hasContradictions: true });
  const target = fired[0]!;
  const acked = svc.acknowledge(target.id);
  assert.equal(acked?.acknowledged, true);
  const ackedAgain = svc.acknowledge(target.id);
  assert.equal(ackedAgain?.acknowledged, true);
});

test('acknowledge returns undefined for unknown ids', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  assert.equal(svc.acknowledge('bias-nope'), undefined);
});

test('acknowledged detection is reflected in getDetections', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const fired = svc.scanSituation(makeSituation({ confidence: 0.97 }), { hasContradictions: true });
  svc.acknowledge(fired[0]!.id);
  const after = svc.getDetections({ targetId: fired[0]!.targetId });
  assert.equal(after.every((d) => d.acknowledged), true);
});

test('acknowledge returns a defensive copy', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const fired = svc.scanSituation(makeSituation({ confidence: 0.97 }), { hasContradictions: true });
  const acked = svc.acknowledge(fired[0]!.id)!;
  acked.acknowledged = false;
  const list = svc.getDetections({ targetId: fired[0]!.targetId });
  assert.equal(list[0]!.acknowledged, true);
});

// ── Reads ─────────────────────────────────────────────────────────────

test('getDetections filters by biasType', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.scanSituation(
    makeSituation({ confidence: 0.97 }),
    { hasContradictions: false, corroboratingDomainCount: 0 },
  );
  const oc = svc.getDetections({ biasType: 'overconfidence' });
  assert.equal(oc.every((d) => d.biasType === 'overconfidence'), true);
  assert.ok(oc.length > 0);
});

test('getDetections filters by acknowledged', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const fired = svc.scanSituation(makeSituation({ confidence: 0.97 }), { hasContradictions: true });
  svc.acknowledge(fired[0]!.id);
  const ack = svc.getDetections({ acknowledged: true });
  const unack = svc.getDetections({ acknowledged: false });
  assert.equal(ack.length, 1);
  assert.equal(unack.length, 0);
});

test('getDetections filters by targetId', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.scanSituation(makeSituation({ id: 's-aaa', confidence: 0.97 }), { hasContradictions: true });
  svc.scanSituation(makeSituation({ id: 's-bbb', confidence: 0.97 }), { hasContradictions: true });
  const aaa = svc.getDetections({ targetId: 's-aaa' });
  assert.equal(aaa.every((d) => d.targetId === 's-aaa'), true);
  assert.ok(aaa.length > 0);
});

test('getDetections returns newest-first', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW, 1000) });
  // Use severity:'low' so availability doesn't fire and overconfidence
  // is the only detection per call — keeps the order assertion clean.
  const ctx = { hasContradictions: true };
  const a = svc.scanSituation(makeSituation({ id: 'a', severity: 'low', confidence: 0.97 }), ctx)[0]!;
  const b = svc.scanSituation(makeSituation({ id: 'b', severity: 'low', confidence: 0.97 }), ctx)[0]!;
  const c = svc.scanSituation(makeSituation({ id: 'c', severity: 'low', confidence: 0.97 }), ctx)[0]!;
  const ordered = svc.getDetections({ biasType: 'overconfidence' });
  assert.deepEqual(ordered.map((d) => d.id), [c.id, b.id, a.id]);
});

test('getDetections honors limit', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  for (let i = 0; i < 8; i += 1) {
    svc.scanSituation(makeSituation({ id: `s-${i}`, confidence: 0.97 }), { hasContradictions: true });
  }
  assert.equal(svc.getDetections({}, 3).length, 3);
  assert.equal(svc.getDetections({}, 0).length, 0);
});

test('getDetections returns defensive copies', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.scanSituation(makeSituation({ confidence: 0.97 }), { hasContradictions: true });
  const list = svc.getDetections();
  list[0]!.acknowledged = true;
  assert.equal(svc.getDetections()[0]!.acknowledged, false);
});

// ── Report ────────────────────────────────────────────────────────────

test('getReport totals match what was recorded', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.scanSituation(makeSituation({ confidence: 0.97 }), { hasContradictions: true });
  svc.scanSituation(makeSituation({ id: 's-2', confidence: 0.5 }), { hasContradictions: false, corroboratingDomainCount: 5 });
  const report = svc.getReport();
  assert.equal(report.totalDetections, 2);
  assert.equal(report.byType.overconfidence, 1);
  assert.equal(report.byType.confirmation, 1);
  assert.equal(report.bySeverity.high, 1);
  assert.equal(report.bySeverity.low, 1);
  assert.equal(report.unacknowledgedCount, 2);
});

test('getReport.topBiasType reflects the most-frequent type', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  for (let i = 0; i < 5; i += 1) {
    svc.scanSituation(makeSituation({ id: `oc-${i}`, confidence: 0.97 }), { hasContradictions: true });
  }
  svc.scanSituation(
    makeSituation({ id: 'c-1', confidence: 0.5 }),
    { hasContradictions: false, corroboratingDomainCount: 5 },
  );
  assert.equal(svc.getReport().topBiasType, 'overconfidence');
});

test('getReport.topBiasType is null when there are no detections', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const report = svc.getReport();
  assert.equal(report.totalDetections, 0);
  assert.equal(report.topBiasType, null);
});

test('acknowledge decrements unacknowledgedCount in report', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const fired = svc.scanSituation(makeSituation({ confidence: 0.97 }), { hasContradictions: true });
  svc.acknowledge(fired[0]!.id);
  assert.equal(svc.getReport().unacknowledgedCount, 0);
});

// ── Ring buffer ──────────────────────────────────────────────────────

test('detections ring buffer evicts oldest entries past MAX_DETECTIONS', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const total = MAX_DETECTIONS + 25;
  for (let i = 0; i < total; i += 1) {
    svc.scanSituation(makeSituation({ id: `s-${i}`, confidence: 0.97 }), { hasContradictions: true });
  }
  assert.equal(svc.getReport().totalDetections, MAX_DETECTIONS);
});

// ── Subscribe ─────────────────────────────────────────────────────────

test('subscribe is invoked on each new detection', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const seen: BiasDetection[] = [];
  const off = svc.subscribe((d) => seen.push(d));
  svc.scanSituation(makeSituation({ confidence: 0.97 }), { hasContradictions: true });
  svc.scanSituation(
    makeSituation({ id: 's-2', confidence: 0.5 }),
    { hasContradictions: false, corroboratingDomainCount: 5 },
  );
  off();
  svc.scanSituation(
    makeSituation({ id: 's-3', confidence: 0.5 }),
    { hasContradictions: false, corroboratingDomainCount: 5 },
  );
  assert.equal(seen.length, 2);
});

test('a listener that throws does not stop other listeners', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  let good = 0;
  svc.subscribe(() => { throw new Error('bad'); });
  svc.subscribe(() => { good += 1; });
  svc.scanSituation(makeSituation({ confidence: 0.97 }), { hasContradictions: true });
  assert.equal(good, 1);
});

test('unsubscribe removes the listener', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  let count = 0;
  const cb = (): void => { count += 1; };
  svc.subscribe(cb);
  svc.unsubscribe(cb);
  svc.scanSituation(makeSituation({ confidence: 0.97 }), { hasContradictions: true });
  assert.equal(count, 0);
});

// ── Persistence ───────────────────────────────────────────────────────

test('detections survive a fresh service instance', () => {
  const storage = makeFakeStorage();
  const svc1 = new CognitiveBiasDetectorService({ storage, clock: tickingClock(NOW) });
  svc1.scanSituation(makeSituation({ confidence: 0.97 }), { hasContradictions: true });
  svc1.scanSituation(
    makeSituation({ id: 's-2', confidence: 0.5 }),
    { hasContradictions: false, corroboratingDomainCount: 5 },
  );
  const svc2 = new CognitiveBiasDetectorService({ storage, clock: tickingClock(NOW) });
  assert.equal(svc2.getReport().totalDetections, 2);
});

test('corrupt storage blob is ignored', () => {
  const storage = makeFakeStorage({ [DETECTIONS_STORAGE_KEY]: 'not-json' });
  const svc = new CognitiveBiasDetectorService({ storage, clock: fixedClock(NOW) });
  assert.equal(svc.getReport().totalDetections, 0);
});

test('null storage works (no-op persistence)', () => {
  const svc = new CognitiveBiasDetectorService({ storage: null, clock: tickingClock(NOW) });
  const fired = svc.scanSituation(makeSituation({ confidence: 0.97 }), { hasContradictions: true });
  assert.ok(fired.length > 0);
});

test('resetForTesting clears state and the persisted blob', () => {
  const storage = makeFakeStorage();
  const svc = new CognitiveBiasDetectorService({ storage, clock: tickingClock(NOW) });
  svc.scanSituation(makeSituation({ confidence: 0.97 }), { hasContradictions: true });
  svc.resetForTesting();
  assert.equal(svc.getReport().totalDetections, 0);
  assert.equal(storage.raw.has(DETECTIONS_STORAGE_KEY), false);
});

// ── Combined scan behaviour ──────────────────────────────────────────

test('scanSituation can return multiple bias detections at once', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const fired = svc.scanSituation(
    makeSituation({ confidence: 0.97 }),
    { hasContradictions: false, corroboratingDomainCount: 0 },
  );
  const types = new Set(fired.map((d) => d.biasType));
  assert.ok(types.has('anchoring'));
  assert.ok(types.has('confirmation'));
  assert.ok(types.has('overconfidence'));
});

test('scanSituation results are defensive copies', () => {
  const svc = new CognitiveBiasDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const fired = svc.scanSituation(makeSituation({ confidence: 0.97 }), { hasContradictions: true });
  fired[0]!.acknowledged = true;
  assert.equal(svc.getDetections()[0]!.acknowledged, false);
});

// ── Singleton ─────────────────────────────────────────────────────────

test('getCognitiveBiasDetectorService returns a stable singleton', () => {
  __resetCognitiveBiasDetectorServiceSingleton();
  const a = getCognitiveBiasDetectorService();
  const b = getCognitiveBiasDetectorService();
  assert.equal(a, b);
  __resetCognitiveBiasDetectorServiceSingleton();
});

test('singleton reset returns a fresh instance', () => {
  const a = getCognitiveBiasDetectorService();
  __resetCognitiveBiasDetectorServiceSingleton();
  const b = getCognitiveBiasDetectorService();
  assert.notEqual(a, b);
  __resetCognitiveBiasDetectorServiceSingleton();
});

// ── Constants ─────────────────────────────────────────────────────────

test('exported constants match documented thresholds', () => {
  assert.equal(__internals.ANCHORING_CONFIDENCE_FLOOR, 0.9);
  assert.equal(__internals.OVERCONFIDENCE_FLOOR, 0.95);
  assert.equal(__internals.AVAILABILITY_LOOKBACK_MS, 24 * 60 * 60_000);
  assert.equal(__internals.RECENCY_WINDOW_MS, 60 * 60_000);
  assert.equal(__internals.MAX_DETECTIONS, 1000);
});
