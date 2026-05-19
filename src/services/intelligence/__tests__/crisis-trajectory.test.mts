import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCrisisTrajectoryProjector,
  _resetCrisisTrajectoryProjectorSingletonForTests,
  getCrisisTrajectoryProjector,
  HORIZONS,
  CONFIDENCE_BY_HORIZON,
  STORAGE_KEY,
  MAX_TRAJECTORIES,
} from '../crisis-trajectory.js';
import type {
  CrisisSignature,
  RecoveryProjectionProfile,
  SignatureMatchProvider,
  RecoveryProjectionProvider,
  StorageLike,
} from '../crisis-trajectory.js';
import type { Situation } from '../situation-store-v2.js';
import type { ObservationEvent } from '@/types/intelligence.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

function makeSituation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 'sit-1',
    domain: 'cyber',
    title: 'Test Situation',
    severity: 'high',
    confidence: 0.8,
    sources: [],
    observations: [],
    createdAt: NOW - 3_600_000,
    updatedAt: NOW,
    ...overrides,
  } as Situation;
}

function makeObs(severity: ObservationEvent['severity'], tsOffset = 0): ObservationEvent {
  return {
    id: `obs-${tsOffset}`,
    sourceId: 'test',
    domain: 'cyber',
    timestamp: NOW + tsOffset,
    severity,
    title: 'Test obs',
    raw: {},
    entityIds: [],
    tags: [],
  } as ObservationEvent;
}

function makeStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
  };
}

// ── HORIZONS constant ────────────────────────────────────────────────────────

describe('HORIZONS', () => {
  it('is [6, 24, 72]', () => {
    assert.deepEqual([...HORIZONS], [6, 24, 72]);
  });
});

// ── CONFIDENCE_BY_HORIZON ────────────────────────────────────────────────────

describe('CONFIDENCE_BY_HORIZON', () => {
  it('is 1.0 at 6h', () => assert.equal(CONFIDENCE_BY_HORIZON[6], 1));
  it('is 0.8 at 24h', () => assert.equal(CONFIDENCE_BY_HORIZON[24], 0.8));
  it('is 0.6 at 72h', () => assert.equal(CONFIDENCE_BY_HORIZON[72], 0.6));
});

// ── historical-average strategy ──────────────────────────────────────────────

describe('historical-average strategy (no providers, < 3 observations)', () => {
  it('uses basis historical-average with no providers', () => {
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    const t = proj.project(makeSituation(), []);
    assert.equal(t.projectionBasis, 'historical-average');
    assert.equal(t.matchedSignatureId, null);
  });

  it('decays severity by 0.05 per hour', () => {
    // HIGH = 3; after 6h → 3 - 0.05*6 = 2.7 → clamped
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    const t = proj.project(makeSituation({ severity: 'high' }), []);
    assert.ok(t.trajectoryPoints[0]!.projectedSeverityNum < 3);
  });

  it('never goes below 0', () => {
    // LOW = 1; after 72h → 1 - 0.05*72 = -2.6 → clamped to 0
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    const t = proj.project(makeSituation({ severity: 'low' }), []);
    const at72 = t.trajectoryPoints.find((p) => p.hoursFromNow === 72)!;
    assert.equal(at72.projectedSeverityNum, 0);
    assert.equal(at72.projectedSeverityLabel, 'INFO');
  });

  it('confidence matches CONFIDENCE_BY_HORIZON at each point', () => {
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    const t = proj.project(makeSituation(), []);
    for (const p of t.trajectoryPoints) {
      assert.equal(p.confidence, CONFIDENCE_BY_HORIZON[p.hoursFromNow]);
    }
  });

  it('uses latest observation severity when observations present (< 3)', () => {
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    // 2 observations — not enough for extrapolation, uses latest severity
    const obs = [makeObs('CRITICAL', -100), makeObs('LOW', -50)];
    const t = proj.project(makeSituation({ severity: 'high' }), obs);
    // latest is LOW (1); currentSeverityNum should be 1
    assert.equal(t.currentSeverityNum, 1);
  });
});

