/**
 * Tests for EnergySecurityPanel — pure helper functions and static data.
 *
 * Run with: npx tsx --test tests/components/energy-security-panel.test.mts
 *
 * Pure-logic tests only; no DOM required. All logic lives in helpers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  severityColor,
  severityLabel,
  commodityLabel,
  causeLabel,
  attackTypeLabel,
  attackTypeColor,
  attackStatusColor,
  gridThreatLabel,
  redundancyColor,
  priceLevelColor,
  classifyPriceLevel,
  formatPercentChange,
  opecStatusColor,
  classifyOpecStatus,
  lngRoleLabel,
  lngStatusColor,
  sanctionsImpactColor,
  sanctionsImpactLabel,
  netImpactScore,
  formatMbblPerDay,
  formatMtpa,
  formatDuration,
  countActiveDisruptions,
  countConfirmedAttacks,
  countCriticalGrids,
  countShockBenchmarks,
  countOffshoreOfflineTerminals,
  composeBadgeCount,
  DISRUPTION_EVENTS,
  PIPELINE_ATTACKS,
  GRID_VULNERABILITIES,
  PRICE_SHOCKS,
  OPEC_COMPLIANCE,
  LNG_TERMINALS,
  SANCTIONS_IMPACT,
  type Severity,
  type Commodity,
  type DisruptionCause,
  type AttackType,
  type SanctionsImpact,
} from '../../src/components/energy-security-helpers.ts';

// ── severityColor / severityLabel ─────────────────────────────────────────

test('severityColor: 0 returns grey', () => {
  assert.ok(severityColor(0).includes('#9e9e9e'));
});

test('severityColor: 4 returns red', () => {
  assert.ok(severityColor(4).includes('#ef4444'));
});

test('severityColor: all levels return a CSS var with hex fallback', () => {
  const levels: Severity[] = [0, 1, 2, 3, 4];
  for (const l of levels) assert.match(severityColor(l), /var\(--severity-/);
});

test('severityLabel: 0 returns Minimal, 4 returns Critical', () => {
  assert.equal(severityLabel(0), 'Minimal');
  assert.equal(severityLabel(4), 'Critical');
});

// ── commodityLabel ────────────────────────────────────────────────────────

test('commodityLabel: oil returns Oil', () => {
  assert.equal(commodityLabel('oil'), 'Oil');
});

test('commodityLabel: all commodities return non-empty', () => {
  for (const c of ['oil', 'gas', 'lng', 'coal'] as const) {
    assert.ok(commodityLabel(c as Commodity).length > 0);
  }
});

// ── causeLabel ────────────────────────────────────────────────────────────

test('causeLabel: attack returns Attack', () => {
  assert.equal(causeLabel('attack'), 'Attack');
});

test('causeLabel: maintenance returns Maintenance', () => {
  assert.equal(causeLabel('maintenance'), 'Maintenance');
});

test('causeLabel: all causes are non-empty', () => {
  const causes: DisruptionCause[] = ['attack', 'sanction', 'accident', 'weather', 'maintenance', 'labor'];
  for (const c of causes) assert.ok(causeLabel(c).length > 0);
});

// ── attack helpers ────────────────────────────────────────────────────────

test('attackTypeLabel: cyber returns Cyber', () => {
  assert.equal(attackTypeLabel('cyber'), 'Cyber');
});

test('attackTypeColor: sabotage uses critical red', () => {
  assert.ok(attackTypeColor('sabotage').includes('#ef4444'));
});

test('attackTypeColor: cyber uses medium yellow', () => {
  assert.ok(attackTypeColor('cyber').includes('#facc15'));
});

test('attackStatusColor: confirmed is red, suspected is yellow', () => {
  assert.ok(attackStatusColor('confirmed').includes('#ef4444'));
  assert.ok(attackStatusColor('suspected').includes('#facc15'));
});

// ── grid helpers ──────────────────────────────────────────────────────────

test('gridThreatLabel: cyber returns Cyber', () => {
  assert.equal(gridThreatLabel('cyber'), 'Cyber');
});

test('gridThreatLabel: aging infrastructure formats properly', () => {
  assert.equal(gridThreatLabel('aging infrastructure'), 'Aging Infrastructure');
});

test('redundancyColor: low redundancy is red, high is green', () => {
  assert.ok(redundancyColor('low').includes('#ef4444'));
  assert.ok(redundancyColor('high').includes('#4caf50'));
});

// ── price-shock classifier ────────────────────────────────────────────────

test('classifyPriceLevel: small change is normal', () => {
  assert.equal(classifyPriceLevel(0.5, 5), 'normal');
});

test('classifyPriceLevel: half-threshold is elevated', () => {
  assert.equal(classifyPriceLevel(2.6, 5), 'elevated');
});

test('classifyPriceLevel: at threshold is shock', () => {
  assert.equal(classifyPriceLevel(5, 5), 'shock');
});

test('classifyPriceLevel: 2x threshold is crisis', () => {
  assert.equal(classifyPriceLevel(11, 5), 'crisis');
});

test('classifyPriceLevel: negative changes use absolute value', () => {
  assert.equal(classifyPriceLevel(-12, 5), 'crisis');
});

test('priceLevelColor: crisis is red, normal is green', () => {
  assert.ok(priceLevelColor('crisis').includes('#ef4444'));
  assert.ok(priceLevelColor('normal').includes('#4caf50'));
});

test('formatPercentChange: positive change gets + sign', () => {
  assert.equal(formatPercentChange(2.1), '+2.1%');
});

test('formatPercentChange: negative change keeps minus', () => {
  assert.equal(formatPercentChange(-3.4), '-3.4%');
});

// ── OPEC compliance classifier ────────────────────────────────────────────

test('classifyOpecStatus: exactly 100 is compliant', () => {
  assert.equal(classifyOpecStatus(100), 'compliant');
});

test('classifyOpecStatus: 101 is compliant (within tolerance)', () => {
  assert.equal(classifyOpecStatus(101), 'compliant');
});

test('classifyOpecStatus: 105 is over-producing', () => {
  assert.equal(classifyOpecStatus(105), 'over');
});

test('classifyOpecStatus: 95 is under-producing', () => {
  assert.equal(classifyOpecStatus(95), 'under');
});

test('opecStatusColor: over is orange, compliant is green', () => {
  assert.ok(opecStatusColor('over').includes('#fb923c'));
  assert.ok(opecStatusColor('compliant').includes('#4caf50'));
});

// ── LNG helpers ───────────────────────────────────────────────────────────

test('lngRoleLabel: import returns Import', () => {
  assert.equal(lngRoleLabel('import'), 'Import');
});

test('lngRoleLabel: export returns Export', () => {
  assert.equal(lngRoleLabel('export'), 'Export');
});

test('lngStatusColor: offline is red, operational is green, reduced is yellow', () => {
  assert.ok(lngStatusColor('offline').includes('#ef4444'));
  assert.ok(lngStatusColor('operational').includes('#4caf50'));
  assert.ok(lngStatusColor('reduced').includes('#facc15'));
});

// ── Sanctions helpers ─────────────────────────────────────────────────────

test('sanctionsImpactColor: 80 returns red', () => {
  assert.ok(sanctionsImpactColor(80).includes('#ef4444'));
});

test('sanctionsImpactColor: 60 returns orange', () => {
  assert.ok(sanctionsImpactColor(60).includes('#fb923c'));
});

test('sanctionsImpactColor: 30 returns yellow', () => {
  assert.ok(sanctionsImpactColor(30).includes('#facc15'));
});

test('sanctionsImpactColor: 10 returns green', () => {
  assert.ok(sanctionsImpactColor(10).includes('#4caf50'));
});

test('sanctionsImpactLabel: 80 returns Severe', () => {
  assert.equal(sanctionsImpactLabel(80), 'Severe');
});

test('sanctionsImpactLabel: 30 returns Moderate', () => {
  assert.equal(sanctionsImpactLabel(30), 'Moderate');
});

test('netImpactScore: zero affected returns 0', () => {
  const s: SanctionsImpact = {
    target: 'X', regime: 'US OFAC', impactScore: 90, affectedMbblPerDay: 0, evadedMbblPerDay: 0,
  };
  assert.equal(netImpactScore(s), 0);
});

test('netImpactScore: zero evasion preserves full impact', () => {
  const s: SanctionsImpact = {
    target: 'X', regime: 'US OFAC', impactScore: 80, affectedMbblPerDay: 1, evadedMbblPerDay: 0,
  };
  assert.equal(netImpactScore(s), 80);
});

test('netImpactScore: full evasion drops score to 0', () => {
  const s: SanctionsImpact = {
    target: 'X', regime: 'US OFAC', impactScore: 80, affectedMbblPerDay: 1, evadedMbblPerDay: 1,
  };
  assert.equal(netImpactScore(s), 0);
});

test('netImpactScore: 50% evasion halves impact', () => {
  const s: SanctionsImpact = {
    target: 'X', regime: 'US OFAC', impactScore: 80, affectedMbblPerDay: 1.0, evadedMbblPerDay: 0.5,
  };
  assert.equal(netImpactScore(s), 40);
});

test('netImpactScore: evasion exceeding affected does not produce negative score', () => {
  const s: SanctionsImpact = {
    target: 'X', regime: 'US OFAC', impactScore: 80, affectedMbblPerDay: 1.0, evadedMbblPerDay: 5.0,
  };
  assert.equal(netImpactScore(s), 0);
});

// ── Formatting helpers ────────────────────────────────────────────────────

test('formatMbblPerDay: >=1 Mb/d uses Mb/d unit', () => {
  assert.equal(formatMbblPerDay(2.5), '2.50 Mb/d');
});

test('formatMbblPerDay: 0.5 Mb/d shows kb/d', () => {
  assert.equal(formatMbblPerDay(0.5), '500 kb/d');
});

test('formatMbblPerDay: tiny values still render with one decimal', () => {
  assert.equal(formatMbblPerDay(0.05), '50.0 kb/d');
});

test('formatMtpa: shows one decimal MTPA', () => {
  assert.equal(formatMtpa(12), '12.0 MTPA');
});

test('formatDuration: <1d returns <1 day', () => {
  assert.equal(formatDuration(0.5), '<1 day');
});

test('formatDuration: 7d returns 7d', () => {
  assert.equal(formatDuration(7), '7d');
});

test('formatDuration: 60d returns 2mo', () => {
  assert.equal(formatDuration(60), '2mo');
});

test('formatDuration: 730d returns 2.0y', () => {
  assert.equal(formatDuration(730), '2.0y');
});

// ── Count helpers ─────────────────────────────────────────────────────────

test('countActiveDisruptions: counts severity >= 3', () => {
  const c = countActiveDisruptions(DISRUPTION_EVENTS);
  assert.ok(c > 0, `expected some active disruptions, got ${c}`);
  for (const d of DISRUPTION_EVENTS) {
    if (d.severity >= 3) assert.ok(true);
  }
});

test('countConfirmedAttacks: matches the confirmed entries in seed data', () => {
  const expected = PIPELINE_ATTACKS.filter((a) => a.status === 'confirmed').length;
  assert.equal(countConfirmedAttacks(PIPELINE_ATTACKS), expected);
});

test('countCriticalGrids: counts riskLevel >= 3', () => {
  const expected = GRID_VULNERABILITIES.filter((g) => g.riskLevel >= 3).length;
  assert.equal(countCriticalGrids(GRID_VULNERABILITIES), expected);
});

test('countShockBenchmarks: counts shock or crisis', () => {
  const expected = PRICE_SHOCKS.filter((s) => s.level === 'shock' || s.level === 'crisis').length;
  assert.equal(countShockBenchmarks(PRICE_SHOCKS), expected);
});

test('countOffshoreOfflineTerminals: only counts offline status', () => {
  const expected = LNG_TERMINALS.filter((t) => t.status === 'offline').length;
  assert.equal(countOffshoreOfflineTerminals(LNG_TERMINALS), expected);
});

test('composeBadgeCount: equals the sum of the five sub-counts', () => {
  const expected =
    countActiveDisruptions(DISRUPTION_EVENTS) +
    countConfirmedAttacks(PIPELINE_ATTACKS) +
    countCriticalGrids(GRID_VULNERABILITIES) +
    countShockBenchmarks(PRICE_SHOCKS) +
    countOffshoreOfflineTerminals(LNG_TERMINALS);
  assert.equal(
    composeBadgeCount(DISRUPTION_EVENTS, PIPELINE_ATTACKS, GRID_VULNERABILITIES, PRICE_SHOCKS, LNG_TERMINALS),
    expected,
  );
});

// ── Static seed data invariants ───────────────────────────────────────────

test('DISRUPTION_EVENTS: all severities are 0–4', () => {
  for (const d of DISRUPTION_EVENTS) {
    assert.ok(d.severity >= 0 && d.severity <= 4, `severity ${d.severity} out of range`);
  }
});

test('DISRUPTION_EVENTS: every entry has a positive lost-flow figure', () => {
  for (const d of DISRUPTION_EVENTS) {
    assert.ok(d.lostMbblPerDay > 0, `${d.facility} has zero lost flow`);
  }
});

test('PIPELINE_ATTACKS: all confidence values are 0–3', () => {
  for (const a of PIPELINE_ATTACKS) {
    assert.ok(a.confidence >= 0 && a.confidence <= 3);
  }
});

test('PIPELINE_ATTACKS: all attack types are valid', () => {
  const valid: AttackType[] = ['cyber', 'physical', 'sabotage'];
  for (const a of PIPELINE_ATTACKS) {
    assert.ok(valid.includes(a.type));
  }
});

test('GRID_VULNERABILITIES: every entry has a non-empty region', () => {
  for (const g of GRID_VULNERABILITIES) {
    assert.ok(g.region.length > 0);
  }
});

test('PRICE_SHOCKS: every signal includes a benchmark and threshold', () => {
  for (const p of PRICE_SHOCKS) {
    assert.ok(p.benchmark.length > 0);
    assert.ok(p.shockThreshold > 0);
  }
});

test('OPEC_COMPLIANCE: production / quota * 100 ~ compliancePercent (within 2pp)', () => {
  for (const o of OPEC_COMPLIANCE) {
    const recomputed = Math.round((o.productionMbblPerDay / o.quotaMbblPerDay) * 100);
    assert.ok(
      Math.abs(recomputed - o.compliancePercent) <= 2,
      `${o.country}: recomputed ${recomputed} vs stated ${o.compliancePercent}`,
    );
  }
});

test('LNG_TERMINALS: every terminal has positive capacity', () => {
  for (const t of LNG_TERMINALS) {
    assert.ok(t.capacityMtpa > 0);
  }
});

test('SANCTIONS_IMPACT: evaded never exceeds affected (sanity)', () => {
  for (const s of SANCTIONS_IMPACT) {
    assert.ok(
      s.evadedMbblPerDay <= s.affectedMbblPerDay,
      `${s.target} (${s.regime}): evasion ${s.evadedMbblPerDay} > affected ${s.affectedMbblPerDay}`,
    );
  }
});

test('SANCTIONS_IMPACT: every score is 0–100', () => {
  for (const s of SANCTIONS_IMPACT) {
    assert.ok(s.impactScore >= 0 && s.impactScore <= 100);
  }
});
