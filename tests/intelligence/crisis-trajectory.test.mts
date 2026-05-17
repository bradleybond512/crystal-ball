import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCrisisTrajectoryProjector,
  STORAGE_KEY,
  MAX_TRAJECTORIES,
  HORIZONS,
  CONFIDENCE_BY_HORIZON,
  type CrisisSignature,
  type RecoveryProjectionProfile,
  type ProjectionBasis,
} from '../../src/services/intelligence/crisis-trajectory.ts';
import type { ObservationEvent, ObservationSeverity } from '../../src/types/intelligence.ts';
import type { Situation } from '../../src/services/intelligence/situation-store-v2.ts';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, String(value)); },
    removeItem(key: string) { store.delete(key); },
    clear() { store.clear(); },
    key(i: number) { return [...store.keys()][i] ?? null; },
    get length() { return store.size; },
  };
}

const NOW = new Date('2026-05-17T00:00:00Z').getTime();

let _idCounter = 0;
function obs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  _idCounter += 1;
  return {
    id: overrides.id ?? `ev-${_idCounter}`,
    sourceId: overrides.sourceId ?? 'src-a',
    domain: overrides.domain ?? 'earthquake',
    timestamp: overrides.timestamp ?? NOW,
    location: overrides.location,
    severity: overrides.severity ?? 'HIGH',
    title: 't', raw: {}, entityIds: [], tags: [],
  };
}

function situation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: overrides.id ?? 'sit-1',
    name: 'Test situation',
    domain: overrides.domain ?? 'earthquake',
    relatedDomains: [],
    severity: overrides.severity ?? 'high',
    status: 'active',
    summary: '',
    observations: [],
    edges: [],
    entityIds: [],
    confidence: 0.8,
    startedAt: new Date(NOW),
    updatedAt: new Date(NOW),
    location: { lat: 35, lon: 140, radiusKm: 100 },
    tags: [],
    ...overrides,
  };
}

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-crisis-trajectories"', () => {
  assert.equal(STORAGE_KEY, 'wm-crisis-trajectories');
});

test('MAX_TRAJECTORIES is 100', () => {
  assert.equal(MAX_TRAJECTORIES, 100);
});

test('HORIZONS are [6, 24, 72] hours', () => {
  assert.deepEqual([...HORIZONS], [6, 24, 72]);
});

test('CONFIDENCE_BY_HORIZON decays 20% per step', () => {
  assert.ok(Math.abs(CONFIDENCE_BY_HORIZON[6]! - 1.0) < 0.0001);
  assert.ok(Math.abs(CONFIDENCE_BY_HORIZON[24]! - 0.8) < 0.0001);
  assert.ok(Math.abs(CONFIDENCE_BY_HORIZON[72]! - 0.6) < 0.0001);
});

// ── Basis selection ─────────────────────────────────────────────────────

test('project: signature-matched when signature provider returns a match', () => {
  const sig: CrisisSignature = { id: 's-1', domain: 'earthquake', cascadeRisk: 0.6, avgDurationHours: 48, peakSeverityNum: 3 };
  const svc = createCrisisTrajectoryProjector({
    storage: createMemoryStorage(), now: () => NOW,
    signatureProvider: { findMatch: () => sig },
  });
  const t = svc.project(situation(), [obs()]);
  assert.equal(t.projectionBasis, 'signature-matched');
  assert.equal(t.matchedSignatureId, 's-1');
});

test('project: recovery-model when no signature but recovery profile exists', () => {
  const profile: RecoveryProjectionProfile = {
    situationId: 'sit-1', domain: 'earthquake', currentSeverityNum: 3, recoveryRate: 0.05,
  };
  const svc = createCrisisTrajectoryProjector({
    storage: createMemoryStorage(), now: () => NOW,
    signatureProvider: { findMatch: () => null },
    recoveryProvider: { getProfile: () => profile },
  });
  const t = svc.project(situation(), [obs()]);
  assert.equal(t.projectionBasis, 'recovery-model');
  assert.equal(t.matchedSignatureId, null);
});

test('project: extrapolation when no signature/recovery and >=3 observations', () => {
  const svc = createCrisisTrajectoryProjector({
    storage: createMemoryStorage(), now: () => NOW,
  });
  const observations = [
    obs({ severity: 'CRITICAL', timestamp: NOW - 4 * 3_600_000 }),
    obs({ severity: 'HIGH', timestamp: NOW - 2 * 3_600_000 }),
    obs({ severity: 'MEDIUM', timestamp: NOW }),
  ];
  const t = svc.project(situation(), observations);
  assert.equal(t.projectionBasis, 'extrapolation');
});