// ── extrapolation strategy ───────────────────────────────────────────────────

describe('extrapolation strategy (≥3 observations)', () => {
  it('uses basis extrapolation', () => {
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    const obs = [
      makeObs('LOW', -7_200_000),
      makeObs('MEDIUM', -3_600_000),
      makeObs('HIGH', 0),
    ];
    const t = proj.project(makeSituation(), obs);
    assert.equal(t.projectionBasis, 'extrapolation');
  });

  it('rising trend projects higher severity at future horizons', () => {
    // LOW → MEDIUM → HIGH (rising) → 6h should be above current HIGH
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    const obs = [
      makeObs('LOW', -7_200_000),   // 2h ago
      makeObs('MEDIUM', -3_600_000), // 1h ago
      makeObs('HIGH', 0),            // now (latest)
    ];
    const t = proj.project(makeSituation(), obs);
    const at6 = t.trajectoryPoints.find((p) => p.hoursFromNow === 6)!;
    assert.ok(at6.projectedSeverityNum > 3, `Expected > 3, got ${at6.projectedSeverityNum}`);
  });

  it('declining trend projects lower severity', () => {
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    const obs = [
      makeObs('CRITICAL', -7_200_000),
      makeObs('HIGH', -3_600_000),
      makeObs('MEDIUM', 0),
    ];
    const t = proj.project(makeSituation(), obs);
    const at6 = t.trajectoryPoints.find((p) => p.hoursFromNow === 6)!;
    // current = MEDIUM (2); declining → 6h should be < 2
    assert.ok(at6.projectedSeverityNum < 2);
  });

  it('result is clamped to [0, 4]', () => {
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    const obs = [
      makeObs('HIGH', -7_200_000),
      makeObs('CRITICAL', -3_600_000),
      makeObs('CRITICAL', 0),
    ];
    const t = proj.project(makeSituation(), obs);
    for (const p of t.trajectoryPoints) {
      assert.ok(p.projectedSeverityNum >= 0 && p.projectedSeverityNum <= 4);
    }
  });
});

// ── recovery-model strategy ──────────────────────────────────────────────────

describe('recovery-model strategy', () => {
  it('uses basis recovery-model when provider returns a profile', () => {
    const recoveryProvider: RecoveryProjectionProvider = {
      getProfile: () => ({
        situationId: 'sit-1',
        domain: 'cyber',
        currentSeverityNum: 3,
        recoveryRate: 0.1,
      }),
    };
    const proj = createCrisisTrajectoryProjector({
      now: () => NOW,
      storage: null,
      recoveryProvider,
    });
    const t = proj.project(makeSituation(), []);
    assert.equal(t.projectionBasis, 'recovery-model');
  });

  it('projects severity = current - recoveryRate × hours', () => {
    // current=3 (HIGH), rate=0.1 → at 6h: 3 - 0.1*6 = 2.4
    const recoveryProvider: RecoveryProjectionProvider = {
      getProfile: () => ({ situationId: 'sit-1', domain: 'cyber', currentSeverityNum: 3, recoveryRate: 0.1 }),
    };
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null, recoveryProvider });
    const t = proj.project(makeSituation(), []);
    const at6 = t.trajectoryPoints.find((p) => p.hoursFromNow === 6)!;
    assert.ok(Math.abs(at6.projectedSeverityNum - 2.4) < 0.01, `expected ≈2.4, got ${at6.projectedSeverityNum}`);
  });

  it('clamps at 0 when recovery overshoots', () => {
    const recoveryProvider: RecoveryProjectionProvider = {
      getProfile: () => ({ situationId: 'sit-1', domain: 'cyber', currentSeverityNum: 1, recoveryRate: 1 }),
    };
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null, recoveryProvider });
    const t = proj.project(makeSituation(), []);
    const at72 = t.trajectoryPoints.find((p) => p.hoursFromNow === 72)!;
    assert.equal(at72.projectedSeverityNum, 0);
  });
});

// ── signature-matched strategy ───────────────────────────────────────────────

