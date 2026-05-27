/**
 * Tests for NuclearNonproliferationPanel — pure helper functions and static data.
 *
 * Run with: npx tsx --test src/components/__tests__/nuclear-nonproliferation-helpers.test.mts
 *
 * Pure-logic tests only; no DOM required.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  severityColor,
  severityLabel,
  confidenceLabel,
  treatyStatusColor,
  treatyStatusLabel,
  enrichmentLevelColor,
  enrichmentLevelLabel,
  iaeaAccessColor,
  iaeaAccessLabel,
  alertStatusColor,
  alertStatusLabel,
  programStageLabel,
  programStageColor,
  deliverySystemLabel,
  radiologicalMaterialLabel,
  networkRoleLabel,
  formatSWU,
  formatRangeKm,
  formatGrams,
  classifyEnrichmentAlert,
  proliferationRiskTier,
  isCriticalSafeguardsGap,
  countNonCompliantTreaties,
  countCriticalEnrichmentPrograms,
  countSafeguardsGaps,
  countActiveNetworkThreats,
  countHighConcernDualUse,
  countCriticalDeliverySystems,
  countUnsecuredRadiologicalEvents,
  composeBadgeCount,
  TREATY_COMPLIANCE_RECORDS,
  ENRICHMENT_PROGRAMS,
  IAEA_ACCESS_EVENTS,
  PROLIFERATION_NETWORK_INTERDICTIONS,
  DUAL_USE_TECHNOLOGY_ALERTS,
  DELIVERY_SYSTEM_DEVELOPMENTS,
  RADIOLOGICAL_SECURITY_EVENTS,
  type Severity,
  type Confidence,
  type TreatyStatus,
  type EnrichmentLevel,
  type IaeaAccessStatus,
  type AlertStatus,
  type ProgramStage,
  type NetworkRole,
  type DeliverySystemType,
  type RadiologicalMaterialType,
} from '../nuclear-nonproliferation-helpers.ts';

// ── severityColor ──────────────────────────────────────────────────────────

test('severityColor: 0 grey, 4 red', () => {
  assert.ok(severityColor(0).includes('#9e9e9e'));
  assert.ok(severityColor(4).includes('#ef4444'));
});

test('severityColor: every level uses CSS var', () => {
  for (const l of [0, 1, 2, 3, 4] as Severity[]) {
    assert.match(severityColor(l), /var\(--severity-/);
  }
});

test('severityColor: 1 is green, 3 is orange', () => {
  assert.ok(severityColor(1).includes('#4caf50'));
  assert.ok(severityColor(3).includes('#fb923c'));
});

// ── severityLabel ──────────────────────────────────────────────────────────

test('severityLabel: 0 Minimal, 4 Critical', () => {
  assert.equal(severityLabel(0), 'Minimal');
  assert.equal(severityLabel(4), 'Critical');
});

test('severityLabel: 2 Moderate', () => {
  assert.equal(severityLabel(2), 'Moderate');
});

// ── confidenceLabel ────────────────────────────────────────────────────────

test('confidenceLabel: 0 Unverified, 3 High', () => {
  assert.equal(confidenceLabel(0), 'Unverified');
  assert.equal(confidenceLabel(3), 'High');
});

test('confidenceLabel: every level non-empty', () => {
  for (const c of [0, 1, 2, 3] as Confidence[]) {
    assert.ok(confidenceLabel(c).length > 0);
  }
});

// ── treatyStatusColor ──────────────────────────────────────────────────────

test('treatyStatusColor: compliant is green', () => {
  assert.ok(treatyStatusColor('signatory_compliant').includes('#4caf50'));
});

test('treatyStatusColor: withdrawn is red', () => {
  assert.ok(treatyStatusColor('withdrawn').includes('#ef4444'));
});

test('treatyStatusColor: every TreatyStatus uses CSS var', () => {
  const statuses: TreatyStatus[] = [
    'signatory_compliant',
    'signatory_non_compliant',
    'non_signatory_declared',
    'non_signatory_undeclared',
    'withdrawn',
  ];
  for (const s of statuses) {
    assert.match(treatyStatusColor(s), /var\(--severity-/);
  }
});

// ── treatyStatusLabel ──────────────────────────────────────────────────────

test('treatyStatusLabel: compliant returns Compliant', () => {
  assert.equal(treatyStatusLabel('signatory_compliant'), 'Compliant');
});

test('treatyStatusLabel: non_signatory_undeclared label non-empty', () => {
  assert.ok(treatyStatusLabel('non_signatory_undeclared').length > 0);
});

test('treatyStatusLabel: every status returns non-empty string', () => {
  const statuses: TreatyStatus[] = [
    'signatory_compliant',
    'signatory_non_compliant',
    'non_signatory_declared',
    'non_signatory_undeclared',
    'withdrawn',
  ];
  for (const s of statuses) {
    assert.ok(treatyStatusLabel(s).length > 0);
  }
});

// ── enrichmentLevelColor ───────────────────────────────────────────────────

test('enrichmentLevelColor: weapons_grade is red', () => {
  assert.ok(enrichmentLevelColor('weapons_grade').includes('#ef4444'));
});

test('enrichmentLevelColor: natural is grey', () => {
  assert.ok(enrichmentLevelColor('natural').includes('#9e9e9e'));
});

test('enrichmentLevelColor: every level uses CSS var', () => {
  const levels: EnrichmentLevel[] = ['natural', 'low_enriched', 'highly_enriched', 'weapons_grade'];
  for (const l of levels) {
    assert.match(enrichmentLevelColor(l), /var\(--severity-/);
  }
});

// ── enrichmentLevelLabel ───────────────────────────────────────────────────

test('enrichmentLevelLabel: weapons_grade returns Weapons-Grade', () => {
  assert.equal(enrichmentLevelLabel('weapons_grade'), 'Weapons-Grade');
});

test('enrichmentLevelLabel: every level non-empty', () => {
  const levels: EnrichmentLevel[] = ['natural', 'low_enriched', 'highly_enriched', 'weapons_grade'];
  for (const l of levels) {
    assert.ok(enrichmentLevelLabel(l).length > 0);
  }
});

// ── iaeaAccessColor ────────────────────────────────────────────────────────

test('iaeaAccessColor: full_access is green', () => {
  assert.ok(iaeaAccessColor('full_access').includes('#4caf50'));
});

test('iaeaAccessColor: denied_access is red', () => {
  assert.ok(iaeaAccessColor('denied_access').includes('#ef4444'));
});

test('iaeaAccessColor: every status uses CSS var', () => {
  const statuses: IaeaAccessStatus[] = [
    'full_access', 'limited_access', 'denied_access', 'inspection_pending', 'no_agreement',
  ];
  for (const s of statuses) {
    assert.match(iaeaAccessColor(s), /var\(--severity-/);
  }
});

// ── iaeaAccessLabel ────────────────────────────────────────────────────────

test('iaeaAccessLabel: full_access returns Full Access', () => {
  assert.equal(iaeaAccessLabel('full_access'), 'Full Access');
});

test('iaeaAccessLabel: denied_access returns Denied', () => {
  assert.equal(iaeaAccessLabel('denied_access'), 'Denied');
});

// ── alertStatusColor ───────────────────────────────────────────────────────

test('alertStatusColor: critical is red', () => {
  assert.ok(alertStatusColor('critical').includes('#ef4444'));
});

test('alertStatusColor: monitoring is green', () => {
  assert.ok(alertStatusColor('monitoring').includes('#4caf50'));
});

test('alertStatusColor: every status uses CSS var', () => {
  const statuses: AlertStatus[] = ['monitoring', 'elevated', 'urgent', 'critical'];
  for (const s of statuses) {
    assert.match(alertStatusColor(s), /var\(--severity-/);
  }
});

// ── alertStatusLabel ───────────────────────────────────────────────────────

test('alertStatusLabel: critical returns Critical', () => {
  assert.equal(alertStatusLabel('critical'), 'Critical');
});

test('alertStatusLabel: every status non-empty', () => {
  const statuses: AlertStatus[] = ['monitoring', 'elevated', 'urgent', 'critical'];
  for (const s of statuses) {
    assert.ok(alertStatusLabel(s).length > 0);
  }
});

// ── programStageLabel / programStageColor ──────────────────────────────────

test('programStageLabel: operational returns Operational', () => {
  assert.equal(programStageLabel('operational'), 'Operational');
});

test('programStageLabel: every stage non-empty', () => {
  const stages: ProgramStage[] = [
    'declared_civilian', 'ambiguous', 'suspected_military', 'confirmed_weapons', 'operational',
  ];
  for (const s of stages) {
    assert.ok(programStageLabel(s).length > 0);
  }
});

test('programStageColor: declared_civilian is green', () => {
  assert.ok(programStageColor('declared_civilian').includes('#4caf50'));
});

test('programStageColor: confirmed_weapons is red', () => {
  assert.ok(programStageColor('confirmed_weapons').includes('#ef4444'));
});

// ── deliverySystemLabel ────────────────────────────────────────────────────

test('deliverySystemLabel: ballistic_missile returns Ballistic Missile', () => {
  assert.equal(deliverySystemLabel('ballistic_missile'), 'Ballistic Missile');
});

test('deliverySystemLabel: every type non-empty', () => {
  const types: DeliverySystemType[] = [
    'ballistic_missile', 'cruise_missile', 'gravity_bomb', 'submarine_launched', 'hypersonic_glide',
  ];
  for (const t of types) {
    assert.ok(deliverySystemLabel(t).length > 0);
  }
});

// ── radiologicalMaterialLabel ──────────────────────────────────────────────

test('radiologicalMaterialLabel: highly_enriched_uranium returns HEU', () => {
  assert.equal(radiologicalMaterialLabel('highly_enriched_uranium'), 'HEU');
});

test('radiologicalMaterialLabel: every type non-empty', () => {
  const types: RadiologicalMaterialType[] = [
    'highly_enriched_uranium', 'plutonium', 'cesium_137', 'cobalt_60', 'strontium_90', 'americium_241',
  ];
  for (const t of types) {
    assert.ok(radiologicalMaterialLabel(t).length > 0);
  }
});

// ── networkRoleLabel ───────────────────────────────────────────────────────

test('networkRoleLabel: supplier returns Supplier', () => {
  assert.equal(networkRoleLabel('supplier'), 'Supplier');
});

test('networkRoleLabel: every role non-empty', () => {
  const roles: NetworkRole[] = ['supplier', 'transshipment', 'end_user', 'financier', 'broker'];
  for (const r of roles) {
    assert.ok(networkRoleLabel(r).length > 0);
  }
});

// ── formatSWU ─────────────────────────────────────────────────────────────

test('formatSWU: 0 returns "0 SWU/yr"', () => {
  assert.equal(formatSWU(0), '0 SWU/yr');
});

test('formatSWU: 6000 uses k suffix', () => {
  assert.match(formatSWU(6_000), /k SWU\/yr/);
});

test('formatSWU: 1_200_000 uses M suffix', () => {
  assert.match(formatSWU(1_200_000), /M SWU\/yr/);
});

// ── formatRangeKm ─────────────────────────────────────────────────────────

test('formatRangeKm: 500 returns "500 km"', () => {
  assert.equal(formatRangeKm(500), '500 km');
});

test('formatRangeKm: 15000 uses k suffix', () => {
  assert.match(formatRangeKm(15_000), /k km/);
});

// ── formatGrams ───────────────────────────────────────────────────────────

test('formatGrams: 85 returns grams string', () => {
  assert.match(formatGrams(85), /g/);
});

test('formatGrams: 10000 uses kg', () => {
  assert.match(formatGrams(10_000), /kg/);
});

// ── classifyEnrichmentAlert ────────────────────────────────────────────────

test('classifyEnrichmentAlert: weapons_grade → critical regardless of stage', () => {
  assert.equal(classifyEnrichmentAlert('weapons_grade', 'declared_civilian'), 'critical');
  assert.equal(classifyEnrichmentAlert('weapons_grade', 'ambiguous'), 'critical');
  assert.equal(classifyEnrichmentAlert('weapons_grade', 'operational'), 'critical');
});

test('classifyEnrichmentAlert: highly_enriched + suspected_military → urgent', () => {
  assert.equal(classifyEnrichmentAlert('highly_enriched', 'suspected_military'), 'urgent');
});

test('classifyEnrichmentAlert: highly_enriched + operational → critical', () => {
  assert.equal(classifyEnrichmentAlert('highly_enriched', 'operational'), 'critical');
});

test('classifyEnrichmentAlert: low_enriched + declared_civilian → monitoring', () => {
  assert.equal(classifyEnrichmentAlert('low_enriched', 'declared_civilian'), 'monitoring');
});

test('classifyEnrichmentAlert: natural + ambiguous → monitoring', () => {
  assert.equal(classifyEnrichmentAlert('natural', 'ambiguous'), 'monitoring');
});

test('classifyEnrichmentAlert: highly_enriched + ambiguous → elevated', () => {
  assert.equal(classifyEnrichmentAlert('highly_enriched', 'ambiguous'), 'elevated');
});

// ── proliferationRiskTier ─────────────────────────────────────────────────

test('proliferationRiskTier: interdicted + high confidence → 2', () => {
  assert.equal(proliferationRiskTier('supplier', true, 2), 2);
});

test('proliferationRiskTier: interdicted + low confidence → 1', () => {
  assert.equal(proliferationRiskTier('supplier', true, 1), 1);
});

test('proliferationRiskTier: supplier not interdicted + high conf → 4', () => {
  assert.equal(proliferationRiskTier('supplier', false, 3), 4);
});

test('proliferationRiskTier: transshipment not interdicted → 2', () => {
  assert.equal(proliferationRiskTier('transshipment', false, 3), 2);
});

test('proliferationRiskTier: unverified confidence reduces risk', () => {
  const high = proliferationRiskTier('broker', false, 3);
  const low  = proliferationRiskTier('broker', false, 0);
  assert.ok(low < high);
});

// ── isCriticalSafeguardsGap ────────────────────────────────────────────────

test('isCriticalSafeguardsGap: denied_access > 30 days is critical', () => {
  assert.equal(
    isCriticalSafeguardsGap({ country: 'X', facility: 'Y', accessStatus: 'denied_access', severity: 2, daysWithoutAccess: 365, notes: '' }),
    true,
  );
});

test('isCriticalSafeguardsGap: denied_access <= 30 days is not critical', () => {
  assert.equal(
    isCriticalSafeguardsGap({ country: 'X', facility: 'Y', accessStatus: 'denied_access', severity: 2, daysWithoutAccess: 10, notes: '' }),
    false,
  );
});

test('isCriticalSafeguardsGap: no_agreement is always critical', () => {
  assert.equal(
    isCriticalSafeguardsGap({ country: 'X', facility: 'Y', accessStatus: 'no_agreement', severity: 1, daysWithoutAccess: 0, notes: '' }),
    true,
  );
});

test('isCriticalSafeguardsGap: severity 4 triggers critical', () => {
  assert.equal(
    isCriticalSafeguardsGap({ country: 'X', facility: 'Y', accessStatus: 'limited_access', severity: 4, daysWithoutAccess: 5, notes: '' }),
    true,
  );
});

test('isCriticalSafeguardsGap: full access, low severity, 0 days → false', () => {
  assert.equal(
    isCriticalSafeguardsGap({ country: 'X', facility: 'Y', accessStatus: 'full_access', severity: 1, daysWithoutAccess: 0, notes: '' }),
    false,
  );
});

// ── countNonCompliantTreaties ──────────────────────────────────────────────

test('countNonCompliantTreaties: TREATY_COMPLIANCE_RECORDS has non-compliant entries', () => {
  const count = countNonCompliantTreaties(TREATY_COMPLIANCE_RECORDS);
  assert.ok(count > 0);
});

test('countNonCompliantTreaties: only counts non-compliant/undeclared/withdrawn', () => {
  const allCompliant = [
    { country: 'A', treaty: 'NPT', status: 'signatory_compliant' as const, concernScore: 0 as const, lastReviewYear: 2024, keyIssue: '' },
    { country: 'B', treaty: 'NPT', status: 'non_signatory_declared' as const, concernScore: 0 as const, lastReviewYear: 2024, keyIssue: '' },
  ];
  assert.equal(countNonCompliantTreaties(allCompliant), 0);
});

test('countNonCompliantTreaties: counts withdrawn', () => {
  const records = [
    { country: 'X', treaty: 'NPT', status: 'withdrawn' as const, concernScore: 4 as const, lastReviewYear: 2023, keyIssue: '' },
  ];
  assert.equal(countNonCompliantTreaties(records), 1);
});

// ── countCriticalEnrichmentPrograms ───────────────────────────────────────

test('countCriticalEnrichmentPrograms: ENRICHMENT_PROGRAMS has critical entries', () => {
  const count = countCriticalEnrichmentPrograms(ENRICHMENT_PROGRAMS);
  assert.ok(count > 0);
});

test('countCriticalEnrichmentPrograms: monitoring only → 0', () => {
  const programs = ENRICHMENT_PROGRAMS.filter((p) => p.alertStatus === 'monitoring');
  assert.equal(countCriticalEnrichmentPrograms(programs), 0);
});

// ── countSafeguardsGaps ────────────────────────────────────────────────────

test('countSafeguardsGaps: IAEA_ACCESS_EVENTS has critical gaps', () => {
  const count = countSafeguardsGaps(IAEA_ACCESS_EVENTS);
  assert.ok(count > 0);
});

test('countSafeguardsGaps: full access events produce 0', () => {
  const events = [
    { country: 'A', facility: 'F', accessStatus: 'full_access' as const, severity: 1 as const, daysWithoutAccess: 0, notes: '' },
  ];
  assert.equal(countSafeguardsGaps(events), 0);
});

// ── countActiveNetworkThreats ─────────────────────────────────────────────

test('countActiveNetworkThreats: non-interdicted high-severity entries counted', () => {
  const count = countActiveNetworkThreats(PROLIFERATION_NETWORK_INTERDICTIONS);
  assert.ok(count > 0);
});

test('countActiveNetworkThreats: all interdicted → 0', () => {
  const all = PROLIFERATION_NETWORK_INTERDICTIONS.map((n) => ({ ...n, interdicted: true }));
  assert.equal(countActiveNetworkThreats(all), 0);
});

// ── countHighConcernDualUse ────────────────────────────────────────────────

test('countHighConcernDualUse: DUAL_USE_TECHNOLOGY_ALERTS has high concern entries', () => {
  const count = countHighConcernDualUse(DUAL_USE_TECHNOLOGY_ALERTS);
  assert.ok(count > 0);
});

test('countHighConcernDualUse: threshold is >= 3', () => {
  const alerts = [
    { technology: 'X', exportingCountry: 'A', receivingCountry: 'B', concernLevel: 2 as const, flaggedByRegime: 'NSG', underReview: false },
  ];
  assert.equal(countHighConcernDualUse(alerts), 0);
});

// ── countCriticalDeliverySystems ──────────────────────────────────────────

test('countCriticalDeliverySystems: DELIVERY_SYSTEM_DEVELOPMENTS has critical entries', () => {
  const count = countCriticalDeliverySystems(DELIVERY_SYSTEM_DEVELOPMENTS);
  assert.ok(count > 0);
});

test('countCriticalDeliverySystems: monitoring only → 0', () => {
  const monitoring = DELIVERY_SYSTEM_DEVELOPMENTS.map((d) => ({ ...d, alertStatus: 'monitoring' as const }));
  assert.equal(countCriticalDeliverySystems(monitoring), 0);
});

// ── countUnsecuredRadiologicalEvents ──────────────────────────────────────

test('countUnsecuredRadiologicalEvents: some unsecured high-severity events exist', () => {
  const count = countUnsecuredRadiologicalEvents(RADIOLOGICAL_SECURITY_EVENTS);
  assert.ok(count > 0);
});

test('countUnsecuredRadiologicalEvents: all secured → 0', () => {
  const secured = RADIOLOGICAL_SECURITY_EVENTS.map((e) => ({ ...e, secured: true }));
  assert.equal(countUnsecuredRadiologicalEvents(secured), 0);
});

// ── composeBadgeCount ──────────────────────────────────────────────────────

test('composeBadgeCount: returns positive number from seed data', () => {
  const count = composeBadgeCount(
    TREATY_COMPLIANCE_RECORDS,
    ENRICHMENT_PROGRAMS,
    IAEA_ACCESS_EVENTS,
    PROLIFERATION_NETWORK_INTERDICTIONS,
    DUAL_USE_TECHNOLOGY_ALERTS,
    DELIVERY_SYSTEM_DEVELOPMENTS,
    RADIOLOGICAL_SECURITY_EVENTS,
  );
  assert.ok(count > 0);
});

test('composeBadgeCount: empty arrays → 0', () => {
  assert.equal(composeBadgeCount([], [], [], [], [], [], []), 0);
});

// ── Static seed data integrity ─────────────────────────────────────────────

test('TREATY_COMPLIANCE_RECORDS: non-empty array', () => {
  assert.ok(TREATY_COMPLIANCE_RECORDS.length > 0);
});

test('TREATY_COMPLIANCE_RECORDS: every record has valid concernScore 0–4', () => {
  for (const r of TREATY_COMPLIANCE_RECORDS) {
    assert.ok(r.concernScore >= 0 && r.concernScore <= 4);
  }
});

test('TREATY_COMPLIANCE_RECORDS: every record has non-empty keyIssue', () => {
  for (const r of TREATY_COMPLIANCE_RECORDS) {
    assert.ok(r.keyIssue.length > 0);
  }
});

test('ENRICHMENT_PROGRAMS: non-empty array', () => {
  assert.ok(ENRICHMENT_PROGRAMS.length > 0);
});

test('ENRICHMENT_PROGRAMS: alertStatus consistent with classifyEnrichmentAlert for weapons_grade', () => {
  for (const p of ENRICHMENT_PROGRAMS) {
    if (p.enrichmentLevel === 'weapons_grade') {
      assert.equal(p.alertStatus, 'critical');
    }
  }
});

test('IAEA_ACCESS_EVENTS: non-empty array', () => {
  assert.ok(IAEA_ACCESS_EVENTS.length > 0);
});

test('IAEA_ACCESS_EVENTS: daysWithoutAccess is non-negative', () => {
  for (const e of IAEA_ACCESS_EVENTS) {
    assert.ok(e.daysWithoutAccess >= 0);
  }
});

test('PROLIFERATION_NETWORK_INTERDICTIONS: non-empty array', () => {
  assert.ok(PROLIFERATION_NETWORK_INTERDICTIONS.length > 0);
});

test('PROLIFERATION_NETWORK_INTERDICTIONS: has mix of interdicted and active', () => {
  const interdicted = PROLIFERATION_NETWORK_INTERDICTIONS.filter((n) => n.interdicted);
  const active      = PROLIFERATION_NETWORK_INTERDICTIONS.filter((n) => !n.interdicted);
  assert.ok(interdicted.length > 0);
  assert.ok(active.length > 0);
});

test('DUAL_USE_TECHNOLOGY_ALERTS: non-empty array', () => {
  assert.ok(DUAL_USE_TECHNOLOGY_ALERTS.length > 0);
});

test('DUAL_USE_TECHNOLOGY_ALERTS: concernLevel 0–4 for all entries', () => {
  for (const a of DUAL_USE_TECHNOLOGY_ALERTS) {
    assert.ok(a.concernLevel >= 0 && a.concernLevel <= 4);
  }
});

test('DELIVERY_SYSTEM_DEVELOPMENTS: non-empty array', () => {
  assert.ok(DELIVERY_SYSTEM_DEVELOPMENTS.length > 0);
});

test('DELIVERY_SYSTEM_DEVELOPMENTS: estimatedRangeKm positive for all entries', () => {
  for (const d of DELIVERY_SYSTEM_DEVELOPMENTS) {
    assert.ok(d.estimatedRangeKm > 0);
  }
});

test('RADIOLOGICAL_SECURITY_EVENTS: non-empty array', () => {
  assert.ok(RADIOLOGICAL_SECURITY_EVENTS.length > 0);
});

test('RADIOLOGICAL_SECURITY_EVENTS: quantityGrams positive for all entries', () => {
  for (const e of RADIOLOGICAL_SECURITY_EVENTS) {
    assert.ok(e.quantityGrams > 0);
  }
});
