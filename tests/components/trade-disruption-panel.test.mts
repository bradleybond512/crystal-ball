/**
 * Tests for TradeDisruptionPanel — pure helper functions and static data.
 *
 * Run with: npx tsx --test tests/components/trade-disruption-panel.test.mts
 *
 * Pure-logic tests only; no DOM required. All helpers are exported from the
 * helpers module for testability.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sanctionsSeverityColor,
  sanctionsSeverityLabel,
  tariffStageColor,
  tariffStageLabel,
  formatTariffRate,
  exportCategoryColor,
  exportCategoryLabel,
  formatVolumeMt,
  disputeStatusColor,
  disputeStatusLabel,
  flowRiskColor,
  flowRiskLabel,
  formatTradeBn,
  countComprehensiveSanctions,
  countCriticalDisputes,
  countEscalatingTariffs,
  totalTradeAtRiskBn,
  SANCTIONS_REGIMES,
  TARIFF_ESCALATIONS,
  EXPORT_BANS,
  TRADE_FLASHPOINTS,
  FLOW_INDEX,
  type SanctionsSeverity,
  type TariffStage,
  type ExportCategory,
  type DisputeStatus,
  type FlowRisk,
  type SanctionsRegime,
  type TariffEscalation,
  type TradeFlashpoint,
} from '../../src/components/trade-disruption-helpers.ts';

// ── sanctionsSeverityColor ────────────────────────────────────────────────

test('sanctionsSeverityColor: targeted returns yellow', () => {
  assert.ok(sanctionsSeverityColor('targeted').includes('#facc15'));
});

test('sanctionsSeverityColor: sectoral returns orange', () => {
  assert.ok(sanctionsSeverityColor('sectoral').includes('#fb923c'));
});

test('sanctionsSeverityColor: comprehensive returns red', () => {
  assert.ok(sanctionsSeverityColor('comprehensive').includes('#ef4444'));
});

test('sanctionsSeverityColor: all levels return non-empty strings', () => {
  const levels: SanctionsSeverity[] = ['targeted', 'sectoral', 'comprehensive'];
  for (const l of levels) assert.ok(sanctionsSeverityColor(l).length > 0);
});

// ── sanctionsSeverityLabel ────────────────────────────────────────────────

test('sanctionsSeverityLabel: targeted returns "Targeted"', () => {
  assert.equal(sanctionsSeverityLabel('targeted'), 'Targeted');
});

test('sanctionsSeverityLabel: sectoral returns "Sectoral"', () => {
  assert.equal(sanctionsSeverityLabel('sectoral'), 'Sectoral');
});

test('sanctionsSeverityLabel: comprehensive returns "Comprehensive"', () => {
  assert.equal(sanctionsSeverityLabel('comprehensive'), 'Comprehensive');
});

// ── tariffStageColor ──────────────────────────────────────────────────────

test('tariffStageColor: threat returns green', () => {
  assert.ok(tariffStageColor('threat').includes('#4caf50'));
});

test('tariffStageColor: imposed returns yellow', () => {
  assert.ok(tariffStageColor('imposed').includes('#facc15'));
});

test('tariffStageColor: escalating returns orange', () => {
  assert.ok(tariffStageColor('escalating').includes('#fb923c'));
});

test('tariffStageColor: retaliatory returns red', () => {
  assert.ok(tariffStageColor('retaliatory').includes('#ef4444'));
});

test('tariffStageColor: all stages return non-empty strings', () => {
  const stages: TariffStage[] = ['threat', 'imposed', 'escalating', 'retaliatory'];
  for (const s of stages) assert.ok(tariffStageColor(s).length > 0);
});

// ── tariffStageLabel ──────────────────────────────────────────────────────

test('tariffStageLabel: threat returns "Threat"', () => {
  assert.equal(tariffStageLabel('threat'), 'Threat');
});

test('tariffStageLabel: retaliatory returns "Retaliatory"', () => {
  assert.equal(tariffStageLabel('retaliatory'), 'Retaliatory');
});

test('tariffStageLabel: all stages return non-empty strings', () => {
  const stages: TariffStage[] = ['threat', 'imposed', 'escalating', 'retaliatory'];
  for (const s of stages) assert.ok(tariffStageLabel(s).length > 0);
});

// ── formatTariffRate ──────────────────────────────────────────────────────

test('formatTariffRate: formats 25 as "25%"', () => {
  assert.equal(formatTariffRate(25), '25%');
});

test('formatTariffRate: formats 145 as "145%"', () => {
  assert.equal(formatTariffRate(145), '145%');
});

test('formatTariffRate: formats 0 as "0%"', () => {
  assert.equal(formatTariffRate(0), '0%');
});

// ── exportCategoryColor ───────────────────────────────────────────────────

test('exportCategoryColor: semiconductors returns red', () => {
  assert.ok(exportCategoryColor('semiconductors').includes('#ef4444'));
});

test('exportCategoryColor: agriculture returns yellow', () => {
  assert.ok(exportCategoryColor('agriculture').includes('#facc15'));
});

test('exportCategoryColor: energy returns orange', () => {
  assert.ok(exportCategoryColor('energy').includes('#fb923c'));
});

test('exportCategoryColor: military returns red', () => {
  assert.ok(exportCategoryColor('military').includes('#ef4444'));
});

test('exportCategoryColor: dual-use returns orange', () => {
  assert.ok(exportCategoryColor('dual-use').includes('#fb923c'));
});

test('exportCategoryColor: all categories return non-empty strings', () => {
  const cats: ExportCategory[] = ['semiconductors', 'agriculture', 'energy', 'military', 'dual-use'];
  for (const c of cats) assert.ok(exportCategoryColor(c).length > 0);
});

// ── exportCategoryLabel ───────────────────────────────────────────────────

test('exportCategoryLabel: semiconductors returns "Semiconductors"', () => {
  assert.equal(exportCategoryLabel('semiconductors'), 'Semiconductors');
});

test('exportCategoryLabel: dual-use returns "Dual-Use"', () => {
  assert.equal(exportCategoryLabel('dual-use'), 'Dual-Use');
});

test('exportCategoryLabel: all categories return non-empty strings', () => {
  const cats: ExportCategory[] = ['semiconductors', 'agriculture', 'energy', 'military', 'dual-use'];
  for (const c of cats) assert.ok(exportCategoryLabel(c).length > 0);
});

// ── formatVolumeMt ────────────────────────────────────────────────────────

test('formatVolumeMt: >= 1000 shows billions', () => {
  assert.ok(formatVolumeMt(1000).includes('B t'));
});

test('formatVolumeMt: 1-999 shows millions', () => {
  assert.ok(formatVolumeMt(10).includes('M t'));
});

test('formatVolumeMt: < 1 shows thousands', () => {
  assert.ok(formatVolumeMt(0.5).includes('K t'));
});

test('formatVolumeMt: 850 shows correct Mt format', () => {
  assert.equal(formatVolumeMt(850), '850.0M t');
});

test('formatVolumeMt: 0.01 converts to K tons', () => {
  assert.equal(formatVolumeMt(0.01), '10K t');
});

// ── disputeStatusColor ────────────────────────────────────────────────────

test('disputeStatusColor: monitoring returns green', () => {
  assert.ok(disputeStatusColor('monitoring').includes('#4caf50'));
});

test('disputeStatusColor: active returns yellow', () => {
  assert.ok(disputeStatusColor('active').includes('#facc15'));
});

test('disputeStatusColor: critical returns red', () => {
  assert.ok(disputeStatusColor('critical').includes('#ef4444'));
});

test('disputeStatusColor: resolved returns grey', () => {
  assert.ok(disputeStatusColor('resolved').includes('#9e9e9e'));
});

test('disputeStatusColor: all statuses return non-empty strings', () => {
  const statuses: DisputeStatus[] = ['monitoring', 'active', 'critical', 'resolved'];
  for (const s of statuses) assert.ok(disputeStatusColor(s).length > 0);
});

// ── disputeStatusLabel ────────────────────────────────────────────────────

test('disputeStatusLabel: critical returns "Critical"', () => {
  assert.equal(disputeStatusLabel('critical'), 'Critical');
});

test('disputeStatusLabel: resolved returns "Resolved"', () => {
  assert.equal(disputeStatusLabel('resolved'), 'Resolved');
});

// ── flowRiskColor ─────────────────────────────────────────────────────────

test('flowRiskColor: 0 returns grey', () => {
  assert.ok(flowRiskColor(0).includes('#9e9e9e'));
});

test('flowRiskColor: 4 returns red', () => {
  assert.ok(flowRiskColor(4).includes('#ef4444'));
});

test('flowRiskColor: all levels return non-empty strings', () => {
  const risks: FlowRisk[] = [0, 1, 2, 3, 4];
  for (const r of risks) assert.ok(flowRiskColor(r).length > 0);
});

// ── flowRiskLabel ─────────────────────────────────────────────────────────

test('flowRiskLabel: 0 returns "Minimal"', () => {
  assert.equal(flowRiskLabel(0), 'Minimal');
});

test('flowRiskLabel: 4 returns "Severe"', () => {
  assert.equal(flowRiskLabel(4), 'Severe');
});

test('flowRiskLabel: all levels return non-empty strings', () => {
  const risks: FlowRisk[] = [0, 1, 2, 3, 4];
  for (const r of risks) assert.ok(flowRiskLabel(r).length > 0);
});

// ── formatTradeBn ─────────────────────────────────────────────────────────

test('formatTradeBn: >= 1000 shows trillions', () => {
  assert.ok(formatTradeBn(1500).includes('T'));
});

test('formatTradeBn: >= 100 rounds to whole billions', () => {
  assert.equal(formatTradeBn(575), '$575B');
});

test('formatTradeBn: < 100 shows one decimal', () => {
  assert.equal(formatTradeBn(18.5), '$18.5B');
});

test('formatTradeBn: exactly 100 shows whole number', () => {
  assert.equal(formatTradeBn(100), '$100B');
});

// ── countComprehensiveSanctions ───────────────────────────────────────────

test('countComprehensiveSanctions: empty array returns 0', () => {
  assert.equal(countComprehensiveSanctions([]), 0);
});

test('countComprehensiveSanctions: counts only comprehensive', () => {
  const regimes: SanctionsRegime[] = [
    { target: 'A', imposingParties: 'US', severity: 'comprehensive', annualTradeImpactBn: 100, sectors: 'all' },
    { target: 'B', imposingParties: 'EU', severity: 'sectoral',      annualTradeImpactBn: 50,  sectors: 'tech' },
    { target: 'C', imposingParties: 'UN', severity: 'targeted',      annualTradeImpactBn: 10,  sectors: 'arms' },
  ];
  assert.equal(countComprehensiveSanctions(regimes), 1);
});

test('countComprehensiveSanctions: multiple comprehensive entries', () => {
  const regimes: SanctionsRegime[] = [
    { target: 'A', imposingParties: 'US', severity: 'comprehensive', annualTradeImpactBn: 100, sectors: 'all' },
    { target: 'B', imposingParties: 'EU', severity: 'comprehensive', annualTradeImpactBn: 200, sectors: 'all' },
  ];
  assert.equal(countComprehensiveSanctions(regimes), 2);
});

// ── countCriticalDisputes ─────────────────────────────────────────────────

test('countCriticalDisputes: empty array returns 0', () => {
  assert.equal(countCriticalDisputes([]), 0);
});

test('countCriticalDisputes: counts only critical status', () => {
  const flashpoints: TradeFlashpoint[] = [
    { parties: 'A/B', dispute: 'x', status: 'critical',   tradeAtRiskBn: 100 },
    { parties: 'C/D', dispute: 'y', status: 'active',     tradeAtRiskBn: 50  },
    { parties: 'E/F', dispute: 'z', status: 'monitoring', tradeAtRiskBn: 10  },
  ];
  assert.equal(countCriticalDisputes(flashpoints), 1);
});

// ── countEscalatingTariffs ────────────────────────────────────────────────

test('countEscalatingTariffs: empty array returns 0', () => {
  assert.equal(countEscalatingTariffs([]), 0);
});

test('countEscalatingTariffs: counts escalating + retaliatory', () => {
  const tariffs: TariffEscalation[] = [
    { countries: 'A/B', tariffRate: 25,  stage: 'retaliatory', tradeVolumeBn: 100, primarySectors: 'tech' },
    { countries: 'C/D', tariffRate: 10,  stage: 'escalating',  tradeVolumeBn: 50,  primarySectors: 'steel' },
    { countries: 'E/F', tariffRate: 5,   stage: 'imposed',     tradeVolumeBn: 20,  primarySectors: 'agri' },
    { countries: 'G/H', tariffRate: 2,   stage: 'threat',      tradeVolumeBn: 5,   primarySectors: 'cars' },
  ];
  assert.equal(countEscalatingTariffs(tariffs), 2);
});

// ── totalTradeAtRiskBn ────────────────────────────────────────────────────

test('totalTradeAtRiskBn: empty array returns 0', () => {
  assert.equal(totalTradeAtRiskBn([]), 0);
});

test('totalTradeAtRiskBn: sums all flashpoints', () => {
  const flashpoints: TradeFlashpoint[] = [
    { parties: 'A/B', dispute: 'x', status: 'critical', tradeAtRiskBn: 100 },
    { parties: 'C/D', dispute: 'y', status: 'active',   tradeAtRiskBn: 50  },
  ];
  assert.equal(totalTradeAtRiskBn(flashpoints), 150);
});

// ── Static data integrity ─────────────────────────────────────────────────

test('SANCTIONS_REGIMES: is a non-empty array', () => {
  assert.ok(Array.isArray(SANCTIONS_REGIMES));
  assert.ok(SANCTIONS_REGIMES.length > 0);
});

test('SANCTIONS_REGIMES: all entries have valid severity', () => {
  for (const s of SANCTIONS_REGIMES) {
    assert.ok(['targeted', 'sectoral', 'comprehensive'].includes(s.severity));
    assert.ok(s.annualTradeImpactBn > 0);
    assert.ok(s.target.length > 0);
  }
});

test('SANCTIONS_REGIMES: contains at least one comprehensive entry', () => {
  assert.ok(SANCTIONS_REGIMES.some((s) => s.severity === 'comprehensive'));
});

test('TARIFF_ESCALATIONS: is a non-empty array', () => {
  assert.ok(Array.isArray(TARIFF_ESCALATIONS));
  assert.ok(TARIFF_ESCALATIONS.length > 0);
});

test('TARIFF_ESCALATIONS: all entries have valid stage and positive rate', () => {
  for (const t of TARIFF_ESCALATIONS) {
    assert.ok(['threat', 'imposed', 'escalating', 'retaliatory'].includes(t.stage));
    assert.ok(t.tariffRate > 0);
    assert.ok(t.tradeVolumeBn > 0);
  }
});

test('TARIFF_ESCALATIONS: contains at least one retaliatory entry', () => {
  assert.ok(TARIFF_ESCALATIONS.some((t) => t.stage === 'retaliatory'));
});

test('EXPORT_BANS: is a non-empty array', () => {
  assert.ok(Array.isArray(EXPORT_BANS));
  assert.ok(EXPORT_BANS.length > 0);
});

test('EXPORT_BANS: all entries have valid category and non-empty fields', () => {
  for (const b of EXPORT_BANS) {
    assert.ok(['semiconductors', 'agriculture', 'energy', 'military', 'dual-use'].includes(b.category));
    assert.ok(b.commodity.length > 0);
    assert.ok(b.affectedImporters.length > 0);
    assert.ok(b.volumeMt > 0);
  }
});

test('TRADE_FLASHPOINTS: is a non-empty array', () => {
  assert.ok(Array.isArray(TRADE_FLASHPOINTS));
  assert.ok(TRADE_FLASHPOINTS.length > 0);
});

test('TRADE_FLASHPOINTS: all entries have valid status and positive trade value', () => {
  for (const f of TRADE_FLASHPOINTS) {
    assert.ok(['monitoring', 'active', 'critical', 'resolved'].includes(f.status));
    assert.ok(f.tradeAtRiskBn > 0);
    assert.ok(f.parties.length > 0);
    assert.ok(f.dispute.length > 0);
  }
});

test('TRADE_FLASHPOINTS: contains at least one critical entry', () => {
  assert.ok(TRADE_FLASHPOINTS.some((f) => f.status === 'critical'));
});

test('FLOW_INDEX: is a non-empty array', () => {
  assert.ok(Array.isArray(FLOW_INDEX));
  assert.ok(FLOW_INDEX.length > 0);
});

test('FLOW_INDEX: all entries have risk between 0 and 4', () => {
  for (const r of FLOW_INDEX) {
    assert.ok(r.risk >= 0 && r.risk <= 4);
    assert.ok(r.region.length > 0);
  }
});

test('FLOW_INDEX: contains at least one severe (risk 4) entry', () => {
  assert.ok(FLOW_INDEX.some((r) => r.risk === 4));
});

test('FLOW_INDEX: covers 7 regions', () => {
  assert.equal(FLOW_INDEX.length, 7);
});
