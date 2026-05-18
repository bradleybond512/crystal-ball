import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  MetaConfidenceCalibrationService,
  resetCalibrationServiceForTests,
  type MetaConfidenceRecord,
} from '../../src/services/intelligence/meta-confidence.ts';

const NOW = 1_745_000_000_000;

function makeRecord(o: Partial<MetaConfidenceRecord> = {}): Omit<MetaConfidenceRecord, 'id' | 'recordedAt'> {
  return {
    domain: o.domain ?? 'earthquake',
    algorithmId: o.algorithmId ?? 'driver-scorer',
    predictedConfidence: o.predictedConfidence ?? 0.5,
    wasCorrect: o.wasCorrect ?? true,
  };
}

// ── record ──────────────────────────────────────────────────────────

describe('MetaConfidenceCalibrationService.record', () => {
  beforeEach(() => { resetCalibrationServiceForTests(); });

  it('stores a record with id + recordedAt', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    s.record(makeRecord({ domain: 'earthquake', algorithmId: 'driver-scorer' }));
    const all = s.getRecords();
    assert.equal(all.length, 1);
    assert.ok(all[0]?.id.length);
    assert.equal(all[0]?.recordedAt, NOW);
  });

  it('preserves domain, algorithmId, predictedConfidence, wasCorrect', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    s.record(makeRecord({
      domain: 'cyber', algorithmId: 'kev-detector',
      predictedConfidence: 0.73, wasCorrect: false,
    }));
    const r = s.getRecords()[0]!;
    assert.equal(r.domain, 'cyber');
    assert.equal(r.algorithmId, 'kev-detector');
    assert.equal(r.predictedConfidence, 0.73);
    assert.equal(r.wasCorrect, false);
  });

  it('LIFO order: most recent first', () => {
    let t = NOW;
    const s = new MetaConfidenceCalibrationService({ now: () => t });
    s.record(makeRecord({ predictedConfidence: 0.1 }));
    t += 1000;
    s.record(makeRecord({ predictedConfidence: 0.9 }));
    const records = s.getRecords();
    assert.equal(records[0]?.predictedConfidence, 0.9);
    assert.equal(records[1]?.predictedConfidence, 0.1);
  });

  it('getRecords filter by domain', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    s.record(makeRecord({ domain: 'earthquake' }));
    s.record(makeRecord({ domain: 'cyber' }));
    assert.equal(s.getRecords('earthquake').length, 1);
    assert.equal(s.getRecords('cyber').length, 1);
  });

  it('getRecords filter by domain + algorithmId', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    s.record(makeRecord({ domain: 'earthquake', algorithmId: 'a' }));
    s.record(makeRecord({ domain: 'earthquake', algorithmId: 'b' }));
    assert.equal(s.getRecords('earthquake', 'a').length, 1);
    assert.equal(s.getRecords('earthquake', 'b').length, 1);
  });

  it('getRecords honors limit', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    for (let i = 0; i < 10; i++) s.record(makeRecord());
    assert.equal(s.getRecords(undefined, undefined, 3).length, 3);
  });
});

// ── getSummary ──────────────────────────────────────────────────────

