import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  scoreChokepointRisk,
  calculateOPECCompliance,
  assessPipelineDisruption,
  estimateLNGStress,
  scoreSanctionsLeverage,
  classifyWeaponizationRisk,
  classifyReserveStatus,
  buildEnergyGeopoliticsRenderData,
  getRiskColor,
  getWeaponizationColor,
  getLNGStressColor,
  getReserveStatusColor,
  formatMbpd,
  formatScore,
  formatComplianceRate,
  getNonCompliantMembers,
  getChokepointsByRisk,
  getWeaponizationByScore,
  totalOilAtRisk,
  CHOKEPOINT_DATA,
  OPEC_MEMBERS,
  PIPELINE_INCIDENTS,
  SANCTIONS_DATA,
  STRATEGIC_RESERVES,
  WEAPONIZATION_DATA,
} from '../energy-geopolitics-helpers.ts';

// ── CHOKEPOINT_DATA ──────────────────────────────────────────────────────────

describe('CHOKEPOINT_DATA', () => {
  it('contains exactly 5 chokepoints', () => {
    assert.equal(CHOKEPOINT_DATA.length, 5);
  });

  it('includes hormuz', () => {
    assert.ok(CHOKEPOINT_DATA.some((c) => c.id === 'hormuz'));
  });

  it('includes bab_el_mandeb', () => {
    assert.ok(CHOKEPOINT_DATA.some((c) => c.id === 'bab_el_mandeb'));
  });

  it('includes malacca', () => {
    assert.ok(CHOKEPOINT_DATA.some((c) => c.id === 'malacca'));
  });

  it('oilFlowMbpd is positive for all chokepoints', () => {
    for (const c of CHOKEPOINT_DATA) {
      assert.ok(c.oilFlowMbpd > 0, `${c.id} has non-positive flow`);
    }
  });

  it('tensionScore is in [0, 1] for all chokepoints', () => {
    for (const c of CHOKEPOINT_DATA) {
      assert.ok(c.tensionScore >= 0 && c.tensionScore <= 1, `${c.id} tensionScore out of range`);
    }
  });

  it('closureProbability90d is in [0, 1]', () => {
    for (const c of CHOKEPOINT_DATA) {
      assert.ok(c.closureProbability90d >= 0 && c.closureProbability90d <= 1);
    }
  });
});

// ── scoreChokepointRisk ──────────────────────────────────────────────────────

describe('scoreChokepointRisk', () => {
  it('returns value in [0, 100]', () => {
    for (const c of CHOKEPOINT_DATA) {
      const score = scoreChokepointRisk(c);
      assert.ok(score >= 0 && score <= 100, `${c.id} score ${score} out of range`);
    }
  });

  it('higher tension yields higher score (all else equal)', () => {
    const base = { ...CHOKEPOINT_DATA[0]!, activeIncidents: 0, closureProbability90d: 0 };
    const highTension = { ...base, tensionScore: 0.9 };
    const lowTension = { ...base, tensionScore: 0.1 };
    assert.ok(scoreChokepointRisk(highTension) > scoreChokepointRisk(lowTension));
  });

  it('more incidents yields higher score', () => {
    const base = { ...CHOKEPOINT_DATA[0]!, tensionScore: 0.5, closureProbability90d: 0 };
    const many = { ...base, activeIncidents: 10 };
    const none = { ...base, activeIncidents: 0 };
    assert.ok(scoreChokepointRisk(many) > scoreChokepointRisk(none));
  });

  it('bab_el_mandeb scores higher than bosphorus (more tension + incidents)', () => {
    const bab = CHOKEPOINT_DATA.find((c) => c.id === 'bab_el_mandeb')!;
    const bos = CHOKEPOINT_DATA.find((c) => c.id === 'bosphorus')!;
    assert.ok(scoreChokepointRisk(bab) > scoreChokepointRisk(bos));
  });

  it('zero tension, zero incidents, zero closure = score 0', () => {
    const score = scoreChokepointRisk({
      id: 'hormuz', name: 'X', location: 'X',
      oilFlowMbpd: 10, gasFlowBcfd: 1,
      tensionScore: 0, riskLevel: 'low', activeIncidents: 0,
      closureProbability90d: 0, alternateRouteAvailable: true,
      alternateRouteCostMultiplier: 1, keyThreats: [],
    });
    assert.equal(score, 0);
  });
});