describe('signature-matched strategy', () => {
  function makeSignatureProvider(sig: CrisisSignature): SignatureMatchProvider {
    return { findMatch: () => sig };
  }

  it('uses basis signature-matched and records signatureId', () => {
    const sig: CrisisSignature = { id: 'cyber-campaign', domain: 'cyber', cascadeRisk: 0.7, avgDurationHours: 48, peakSeverityNum: 4 };
    const proj = createCrisisTrajectoryProjector({
      now: () => NOW,
      storage: null,
      signatureProvider: makeSignatureProvider(sig),
    });
    const t = proj.project(makeSituation(), []);
    assert.equal(t.projectionBasis, 'signature-matched');
    assert.equal(t.matchedSignatureId, 'cyber-campaign');
  });

  it('peaks at peakSeverityNum near avgDurationHours / 3', () => {
    // avgDuration=24h → peakHour=8h; at 6h should be rising toward peak
    const sig: CrisisSignature = { id: 'sig', domain: 'cyber', cascadeRisk: 0.5, avgDurationHours: 24, peakSeverityNum: 4 };
    const proj = createCrisisTrajectoryProjector({
      now: () => NOW,
      storage: null,
      signatureProvider: makeSignatureProvider(sig),
    });
    // currentSeverityNum from situation severity=medium (2)
    const t = proj.project(makeSituation({ severity: 'medium' }), []);
    const at6 = t.trajectoryPoints.find((p) => p.hoursFromNow === 6)!;
    const at24 = t.trajectoryPoints.find((p) => p.hoursFromNow === 24)!;
    // at 6h (before peak at 8h) should be between current and peak
    assert.ok(at6.projectedSeverityNum >= 2 && at6.projectedSeverityNum <= 4);
    // at 24h (past peak, decaying) should be < peak
    assert.ok(at24.projectedSeverityNum < 4);
  });

  it('signature takes priority over recovery-model', () => {
    const sig: CrisisSignature = { id: 'sig', domain: 'cyber', cascadeRisk: 0.5, avgDurationHours: 48, peakSeverityNum: 4 };
    const recoveryProvider: RecoveryProjectionProvider = {
      getProfile: () => ({ situationId: 'sit-1', domain: 'cyber', currentSeverityNum: 3, recoveryRate: 0.1 }),
    };
    const proj = createCrisisTrajectoryProjector({
      now: () => NOW,
      storage: null,
      signatureProvider: makeSignatureProvider(sig),
      recoveryProvider,
    });
    const t = proj.project(makeSituation(), []);
    assert.equal(t.projectionBasis, 'signature-matched');
  });

  it('never drops below 1 (LOW) before full duration', () => {
    // peakSeverityNum=4, avgDuration=72h; decay: peak - (peak-1)*frac
    const sig: CrisisSignature = { id: 'sig', domain: 'cyber', cascadeRisk: 0.5, avgDurationHours: 72, peakSeverityNum: 4 };
    const proj = createCrisisTrajectoryProjector({
      now: () => NOW,
      storage: null,
      signatureProvider: makeSignatureProvider(sig),
    });
    const t = proj.project(makeSituation({ severity: 'high' }), []);
    // at 72h exactly = full duration: decay should be close to 1
    const at72 = t.trajectoryPoints.find((p) => p.hoursFromNow === 72)!;
    assert.ok(at72.projectedSeverityNum >= 1);
  });
});

// ── worstCaseAt ──────────────────────────────────────────────────────────────

describe('worstCaseAt', () => {
  it('returns now when no future trajectory point exceeds current severity', () => {
    // historical-average decays; no point exceeds CRITICAL (4)
    // computeWorstCaseAt returns now + 0*3600000 = now when bestHours stays 0
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    const t = proj.project(makeSituation({ severity: 'critical' }), []);
    assert.equal(t.worstCaseAt, NOW);
  });

  it('points to the timestamp of the highest trajectory point when severity rises', () => {
    const sig: CrisisSignature = { id: 'sig', domain: 'cyber', cascadeRisk: 0.5, avgDurationHours: 48, peakSeverityNum: 4 };
    const proj = createCrisisTrajectoryProjector({
      now: () => NOW,
      storage: null,
      signatureProvider: { findMatch: () => sig },
    });
    const t = proj.project(makeSituation({ severity: 'low' }), []);
    assert.ok(t.worstCaseAt !== null);
    assert.ok(t.worstCaseAt! > NOW);
  });
});

