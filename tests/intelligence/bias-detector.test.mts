import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createBiasDetectorService,
  detectAnchoring,
  detectAvailability,
  detectConfirmation,
  detectRecency,
  detectDomainNeglect,
  detectOverconfidence,
  computeOverallRisk,
  computeDominantBias,
  STORAGE_KEY,
  MAX_SIGNALS,
  type BiasDriverScore,
  type BiasSituation,
  type BiasHypothesisSet,
  type BiasOutcomeRecord,
  type BiasMetaConfidence,
  type BiasSignal,
} from '../../src/services/intelligence/bias-detector.ts';

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

const NOW = new Date('2026-05-16T12:00:00Z');

function ds(overrides: Partial<BiasDriverScore> = {}): BiasDriverScore {
  return {
    observationId: 'ev-0',
    situationId: 'sit-1',
    domain: 'earthquake',
    finalScore: 0.5,
    derivedSeverity: 'medium',
    observedAt: NOW,
    ...overrides,
  };
}

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-bias-signals"', () => {
  assert.equal(STORAGE_KEY, 'wm-bias-signals');
});

test('MAX_SIGNALS is 500', () => {
  assert.equal(MAX_SIGNALS, 500);
});

// ── detectAnchoring ──────────────────────────────────────────────────────

test('detectAnchoring: first observation 3× mean of subsequent → alert signal', () => {
  const scores = [
    ds({ observationId: 'a', situationId: 's', finalScore: 0.9 }),
    ds({ observationId: 'b', situationId: 's', finalScore: 0.3 }),
    ds({ observationId: 'c', situationId: 's', finalScore: 0.3 }),
  ];
  const signals = detectAnchoring(scores, NOW);
  assert.equal(signals.length, 1);
  assert.equal(signals[0]!.type, 'anchoring');
  assert.equal(signals[0]!.severity, 'alert');
});

test('detectAnchoring: first observation 2× mean → warning signal', () => {
  const scores = [
    ds({ observationId: 'a', situationId: 's', finalScore: 0.6 }),
    ds({ observationId: 'b', situationId: 's', finalScore: 0.3 }),
    ds({ observationId: 'c', situationId: 's', finalScore: 0.3 }),
  ];
  const signals = detectAnchoring(scores, NOW);
  assert.equal(signals.length, 1);
  assert.equal(signals[0]!.severity, 'warning');
});

test('detectAnchoring: first observation 1.5× mean → no signal', () => {
  const scores = [
    ds({ observationId: 'a', situationId: 's', finalScore: 0.45 }),
    ds({ observationId: 'b', situationId: 's', finalScore: 0.3 }),
    ds({ observationId: 'c', situationId: 's', finalScore: 0.3 }),
  ];
  const signals = detectAnchoring(scores, NOW);
  assert.equal(signals.length, 0);
});

test('detectAnchoring: fewer than 3 observations → no signal', () => {
  const scores = [
    ds({ observationId: 'a', situationId: 's', finalScore: 0.9 }),
    ds({ observationId: 'b', situationId: 's', finalScore: 0.2 }),
  ];
  assert.equal(detectAnchoring(scores, NOW).length, 0);
});

test('detectAnchoring: scores from multiple situations are grouped independently', () => {
  const scores = [
    ds({ observationId: 'a', situationId: 's1', finalScore: 0.9 }),
    ds({ observationId: 'b', situationId: 's1', finalScore: 0.3 }),
    ds({ observationId: 'c', situationId: 's1', finalScore: 0.3 }),
    ds({ observationId: 'd', situationId: 's2', finalScore: 0.4 }),
    ds({ observationId: 'e', situationId: 's2', finalScore: 0.4 }),
    ds({ observationId: 'f', situationId: 's2', finalScore: 0.4 }),
  ];
  const signals = detectAnchoring(scores, NOW);
  assert.equal(signals.length, 1);
  assert.equal(signals[0]!.affectedTargetIds[0], 's1');
});

// ── detectAvailability ───────────────────────────────────────────────────

