/**
 * Closed-Loop Mission Ledger tests.
 *
 * Covers:
 *   - construction / dispose / singleton seam
 *   - storage hydrate / persist / corruption tolerance / capacity cap
 *   - manual recordOutcome shape + algorithmIds guard + leadTime normalisation
 *   - getOutcomes filter by domain + array-clone safety
 *   - getCalibrationReport per-domain math (accuracy, timeliness, sample size)
 *   - getFeedbackLoopStats aggregate math + topDomainsByAccuracy ranking
 *   - lifecycle-tracker subscription auto-records on `resolved` only
 *   - downstream forward into OutcomeLedger (one record per algorithmId)
 *
 * Tests inject a fresh SituationLifecycleTrackerService and OutcomeLedger
 * per case so the singletons stay hermetic.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  ClosedLoopMissionLedger,
  ClosedLoopMissionLedgerService,
  STORAGE_KEY,
  MAX_OUTCOMES,
  DEFAULT_TIMELY_THRESHOLD_MS,
  __resetClosedLoopMissionLedgerSingleton,
  __internals,
  type MissionOutcome,
  type StorageLike,
} from '../../src/services/intelligence/closed-loop-mission-ledger.ts';
import {
  SituationLifecycleTrackerService,
} from '../../src/services/intelligence/situation-lifecycle-tracker.ts';
import {
  OutcomeLedger,
} from '../../src/services/intelligence/outcome-ledger.ts';

// ── Fixtures ──────────────────────────────────────────────────────────

const T0 = 1_780_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

function freshTracker(now: () => number = () => T0): SituationLifecycleTrackerService {
  return new SituationLifecycleTrackerService({ now, storage: null });
}

function freshOutcomeLedger(now: () => number = () => T0): OutcomeLedger {
  // OutcomeLedger uses its own localStorage shim; passing a clock keeps
  // recordedAt deterministic without touching the global object.
  return new OutcomeLedger({ clock: now });
}

function makeLedger(
  options: Partial<ConstructorParameters<typeof ClosedLoopMissionLedger>[0]> = {},
): ClosedLoopMissionLedger {
  const now = options.clock ?? (() => T0);
  return new ClosedLoopMissionLedger({
    storage: options.storage ?? memoryStorage(),
    clock: now,
    lifecycleTracker: options.lifecycleTracker ?? freshTracker(now),
    outcomeLedger: options.outcomeLedger ?? freshOutcomeLedger(now),
    autoSubscribe: options.autoSubscribe ?? false,
    timelyThresholdMs: options.timelyThresholdMs,
    defaultPredictedSeverity: options.defaultPredictedSeverity,
  });
}

function makeOutcome(overrides: Partial<MissionOutcome> = {}): MissionOutcome {
  return {
    situationId: 'sit-1',
    domain: 'weather',
    detectedAt: T0,
    resolvedAt: T0 + 2 * HOUR,
    leadTimeMs: 2 * HOUR,
    wasAccurate: true,
    wasTimely: true,
    algorithmIds: ['truth-score', 'compound-risk'],
    ...overrides,
  };
}

// ── 1. Constants + class exports (3 tests) ────────────────────────────

describe('constants / exports', () => {
  it('STORAGE_KEY is the documented key', () => {
    assert.equal(STORAGE_KEY, 'wm-closed-loop-ledger');
  });

  it('MAX_OUTCOMES caps at 500', () => {
    assert.equal(MAX_OUTCOMES, 500);
  });

  it('DEFAULT_TIMELY_THRESHOLD_MS is 24h', () => {
    assert.equal(DEFAULT_TIMELY_THRESHOLD_MS, 24 * HOUR);
  });
});

// ── 2. recordOutcome shape + guards (5 tests) ─────────────────────────

describe('recordOutcome — shape + guards', () => {
  it('persists a manual outcome and returns a clone', () => {
    const ledger = makeLedger();
    const out = ledger.recordOutcome(makeOutcome());
    assert.equal(out.situationId, 'sit-1');
    assert.equal(out.wasAccurate, true);
    assert.deepEqual(out.algorithmIds, ['truth-score', 'compound-risk']);
  });

  it('throws when algorithmIds is empty by default', () => {
    const ledger = makeLedger();
    assert.throws(
      () => ledger.recordOutcome(makeOutcome({ algorithmIds: [] })),
      /algorithmIds/,
    );
  });

  it('normalises leadTimeMs to resolvedAt - detectedAt regardless of caller value', () => {
    const ledger = makeLedger();
    const out = ledger.recordOutcome(makeOutcome({
      detectedAt: T0,
      resolvedAt: T0 + 3 * HOUR,
      leadTimeMs: 99_999, // wrong on purpose
    }));
    assert.equal(out.leadTimeMs, 3 * HOUR);
  });

  it('clamps negative leadTime to 0 when resolvedAt precedes detectedAt', () => {
    const ledger = makeLedger();
    const out = ledger.recordOutcome(makeOutcome({
      detectedAt: T0 + HOUR,
      resolvedAt: T0,
      leadTimeMs: 0,
    }));
    assert.equal(out.leadTimeMs, 0);
  });

  it('mutating the returned outcome does not mutate the stored record', () => {
    const ledger = makeLedger();
    const out = ledger.recordOutcome(makeOutcome());
    out.algorithmIds.push('mutation-poison');
    const stored = ledger.getOutcomes()[0]!;
    assert.deepEqual(stored.algorithmIds, ['truth-score', 'compound-risk']);
  });
});

// ── 3. getOutcomes filter + immutability (3 tests) ────────────────────

describe('getOutcomes', () => {
  it('returns every recorded outcome when no domain filter is supplied', () => {
    const ledger = makeLedger();
    ledger.recordOutcome(makeOutcome({ situationId: 'a' }));
    ledger.recordOutcome(makeOutcome({ situationId: 'b', domain: 'cyber' }));
    assert.equal(ledger.getOutcomes().length, 2);
  });

  it('filters by domain when provided', () => {
    const ledger = makeLedger();
    ledger.recordOutcome(makeOutcome({ situationId: 'a', domain: 'weather' }));
    ledger.recordOutcome(makeOutcome({ situationId: 'b', domain: 'cyber' }));
    ledger.recordOutcome(makeOutcome({ situationId: 'c', domain: 'weather' }));
    assert.equal(ledger.getOutcomes('weather').length, 2);
    assert.equal(ledger.getOutcomes('cyber').length, 1);
    assert.equal(ledger.getOutcomes('does-not-exist').length, 0);
  });

  it('cloning isolates caller from internal storage array', () => {
    const ledger = makeLedger();
    ledger.recordOutcome(makeOutcome());
    const snapshot = ledger.getOutcomes();
    snapshot.length = 0;
    assert.equal(ledger.getOutcomes().length, 1);
  });
});

// ── 4. Calibration report (5 tests) ───────────────────────────────────

describe('getCalibrationReport', () => {
  it('returns empty array when no outcomes recorded', () => {
    const ledger = makeLedger();
    assert.deepEqual(ledger.getCalibrationReport(), []);
  });

  it('computes accuracy as wasAccurate / sampleCount', () => {
    const ledger = makeLedger();
    ledger.recordOutcome(makeOutcome({ situationId: 'a', domain: 'weather', wasAccurate: true }));
    ledger.recordOutcome(makeOutcome({ situationId: 'b', domain: 'weather', wasAccurate: false }));
    ledger.recordOutcome(makeOutcome({ situationId: 'c', domain: 'weather', wasAccurate: true }));
    const report = ledger.getCalibrationReport();
    const weather = report.find((r) => r.domain === 'weather')!;
    assert.equal(weather.sampleCount, 3);
    assert.equal(Number(weather.accuracy.toFixed(3)), Number((2 / 3).toFixed(3)));
  });

  it('computes timeliness as wasTimely / sampleCount independently of accuracy', () => {
    const ledger = makeLedger();
    ledger.recordOutcome(makeOutcome({ situationId: 'a', wasAccurate: false, wasTimely: true }));
    ledger.recordOutcome(makeOutcome({ situationId: 'b', wasAccurate: true, wasTimely: false }));
    const report = ledger.getCalibrationReport()[0]!;
    assert.equal(report.accuracy, 0.5);
    assert.equal(report.timeliness, 0.5);
  });

  it('rolls up multiple domains and sorts by sampleCount descending', () => {
    const ledger = makeLedger();
    for (let i = 0; i < 3; i += 1) ledger.recordOutcome(makeOutcome({ situationId: `c${i}`, domain: 'cyber' }));
    for (let i = 0; i < 5; i += 1) ledger.recordOutcome(makeOutcome({ situationId: `w${i}`, domain: 'weather' }));
    const report = ledger.getCalibrationReport();
    assert.equal(report[0]?.domain, 'weather');
    assert.equal(report[0]?.sampleCount, 5);
    assert.equal(report[1]?.domain, 'cyber');
    assert.equal(report[1]?.sampleCount, 3);
  });

  it('breaks ties by domain name alphabetically', () => {
    const ledger = makeLedger();
    ledger.recordOutcome(makeOutcome({ situationId: 'z', domain: 'zeta' }));
    ledger.recordOutcome(makeOutcome({ situationId: 'a', domain: 'alpha' }));
    const report = ledger.getCalibrationReport();
    assert.equal(report[0]?.domain, 'alpha');
    assert.equal(report[1]?.domain, 'zeta');
  });
});

// ── 5. Feedback loop stats (5 tests) ──────────────────────────────────

describe('getFeedbackLoopStats', () => {
  it('returns zeroed stats with empty topDomains when ledger is empty', () => {
    const stats = makeLedger().getFeedbackLoopStats();
    assert.equal(stats.totalOutcomes, 0);
    assert.equal(stats.accuracyRate, 0);
    assert.equal(stats.timelinessRate, 0);
    assert.equal(stats.avgLeadTimeMinutes, 0);
    assert.deepEqual(stats.topDomainsByAccuracy, []);
  });

  it('computes overall accuracyRate across all domains', () => {
    const ledger = makeLedger();
    ledger.recordOutcome(makeOutcome({ situationId: 'a', wasAccurate: true }));
    ledger.recordOutcome(makeOutcome({ situationId: 'b', wasAccurate: true }));
    ledger.recordOutcome(makeOutcome({ situationId: 'c', wasAccurate: false }));
    ledger.recordOutcome(makeOutcome({ situationId: 'd', wasAccurate: true }));
    assert.equal(ledger.getFeedbackLoopStats().accuracyRate, 0.75);
  });

  it('computes avgLeadTimeMinutes (rounded)', () => {
    const ledger = makeLedger();
    ledger.recordOutcome(makeOutcome({ situationId: 'a', detectedAt: T0, resolvedAt: T0 + 30 * MIN }));
    ledger.recordOutcome(makeOutcome({ situationId: 'b', detectedAt: T0, resolvedAt: T0 + 60 * MIN }));
    // Average lead time = 45 min
    assert.equal(ledger.getFeedbackLoopStats().avgLeadTimeMinutes, 45);
  });

  it('topDomainsByAccuracy excludes domains below MIN_ACCURACY_SAMPLES', () => {
    const ledger = makeLedger();
    // weather: 5 outcomes, all accurate → 1.0 accuracy
    for (let i = 0; i < 5; i += 1) ledger.recordOutcome(makeOutcome({ situationId: `w${i}`, domain: 'weather', wasAccurate: true }));
    // cyber: 2 outcomes (below threshold of 3) — excluded
    ledger.recordOutcome(makeOutcome({ situationId: 'c1', domain: 'cyber', wasAccurate: true }));
    ledger.recordOutcome(makeOutcome({ situationId: 'c2', domain: 'cyber', wasAccurate: true }));
    const stats = ledger.getFeedbackLoopStats();
    assert.deepEqual(stats.topDomainsByAccuracy, ['weather']);
  });

  it('topDomainsByAccuracy caps at 3 and orders by accuracy then sampleCount', () => {
    const ledger = makeLedger();
    // 4 domains: weather (3 / 1.0), cyber (5 / 0.8), maritime (3 / 0.67), wildfire (4 / 0.5)
    for (let i = 0; i < 3; i += 1) ledger.recordOutcome(makeOutcome({ situationId: `w${i}`, domain: 'weather', wasAccurate: true }));
    for (let i = 0; i < 5; i += 1) ledger.recordOutcome(makeOutcome({ situationId: `c${i}`, domain: 'cyber', wasAccurate: i < 4 }));
    for (let i = 0; i < 3; i += 1) ledger.recordOutcome(makeOutcome({ situationId: `m${i}`, domain: 'maritime', wasAccurate: i < 2 }));
    for (let i = 0; i < 4; i += 1) ledger.recordOutcome(makeOutcome({ situationId: `f${i}`, domain: 'wildfire', wasAccurate: i < 2 }));
    const top = makeLedger ? ledger.getFeedbackLoopStats().topDomainsByAccuracy : [];
    assert.equal(top.length, 3);
    assert.deepEqual(top, ['weather', 'cyber', 'maritime']);
  });
});

// ── 6. Storage hydrate / persist / corruption (5 tests) ──────────────

describe('storage', () => {
  it('persists outcomes under STORAGE_KEY as a v1 payload', () => {
    const storage = memoryStorage();
    const ledger = makeLedger({ storage });
    ledger.recordOutcome(makeOutcome());
    const raw = storage.getItem(STORAGE_KEY);
    assert.ok(raw, 'expected storage payload');
    const parsed = JSON.parse(raw!);
    assert.equal(parsed.version, 1);
    assert.equal(parsed.outcomes.length, 1);
  });

  it('hydrates outcomes from an existing storage blob on first read', () => {
    const storage = memoryStorage();
    const seed = { version: 1, outcomes: [{ ...makeOutcome(), leadTimeMs: 2 * HOUR }] };
    storage.setItem(STORAGE_KEY, JSON.stringify(seed));
    const ledger = makeLedger({ storage });
    assert.equal(ledger.getOutcomes().length, 1);
  });

  it('ignores a corrupt storage blob without throwing', () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, '<<not json>>');
    const ledger = makeLedger({ storage });
    assert.deepEqual(ledger.getOutcomes(), []);
  });

  it('ignores a payload with the wrong version', () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, outcomes: [makeOutcome()] }));
    const ledger = makeLedger({ storage });
    assert.deepEqual(ledger.getOutcomes(), []);
  });

  it('drops entries with invalid shape during hydrate', () => {
    const storage = memoryStorage();
    const mixed = {
      version: 1,
      outcomes: [
        makeOutcome({ situationId: 'good-1' }),
        { situationId: 'bad', domain: 'x' /* missing required fields */ },
      ],
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(mixed));
    const ledger = makeLedger({ storage });
    const stored = ledger.getOutcomes();
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.situationId, 'good-1');
  });
});

