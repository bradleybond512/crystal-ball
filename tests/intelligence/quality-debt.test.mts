import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  QualityDebtTracker,
  resetForTests,
  type ScanParams,
} from '../../src/services/intelligence/quality-debt.ts';
import type { AlgorithmStats } from '../../src/services/intelligence/algo-eval-ledger.ts';
import type { AssumptionStats } from '../../src/services/intelligence/assumption-tracker.ts';

const NOW = 1_745_000_000_000;

function emptyAssumptionStats(overrides: Partial<AssumptionStats> = {}): AssumptionStats {
  return {
    totalAssumptions: 0,
    totalOutputs: 0,
    byCategory: {
      'data-quality': 0,
      completeness: 0,
      causality: 0,
      baseline: 0,
      model: 0,
      geospatial: 0,
    },
    criticalCount: 0,
    highRiskCount: 0,
    avgConfidence: 1,
    ...overrides,
  };
}

function makeAlgoStats(overrides: Partial<AlgorithmStats> = {}): AlgorithmStats {
  return {
    algorithmId: 'driver-scorer',
    domain: '*',
    totalPredictions: 30,
    resolvedCount: 30,
    accuracy: 0.8,
    trend: 'stable',
    lastEvaluated: new Date(NOW),
    ...overrides,
  };
}

function healthyParams(overrides: Partial<ScanParams> = {}): ScanParams {
  return {
    feedHealthMap: {},
    recentObsCounts: {
      earthquake: 20, weather: 20, wildfire: 20, maritime: 20, aviation: 20,
      biosurveillance: 20, 'space-weather': 20, cyber: 20, sanctions: 20, intelligence: 20,
    },
    algoStats: [makeAlgoStats({ trend: 'stable' })],
    assumptionStats: emptyAssumptionStats(),
    outcomeCountByDomain: {},
    lastBacktestByDomain: {
      earthquake: new Date(NOW - 5 * 24 * 60 * 60_000),
      weather:    new Date(NOW - 5 * 24 * 60 * 60_000),
      wildfire:   new Date(NOW - 5 * 24 * 60 * 60_000),
      maritime:   new Date(NOW - 5 * 24 * 60 * 60_000),
      aviation:   new Date(NOW - 5 * 24 * 60 * 60_000),
      biosurveillance: new Date(NOW - 5 * 24 * 60 * 60_000),
      'space-weather': new Date(NOW - 5 * 24 * 60 * 60_000),
      cyber:      new Date(NOW - 5 * 24 * 60 * 60_000),
      sanctions:  new Date(NOW - 5 * 24 * 60 * 60_000),
      intelligence: new Date(NOW - 5 * 24 * 60 * 60_000),
    },
    ...overrides,
  };
}

// ── Empty / healthy case ────────────────────────────────────────────

describe('QualityDebtTracker.scan — healthy baseline', () => {
  beforeEach(() => { resetForTests(); });

  it('all-healthy inputs produce 0 items', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const summary = t.scan(healthyParams());
    assert.equal(summary.items.length, 0);
    assert.equal(summary.totalDebtScore, 0);
    assert.equal(summary.topPriorityItem, null);
  });

  it('summary includes generatedAt and counts even when empty', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams());
    assert.ok(s.generatedAt instanceof Date);
    assert.equal(s.fastCompoundingCount, 0);
    for (const v of Object.values(s.byCategory)) assert.equal(v, 0);
  });
});

// ── data-staleness detector ─────────────────────────────────────────

describe('QualityDebtTracker — data-staleness', () => {
  beforeEach(() => { resetForTests(); });

  it('degraded feed → moderate data-staleness item', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({ feedHealthMap: { wildfire: 'degraded' } }));
    const item = s.items.find((i) => i.category === 'data-staleness');
    assert.ok(item);
    assert.equal(item.severity, 'moderate');
    assert.equal(item.domain, 'wildfire');
  });

  it('critical feed down (earthquake) → significant data-staleness', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({ feedHealthMap: { earthquake: 'down' } }));
    const item = s.items.find((i) => i.category === 'data-staleness' && i.domain === 'earthquake');
    assert.ok(item);
    assert.equal(item.severity, 'significant');
  });

  it('non-critical feed down → moderate (not significant)', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({ feedHealthMap: { sanctions: 'down' } }));
    const item = s.items.find((i) => i.category === 'data-staleness' && i.domain === 'sanctions');
    assert.ok(item);
    assert.equal(item.severity, 'moderate');
  });

  it('healthy feed → no data-staleness item', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({ feedHealthMap: { earthquake: 'healthy' } }));
    assert.equal(s.items.filter((i) => i.category === 'data-staleness').length, 0);
  });
});