test('detectAvailability: current domain mean >50% above rolling avg → warning', () => {
  const scores = [
    ds({ domain: 'earthquake', finalScore: 0.9 }),
    ds({ domain: 'earthquake', finalScore: 0.85 }),
  ];
  const signals = detectAvailability(scores, { earthquake: 0.5 }, NOW);
  assert.equal(signals.length, 1);
  assert.equal(signals[0]!.type, 'availability');
  assert.equal(signals[0]!.severity, 'warning');
});

test('detectAvailability: current mean 2× rolling avg → alert', () => {
  const scores = [
    ds({ domain: 'earthquake', finalScore: 0.9 }),
    ds({ domain: 'earthquake', finalScore: 0.9 }),
  ];
  const signals = detectAvailability(scores, { earthquake: 0.4 }, NOW);
  assert.equal(signals[0]!.severity, 'alert');
});

test('detectAvailability: current mean only 20% above rolling avg → no signal', () => {
  const scores = [
    ds({ domain: 'earthquake', finalScore: 0.55 }),
    ds({ domain: 'earthquake', finalScore: 0.65 }),
  ];
  assert.equal(detectAvailability(scores, { earthquake: 0.5 }, NOW).length, 0);
});

test('detectAvailability: missing rolling avg for a domain → no signal', () => {
  const scores = [ds({ domain: 'earthquake', finalScore: 0.9 })];
  assert.equal(detectAvailability(scores, {}, NOW).length, 0);
});

// ── detectConfirmation ───────────────────────────────────────────────────

test('detectConfirmation: 0 contradicting obs, posterior 0.75, age 13h → warning', () => {
  const sets: BiasHypothesisSet[] = [{
    id: 'h-1', domain: 'cyber', leadingPosterior: 0.75,
    contradictingObservationCount: 0,
    createdAt: new Date(NOW.getTime() - 13 * 60 * 60_000),
  }];
  const signals = detectConfirmation(sets, NOW);
  assert.equal(signals.length, 1);
  assert.equal(signals[0]!.severity, 'warning');
});

test('detectConfirmation: posterior 0.9 → alert', () => {
  const sets: BiasHypothesisSet[] = [{
    id: 'h-1', domain: 'cyber', leadingPosterior: 0.9,
    contradictingObservationCount: 0,
    createdAt: new Date(NOW.getTime() - 13 * 60 * 60_000),
  }];
  assert.equal(detectConfirmation(sets, NOW)[0]!.severity, 'alert');
});

test('detectConfirmation: posterior 0.6 (below 0.7 threshold) → no signal', () => {
  const sets: BiasHypothesisSet[] = [{
    id: 'h-1', domain: 'cyber', leadingPosterior: 0.6,
    contradictingObservationCount: 0,
    createdAt: new Date(NOW.getTime() - 13 * 60 * 60_000),
  }];
  assert.equal(detectConfirmation(sets, NOW).length, 0);
});

test('detectConfirmation: contradicting obs present → no signal', () => {
  const sets: BiasHypothesisSet[] = [{
    id: 'h-1', domain: 'cyber', leadingPosterior: 0.85,
    contradictingObservationCount: 2,
    createdAt: new Date(NOW.getTime() - 13 * 60 * 60_000),
  }];
  assert.equal(detectConfirmation(sets, NOW).length, 0);
});

test('detectConfirmation: age <12h → no signal', () => {
  const sets: BiasHypothesisSet[] = [{
    id: 'h-1', domain: 'cyber', leadingPosterior: 0.85,
    contradictingObservationCount: 0,
    createdAt: new Date(NOW.getTime() - 11 * 60 * 60_000),
  }];
  assert.equal(detectConfirmation(sets, NOW).length, 0);
});

// ── detectRecency ────────────────────────────────────────────────────────

test('detectRecency: confidence drift 0.2 without new obs → warning', () => {
  const situations: BiasSituation[] = [{
    id: 'sit-1', domain: 'weather',
    confidence: 0.75, latestConfidenceDelta: 0.2,
    addedObservationsInLastUpdate: 0,
    updatedAt: NOW,
  }];
  const signals = detectRecency(situations, NOW);
  assert.equal(signals.length, 1);
  assert.equal(signals[0]!.severity, 'warning');
});