// ── calculateOPECCompliance ──────────────────────────────────────────────────

describe('calculateOPECCompliance', () => {
  it('returns correct shape', () => {
    const result = calculateOPECCompliance(OPEC_MEMBERS);
    assert.ok(typeof result.overallComplianceRate === 'number');
    assert.ok(typeof result.cohesionScore === 'number');
    assert.ok(typeof result.productionGapMbpd === 'number');
    assert.ok(Array.isArray(result.members));
  });

  it('overallComplianceRate is in [0, 1]', () => {
    const { overallComplianceRate } = calculateOPECCompliance(OPEC_MEMBERS);
    assert.ok(overallComplianceRate >= 0 && overallComplianceRate <= 1);
  });

  it('cohesionScore is in [0, 100]', () => {
    const { cohesionScore } = calculateOPECCompliance(OPEC_MEMBERS);
    assert.ok(cohesionScore >= 0 && cohesionScore <= 100);
  });

  it('empty array returns default values', () => {
    const result = calculateOPECCompliance([]);
    assert.equal(result.overallComplianceRate, 1);
    assert.equal(result.cohesionScore, 100);
    assert.equal(result.productionGapMbpd, 0);
  });

  it('all-compliant members yield compliance rate 1', () => {
    const all = OPEC_MEMBERS.map((m) => ({ ...m, status: 'compliant' as const, complianceRate: 1.0 }));
    const { overallComplianceRate } = calculateOPECCompliance(all);
    assert.equal(overallComplianceRate, 1);
  });

  it('productionGapMbpd equals actual minus quota total', () => {
    const members = [
      { name: 'A', code: 'A', quotaMbpd: 3.0, actualMbpd: 3.5, status: 'over_producing' as const, complianceRate: 0.85, strategicAlignment: 'core' as const },
      { name: 'B', code: 'B', quotaMbpd: 2.0, actualMbpd: 2.0, status: 'compliant' as const, complianceRate: 1.0, strategicAlignment: 'core' as const },
    ];
    const { productionGapMbpd } = calculateOPECCompliance(members);
    assert.ok(Math.abs(productionGapMbpd - 0.5) < 0.01);
  });

  it('cohesionTrend is one of improving/stable/deteriorating', () => {
    const valid = new Set(['improving', 'stable', 'deteriorating']);
    const { cohesionTrend } = calculateOPECCompliance(OPEC_MEMBERS);
    assert.ok(valid.has(cohesionTrend), `Unknown trend: ${cohesionTrend}`);
  });
});

// ── assessPipelineDisruption ─────────────────────────────────────────────────

describe('assessPipelineDisruption', () => {
  it('returns correct shape', () => {
    const result = assessPipelineDisruption(PIPELINE_INCIDENTS);
    assert.ok(typeof result.totalAffectedMbpd === 'number');
    assert.ok(typeof result.averageSeverity === 'number');
    assert.ok(typeof result.activeDisruptionCount === 'number');
    assert.ok(Array.isArray(result.criticalIncidents));
  });

  it('empty array returns zeros', () => {
    const result = assessPipelineDisruption([]);
    assert.equal(result.totalAffectedMbpd, 0);
    assert.equal(result.averageSeverity, 0);
    assert.equal(result.activeDisruptionCount, 0);
    assert.equal(result.criticalIncidents.length, 0);
  });

  it('operational incidents are excluded', () => {
    const incidents = [
      { id: 'a', name: 'A', region: 'X', status: 'operational' as const, capacityMbpd: 1, affectedCapacityMbpd: 0, causeCategory: 'technical' as const, daysSinceOnset: 0, expectedResolutionDays: null, severityScore: 0 },
      { id: 'b', name: 'B', region: 'X', status: 'disrupted' as const, capacityMbpd: 1, affectedCapacityMbpd: 0.4, causeCategory: 'sabotage' as const, daysSinceOnset: 10, expectedResolutionDays: null, severityScore: 70 },
    ];
    const result = assessPipelineDisruption(incidents);
    assert.equal(result.activeDisruptionCount, 1);
  });

  it('criticalIncidents are those with severityScore >= 60', () => {
    const result = assessPipelineDisruption(PIPELINE_INCIDENTS);
    for (const ci of result.criticalIncidents) {
      assert.ok(ci.severityScore >= 60);
    }
  });

  it('totalAffectedMbpd sums only non-operational incidents', () => {
    const incidents = PIPELINE_INCIDENTS.filter((p) => p.status !== 'operational');
    const expected = incidents.reduce((s, i) => s + i.affectedCapacityMbpd, 0);
    const result = assessPipelineDisruption(PIPELINE_INCIDENTS);
    assert.ok(Math.abs(result.totalAffectedMbpd - Math.round(expected * 100) / 100) < 0.01);
  });
});

