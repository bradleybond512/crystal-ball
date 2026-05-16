import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  DomainScorecardService,
  resetForTests,
  type DomainScorecardSources,
} from '../../src/services/intelligence/domain-scorecard.ts';

const NOW = 1_745_000_000_000;

interface SourceFixture {
  falsePositiveRate: number;
  totalOutcomes: number;
  accuracy?: number;
  multiplier: number;
  budget: { used: number; quota: number; exhausted: boolean };
}

function makeSources(perDomain: Record<string, SourceFixture>): DomainScorecardSources {
  return {
    getCalibration: (domain) => {
      const f = perDomain[domain];
      if (!f) return null;
      return {
        domain,
        totalOutcomes: f.totalOutcomes,
        falsePositiveRate: f.falsePositiveRate,
        escalationRate: 0,
        confirmedRate: 0,
        severityAccuracy: 0,
        suggestedWeightDelta: 0,
      };
    },
    getAlgorithmStats: (_algoId, domain) => {
      if (!domain) return null;
      const f = perDomain[domain];
      if (!f) return null;
      return {
        algorithmId: 'driver-scorer',
        domain,
        totalPredictions: f.totalOutcomes,
        resolvedCount: f.totalOutcomes,
        accuracy: f.accuracy,
        trend: 'stable',
        lastEvaluated: new Date(NOW),
      };
    },
    getAttentionMultiplier: (domain) => perDomain[domain]?.multiplier ?? 1,
    getBudget: (domain) => {
      const f = perDomain[domain];
      if (!f) return null;
      return {
        domain,
        baseQuota: f.budget.quota,
        currentQuota: f.budget.quota,
        used: f.budget.used,
        windowStartMs: NOW,
        exhausted: f.budget.exhausted,
        lastAdjustedAt: new Date(NOW),
        adjustmentReason: '',
      };
    },
  };
}

// Helpers tuned so each component lands at the requested value.
function perfectFixture(): SourceFixture {
  return {
    falsePositiveRate: 0,    // outcomeQuality = 1
    totalOutcomes: 30,
    accuracy: 1,             // predictionAccuracy = 1
    multiplier: 1,           // attentionEfficiency = 0.6 (neutral)
    budget: { used: 0, quota: 10, exhausted: false }, // budgetHealth = 1
  };
}
function brokenFixture(): SourceFixture {
  return {
    falsePositiveRate: 1,    // outcomeQuality = 0
    totalOutcomes: 30,
    accuracy: 0,             // predictionAccuracy = 0
    multiplier: 1,
    budget: { used: 10, quota: 10, exhausted: true }, // budgetHealth = 0.3
  };
}

// ── Grade thresholds ─────────────────────────────────────────────────

describe('DomainScorecardService.generateScorecard — grades', () => {
  beforeEach(() => { resetForTests(); });

  it('all components 1.0 + healthy feed → grade A', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({ weather: perfectFixture() }),
      now: () => NOW,
    });
    const card = svc.generateScorecard('weather', 'healthy');
    // attentionEfficiency is neutral (0.6); overall = 1*0.3 + 1*0.3 + 1*0.2 + 0.6*0.1 + 1*0.1 = 0.96 → A
    assert.equal(card.grade, 'A');
    assert.ok(card.overallScore >= 0.85);
  });

  it('all components 0 + down feed → grade F', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({ weather: brokenFixture() }),
      now: () => NOW,
    });
    const card = svc.generateScorecard('weather', 'down');
    assert.equal(card.grade, 'F');
  });

  it('overallScore exactly 0.85 → A (>=0.85)', () => {
    const f = stubSourcesAt(0.85);
    const svc = new DomainScorecardService({ sources: f.sources, now: () => NOW });
    assert.equal(svc.generateScorecard('weather', f.feedHealth).grade, 'A');
  });

  it('overallScore 0.70 → B', () => {
    const f = stubSourcesAt(0.70);
    const svc = new DomainScorecardService({ sources: f.sources, now: () => NOW });
    assert.equal(svc.generateScorecard('weather', f.feedHealth).grade, 'B');
  });

  it('overallScore 0.55 → C', () => {
    const f = stubSourcesAt(0.55);
    const svc = new DomainScorecardService({ sources: f.sources, now: () => NOW });
    assert.equal(svc.generateScorecard('weather', f.feedHealth).grade, 'C');
  });

  it('overallScore 0.40 → D', () => {
    const f = stubSourcesAt(0.40);
    const svc = new DomainScorecardService({ sources: f.sources, now: () => NOW });
    assert.equal(svc.generateScorecard('weather', f.feedHealth).grade, 'D');
  });

  it('overallScore 0.39 → F', () => {
    const f = stubSourcesAt(0.39);
    const svc = new DomainScorecardService({ sources: f.sources, now: () => NOW });
    assert.equal(svc.generateScorecard('weather', f.feedHealth).grade, 'F');
  });
});