// ── 7. Capacity cap (1 test) ─────────────────────────────────────────

describe('capacity', () => {
  it('caps to MAX_OUTCOMES, evicting oldest first', () => {
    const ledger = makeLedger();
    for (let i = 0; i < MAX_OUTCOMES + 10; i += 1) {
      ledger.recordOutcome(makeOutcome({ situationId: `sit-${i}` }));
    }
    const stored = ledger.getOutcomes();
    assert.equal(stored.length, MAX_OUTCOMES);
    // First surviving entry should be #10 — the first 10 were evicted.
    assert.equal(stored[0]?.situationId, 'sit-10');
  });
});

// ── 8. Lifecycle subscription auto-record (4 tests) ──────────────────

describe('lifecycle subscription', () => {
  beforeEach(() => { __resetClosedLoopMissionLedgerSingleton(); });

  it('records a MissionOutcome when a transition lands on `resolved`', () => {
    let t = T0;
    const tracker = freshTracker(() => t);
    const ledger = makeLedger({ lifecycleTracker: tracker, autoSubscribe: true });
    tracker.recordTransition('sit-A', 'weather', 'detected'); t += 30 * MIN;
    tracker.recordTransition('sit-A', 'weather', 'resolved');
    const stored = ledger.getOutcomes();
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.situationId, 'sit-A');
    assert.equal(stored[0]?.leadTimeMs, 30 * MIN);
    assert.equal(stored[0]?.wasAccurate, true);
    assert.equal(stored[0]?.wasTimely, true);
    ledger.dispose();
  });

  it('does not record on non-resolved transitions', () => {
    let t = T0;
    const tracker = freshTracker(() => t);
    const ledger = makeLedger({ lifecycleTracker: tracker, autoSubscribe: true });
    tracker.recordTransition('sit-A', 'cyber', 'detected'); t += MIN;
    tracker.recordTransition('sit-A', 'cyber', 'escalated'); t += MIN;
    tracker.recordTransition('sit-A', 'cyber', 'investigated'); t += MIN;
    tracker.recordTransition('sit-A', 'cyber', 'mitigated');
    assert.equal(ledger.getOutcomes().length, 0);
    ledger.dispose();
  });

  it('marks wasTimely=false when lead time exceeds threshold', () => {
    let t = T0;
    const tracker = freshTracker(() => t);
    const ledger = makeLedger({
      lifecycleTracker: tracker,
      autoSubscribe: true,
      timelyThresholdMs: HOUR,
    });
    tracker.recordTransition('sit-slow', 'maritime', 'detected'); t += 3 * HOUR;
    tracker.recordTransition('sit-slow', 'maritime', 'resolved');
    assert.equal(ledger.getOutcomes()[0]?.wasTimely, false);
    ledger.dispose();
  });

  it('dispose() detaches the subscription so subsequent transitions are ignored', () => {
    let t = T0;
    const tracker = freshTracker(() => t);
    const ledger = makeLedger({ lifecycleTracker: tracker, autoSubscribe: true });
    ledger.dispose();
    tracker.recordTransition('sit-X', 'weather', 'detected'); t += 10 * MIN;
    tracker.recordTransition('sit-X', 'weather', 'resolved');
    assert.equal(ledger.getOutcomes().length, 0);
  });
});

