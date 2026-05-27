import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyBackslidingTrend,
  assessKleptocracyRisk,
  evaluateSWFOpacity,
  computeGlobalBackslidingIndex,
  generateAlerts,
  rankCountriesByRisk,
  computeSystemConfidence,
  assessDataFreshness,
  buildEmptySnapshot,
  mergeSnapshots,
  type DemocraticBackslidingScore,
  type PoliticalStabilityIndicator,
  type PoliticalEconomySnapshot,
  type StateCapacityScore,
  type SovereignWealthFundProfile,
} from '../../services/political-economy/political-economy-helpers.ts';

const NOW = Date.parse('2026-05-26T12:00:00Z');
const HOUR_MS  = 60 * 60 * 1000;
const DAY_MS   = 24 * HOUR_MS;

// ── Helpers ───────────────────────────────────────────────────────────────

function makeScore(over: Partial<DemocraticBackslidingScore> = {}): DemocraticBackslidingScore {
  return {
    countryCode: over.countryCode ?? 'US',
    countryName: over.countryName ?? 'United States',
    score: over.score ?? 70,
    trend: over.trend ?? 'stable',
    trendDelta: over.trendDelta ?? 0,
    indicators: over.indicators ?? {
      electoralIntegrity: 75,
      civilLiberties: 80,
      ruleOfLaw: 78,
      pressFreedorm: 72,
      judicialIndependence: 80,
    },
    lastUpdated: over.lastUpdated ?? NOW,
    confidence: over.confidence ?? 0.9,
  };
}

function makeStability(over: Partial<PoliticalStabilityIndicator> = {}): PoliticalStabilityIndicator {
  return {
    countryCode: over.countryCode ?? 'US',
    countryName: over.countryName ?? 'United States',
    stabilityScore: over.stabilityScore ?? 75,
    eliteCaptureProbability: over.eliteCaptureProbability ?? 0.1,
    kleptocracyRisk: over.kleptocracyRisk ?? 'low',
    corruptionPerceptionIndex: over.corruptionPerceptionIndex ?? 70,
    sanctionedEntities: over.sanctionedEntities ?? 0,
    oligarchNetworkDensity: over.oligarchNetworkDensity ?? 0.05,
  };
}

function makeCapacity(over: Partial<StateCapacityScore> = {}): StateCapacityScore {
  return {
    countryCode: over.countryCode ?? 'US',
    countryName: over.countryName ?? 'United States',
    overallScore: over.overallScore ?? 70,
    dimensions: over.dimensions ?? {
      fiscalCapacity: 70,
      administrativeCapacity: 70,
      coerciveCapacity: 70,
      legitimacy: 70,
    },
    fragileStateRisk: over.fragileStateRisk ?? 'stable',
    confidence: over.confidence ?? 0.9,
  };
}

function makeSWF(over: Partial<SovereignWealthFundProfile> = {}): SovereignWealthFundProfile {
  return {
    fundName: over.fundName ?? 'Norway GPFG',
    country: over.country ?? 'NO',
    estimatedAumBillions: over.estimatedAumBillions ?? 1400,
    opacity: over.opacity ?? 'transparent',
    lieqaFundScore: over.lieqaFundScore ?? 10,
    geopoliticAlignment: over.geopoliticAlignment ?? 'western',
    sanctionRisk: over.sanctionRisk ?? 0,
  };
}

function makeSnapshot(over: Partial<PoliticalEconomySnapshot> = {}): PoliticalEconomySnapshot {
  return {
    asOf: over.asOf ?? NOW,
    globalBackslidingIndex: over.globalBackslidingIndex ?? 65,
    highRiskCountries: over.highRiskCountries ?? [],
    stateCapacityAlerts: over.stateCapacityAlerts ?? [],
    stabilityIndicators: over.stabilityIndicators ?? [],
    sovereignFunds: over.sovereignFunds ?? [],
    systemConfidence: over.systemConfidence ?? 0.9,
    dataFreshness: over.dataFreshness ?? 'fresh',
  };
}

// ── classifyBackslidingTrend ──────────────────────────────────────────────

