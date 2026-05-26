/**
 * SupplyChainResiliencePanel helper tests.
 *
 * Covers every pure helper exported from `supply-chain-helpers.ts`:
 *   - computeStressIndex / bandForStressScore (weighting, top-driver, bands)
 *   - severityForLeadTime / summarizeSemiconductorShortages
 *   - summarizeScarcity
 *   - summarizeFactoryShutdowns
 *   - classifyFreightDelta / severityForFreightDelta / detectFreightAnomalies
 *   - bandForJitRisk / computeJitRisk
 *   - summarizeNearshoring
 *   - formatAge / formatDuration
 *   - constants (color / label tables)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FREIGHT_CLASSIFICATION_COLOR,
  JIT_BAND_COLOR,
  NEARSHORING_DIRECTION_GLYPH,
  NEARSHORING_DIRECTION_LABEL,
  SHORTAGE_SEVERITY_COLOR,
  SHUTDOWN_CAUSE_LABEL,
  STRESS_BAND_COLOR,
  STRESS_COMPONENT_LABEL,
  STRESS_WEIGHTS,
  bandForJitRisk,
  bandForStressScore,
  classifyFreightDelta,
  computeJitRisk,
  computeStressIndex,
  detectFreightAnomalies,
  formatAge,
  formatDuration,
  severityForFreightDelta,
  severityForLeadTime,
  summarizeFactoryShutdowns,
  summarizeNearshoring,
  summarizeScarcity,
  summarizeSemiconductorShortages,
  type FactoryShutdown,
  type FreightLaneSnapshot,
  type JitInventorySnapshot,
  type NearshoringIndicator,
  type ScarcitySignal,
  type SemiconductorSnapshot,
} from '../supply-chain-helpers';

const NOW = Date.UTC(2026, 4, 26, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ── computeStressIndex ───────────────────────────────────────────────

describe('computeStressIndex', () => {
  it('returns zero score with null topDriver when every component is zero', () => {
    const result = computeStressIndex({
      freightAnomalyScore: 0,
      factoryShutdownScore: 0,
      semisShortageScore: 0,
      scarcityScore: 0,
      jitRiskScore: 0,
    });
    assert.equal(result.score, 0);
    assert.equal(result.topDriver, null);
    assert.equal(result.band, 'low');
  });

  it('computes weighted average across all five components', () => {
    const result = computeStressIndex({
      freightAnomalyScore: 100,
      factoryShutdownScore: 100,
      semisShortageScore: 100,
      scarcityScore: 100,
      jitRiskScore: 100,
    });
    assert.equal(result.score, 100);
    assert.equal(result.band, 'critical');
  });

  it('picks the top driver by weighted contribution, not raw score', () => {
    // JIT 80 * 0.15 = 12; Factory 60 * 0.25 = 15. Factory wins.
    const result = computeStressIndex({
      freightAnomalyScore: 0,
      factoryShutdownScore: 60,
      semisShortageScore: 0,
      scarcityScore: 0,
      jitRiskScore: 80,
    });
    assert.equal(result.topDriver, STRESS_COMPONENT_LABEL.factoryShutdownScore);
  });

  it('clamps out-of-range inputs into [0, 100] before weighting', () => {
    const result = computeStressIndex({
      freightAnomalyScore: -50,
      factoryShutdownScore: 300,
      semisShortageScore: Number.NaN,
      scarcityScore: 0,
      jitRiskScore: 0,
    });
    // factory clamped 300 → 100; 100 * 0.25 = 25.
    assert.equal(result.score, 25);
    assert.equal(result.weightedContributions.freightAnomalyScore, 0);
    assert.equal(result.weightedContributions.semisShortageScore, 0);
  });

  it('weights sum to exactly 1.0', () => {
    const sum = Object.values(STRESS_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `expected ~1.0, got ${sum}`);
  });
});

describe('bandForStressScore', () => {
  it('respects band boundaries', () => {
    assert.equal(bandForStressScore(0), 'low');
    assert.equal(bandForStressScore(19), 'low');
    assert.equal(bandForStressScore(20), 'moderate');
    assert.equal(bandForStressScore(39), 'moderate');
    assert.equal(bandForStressScore(40), 'elevated');
    assert.equal(bandForStressScore(59), 'elevated');
    assert.equal(bandForStressScore(60), 'severe');
    assert.equal(bandForStressScore(79), 'severe');
    assert.equal(bandForStressScore(80), 'critical');
    assert.equal(bandForStressScore(100), 'critical');
  });
});

// ── Semiconductor shortages ──────────────────────────────────────────

describe('severityForLeadTime', () => {
  it('returns low when current matches or is below baseline', () => {
    assert.equal(severityForLeadTime(10, 10), 'low');
    assert.equal(severityForLeadTime(8, 10), 'low');
  });
  it('returns moderate at ratio >= 1.25 and < 2.0', () => {
    assert.equal(severityForLeadTime(13, 10), 'moderate'); // 1.30
    assert.equal(severityForLeadTime(19, 10), 'moderate'); // 1.90
  });
  it('returns severe at ratio >= 2.0', () => {
    assert.equal(severityForLeadTime(20, 10), 'severe');
    assert.equal(severityForLeadTime(40, 10), 'severe');
  });
  it('returns low when baseline is missing or non-positive', () => {
    assert.equal(severityForLeadTime(40, 0), 'low');
    assert.equal(severityForLeadTime(40, Number.NaN), 'low');
  });
});

describe('summarizeSemiconductorShortages', () => {
  const fixture: SemiconductorSnapshot[] = [
    { node: '28nm', leadTimeWeeks: 12, baselineLeadTimeWeeks: 10, affectedSectors: ['auto'] },
    { node: '5nm', leadTimeWeeks: 40, baselineLeadTimeWeeks: 20, affectedSectors: ['ai'] },
    { node: '14nm', leadTimeWeeks: 26, baselineLeadTimeWeeks: 20, affectedSectors: ['industrial'] },
  ];

  it('sorts severe-first then by weeks-over-baseline desc', () => {
    const rows = summarizeSemiconductorShortages(fixture);
    assert.equal(rows[0].node, '5nm');     // severe, +20
    assert.equal(rows[0].severity, 'severe');
    assert.equal(rows[1].node, '14nm');    // moderate, +6
    assert.equal(rows[1].severity, 'moderate');
    assert.equal(rows[2].node, '28nm');    // low (1.2x), +2
    assert.equal(rows[2].severity, 'low');
  });

  it('computes ratio and weeksOverBaseline correctly', () => {
    const rows = summarizeSemiconductorShortages(fixture);
    const fiveNm = rows.find((r) => r.node === '5nm')!;
    assert.equal(fiveNm.ratio, 2);
    assert.equal(fiveNm.weeksOverBaseline, 20);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(summarizeSemiconductorShortages([]), []);
  });
});

// ── Critical-goods scarcity ──────────────────────────────────────────

describe('summarizeScarcity', () => {
  const fixture: ScarcitySignal[] = [
    { good: 'gallium', severity: 'severe', region: 'global', observedAt: NOW - 2 * HOUR, source: 'fastmarkets' },
    { good: 'baby formula', severity: 'low', region: 'us-northeast', observedAt: NOW - 10 * MIN, source: 'fda' },
    { good: 'antibiotics', severity: 'moderate', region: 'us', observedAt: NOW - 6 * HOUR, source: 'fda' },
    { good: 'magnesium', severity: 'severe', region: 'eu', observedAt: NOW - 5 * MIN, source: 'usgs' },
  ];

  it('sorts severe-first then by most-recent observation', () => {
    const rows = summarizeScarcity(fixture, NOW);
    assert.equal(rows[0].good, 'magnesium'); // severe, 5m
    assert.equal(rows[1].good, 'gallium');   // severe, 2h
    assert.equal(rows[2].good, 'antibiotics'); // moderate
    assert.equal(rows[3].good, 'baby formula'); // low
  });

  it('attaches a human-readable age label', () => {
    const rows = summarizeScarcity(fixture, NOW);
    const magnesium = rows.find((r) => r.good === 'magnesium')!;
    assert.equal(magnesium.ageLabel, '5m');
  });

  it('preserves region and source verbatim', () => {
    const rows = summarizeScarcity(fixture, NOW);
    const gallium = rows.find((r) => r.good === 'gallium')!;
    assert.equal(gallium.region, 'global');
    assert.equal(gallium.source, 'fastmarkets');
  });
});

// ── Factory shutdowns ────────────────────────────────────────────────

describe('summarizeFactoryShutdowns', () => {
  const fixture: FactoryShutdown[] = [
    { id: 's1', facility: 'TSMC Fab 18', region: 'taiwan', cause: 'weather', startedAt: NOW - 3 * HOUR, expectedDurationHours: 36, impactScore: 80 },
    { id: 's2', facility: 'BASF Ludwigshafen', region: 'germany', cause: 'power', startedAt: NOW - 6 * HOUR, expectedDurationHours: null, impactScore: 60 },
    { id: 's3', facility: 'Foxconn Zhengzhou', region: 'china', cause: 'unrest', startedAt: NOW - 24 * HOUR, expectedDurationHours: 240, impactScore: 95 },
  ];

  it('sorts by impactScore desc', () => {
    const rows = summarizeFactoryShutdowns(fixture, NOW);
    assert.equal(rows[0].id, 's3'); // 95
    assert.equal(rows[1].id, 's1'); // 80
    assert.equal(rows[2].id, 's2'); // 60
  });

  it('formats expected duration in human units, "unknown" when null', () => {
    const rows = summarizeFactoryShutdowns(fixture, NOW);
    const s1 = rows.find((r) => r.id === 's1')!;
    const s2 = rows.find((r) => r.id === 's2')!;
    const s3 = rows.find((r) => r.id === 's3')!;
    assert.equal(s1.durationLabel, '1d 12h');
    assert.equal(s2.durationLabel, 'unknown');
    assert.equal(s3.durationLabel, '10d');
  });

  it('clamps impactScore into [0, 100]', () => {
    const rows = summarizeFactoryShutdowns(
      [{ ...fixture[0], impactScore: 250 }, { ...fixture[1], impactScore: -10 }],
      NOW,
    );
    assert.ok(rows.every((r) => r.impactScore >= 0 && r.impactScore <= 100));
  });
});

// ── Freight rate anomalies ───────────────────────────────────────────

describe('classifyFreightDelta', () => {
  it('classifies spike at +15 and above', () => {
    assert.equal(classifyFreightDelta(15), 'spike');
    assert.equal(classifyFreightDelta(80), 'spike');
  });
  it('classifies depressed at -15 and below', () => {
    assert.equal(classifyFreightDelta(-15), 'depressed');
    assert.equal(classifyFreightDelta(-40), 'depressed');
  });
  it('classifies normal inside (-15, +15)', () => {
    assert.equal(classifyFreightDelta(0), 'normal');
    assert.equal(classifyFreightDelta(14.9), 'normal');
    assert.equal(classifyFreightDelta(-14.9), 'normal');
  });
});

describe('severityForFreightDelta', () => {
  it('escalates with absolute deviation', () => {
    assert.equal(severityForFreightDelta(0), 'low');
    assert.equal(severityForFreightDelta(24.9), 'low');
    assert.equal(severityForFreightDelta(25), 'moderate');
    assert.equal(severityForFreightDelta(-49.9), 'moderate');
    assert.equal(severityForFreightDelta(50), 'severe');
    assert.equal(severityForFreightDelta(-200), 'severe');
  });
});

describe('detectFreightAnomalies', () => {
  const fixture: FreightLaneSnapshot[] = [
    { lane: 'Shanghai → LA', currentRateUsd: 4500, baselineRateUsd: 2000 },     // +125%
    { lane: 'Rotterdam → NYC', currentRateUsd: 1600, baselineRateUsd: 1500 },   // +6.7%
    { lane: 'Singapore → Hamburg', currentRateUsd: 900, baselineRateUsd: 1500 },// -40%
    { lane: 'No-baseline lane', currentRateUsd: 1000, baselineRateUsd: 0 },     // omitted
  ];

  it('omits lanes with zero or invalid baseline', () => {
    const rows = detectFreightAnomalies(fixture);
    assert.equal(rows.length, 3);
    assert.ok(!rows.some((r) => r.lane === 'No-baseline lane'));
  });

  it('sorts by absolute percent delta desc', () => {
    const rows = detectFreightAnomalies(fixture);
    assert.equal(rows[0].lane, 'Shanghai → LA');     // |125|
    assert.equal(rows[1].lane, 'Singapore → Hamburg'); // |40|
    assert.equal(rows[2].lane, 'Rotterdam → NYC');   // |6.7|
  });

  it('attaches classification and severity', () => {
    const rows = detectFreightAnomalies(fixture);
    const shanghai = rows.find((r) => r.lane === 'Shanghai → LA')!;
    assert.equal(shanghai.classification, 'spike');
    assert.equal(shanghai.severity, 'severe');
    const singapore = rows.find((r) => r.lane === 'Singapore → Hamburg')!;
    assert.equal(singapore.classification, 'depressed');
    assert.equal(singapore.severity, 'moderate');
    const rotterdam = rows.find((r) => r.lane === 'Rotterdam → NYC')!;
    assert.equal(rotterdam.classification, 'normal');
  });
});

// ── JIT risk ─────────────────────────────────────────────────────────

describe('bandForJitRisk', () => {
  it('returns safe when cover meets or exceeds safety', () => {
    assert.equal(bandForJitRisk(30, 30), 'safe');
    assert.equal(bandForJitRisk(45, 30), 'safe');
  });
  it('returns watch when shortfall <= 25 %', () => {
    assert.equal(bandForJitRisk(23, 30), 'watch'); // shortfall 7/30 = 23 %
  });
  it('returns at_risk when shortfall <= 60 %', () => {
    assert.equal(bandForJitRisk(15, 30), 'at_risk'); // 50 %
  });
  it('returns critical when shortfall > 60 % or cover <= 0', () => {
    assert.equal(bandForJitRisk(5, 30), 'critical');  // shortfall 83 %
    assert.equal(bandForJitRisk(0, 30), 'critical');
    assert.equal(bandForJitRisk(-3, 30), 'critical');
  });
  it('returns safe when safety threshold is zero or invalid', () => {
    assert.equal(bandForJitRisk(5, 0), 'safe');
    assert.equal(bandForJitRisk(5, Number.NaN), 'safe');
  });
});

describe('computeJitRisk', () => {
  const fixture: JitInventorySnapshot[] = [
    { sector: 'auto', daysOfCover: 5, safetyThresholdDays: 30 },        // critical
    { sector: 'pharma', daysOfCover: 28, safetyThresholdDays: 30 },     // watch
    { sector: 'consumer', daysOfCover: 45, safetyThresholdDays: 30 },   // safe
    { sector: 'industrial', daysOfCover: 15, safetyThresholdDays: 30 }, // at_risk
  ];

  it('sorts worst-band first', () => {
    const rows = computeJitRisk(fixture);
    assert.equal(rows[0].sector, 'auto');
    assert.equal(rows[1].sector, 'industrial');
    assert.equal(rows[2].sector, 'pharma');
    assert.equal(rows[3].sector, 'consumer');
  });

  it('computes shortfallDays correctly (floored at zero)', () => {
    const rows = computeJitRisk(fixture);
    assert.equal(rows.find((r) => r.sector === 'auto')!.shortfallDays, 25);
    assert.equal(rows.find((r) => r.sector === 'consumer')!.shortfallDays, 0);
  });
});

// ── Nearshoring ──────────────────────────────────────────────────────

describe('summarizeNearshoring', () => {
  it('returns stable + zero confidence for empty input', () => {
    const t = summarizeNearshoring([]);
    assert.equal(t.overall, 'stable');
    assert.equal(t.confidence, 0);
    assert.deepEqual(t.bySector, []);
  });

  it('classifies accelerating when weighted net > 0.3', () => {
    const fixture: NearshoringIndicator[] = [
      { sector: 'semis', direction: 'accelerating', confidence: 0.9, rationale: 'CHIPS act' },
      { sector: 'pharma', direction: 'accelerating', confidence: 0.8, rationale: 'API onshoring' },
      { sector: 'auto', direction: 'stable', confidence: 0.5, rationale: 'mixed' },
    ];
    const t = summarizeNearshoring(fixture);
    assert.equal(t.overall, 'accelerating');
    assert.ok(t.confidence > 0);
  });

  it('classifies reversing when weighted net < -0.3', () => {
    const fixture: NearshoringIndicator[] = [
      { sector: 'electronics', direction: 'reversing', confidence: 0.9, rationale: 'cost pressure' },
      { sector: 'apparel', direction: 'reversing', confidence: 0.9, rationale: 'tariff easing' },
    ];
    const t = summarizeNearshoring(fixture);
    assert.equal(t.overall, 'reversing');
  });

  it('returns stable when weighted net falls inside [-0.3, +0.3]', () => {
    const fixture: NearshoringIndicator[] = [
      { sector: 'a', direction: 'accelerating', confidence: 0.4, rationale: '' },
      { sector: 'b', direction: 'reversing', confidence: 0.4, rationale: '' },
      { sector: 'c', direction: 'stable', confidence: 0.8, rationale: '' },
    ];
    const t = summarizeNearshoring(fixture);
    assert.equal(t.overall, 'stable');
  });

  it('clamps confidence into [0, 1] before weighting', () => {
    const fixture: NearshoringIndicator[] = [
      { sector: 'a', direction: 'accelerating', confidence: 5, rationale: '' },
      { sector: 'b', direction: 'accelerating', confidence: -1, rationale: '' },
    ];
    const t = summarizeNearshoring(fixture);
    assert.ok(t.confidence >= 0 && t.confidence <= 1);
  });
});

// ── Shared formatters ────────────────────────────────────────────────

describe('formatAge', () => {
  it('formats minutes / hours / days / months', () => {
    assert.equal(formatAge(NOW - 5 * MIN, NOW), '5m');
    assert.equal(formatAge(NOW - 3 * HOUR, NOW), '3h');
    assert.equal(formatAge(NOW - 4 * DAY, NOW), '4d');
    assert.equal(formatAge(NOW - 90 * DAY, NOW), '3mo');
  });
  it('returns "-" when observation is in the future', () => {
    assert.equal(formatAge(NOW + HOUR, NOW), '-');
  });
});

describe('formatDuration', () => {
  it('uses h+m for sub-day spans', () => {
    assert.equal(formatDuration(30 * MIN), '30m');
    assert.equal(formatDuration(3 * HOUR + 15 * MIN), '3h 15m');
    assert.equal(formatDuration(5 * HOUR), '5h');
  });
  it('uses d+h for multi-day spans', () => {
    assert.equal(formatDuration(2 * DAY + 4 * HOUR), '2d 4h');
    assert.equal(formatDuration(7 * DAY), '7d');
  });
  it('returns "0m" for zero / negative / NaN', () => {
    assert.equal(formatDuration(0), '0m');
    assert.equal(formatDuration(-1), '0m');
    assert.equal(formatDuration(Number.NaN), '0m');
  });
});

// ── Constants ────────────────────────────────────────────────────────

describe('display constants', () => {
  it('cover every band / severity / cause / direction', () => {
    assert.ok(STRESS_BAND_COLOR.low && STRESS_BAND_COLOR.critical);
    assert.ok(SHORTAGE_SEVERITY_COLOR.severe && SHORTAGE_SEVERITY_COLOR.low);
    assert.ok(JIT_BAND_COLOR.safe && JIT_BAND_COLOR.critical);
    assert.ok(FREIGHT_CLASSIFICATION_COLOR.spike && FREIGHT_CLASSIFICATION_COLOR.depressed);
    for (const cause of ['weather', 'unrest', 'power', 'strike', 'cyber', 'fire', 'other'] as const) {
      assert.ok(SHUTDOWN_CAUSE_LABEL[cause]);
    }
    for (const dir of ['accelerating', 'stable', 'reversing'] as const) {
      assert.ok(NEARSHORING_DIRECTION_GLYPH[dir]);
      assert.ok(NEARSHORING_DIRECTION_LABEL[dir]);
    }
  });

  it('STRESS_COMPONENT_LABEL covers every StressInput key', () => {
    const labelKeys = Object.keys(STRESS_COMPONENT_LABEL).sort();
    const weightKeys = Object.keys(STRESS_WEIGHTS).sort();
    assert.deepEqual(labelKeys, weightKeys);
  });
});
