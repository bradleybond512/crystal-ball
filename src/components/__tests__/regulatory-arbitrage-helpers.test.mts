import assert from 'node:assert/strict';
import test from 'node:test';

import {
  // Opacity
  classifyOpacity,
  opacityTierColor,
  opacityTierLabel,
  computeOpacityScore,
  sortByOpacityDesc,
  countExtremeOpacityJurisdictions,
  // FATF
  fatfStatusColor,
  fatfStatusLabel,
  countFatfByStatus,
  highRiskFatfJurisdictions,
  averageComplianceScore,
  // Gaps
  gapSeverityColor,
  gapSeverityLabel,
  gapDomainLabel,
  countCriticalGaps,
  gapsByDomain,
  gapsUnderPressure,
  sortGapsBySeverityDesc,
  // Arbitrage
  computeArbitrageScore,
  classifyArbitrageRisk,
  arbitrageRiskColor,
  arbitrageRiskLabel,
  totalIllicitFlowsUsdBn,
  sortByArbitrageScoreDesc,
  // Enforcement
  enforcementTrendColor,
  enforcementTrendLabel,
  deriveTrend,
  totalPenaltiesUsdM,
  sortByPenaltiesDesc,
  regionsWithSurgingEnforcement,
  // Summary builder
  buildPanelSummary,
  // Seed data
  JURISDICTION_OPACITY,
  FATF_JURISDICTIONS,
  REGULATORY_GAPS,
  ARBITRAGE_EXPOSURE,
  ENFORCEMENT_REGIONS,
  // Types
  type OpacityTier,
  type FatfStatus,
  type GapSeverity,
  type GapDomain,
  type ArbitrageRisk,
  type EnforcementTrend,
} from '../regulatory-arbitrage-helpers.ts';

// ── classifyOpacity ──────────────────────────────────────────────────────

test('classifyOpacity: 0 → transparent', () => {
  assert.equal(classifyOpacity(0), 'transparent');
});
test('classifyOpacity: 19 → transparent', () => {
  assert.equal(classifyOpacity(19), 'transparent');
});
test('classifyOpacity: 20 → low', () => {
  assert.equal(classifyOpacity(20), 'low');
});
test('classifyOpacity: 59 → moderate', () => {
  assert.equal(classifyOpacity(59), 'moderate');
});
test('classifyOpacity: 79 → high', () => {
  assert.equal(classifyOpacity(79), 'high');
});
test('classifyOpacity: 100 → extreme', () => {
  assert.equal(classifyOpacity(100), 'extreme');
});

// ── opacityTierColor / opacityTierLabel ───────────────────────────────────

test('opacityTierColor returns a colour string for all tiers', () => {
  const tiers: OpacityTier[] = ['transparent', 'low', 'moderate', 'high', 'extreme'];
  for (const t of tiers) {
    const c = opacityTierColor(t);
    assert.ok(c.startsWith('#') || c.startsWith('var('), `bad colour for ${t}: ${c}`);
  }
});

test('opacityTierLabel extreme contains "Extreme"', () => {
  assert.match(opacityTierLabel('extreme'), /Extreme/);
});

test('opacityTierLabel transparent contains "Transparent"', () => {
  assert.match(opacityTierLabel('transparent'), /Transparent/);
});

// ── computeOpacityScore ───────────────────────────────────────────────────

test('computeOpacityScore: all red flags returns high score', () => {
  const score = computeOpacityScore({
    nomineeDirectorsAllowed: true,
    bearerSharesAllowed: true,
    publicRegistryExists: false,
    shellCompanyCount: 500,
  });
  assert.ok(score >= 75, `expected ≥75, got ${score}`);
});

test('computeOpacityScore: clean jurisdiction returns low score', () => {
  const score = computeOpacityScore({
    nomineeDirectorsAllowed: false,
    bearerSharesAllowed: false,
    publicRegistryExists: true,
    shellCompanyCount: 5,
  });
  assert.ok(score < 10, `expected <10, got ${score}`);
});

test('computeOpacityScore: capped at 100', () => {
  const score = computeOpacityScore({
    nomineeDirectorsAllowed: true,
    bearerSharesAllowed: true,
    publicRegistryExists: false,
    shellCompanyCount: 10000,
  });
  assert.ok(score <= 100);
});