test('classifyBackslidingTrend: delta > 3 → improving', () => {
  assert.equal(classifyBackslidingTrend(74, 70), 'improving');
});

test('classifyBackslidingTrend: delta exactly 4 → improving', () => {
  assert.equal(classifyBackslidingTrend(74, 70), 'improving');
});

test('classifyBackslidingTrend: delta exactly 3 → stable (not improving)', () => {
  assert.equal(classifyBackslidingTrend(73, 70), 'stable');
});

test('classifyBackslidingTrend: score < 30 and falling → crisis', () => {
  assert.equal(classifyBackslidingTrend(25, 27), 'crisis');
});

test('classifyBackslidingTrend: score < 30 but rising → improving (delta > 3 wins)', () => {
  assert.equal(classifyBackslidingTrend(25, 20), 'improving');
});

test('classifyBackslidingTrend: score < 30 stable → crisis (delta = -1)', () => {
  assert.equal(classifyBackslidingTrend(29, 30), 'crisis');
});

test('classifyBackslidingTrend: delta < -3 → deteriorating', () => {
  assert.equal(classifyBackslidingTrend(60, 65), 'deteriorating');
});

test('classifyBackslidingTrend: delta exactly -3 → stable (not deteriorating)', () => {
  assert.equal(classifyBackslidingTrend(67, 70), 'stable');
});

test('classifyBackslidingTrend: zero delta → stable', () => {
  assert.equal(classifyBackslidingTrend(50, 50), 'stable');
});

// ── assessKleptocracyRisk ─────────────────────────────────────────────────

test('assessKleptocracyRisk: high CPI, no sanctions, low density → low', () => {
  assert.equal(assessKleptocracyRisk(90, 0, 0), 'low');
});

test('assessKleptocracyRisk: moderate CPI, some sanctions → moderate', () => {
  const result = assessKleptocracyRisk(50, 5, 0.1);
  assert.ok(['low', 'moderate'].includes(result));
});

test('assessKleptocracyRisk: low CPI, many sanctions, high density → extreme', () => {
  assert.equal(assessKleptocracyRisk(10, 100, 0.9), 'extreme');
});

test('assessKleptocracyRisk: CPI = 0 edge case → extreme', () => {
  assert.equal(assessKleptocracyRisk(0, 100, 1), 'extreme');
});

test('assessKleptocracyRisk: CPI = 100 (cleanest), no sanctions → low', () => {
  assert.equal(assessKleptocracyRisk(100, 0, 0), 'low');
});

test('assessKleptocracyRisk: mid-range CPI 40, 30 sanctions, 0.5 density → high', () => {
  const result = assessKleptocracyRisk(40, 30, 0.5);
  assert.ok(['high', 'extreme'].includes(result));
});

test('assessKleptocracyRisk: all four tiers are reachable', () => {
  const low      = assessKleptocracyRisk(90, 0, 0);
  const moderate = assessKleptocracyRisk(50, 10, 0.2);  // raw ≈ 35 → moderate
  const high     = assessKleptocracyRisk(30, 25, 0.5);  // raw = 60 → high
  const extreme  = assessKleptocracyRisk(5, 100, 0.95);
  assert.equal(low, 'low');
  assert.equal(moderate, 'moderate');
  assert.equal(high, 'high');
  assert.equal(extreme, 'extreme');
});

// ── evaluateSWFOpacity ────────────────────────────────────────────────────

test('evaluateSWFOpacity: score 10 → transparent', () => {
  assert.equal(evaluateSWFOpacity(10), 'transparent');
});

test('evaluateSWFOpacity: score 8 → transparent (boundary)', () => {
  assert.equal(evaluateSWFOpacity(8), 'transparent');
});

test('evaluateSWFOpacity: score 7 → partial', () => {
  assert.equal(evaluateSWFOpacity(7), 'partial');
});

test('evaluateSWFOpacity: score 5 → partial (boundary)', () => {
  assert.equal(evaluateSWFOpacity(5), 'partial');
});

test('evaluateSWFOpacity: score 4 → opaque', () => {
  assert.equal(evaluateSWFOpacity(4), 'opaque');
});

