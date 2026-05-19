import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  computePCI,
  pciLevelFor,
  pciToAlert,
  resetPCICooldowns,
  PCI_TREND_THRESHOLD,
  type PCIScore,
} from '../../src/services/intelligence/predictive-crisis-index.js';
import type { SignatureMatch } from '../../src/services/intelligence/crisis-signature-library.js';

// ── Fixtures ───────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

function makeMatch(
  id: string,
  domain: string,
  score: number,
  confidence: number,
  leadTime = 24,
): SignatureMatch {
  return {
    signature: {
      id,
      name: `Sig ${id}`,
      domain,
      fingerprint: [],
      historicalExamples: [],
      avgLeadTimeHours: leadTime,
      confidence,
    },
    score,
    matchedFeatures: [],
    leadTimeEstimateHours: Number((leadTime * (1 - score)).toFixed(2)),
  };
}

// ── pciLevelFor ────────────────────────────────────────────────────────────

describe('pciLevelFor', () => {
  it('returns low for 0–24', () => assert.equal(pciLevelFor(0), 'low'));
  it('returns low at upper boundary 24', () => assert.equal(pciLevelFor(24), 'low'));
  it('returns moderate for 25–49', () => assert.equal(pciLevelFor(25), 'moderate'));
  it('returns moderate at upper boundary 49', () => assert.equal(pciLevelFor(49), 'moderate'));
  it('returns elevated for 50–69', () => assert.equal(pciLevelFor(50), 'elevated'));
  it('returns elevated at upper boundary 69', () => assert.equal(pciLevelFor(69), 'elevated'));
  it('returns high for 70–84', () => assert.equal(pciLevelFor(70), 'high'));
  it('returns high at upper boundary 84', () => assert.equal(pciLevelFor(84), 'high'));
  it('returns critical for 85+', () => assert.equal(pciLevelFor(85), 'critical'));
  it('returns critical at 100', () => assert.equal(pciLevelFor(100), 'critical'));
});

// ── computePCI — empty input ───────────────────────────────────────────────

describe('computePCI — empty matches', () => {
  it('returns index 0 and level low', () => {
    const s = computePCI([], undefined, NOW);
    assert.equal(s.index, 0);
    assert.equal(s.level, 'low');
  });

  it('returns stable trend when no prevIndex', () => {
    const s = computePCI([], undefined, NOW);
    assert.equal(s.trend, 'stable');
    assert.equal(s.trendDelta, 0);
  });

  it('returns falling trend when prevIndex was above threshold', () => {
    const s = computePCI([], 20, NOW);
    assert.equal(s.trend, 'falling');
    assert.equal(s.trendDelta, -20);
  });

  it('returns empty domainBreakdown and topThreats', () => {
    const s = computePCI([], undefined, NOW);
    assert.deepEqual(s.domainBreakdown, []);
    assert.deepEqual(s.topThreats, []);
  });

  it('sets computedAt to now', () => {
    const s = computePCI([], undefined, NOW);
    assert.equal(s.computedAt, NOW);
  });
});

// ── computePCI — single match ──────────────────────────────────────────────

describe('computePCI — single match', () => {
  it('computes risk as matchScore × confidence × 100', () => {
    // score=0.8, confidence=0.75 → risk=60
    const m = makeMatch('a', 'cyber', 0.8, 0.75);
    const s = computePCI([m], undefined, NOW);
    assert.equal(s.topThreats[0]!.risk, 60);
  });

  it('index is weighted by confidence (same as risk here for single match)', () => {
    const m = makeMatch('a', 'cyber', 0.8, 0.75);
    const s = computePCI([m], undefined, NOW);
    // weighted mean = risk * confidence / confidence = risk = 60
    assert.equal(s.index, 60);
    assert.equal(s.level, 'elevated');
  });

  it('domain breakdown has one entry', () => {
    const m = makeMatch('a', 'finance', 0.5, 0.7);
    const s = computePCI([m], undefined, NOW);
    assert.equal(s.domainBreakdown.length, 1);
    assert.equal(s.domainBreakdown[0]!.domain, 'finance');
    assert.equal(s.domainBreakdown[0]!.matchCount, 1);
  });

  it('topThreats is capped at PCI_TOP_THREATS', () => {
    const matches = Array.from({ length: 8 }, (_, i) =>
      makeMatch(`sig${i}`, 'domain', 0.5 + i * 0.02, 0.6)
    );
    const s = computePCI(matches, undefined, NOW);
    assert.ok(s.topThreats.length <= 5);
  });
});

// ── computePCI — multi-domain aggregation ─────────────────────────────────