// ── sortByOpacityDesc ────────────────────────────────────────────────────

test('sortByOpacityDesc: highest score first', () => {
  const sorted = sortByOpacityDesc(JURISDICTION_OPACITY);
  assert.ok(sorted[0].opacityScore >= sorted[sorted.length - 1].opacityScore);
});

// ── countExtremeOpacityJurisdictions ─────────────────────────────────────

test('countExtremeOpacityJurisdictions: seed data has at least one extreme', () => {
  assert.ok(countExtremeOpacityJurisdictions(JURISDICTION_OPACITY) >= 1);
});

test('countExtremeOpacityJurisdictions: returns 0 for empty', () => {
  assert.equal(countExtremeOpacityJurisdictions([]), 0);
});

// ── fatfStatusColor / fatfStatusLabel ─────────────────────────────────────

test('fatfStatusColor covers all FatfStatus values', () => {
  const statuses: FatfStatus[] = ['compliant', 'monitored', 'grey', 'black', 'unrated'];
  for (const s of statuses) {
    const c = fatfStatusColor(s);
    assert.ok(c.startsWith('#'), `bad colour for ${s}: ${c}`);
  }
});

test('fatfStatusLabel black returns "Black List"', () => {
  assert.equal(fatfStatusLabel('black'), 'Black List');
});

test('fatfStatusLabel grey returns "Grey List"', () => {
  assert.equal(fatfStatusLabel('grey'), 'Grey List');
});

// ── countFatfByStatus ─────────────────────────────────────────────────────

test('countFatfByStatus: seed data has black-listed jurisdictions', () => {
  assert.ok(countFatfByStatus(FATF_JURISDICTIONS, 'black') >= 1);
});

test('countFatfByStatus: zero for unrated in seed data', () => {
  // seed data does not include any unrated entries
  assert.equal(countFatfByStatus(FATF_JURISDICTIONS, 'unrated'), 0);
});

// ── highRiskFatfJurisdictions ─────────────────────────────────────────────

test('highRiskFatfJurisdictions: only grey or black', () => {
  const high = highRiskFatfJurisdictions(FATF_JURISDICTIONS);
  assert.ok(high.length > 0);
  for (const j of high) {
    assert.ok(j.status === 'grey' || j.status === 'black');
  }
});

// ── averageComplianceScore ────────────────────────────────────────────────

test('averageComplianceScore: within 0–100', () => {
  const avg = averageComplianceScore(FATF_JURISDICTIONS);
  assert.ok(avg >= 0 && avg <= 100, `avg out of range: ${avg}`);
});

test('averageComplianceScore: empty array returns 0', () => {
  assert.equal(averageComplianceScore([]), 0);
});

// ── gapSeverityColor / gapSeverityLabel / gapDomainLabel ─────────────────

test('gapSeverityColor covers all severities', () => {
  const severities: GapSeverity[] = ['negligible', 'minor', 'moderate', 'significant', 'critical'];
  for (const s of severities) {
    assert.ok(gapSeverityColor(s).startsWith('#'));
  }
});

test('gapDomainLabel: crypto returns "Crypto Regulation"', () => {
  assert.equal(gapDomainLabel('crypto'), 'Crypto Regulation');
});

test('gapDomainLabel: tax returns "Tax Haven"', () => {
  assert.equal(gapDomainLabel('tax'), 'Tax Haven');
});

// ── countCriticalGaps ─────────────────────────────────────────────────────

test('countCriticalGaps: seed data has critical/significant gaps', () => {
  assert.ok(countCriticalGaps(REGULATORY_GAPS) >= 1);
});

test('countCriticalGaps: empty array returns 0', () => {
  assert.equal(countCriticalGaps([]), 0);
});

// ── gapsByDomain ─────────────────────────────────────────────────────────

test('gapsByDomain: crypto filter only returns crypto', () => {
  const crypto = gapsByDomain(REGULATORY_GAPS, 'crypto');
  assert.ok(crypto.length >= 1);
  for (const g of crypto) {
    assert.equal(g.domain, 'crypto');
  }
});

