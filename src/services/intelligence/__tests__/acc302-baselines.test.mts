import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPersistenceBaselinePrediction,
  estimatePersistenceBaseline,
  PERSISTENCE_BASELINE_SOURCE_ID,
  PERSISTENCE_BASELINE_VERSION,
} from '../persistence-baseline';
import {
  buildMomentumBaselinePrediction,
  estimateMomentumBaseline,
  MOMENTUM_BASELINE_SOURCE_ID,
  type MomentumSample,
} from '../momentum-baseline';
import { BASELINE_SOURCE_IDS, isBaselineSourceId } from '../baseline-model-ids';
import { HIERARCHICAL_BASE_RATE_SOURCE_ID, estimateHierarchicalBaseRate } from '../hierarchical-base-rate';
import type { MarketMoveCriteria, PredictionRecord } from '../forecast-calibration';

const T0 = Date.UTC(2026, 6, 1, 12, 0, 0);
const HOUR = 3_600_000;

function record(overrides: Partial<PredictionRecord> = {}): PredictionRecord {
  return {
    id: `p-${Math.abs(overrides.predictedAt ?? T0)}-${overrides.targetKey ?? 'k'}`,
    sourceId: 'mode-forecast',
    targetKey: 'mode:finance',
    domain: 'markets',
    claim: 'pressure stays elevated',
    probability: 0.6,
    predictedAt: T0,
    resolveBy: T0 + 24 * HOUR,
    status: 'pending',
    ...overrides,
  } as PredictionRecord;
}

function resolvedPrior(
  offsetHours: number,
  outcome: boolean,
  overrides: Partial<PredictionRecord> = {},
): PredictionRecord {
  const predictedAt = T0 - offsetHours * HOUR;
  return record({
    id: `prior-${offsetHours}-${outcome}`,
    predictedAt,
    resolveBy: predictedAt + 12 * HOUR,
    status: outcome ? 'resolved_true' : 'resolved_false',
    resolvedAt: predictedAt + 6 * HOUR,
    resolutionNote: 'direct:test',
    ...overrides,
  });
}

// ── persistence: applicability gates ─────────────────────────────────────

test('persistence: state-like mode/shortage targets only — everything else is not_applicable', () => {
  const history = [resolvedPrior(48, true)];
  assert.ok(estimatePersistenceBaseline(record(), history));
  assert.ok(
    estimatePersistenceBaseline(
      record({ targetKey: 'shortage:wheat:East Africa' }),
      [resolvedPrior(48, true, { targetKey: 'shortage:wheat:East Africa' })],
    ),
  );
  assert.equal(estimatePersistenceBaseline(record({ targetKey: 'hypothesis:abc' }), history), null);
  assert.equal(estimatePersistenceBaseline(record({ targetKey: 'nws-warning:x' }), history), null);
  const withCriteria = record({
    criteria: {
      kind: 'market_move', symbol: 'AAPL', direction: 'up',
      minAbsPct: 3, basisPrice: 200, basisObservedAt: T0 - 60_000,
    } as MarketMoveCriteria,
  });
  assert.equal(estimatePersistenceBaseline(withCriteria, history), null, 'criteria-bearing targets excluded');
});

test('persistence: needs ≥1 usable prior resolution on the SAME targetKey', () => {
  assert.equal(estimatePersistenceBaseline(record(), []), null);
  const otherKey = [resolvedPrior(48, true, { targetKey: 'mode:cyber' })];
  assert.equal(estimatePersistenceBaseline(record(), otherKey), null);
});

test('persistence: Laplace math — one true prior → 2/3, streaks converge', () => {
  const one = estimatePersistenceBaseline(record(), [resolvedPrior(48, true)])!;
  assert.ok(Math.abs(one.probability - 2 / 3) < 1e-9);
  assert.equal(one.sampleCount, 1);
  const threeFalse = estimatePersistenceBaseline(
    record(),
    [resolvedPrior(72, false), resolvedPrior(48, false), resolvedPrior(24, false)],
  )!;
  assert.ok(Math.abs(threeFalse.probability - 1 / 5) < 1e-9);
});