test('project: historical-average when fewer than 3 observations', () => {
  const svc = createCrisisTrajectoryProjector({
    storage: createMemoryStorage(), now: () => NOW,
  });
  const t = svc.project(situation(), [obs()]);
  assert.equal(t.projectionBasis, 'historical-average');
});

test('matchedSignatureId is null when basis is not signature-matched', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  const t = svc.project(situation(), [obs()]);
  assert.equal(t.matchedSignatureId, null);
});

// ── Trajectory points / horizons / confidence decay ─────────────────────

test('project always emits 3 trajectory points at horizons 6, 24, 72', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  const t = svc.project(situation(), [obs()]);
  assert.equal(t.trajectoryPoints.length, 3);
  assert.deepEqual(t.trajectoryPoints.map((p) => p.hoursFromNow), [6, 24, 72]);
});

test('confidence is 1.0, 0.8, 0.6 across the three horizons', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  const t = svc.project(situation(), [obs()]);
  assert.ok(Math.abs(t.trajectoryPoints[0]!.confidence - 1.0) < 0.0001);
  assert.ok(Math.abs(t.trajectoryPoints[1]!.confidence - 0.8) < 0.0001);
  assert.ok(Math.abs(t.trajectoryPoints[2]!.confidence - 0.6) < 0.0001);
});

test('projectionHorizons echoes the [6, 24, 72] tuple', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  const t = svc.project(situation(), [obs()]);
  assert.deepEqual([...t.projectionHorizons], [6, 24, 72]);
});

// ── Basis-specific projection shapes ────────────────────────────────────

test('signature-matched: 6h projection peaks above current severity', () => {
  const sig: CrisisSignature = { id: 's-1', domain: 'earthquake', cascadeRisk: 0.7, avgDurationHours: 48, peakSeverityNum: 4 };
  const svc = createCrisisTrajectoryProjector({
    storage: createMemoryStorage(), now: () => NOW,
    signatureProvider: { findMatch: () => sig },
  });
  const t = svc.project(situation({ severity: 'medium' }), [obs({ severity: 'MEDIUM' })]);
  // Highest point should be at or above current severity
  const max = Math.max(...t.trajectoryPoints.map((p) => p.projectedSeverityNum));
  assert.ok(max >= t.currentSeverityNum);
});

test('signature-matched: trajectory eventually decays below peak (signature avgDuration=48h, by 72h should be lower than 24h peak)', () => {
  const sig: CrisisSignature = { id: 's-1', domain: 'earthquake', cascadeRisk: 0.7, avgDurationHours: 48, peakSeverityNum: 4 };
  const svc = createCrisisTrajectoryProjector({
    storage: createMemoryStorage(), now: () => NOW,
    signatureProvider: { findMatch: () => sig },
  });
  const t = svc.project(situation({ severity: 'medium' }), [obs({ severity: 'MEDIUM' })]);
  const at24 = t.trajectoryPoints[1]!.projectedSeverityNum;
  const at72 = t.trajectoryPoints[2]!.projectedSeverityNum;
  assert.ok(at72 <= at24);
});

test('recovery-model: projection drops by rate per hour', () => {
  const profile: RecoveryProjectionProfile = {
    situationId: 'sit-1', domain: 'earthquake', currentSeverityNum: 3, recoveryRate: 0.1,
  };
  const svc = createCrisisTrajectoryProjector({
    storage: createMemoryStorage(), now: () => NOW,
    recoveryProvider: { getProfile: () => profile },
  });
  const t = svc.project(situation({ severity: 'high' }), [obs({ severity: 'HIGH' })]);
  // At 24h, projection should be 3 - 0.1*24 = 0.6 → clamped to 0 floor
  // Specifically: each subsequent horizon should be ≤ the previous
  assert.ok(t.trajectoryPoints[0]!.projectedSeverityNum >= t.trajectoryPoints[2]!.projectedSeverityNum);
});

test('recovery-model: projection clamps to 0 (never goes negative)', () => {
  const profile: RecoveryProjectionProfile = {
    situationId: 'sit-1', domain: 'earthquake', currentSeverityNum: 3, recoveryRate: 1.0,
  };
  const svc = createCrisisTrajectoryProjector({
    storage: createMemoryStorage(), now: () => NOW,
    recoveryProvider: { getProfile: () => profile },
  });
  const t = svc.project(situation({ severity: 'high' }), [obs({ severity: 'HIGH' })]);
  for (const p of t.trajectoryPoints) {
    assert.ok(p.projectedSeverityNum >= 0);
  }
});