// ── estimateLNGStress ────────────────────────────────────────────────────────

describe('estimateLNGStress', () => {
  it('returns a valid stress level', () => {
    const valid = new Set(['normal', 'elevated', 'stressed', 'crisis']);
    const result = estimateLNGStress({ chokepoints: CHOKEPOINT_DATA, pipelineDisruptions: PIPELINE_INCIDENTS, seasonalDemandMultiplier: 1.0 });
    assert.ok(valid.has(result.overallStressLevel));
  });

  it('stressScore is in [0, 100]', () => {
    const result = estimateLNGStress({ chokepoints: CHOKEPOINT_DATA, pipelineDisruptions: PIPELINE_INCIDENTS, seasonalDemandMultiplier: 1.0 });
    assert.ok(result.stressScore >= 0 && result.stressScore <= 100);
  });

  it('spotPremiumMultiplier >= 1', () => {
    const result = estimateLNGStress({ chokepoints: CHOKEPOINT_DATA, pipelineDisruptions: [], seasonalDemandMultiplier: 1.0 });
    assert.ok(result.spotPremiumMultiplier >= 1);
  });

  it('seasonal multiplier 1.3 increases stress vs 1.0', () => {
    const normal = estimateLNGStress({ chokepoints: [], pipelineDisruptions: [], seasonalDemandMultiplier: 1.0 });
    const peak = estimateLNGStress({ chokepoints: [], pipelineDisruptions: [], seasonalDemandMultiplier: 1.3 });
    assert.ok(peak.stressScore >= normal.stressScore);
  });

  it('no chokepoints and no disruptions with multiplier 1.0 = normal', () => {
    const result = estimateLNGStress({ chokepoints: [], pipelineDisruptions: [], seasonalDemandMultiplier: 1.0 });
    assert.equal(result.overallStressLevel, 'normal');
    assert.equal(result.stressScore, 0);
  });

  it('majorSuppliers has at least 3 entries', () => {
    const result = estimateLNGStress({ chokepoints: CHOKEPOINT_DATA, pipelineDisruptions: [], seasonalDemandMultiplier: 1.0 });
    assert.ok(result.majorSuppliers.length >= 3);
  });
});

// ── scoreSanctionsLeverage ───────────────────────────────────────────────────

describe('scoreSanctionsLeverage', () => {
  it('returns a non-negative number', () => {
    for (const s of SANCTIONS_DATA) {
      assert.ok(scoreSanctionsLeverage(s) >= 0);
    }
  });

  it('high evasion reduces effective leverage', () => {
    const base = { ...SANCTIONS_DATA[0]!, leverageScore: 60 };
    const highEvasion = { ...base, evadedPercentage: 0.9, bypassMechanismsActive: 1 };
    const lowEvasion = { ...base, evadedPercentage: 0.1, bypassMechanismsActive: 1 };
    assert.ok(scoreSanctionsLeverage(lowEvasion) > scoreSanctionsLeverage(highEvasion));
  });

  it('more bypass mechanisms reduce score', () => {
    const base = { ...SANCTIONS_DATA[0]!, evadedPercentage: 0.1 };
    const manyBypass = { ...base, bypassMechanismsActive: 10 };
    const fewBypass = { ...base, bypassMechanismsActive: 0 };
    assert.ok(scoreSanctionsLeverage(fewBypass) >= scoreSanctionsLeverage(manyBypass));
  });

  it('score never goes below 0', () => {
    const worstCase = { ...SANCTIONS_DATA[0]!, leverageScore: 0, evadedPercentage: 1, bypassMechanismsActive: 100 };
    assert.equal(scoreSanctionsLeverage(worstCase), 0);
  });
});

// ── classifyWeaponizationRisk ────────────────────────────────────────────────