// ── coverage-gap detector ───────────────────────────────────────────

describe('QualityDebtTracker — coverage-gap', () => {
  beforeEach(() => { resetForTests(); });

  it('domain with 2 obs (< 3) → minor coverage-gap', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({
      recentObsCounts: { ...healthyParams().recentObsCounts, weather: 2 },
    }));
    const item = s.items.find((i) => i.category === 'coverage-gap' && i.domain === 'weather');
    assert.ok(item);
    assert.equal(item.severity, 'minor');
  });

  it('domain with 0 obs (< 1) → moderate coverage-gap', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({
      recentObsCounts: { ...healthyParams().recentObsCounts, cyber: 0 },
    }));
    const item = s.items.find((i) => i.category === 'coverage-gap' && i.domain === 'cyber');
    assert.ok(item);
    assert.equal(item.severity, 'moderate');
  });

  it('domain with 3+ obs → no coverage-gap', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({
      recentObsCounts: { ...healthyParams().recentObsCounts, weather: 3 },
    }));
    assert.equal(s.items.filter((i) => i.category === 'coverage-gap' && i.domain === 'weather').length, 0);
  });
});

// ── model-drift detector ────────────────────────────────────────────

describe('QualityDebtTracker — model-drift', () => {
  beforeEach(() => { resetForTests(); });

  it('one degrading algo → moderate model-drift', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({
      algoStats: [makeAlgoStats({ domain: 'weather', trend: 'degrading' })],
    }));
    const item = s.items.find((i) => i.category === 'model-drift');
    assert.ok(item);
    assert.equal(item.severity, 'moderate');
  });

  it('2+ degrading algos → significant model-drift', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({
      algoStats: [
        makeAlgoStats({ domain: 'weather', trend: 'degrading' }),
        makeAlgoStats({ domain: 'cyber', trend: 'degrading' }),
      ],
    }));
    const item = s.items.find((i) => i.category === 'model-drift');
    assert.ok(item);
    assert.equal(item.severity, 'significant');
  });

  it('improving algos → no model-drift', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({
      algoStats: [makeAlgoStats({ trend: 'improving' })],
    }));
    assert.equal(s.items.filter((i) => i.category === 'model-drift').length, 0);
  });
});

// ── assumption-debt detector ────────────────────────────────────────

describe('QualityDebtTracker — assumption-debt', () => {
  beforeEach(() => { resetForTests(); });

  it('criticalCount 16 → moderate assumption-debt', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({ assumptionStats: emptyAssumptionStats({ criticalCount: 16 }) }));
    const item = s.items.find((i) => i.category === 'assumption-debt');
    assert.ok(item);
    assert.equal(item.severity, 'moderate');
  });

  it('criticalCount 26 → significant assumption-debt', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({ assumptionStats: emptyAssumptionStats({ criticalCount: 26 }) }));
    const item = s.items.find((i) => i.category === 'assumption-debt');
    assert.ok(item);
    assert.equal(item.severity, 'significant');
  });

  it('criticalCount 41 → critical assumption-debt', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({ assumptionStats: emptyAssumptionStats({ criticalCount: 41 }) }));
    const item = s.items.find((i) => i.category === 'assumption-debt');
    assert.ok(item);
    assert.equal(item.severity, 'critical');
  });

  it('criticalCount 15 or fewer → no assumption-debt', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({ assumptionStats: emptyAssumptionStats({ criticalCount: 15 }) }));
    assert.equal(s.items.filter((i) => i.category === 'assumption-debt').length, 0);
  });
});

// ── calibration-lag detector ────────────────────────────────────────