interface TargetedFixture { sources: DomainScorecardSources; feedHealth: 'healthy' | 'down' }

function stubSourcesAt(target: number): TargetedFixture {
  // Pin attentionEfficiency=0.6 (multiplier=1) and build the rest so the
  // overall score lands exactly at `target`. Two regimes:
  //   - target >= 0.36: feedHealth=healthy (=1), budgetHealth=1 (used 30%).
  //     0.6*x + 0.36 = target → x = (target - 0.36)/0.6
  //   - target < 0.36:  feedHealth=down (=0),  budgetHealth=0.6 (used 80%).
  //     0.6*x + 0.12 = target → x = (target - 0.12)/0.6
  let x: number;
  let feedHealth: 'healthy' | 'down';
  let usedRatio: number;
  if (target >= 0.36) {
    x = (target - 0.36) / 0.6;
    feedHealth = 'healthy';
    usedRatio = 0.3;
  } else {
    x = (target - 0.12) / 0.6;
    feedHealth = 'down';
    usedRatio = 0.8;
  }
  const quota = 10;
  const used = Math.round(usedRatio * quota);
  return {
    feedHealth,
    sources: {
    getCalibration: (domain) => ({
      domain,
      totalOutcomes: 30,
      falsePositiveRate: 1 - x,
      escalationRate: 0,
      confirmedRate: 0,
      severityAccuracy: 0,
      suggestedWeightDelta: 0,
    }),
    getAlgorithmStats: (_a, d) => ({
      algorithmId: 'driver-scorer',
      domain: d ?? '*',
      totalPredictions: 30,
      resolvedCount: 30,
      accuracy: x,
      trend: 'stable',
      lastEvaluated: new Date(NOW),
    }),
    getAttentionMultiplier: () => 1,
    getBudget: (domain) => ({
      domain,
      baseQuota: quota,
      currentQuota: quota,
      used,
      windowStartMs: NOW,
      exhausted: false,
      lastAdjustedAt: new Date(NOW),
      adjustmentReason: '',
    }),
    },
  };
}

// ── Component math ────────────────────────────────────────────────────