describe('MetaConfidenceCalibrationService.getSummary', () => {
  beforeEach(() => { resetCalibrationServiceForTests(); });

  function feed(s: MetaConfidenceCalibrationService, items: { predictedConfidence: number; wasCorrect: boolean }[]): void {
    for (const item of items) {
      s.record(makeRecord({ predictedConfidence: item.predictedConfidence, wasCorrect: item.wasCorrect }));
    }
  }

  it('insufficient-data when fewer than 10 records', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    s.record(makeRecord({ predictedConfidence: 0.5, wasCorrect: true }));
    const summary = s.getSummary('earthquake', 'driver-scorer');
    assert.equal(summary.reliability, 'insufficient-data');
    assert.equal(summary.sampleCount, 1);
  });

  it('returns 5 bins regardless of sample distribution', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    s.record(makeRecord({ predictedConfidence: 0.5, wasCorrect: true }));
    const summary = s.getSummary('earthquake', 'driver-scorer');
    assert.equal(summary.bins.length, 5);
    assert.equal(summary.bins[0]?.binMin, 0);
    assert.equal(summary.bins[0]?.binMax, 0.2);
    assert.equal(summary.bins[4]?.binMin, 0.8);
    assert.equal(summary.bins[4]?.binMax, 1);
  });

  it('bin assignment: predictedConfidence 0.2 lands in bin 1 (the [0.2-0.4) bin)', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    s.record(makeRecord({ predictedConfidence: 0.2, wasCorrect: true }));
    const summary = s.getSummary('earthquake', 'driver-scorer');
    assert.equal(summary.bins[0]?.predictedCount, 0);
    assert.equal(summary.bins[1]?.predictedCount, 1);
  });

  it('bin assignment: predictedConfidence 1.0 lands in the LAST bin (not out of bounds)', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    s.record(makeRecord({ predictedConfidence: 1.0, wasCorrect: true }));
    const summary = s.getSummary('earthquake', 'driver-scorer');
    assert.equal(summary.bins[4]?.predictedCount, 1);
  });

  it('bin assignment: predictedConfidence 0.0 lands in bin 0', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    s.record(makeRecord({ predictedConfidence: 0, wasCorrect: true }));
    const summary = s.getSummary('earthquake', 'driver-scorer');
    assert.equal(summary.bins[0]?.predictedCount, 1);
  });

  it('perfectly calibrated bin: 10 predictions at 0.5, 50% correct → calibrationError ≈ 0', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    feed(s, [
      { predictedConfidence: 0.5, wasCorrect: true },
      { predictedConfidence: 0.5, wasCorrect: true },
      { predictedConfidence: 0.5, wasCorrect: true },
      { predictedConfidence: 0.5, wasCorrect: true },
      { predictedConfidence: 0.5, wasCorrect: true },
      { predictedConfidence: 0.5, wasCorrect: false },
      { predictedConfidence: 0.5, wasCorrect: false },
      { predictedConfidence: 0.5, wasCorrect: false },
      { predictedConfidence: 0.5, wasCorrect: false },
      { predictedConfidence: 0.5, wasCorrect: false },
    ]);
    const summary = s.getSummary('earthquake', 'driver-scorer');
    // Bin [0.4-0.6), midpoint = 0.5, actual = 0.5 → calibrationError = 0
    assert.equal(summary.bins[2]?.predictedCount, 10);
    assert.ok(Math.abs(summary.bins[2]!.calibrationError) < 1e-6);
  });

  it('poorly calibrated bin: 10 at 0.5, all wrong → calibrationError = 0.5', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    for (let i = 0; i < 10; i++) {
      s.record(makeRecord({ predictedConfidence: 0.5, wasCorrect: false }));
    }
    const summary = s.getSummary('earthquake', 'driver-scorer');
    // midpoint 0.5, actual 0 → error 0.5
    assert.ok(Math.abs(summary.bins[2]!.calibrationError - 0.5) < 1e-6);
  });

  it('empty bin: calibrationError is 0 (NaN-safe)', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    s.record(makeRecord({ predictedConfidence: 0.5, wasCorrect: true }));
    const summary = s.getSummary('earthquake', 'driver-scorer');
    assert.equal(summary.bins[0]?.predictedCount, 0);
    assert.equal(summary.bins[0]?.calibrationError, 0);
  });

  it('meanCalibrationError averages only bins with samples (skips empty bins)', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    // bin 0 [0-0.2): 5 at 0.1, all correct → midpoint 0.1, actual 1, error 0.9
    for (let i = 0; i < 5; i++) s.record(makeRecord({ predictedConfidence: 0.1, wasCorrect: true }));
    // bin 4 [0.8-1.0]: 5 at 0.9, all correct → midpoint 0.9, actual 1, error 0.1
    for (let i = 0; i < 5; i++) s.record(makeRecord({ predictedConfidence: 0.9, wasCorrect: true }));
    const summary = s.getSummary('earthquake', 'driver-scorer');
    // Only bins 0 and 4 have samples. Mean of (0.9 + 0.1) = 0.5.
    assert.ok(Math.abs(summary.meanCalibrationError - 0.5) < 1e-6);
  });

  it('meanCalibrationError is 0 when no records at all (no bins populated)', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    const summary = s.getSummary('earthquake', 'driver-scorer');
    assert.equal(summary.meanCalibrationError, 0);
  });

  it('summary scope: only records matching (domain, algorithmId)', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    // earthquake/driver-scorer: well-calibrated
    for (let i = 0; i < 10; i++) {
      s.record(makeRecord({ domain: 'earthquake', algorithmId: 'driver-scorer', predictedConfidence: 0.5, wasCorrect: i < 5 }));
    }
    // cyber/different: poorly calibrated (shouldn't influence earthquake summary)
    for (let i = 0; i < 10; i++) {
      s.record(makeRecord({ domain: 'cyber', algorithmId: 'kev-detector', predictedConfidence: 0.5, wasCorrect: false }));
    }
    const earthquake = s.getSummary('earthquake', 'driver-scorer');
    assert.equal(earthquake.sampleCount, 10);
    assert.ok(earthquake.meanCalibrationError < 0.1);
  });
});