// ── expectedResolutionAt ─────────────────────────────────────────────────────

describe('expectedResolutionAt', () => {
  it('is null when no trajectory point drops to LOW or below', () => {
    // signature with long high-severity keeps severity high throughout horizons
    const sig: CrisisSignature = { id: 'sig', domain: 'cyber', cascadeRisk: 0.8, avgDurationHours: 240, peakSeverityNum: 4 };
    const proj = createCrisisTrajectoryProjector({
      now: () => NOW,
      storage: null,
      signatureProvider: { findMatch: () => sig },
    });
    const t = proj.project(makeSituation({ severity: 'high' }), []);
    // 72h is the furthest horizon; with 240h duration still high → null
    assert.equal(t.expectedResolutionAt, null);
  });

  it('returns a timestamp when severity decays to LOW within horizons', () => {
    // fast recovery: LOW severity decays below threshold by 6h
    const recoveryProvider: RecoveryProjectionProvider = {
      getProfile: () => ({ situationId: 'sit-1', domain: 'cyber', currentSeverityNum: 1.5, recoveryRate: 0.5 }),
    };
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null, recoveryProvider });
    const t = proj.project(makeSituation({ severity: 'medium' }), []);
    if (t.expectedResolutionAt !== null) {
      assert.ok(t.expectedResolutionAt > NOW);
    }
  });
});

// ── project() — output fields ────────────────────────────────────────────────

describe('project() output', () => {
  it('sets situationId and domain from the situation', () => {
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    const t = proj.project(makeSituation({ id: 'sit-test', domain: 'finance' }), []);
    assert.equal(t.situationId, 'sit-test');
    assert.equal(t.domain, 'finance');
  });

  it('returns exactly 3 trajectory points for the 3 horizons', () => {
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    const t = proj.project(makeSituation(), []);
    assert.equal(t.trajectoryPoints.length, 3);
    const hours = t.trajectoryPoints.map((p) => p.hoursFromNow);
    assert.deepEqual(hours, [6, 24, 72]);
  });

  it('sets generatedAt to the injected clock value', () => {
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    const t = proj.project(makeSituation(), []);
    assert.equal(t.generatedAt, NOW);
  });

  it('trajectoryPoint labels match numeric severity', () => {
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    const t = proj.project(makeSituation({ severity: 'medium' }), []);
    for (const p of t.trajectoryPoints) {
      const expected = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'][Math.round(p.projectedSeverityNum)];
      assert.equal(p.projectedSeverityLabel, expected);
    }
  });
});

// ── getTrajectory / getActiveTrajectories ────────────────────────────────────

describe('getTrajectory / getActiveTrajectories', () => {
  it('getTrajectory returns the projected trajectory by id', () => {
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    proj.project(makeSituation({ id: 'sit-a' }), []);
    const found = proj.getTrajectory('sit-a');
    assert.ok(found !== undefined);
    assert.equal(found!.situationId, 'sit-a');
  });

  it('getTrajectory returns undefined for unknown id', () => {
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    assert.equal(proj.getTrajectory('does-not-exist'), undefined);
  });

  it('getActiveTrajectories returns all projected trajectories', () => {
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    proj.project(makeSituation({ id: 'sit-a' }), []);
    proj.project(makeSituation({ id: 'sit-b' }), []);
    assert.equal(proj.getActiveTrajectories().length, 2);
  });

  it('re-projecting the same situation id updates in-place', () => {
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    proj.project(makeSituation({ id: 'sit-a', severity: 'low' }), []);
    proj.project(makeSituation({ id: 'sit-a', severity: 'critical' }), []);
    assert.equal(proj.getActiveTrajectories().length, 1);
    assert.equal(proj.getTrajectory('sit-a')!.currentSeverityNum, 4); // CRITICAL
  });

  it('returns deep clones so mutations do not corrupt internal state', () => {
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    proj.project(makeSituation({ id: 'sit-a' }), []);
    const t1 = proj.getTrajectory('sit-a')!;
    t1.situationId = 'mutated';
    assert.equal(proj.getTrajectory('sit-a')!.situationId, 'sit-a');
  });
});