test('persistence: recent window keeps only the 5 most recent priors', () => {
  const history = [1, 2, 3, 4, 5, 6, 7].map((i) => resolvedPrior(i * 12, i > 2));
  const est = estimatePersistenceBaseline(record(), history)!;
  assert.equal(est.sampleCount, 5);
  // The 5 most recent (offsets 12..60h) are outcomes for i=1..5 → i>2 true for i=3,4,5 → 3 trues.
  assert.ok(Math.abs(est.probability - (3 + 1) / (5 + 2)) < 1e-9);
});

test('persistence LEAKAGE: future, proxy, and baseline-sourced priors are excluded', () => {
  const future = resolvedPrior(48, true, { predictedAt: T0 + HOUR, resolvedAt: T0 + 2 * HOUR, resolveBy: T0 + 3 * HOUR, id: 'future' });
  const proxy = resolvedPrior(48, true, { resolutionNote: 'proxy:test', id: 'proxy' });
  const proxyProv = resolvedPrior(48, true, {
    resolutionProvenance: { kind: 'proxy', resolverId: 'x', evidence: [{ source: 's', observedAt: T0 - HOUR }] } as never,
    id: 'proxy2',
  });
  const fromBaseline = resolvedPrior(48, true, { sourceId: PERSISTENCE_BASELINE_SOURCE_ID, id: 'pb' });
  const fromHier = resolvedPrior(48, true, { sourceId: HIERARCHICAL_BASE_RATE_SOURCE_ID, id: 'hb' });
  const lateResolved = resolvedPrior(48, true, { resolvedAt: T0 + HOUR, id: 'late' });
  assert.equal(
    estimatePersistenceBaseline(record(), [future, proxy, proxyProv, fromBaseline, fromHier, lateResolved]),
    null,
  );
});

test('persistence: build clones the target with own id/source/version', () => {
  const target = record();
  const p = buildPersistenceBaselinePrediction(target, [resolvedPrior(48, true)])!;
  assert.match(p.id, /^persistence:/);
  assert.equal(p.sourceId, PERSISTENCE_BASELINE_SOURCE_ID);
  assert.equal(p.algorithmVersion, PERSISTENCE_BASELINE_VERSION);
  assert.equal(p.targetKey, target.targetKey);
  assert.equal(p.predictedAt, target.predictedAt);
  assert.equal(p.resolveBy, target.resolveBy);
  assert.equal(p.status, 'pending');
});

test('persistence: never baselines a baseline', () => {
  const t = record({ sourceId: MOMENTUM_BASELINE_SOURCE_ID });
  assert.equal(buildPersistenceBaselinePrediction(t, [resolvedPrior(48, true)]), null);
});

// ── momentum ─────────────────────────────────────────────────────────────

function marketTarget(overrides: Partial<PredictionRecord> = {}): PredictionRecord {
  return record({
    targetKey: 'hypothesis:mkt-1',
    criteria: {
      kind: 'market_move', symbol: 'AAPL', direction: 'up',
      minAbsPct: 3, basisPrice: 200, basisObservedAt: T0 - 60_000,
    } as MarketMoveCriteria,
    ...overrides,
  });
}

function trendSamples(slopePerHourPct: number, count = 8): MomentumSample[] {
  // Prices ending at basis 200 at T0-5min, trending at slopePerHourPct %/h.
  const out: MomentumSample[] = [];
  for (let i = 0; i < count; i++) {
    const t = T0 - 5 * 60_000 - (count - 1 - i) * 30 * 60_000;
    const hoursBeforeEnd = (T0 - 5 * 60_000 - t) / HOUR;
    out.push({ observedAt: t, price: 200 * (1 - (slopePerHourPct / 100) * hoursBeforeEnd) });
  }
  return out;
}

test('momentum: market_move targets only', () => {
  assert.equal(estimateMomentumBaseline(record(), trendSamples(1)), null);
  assert.ok(estimateMomentumBaseline(marketTarget(), trendSamples(1)));
});

test('momentum: flat prices → 0.5; up-trend raises P(up); same trend lowers P(down)', () => {
  const flat = estimateMomentumBaseline(marketTarget(), trendSamples(0))!;
  assert.ok(Math.abs(flat.probability - 0.5) < 1e-6);
  const up = estimateMomentumBaseline(marketTarget(), trendSamples(0.5))!;
  assert.ok(up.probability > 0.6, `rising trend must raise P(up), got ${up.probability}`);
  const downTarget = marketTarget({
    criteria: {
      kind: 'market_move', symbol: 'AAPL', direction: 'down',
      minAbsPct: 3, basisPrice: 200, basisObservedAt: T0 - 60_000,
    } as MarketMoveCriteria,
  });
  const down = estimateMomentumBaseline(downTarget, trendSamples(0.5))!;
  assert.ok(down.probability < 0.4, `rising trend must lower P(down), got ${down.probability}`);
});