test('extrapolation: declining trend continues to decline', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  const observations = [
    obs({ severity: 'CRITICAL', timestamp: NOW - 4 * 3_600_000 }),
    obs({ severity: 'HIGH', timestamp: NOW - 2 * 3_600_000 }),
    obs({ severity: 'MEDIUM', timestamp: NOW }),
  ];
  const t = svc.project(situation({ severity: 'medium' }), observations);
  // Projection should keep declining
  assert.ok(t.trajectoryPoints[2]!.projectedSeverityNum <= t.trajectoryPoints[0]!.projectedSeverityNum);
});

test('extrapolation: clamps to 0..4 range', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  const observations = [
    obs({ severity: 'LOW', timestamp: NOW - 4 * 3_600_000 }),
    obs({ severity: 'MEDIUM', timestamp: NOW - 2 * 3_600_000 }),
    obs({ severity: 'HIGH', timestamp: NOW }),
  ];
  const t = svc.project(situation({ severity: 'high' }), observations);
  for (const p of t.trajectoryPoints) {
    assert.ok(p.projectedSeverityNum >= 0 && p.projectedSeverityNum <= 4);
  }
});

// ── worstCaseAt / expectedResolutionAt ──────────────────────────────────

test('worstCaseAt is the timestamp of the highest projection point', () => {
  const sig: CrisisSignature = { id: 's-1', domain: 'earthquake', cascadeRisk: 0.7, avgDurationHours: 24, peakSeverityNum: 4 };
  const svc = createCrisisTrajectoryProjector({
    storage: createMemoryStorage(), now: () => NOW,
    signatureProvider: { findMatch: () => sig },
  });
  const t = svc.project(situation({ severity: 'medium' }), [obs()]);
  assert.ok(t.worstCaseAt !== null);
  // worstCaseAt should be a timestamp within the projection range
  assert.ok(t.worstCaseAt! >= NOW);
  assert.ok(t.worstCaseAt! <= NOW + 72 * 3_600_000);
});

test('expectedResolutionAt is null when projection never falls to LOW', () => {
  const sig: CrisisSignature = { id: 's-1', domain: 'earthquake', cascadeRisk: 0.9, avgDurationHours: 200, peakSeverityNum: 4 };
  const svc = createCrisisTrajectoryProjector({
    storage: createMemoryStorage(), now: () => NOW,
    signatureProvider: { findMatch: () => sig },
  });
  const t = svc.project(situation({ severity: 'critical' }), [obs({ severity: 'CRITICAL' })]);
  // 200h signature, all 3 horizons within 72h → severity still > 1 at 72h
  assert.equal(t.expectedResolutionAt, null);
});

test('expectedResolutionAt is a timestamp when projection reaches LOW (severityNum <= 1)', () => {
  const profile: RecoveryProjectionProfile = {
    situationId: 'sit-1', domain: 'earthquake', currentSeverityNum: 3, recoveryRate: 0.5,
  };
  const svc = createCrisisTrajectoryProjector({
    storage: createMemoryStorage(), now: () => NOW,
    recoveryProvider: { getProfile: () => profile },
  });
  const t = svc.project(situation({ severity: 'high' }), [obs({ severity: 'HIGH' })]);
  // Rate 0.5/hour: drops to 1 in 4h, so at 24h is well below 1
  assert.ok(typeof t.expectedResolutionAt === 'number');
  assert.ok(t.expectedResolutionAt! >= NOW);
});

// ── Severity label mapping ──────────────────────────────────────────────

test('projectedSeverityLabel maps severityNum → label', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  const observations = [
    obs({ severity: 'CRITICAL', timestamp: NOW - 4 * 3_600_000 }),
    obs({ severity: 'HIGH', timestamp: NOW - 2 * 3_600_000 }),
    obs({ severity: 'MEDIUM', timestamp: NOW }),
  ];
  const t = svc.project(situation(), observations);
  for (const p of t.trajectoryPoints) {
    assert.ok(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(p.projectedSeverityLabel));
  }
});

// ── generatedAt + project replace + getTrajectory ───────────────────────

test('generatedAt is the current clock', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  const t = svc.project(situation(), [obs()]);
  assert.equal(t.generatedAt, NOW);
});

test('project on the same situationId replaces, does not duplicate', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  svc.project(situation({ id: 'sit-X' }), [obs()]);
  svc.project(situation({ id: 'sit-X' }), [obs({ severity: 'LOW' })]);
  assert.equal(svc.getActiveTrajectories().length, 1);
});