describe('classifyWeaponizationRisk', () => {
  it('returns a valid tier', () => {
    const valid = new Set(['low', 'moderate', 'high', 'extreme']);
    const result = classifyWeaponizationRisk({ exportShare: 0.1, politicalWill: 0.8, economicDependence: 0.4, historicalPrecedent: true });
    assert.ok(valid.has(result.tier));
  });

  it('score is in [0, 100]', () => {
    const result = classifyWeaponizationRisk({ exportShare: 0.1, politicalWill: 0.8, economicDependence: 0.4, historicalPrecedent: true });
    assert.ok(result.score >= 0 && result.score <= 100);
  });

  it('all-zeros inputs yield low tier', () => {
    const { tier } = classifyWeaponizationRisk({ exportShare: 0, politicalWill: 0, economicDependence: 0, historicalPrecedent: false });
    assert.equal(tier, 'low');
  });

  it('max inputs yield extreme tier', () => {
    const { tier } = classifyWeaponizationRisk({ exportShare: 1, politicalWill: 1, economicDependence: 1, historicalPrecedent: true });
    assert.equal(tier, 'extreme');
  });

  it('historicalPrecedent adds to score', () => {
    const base = { exportShare: 0.05, politicalWill: 0.5, economicDependence: 0.3 };
    const with_hist = classifyWeaponizationRisk({ ...base, historicalPrecedent: true });
    const without_hist = classifyWeaponizationRisk({ ...base, historicalPrecedent: false });
    assert.ok(with_hist.score >= without_hist.score);
  });
});

// ── classifyReserveStatus ────────────────────────────────────────────────────

describe('classifyReserveStatus', () => {
  it('90+ days and 70%+ fill = adequate', () => {
    const status = classifyReserveStatus({ nation: 'X', coverageDays: 90, iea_member: true, fillLevelPercent: 70, status: 'adequate', trend: 'stable' });
    assert.equal(status, 'adequate');
  });

  it('60 days and 50% fill = watch', () => {
    const status = classifyReserveStatus({ nation: 'X', coverageDays: 60, iea_member: true, fillLevelPercent: 50, status: 'watch', trend: 'stable' });
    assert.equal(status, 'watch');
  });

  it('30 days and 30% fill = warning', () => {
    const status = classifyReserveStatus({ nation: 'X', coverageDays: 30, iea_member: false, fillLevelPercent: 30, status: 'warning', trend: 'stable' });
    assert.equal(status, 'warning');
  });

  it('10 days and 20% fill = critical', () => {
    const status = classifyReserveStatus({ nation: 'X', coverageDays: 10, iea_member: false, fillLevelPercent: 20, status: 'critical', trend: 'drawing_down' });
    assert.equal(status, 'critical');
  });
});

// ── buildEnergyGeopoliticsRenderData ────────────────────────────────────────

describe('buildEnergyGeopoliticsRenderData', () => {
  it('returns an object with expected top-level fields', () => {
    const data = buildEnergyGeopoliticsRenderData();
    assert.ok(typeof data === 'object' && data !== null);
    assert.ok(Array.isArray(data.chokepoints));
    assert.ok(typeof data.opec === 'object');
    assert.ok(Array.isArray(data.pipelines));
    assert.ok(typeof data.lng === 'object');
    assert.ok(Array.isArray(data.sanctions));
    assert.ok(Array.isArray(data.reserves));
    assert.ok(Array.isArray(data.weaponization));
  });

  it('overallRiskScore is in [0, 100]', () => {
    const { overallRiskScore } = buildEnergyGeopoliticsRenderData();
    assert.ok(overallRiskScore >= 0 && overallRiskScore <= 100);
  });

  it('overallRiskLevel is a valid risk level', () => {
    const valid = new Set(['low', 'medium', 'high', 'critical']);
    assert.ok(valid.has(buildEnergyGeopoliticsRenderData().overallRiskLevel));
  });

  it('topRisks is an array', () => {
    assert.ok(Array.isArray(buildEnergyGeopoliticsRenderData().topRisks));
  });

  it('chokepoints has 5 entries', () => {
    assert.equal(buildEnergyGeopoliticsRenderData().chokepoints.length, 5);
  });

  it('weaponization has 6 entries', () => {
    assert.equal(buildEnergyGeopoliticsRenderData().weaponization.length, 6);
  });

  it('asOf is an ISO date string', () => {
    const { asOf } = buildEnergyGeopoliticsRenderData();
    assert.ok(typeof asOf === 'string' && !Number.isNaN(Date.parse(asOf)));
  });
});

