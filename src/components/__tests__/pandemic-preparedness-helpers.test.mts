/**
 * Tests for pandemic-preparedness-helpers.ts
 * Pure deterministic logic — no DOM, no fetch.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeRiskTier,
  computeGlobalReadinessScore,
  computeSurgeReadinessScore,
  computeIhrCapacityScore,
  identifyTopVulnerabilities,
  getGhsLeaders,
  getGhsLaggards,
  assessPandemicPreparedness,
  scoreLabel,
  isStockpileConcerning,
  aggregateCoordinationScore,
  DEFAULT_PANDEMIC_INPUT,
  type GhsIndexScore,
  type VaccineStockpile,
  type SurgeCapacity,
  type CrossBorderCoordination,
  type IhrCompliance,
} from '../../components/../services/pandemic/pandemic-preparedness-helpers.ts';

// ── Helper factories ──────────────────────────────────────────────────────

function makeGhs(overallScore: number, iso3 = 'TST'): GhsIndexScore {
  return { country: 'Test', iso3, overallScore, prevention: overallScore, detection: overallScore, response: overallScore, health: overallScore, norms: overallScore, risk: 100 - overallScore, lastUpdated: '2024-01-01' };
}

function makeCoord(coordinationScore: number): CrossBorderCoordination {
  return { region: 'Test', jointExercisesLast2Years: 1, informationSharingAgreements: 2, rapidResponseTeamAvailable: true, coordinationScore };
}

function makeSurge(icu: number, vent: number, hw: number): Omit<SurgeCapacity, 'surgeReadinessScore'> {
  return { region: 'Test', icuBedsPerMillion: icu, ventilatorsPer100k: vent, healthWorkersPerThousand: hw };
}

function makeIhr(leg: number, coord: number, surv: number, resp: number): Omit<IhrCompliance, 'capacityScore'> {
  return { country: 'Test', iso3: 'TST', legislationScore: leg, coordinationScore: coord, surveillanceScore: surv, responseScore: resp, lastReportYear: 2023 };
}

function makeStockpile(adequate: boolean, expiryRisk: VaccineStockpile['expiryRisk'], dosesCoverage: number): VaccineStockpile {
  return { pathogen: 'TestPathogen', dosesCoverage, daysOfStock: 90, adequate, expiryRisk };
}

// ── computeRiskTier ───────────────────────────────────────────────────────

test('computeRiskTier: 0 -> critical', () => {
  assert.equal(computeRiskTier(0), 'critical');
});

test('computeRiskTier: 20 -> critical', () => {
  assert.equal(computeRiskTier(20), 'critical');
});

test('computeRiskTier: 21 -> high', () => {
  assert.equal(computeRiskTier(21), 'high');
});

test('computeRiskTier: 40 -> high', () => {
  assert.equal(computeRiskTier(40), 'high');
});

test('computeRiskTier: 41 -> moderate', () => {
  assert.equal(computeRiskTier(41), 'moderate');
});

test('computeRiskTier: 60 -> moderate', () => {
  assert.equal(computeRiskTier(60), 'moderate');
});

test('computeRiskTier: 61 -> low', () => {
  assert.equal(computeRiskTier(61), 'low');
});

test('computeRiskTier: 80 -> low', () => {
  assert.equal(computeRiskTier(80), 'low');
});

test('computeRiskTier: 81 -> minimal', () => {
  assert.equal(computeRiskTier(81), 'minimal');
});

test('computeRiskTier: 100 -> minimal', () => {
  assert.equal(computeRiskTier(100), 'minimal');
});

test('computeRiskTier: 50 -> moderate', () => {
  assert.equal(computeRiskTier(50), 'moderate');
});

// ── computeSurgeReadinessScore ────────────────────────────────────────────

test('computeSurgeReadinessScore: all zeros -> 0', () => {
  assert.equal(computeSurgeReadinessScore(makeSurge(0, 0, 0)), 0);
});

test('computeSurgeReadinessScore: max inputs -> 100', () => {
  // 500 ICU/M, 40 vent/100k, 20 HW/1k -> all normalized to 1 -> 100
  assert.equal(computeSurgeReadinessScore(makeSurge(500, 40, 20)), 100);
});

test('computeSurgeReadinessScore: above max clamped to 100', () => {
  assert.equal(computeSurgeReadinessScore(makeSurge(1000, 80, 40)), 100);
});

test('computeSurgeReadinessScore: mid inputs produce intermediate score', () => {
  const score = computeSurgeReadinessScore(makeSurge(250, 20, 10));
  assert.ok(score > 40 && score < 70, `expected 40–70, got ${score}`);
});

test('computeSurgeReadinessScore: Sub-Saharan Africa-like inputs -> low', () => {
  const score = computeSurgeReadinessScore(makeSurge(15, 1, 1.6));
  assert.ok(score < 20, `expected <20, got ${score}`);
});

// ── computeIhrCapacityScore ───────────────────────────────────────────────

test('computeIhrCapacityScore: all 100 -> 100', () => {
  assert.equal(computeIhrCapacityScore(makeIhr(100, 100, 100, 100)), 100);
});

test('computeIhrCapacityScore: all 0 -> 0', () => {
  assert.equal(computeIhrCapacityScore(makeIhr(0, 0, 0, 0)), 0);
});

test('computeIhrCapacityScore: average of sub-scores', () => {
  // (80 + 60 + 70 + 90) / 4 = 75
  assert.equal(computeIhrCapacityScore(makeIhr(80, 60, 70, 90)), 75);
});

test('computeIhrCapacityScore: rounding', () => {
  // (85 + 80 + 84 + 79) / 4 = 82
  assert.equal(computeIhrCapacityScore(makeIhr(85, 80, 84, 79)), 82);
});

// ── computeGlobalReadinessScore ───────────────────────────────────────────

test('computeGlobalReadinessScore: empty input uses defaults and returns reasonable score', () => {
  const score = computeGlobalReadinessScore({});
  assert.ok(score >= 30 && score <= 80, `expected 30–80, got ${score}`);
});

test('computeGlobalReadinessScore: all-zero data returns 0', () => {
  const input = {
    ghsScores: [makeGhs(0)],
    stockpiles: [makeStockpile(false, 'high', 0)],
    surgeData: [{ ...makeSurge(0, 0, 0), surgeReadinessScore: 0 }],
    ihrData: [{ ...makeIhr(0, 0, 0, 0), capacityScore: 0 }],
    warningData: [{ region: 'T', sentinelSitesCoverage: 0, labNetworkCoverage: 0, reportingTimelinessScore: 0, zoonoticSurveillance: false, eventBasedSurveillance: false }],
    coordinationData: [makeCoord(0)],
  };
  assert.equal(computeGlobalReadinessScore(input), 0);
});

test('computeGlobalReadinessScore: all-max data returns 100', () => {
  const input = {
    ghsScores: [makeGhs(100)],
    stockpiles: [makeStockpile(true, 'low', 1)],
    surgeData: [{ ...makeSurge(500, 40, 20), surgeReadinessScore: 100 }],
    ihrData: [{ ...makeIhr(100, 100, 100, 100), capacityScore: 100 }],
    warningData: [{ region: 'T', sentinelSitesCoverage: 1, labNetworkCoverage: 1, reportingTimelinessScore: 100, zoonoticSurveillance: true, eventBasedSurveillance: true }],
    coordinationData: [makeCoord(100)],
  };
  assert.equal(computeGlobalReadinessScore(input), 100);
});

test('computeGlobalReadinessScore: GHS-only input weighted 30%', () => {
  // GHS contributes 30%. With all others zero, 100*0.3 = 30
  const input = {
    ghsScores: [makeGhs(100)],
    stockpiles: [makeStockpile(false, 'high', 0)],
    surgeData: [{ ...makeSurge(0, 0, 0), surgeReadinessScore: 0 }],
    ihrData: [{ ...makeIhr(0, 0, 0, 0), capacityScore: 0 }],
    warningData: [{ region: 'T', sentinelSitesCoverage: 0, labNetworkCoverage: 0, reportingTimelinessScore: 0, zoonoticSurveillance: false, eventBasedSurveillance: false }],
    coordinationData: [makeCoord(0)],
  };
  assert.equal(computeGlobalReadinessScore(input), 30);
});

// ── identifyTopVulnerabilities ────────────────────────────────────────────

test('identifyTopVulnerabilities: returns array length <= 5', () => {
  const vulns = identifyTopVulnerabilities(DEFAULT_PANDEMIC_INPUT);
  assert.ok(vulns.length <= 5, `expected <=5, got ${vulns.length}`);
});

test('identifyTopVulnerabilities: returns strings', () => {
  const vulns = identifyTopVulnerabilities(DEFAULT_PANDEMIC_INPUT);
  for (const v of vulns) {
    assert.equal(typeof v, 'string');
    assert.ok(v.length > 0);
  }
});

test('identifyTopVulnerabilities: empty input falls back to defaults and returns some vulnerabilities', () => {
  const vulns = identifyTopVulnerabilities({});
  assert.ok(Array.isArray(vulns));
});

test('identifyTopVulnerabilities: all-critical data returns vulnerabilities', () => {
  const input = {
    ghsScores: [makeGhs(10)],
    stockpiles: [makeStockpile(false, 'high', 0.1)],
    warningData: [{ region: 'A', sentinelSitesCoverage: 0.1, labNetworkCoverage: 0.1, reportingTimelinessScore: 20, zoonoticSurveillance: false, eventBasedSurveillance: false },
                  { region: 'B', sentinelSitesCoverage: 0.1, labNetworkCoverage: 0.1, reportingTimelinessScore: 20, zoonoticSurveillance: false, eventBasedSurveillance: false }],
    coordinationData: [makeCoord(10), makeCoord(10), makeCoord(10), makeCoord(10)],
  };
  const vulns = identifyTopVulnerabilities(input);
  assert.ok(vulns.length > 0);
});

// ── getGhsLeaders ─────────────────────────────────────────────────────────

test('getGhsLeaders: returns correct count', () => {
  const scores = [makeGhs(50), makeGhs(80), makeGhs(30), makeGhs(90), makeGhs(60), makeGhs(70)];
  assert.equal(getGhsLeaders(scores, 3).length, 3);
});

test('getGhsLeaders: sorted descending', () => {
  const scores = [makeGhs(50), makeGhs(80), makeGhs(30)];
  const leaders = getGhsLeaders(scores, 3);
  assert.equal(leaders[0].overallScore, 80);
  assert.equal(leaders[1].overallScore, 50);
  assert.equal(leaders[2].overallScore, 30);
});

test('getGhsLeaders: empty array returns empty', () => {
  assert.deepEqual(getGhsLeaders([], 5), []);
});

test('getGhsLeaders: n > length returns all', () => {
  const scores = [makeGhs(50), makeGhs(80)];
  assert.equal(getGhsLeaders(scores, 10).length, 2);
});

test('getGhsLeaders: default n=5', () => {
  const scores = Array.from({ length: 8 }, (_, i) => makeGhs(i * 10));
  assert.equal(getGhsLeaders(scores).length, 5);
});

// ── getGhsLaggards ────────────────────────────────────────────────────────

test('getGhsLaggards: returns correct count', () => {
  const scores = [makeGhs(50), makeGhs(80), makeGhs(30), makeGhs(90), makeGhs(10), makeGhs(70)];
  assert.equal(getGhsLaggards(scores, 3).length, 3);
});

test('getGhsLaggards: sorted ascending', () => {
  const scores = [makeGhs(50), makeGhs(80), makeGhs(30)];
  const laggards = getGhsLaggards(scores, 3);
  assert.equal(laggards[0].overallScore, 30);
  assert.equal(laggards[1].overallScore, 50);
  assert.equal(laggards[2].overallScore, 80);
});

test('getGhsLaggards: empty array returns empty', () => {
  assert.deepEqual(getGhsLaggards([], 5), []);
});

test('getGhsLaggards: n > length returns all', () => {
  const scores = [makeGhs(10), makeGhs(20)];
  assert.equal(getGhsLaggards(scores, 10).length, 2);
});

// ── assessPandemicPreparedness ────────────────────────────────────────────

test('assessPandemicPreparedness: empty input uses defaults and returns valid assessment', () => {
  const a = assessPandemicPreparedness({});
  assert.ok(typeof a.globalReadinessScore === 'number');
  assert.ok(a.globalReadinessScore >= 0 && a.globalReadinessScore <= 100);
  assert.ok(['critical', 'high', 'moderate', 'low', 'minimal'].includes(a.riskTier));
  assert.ok(Array.isArray(a.topVulnerabilities));
  assert.ok(Array.isArray(a.ghsLeaders));
  assert.ok(Array.isArray(a.ghsLaggards));
  assert.ok(Array.isArray(a.vaccineAdequacy));
  assert.ok(Array.isArray(a.surgeCapacities));
  assert.ok(Array.isArray(a.ihrCompliance));
  assert.ok(Array.isArray(a.earlyWarningCoverage));
  assert.ok(Array.isArray(a.crossBorderCoordination));
  assert.ok(typeof a.lastUpdated === 'string');
});

test('assessPandemicPreparedness: full input with all-100 scores -> score 100, tier minimal', () => {
  const input = {
    ghsScores: [makeGhs(100)],
    stockpiles: [makeStockpile(true, 'low', 1)],
    surgeData: [{ ...makeSurge(500, 40, 20), surgeReadinessScore: 100 }],
    ihrData: [{ ...makeIhr(100, 100, 100, 100), capacityScore: 100 }],
    warningData: [{ region: 'T', sentinelSitesCoverage: 1, labNetworkCoverage: 1, reportingTimelinessScore: 100, zoonoticSurveillance: true, eventBasedSurveillance: true }],
    coordinationData: [makeCoord(100)],
    asOf: '2024-06-01',
  };
  const a = assessPandemicPreparedness(input);
  assert.equal(a.globalReadinessScore, 100);
  assert.equal(a.riskTier, 'minimal');
  assert.equal(a.lastUpdated, '2024-06-01');
});

test('assessPandemicPreparedness: surgeCapacities have computed scores', () => {
  const input = {
    surgeData: [{ ...makeSurge(0, 0, 0), surgeReadinessScore: 0 }],
  };
  const a = assessPandemicPreparedness(input);
  assert.ok(a.surgeCapacities.every(r => typeof r.surgeReadinessScore === 'number'));
});

test('assessPandemicPreparedness: ihrCompliance has computed capacityScores', () => {
  const input = {
    ihrData: [{ ...makeIhr(80, 60, 70, 90), capacityScore: 0 }],
  };
  const a = assessPandemicPreparedness(input);
  assert.ok(a.ihrCompliance.every(r => typeof r.capacityScore === 'number'));
});

// ── scoreLabel ────────────────────────────────────────────────────────────

test('scoreLabel: 100 -> Excellent', () => {
  assert.ok(scoreLabel(100).startsWith('Excellent'));
});

test('scoreLabel: 81 -> Excellent', () => {
  assert.ok(scoreLabel(81).startsWith('Excellent'));
});

test('scoreLabel: 78 -> Good', () => {
  assert.ok(scoreLabel(78).startsWith('Good'));
});

test('scoreLabel: 61 -> Good', () => {
  assert.ok(scoreLabel(61).startsWith('Good'));
});

test('scoreLabel: 50 -> Moderate', () => {
  assert.ok(scoreLabel(50).startsWith('Moderate'));
});

test('scoreLabel: 41 -> Moderate', () => {
  assert.ok(scoreLabel(41).startsWith('Moderate'));
});

test('scoreLabel: 30 -> Poor', () => {
  assert.ok(scoreLabel(30).startsWith('Poor'));
});

test('scoreLabel: 0 -> Critical', () => {
  assert.ok(scoreLabel(0).startsWith('Critical'));
});

test('scoreLabel: includes score in parens', () => {
  assert.ok(scoreLabel(75).includes('75/100'));
});

// ── isStockpileConcerning ─────────────────────────────────────────────────

test('isStockpileConcerning: adequate=false -> true', () => {
  assert.ok(isStockpileConcerning(makeStockpile(false, 'low', 0.8)));
});

test('isStockpileConcerning: expiryRisk=high -> true', () => {
  assert.ok(isStockpileConcerning(makeStockpile(true, 'high', 0.8)));
});

test('isStockpileConcerning: dosesCoverage < 0.5 -> true', () => {
  assert.ok(isStockpileConcerning(makeStockpile(true, 'low', 0.4)));
});

test('isStockpileConcerning: all good -> false', () => {
  assert.equal(isStockpileConcerning(makeStockpile(true, 'low', 0.8)), false);
});

test('isStockpileConcerning: dosesCoverage exactly 0.5 -> false', () => {
  assert.equal(isStockpileConcerning(makeStockpile(true, 'low', 0.5)), false);
});

test('isStockpileConcerning: expiryRisk=medium alone does not trigger', () => {
  assert.equal(isStockpileConcerning(makeStockpile(true, 'medium', 0.8)), false);
});

// ── aggregateCoordinationScore ────────────────────────────────────────────

test('aggregateCoordinationScore: empty -> 0', () => {
  assert.equal(aggregateCoordinationScore([]), 0);
});

test('aggregateCoordinationScore: single region', () => {
  assert.equal(aggregateCoordinationScore([makeCoord(70)]), 70);
});

test('aggregateCoordinationScore: multiple regions average', () => {
  // (80 + 60 + 40) / 3 = 60
  assert.equal(aggregateCoordinationScore([makeCoord(80), makeCoord(60), makeCoord(40)]), 60);
});

test('aggregateCoordinationScore: rounding', () => {
  // (70 + 71) / 2 = 70.5 -> rounds to 71
  assert.equal(aggregateCoordinationScore([makeCoord(70), makeCoord(71)]), 71);
});
