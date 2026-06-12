import assert from 'node:assert/strict';
import test from 'node:test';

import { createBiasScanCadence, __internals } from '../bias-scan-cadence.ts';
import type { BiasReport, BiasScanInput, BiasSignal } from '../bias-detector.ts';
import type { Situation } from '../situation-store-v2.ts';
import type { ObservationEvent } from '@/types/intelligence';

// ── Fakes ─────────────────────────────────────────────────────────────────

function situation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 'sit-1',
    domain: 'weather',
    confidence: 0.6,
    observations: [],
    updatedAt: new Date('2026-06-12T00:00:00Z'),
    ...overrides,
  } as unknown as Situation;
}

function observation(id: string, domain = 'weather'): ObservationEvent {
  return {
    id,
    sourceId: 'src',
    domain,
    timestamp: Date.parse('2026-06-12T00:00:00Z'),
    severity: 'HIGH',
    title: id,
    raw: {},
    entityIds: [],
    tags: [],
  } as unknown as ObservationEvent;
}

function signal(overrides: Partial<BiasSignal> = {}): BiasSignal {
  return {
    id: 'sig-1',
    type: 'anchoring',
    domain: 'weather',
    severity: 'warning',
    description: 'anchored',
    evidence: 'first score high',
    recommendation: 're-run',
    affectedTargetIds: ['sit-1'],
    detectedAt: new Date('2026-06-12T00:00:00Z'),
    acknowledged: false,
    ...overrides,
  };
}

function report(signals: BiasSignal[] = []): BiasReport {
  return {
    generatedAt: new Date('2026-06-12T00:00:00Z'),
    signals,
    dominantBias: signals[0]?.type ?? null,
    overallBiasRisk: signals.length ? 'medium' : 'low',
    recommendation: 'monitor',
  };
}

interface RecordedCall {
  id: string;
  input: { score?: number; label?: string; detail?: Record<string, unknown> };
}

function makeDeps(opts: {
  situations: Situation[];
  scanResult: BiasReport;
}) {
  const calls: RecordedCall[] = [];
  let tick = 0;
  const deps = {
    store: {
      getActive: () => opts.situations,
      list: () => opts.situations,
    },
    recentObservations: (_n?: number) => [observation('o1')],
    scoringEngine: {
      scoreObservation: (_o: ObservationEvent) => ({ finalScore: 0.5, derivedSeverity: 'medium' as const }),
    },
    hypothesisEngine: { getAllSets: (_limit?: number) => [] },
    metaService: { getAllEstimates: () => [] },
    ledger: { all: () => [] },
    detector: { scan: (_input: BiasScanInput) => opts.scanResult },
    clock: () => (tick += 1),
    recorder: ((id: string, input: RecordedCall['input']) => {
      calls.push({ id, input });
      return {} as never;
    }),
  };
  return { deps, calls };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('first scan records an evaluation under bias-detector', () => {
  const { deps, calls } = makeDeps({
    situations: [situation()],
    scanResult: report([signal()]),
  });
  const cadence = createBiasScanCadence(deps as never);
  cadence.runOnce();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'bias-detector');
  assert.equal(calls[0].input.detail?.signalCount, 1);
});

test('identical second scan does NOT record a duplicate (delta gate)', () => {
  const { deps, calls } = makeDeps({
    situations: [situation()],
    scanResult: report([signal()]),
  });
  const cadence = createBiasScanCadence(deps as never);
  cadence.runOnce();
  cadence.runOnce();
  assert.equal(calls.length, 1, 'second identical scan should be suppressed');
});

test('a changed scan result records again after the delta gate', () => {
  const situations = [situation()];
  let current = report([signal()]);
  const calls: RecordedCall[] = [];
  let tick = 0;
  const deps = {
    store: { getActive: () => situations, list: () => situations },
    recentObservations: (_n?: number) => [observation('o1')],
    scoringEngine: { scoreObservation: () => ({ finalScore: 0.5, derivedSeverity: 'medium' as const }) },
    hypothesisEngine: { getAllSets: () => [] },
    metaService: { getAllEstimates: () => [] },
    ledger: { all: () => [] },
    detector: { scan: () => current },
    clock: () => (tick += 1),
    recorder: ((id: string, input: RecordedCall['input']) => {
      calls.push({ id, input });
      return {} as never;
    }),
  };
  const cadence = createBiasScanCadence(deps as never);
  cadence.runOnce();
  current = report([signal(), signal({ id: 'sig-2', type: 'recency', evidence: 'recent spike' })]);
  cadence.runOnce();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].input.detail?.signalCount, 2);
});

test('scan with no active situations is a no-op', () => {
  const { deps, calls } = makeDeps({
    situations: [],
    scanResult: report([signal()]),
  });
  let scanned = false;
  (deps.detector as { scan: () => BiasReport }).scan = () => {
    scanned = true;
    return report([signal()]);
  };
  const cadence = createBiasScanCadence(deps as never);
  cadence.runOnce();
  assert.equal(calls.length, 0, 'no situations → no evaluation recorded');
  assert.equal(scanned, false, 'no situations → detector not invoked');
});

test('first run reports delta 0 and full observation count', () => {
  let captured: BiasScanInput | null = null;
  const situations = [situation({ confidence: 0.7, observations: [observation('a'), observation('b')] as never })];
  const { deps } = makeDeps({ situations, scanResult: report() });
  (deps.detector as { scan: (i: BiasScanInput) => BiasReport }).scan = (i) => {
    captured = i;
    return report();
  };
  const cadence = createBiasScanCadence(deps as never);
  cadence.runOnce();
  assert.ok(captured);
  const input = captured as BiasScanInput;
  assert.equal(input.situations[0].latestConfidenceDelta, 0);
  assert.equal(input.situations[0].addedObservationsInLastUpdate, 2);
});

test('__internals exposes cadence constants', () => {
  assert.equal(__internals.CADENCE_MS, 15 * 60 * 1000);
  assert.equal(__internals.FIRST_RUN_DELAY_MS, 60 * 1000);
  assert.equal(__internals.OBSERVATION_WINDOW, 100);
});