test('detectRecency: confidence drift 0.3 → alert', () => {
  const situations: BiasSituation[] = [{
    id: 'sit-1', domain: 'weather',
    confidence: 0.85, latestConfidenceDelta: 0.3,
    addedObservationsInLastUpdate: 0,
    updatedAt: NOW,
  }];
  assert.equal(detectRecency(situations, NOW)[0]!.severity, 'alert');
});

test('detectRecency: drift accompanied by new obs → no signal', () => {
  const situations: BiasSituation[] = [{
    id: 'sit-1', domain: 'weather',
    confidence: 0.75, latestConfidenceDelta: 0.2,
    addedObservationsInLastUpdate: 3,
    updatedAt: NOW,
  }];
  assert.equal(detectRecency(situations, NOW).length, 0);
});

test('detectRecency: drift <0.15 → no signal', () => {
  const situations: BiasSituation[] = [{
    id: 'sit-1', domain: 'weather',
    confidence: 0.65, latestConfidenceDelta: 0.1,
    addedObservationsInLastUpdate: 0,
    updatedAt: NOW,
  }];
  assert.equal(detectRecency(situations, NOW).length, 0);
});

// ── detectDomainNeglect ──────────────────────────────────────────────────

test('detectDomainNeglect: >60% dismissed + medium/high driver scores → warning', () => {
  // 4 dismissed of 6 = 66.7% — inside the warning band (≥60%, <80%).
  const outcomes: BiasOutcomeRecord[] = [
    { domain: 'cyber', actualOutcome: 'dismissed', predictedSeverity: 'medium', recordedAt: NOW },
    { domain: 'cyber', actualOutcome: 'dismissed', predictedSeverity: 'medium', recordedAt: NOW },
    { domain: 'cyber', actualOutcome: 'marked-false-positive', predictedSeverity: 'high', recordedAt: NOW },
    { domain: 'cyber', actualOutcome: 'dismissed', predictedSeverity: 'medium', recordedAt: NOW },
    { domain: 'cyber', actualOutcome: 'acted-on', predictedSeverity: 'high', recordedAt: NOW },
    { domain: 'cyber', actualOutcome: 'acted-on', predictedSeverity: 'high', recordedAt: NOW },
  ];
  const scores = [ds({ domain: 'cyber', derivedSeverity: 'medium' })];
  const signals = detectDomainNeglect(outcomes, scores, NOW);
  assert.equal(signals.length, 1);
  assert.equal(signals[0]!.severity, 'warning');
});

test('detectDomainNeglect: >80% dismissed → alert', () => {
  const outcomes: BiasOutcomeRecord[] = [
    { domain: 'cyber', actualOutcome: 'dismissed', predictedSeverity: 'medium', recordedAt: NOW },
    { domain: 'cyber', actualOutcome: 'dismissed', predictedSeverity: 'medium', recordedAt: NOW },
    { domain: 'cyber', actualOutcome: 'dismissed', predictedSeverity: 'medium', recordedAt: NOW },
    { domain: 'cyber', actualOutcome: 'dismissed', predictedSeverity: 'medium', recordedAt: NOW },
    { domain: 'cyber', actualOutcome: 'dismissed', predictedSeverity: 'medium', recordedAt: NOW },
    { domain: 'cyber', actualOutcome: 'acted-on', predictedSeverity: 'high', recordedAt: NOW },
  ];
  const scores = [ds({ domain: 'cyber', derivedSeverity: 'high' })];
  assert.equal(detectDomainNeglect(outcomes, scores, NOW)[0]!.severity, 'alert');
});