// ── 9. OutcomeLedger forwarding (3 tests) ────────────────────────────

describe('OutcomeLedger forwarding', () => {
  it('forwards one OutcomeRecord per algorithmId', () => {
    const outcomes = freshOutcomeLedger();
    const ledger = makeLedger({ outcomeLedger: outcomes });
    ledger.recordOutcome(makeOutcome({ algorithmIds: ['a', 'b', 'c'] }));
    assert.equal(outcomes.list().length, 3);
  });

  it('forwards confirmed-real when wasAccurate=true, marked-false-positive when false', () => {
    const outcomes = freshOutcomeLedger();
    const ledger = makeLedger({ outcomeLedger: outcomes });
    ledger.recordOutcome(makeOutcome({ situationId: 'a', wasAccurate: true,  algorithmIds: ['truth-score'] }));
    ledger.recordOutcome(makeOutcome({ situationId: 'b', wasAccurate: false, algorithmIds: ['truth-score'] }));
    const actions = outcomes.list().map((r) => r.actualOutcome).sort();
    assert.deepEqual(actions, ['confirmed-real', 'marked-false-positive']);
  });

  it('tags forwarded records with notes=closed-loop:<algorithmId>', () => {
    const outcomes = freshOutcomeLedger();
    const ledger = makeLedger({ outcomeLedger: outcomes });
    ledger.recordOutcome(makeOutcome({ algorithmIds: ['truth-score', 'evidence-graph'] }));
    const notes = outcomes.list().map((r) => r.notes).sort();
    assert.deepEqual(notes, ['closed-loop:evidence-graph', 'closed-loop:truth-score']);
  });
});

// ── 10. Singleton + service alias (3 tests) ──────────────────────────

describe('singleton', () => {
  beforeEach(() => { __resetClosedLoopMissionLedgerSingleton(); });

  it('ClosedLoopMissionLedgerService.getInstance() returns a stable instance', () => {
    const a = ClosedLoopMissionLedgerService.getInstance();
    const b = ClosedLoopMissionLedgerService.getInstance();
    assert.strictEqual(a, b);
  });

  it('__resetClosedLoopMissionLedgerSingleton() drops the cached instance', () => {
    const a = ClosedLoopMissionLedgerService.getInstance();
    __resetClosedLoopMissionLedgerSingleton();
    const b = ClosedLoopMissionLedgerService.getInstance();
    assert.notStrictEqual(a, b);
  });

  it('__internals.normaliseOutcome is the exact computation used by recordOutcome', () => {
    const raw = makeOutcome({ detectedAt: T0, resolvedAt: T0 + DAY, leadTimeMs: 0 });
    const normalised = __internals.normaliseOutcome(raw);
    assert.equal(normalised.leadTimeMs, DAY);
  });
});
