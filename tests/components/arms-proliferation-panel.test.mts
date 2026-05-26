/**
 * Tests for ArmsProliferationPanel — pure helper functions and static data.
 *
 * Run with: npx tsx --test tests/components/arms-proliferation-panel.test.mts
 *
 * Pure-logic tests only; no DOM required.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  severityColor,
  severityLabel,
  confidenceLabel,
  weaponCategoryLabel,
  actorTypeLabel,
  embargoStatusColor,
  violationStatusColor,
  routeLabel,
  manpadsThreatColor,
  classifyManpadsThreat,
  dealStatusColor,
  controlRegimeLabel,
  caseStageColor,
  formatUnits,
  formatUsdBn,
  formatUsdM,
  formatKm,
  countConfirmedEmbargoViolations,
  countNonInterdictedTransfers,
  countCriticalManpads,
  countHighFlowHotspots,
  countHighConfidenceAcquisitions,
  countFlaggedDeals,
  countActiveCases,
  totalDealValueUsdBn,
  totalEnforcementPenaltyUsdM,
  composeBadgeCount,
  EMBARGO_VIOLATIONS,
  ILLICIT_TRANSFERS,
  MANPADS_INDICATORS,
  SMALL_ARMS_HOTSPOTS,
  NON_STATE_ACQUISITIONS,
  ARMS_DEALS,
  EXPORT_CONTROL_CASES,
  type Severity,
  type Confidence,
  type WeaponCategory,
  type ActorType,
  type ControlRegime,
  type ArmsDealAnnouncement,
} from '../../src/components/arms-proliferation-helpers.ts';

// ── severityColor / severityLabel ─────────────────────────────────────────

test('severityColor: 0 grey, 4 red', () => {
  assert.ok(severityColor(0).includes('#9e9e9e'));
  assert.ok(severityColor(4).includes('#ef4444'));
});

test('severityColor: every level uses a CSS var', () => {
  for (const l of [0, 1, 2, 3, 4] as Severity[]) {
    assert.match(severityColor(l), /var\(--severity-/);
  }
});

test('severityLabel: 0 returns Minimal, 4 returns Critical', () => {
  assert.equal(severityLabel(0), 'Minimal');
  assert.equal(severityLabel(4), 'Critical');
});

// ── confidenceLabel ──────────────────────────────────────────────────────

test('confidenceLabel: 0 returns Unverified, 3 returns High', () => {
  assert.equal(confidenceLabel(0), 'Unverified');
  assert.equal(confidenceLabel(3), 'High');
});

test('confidenceLabel: every level non-empty', () => {
  for (const c of [0, 1, 2, 3] as Confidence[]) {
    assert.ok(confidenceLabel(c).length > 0);
  }
});

// ── weaponCategoryLabel / actorTypeLabel ─────────────────────────────────

test('weaponCategoryLabel: MANPADS stays uppercase', () => {
  assert.equal(weaponCategoryLabel('MANPADS'), 'MANPADS');
});

test('weaponCategoryLabel: small arms title-cases', () => {
  assert.equal(weaponCategoryLabel('small arms'), 'Small Arms');
});

test('weaponCategoryLabel: every category non-empty', () => {
  const all: WeaponCategory[] = ['small arms', 'light weapons', 'MANPADS', 'ATGM', 'UAV', 'artillery', 'armored vehicles', 'munitions'];
  for (const w of all) assert.ok(weaponCategoryLabel(w).length > 0);
});

test('actorTypeLabel: non-state armed group title-cases', () => {
  assert.equal(actorTypeLabel('non-state armed group'), 'Non-State Armed Group');
});

test('actorTypeLabel: every actor type non-empty', () => {
  const all: ActorType[] = ['state', 'non-state armed group', 'criminal network', 'private broker'];
  for (const a of all) assert.ok(actorTypeLabel(a).length > 0);
});

// ── embargo / violation status colors ────────────────────────────────────

test('embargoStatusColor: active is red, expired is grey', () => {
  assert.ok(embargoStatusColor('active').includes('#ef4444'));
  assert.ok(embargoStatusColor('expired').includes('#9e9e9e'));
});

test('violationStatusColor: confirmed and sanctioned are both red', () => {
  assert.ok(violationStatusColor('confirmed').includes('#ef4444'));
  assert.ok(violationStatusColor('sanctioned').includes('#ef4444'));
});

test('violationStatusColor: reported is yellow, investigating is orange', () => {
  assert.ok(violationStatusColor('reported').includes('#facc15'));
  assert.ok(violationStatusColor('investigating').includes('#fb923c'));
});

// ── transfer route ──────────────────────────────────────────────────────

test('routeLabel: multi-modal title-cases', () => {
  assert.equal(routeLabel('multi-modal'), 'Multi-Modal');
});

test('routeLabel: air/sea/land non-empty', () => {
  for (const r of ['air', 'sea', 'land'] as const) assert.ok(routeLabel(r).length > 0);
});

// ── MANPADS classifier ──────────────────────────────────────────────────

test('classifyManpadsThreat: <100 systems and far from routes is low', () => {
  assert.equal(classifyManpadsThreat(50, 500), 'low');
});

test('classifyManpadsThreat: 100+ systems but far is elevated', () => {
  assert.equal(classifyManpadsThreat(150, 500), 'elevated');
});

test('classifyManpadsThreat: 500+ systems even far is high', () => {
  assert.equal(classifyManpadsThreat(600, 500), 'high');
});

test('classifyManpadsThreat: 20+ systems within 50km of air routes is high', () => {
  assert.equal(classifyManpadsThreat(25, 30), 'high');
});

test('classifyManpadsThreat: 100+ systems within 50km of air routes is critical', () => {
  assert.equal(classifyManpadsThreat(120, 40), 'critical');
});

test('classifyManpadsThreat: 50+ systems within 10km of air routes is critical', () => {
  assert.equal(classifyManpadsThreat(60, 5), 'critical');
});

test('manpadsThreatColor: critical is red, low is green', () => {
  assert.ok(manpadsThreatColor('critical').includes('#ef4444'));
  assert.ok(manpadsThreatColor('low').includes('#4caf50'));
});

// ── deal status / control regime / case stage ────────────────────────────

test('dealStatusColor: delivered is red, cancelled is grey', () => {
  assert.ok(dealStatusColor('delivered').includes('#ef4444'));
  assert.ok(dealStatusColor('cancelled').includes('#9e9e9e'));
});

test('controlRegimeLabel: passes through ITAR / EAR / Wassenaar unchanged', () => {
  for (const r of ['ITAR', 'EAR', 'EU dual-use', 'Wassenaar', 'MTCR'] as ControlRegime[]) {
    assert.equal(controlRegimeLabel(r), r);
  }
});

test('caseStageColor: conviction/sentencing both red, closed grey', () => {
  assert.ok(caseStageColor('conviction').includes('#ef4444'));
  assert.ok(caseStageColor('sentencing').includes('#ef4444'));
  assert.ok(caseStageColor('closed').includes('#9e9e9e'));
});

// ── formatting helpers ──────────────────────────────────────────────────

test('formatUnits: 850 returns 850', () => {
  assert.equal(formatUnits(850), '850');
});

test('formatUnits: 1500 returns 1.5k', () => {
  assert.equal(formatUnits(1500), '1.5k');
});

test('formatUnits: 12000 returns 12k (no decimal)', () => {
  assert.equal(formatUnits(12_000), '12k');
});

test('formatUsdBn: 12.5 returns $12.5 B', () => {
  assert.equal(formatUsdBn(12.5), '$12.5 B');
});

test('formatUsdBn: 0.6 returns $600 M', () => {
  assert.equal(formatUsdBn(0.6), '$600 M');
});

test('formatUsdBn: 0.005 returns sub-million figure', () => {
  assert.equal(formatUsdBn(0.005), '$5.0 M');
});

test('formatUsdM: 85 returns $85 M', () => {
  assert.equal(formatUsdM(85), '$85 M');
});

test('formatUsdM: 1500 promotes to $1.5 B', () => {
  assert.equal(formatUsdM(1500), '$1.5 B');
});

test('formatKm: 200 returns 200 km', () => {
  assert.equal(formatKm(200), '200 km');
});

test('formatKm: 1500 returns 1.5k km', () => {
  assert.equal(formatKm(1500), '1.5k km');
});

// ── count helpers ───────────────────────────────────────────────────────

test('countConfirmedEmbargoViolations: counts confirmed + sanctioned', () => {
  const expected = EMBARGO_VIOLATIONS.filter(
    (v) => v.violationStatus === 'confirmed' || v.violationStatus === 'sanctioned',
  ).length;
  assert.equal(countConfirmedEmbargoViolations(EMBARGO_VIOLATIONS), expected);
});

test('countNonInterdictedTransfers: counts only non-interdicted shipments', () => {
  const expected = ILLICIT_TRANSFERS.filter((t) => !t.interdicted).length;
  assert.equal(countNonInterdictedTransfers(ILLICIT_TRANSFERS), expected);
});

test('countCriticalManpads: counts critical threat level', () => {
  const expected = MANPADS_INDICATORS.filter((m) => m.threatLevel === 'critical').length;
  assert.equal(countCriticalManpads(MANPADS_INDICATORS), expected);
});

test('countHighFlowHotspots: counts flow density >= 3', () => {
  const expected = SMALL_ARMS_HOTSPOTS.filter((s) => s.flowDensity >= 3).length;
  assert.equal(countHighFlowHotspots(SMALL_ARMS_HOTSPOTS), expected);
});

test('countHighConfidenceAcquisitions: requires both confidence >=2 and severity >=3', () => {
  const expected = NON_STATE_ACQUISITIONS.filter((a) => a.confidence >= 2 && a.severity >= 3).length;
  assert.equal(countHighConfidenceAcquisitions(NON_STATE_ACQUISITIONS), expected);
});

test('countFlaggedDeals: matches the flagged entries in seed data', () => {
  const expected = ARMS_DEALS.filter((d) => d.flagged).length;
  assert.equal(countFlaggedDeals(ARMS_DEALS), expected);
});

test('countActiveCases: excludes only stage=closed', () => {
  const expected = EXPORT_CONTROL_CASES.filter((c) => c.stage !== 'closed').length;
  assert.equal(countActiveCases(EXPORT_CONTROL_CASES), expected);
});

test('totalDealValueUsdBn: excludes cancelled deals', () => {
  const deals: ArmsDealAnnouncement[] = [
    { seller: 'A', buyer: 'B', weaponCategory: 'UAV',  valueUsdBn: 1.0, status: 'announced',  flagged: false },
    { seller: 'A', buyer: 'C', weaponCategory: 'UAV',  valueUsdBn: 2.5, status: 'contracted', flagged: false },
    { seller: 'A', buyer: 'D', weaponCategory: 'UAV',  valueUsdBn: 9.9, status: 'cancelled',  flagged: false },
  ];
  assert.equal(totalDealValueUsdBn(deals), 3.5);
});

test('totalDealValueUsdBn: rounds to one decimal place', () => {
  const deals: ArmsDealAnnouncement[] = [
    { seller: 'A', buyer: 'B', weaponCategory: 'UAV', valueUsdBn: 0.1, status: 'announced', flagged: false },
    { seller: 'A', buyer: 'C', weaponCategory: 'UAV', valueUsdBn: 0.2, status: 'announced', flagged: false },
  ];
  assert.equal(totalDealValueUsdBn(deals), 0.3);
});

test('totalEnforcementPenaltyUsdM: only sums resolved cases (conviction/sentencing/closed)', () => {
  const expected = EXPORT_CONTROL_CASES
    .filter((c) => c.stage === 'conviction' || c.stage === 'sentencing' || c.stage === 'closed')
    .reduce((acc, c) => acc + c.penaltyUsdM, 0);
  assert.equal(totalEnforcementPenaltyUsdM(EXPORT_CONTROL_CASES), Math.round(expected * 10) / 10);
});

test('composeBadgeCount: equals sum of all six section counts', () => {
  const expected =
    countConfirmedEmbargoViolations(EMBARGO_VIOLATIONS) +
    countNonInterdictedTransfers(ILLICIT_TRANSFERS) +
    countCriticalManpads(MANPADS_INDICATORS) +
    countHighFlowHotspots(SMALL_ARMS_HOTSPOTS) +
    countHighConfidenceAcquisitions(NON_STATE_ACQUISITIONS) +
    countActiveCases(EXPORT_CONTROL_CASES);
  assert.equal(
    composeBadgeCount(
      EMBARGO_VIOLATIONS,
      ILLICIT_TRANSFERS,
      MANPADS_INDICATORS,
      SMALL_ARMS_HOTSPOTS,
      NON_STATE_ACQUISITIONS,
      EXPORT_CONTROL_CASES,
    ),
    expected,
  );
});

// ── Seed data invariants ────────────────────────────────────────────────

test('EMBARGO_VIOLATIONS: every entry has a UN resolution and target', () => {
  for (const v of EMBARGO_VIOLATIONS) {
    assert.ok(v.embargoTarget.length > 0);
    assert.ok(v.unResolution.startsWith('UNSCR'));
  }
});

test('EMBARGO_VIOLATIONS: every severity is 0–4', () => {
  for (const v of EMBARGO_VIOLATIONS) {
    assert.ok(v.severity >= 0 && v.severity <= 4);
  }
});

test('ILLICIT_TRANSFERS: every transfer has positive quantity', () => {
  for (const t of ILLICIT_TRANSFERS) assert.ok(t.quantity > 0);
});

test('ILLICIT_TRANSFERS: every confidence is 0–3', () => {
  for (const t of ILLICIT_TRANSFERS) assert.ok(t.confidence >= 0 && t.confidence <= 3);
});

test('MANPADS_INDICATORS: every stored threat level matches the classifier', () => {
  for (const m of MANPADS_INDICATORS) {
    const recomputed = classifyManpadsThreat(m.unaccountedSystems, m.proximityToAirRoutesKm);
    assert.equal(
      m.threatLevel,
      recomputed,
      `${m.region}: stored ${m.threatLevel}, classifier returned ${recomputed}`,
    );
  }
});

test('MANPADS_INDICATORS: every entry has positive stock and non-negative proximity', () => {
  for (const m of MANPADS_INDICATORS) {
    assert.ok(m.unaccountedSystems > 0);
    assert.ok(m.proximityToAirRoutesKm >= 0);
  }
});

test('SMALL_ARMS_HOTSPOTS: every flow density is 0–4', () => {
  for (const s of SMALL_ARMS_HOTSPOTS) assert.ok(s.flowDensity >= 0 && s.flowDensity <= 4);
});

test('SMALL_ARMS_HOTSPOTS: every annual unit estimate is positive', () => {
  for (const s of SMALL_ARMS_HOTSPOTS) assert.ok(s.estimatedAnnualUnits > 0);
});

test('NON_STATE_ACQUISITIONS: every entry has a region and group name', () => {
  for (const a of NON_STATE_ACQUISITIONS) {
    assert.ok(a.group.length > 0);
    assert.ok(a.region.length > 0);
  }
});

test('ARMS_DEALS: every deal value is non-negative', () => {
  for (const d of ARMS_DEALS) assert.ok(d.valueUsdBn >= 0);
});

test('ARMS_DEALS: every deal has a seller, a buyer, and they differ', () => {
  for (const d of ARMS_DEALS) {
    assert.ok(d.seller.length > 0);
    assert.ok(d.buyer.length > 0);
    assert.notEqual(d.seller, d.buyer);
  }
});

test('EXPORT_CONTROL_CASES: every penalty is non-negative', () => {
  for (const c of EXPORT_CONTROL_CASES) assert.ok(c.penaltyUsdM >= 0);
});

test('EXPORT_CONTROL_CASES: indictment / plea stages have no settled penalty yet', () => {
  for (const c of EXPORT_CONTROL_CASES) {
    if (c.stage === 'indictment') {
      assert.equal(c.penaltyUsdM, 0, `${c.caseName}: indictment but penalty already set`);
    }
  }
});