test('evaluateSWFOpacity: score 1 → opaque (boundary)', () => {
  assert.equal(evaluateSWFOpacity(1), 'opaque');
});

test('evaluateSWFOpacity: score 0 → unknown', () => {
  assert.equal(evaluateSWFOpacity(0), 'unknown');
});

// ── computeGlobalBackslidingIndex ─────────────────────────────────────────

test('computeGlobalBackslidingIndex: empty array → 0', () => {
  assert.equal(computeGlobalBackslidingIndex([]), 0);
});

test('computeGlobalBackslidingIndex: single score returns that score', () => {
  const result = computeGlobalBackslidingIndex([makeScore({ score: 72, confidence: 1 })]);
  assert.ok(Math.abs(result - 72) < 0.01);
});

test('computeGlobalBackslidingIndex: equal confidences → simple mean', () => {
  const scores = [
    makeScore({ score: 60, confidence: 0.5 }),
    makeScore({ score: 80, confidence: 0.5 }),
  ];
  const result = computeGlobalBackslidingIndex(scores);
  assert.ok(Math.abs(result - 70) < 0.01);
});

test('computeGlobalBackslidingIndex: higher-confidence entries dominate', () => {
  const scores = [
    makeScore({ score: 20, confidence: 0.1 }),  // low confidence, low score
    makeScore({ score: 80, confidence: 0.9 }),  // high confidence, high score
  ];
  const result = computeGlobalBackslidingIndex(scores);
  // Should be closer to 80 than to 50
  assert.ok(result > 65);
});

// ── assessDataFreshness ───────────────────────────────────────────────────

test('assessDataFreshness: 0ms ago → fresh', () => {
  assert.equal(assessDataFreshness(NOW, NOW), 'fresh');
});

test('assessDataFreshness: 23h ago → fresh', () => {
  assert.equal(assessDataFreshness(NOW - 23 * HOUR_MS, NOW), 'fresh');
});

test('assessDataFreshness: exactly 24h ago → stale', () => {
  assert.equal(assessDataFreshness(NOW - 24 * HOUR_MS, NOW), 'stale');
});

test('assessDataFreshness: 48h ago → stale', () => {
  assert.equal(assessDataFreshness(NOW - 48 * HOUR_MS, NOW), 'stale');
});

test('assessDataFreshness: exactly 72h ago → very_stale', () => {
  assert.equal(assessDataFreshness(NOW - 72 * HOUR_MS, NOW), 'very_stale');
});

test('assessDataFreshness: 7 days ago → very_stale', () => {
  assert.equal(assessDataFreshness(NOW - 7 * DAY_MS, NOW), 'very_stale');
});

// ── computeSystemConfidence ───────────────────────────────────────────────

test('computeSystemConfidence: empty → 0', () => {
  assert.equal(computeSystemConfidence([]), 0);
});

test('computeSystemConfidence: fresh data, high confidence → near 1', () => {
  const scores = [
    makeScore({ confidence: 0.9, lastUpdated: NOW }),
    makeScore({ confidence: 0.95, lastUpdated: NOW }),
  ];
  const result = computeSystemConfidence(scores);
  assert.ok(result > 0.8);
});

test('computeSystemConfidence: stale data reduces confidence by ~20%', () => {
  const fresh = computeSystemConfidence([makeScore({ confidence: 0.9, lastUpdated: NOW })]);
  const stale = computeSystemConfidence([makeScore({ confidence: 0.9, lastUpdated: NOW - 36 * HOUR_MS })]);
  assert.ok(stale < fresh);
  assert.ok(stale > 0);
});

test('computeSystemConfidence: very stale data reduces confidence by ~40%', () => {
  const fresh = computeSystemConfidence([makeScore({ confidence: 0.9, lastUpdated: NOW })]);
  const veryStale = computeSystemConfidence([makeScore({ confidence: 0.9, lastUpdated: NOW - 4 * DAY_MS })]);
  assert.ok(veryStale < fresh * 0.85);
});

// ── generateAlerts ────────────────────────────────────────────────────────

test('generateAlerts: empty snapshot → no alerts', () => {
  const snap = makeSnapshot();
  assert.equal(generateAlerts(snap).length, 0);
});