describe('QualityDebtTracker — calibration-lag', () => {
  beforeEach(() => { resetForTests(); });

  it('domain >30 outcomes with no recent outcome in 14d → minor calibration-lag', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const params = healthyParams({
      outcomeCountByDomain: { weather: 50 },
      lastOutcomeByDomain: { weather: new Date(NOW - 20 * 24 * 60 * 60_000) },
    });
    const s = t.scan(params);
    const item = s.items.find((i) => i.category === 'calibration-lag');
    assert.ok(item);
    assert.equal(item.severity, 'minor');
  });

  it('domain <=30 outcomes → no calibration-lag', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const params = healthyParams({
      outcomeCountByDomain: { weather: 20 },
      lastOutcomeByDomain: { weather: new Date(NOW - 60 * 24 * 60 * 60_000) },
    });
    const s = t.scan(params);
    assert.equal(s.items.filter((i) => i.category === 'calibration-lag').length, 0);
  });

  it('domain with fresh outcome (<14d) → no calibration-lag', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const params = healthyParams({
      outcomeCountByDomain: { weather: 50 },
      lastOutcomeByDomain: { weather: new Date(NOW - 5 * 24 * 60 * 60_000) },
    });
    const s = t.scan(params);
    assert.equal(s.items.filter((i) => i.category === 'calibration-lag').length, 0);
  });
});

// ── test-coverage detector ──────────────────────────────────────────

describe('QualityDebtTracker — test-coverage', () => {
  beforeEach(() => { resetForTests(); });

  it('domain with backtest >30d old → minor test-coverage item', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const params = healthyParams({
      lastBacktestByDomain: {
        ...healthyParams().lastBacktestByDomain,
        weather: new Date(NOW - 40 * 24 * 60 * 60_000),
      },
    });
    const s = t.scan(params);
    const item = s.items.find((i) => i.category === 'test-coverage' && i.domain === 'weather');
    assert.ok(item);
    assert.equal(item.severity, 'minor');
  });

  it('domain with no backtest at all → minor test-coverage item', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const params = healthyParams({
      lastBacktestByDomain: {
        ...healthyParams().lastBacktestByDomain,
        weather: null,
      },
    });
    const s = t.scan(params);
    const item = s.items.find((i) => i.category === 'test-coverage' && i.domain === 'weather');
    assert.ok(item);
    assert.equal(item.severity, 'minor');
  });

  it('recent backtest (<30d) → no test-coverage item', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams());
    assert.equal(s.items.filter((i) => i.category === 'test-coverage').length, 0);
  });
});

// ── Scoring + topPriorityItem ───────────────────────────────────────

describe('QualityDebtTracker — scoring', () => {
  beforeEach(() => { resetForTests(); });

  it('totalDebtScore = critical*10 + significant*5 + moderate*2 + minor*1', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({
      feedHealthMap: { weather: 'degraded' },             // 1 moderate (2)
      assumptionStats: emptyAssumptionStats({ criticalCount: 41 }), // 1 critical (10)
      lastBacktestByDomain: {
        ...healthyParams().lastBacktestByDomain,
        weather: null,                                     // 1 minor (1)
      },
    }));
    // moderate + critical + minor = 2 + 10 + 1 = 13
    assert.equal(s.totalDebtScore, 13);
  });

  it('topPriorityItem picks highest severity', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({
      feedHealthMap: { weather: 'degraded' },
      assumptionStats: emptyAssumptionStats({ criticalCount: 50 }),
    }));
    assert.ok(s.topPriorityItem);
    assert.equal(s.topPriorityItem.severity, 'critical');
  });

  it('topPriorityItem ties broken by fast compounding rate', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({
      // Two moderate items — model-drift (fast compounding) should win
      // the tie over a generic moderate.
      feedHealthMap: { sanctions: 'down' },           // moderate, slow
      algoStats: [makeAlgoStats({ domain: 'weather', trend: 'degrading' })], // moderate, fast
    }));
    assert.equal(s.topPriorityItem?.category, 'model-drift');
  });

  it('byCategory / bySeverity counts are accurate', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({
      feedHealthMap: { earthquake: 'down' },                   // 1 significant data-staleness
      assumptionStats: emptyAssumptionStats({ criticalCount: 41 }), // 1 critical
    }));
    assert.equal(s.bySeverity.significant, 1);
    assert.equal(s.bySeverity.critical, 1);
    assert.equal(s.byCategory['data-staleness'], 1);
    assert.equal(s.byCategory['assumption-debt'], 1);
  });

  it('fastCompoundingCount counts items with compoundingRate=fast', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({
      algoStats: [
        makeAlgoStats({ domain: 'weather', trend: 'degrading' }),
        makeAlgoStats({ domain: 'cyber', trend: 'degrading' }),
      ],
    }));
    assert.ok(s.fastCompoundingCount > 0);
  });
});

// ── acknowledge / resolve / accessors ───────────────────────────────