describe('DomainScorecardService — component math', () => {
  beforeEach(() => { resetForTests(); });

  it('outcomeQuality = 1 - falsePositiveRate', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({ weather: { ...perfectFixture(), falsePositiveRate: 0.3 } }),
      now: () => NOW,
    });
    const card = svc.generateScorecard('weather', 'healthy');
    assert.ok(Math.abs(card.components.outcomeQuality - 0.7) < 1e-6);
  });

  it('feedHealth: healthy=1, degraded=0.5, down=0', () => {
    const sources = makeSources({ weather: perfectFixture() });
    const svc = new DomainScorecardService({ sources, now: () => NOW });
    assert.equal(svc.generateScorecard('weather', 'healthy').components.feedHealth, 1);
    assert.equal(svc.generateScorecard('weather', 'degraded').components.feedHealth, 0.5);
    assert.equal(svc.generateScorecard('weather', 'down').components.feedHealth, 0);
  });

  it('attentionEfficiency: multiplier>1 + quality>0.7 → 1.0', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({ weather: { ...perfectFixture(), multiplier: 1.5 } }),
      now: () => NOW,
    });
    const card = svc.generateScorecard('weather', 'healthy');
    assert.equal(card.components.attentionEfficiency, 1);
  });

  it('attentionEfficiency: multiplier>1 + quality<0.4 → 0.3', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({
        weather: { ...perfectFixture(), multiplier: 1.5, falsePositiveRate: 0.8 },
      }),
      now: () => NOW,
    });
    const card = svc.generateScorecard('weather', 'healthy');
    assert.equal(card.components.attentionEfficiency, 0.3);
  });

  it('attentionEfficiency: multiplier=1 → 0.6 (neutral)', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({ weather: perfectFixture() }),
      now: () => NOW,
    });
    assert.equal(svc.generateScorecard('weather', 'healthy').components.attentionEfficiency, 0.6);
  });

  it('budgetHealth: exhausted → 0.3', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({
        weather: { ...perfectFixture(), budget: { used: 10, quota: 10, exhausted: true } },
      }),
      now: () => NOW,
    });
    assert.equal(svc.generateScorecard('weather', 'healthy').components.budgetHealth, 0.3);
  });

  it('budgetHealth: used/quota < 0.7 → 1.0', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({
        weather: { ...perfectFixture(), budget: { used: 3, quota: 10, exhausted: false } },
      }),
      now: () => NOW,
    });
    assert.equal(svc.generateScorecard('weather', 'healthy').components.budgetHealth, 1);
  });

  it('budgetHealth: used/quota >= 0.7 (not exhausted) → 0.6', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({
        weather: { ...perfectFixture(), budget: { used: 8, quota: 10, exhausted: false } },
      }),
      now: () => NOW,
    });
    assert.equal(svc.generateScorecard('weather', 'healthy').components.budgetHealth, 0.6);
  });

  it('budgetHealth with no budget data → 1.0 (assume fine)', () => {
    const svc = new DomainScorecardService({
      sources: { ...makeSources({}), getBudget: () => null },
      now: () => NOW,
    });
    assert.equal(svc.generateScorecard('weather', 'healthy').components.budgetHealth, 1);
  });

  it('predictionAccuracy defaults to 0.5 (neutral) when accuracy missing', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({ weather: { ...perfectFixture(), accuracy: undefined } }),
      now: () => NOW,
    });
    assert.equal(svc.generateScorecard('weather', 'healthy').components.predictionAccuracy, 0.5);
  });
});

// ── topIssue + recommendation ────────────────────────────────────────

describe('DomainScorecardService — topIssue', () => {
  beforeEach(() => { resetForTests(); });

  it('topIssue mentions the lowest-scoring component', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({
        weather: { ...perfectFixture(), falsePositiveRate: 0.9 },
      }),
      now: () => NOW,
    });
    const card = svc.generateScorecard('weather', 'healthy');
    assert.ok(card.topIssue);
    assert.match(card.topIssue!, /outcome quality|false positive/i);
  });

  it('topIssue is null when every component is 1', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({ weather: { ...perfectFixture(), multiplier: 1.5 } }), // attentionEff=1
      now: () => NOW,
    });
    const card = svc.generateScorecard('weather', 'healthy');
    // With multiplier=1.5 + perfect quality, attentionEfficiency = 1.
    // All components 1 → no topIssue.
    assert.equal(card.topIssue, null);
  });

  it('recommendation is a non-empty sentence', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({ weather: brokenFixture() }),
      now: () => NOW,
    });
    const card = svc.generateScorecard('weather', 'healthy');
    assert.ok(card.recommendation.length > 0);
  });

  it('outcomeCount reflects calibration total', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({
        weather: { ...perfectFixture(), totalOutcomes: 17 },
      }),
      now: () => NOW,
    });
    assert.equal(svc.generateScorecard('weather', 'healthy').outcomeCount, 17);
  });
});

// ── generateAll ──────────────────────────────────────────────────────

describe('DomainScorecardService.generateAll', () => {
  beforeEach(() => { resetForTests(); });

  it('summary lists topPerformer and worstPerformer', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({
        weather: perfectFixture(),
        cyber: brokenFixture(),
      }),
      now: () => NOW,
    });
    const summary = svc.generateAll({ weather: 'healthy', cyber: 'down' });
    assert.equal(summary.topPerformer, 'weather');
    assert.equal(summary.worstPerformer, 'cyber');
  });

  it('domainsNeedingAttention only includes D / F grades', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({
        weather: perfectFixture(),
        cyber: brokenFixture(),
      }),
      now: () => NOW,
    });
    const summary = svc.generateAll({ weather: 'healthy', cyber: 'down' });
    assert.ok(summary.domainsNeedingAttention.includes('cyber'));
    assert.ok(!summary.domainsNeedingAttention.includes('weather'));
  });

  it('systemGrade is the median grade across all domains', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({
        a: perfectFixture(),                // A
        b: perfectFixture(),                // A
        c: brokenFixture(),                 // F
      }),
      now: () => NOW,
    });
    const summary = svc.generateAll({ a: 'healthy', b: 'healthy', c: 'down' });
    // Sorted: A, A, F → median = A
    assert.equal(summary.systemGrade, 'A');
  });

  it('generatedAt is a Date', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({ weather: perfectFixture() }),
      now: () => NOW,
    });
    const summary = svc.generateAll({ weather: 'healthy' });
    assert.ok(summary.generatedAt instanceof Date);
  });
});