test('generateAlerts: score < 30 → critical backsliding alert', () => {
  const snap = makeSnapshot({
    highRiskCountries: [makeScore({ score: 22, countryCode: 'XX', countryName: 'Xland' })],
  });
  const alerts = generateAlerts(snap);
  const crit = alerts.find((a) => a.severity === 'critical' && a.category === 'backsliding');
  assert.ok(crit);
  assert.deepEqual(crit!.affectedCountries, ['XX']);
});

test('generateAlerts: score 30-49 → warning backsliding alert', () => {
  const snap = makeSnapshot({
    highRiskCountries: [makeScore({ score: 45, countryCode: 'YY', countryName: 'Yland' })],
  });
  const alerts = generateAlerts(snap);
  const warn = alerts.find((a) => a.severity === 'warning' && a.category === 'backsliding');
  assert.ok(warn);
});

test('generateAlerts: score >= 50 → no backsliding alert', () => {
  const snap = makeSnapshot({
    highRiskCountries: [makeScore({ score: 55 })],
  });
  const alerts = generateAlerts(snap).filter((a) => a.category === 'backsliding');
  assert.equal(alerts.length, 0);
});

test('generateAlerts: extreme kleptocracy → critical alert', () => {
  const snap = makeSnapshot({
    stabilityIndicators: [makeStability({ kleptocracyRisk: 'extreme', countryCode: 'KL', countryName: 'Kland' })],
  });
  const alerts = generateAlerts(snap);
  const kc = alerts.find((a) => a.category === 'kleptocracy' && a.severity === 'critical');
  assert.ok(kc);
  assert.deepEqual(kc!.affectedCountries, ['KL']);
});

test('generateAlerts: non-extreme kleptocracy → no kleptocracy alert', () => {
  const snap = makeSnapshot({
    stabilityIndicators: [makeStability({ kleptocracyRisk: 'high' })],
  });
  assert.equal(generateAlerts(snap).filter((a) => a.category === 'kleptocracy').length, 0);
});

test('generateAlerts: opaque SWF with AUM > 50B → warning alert', () => {
  const snap = makeSnapshot({
    sovereignFunds: [makeSWF({ opacity: 'opaque', estimatedAumBillions: 200, lieqaFundScore: 2 })],
  });
  const alerts = generateAlerts(snap);
  const swfAlert = alerts.find((a) => a.category === 'swf_opacity');
  assert.ok(swfAlert);
  assert.equal(swfAlert!.severity, 'warning');
});

test('generateAlerts: opaque SWF with AUM <= 50B → no alert', () => {
  const snap = makeSnapshot({
    sovereignFunds: [makeSWF({ opacity: 'opaque', estimatedAumBillions: 30, lieqaFundScore: 2 })],
  });
  assert.equal(generateAlerts(snap).filter((a) => a.category === 'swf_opacity').length, 0);
});

test('generateAlerts: transparent SWF → no alert regardless of AUM', () => {
  const snap = makeSnapshot({
    sovereignFunds: [makeSWF({ opacity: 'transparent', estimatedAumBillions: 2000, lieqaFundScore: 10 })],
  });
  assert.equal(generateAlerts(snap).filter((a) => a.category === 'swf_opacity').length, 0);
});

test('generateAlerts: critical state fragility → critical alert', () => {
  const snap = makeSnapshot({
    stateCapacityAlerts: [makeCapacity({ fragileStateRisk: 'critical', countryCode: 'SO', countryName: 'Somalia' })],
  });
  const alerts = generateAlerts(snap);
  const fragAlert = alerts.find((a) => a.category === 'state_fragility');
  assert.ok(fragAlert);
  assert.equal(fragAlert!.severity, 'critical');
});

test('generateAlerts: mixed snapshot produces multiple alerts', () => {
  const snap = makeSnapshot({
    highRiskCountries: [makeScore({ score: 20, countryCode: 'A1', countryName: 'Alpha' })],
    stabilityIndicators: [makeStability({ kleptocracyRisk: 'extreme', countryCode: 'B2', countryName: 'Beta' })],
    sovereignFunds: [makeSWF({ opacity: 'opaque', estimatedAumBillions: 300, lieqaFundScore: 2 })],
  });
  const alerts = generateAlerts(snap);
  assert.ok(alerts.length >= 3);
});

