/**
 * Tests for ThreatHorizonScanner — Phase 4 24/48/72h emerging threat fusion.
 *
 * Run with: npx tsx --test tests/intelligence/threat-horizon.test.mts
 *
 * Pure-service tests with injected providers + localStorage stub so
 * the live upstream singletons stay untouched.
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
  RECOMMENDED_ACTION_TEMPLATES,
  ThreatHorizonScanner,
  __internals as scannerInternals,
  __resetThreatHorizonSingleton,
  getThreatHorizonScanner,
  type HorizonThreat,
  type ThreatProviders,
} from '../../src/services/intelligence/threat-horizon.ts';
import type { AnomalyScore } from '../../src/services/intelligence/global-rhythm.ts';
import type { CrisisTrajectory, TrajectoryPoint } from '../../src/services/intelligence/crisis-trajectory.ts';
import type { EscalationRisk } from '../../src/services/intelligence/failure-prediction.ts';
import type { SignatureMatch } from '../../src/services/intelligence/crisis-signature.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-adapters.ts';

const NOW = 1_745_000_000_000;

// ── Fixtures ─────────────────────────────────────────────────────────

function obs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'obs-1',
    sourceId: 'src',
    domain: 'earthquake',
    timestamp: NOW,
    severity: 'HIGH',
    title: 't',
    raw: {},
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function failureRisk(overrides: Partial<EscalationRisk> = {}): EscalationRisk {
  return {
    observationId: 'obs-1',
    domain: 'earthquake',
    currentSeverity: 'HIGH',
    predictedSeverity: 'CRITICAL',
    probability: 0.7,
    horizon: '24h',
    factors: ['M7+ in seismic zone'],
    predictedAt: NOW,
    ...overrides,
  };
}

function anomaly(overrides: Partial<AnomalyScore> = {}): AnomalyScore {
  return {
    observationId: 'obs-1',
    domain: 'earthquake',
    currentSeverityNum: 0.75,
    expectedSeverityNum: 0.3,
    deviation: 0.45,
    isAnomaly: true,
    anomalyStrength: 'moderate',
    timestamp: NOW,
    ...overrides,
  };
}

function trajectoryPoint(overrides: Partial<TrajectoryPoint> = {}): TrajectoryPoint {
  return {
    hoursFromNow: 24,
    projectedSeverityNum: 3,
    projectedSeverityLabel: 'high',
    confidence: 0.8,
    ...overrides,
  };
}

function trajectory(overrides: Partial<CrisisTrajectory> = {}): CrisisTrajectory {
  return {
    situationId: 'sit-1',
    domain: 'earthquake',
    currentSeverityNum: 2,
    projectionHorizons: [24, 48, 72],
    trajectoryPoints: [trajectoryPoint()],
    projectionBasis: 'signature-matched',
    matchedSignatureId: null,
    worstCaseAt: null,
    expectedResolutionAt: null,
    generatedAt: NOW,
    ...overrides,
  };
}

function signatureMatch(overrides: Partial<SignatureMatch> = {}): SignatureMatch {
  return {
    signatureId: 'sig-1',
    signatureName: 'M7 subduction cascade',
    matchScore: 0.85,
    matchedFeatures: ['domain-cascade'],
    missingFeatures: [],
    confidence: 'high',
    detectedAt: NOW,
    ...overrides,
  };
}

function freshScanner(providers: ThreatProviders = {}, now = NOW): ThreatHorizonScanner {
  __storage.clear();
  __resetThreatHorizonSingleton();
  return new ThreatHorizonScanner({ clock: () => now, providers });
}

// ── scan() basics ───────────────────────────────────────────────────

test('scan with no providers produces no threats', () => {
  const s = freshScanner();
  assert.deepEqual(s.scan([]), []);
});

test('scan with one failure-prediction risk creates a 24h threat', () => {
  const s = freshScanner({ failurePrediction: () => [failureRisk()] });
  const threats = s.scan([obs()]);
  assert.equal(threats.length, 1);
  assert.equal(threats[0].horizon, '24h');
  assert.equal(threats[0].domain, 'earthquake');
  assert.deepEqual(threats[0].basis, ['failure-prediction']);
  assert.equal(threats[0].status, 'watching');
});

test('scan with one trajectory point sorts into the matching horizon bucket', () => {
  const s = freshScanner({
    crisisTrajectory: () => [trajectory({ trajectoryPoints: [
      trajectoryPoint({ hoursFromNow: 24 }),
      trajectoryPoint({ hoursFromNow: 48 }),
      trajectoryPoint({ hoursFromNow: 72 }),
    ] })],
  });
  const threats = s.scan([]);
  const horizons = new Set(threats.map((t) => t.horizon));
  assert.ok(horizons.has('24h'));
  assert.ok(horizons.has('48h'));
  assert.ok(horizons.has('72h'));
});

test('trajectoryPointHorizon buckets — ≤24=24h, 25-48=48h, >48=72h', () => {
  assert.equal(scannerInternals.trajectoryPointHorizon({ hoursFromNow: 24, projectedSeverityNum: 0, projectedSeverityLabel: 'low', confidence: 1 }), '24h');
  assert.equal(scannerInternals.trajectoryPointHorizon({ hoursFromNow: 36, projectedSeverityNum: 0, projectedSeverityLabel: 'low', confidence: 1 }), '48h');
  assert.equal(scannerInternals.trajectoryPointHorizon({ hoursFromNow: 60, projectedSeverityNum: 0, projectedSeverityLabel: 'low', confidence: 1 }), '72h');
});

test('scan with one anomaly creates a threat only when isAnomaly=true', () => {
  const notAnAnomaly = anomaly({ isAnomaly: false, anomalyStrength: 'none' });
  const yes = anomaly();
  const a = freshScanner({ globalRhythm: () => [notAnAnomaly] });
  const b = freshScanner({ globalRhythm: () => [yes] });
  assert.equal(a.scan([obs()]).length, 0);
  assert.equal(b.scan([obs()]).length, 1);
});

test('signature match resolves domain via the lookup', () => {
  const withLookup = freshScanner({
    crisisSignature: () => [signatureMatch()],
    signatureDomainLookup: (id) => id === 'sig-1' ? 'wildfire' : undefined,
  });
  assert.equal(withLookup.scan([]).find((t) => t.basis.includes('crisis-signature'))?.domain, 'wildfire');
});

test('signature match without a lookup defaults to "unknown" domain', () => {
  // Fresh storage state — must clear before constructing so a prior
  // test's persisted threats don't leak in.
  const withoutLookup = freshScanner({ crisisSignature: () => [signatureMatch()] });
  assert.equal(withoutLookup.scan([]).find((t) => t.basis.includes('crisis-signature'))?.domain, 'unknown');
});

// ── Merge by (domain, region, horizon) ──────────────────────────────

test('scan merges signals from multiple providers into one threat per key', () => {
  const s = freshScanner({
    failurePrediction: () => [failureRisk()],
    globalRhythm: () => [anomaly()],
    crisisTrajectory: () => [trajectory()],
  });
  const threats = s.scan([obs()]);
  // All three contributors share (earthquake, default region, 24h) → 1 threat.
  const at24h = threats.filter((t) => t.horizon === '24h');
  assert.equal(at24h.length, 1);
  const t = at24h[0]!;
  assert.ok(t.basis.includes('failure-prediction'));
  assert.ok(t.basis.includes('global-rhythm'));
  assert.ok(t.basis.includes('crisis-trajectory'));
});

test('probability merges as max across contributors', () => {
  const s = freshScanner({
    failurePrediction: () => [failureRisk({ probability: 0.4 })],
    globalRhythm: () => [anomaly({ anomalyStrength: 'strong' })], // 0.8
  });
  const t = s.scan([obs()])[0]!;
  assert.equal(t.probability, 0.8);
});

test('earlyWarningSignals concatenate unique entries from each contributor', () => {
  const s = freshScanner({
    failurePrediction: () => [failureRisk()],
    globalRhythm: () => [anomaly()],
  });
  const t = s.scan([obs()])[0]!;
  assert.equal(t.earlyWarningSignals.length, 2);
});

test('threats from different domains stay separate', () => {
  const s = freshScanner({
    failurePrediction: () => [
      failureRisk({ observationId: 'a', domain: 'earthquake' }),
      failureRisk({ observationId: 'b', domain: 'cyber' }),
    ],
  });
  const threats = s.scan([
    obs({ id: 'a', domain: 'earthquake' }),
    obs({ id: 'b', domain: 'cyber' }),
  ]);
  assert.equal(threats.length, 2);
  const domains = new Set(threats.map((t) => t.domain));
  assert.ok(domains.has('earthquake'));
  assert.ok(domains.has('cyber'));
});

test('threats from different regions (derived from entityIds) stay separate', () => {
  const s = freshScanner({
    failurePrediction: () => [
      failureRisk({ observationId: 'us-1' }),
      failureRisk({ observationId: 'jp-1' }),
    ],
  });
  const threats = s.scan([
    obs({ id: 'us-1', entityIds: ['US'] }),
    obs({ id: 'jp-1', entityIds: ['JP'] }),
  ]);
  assert.equal(threats.length, 2);
  const regions = new Set(threats.map((t) => t.region));
  assert.ok(regions.has('US'));
  assert.ok(regions.has('JP'));
});

test('regionForObservation: entityId match → entity, tag fallback, lat/lon fallback, else global', () => {
  assert.equal(scannerInternals.regionForObservation(undefined), 'global');
  assert.equal(scannerInternals.regionForObservation(obs({ entityIds: ['US'] })), 'US');
  assert.equal(scannerInternals.regionForObservation(obs({ entityIds: [], tags: ['california'] })), 'california');
  const withLoc = obs({ entityIds: [], tags: [], location: { lat: 35.6, lon: 139.7, radiusKm: 50 } });
  assert.equal(scannerInternals.regionForObservation(withLoc), '36,140');
});

// ── Status carry-forward ─────────────────────────────────────────────

test('dismissed threats stay dismissed on subsequent scans', () => {
  const s = freshScanner({ failurePrediction: () => [failureRisk()] });
  const threats = s.scan([obs()]);
  const id = threats[0]!.id;
  s.dismiss(id, 'false positive');
  // Re-run with the same provider — the merged refresh should respect
  // the dismissal and not resurface this combo.
  const after = s.scan([obs()]);
  const dismissed = after.find((t) => t.id === id);
  assert.equal(dismissed?.status, 'dismissed');
  // Newly emitted threat for the same key is suppressed.
  const watching = after.filter((t) => t.domain === 'earthquake' && t.horizon === '24h' && t.status === 'watching');
  assert.equal(watching.length, 0);
});

test('escalating threats carry that status forward across scans', () => {
  const s = freshScanner({ failurePrediction: () => [failureRisk()] });
  const first = s.scan([obs()])[0]!;
  s.markEscalating(first.id);
  const refreshed = s.scan([obs()]).find((t) => t.domain === 'earthquake' && t.horizon === '24h');
  assert.equal(refreshed?.status, 'escalating');
});

test('dismiss(id, reason) appends the reason to earlyWarningSignals', () => {
  const s = freshScanner({ failurePrediction: () => [failureRisk()] });
  const id = s.scan([obs()])[0]!.id;
  s.dismiss(id, 'false positive');
  const stored = s.getThreats().find((t) => t.id === id)!;
  assert.ok(stored.earlyWarningSignals.some((sig) => sig.includes('Dismissed: false positive')));
});

test('dismiss on unknown id is a no-op', () => {
  const s = freshScanner({ failurePrediction: () => [failureRisk()] });
  s.scan([obs()]);
  s.dismiss('nonexistent', 'whatever');
  assert.equal(s.getThreats().every((t) => t.status === 'watching'), true);
});

test('markEscalating on unknown id is a no-op', () => {
  const s = freshScanner();
  s.markEscalating('nope');
  assert.deepEqual(s.getThreats(), []);
});

// ── Recommended actions ──────────────────────────────────────────────

test('recommendedActionsFor known domain returns the domain template', () => {
  const actions = scannerInternals.recommendedActionsFor('cyber');
  assert.deepEqual(actions, [...RECOMMENDED_ACTION_TEMPLATES.cyber!]);
});

test('recommendedActionsFor unknown domain returns the default template', () => {
  const actions = scannerInternals.recommendedActionsFor('zzz-novel');
  assert.deepEqual(actions, [...RECOMMENDED_ACTION_TEMPLATES.default!]);
});

test('all 6 spec-required domain templates are present', () => {
  for (const d of ['earthquake', 'biosurveillance', 'weather', 'maritime', 'cyber', 'wildfire']) {
    const tmpl = RECOMMENDED_ACTION_TEMPLATES[d];
    assert.ok(tmpl && tmpl.length >= 3, `missing template for ${d}`);
  }
});

test('threats carry recommendedActions populated from the domain template', () => {
  const s = freshScanner({ failurePrediction: () => [failureRisk({ domain: 'wildfire' })] });
  const t = s.scan([obs({ domain: 'wildfire' })])[0]!;
  assert.deepEqual(t.recommendedActions, [...RECOMMENDED_ACTION_TEMPLATES.wildfire!]);
});

// ── Query API ────────────────────────────────────────────────────────

test('getThreats returns defensive copies', () => {
  const s = freshScanner({ failurePrediction: () => [failureRisk()] });
  s.scan([obs()]);
  const a = s.getThreats();
  a[0]!.basis.push('crisis-signature'); // try to mutate
  const b = s.getThreats();
  assert.ok(!b[0]!.basis.includes('crisis-signature'));
});

test('getByHorizon filters and sorts by probability DESC', () => {
  const s = freshScanner({
    failurePrediction: () => [
      failureRisk({ observationId: 'lo', probability: 0.4 }),
      failureRisk({ observationId: 'hi', probability: 0.9 }),
    ],
  });
  s.scan([
    obs({ id: 'lo', entityIds: ['LO'] }),
    obs({ id: 'hi', entityIds: ['HI'] }),
  ]);
  const at24 = s.getByHorizon('24h');
  assert.equal(at24.length, 2);
  assert.ok(at24[0]!.probability >= at24[1]!.probability);
});

test('getByHorizon returns empty for horizons with no threats', () => {
  const s = freshScanner();
  assert.deepEqual(s.getByHorizon('72h'), []);
});

// ── Ring buffer + persistence ────────────────────────────────────────

test('ring buffer at MAX_THREATS + 1 evicts oldest', () => {
  // Build risks across many synthetic regions so each lands on its own row.
  const risks: EscalationRisk[] = [];
  const observations: ObservationEvent[] = [];
  const max = scannerInternals.MAX_THREATS;
  for (let i = 0; i < max + 5; i++) {
    risks.push(failureRisk({ observationId: `o-${i}`, probability: 0.5 }));
    observations.push(obs({ id: `o-${i}`, entityIds: [`R${i.toString().padStart(3, '0')}`] }));
  }
  const s = freshScanner({ failurePrediction: () => risks });
  s.scan(observations);
  assert.equal(s.getThreats().length, max);
});

test('threats persist across instances via localStorage', () => {
  const a = freshScanner({ failurePrediction: () => [failureRisk()] });
  a.scan([obs()]);
  const b = new ThreatHorizonScanner({ clock: () => NOW });
  assert.equal(b.getThreats().length, 1);
});

test('corrupt persisted blob does not crash hydrate', () => {
  __storage.clear();
  __resetThreatHorizonSingleton();
  __storage.set(scannerInternals.STORAGE_KEY, '{not valid');
  const s = new ThreatHorizonScanner({ clock: () => NOW });
  assert.deepEqual(s.getThreats(), []);
});

// ── Subscribe + singleton ────────────────────────────────────────────

test('subscribe fires on each scan / dismiss / markEscalating', () => {
  const s = freshScanner({ failurePrediction: () => [failureRisk()] });
  let calls = 0;
  s.subscribe(() => { calls += 1; });
  s.scan([obs()]);
  const id = s.getThreats()[0]!.id;
  s.markEscalating(id);
  s.dismiss(id, 'x');
  assert.equal(calls, 3);
});

test('subscribe listener exception is isolated', () => {
  const s = freshScanner({ failurePrediction: () => [failureRisk()] });
  s.subscribe(() => { throw new Error('boom'); });
  let secondCalled = false;
  s.subscribe(() => { secondCalled = true; });
  s.scan([obs()]);
  assert.equal(secondCalled, true);
});

test('getThreatHorizonScanner() returns a stable singleton', () => {
  __storage.clear();
  __resetThreatHorizonSingleton();
  const a = getThreatHorizonScanner();
  const b = getThreatHorizonScanner();
  assert.strictEqual(a, b);
});

// ── Severity helpers ─────────────────────────────────────────────────

test('severityLabel buckets numeric ladder ranks to label strings', () => {
  assert.equal(scannerInternals.severityLabel(4), 'critical');
  assert.equal(scannerInternals.severityLabel(3), 'high');
  assert.equal(scannerInternals.severityLabel(2), 'medium');
  assert.equal(scannerInternals.severityLabel(1), 'low');
  assert.equal(scannerInternals.severityLabel(0.1), 'info');
});

test('severityRank monotonic increasing across the ladder', () => {
  const order = ['info', 'low', 'medium', 'high', 'critical'];
  for (let i = 1; i < order.length; i++) {
    assert.ok(scannerInternals.severityRank(order[i]!) > scannerInternals.severityRank(order[i - 1]!));
  }
});

test('mergeDrafts promotes severity to the highest contributor', () => {
  const s = freshScanner({
    crisisTrajectory: () => [trajectory({
      trajectoryPoints: [
        trajectoryPoint({ hoursFromNow: 24, projectedSeverityLabel: 'medium', confidence: 0.7 }),
      ],
    })],
    failurePrediction: () => [failureRisk({ currentSeverity: 'critical', predictedSeverity: 'critical' })],
  });
  const t = s.scan([obs()])[0]!;
  assert.equal(t.projectedSeverity, 'critical');
});

// ── Anomaly + signature probability tables ──────────────────────────

test('ANOMALY_PROBABILITY scales by strength', () => {
  const map = scannerInternals.ANOMALY_PROBABILITY;
  assert.ok(map.strong > map.moderate);
  assert.ok(map.moderate > map.mild);
  assert.ok(map.mild > map.none);
});

test('SIGNATURE_CONFIDENCE_PROBABILITY scales by label', () => {
  const map = scannerInternals.SIGNATURE_CONFIDENCE_PROBABILITY;
  assert.ok(map.high > map.medium);
  assert.ok(map.medium > map.low);
});

test('signature probability uses max of confidence-label + matchScore', () => {
  // Confidence high → 0.8 baseline; matchScore 0.95 should win.
  const s = freshScanner({
    crisisSignature: () => [signatureMatch({ confidence: 'high', matchScore: 0.95 })],
    signatureDomainLookup: () => 'cyber',
  });
  const t = s.scan([])[0]!;
  assert.ok(Math.abs(t.probability - 0.95) < 1e-9);
});