// ── gapsUnderPressure ─────────────────────────────────────────────────────

test('gapsUnderPressure: all returned have closurePressure true', () => {
  const pressured = gapsUnderPressure(REGULATORY_GAPS);
  for (const g of pressured) {
    assert.ok(g.closurePressure);
  }
});

// ── sortGapsBySeverityDesc ────────────────────────────────────────────────

test('sortGapsBySeverityDesc: critical before negligible', () => {
  const sorted = sortGapsBySeverityDesc(REGULATORY_GAPS);
  assert.equal(sorted[0].severity, 'critical');
});

// ── computeArbitrageScore ─────────────────────────────────────────────────

test('computeArbitrageScore: zero inputs returns 0', () => {
  const score = computeArbitrageScore({ taxDifferentialPct: 0, cryptoGapScore: 0, dataGapScore: 0, financeGapScore: 0 });
  assert.equal(score, 0);
});

test('computeArbitrageScore: max inputs capped at 100', () => {
  const score = computeArbitrageScore({ taxDifferentialPct: 100, cryptoGapScore: 100, dataGapScore: 100, financeGapScore: 100 });
  assert.ok(score <= 100, `expected ≤100, got ${score}`);
});

test('computeArbitrageScore: high tax differential dominates', () => {
  const high = computeArbitrageScore({ taxDifferentialPct: 25, cryptoGapScore: 0, dataGapScore: 0, financeGapScore: 0 });
  const low  = computeArbitrageScore({ taxDifferentialPct: 2,  cryptoGapScore: 0, dataGapScore: 0, financeGapScore: 0 });
  assert.ok(high > low, `high (${high}) should exceed low (${low})`);
});

// ── classifyArbitrageRisk ─────────────────────────────────────────────────

test('classifyArbitrageRisk: 0 → low', () => {
  assert.equal(classifyArbitrageRisk(0), 'low');
});
test('classifyArbitrageRisk: 50 → high', () => {
  assert.equal(classifyArbitrageRisk(50), 'high');
});
test('classifyArbitrageRisk: 100 → extreme', () => {
  assert.equal(classifyArbitrageRisk(100), 'extreme');
});

// ── arbitrageRiskColor / arbitrageRiskLabel ───────────────────────────────

test('arbitrageRiskColor covers all ArbitrageRisk values', () => {
  const risks: ArbitrageRisk[] = ['low', 'medium', 'high', 'extreme'];
  for (const r of risks) {
    assert.ok(arbitrageRiskColor(r).startsWith('#'));
  }
});

test('arbitrageRiskLabel extreme contains "Extreme"', () => {
  assert.match(arbitrageRiskLabel('extreme'), /Extreme/);
});

// ── totalIllicitFlowsUsdBn ────────────────────────────────────────────────

test('totalIllicitFlowsUsdBn: seed data positive', () => {
  assert.ok(totalIllicitFlowsUsdBn(ARBITRAGE_EXPOSURE) > 0);
});

test('totalIllicitFlowsUsdBn: empty returns 0', () => {
  assert.equal(totalIllicitFlowsUsdBn([]), 0);
});

// ── sortByArbitrageScoreDesc ──────────────────────────────────────────────

test('sortByArbitrageScoreDesc: highest first', () => {
  const sorted = sortByArbitrageScoreDesc(ARBITRAGE_EXPOSURE);
  assert.ok(computeArbitrageScore(sorted[0]) >= computeArbitrageScore(sorted[sorted.length - 1]));
});

// ── deriveTrend ───────────────────────────────────────────────────────────

test('deriveTrend: 0→0 stable', () => {
  assert.equal(deriveTrend(0, 0), 'stable');
});
test('deriveTrend: 0→10 increasing', () => {
  assert.equal(deriveTrend(0, 10), 'increasing');
});
test('deriveTrend: 100→50 decreasing', () => {
  assert.equal(deriveTrend(100, 50), 'decreasing');
});
test('deriveTrend: 100→160 surge', () => {
  assert.equal(deriveTrend(100, 160), 'surge');
});
test('deriveTrend: 100→110 increasing', () => {
  assert.equal(deriveTrend(100, 110), 'increasing');
});