// ── rankCountriesByRisk ───────────────────────────────────────────────────

test('rankCountriesByRisk: empty inputs → empty array', () => {
  assert.deepEqual(rankCountriesByRisk([], []), []);
});

test('rankCountriesByRisk: lower score = higher risk = earlier in list', () => {
  const scores = [
    makeScore({ countryCode: 'AA', score: 80 }),
    makeScore({ countryCode: 'BB', score: 20 }),
  ];
  const result = rankCountriesByRisk(scores, []);
  assert.equal(result[0], 'BB');
  assert.equal(result[1], 'AA');
});

test('rankCountriesByRisk: extreme kleptocracy boosts risk ranking', () => {
  const scores = [
    makeScore({ countryCode: 'CC', score: 60 }),  // decent democracy
    makeScore({ countryCode: 'DD', score: 55 }),  // slightly worse democracy
  ];
  const stability = [
    makeStability({ countryCode: 'CC', kleptocracyRisk: 'extreme' }),
    makeStability({ countryCode: 'DD', kleptocracyRisk: 'low' }),
  ];
  const result = rankCountriesByRisk(scores, stability);
  // CC has worse kleptocracy, should rank first despite better democracy score
  assert.equal(result[0], 'CC');
});

test('rankCountriesByRisk: countries without stability data are still ranked', () => {
  const scores = [
    makeScore({ countryCode: 'EE', score: 40 }),
    makeScore({ countryCode: 'FF', score: 70 }),
  ];
  const result = rankCountriesByRisk(scores, []);
  assert.equal(result[0], 'EE');
});

// ── buildEmptySnapshot ────────────────────────────────────────────────────

test('buildEmptySnapshot: returns valid structure', () => {
  const snap = buildEmptySnapshot();
  assert.equal(snap.highRiskCountries.length, 0);
  assert.equal(snap.stateCapacityAlerts.length, 0);
  assert.equal(snap.stabilityIndicators.length, 0);
  assert.equal(snap.sovereignFunds.length, 0);
  assert.equal(snap.globalBackslidingIndex, 0);
  assert.equal(snap.systemConfidence, 0);
  assert.ok(snap.asOf > 0);
});

test('buildEmptySnapshot: dataFreshness is fresh for just-created snapshot', () => {
  const snap = buildEmptySnapshot();
  assert.equal(snap.dataFreshness, 'fresh');
});

// ── mergeSnapshots ────────────────────────────────────────────────────────

test('mergeSnapshots: partial update overwrites only specified fields', () => {
  const base = makeSnapshot({ systemConfidence: 0.8 });
  const merged = mergeSnapshots(base, { sovereignFunds: [makeSWF()] });
  assert.equal(merged.sovereignFunds.length, 1);
});

test('mergeSnapshots: recomputes globalBackslidingIndex from merged countries', () => {
  const base = makeSnapshot({ globalBackslidingIndex: 999 });
  const countries = [makeScore({ score: 50, confidence: 1 })];
  const merged = mergeSnapshots(base, { highRiskCountries: countries });
  assert.ok(Math.abs(merged.globalBackslidingIndex - 50) < 0.01);
});

test('mergeSnapshots: recomputes systemConfidence from merged countries', () => {
  const base = makeSnapshot({ systemConfidence: 999 });
  const countries = [makeScore({ confidence: 0.8, lastUpdated: NOW })];
  const merged = mergeSnapshots(base, { highRiskCountries: countries, asOf: NOW });
  assert.ok(merged.systemConfidence <= 1);
  assert.ok(merged.systemConfidence > 0);
});

test('mergeSnapshots: full merge replaces all fields', () => {
  const base  = makeSnapshot({ globalBackslidingIndex: 30 });
  const fresh = buildEmptySnapshot();
  const merged = mergeSnapshots(base, fresh);
  assert.equal(merged.highRiskCountries.length, 0);
  assert.equal(merged.globalBackslidingIndex, 0);
});