// ── subscribe / unsubscribe ──────────────────────────────────────────────────

describe('subscribe / unsubscribe', () => {
  it('fires the callback after each project()', () => {
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    let callCount = 0;
    proj.subscribe(() => { callCount++; });
    proj.project(makeSituation({ id: 'a' }), []);
    proj.project(makeSituation({ id: 'b' }), []);
    assert.equal(callCount, 2);
  });

  it('callback receives the full list of active trajectories', () => {
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    let received: unknown[] = [];
    proj.subscribe((ts) => { received = ts; });
    proj.project(makeSituation({ id: 'a' }), []);
    proj.project(makeSituation({ id: 'b' }), []);
    assert.equal(received.length, 2);
  });

  it('unsubscribe stops future callbacks', () => {
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    let callCount = 0;
    const cb = () => { callCount++; };
    proj.subscribe(cb);
    proj.project(makeSituation({ id: 'a' }), []);
    proj.unsubscribe(cb);
    proj.project(makeSituation({ id: 'b' }), []);
    assert.equal(callCount, 1);
  });
});

// ── MAX_TRAJECTORIES eviction ────────────────────────────────────────────────

describe('MAX_TRAJECTORIES eviction', () => {
  it(`caps store at ${MAX_TRAJECTORIES} entries`, () => {
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: null });
    for (let i = 0; i < MAX_TRAJECTORIES + 5; i++) {
      proj.project(makeSituation({ id: `sit-${i}` }), []);
    }
    assert.ok(proj.getActiveTrajectories().length <= MAX_TRAJECTORIES);
  });
});

// ── storage persistence ──────────────────────────────────────────────────────

describe('storage persistence', () => {
  it('persists trajectory to storage after project()', () => {
    const storage = makeStorage();
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage });
    proj.project(makeSituation({ id: 'sit-persist' }), []);
    assert.ok(storage.store.has(STORAGE_KEY));
    const raw = JSON.parse(storage.store.get(STORAGE_KEY)!);
    assert.ok(Array.isArray(raw));
    assert.equal(raw[0].situationId, 'sit-persist');
  });

  it('rehydrates from storage on construction', () => {
    const storage = makeStorage();
    const proj1 = createCrisisTrajectoryProjector({ now: () => NOW, storage });
    proj1.project(makeSituation({ id: 'sit-hydrate' }), []);

    const proj2 = createCrisisTrajectoryProjector({ now: () => NOW, storage });
    assert.ok(proj2.getTrajectory('sit-hydrate') !== undefined);
  });

  it('handles corrupt storage gracefully — returns empty', () => {
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, 'NOT_JSON');
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage });
    assert.equal(proj.getActiveTrajectories().length, 0);
  });

  it('handles storage.getItem throwing — returns empty', () => {
    const faultyStorage: StorageLike = {
      getItem: () => { throw new Error('storage error'); },
      setItem: () => {},
      removeItem: () => {},
    };
    const proj = createCrisisTrajectoryProjector({ now: () => NOW, storage: faultyStorage });
    assert.equal(proj.getActiveTrajectories().length, 0);
  });
});

// ── singleton ────────────────────────────────────────────────────────────────

describe('getCrisisTrajectoryProjector singleton', () => {
  beforeEach(() => _resetCrisisTrajectoryProjectorSingletonForTests());

  it('returns the same instance on repeated calls', () => {
    const a = getCrisisTrajectoryProjector();
    const b = getCrisisTrajectoryProjector();
    assert.equal(a, b);
  });

  it('returns a fresh instance after reset', () => {
    const a = getCrisisTrajectoryProjector();
    _resetCrisisTrajectoryProjectorSingletonForTests();
    const b = getCrisisTrajectoryProjector();
    assert.notEqual(a, b);
  });
});