// ── enforcementTrendColor / enforcementTrendLabel ─────────────────────────

test('enforcementTrendColor covers all EnforcementTrend values', () => {
  const trends: EnforcementTrend[] = ['decreasing', 'stable', 'increasing', 'surge'];
  for (const t of trends) {
    assert.ok(enforcementTrendColor(t).startsWith('#'));
  }
});

test('enforcementTrendLabel surge returns "Surge"', () => {
  assert.equal(enforcementTrendLabel('surge'), 'Surge');
});

// ── totalPenaltiesUsdM ────────────────────────────────────────────────────

test('totalPenaltiesUsdM: seed data > 0', () => {
  assert.ok(totalPenaltiesUsdM(ENFORCEMENT_REGIONS) > 0);
});

test('totalPenaltiesUsdM: empty returns 0', () => {
  assert.equal(totalPenaltiesUsdM([]), 0);
});

// ── sortByPenaltiesDesc ───────────────────────────────────────────────────

test('sortByPenaltiesDesc: North America leads seed data', () => {
  const sorted = sortByPenaltiesDesc(ENFORCEMENT_REGIONS);
  assert.equal(sorted[0].region, 'North America');
});

// ── regionsWithSurgingEnforcement ─────────────────────────────────────────

test('regionsWithSurgingEnforcement: returns only increasing/surge', () => {
  const surging = regionsWithSurgingEnforcement(ENFORCEMENT_REGIONS);
  for (const r of surging) {
    assert.ok(r.trend === 'surge' || r.trend === 'increasing');
  }
});

// ── buildPanelSummary ─────────────────────────────────────────────────────

test('buildPanelSummary: returns valid summary from seed data', () => {
  const s = buildPanelSummary(
    JURISDICTION_OPACITY,
    FATF_JURISDICTIONS,
    REGULATORY_GAPS,
    ARBITRAGE_EXPOSURE,
    ENFORCEMENT_REGIONS,
  );
  assert.ok(s.extremeOpacityCount >= 0);
  assert.ok(s.fatfHighRiskCount   >= 0);
  assert.ok(s.criticalGapCount    >= 0);
  assert.ok(s.totalIllicitFlowsBn >= 0);
  assert.ok(s.totalPenaltiesM     >= 0);
  const validRisks: ArbitrageRisk[] = ['low', 'medium', 'high', 'extreme'];
  assert.ok(validRisks.includes(s.overallArbitrageRisk));
});

test('buildPanelSummary: empty inputs return low risk', () => {
  const s = buildPanelSummary([], [], [], [], []);
  assert.equal(s.overallArbitrageRisk, 'low');
  assert.equal(s.extremeOpacityCount, 0);
  assert.equal(s.totalIllicitFlowsBn, 0);
});

// ── Seed data integrity ───────────────────────────────────────────────────

test('JURISDICTION_OPACITY: all opacityScores in 0–100', () => {
  for (const j of JURISDICTION_OPACITY) {
    assert.ok(j.opacityScore >= 0 && j.opacityScore <= 100, `${j.jurisdiction}: ${j.opacityScore}`);
  }
});

test('FATF_JURISDICTIONS: all complianceScores in 0–100', () => {
  for (const j of FATF_JURISDICTIONS) {
    assert.ok(j.complianceScore >= 0 && j.complianceScore <= 100, `${j.jurisdiction}: ${j.complianceScore}`);
  }
});

test('ARBITRAGE_EXPOSURE: all cryptoGapScores in 0–100', () => {
  for (const e of ARBITRAGE_EXPOSURE) {
    assert.ok(e.cryptoGapScore >= 0 && e.cryptoGapScore <= 100);
  }
});

test('ENFORCEMENT_REGIONS: all have at least one activeBodies entry', () => {
  for (const r of ENFORCEMENT_REGIONS) {
    assert.ok(r.activeBodies.length >= 1, `${r.region} has no activeBodies`);
  }
});

test('REGULATORY_GAPS: identified years are plausible', () => {
  for (const g of REGULATORY_GAPS) {
    assert.ok(g.identifiedYear >= 1990 && g.identifiedYear <= 2030, `bad year for ${g.jurisdiction}: ${g.identifiedYear}`);
  }
});