test('getTrajectory returns the single trajectory for a situationId', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  svc.project(situation({ id: 'sit-X' }), [obs()]);
  const t = svc.getTrajectory('sit-X');
  assert.ok(t);
  assert.equal(t!.situationId, 'sit-X');
});

test('getTrajectory returns undefined for unknown id', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  assert.equal(svc.getTrajectory('nope'), undefined);
});

test('getActiveTrajectories returns immutable snapshots', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  svc.project(situation(), [obs()]);
  const snap = svc.getActiveTrajectories();
  snap[0]!.matchedSignatureId = 'mutated';
  assert.notEqual(svc.getActiveTrajectories()[0]!.matchedSignatureId, 'mutated');
});

// ── Persistence + ring buffer + subscribe ───────────────────────────────

test('persist + rehydrate round-trip preserves trajectories', () => {
  const storage = createMemoryStorage();
  const svc1 = createCrisisTrajectoryProjector({ storage, now: () => NOW });
  svc1.project(situation({ id: 'sit-X' }), [obs()]);
  const svc2 = createCrisisTrajectoryProjector({ storage, now: () => NOW });
  assert.ok(svc2.getTrajectory('sit-X'));
});

test('subscribe fires on project', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.project(situation({ id: 'a' }), [obs()]);
  svc.project(situation({ id: 'b' }), [obs()]);
  assert.equal(calls, 2);
});

test('unsubscribe stops further callbacks', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  let calls = 0;
  const cb = (): void => { calls += 1; };
  svc.subscribe(cb);
  svc.project(situation({ id: 'a' }), [obs()]);
  svc.unsubscribe(cb);
  svc.project(situation({ id: 'b' }), [obs()]);
  assert.equal(calls, 1);
});

test('ring buffer caps at MAX_TRAJECTORIES', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  for (let i = 0; i < MAX_TRAJECTORIES + 5; i++) {
    svc.project(situation({ id: `s-${i}` }), [obs()]);
  }
  assert.equal(svc.getActiveTrajectories().length, MAX_TRAJECTORIES);
});

test('corrupt storage blob → empty start', () => {
  const storage = createMemoryStorage();
  storage.setItem(STORAGE_KEY, 'not-json-{');
  const svc = createCrisisTrajectoryProjector({ storage, now: () => NOW });
  assert.deepEqual(svc.getActiveTrajectories(), []);
});

// ── Provider absence ────────────────────────────────────────────────────

test('project works without any providers (defaults to historical-average / extrapolation)', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  const t = svc.project(situation(), [obs()]);
  assert.equal(t.projectionBasis, 'historical-average');
  assert.equal(t.trajectoryPoints.length, 3);
});

test('null providers fall through to extrapolation/historical-average', () => {
  const svc = createCrisisTrajectoryProjector({
    storage: createMemoryStorage(), now: () => NOW,
    signatureProvider: { findMatch: () => null },
    recoveryProvider: { getProfile: () => null },
  });
  const t = svc.project(situation(), [obs()]);
  const bases: ProjectionBasis[] = ['signature-matched', 'recovery-model', 'extrapolation', 'historical-average'];
  assert.ok(bases.includes(t.projectionBasis));
  assert.notEqual(t.projectionBasis, 'signature-matched');
  assert.notEqual(t.projectionBasis, 'recovery-model');
});

// ── currentSeverityNum ──────────────────────────────────────────────────

test('currentSeverityNum reflects the latest observation severity', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  const t = svc.project(situation(), [obs({ severity: 'HIGH', timestamp: NOW })]);
  assert.equal(t.currentSeverityNum, 3);
});

test('currentSeverityNum falls back to situation.severity when no observations', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  const t = svc.project(situation({ severity: 'critical' }), []);
  assert.equal(t.currentSeverityNum, 4);
});

// ── shape integrity ─────────────────────────────────────────────────────

test('every trajectory carries situationId, domain, currentSeverityNum, generatedAt', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  const t = svc.project(situation({ id: 'sit-1', domain: 'weather' }), [obs({ severity: 'HIGH' })]);
  assert.equal(t.situationId, 'sit-1');
  assert.equal(t.domain, 'weather');
  assert.equal(typeof t.currentSeverityNum, 'number');
  assert.equal(typeof t.generatedAt, 'number');
});

// Sanity check on imports
test('ObservationSeverity values are accepted by the projector', () => {
  const svc = createCrisisTrajectoryProjector({ storage: createMemoryStorage(), now: () => NOW });
  const severities: ObservationSeverity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  for (const s of severities) {
    const t = svc.project(situation({ id: `s-${s}` }), [obs({ severity: s })]);
    assert.equal(t.trajectoryPoints.length, 3);
  }
});
