/**
 * Tests for TechCompetitionPanel — pure helper functions and data constants.
 *
 * Run with: npx tsx --test tests/components/tech-competition-panel.test.mts
 *
 * Pure-logic tests only; no DOM required.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  severityColor,
  postureColor,
  postureLabel,
  exportScopeLabel,
  aiRestrictionLabel,
  vendorLabel,
  quantumMilestoneLabel,
  decouplingDomainLabel,
  dualUseDomainLabel,
  trendArrow,
  trendColor,
  formatThreshold,
  formatSharePct,
  formatQubits,
  countSevereExportControls,
  countActiveAiRestrictions,
  countBlockedHuaweiMarkets,
  countVerifiedQuantumMilestones,
  countHighDecouplingPairs,
  countActiveTransferCases,
  leadingEdgeShareTotal,
  totalEscalationCount,
  EXPORT_CONTROL_EVENTS,
  AI_COMPUTE_RESTRICTIONS,
  FIVEG_COUNTRY_STATUS,
  QUANTUM_MILESTONES,
  DECOUPLING_INDICATORS,
  DUAL_USE_TRANSFER_CASES,
  CHIP_FAB_CAPACITY,
} from '../../src/components/tech-competition-helpers.ts';

// ── severityColor / postureColor / postureLabel ──────────────────────────

test('severityColor: critical is dark red', () => {
  assert.equal(severityColor('critical'), '#b71c1c');
});

test('severityColor: low is yellow', () => {
  assert.equal(severityColor('low'), '#fdd835');
});

test('postureColor: blocked is dark red, open is green', () => {
  assert.equal(postureColor('blocked'), '#b71c1c');
  assert.equal(postureColor('open'),    '#43a047');
});

test('postureLabel: all four postures resolved', () => {
  assert.equal(postureLabel('blocked'),    'Blocked');
  assert.equal(postureLabel('restricted'), 'Restricted');
  assert.equal(postureLabel('cautious'),   'Cautious');
  assert.equal(postureLabel('open'),       'Open');
});

// ── Type labels ──────────────────────────────────────────────────────────

test('exportScopeLabel: all six scopes resolved', () => {
  assert.equal(exportScopeLabel('eda_tools'),      'EDA Tools');
  assert.equal(exportScopeLabel('lithography'),    'Lithography');
  assert.equal(exportScopeLabel('advanced_logic'), 'Advanced Logic');
  assert.equal(exportScopeLabel('memory_hbm'),     'HBM Memory');
  assert.equal(exportScopeLabel('wide_bandgap'),   'Wide-Bandgap');
  assert.equal(exportScopeLabel('packaging'),      'Advanced Packaging');
});

test('aiRestrictionLabel: all five kinds resolved', () => {
  assert.equal(aiRestrictionLabel('gpu_export_ban'),   'GPU Export Ban');
  assert.equal(aiRestrictionLabel('cluster_size_cap'), 'Cluster Size Cap');
  assert.equal(aiRestrictionLabel('cloud_access_ban'), 'Cloud Access Ban');
  assert.equal(aiRestrictionLabel('model_weights_ban'), 'Model Weights Ban');
  assert.equal(aiRestrictionLabel('license_required'), 'License Required');
});

test('vendorLabel: all seven vendors resolved', () => {
  assert.equal(vendorLabel('huawei'),   'Huawei');
  assert.equal(vendorLabel('zte'),      'ZTE');
  assert.equal(vendorLabel('ericsson'), 'Ericsson');
  assert.equal(vendorLabel('nokia'),    'Nokia');
  assert.equal(vendorLabel('samsung'),  'Samsung');
  assert.equal(vendorLabel('mixed'),    'Mixed Vendors');
  assert.equal(vendorLabel('banned'),   'CN Vendors Banned');
});

test('quantumMilestoneLabel: all five kinds resolved', () => {
  assert.equal(quantumMilestoneLabel('qubit_count'),        'Qubit Count');
  assert.equal(quantumMilestoneLabel('error_correction'),   'Error Correction');
  assert.equal(quantumMilestoneLabel('quantum_advantage'),  'Quantum Advantage');
  assert.equal(quantumMilestoneLabel('commercial_service'), 'Commercial Service');
  assert.equal(quantumMilestoneLabel('cryptanalytic_demo'), 'Cryptanalytic Demo');
});

test('decouplingDomainLabel: all six domains resolved', () => {
  assert.equal(decouplingDomainLabel('investment_screening'), 'Investment Screening');
  assert.equal(decouplingDomainLabel('visa_research'),        'Researcher Visas');
  assert.equal(decouplingDomainLabel('data_localization'),    'Data Localization');
  assert.equal(decouplingDomainLabel('app_ban'),              'App Bans');
  assert.equal(decouplingDomainLabel('standards_split'),      'Standards Split');
  assert.equal(decouplingDomainLabel('supply_chain_exit'),    'Supply Chain Exit');
});

test('dualUseDomainLabel: all six domains resolved', () => {
  assert.equal(dualUseDomainLabel('semiconductors'), 'Semiconductors');
  assert.equal(dualUseDomainLabel('aerospace'),      'Aerospace');
  assert.equal(dualUseDomainLabel('biotech'),        'Biotech');
  assert.equal(dualUseDomainLabel('quantum'),        'Quantum');
  assert.equal(dualUseDomainLabel('ai_models'),      'AI Models');
  assert.equal(dualUseDomainLabel('cyber_tools'),    'Cyber Tools');
});

test('trendArrow: rising/stable/falling render correctly', () => {
  assert.equal(trendArrow('rising'),  '↑');
  assert.equal(trendArrow('stable'),  '→');
  assert.equal(trendArrow('falling'), '↓');
});

test('trendColor: rising is red, falling is green', () => {
  assert.equal(trendColor('rising'),  '#e53935');
  assert.equal(trendColor('falling'), '#43a047');
  assert.equal(trendColor('stable'),  '#9e9e9e');
});

// ── Formatters ───────────────────────────────────────────────────────────

test('formatThreshold: -1 renders as unbounded', () => {
  assert.equal(formatThreshold(-1, 'TPP'), 'unbounded');
});

test('formatThreshold: FLOP unit renders as exponent', () => {
  assert.equal(formatThreshold(1e26, 'FLOP'), '10^26 FLOP');
  assert.equal(formatThreshold(1e25, 'FLOP'), '10^25 FLOP');
});

test('formatThreshold: >=1M renders with M suffix', () => {
  assert.equal(formatThreshold(4_800_000, 'TPP'), '4.8M TPP');
});

test('formatThreshold: >=1k renders with k suffix', () => {
  assert.equal(formatThreshold(4_800, 'TPP'), '4.8k TPP');
  assert.equal(formatThreshold(100_000, 'H100-equiv'), '100.0k H100-equiv');
});

test('formatThreshold: sub-thousand renders raw', () => {
  assert.equal(formatThreshold(500, 'units'), '500 units');
});

test('formatSharePct: zero or negative renders em-dash', () => {
  assert.equal(formatSharePct(0), '—');
  assert.equal(formatSharePct(-1), '—');
});

test('formatSharePct: sub-1% renders compact', () => {
  assert.equal(formatSharePct(0.5), '<1%');
});

test('formatSharePct: round to integer', () => {
  assert.equal(formatSharePct(90), '90%');
  assert.equal(formatSharePct(8.7), '9%');
});

test('formatQubits: negative renders roadmap', () => {
  assert.equal(formatQubits(-1), 'roadmap');
});

test('formatQubits: >=1000 renders with k', () => {
  assert.equal(formatQubits(1_121), '1.1k');
});

test('formatQubits: sub-thousand renders raw', () => {
  assert.equal(formatQubits(105), '105');
});

// ── Aggregate counts ─────────────────────────────────────────────────────

test('countSevereExportControls: counts critical + high', () => {
  const n = countSevereExportControls(EXPORT_CONTROL_EVENTS);
  assert.ok(n >= 4, `expected ≥4 severe export controls, got ${n}`);
});

test('countSevereExportControls: ignores low/medium', () => {
  assert.equal(countSevereExportControls([
    { issuingCountry: 'X', targetCountry: 'Y', scope: 'eda_tools', severity: 'low',    announcedAt: '2024-01-01', reference: '', detail: '' },
    { issuingCountry: 'X', targetCountry: 'Y', scope: 'eda_tools', severity: 'medium', announcedAt: '2024-01-01', reference: '', detail: '' },
  ]), 0);
});

test('countActiveAiRestrictions: counts critical + high only', () => {
  assert.equal(countActiveAiRestrictions([
    { kind: 'gpu_export_ban',   issuingCountry: 'A', targetCountry: 'B', severity: 'critical', thresholdValue: 1, thresholdUnit: 'u', detail: '' },
    { kind: 'cluster_size_cap', issuingCountry: 'A', targetCountry: 'B', severity: 'high',     thresholdValue: 1, thresholdUnit: 'u', detail: '' },
    { kind: 'cloud_access_ban', issuingCountry: 'A', targetCountry: 'B', severity: 'medium',   thresholdValue: 1, thresholdUnit: 'u', detail: '' },
    { kind: 'license_required', issuingCountry: 'A', targetCountry: 'B', severity: 'low',      thresholdValue: 1, thresholdUnit: 'u', detail: '' },
  ]), 2);
});

test('countBlockedHuaweiMarkets: counts blocked + restricted only', () => {
  assert.equal(countBlockedHuaweiMarkets([
    { countryCode: 'A', countryName: 'A', huaweiPosture: 'blocked',    primaryVendor: 'mixed', coveragePct: 50, note: '' },
    { countryCode: 'B', countryName: 'B', huaweiPosture: 'restricted', primaryVendor: 'mixed', coveragePct: 50, note: '' },
    { countryCode: 'C', countryName: 'C', huaweiPosture: 'cautious',   primaryVendor: 'mixed', coveragePct: 50, note: '' },
    { countryCode: 'D', countryName: 'D', huaweiPosture: 'open',       primaryVendor: 'mixed', coveragePct: 50, note: '' },
  ]), 2);
});

test('countVerifiedQuantumMilestones: only peer-reviewed counted', () => {
  assert.equal(countVerifiedQuantumMilestones([
    { org: 'A', countryCode: 'X', kind: 'qubit_count', qubits: 100, announcedAt: '', peerReviewed: true,  detail: '' },
    { org: 'B', countryCode: 'X', kind: 'qubit_count', qubits: 200, announcedAt: '', peerReviewed: false, detail: '' },
    { org: 'C', countryCode: 'X', kind: 'qubit_count', qubits: 300, announcedAt: '', peerReviewed: true,  detail: '' },
  ]), 2);
});

test('countHighDecouplingPairs: intensity >= 60 counts', () => {
  assert.equal(countHighDecouplingPairs([
    { domain: 'app_ban', countryPair: 'A-B', intensity: 30, trend: 'stable', detail: '' },
    { domain: 'app_ban', countryPair: 'A-B', intensity: 60, trend: 'rising', detail: '' },
    { domain: 'app_ban', countryPair: 'A-B', intensity: 75, trend: 'rising', detail: '' },
    { domain: 'app_ban', countryPair: 'A-B', intensity: 59, trend: 'stable', detail: '' },
  ]), 2);
});

test('countActiveTransferCases: anything except sanctioned counts', () => {
  assert.equal(countActiveTransferCases([
    { caseId: 'A', domain: 'semiconductors', originCountry: 'X', destinationCountry: 'Y', severity: 'high', status: 'investigation', detail: '' },
    { caseId: 'B', domain: 'semiconductors', originCountry: 'X', destinationCountry: 'Y', severity: 'high', status: 'indictment',    detail: '' },
    { caseId: 'C', domain: 'semiconductors', originCountry: 'X', destinationCountry: 'Y', severity: 'high', status: 'conviction',    detail: '' },
    { caseId: 'D', domain: 'semiconductors', originCountry: 'X', destinationCountry: 'Y', severity: 'high', status: 'sanctioned',    detail: '' },
  ]), 3);
});

test('leadingEdgeShareTotal: sums share values', () => {
  assert.equal(leadingEdgeShareTotal([
    { countryCode: 'A', countryName: '', leadingEdgeShare: 10, matureNodeShare: 0, leadingEdgeFabs: 0, note: '' },
    { countryCode: 'B', countryName: '', leadingEdgeShare: 25, matureNodeShare: 0, leadingEdgeFabs: 0, note: '' },
    { countryCode: 'C', countryName: '', leadingEdgeShare: 65, matureNodeShare: 0, leadingEdgeFabs: 0, note: '' },
  ]), 100);
});

test('totalEscalationCount: sums all six domain counts', () => {
  const total = totalEscalationCount({
    exportControls: EXPORT_CONTROL_EVENTS,
    aiRestrictions: AI_COMPUTE_RESTRICTIONS,
    fiveG: FIVEG_COUNTRY_STATUS,
    quantum: QUANTUM_MILESTONES,
    decoupling: DECOUPLING_INDICATORS,
    transfers: DUAL_USE_TRANSFER_CASES,
  });
  const expected =
    countSevereExportControls(EXPORT_CONTROL_EVENTS) +
    countActiveAiRestrictions(AI_COMPUTE_RESTRICTIONS) +
    countBlockedHuaweiMarkets(FIVEG_COUNTRY_STATUS) +
    countVerifiedQuantumMilestones(QUANTUM_MILESTONES) +
    countHighDecouplingPairs(DECOUPLING_INDICATORS) +
    countActiveTransferCases(DUAL_USE_TRANSFER_CASES);
  assert.equal(total, expected);
});

// ── Static data integrity ────────────────────────────────────────────────

test('EXPORT_CONTROL_EVENTS: covers US, NL, JP issuers', () => {
  const issuers = new Set(EXPORT_CONTROL_EVENTS.map((e) => e.issuingCountry));
  assert.ok(issuers.has('US'));
  assert.ok(issuers.has('NL'));
  assert.ok(issuers.has('JP'));
});

test('EXPORT_CONTROL_EVENTS: BIS Oct 7 rule present', () => {
  const refs = EXPORT_CONTROL_EVENTS.map((e) => e.reference);
  assert.ok(refs.some((r) => /BIS Oct 7/.test(r)));
});

test('AI_COMPUTE_RESTRICTIONS: includes GPU export ban', () => {
  const kinds = new Set(AI_COMPUTE_RESTRICTIONS.map((r) => r.kind));
  assert.ok(kinds.has('gpu_export_ban'));
  assert.ok(kinds.has('cluster_size_cap'));
});

test('FIVEG_COUNTRY_STATUS: covers Five Eyes + major EU + Asia', () => {
  const codes = new Set(FIVEG_COUNTRY_STATUS.map((s) => s.countryCode));
  for (const c of ['US', 'GB', 'AU', 'DE', 'CN', 'JP', 'KR', 'IN']) {
    assert.ok(codes.has(c), `expected ${c} in FIVEG_COUNTRY_STATUS`);
  }
});

test('FIVEG_COUNTRY_STATUS: coverage pct in [0,100]', () => {
  for (const s of FIVEG_COUNTRY_STATUS) {
    assert.ok(s.coveragePct >= 0 && s.coveragePct <= 100);
  }
});

test('QUANTUM_MILESTONES: covers US, CN, GB orgs', () => {
  const countries = new Set(QUANTUM_MILESTONES.map((m) => m.countryCode));
  assert.ok(countries.has('US'));
  assert.ok(countries.has('CN'));
  assert.ok(countries.has('GB'));
});

test('QUANTUM_MILESTONES: includes IBM and Google Quantum AI', () => {
  const orgs = QUANTUM_MILESTONES.map((m) => m.org);
  assert.ok(orgs.some((o) => /IBM/i.test(o)));
  assert.ok(orgs.some((o) => /Google/i.test(o)));
});

test('DECOUPLING_INDICATORS: intensity in [0,100]', () => {
  for (const d of DECOUPLING_INDICATORS) {
    assert.ok(d.intensity >= 0 && d.intensity <= 100);
  }
});

test('DECOUPLING_INDICATORS: trend values are valid', () => {
  const valid = new Set(['rising', 'stable', 'falling']);
  for (const d of DECOUPLING_INDICATORS) {
    assert.ok(valid.has(d.trend));
  }
});

test('DUAL_USE_TRANSFER_CASES: every case has a unique caseId', () => {
  const ids = DUAL_USE_TRANSFER_CASES.map((c) => c.caseId);
  assert.equal(new Set(ids).size, ids.length);
});

test('DUAL_USE_TRANSFER_CASES: includes semiconductors and aerospace domains', () => {
  const domains = new Set(DUAL_USE_TRANSFER_CASES.map((c) => c.domain));
  assert.ok(domains.has('semiconductors'));
  assert.ok(domains.has('aerospace'));
});

test('CHIP_FAB_CAPACITY: Taiwan dominates leading-edge share', () => {
  const tw = CHIP_FAB_CAPACITY.find((f) => f.countryCode === 'TW');
  assert.ok(tw);
  assert.ok(tw!.leadingEdgeShare >= 80);
});

test('CHIP_FAB_CAPACITY: leadingEdgeShare and matureNodeShare in [0,100]', () => {
  for (const f of CHIP_FAB_CAPACITY) {
    assert.ok(f.leadingEdgeShare >= 0 && f.leadingEdgeShare <= 100);
    assert.ok(f.matureNodeShare  >= 0 && f.matureNodeShare  <= 100);
  }
});

test('CHIP_FAB_CAPACITY: covers TW, KR, US, CN, JP', () => {
  const codes = new Set(CHIP_FAB_CAPACITY.map((f) => f.countryCode));
  for (const c of ['TW', 'KR', 'US', 'CN', 'JP']) {
    assert.ok(codes.has(c), `expected ${c} in CHIP_FAB_CAPACITY`);
  }
});