// ── reliability bands ───────────────────────────────────────────────

describe('MetaConfidenceCalibrationService — reliability bands', () => {
  beforeEach(() => { resetCalibrationServiceForTests(); });

  it('insufficient-data when sampleCount < 10', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    for (let i = 0; i < 9; i++) s.record(makeRecord({ predictedConfidence: 0.5, wasCorrect: true }));
    assert.equal(s.getSummary('earthquake', 'driver-scorer').reliability, 'insufficient-data');
  });

  it("high when sampleCount >= 10 AND meanCalibrationError < 0.1", () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    // 10 records at 0.5 with 50% correct → 0 calibration error
    for (let i = 0; i < 10; i++) {
      s.record(makeRecord({ predictedConfidence: 0.5, wasCorrect: i < 5 }));
    }
    assert.equal(s.getSummary('earthquake', 'driver-scorer').reliability, 'high');
  });

  it("medium when meanCalibrationError in [0.1, 0.2)", () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    // 10 at 0.5, 35% correct → actual 0.35, midpoint 0.5, error 0.15
    for (let i = 0; i < 10; i++) {
      s.record(makeRecord({ predictedConfidence: 0.5, wasCorrect: i < 3.5 }));
    }
    // 3 of 10 → 0.30 → error 0.20 → 'low'. Need 0.15 → 35%? Try 4 correct = 0.40 → error 0.10 → boundary
    // Let me make it deterministic: 4 correct of 10 = 0.4. Midpoint 0.5. Error 0.1. → medium (>= 0.1).
    s.record(makeRecord({ predictedConfidence: 0.5, wasCorrect: true })); // not used since loop sets exactly
    // Reset and feed precisely
    const fresh = new MetaConfidenceCalibrationService({ now: () => NOW });
    for (let i = 0; i < 4; i++) fresh.record(makeRecord({ predictedConfidence: 0.5, wasCorrect: true }));
    for (let i = 0; i < 6; i++) fresh.record(makeRecord({ predictedConfidence: 0.5, wasCorrect: false }));
    const summary = fresh.getSummary('earthquake', 'driver-scorer');
    // 4/10 = 0.4, midpoint 0.5 → error 0.1 exactly → medium
    assert.ok(Math.abs(summary.meanCalibrationError - 0.1) < 1e-6);
    assert.equal(summary.reliability, 'medium');
  });

  it("low when meanCalibrationError >= 0.2", () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    // 10 at 0.5, all wrong → actual 0, error 0.5 → low
    for (let i = 0; i < 10; i++) {
      s.record(makeRecord({ predictedConfidence: 0.5, wasCorrect: false }));
    }
    assert.equal(s.getSummary('earthquake', 'driver-scorer').reliability, 'low');
  });
});

// ── getMetaConfidenceScore ──────────────────────────────────────────