test('detectDomainNeglect: <5 outcomes for a domain → no signal', () => {
  const outcomes: BiasOutcomeRecord[] = [
    { domain: 'cyber', actualOutcome: 'dismissed', predictedSeverity: 'medium', recordedAt: NOW },
    { domain: 'cyber', actualOutcome: 'dismissed', predictedSeverity: 'medium', recordedAt: NOW },
  ];
  const scores = [ds({ domain: 'cyber', derivedSeverity: 'medium' })];
  assert.equal(detectDomainNeglect(outcomes, scores, NOW).length, 0);
});

test('detectDomainNeglect: high dismiss rate but only low-severity scores → no signal', () => {
  const outcomes: BiasOutcomeRecord[] = [
    { domain: 'cyber', actualOutcome: 'dismissed', predictedSeverity: 'medium', recordedAt: NOW },
    { domain: 'cyber', actualOutcome: 'dismissed', predictedSeverity: 'medium', recordedAt: NOW },
    { domain: 'cyber', actualOutcome: 'dismissed', predictedSeverity: 'medium', recordedAt: NOW },
    { domain: 'cyber', actualOutcome: 'dismissed', predictedSeverity: 'medium', recordedAt: NOW },
    { domain: 'cyber', actualOutcome: 'dismissed', predictedSeverity: 'medium', recordedAt: NOW },
  ];
  const scores = [ds({ domain: 'cyber', derivedSeverity: 'low' })];
  assert.equal(detectDomainNeglect(outcomes, scores, NOW).length, 0);
});

// ── detectOverconfidence ─────────────────────────────────────────────────

test('detectOverconfidence: metaConf 0.9 + accuracy 0.3 → alert', () => {
  const meta: BiasMetaConfidence[] = [{ domain: 'weather', metaConfidence: 0.9 }];
  const outcomes: BiasOutcomeRecord[] = [
    { domain: 'weather', actualOutcome: 'dismissed', predictedSeverity: 'high', recordedAt: NOW },
    { domain: 'weather', actualOutcome: 'dismissed', predictedSeverity: 'high', recordedAt: NOW },
    { domain: 'weather', actualOutcome: 'dismissed', predictedSeverity: 'high', recordedAt: NOW },
    { domain: 'weather', actualOutcome: 'dismissed', predictedSeverity: 'high', recordedAt: NOW },
    { domain: 'weather', actualOutcome: 'dismissed', predictedSeverity: 'high', recordedAt: NOW },
    { domain: 'weather', actualOutcome: 'dismissed', predictedSeverity: 'high', recordedAt: NOW },
    { domain: 'weather', actualOutcome: 'dismissed', predictedSeverity: 'high', recordedAt: NOW },
    { domain: 'weather', actualOutcome: 'acted-on', predictedSeverity: 'high', recordedAt: NOW },
    { domain: 'weather', actualOutcome: 'acted-on', predictedSeverity: 'high', recordedAt: NOW },
    { domain: 'weather', actualOutcome: 'acted-on', predictedSeverity: 'high', recordedAt: NOW },
  ];
  const signals = detectOverconfidence(meta, outcomes, NOW);
  assert.equal(signals.length, 1);
  assert.equal(signals[0]!.severity, 'alert');
});

test('detectOverconfidence: metaConf 0.7 (below 0.8 threshold) → no signal', () => {
  const meta: BiasMetaConfidence[] = [{ domain: 'weather', metaConfidence: 0.7 }];
  const outcomes: BiasOutcomeRecord[] = Array.from({ length: 5 }, () =>
    ({ domain: 'weather', actualOutcome: 'dismissed' as const, predictedSeverity: 'high' as const, recordedAt: NOW }));
  assert.equal(detectOverconfidence(meta, outcomes, NOW).length, 0);
});

test('detectOverconfidence: high metaConf + matching high accuracy → no signal', () => {
  const meta: BiasMetaConfidence[] = [{ domain: 'weather', metaConfidence: 0.9 }];
  const outcomes: BiasOutcomeRecord[] = [
    { domain: 'weather', actualOutcome: 'acted-on', predictedSeverity: 'high', recordedAt: NOW },
    { domain: 'weather', actualOutcome: 'acted-on', predictedSeverity: 'high', recordedAt: NOW },
    { domain: 'weather', actualOutcome: 'confirmed-real', predictedSeverity: 'high', recordedAt: NOW },
    { domain: 'weather', actualOutcome: 'confirmed-real', predictedSeverity: 'high', recordedAt: NOW },
    { domain: 'weather', actualOutcome: 'dismissed', predictedSeverity: 'high', recordedAt: NOW },
  ];
  assert.equal(detectOverconfidence(meta, outcomes, NOW).length, 0);
});