describe('QualityDebtTracker — lifecycle', () => {
  beforeEach(() => { resetForTests(); });

  it('acknowledge keeps item in getOpen() but flips status', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    t.scan(healthyParams({ feedHealthMap: { weather: 'degraded' } }));
    const item = t.getOpen().find((i) => i.category === 'data-staleness');
    assert.ok(item);
    t.acknowledge(item.id);
    const still = t.getOpen().find((i) => i.id === item.id);
    assert.ok(still);
    assert.equal(still.status, 'acknowledged');
  });

  it('resolve removes item from getOpen()', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    t.scan(healthyParams({ feedHealthMap: { weather: 'degraded' } }));
    const item = t.getOpen().find((i) => i.category === 'data-staleness');
    assert.ok(item);
    t.resolve(item.id);
    assert.equal(t.getOpen().find((i) => i.id === item.id), undefined);
  });

  it('getFastCompounding filters items with compoundingRate=fast', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    t.scan(healthyParams({
      algoStats: [makeAlgoStats({ domain: 'weather', trend: 'degrading' })],
    }));
    const fast = t.getFastCompounding();
    assert.ok(fast.length > 0);
    for (const i of fast) assert.equal(i.compoundingRate, 'fast');
  });

  it('rescan replaces the items but preserves acknowledged status', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    t.scan(healthyParams({ feedHealthMap: { weather: 'degraded' } }));
    const item = t.getOpen().find((i) => i.category === 'data-staleness');
    assert.ok(item);
    t.acknowledge(item.id);
    t.scan(healthyParams({ feedHealthMap: { weather: 'degraded' } }));
    const after = t.getOpen().find((i) => i.category === 'data-staleness' && i.domain === 'weather');
    assert.ok(after);
    assert.equal(after.status, 'acknowledged');
  });
});

// ── trend / history / subscribe ─────────────────────────────────────

describe('QualityDebtTracker — trend + history', () => {
  beforeEach(() => { resetForTests(); });

  it('first scan trend is "stable"', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    const s = t.scan(healthyParams({ feedHealthMap: { weather: 'degraded' } }));
    assert.equal(s.trend, 'stable');
  });

  it('higher-score follow-up scan → trend=accumulating', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    t.scan(healthyParams({ feedHealthMap: { weather: 'degraded' } }));
    const s2 = t.scan(healthyParams({
      feedHealthMap: { weather: 'degraded' },
      assumptionStats: emptyAssumptionStats({ criticalCount: 41 }),
    }));
    assert.equal(s2.trend, 'accumulating');
  });

  it('lower-score follow-up scan → trend=reducing', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    t.scan(healthyParams({
      feedHealthMap: { weather: 'degraded' },
      assumptionStats: emptyAssumptionStats({ criticalCount: 41 }),
    }));
    const s2 = t.scan(healthyParams({ feedHealthMap: { weather: 'degraded' } }));
    assert.equal(s2.trend, 'reducing');
  });

  it('getHistory returns prior summaries capped at 50', () => {
    const t = new QualityDebtTracker({ now: () => NOW, historyCapacity: 3 });
    for (let i = 0; i < 5; i++) {
      t.scan(healthyParams({ feedHealthMap: { weather: 'degraded' } }));
    }
    assert.equal(t.getHistory().length, 3);
  });
});

describe('QualityDebtTracker — subscribe', () => {
  beforeEach(() => { resetForTests(); });

  it('subscribe fires on scan()', () => {
    const t = new QualityDebtTracker({ now: () => NOW });
    let calls = 0;
    const off = t.subscribe(() => { calls++; });
    t.scan(healthyParams());
    assert.equal(calls, 1);
    off();
    t.scan(healthyParams());
    assert.equal(calls, 1);
  });
});

// ── persistence ─────────────────────────────────────────────────────

describe('QualityDebtTracker — persistence', () => {
  beforeEach(() => { resetForTests(); });

  it('persists to and restores from a storage seam', () => {
    const fakeStorage: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => fakeStorage[k] ?? null,
      setItem: (k: string, v: string) => { fakeStorage[k] = v; },
    };
    const a = new QualityDebtTracker({ storage, now: () => NOW });
    a.scan(healthyParams({ feedHealthMap: { weather: 'degraded' } }));
    const b = new QualityDebtTracker({ storage, now: () => NOW });
    assert.ok(b.getOpen().length > 0);
  });

  it('corrupted storage falls back to empty', () => {
    const storage = { getItem: () => '{not-json', setItem: () => {} };
    const t = new QualityDebtTracker({ storage, now: () => NOW });
    assert.equal(t.getOpen().length, 0);
  });
});