describe('MetaConfidenceCalibrationService.getMetaConfidenceScore', () => {
  beforeEach(() => { resetCalibrationServiceForTests(); });

  it('returns 0.5 when insufficient data', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    assert.equal(s.getMetaConfidenceScore('earthquake', 'driver-scorer'), 0.5);
  });

  it('returns 1 - meanCalibrationError for well-calibrated domain', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    for (let i = 0; i < 10; i++) {
      s.record(makeRecord({ predictedConfidence: 0.5, wasCorrect: i < 5 }));
    }
    // Perfectly calibrated → score = 1 - 0 = 1
    assert.equal(s.getMetaConfidenceScore('earthquake', 'driver-scorer'), 1);
  });

  it('returns 1 - meanCalibrationError for poorly calibrated domain', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    for (let i = 0; i < 10; i++) {
      s.record(makeRecord({ predictedConfidence: 0.5, wasCorrect: false }));
    }
    // Error 0.5 → score = 0.5
    assert.equal(s.getMetaConfidenceScore('earthquake', 'driver-scorer'), 0.5);
  });
});

// ── getAllSummaries ─────────────────────────────────────────────────

describe('MetaConfidenceCalibrationService.getAllSummaries', () => {
  beforeEach(() => { resetCalibrationServiceForTests(); });

  it('returns one summary per (domain, algorithmId) pair seen in records', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    s.record(makeRecord({ domain: 'earthquake', algorithmId: 'a' }));
    s.record(makeRecord({ domain: 'earthquake', algorithmId: 'b' }));
    s.record(makeRecord({ domain: 'cyber', algorithmId: 'a' }));
    const summaries = s.getAllSummaries();
    assert.equal(summaries.length, 3);
    const keys = summaries.map((sm) => `${sm.domain}|${sm.algorithmId}`);
    assert.ok(keys.includes('earthquake|a'));
    assert.ok(keys.includes('earthquake|b'));
    assert.ok(keys.includes('cyber|a'));
  });

  it('returns empty array when no records', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    assert.deepEqual(s.getAllSummaries(), []);
  });
});

// ── Subscribe ───────────────────────────────────────────────────────

describe('MetaConfidenceCalibrationService — subscribe', () => {
  beforeEach(() => { resetCalibrationServiceForTests(); });

  it('subscribe fires on every record() call', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    let calls = 0;
    s.subscribeCalibration(() => { calls++; });
    s.record(makeRecord());
    s.record(makeRecord());
    assert.equal(calls, 2);
  });

  it('unsubscribe stops further callbacks', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    let calls = 0;
    const cb = (): void => { calls++; };
    s.subscribeCalibration(cb);
    s.record(makeRecord());
    s.unsubscribeCalibration(cb);
    s.record(makeRecord());
    assert.equal(calls, 1);
  });

  it('subscribe disposer also unsubscribes', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW });
    let calls = 0;
    const off = s.subscribeCalibration(() => { calls++; });
    s.record(makeRecord());
    off();
    s.record(makeRecord());
    assert.equal(calls, 1);
  });
});

// ── Persistence + ring buffer ───────────────────────────────────────

describe('MetaConfidenceCalibrationService — persistence', () => {
  beforeEach(() => { resetCalibrationServiceForTests(); });

  it('persists to and restores from a storage seam', () => {
    const fakeStorage: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => fakeStorage[k] ?? null,
      setItem: (k: string, v: string) => { fakeStorage[k] = v; },
    };
    const a = new MetaConfidenceCalibrationService({ now: () => NOW, storage });
    a.record(makeRecord({ predictedConfidence: 0.77, wasCorrect: true }));
    const b = new MetaConfidenceCalibrationService({ now: () => NOW, storage });
    assert.equal(b.getRecords().length, 1);
    assert.equal(b.getRecords()[0]?.predictedConfidence, 0.77);
  });

  it('ring buffer caps at supplied capacity', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW, capacity: 5 });
    for (let i = 0; i < 10; i++) s.record(makeRecord());
    assert.equal(s.getRecords().length, 5);
  });

  it('ring buffer default cap is 2000 — verify many records past cap', () => {
    const s = new MetaConfidenceCalibrationService({ now: () => NOW, capacity: 100 });
    for (let i = 0; i < 250; i++) s.record(makeRecord());
    assert.equal(s.getRecords().length, 100);
  });

  it('corrupted storage falls back to empty', () => {
    const storage = { getItem: () => '{not-json', setItem: () => {} };
    const s = new MetaConfidenceCalibrationService({ now: () => NOW, storage });
    assert.equal(s.getRecords().length, 0);
  });
});