// ── aggregation helpers ──────────────────────────────────────────────────

function signal(type: BiasSignal['type'], sev: BiasSignal['severity']): BiasSignal {
  return {
    id: `${type}-${sev}`, type, domain: 'd', severity: sev,
    description: '', evidence: '', recommendation: '',
    affectedTargetIds: [], detectedAt: NOW, acknowledged: false,
  };
}

test('computeOverallRisk: any alert → high', () => {
  assert.equal(computeOverallRisk([signal('anchoring', 'alert'), signal('recency', 'advisory')]), 'high');
});

test('computeOverallRisk: any warning (no alert) → medium', () => {
  assert.equal(computeOverallRisk([signal('anchoring', 'warning'), signal('recency', 'advisory')]), 'medium');
});

test('computeOverallRisk: only advisory or empty → low', () => {
  assert.equal(computeOverallRisk([signal('anchoring', 'advisory')]), 'low');
  assert.equal(computeOverallRisk([]), 'low');
});

test('computeDominantBias: returns the most frequent type', () => {
  const all = [
    signal('anchoring', 'warning'),
    signal('anchoring', 'advisory'),
    signal('recency', 'advisory'),
  ];
  assert.equal(computeDominantBias(all), 'anchoring');
});

test('computeDominantBias: null when no signals', () => {
  assert.equal(computeDominantBias([]), null);
});

// ── Service: scan, acknowledge, getActive, getHistory, stats ─────────────

test('scan() returns a BiasReport with generatedAt + signals', () => {
  const svc = createBiasDetectorService({ storage: createMemoryStorage() });
  const report = svc.scan({
    situations: [], driverScores: [], hypothesisSets: [],
    outcomeRecords: [], metaEstimates: [], now: NOW,
  });
  assert.ok(report.generatedAt instanceof Date);
  assert.ok(Array.isArray(report.signals));
});

test('scan() persists signals to storage', () => {
  const storage = createMemoryStorage();
  const svc = createBiasDetectorService({ storage });
  const scores = [
    ds({ observationId: 'a', situationId: 's', finalScore: 0.9 }),
    ds({ observationId: 'b', situationId: 's', finalScore: 0.3 }),
    ds({ observationId: 'c', situationId: 's', finalScore: 0.3 }),
  ];
  svc.scan({ situations: [], driverScores: scores, hypothesisSets: [],
    outcomeRecords: [], metaEstimates: [], now: NOW });
  const raw = storage.getItem(STORAGE_KEY);
  assert.ok(raw);
  assert.ok(raw!.includes('anchoring'));
});

test('acknowledge() flips a signal and removes it from getActive()', () => {
  const svc = createBiasDetectorService({ storage: createMemoryStorage() });
  const scores = [
    ds({ observationId: 'a', situationId: 's', finalScore: 0.9 }),
    ds({ observationId: 'b', situationId: 's', finalScore: 0.3 }),
    ds({ observationId: 'c', situationId: 's', finalScore: 0.3 }),
  ];
  const report = svc.scan({ situations: [], driverScores: scores, hypothesisSets: [],
    outcomeRecords: [], metaEstimates: [], now: NOW });
  assert.equal(report.signals.length, 1);
  const id = report.signals[0]!.id;
  svc.acknowledge(id);
  assert.equal(svc.getActive().length, 0);
});