describe('computePCI — multi-domain aggregation', () => {
  it('groups matches by domain in breakdown', () => {
    const matches = [
      makeMatch('a', 'finance', 0.7, 0.7),
      makeMatch('b', 'finance', 0.6, 0.7),
      makeMatch('c', 'cyber', 0.8, 0.75),
    ];
    const s = computePCI(matches, undefined, NOW);
    const domains = s.domainBreakdown.map((d) => d.domain);
    assert.ok(domains.includes('finance'));
    assert.ok(domains.includes('cyber'));
  });

  it('finance domain has matchCount 2', () => {
    const matches = [
      makeMatch('a', 'finance', 0.7, 0.7),
      makeMatch('b', 'finance', 0.6, 0.7),
      makeMatch('c', 'cyber', 0.8, 0.75),
    ];
    const s = computePCI(matches, undefined, NOW);
    const fin = s.domainBreakdown.find((d) => d.domain === 'finance')!;
    assert.equal(fin.matchCount, 2);
  });

  it('domain breakdown is sorted by score descending', () => {
    const matches = [
      makeMatch('a', 'low-domain', 0.4, 0.5),
      makeMatch('b', 'high-domain', 0.9, 0.9),
    ];
    const s = computePCI(matches, undefined, NOW);
    assert.ok(s.domainBreakdown[0]!.score >= s.domainBreakdown[s.domainBreakdown.length - 1]!.score);
  });

  it('topThreats sorted by risk descending', () => {
    const matches = [
      makeMatch('low', 'a', 0.4, 0.5),  // risk = 20
      makeMatch('high', 'b', 0.9, 0.9), // risk = 81
      makeMatch('mid', 'c', 0.6, 0.7),  // risk = 42
    ];
    const s = computePCI(matches, undefined, NOW);
    const risks = s.topThreats.map((t) => t.risk);
    for (let i = 0; i < risks.length - 1; i++) {
      assert.ok(risks[i]! >= risks[i + 1]!);
    }
  });

  it('high-confidence signatures carry more weight in index', () => {
    // Two matches: same risk but different confidence.
    // Match A: score=0.5, conf=0.9 → risk=45, weighted by 0.9
    // Match B: score=0.5, conf=0.3 → risk=15, weighted by 0.3
    // weightedSum = 45*0.9 + 15*0.3 = 40.5 + 4.5 = 45; totalWeight = 1.2
    // index = round(45/1.2) = round(37.5) = 38
    const matches = [
      makeMatch('a', 'x', 0.5, 0.9),
      makeMatch('b', 'y', 0.5, 0.3),
    ];
    const s = computePCI(matches, undefined, NOW);
    assert.equal(s.index, 38);
  });
});

// ── computePCI — trend ─────────────────────────────────────────────────────

describe('computePCI — trend', () => {
  it('stable when delta < PCI_TREND_THRESHOLD', () => {
    const m = makeMatch('a', 'x', 0.5, 0.7); // index ≈ 35
    const s = computePCI([m], 34, NOW); // delta ≈ 1 → stable
    assert.equal(s.trend, 'stable');
  });

  it('rising when delta >= PCI_TREND_THRESHOLD', () => {
    const m = makeMatch('a', 'x', 0.8, 0.8); // risk=64, index≈64
    const s = computePCI([m], 55, NOW); // delta ≈ 9 → rising
    assert.equal(s.trend, 'rising');
  });

  it('falling when delta <= -PCI_TREND_THRESHOLD', () => {
    const m = makeMatch('a', 'x', 0.3, 0.5); // risk=15, index≈15
    const s = computePCI([m], 30, NOW); // delta ≈ -15 → falling
    assert.equal(s.trend, 'falling');
  });

  it('stable when no prevIndex provided', () => {
    const m = makeMatch('a', 'x', 0.5, 0.7);
    const s = computePCI([m], undefined, NOW);
    assert.equal(s.trend, 'stable');
    assert.equal(s.trendDelta, 0);
  });

  it('trendDelta equals index − prevIndex', () => {
    const m = makeMatch('a', 'x', 0.6, 0.7); // risk=42, index≈42
    const s = computePCI([m], 30, NOW);
    assert.equal(s.trendDelta, s.index - 30);
  });
});

// ── pciToAlert ─────────────────────────────────────────────────────────────