// ── getRiskColor ─────────────────────────────────────────────────────────────

describe('getRiskColor', () => {
  it('low and critical return different colors', () => {
    assert.notEqual(getRiskColor('low'), getRiskColor('critical'));
  });

  it('returns a string for all valid levels', () => {
    for (const level of ['low', 'medium', 'high', 'critical']) {
      assert.equal(typeof getRiskColor(level), 'string');
    }
  });

  it('unknown level returns gray', () => {
    assert.equal(getRiskColor('unknown'), '#6b7280');
  });

  it('critical returns a red-ish color', () => {
    assert.ok(getRiskColor('critical').startsWith('#'));
  });
});

// ── getWeaponizationColor ────────────────────────────────────────────────────

describe('getWeaponizationColor', () => {
  it('extreme returns different color than low', () => {
    assert.notEqual(getWeaponizationColor('extreme'), getWeaponizationColor('low'));
  });

  it('unknown level returns gray', () => {
    assert.equal(getWeaponizationColor('zz'), '#6b7280');
  });
});

// ── getLNGStressColor ────────────────────────────────────────────────────────

describe('getLNGStressColor', () => {
  it('normal and crisis return different colors', () => {
    assert.notEqual(getLNGStressColor('normal'), getLNGStressColor('crisis'));
  });

  it('unknown returns gray', () => {
    assert.equal(getLNGStressColor('unknown'), '#6b7280');
  });
});

// ── getReserveStatusColor ────────────────────────────────────────────────────

describe('getReserveStatusColor', () => {
  it('adequate returns green-ish', () => {
    assert.ok(getReserveStatusColor('adequate').startsWith('#'));
  });

  it('critical returns red-ish', () => {
    assert.ok(getReserveStatusColor('critical').startsWith('#'));
  });

  it('adequate and critical return different colors', () => {
    assert.notEqual(getReserveStatusColor('adequate'), getReserveStatusColor('critical'));
  });
});

// ── formatMbpd / formatScore / formatComplianceRate ──────────────────────────

describe('formatMbpd', () => {
  it('formats 21.0 as "21.0 Mb/d"', () => {
    assert.equal(formatMbpd(21.0), '21.0 Mb/d');
  });

  it('formats 3.25 as "3.3 Mb/d" (1 decimal)', () => {
    assert.equal(formatMbpd(3.25), '3.3 Mb/d');
  });
});

describe('formatScore', () => {
  it('formatScore(72) === "72/100"', () => {
    assert.equal(formatScore(72), '72/100');
  });

  it('formatScore(0) === "0/100"', () => {
    assert.equal(formatScore(0), '0/100');
  });

  it('formatScore(100) === "100/100"', () => {
    assert.equal(formatScore(100), '100/100');
  });
});

describe('formatComplianceRate', () => {
  it('formats 1.0 as "100%"', () => {
    assert.equal(formatComplianceRate(1.0), '100%');
  });

  it('formats 0.84 as "84%"', () => {
    assert.equal(formatComplianceRate(0.84), '84%');
  });

  it('formats 0.0 as "0%"', () => {
    assert.equal(formatComplianceRate(0.0), '0%');
  });
});

// ── getNonCompliantMembers ───────────────────────────────────────────────────

describe('getNonCompliantMembers', () => {
  it('excludes compliant members', () => {
    const result = getNonCompliantMembers(OPEC_MEMBERS);
    for (const m of result) {
      assert.notEqual(m.status, 'compliant');
    }
  });

  it('sorted by complianceRate ascending', () => {
    const result = getNonCompliantMembers(OPEC_MEMBERS);
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i]!.complianceRate >= result[i - 1]!.complianceRate);
    }
  });

  it('returns empty array for all-compliant members', () => {
    const allCompliant = OPEC_MEMBERS.map((m) => ({ ...m, status: 'compliant' as const }));
    assert.equal(getNonCompliantMembers(allCompliant).length, 0);
  });
});

// ── getChokepointsByRisk ─────────────────────────────────────────────────────