test('getHistory() returns all signals including acknowledged ones', () => {
  const svc = createBiasDetectorService({ storage: createMemoryStorage() });
  const scores = [
    ds({ observationId: 'a', situationId: 's', finalScore: 0.9 }),
    ds({ observationId: 'b', situationId: 's', finalScore: 0.3 }),
    ds({ observationId: 'c', situationId: 's', finalScore: 0.3 }),
  ];
  const report = svc.scan({ situations: [], driverScores: scores, hypothesisSets: [],
    outcomeRecords: [], metaEstimates: [], now: NOW });
  svc.acknowledge(report.signals[0]!.id);
  assert.equal(svc.getHistory().length, 1);
});

test('stats() returns counts by type and severity', () => {
  const svc = createBiasDetectorService({ storage: createMemoryStorage() });
  const scores = [
    ds({ observationId: 'a', situationId: 's', finalScore: 0.9 }),
    ds({ observationId: 'b', situationId: 's', finalScore: 0.3 }),
    ds({ observationId: 'c', situationId: 's', finalScore: 0.3 }),
  ];
  const report = svc.scan({ situations: [], driverScores: scores, hypothesisSets: [],
    outcomeRecords: [], metaEstimates: [], now: NOW });
  svc.acknowledge(report.signals[0]!.id);
  const s = svc.stats();
  assert.equal(s.byType.anchoring, 1);
  assert.equal(s.bySeverity.alert, 1);
  assert.equal(s.acknowledgedRate, 1);
});

test('subscribe() fires on scan() and acknowledge()', () => {
  const svc = createBiasDetectorService({ storage: createMemoryStorage() });
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  const scores = [
    ds({ observationId: 'a', situationId: 's', finalScore: 0.9 }),
    ds({ observationId: 'b', situationId: 's', finalScore: 0.3 }),
    ds({ observationId: 'c', situationId: 's', finalScore: 0.3 }),
  ];
  const report = svc.scan({ situations: [], driverScores: scores, hypothesisSets: [],
    outcomeRecords: [], metaEstimates: [], now: NOW });
  svc.acknowledge(report.signals[0]!.id);
  assert.equal(calls, 2);
});

test('subscribe returns unsubscribe function', () => {
  const svc = createBiasDetectorService({ storage: createMemoryStorage() });
  let calls = 0;
  const off = svc.subscribe(() => { calls += 1; });
  svc.scan({ situations: [], driverScores: [], hypothesisSets: [],
    outcomeRecords: [], metaEstimates: [], now: NOW });
  off();
  svc.scan({ situations: [], driverScores: [], hypothesisSets: [],
    outcomeRecords: [], metaEstimates: [], now: NOW });
  assert.equal(calls, 1);
});

test('persist + rehydrate round-trip preserves signals + acknowledged state', () => {
  const storage = createMemoryStorage();
  const svc1 = createBiasDetectorService({ storage });
  const scores = [
    ds({ observationId: 'a', situationId: 's', finalScore: 0.9 }),
    ds({ observationId: 'b', situationId: 's', finalScore: 0.3 }),
    ds({ observationId: 'c', situationId: 's', finalScore: 0.3 }),
  ];
  const report = svc1.scan({ situations: [], driverScores: scores, hypothesisSets: [],
    outcomeRecords: [], metaEstimates: [], now: NOW });
  svc1.acknowledge(report.signals[0]!.id);
  const svc2 = createBiasDetectorService({ storage });
  assert.equal(svc2.getHistory().length, 1);
  assert.equal(svc2.getActive().length, 0);
});

test('BiasReport.dominantBias reflects the most frequent type', () => {
  const svc = createBiasDetectorService({ storage: createMemoryStorage() });
  const scores = [
    ds({ observationId: 'a', situationId: 's', finalScore: 0.9 }),
    ds({ observationId: 'b', situationId: 's', finalScore: 0.3 }),
    ds({ observationId: 'c', situationId: 's', finalScore: 0.3 }),
  ];
  const report = svc.scan({ situations: [], driverScores: scores, hypothesisSets: [],
    outcomeRecords: [], metaEstimates: [], now: NOW });
  assert.equal(report.dominantBias, 'anchoring');
  assert.equal(report.overallBiasRisk, 'high');
});