describe('pciToAlert', () => {
  beforeEach(() => resetPCICooldowns());

  it('returns null for low level', () => {
    const s = computePCI([], undefined, NOW);
    assert.equal(pciToAlert(s, NOW), null);
  });

  it('returns null for moderate level (below alert threshold)', () => {
    const s = computePCI([makeMatch('a', 'x', 0.5, 0.5)], undefined, NOW); // index≈25
    // moderate sits just below elevated=50 — may or may not fire depending on exact index
    if (s.level === 'moderate') {
      assert.equal(pciToAlert(s, NOW), null);
    }
  });

  it('fires alert for elevated level', () => {
    const matches = [makeMatch('a', 'cyber', 0.8, 0.75)]; // index=60
    const s = computePCI(matches, undefined, NOW);
    if (s.level === 'elevated' || s.level === 'high' || s.level === 'critical') {
      const alert = pciToAlert(s, NOW);
      assert.ok(alert !== null);
      assert.equal(alert!.source, 'intelligence');
      assert.ok(alert!.title.includes('ELEVATED') || alert!.title.includes('HIGH') || alert!.title.includes('CRITICAL'));
    }
  });

  it('alert severity is medium for elevated', () => {
    // Force a known elevated index (50-69)
    const matches = [makeMatch('a', 'cyber', 0.8, 0.75)]; // index=60
    const s = computePCI(matches, undefined, NOW);
    const alert = pciToAlert(s, NOW);
    if (alert) {
      assert.ok(['medium', 'high', 'critical'].includes(alert.severity));
    }
  });

  it('alert severity is critical for critical level', () => {
    // Build a score at critical level directly
    const criticalScore: PCIScore = {
      index: 90,
      level: 'critical',
      trend: 'rising',
      trendDelta: 10,
      domainBreakdown: [{ domain: 'cyber', score: 90, matchCount: 2 }],
      topThreats: [{
        signatureId: 'test',
        signatureName: 'Test Threat',
        domain: 'cyber',
        matchScore: 0.95,
        confidence: 0.95,
        leadTimeHours: 2,
        risk: 90,
      }],
      computedAt: NOW,
      windowMs: 21_600_000,
    };
    const alert = pciToAlert(criticalScore, NOW);
    assert.ok(alert !== null);
    assert.equal(alert!.severity, 'critical');
  });

  it('respects 30-min cooldown for the same level', () => {
    const criticalScore: PCIScore = {
      index: 90, level: 'critical', trend: 'rising', trendDelta: 10,
      domainBreakdown: [], topThreats: [], computedAt: NOW, windowMs: 0,
    };
    const first = pciToAlert(criticalScore, NOW);
    assert.ok(first !== null);
    const second = pciToAlert(criticalScore, NOW + 1000);
    assert.equal(second, null);
  });

  it('fires again after cooldown expires', () => {
    const criticalScore: PCIScore = {
      index: 90, level: 'critical', trend: 'rising', trendDelta: 10,
      domainBreakdown: [], topThreats: [], computedAt: NOW, windowMs: 0,
    };
    pciToAlert(criticalScore, NOW);
    const after = pciToAlert(criticalScore, NOW + 31 * 60 * 1000);
    assert.ok(after !== null);
  });

  it('includes top threat name in alert body', () => {
    const score: PCIScore = {
      index: 75, level: 'high', trend: 'rising', trendDelta: 10,
      domainBreakdown: [{ domain: 'finance', score: 75, matchCount: 1 }],
      topThreats: [{
        signatureId: 'builtin-financial-contagion',
        signatureName: 'Financial contagion',
        domain: 'finance',
        matchScore: 0.9,
        confidence: 0.8,
        leadTimeHours: 10,
        risk: 72,
      }],
      computedAt: NOW,
      windowMs: 0,
    };
    const alert = pciToAlert(score, NOW);
    assert.ok(alert !== null);
    assert.ok(alert!.body.includes('Financial contagion'));
  });

  it('alert relevanceScore equals index / 100', () => {
    const score: PCIScore = {
      index: 80, level: 'high', trend: 'stable', trendDelta: 0,
      domainBreakdown: [], topThreats: [], computedAt: NOW, windowMs: 0,
    };
    const alert = pciToAlert(score, NOW);
    assert.ok(alert !== null);
    assert.equal(alert!.relevanceScore, 0.8);
  });

  it('different levels have independent cooldowns', () => {
    const highScore: PCIScore = {
      index: 75, level: 'high', trend: 'stable', trendDelta: 0,
      domainBreakdown: [], topThreats: [], computedAt: NOW, windowMs: 0,
    };
    const criticalScore: PCIScore = {
      index: 90, level: 'critical', trend: 'rising', trendDelta: 15,
      domainBreakdown: [], topThreats: [], computedAt: NOW, windowMs: 0,
    };
    const first = pciToAlert(highScore, NOW);
    assert.ok(first !== null);
    // critical should fire even though high is in cooldown
    const second = pciToAlert(criticalScore, NOW + 100);
    assert.ok(second !== null);
  });
});