test('momentum: probability bounded [0.05, 0.95] under extreme trends', () => {
  // 10%/h over a 24h horizon vs a 3% threshold → ratio ≈ 80: deep in the tail.
  const extreme = estimateMomentumBaseline(marketTarget(), trendSamples(10))!;
  assert.ok(extreme.probability <= 0.95 && extreme.probability >= 0.05);
});

test('momentum: monotone in the trend', () => {
  const p1 = estimateMomentumBaseline(marketTarget(), trendSamples(0.2))!.probability;
  const p2 = estimateMomentumBaseline(marketTarget(), trendSamples(0.6))!.probability;
  const p3 = estimateMomentumBaseline(marketTarget(), trendSamples(1.2))!.probability;
  assert.ok(p1 < p2 && p2 < p3);
});

test('momentum: fewer than 5 usable samples → not_applicable', () => {
  assert.equal(estimateMomentumBaseline(marketTarget(), trendSamples(1, 4)), null);
});

test('momentum LEAKAGE: post-forecast samples never change the estimate', () => {
  const clean = trendSamples(0.5);
  const withFuture = [
    ...clean,
    { observedAt: T0 + HOUR, price: 500 },
    { observedAt: T0, price: 500 }, // exactly at cutoff also excluded
  ];
  assert.deepEqual(
    estimateMomentumBaseline(marketTarget(), withFuture),
    estimateMomentumBaseline(marketTarget(), clean),
  );
});

test('momentum: degenerate criteria rejected (bad threshold/basis)', () => {
  const badPct = marketTarget({
    criteria: { kind: 'market_move', symbol: 'A', direction: 'up', minAbsPct: 0, basisPrice: 200, basisObservedAt: T0 } as MarketMoveCriteria,
  });
  const badBasis = marketTarget({
    criteria: { kind: 'market_move', symbol: 'A', direction: 'up', minAbsPct: 3, basisPrice: 0, basisObservedAt: T0 } as MarketMoveCriteria,
  });
  assert.equal(estimateMomentumBaseline(badPct, trendSamples(1)), null);
  assert.equal(estimateMomentumBaseline(badBasis, trendSamples(1)), null);
});

test('momentum: build clones target with own namespace and inherits criteria', () => {
  const target = marketTarget();
  const p = buildMomentumBaselinePrediction(target, trendSamples(0.5))!;
  assert.match(p.id, /^momentum:/);
  assert.equal(p.sourceId, MOMENTUM_BASELINE_SOURCE_ID);
  assert.deepEqual(p.criteria, target.criteria, 'criteria inheritance drives paired resolution');
});

// ── family invariants ────────────────────────────────────────────────────

test('baseline family: ids registered, distinct namespaces, no cross-training', () => {
  assert.equal(BASELINE_SOURCE_IDS.size, 3);
  assert.ok(isBaselineSourceId(PERSISTENCE_BASELINE_SOURCE_ID));
  assert.ok(isBaselineSourceId(MOMENTUM_BASELINE_SOURCE_ID));
  assert.ok(isBaselineSourceId(HIERARCHICAL_BASE_RATE_SOURCE_ID));
  // Hierarchical refuses to train on the new baselines' records.
  const priors: PredictionRecord[] = [];
  for (let i = 0; i < 40; i++) {
    priors.push(resolvedPrior(24 + i * 12, i % 2 === 0, {
      id: `bp-${i}`, sourceId: PERSISTENCE_BASELINE_SOURCE_ID, targetKey: `mode:k${i}`,
    }));
  }
  assert.equal(estimateHierarchicalBaseRate(record(), priors), null, 'baseline-only history yields no estimate');
});

test('baseline family: id hashes differ across models for the same target', () => {
  const stateTarget = record();
  const p = buildPersistenceBaselinePrediction(stateTarget, [resolvedPrior(48, true)])!;
  assert.notEqual(p.id.split(':')[1], undefined);
  const m = buildMomentumBaselinePrediction(marketTarget(), trendSamples(0.5))!;
  assert.ok(p.id.startsWith('persistence:') && m.id.startsWith('momentum:'));
});