describe('getChokepointsByRisk', () => {
  it('returns same length as input', () => {
    assert.equal(getChokepointsByRisk(CHOKEPOINT_DATA).length, CHOKEPOINT_DATA.length);
  });

  it('sorted descending by risk score', () => {
    const sorted = getChokepointsByRisk(CHOKEPOINT_DATA);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(
        scoreChokepointRisk(sorted[i - 1]!) >= scoreChokepointRisk(sorted[i]!),
        `Index ${i - 1} score should be >= index ${i} score`,
      );
    }
  });

  it('does not mutate original array', () => {
    const original = [...CHOKEPOINT_DATA];
    getChokepointsByRisk(CHOKEPOINT_DATA);
    assert.deepEqual(CHOKEPOINT_DATA.map((c) => c.id), original.map((c) => c.id));
  });
});

// ── getWeaponizationByScore ──────────────────────────────────────────────────

describe('getWeaponizationByScore', () => {
  it('returns same length as input', () => {
    assert.equal(getWeaponizationByScore(WEAPONIZATION_DATA).length, WEAPONIZATION_DATA.length);
  });

  it('sorted descending by weaponizationScore', () => {
    const sorted = getWeaponizationByScore(WEAPONIZATION_DATA);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i - 1]!.weaponizationScore >= sorted[i]!.weaponizationScore);
    }
  });

  it('first entry has highest score', () => {
    const sorted = getWeaponizationByScore(WEAPONIZATION_DATA);
    const maxScore = Math.max(...WEAPONIZATION_DATA.map((w) => w.weaponizationScore));
    assert.equal(sorted[0]!.weaponizationScore, maxScore);
  });
});

// ── totalOilAtRisk ───────────────────────────────────────────────────────────

describe('totalOilAtRisk', () => {
  it('returns a non-negative number', () => {
    assert.ok(totalOilAtRisk(CHOKEPOINT_DATA) >= 0);
  });

  it('returns 0 for empty array', () => {
    assert.equal(totalOilAtRisk([]), 0);
  });

  it('returns 0 for all-low chokepoints', () => {
    const allLow = CHOKEPOINT_DATA.map((c) => ({ ...c, riskLevel: 'low' as const }));
    assert.equal(totalOilAtRisk(allLow), 0);
  });

  it('includes oil from high and critical chokepoints only', () => {
    const cp = [
      { ...CHOKEPOINT_DATA[0]!, riskLevel: 'critical' as const, oilFlowMbpd: 10 },
      { ...CHOKEPOINT_DATA[1]!, riskLevel: 'low' as const, oilFlowMbpd: 5 },
    ];
    const result = totalOilAtRisk(cp);
    assert.equal(result, 10);
  });
});

// ── OPEC_MEMBERS dataset ─────────────────────────────────────────────────────

describe('OPEC_MEMBERS', () => {
  it('has at least 6 members', () => {
    assert.ok(OPEC_MEMBERS.length >= 6);
  });

  it('includes Saudi Arabia', () => {
    assert.ok(OPEC_MEMBERS.some((m) => m.code === 'SA'));
  });

  it('includes Russia', () => {
    assert.ok(OPEC_MEMBERS.some((m) => m.code === 'RU'));
  });

  it('quotaMbpd is positive for all members', () => {
    for (const m of OPEC_MEMBERS) {
      assert.ok(m.quotaMbpd > 0, `${m.code} has non-positive quota`);
    }
  });
});

// ── WEAPONIZATION_DATA dataset ───────────────────────────────────────────────

describe('WEAPONIZATION_DATA', () => {
  it('has at least 5 entries', () => {
    assert.ok(WEAPONIZATION_DATA.length >= 5);
  });

  it('includes Russia', () => {
    assert.ok(WEAPONIZATION_DATA.some((w) => w.code === 'RU'));
  });

  it('weaponizationScore is in [0, 100] for all entries', () => {
    for (const w of WEAPONIZATION_DATA) {
      assert.ok(w.weaponizationScore >= 0 && w.weaponizationScore <= 100);
    }
  });

  it('exportShareOfWorldSupply is in [0, 1]', () => {
    for (const w of WEAPONIZATION_DATA) {
      assert.ok(w.exportShareOfWorldSupply >= 0 && w.exportShareOfWorldSupply <= 1);
    }
  });

  it('Russia has extreme tier', () => {
    const ru = WEAPONIZATION_DATA.find((w) => w.code === 'RU')!;
    assert.equal(ru.tier, 'extreme');
  });
});