// ── trend / history ───────────────────────────────────────────────────

describe('DomainScorecardService — trend', () => {
  beforeEach(() => { resetForTests(); });

  it('first generation has trend="stable"', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({ weather: perfectFixture() }),
      now: () => NOW,
    });
    assert.equal(svc.generateScorecard('weather', 'healthy').trend, 'stable');
  });

  it('second generation with higher score → trend="improving"', () => {
    const lowSources = makeSources({ weather: { ...perfectFixture(), falsePositiveRate: 0.8 } });
    const highSources = makeSources({ weather: perfectFixture() });
    const svcLow = new DomainScorecardService({ sources: lowSources, now: () => NOW });
    svcLow.generateScorecard('weather', 'healthy');
    // Swap to a high source set and re-generate on the same instance.
    (svcLow as unknown as { sources: DomainScorecardSources }).sources = highSources;
    const card = svcLow.generateScorecard('weather', 'healthy');
    assert.equal(card.trend, 'improving');
  });

  it('second generation with lower score → trend="degrading"', () => {
    const high = makeSources({ weather: perfectFixture() });
    const low = makeSources({ weather: brokenFixture() });
    const svc = new DomainScorecardService({ sources: high, now: () => NOW });
    svc.generateScorecard('weather', 'healthy');
    (svc as unknown as { sources: DomainScorecardSources }).sources = low;
    const card = svc.generateScorecard('weather', 'down');
    assert.equal(card.trend, 'degrading');
  });

  it('second generation with nearly equal score → trend="stable"', () => {
    const a = makeSources({ weather: perfectFixture() });
    const b = makeSources({ weather: { ...perfectFixture(), falsePositiveRate: 0.02 } });
    const svc = new DomainScorecardService({ sources: a, now: () => NOW });
    svc.generateScorecard('weather', 'healthy');
    (svc as unknown as { sources: DomainScorecardSources }).sources = b;
    const card = svc.generateScorecard('weather', 'healthy');
    assert.equal(card.trend, 'stable');
  });
});

// ── getScorecard / subscribe / persistence ──────────────────────────

describe('DomainScorecardService — accessors and persistence', () => {
  beforeEach(() => { resetForTests(); });

  it('getScorecard returns the latest scorecard by domain', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({ weather: perfectFixture() }),
      now: () => NOW,
    });
    svc.generateScorecard('weather', 'healthy');
    const back = svc.getScorecard('weather');
    assert.ok(back);
    assert.equal(back?.domain, 'weather');
  });

  it('subscribe fires on generateScorecard', () => {
    const svc = new DomainScorecardService({
      sources: makeSources({ weather: perfectFixture() }),
      now: () => NOW,
    });
    let calls = 0;
    const off = svc.subscribe(() => { calls++; });
    svc.generateScorecard('weather', 'healthy');
    assert.equal(calls, 1);
    off();
    svc.generateScorecard('weather', 'healthy');
    assert.equal(calls, 1);
  });

  it('persists to and restores from a storage seam', () => {
    const fakeStorage: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => fakeStorage[k] ?? null,
      setItem: (k: string, v: string) => { fakeStorage[k] = v; },
    };
    const a = new DomainScorecardService({
      sources: makeSources({ weather: perfectFixture() }),
      storage,
      now: () => NOW,
    });
    a.generateScorecard('weather', 'healthy');
    const b = new DomainScorecardService({
      sources: makeSources({ weather: perfectFixture() }),
      storage,
      now: () => NOW,
    });
    assert.ok(b.getScorecard('weather'));
  });

  it('corrupted storage falls back to empty', () => {
    const storage = { getItem: () => '{not-json', setItem: () => {} };
    const svc = new DomainScorecardService({
      sources: makeSources({}),
      storage,
    });
    assert.equal(svc.getScorecard('weather'), undefined);
  });
});
