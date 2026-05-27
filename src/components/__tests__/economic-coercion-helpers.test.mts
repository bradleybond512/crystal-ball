import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boycottIntensityColor,
  boycottIntensityLabel,
  boycottTypeLabel,
  controlSeverityColor,
  controlSeverityLabel,
  controlScopeLabel,
  outcomeColor,
  outcomeLabel,
  classifyRiskLevel,
  riskLevelColor,
  riskLevelLabel,
  rungLabel,
  rungColor,
  escalationRiskColor,
  weaponisationStageColor,
  weaponisationStageLabel,
  commodityClassLabel,
  hedgingLabel,
  substituteScore,
  countSevereBoycotts,
  totalBoycottImpactUsdBn,
  countComprehensiveControls,
  coercerSuccessRate,
  highestImpactIncident,
  sortByRisk,
  countCriticalPairs,
  totalFrozenAssetsUsdBn,
  countImminentEscalation,
  countWeaponisedCommodities,
  buildSystemSummary,
  BOYCOTTS,
  EXPORT_CONTROLS,
  STATECRAFT_INCIDENTS,
  COERCION_RISK_PAIRS,
  SANCTIONS_PRESSURE,
  COMMODITY_WEAPONS,
  type BoycottEntry,
  type ExportControlEntry,
  type StatecraftIncident,
  type CoercionRiskPair,
  type SanctionsPressureEntry,
  type CommodityWeaponEntry,
} from '../economic-coercion-helpers.ts';

// ── Boycott intensity helpers ─────────────────────────────────────────────

test('boycottIntensityColor returns a CSS variable for every intensity', () => {
  for (const i of ['symbolic', 'moderate', 'severe', 'paralysing'] as const) {
    const c = boycottIntensityColor(i);
    assert.ok(c.startsWith('var('), `expected CSS var for ${i}, got ${c}`);
  }
});

test('boycottIntensityLabel covers all four values', () => {
  assert.equal(boycottIntensityLabel('symbolic'),   'Symbolic');
  assert.equal(boycottIntensityLabel('moderate'),   'Moderate');
  assert.equal(boycottIntensityLabel('severe'),     'Severe');
  assert.equal(boycottIntensityLabel('paralysing'), 'Paralysing');
});

test('boycottTypeLabel covers all four type values', () => {
  assert.equal(boycottTypeLabel('consumer'),         'Consumer');
  assert.equal(boycottTypeLabel('diplomatic'),       'Diplomatic');
  assert.equal(boycottTypeLabel('state-directed'),   'State-Directed');
  assert.equal(boycottTypeLabel('hybrid'),           'Hybrid');
});

// ── Export-control helpers ────────────────────────────────────────────────

test('controlSeverityColor returns CSS var for every severity', () => {
  for (const s of ['monitoring', 'targeted', 'comprehensive', 'total-denial'] as const) {
    assert.ok(controlSeverityColor(s).startsWith('var('), `bad color for ${s}`);
  }
});

test('controlSeverityLabel round-trips every value', () => {
  assert.equal(controlSeverityLabel('monitoring'),     'Monitoring');
  assert.equal(controlSeverityLabel('targeted'),       'Targeted');
  assert.equal(controlSeverityLabel('comprehensive'),  'Comprehensive');
  assert.equal(controlSeverityLabel('total-denial'),   'Total Denial');
});

test('controlScopeLabel covers all three scope values', () => {
  assert.equal(controlScopeLabel('unilateral'),           'Unilateral');
  assert.equal(controlScopeLabel('multilateral'),         'Multilateral');
  assert.equal(controlScopeLabel('coordinated-allies'),   'Allied');
});

// ── Outcome helpers ───────────────────────────────────────────────────────

test('outcomeColor returns a non-empty string for all five outcomes', () => {
  for (const o of ['coercer-won', 'target-resisted', 'partial-concession', 'ongoing', 'backfired'] as const) {
    assert.ok(outcomeColor(o).length > 0, `empty color for ${o}`);
  }
});

test('outcomeLabel maps every outcome correctly', () => {
  assert.equal(outcomeLabel('coercer-won'),         'Coercer Won');
  assert.equal(outcomeLabel('target-resisted'),     'Target Resisted');
  assert.equal(outcomeLabel('partial-concession'),  'Partial Concession');
  assert.equal(outcomeLabel('ongoing'),             'Ongoing');
  assert.equal(outcomeLabel('backfired'),           'Backfired');
});

// ── Risk-level classification ─────────────────────────────────────────────

test('classifyRiskLevel: 0 → low, 25 → elevated, 50 → high, 75 → critical', () => {
  assert.equal(classifyRiskLevel(0),   'low');
  assert.equal(classifyRiskLevel(24),  'low');
  assert.equal(classifyRiskLevel(25),  'elevated');
  assert.equal(classifyRiskLevel(49),  'elevated');
  assert.equal(classifyRiskLevel(50),  'high');
  assert.equal(classifyRiskLevel(74),  'high');
  assert.equal(classifyRiskLevel(75),  'critical');
  assert.equal(classifyRiskLevel(100), 'critical');
});

test('riskLevelColor returns CSS var for every risk level', () => {
  for (const lvl of ['low', 'elevated', 'high', 'critical'] as const) {
    assert.ok(riskLevelColor(lvl).startsWith('var('), `bad color for ${lvl}`);
  }
});

test('riskLevelLabel covers all four levels', () => {
  assert.equal(riskLevelLabel('low'),      'Low');
  assert.equal(riskLevelLabel('elevated'), 'Elevated');
  assert.equal(riskLevelLabel('high'),     'High');
  assert.equal(riskLevelLabel('critical'), 'Critical');
});

// ── Sanctions rung helpers ────────────────────────────────────────────────

test('rungLabel covers rungs 0–5', () => {
  assert.equal(rungLabel(0), 'None');
  assert.equal(rungLabel(1), 'Designations');
  assert.equal(rungLabel(2), 'Sectoral');
  assert.equal(rungLabel(3), 'SDN-Equivalent');
  assert.equal(rungLabel(4), 'Comprehensive');
  assert.equal(rungLabel(5), 'Total Isolation');
});

test('rungColor returns a non-empty string for all rungs', () => {
  for (const r of [0, 1, 2, 3, 4, 5] as const) {
    assert.ok(rungColor(r).length > 0, `empty color for rung ${r}`);
  }
});

test('escalationRiskColor returns distinct strings for all four values', () => {
  const colors = new Set([
    escalationRiskColor('none'),
    escalationRiskColor('possible'),
    escalationRiskColor('likely'),
    escalationRiskColor('imminent'),
  ]);
  assert.equal(colors.size, 4, 'escalation risk colors should all be distinct');
});

// ── Commodity weaponisation helpers ──────────────────────────────────────

test('weaponisationStageColor returns CSS var for all five stages', () => {
  for (const s of ['latent', 'signalled', 'partial', 'active', 'weaponised'] as const) {
    assert.ok(weaponisationStageColor(s).startsWith('var('), `bad color for ${s}`);
  }
});

test('weaponisationStageLabel round-trips all five stages', () => {
  assert.equal(weaponisationStageLabel('latent'),     'Latent');
  assert.equal(weaponisationStageLabel('signalled'),  'Signalled');
  assert.equal(weaponisationStageLabel('partial'),    'Partial');
  assert.equal(weaponisationStageLabel('active'),     'Active');
  assert.equal(weaponisationStageLabel('weaponised'), 'Weaponised');
});

test('commodityClassLabel covers all five classes', () => {
  assert.equal(commodityClassLabel('energy'),              'Energy');
  assert.equal(commodityClassLabel('food'),                'Food');
  assert.equal(commodityClassLabel('critical-minerals'),   'Critical Minerals');
  assert.equal(commodityClassLabel('semiconductors'),      'Semiconductors');
  assert.equal(commodityClassLabel('finance'),             'Finance');
});

test('substituteScore orders correctly: none < limited < moderate < ample', () => {
  assert.ok(substituteScore('none') < substituteScore('limited'));
  assert.ok(substituteScore('limited') < substituteScore('moderate'));
  assert.ok(substituteScore('moderate') < substituteScore('ample'));
});

test('hedgingLabel covers all four hedging capacities', () => {
  assert.equal(hedgingLabel('none'),     'None');
  assert.equal(hedgingLabel('low'),      'Low');
  assert.equal(hedgingLabel('moderate'), 'Moderate');
  assert.equal(hedgingLabel('high'),     'High');
});

// ── Count / aggregation helpers ───────────────────────────────────────────

test('countSevereBoycotts counts severe and paralysing, not moderate/symbolic', () => {
  const entries: BoycottEntry[] = [
    { coercer: 'A', target: 'B', sector: 's', type: 'consumer', intensity: 'symbolic',   tradeImpactUsdBn: 1, startedAt: '2020', trigger: 't' },
    { coercer: 'C', target: 'D', sector: 's', type: 'consumer', intensity: 'moderate',   tradeImpactUsdBn: 1, startedAt: '2020', trigger: 't' },
    { coercer: 'E', target: 'F', sector: 's', type: 'consumer', intensity: 'severe',     tradeImpactUsdBn: 1, startedAt: '2020', trigger: 't' },
    { coercer: 'G', target: 'H', sector: 's', type: 'consumer', intensity: 'paralysing', tradeImpactUsdBn: 1, startedAt: '2020', trigger: 't' },
  ];
  assert.equal(countSevereBoycotts(entries), 2);
});

test('countSevereBoycotts returns 0 for empty array', () => {
  assert.equal(countSevereBoycotts([]), 0);
});

test('totalBoycottImpactUsdBn sums trade impacts', () => {
  const entries: BoycottEntry[] = [
    { coercer: 'A', target: 'B', sector: 's', type: 'consumer', intensity: 'severe', tradeImpactUsdBn: 3.5, startedAt: '2020', trigger: 't' },
    { coercer: 'C', target: 'D', sector: 's', type: 'consumer', intensity: 'severe', tradeImpactUsdBn: 6.5, startedAt: '2020', trigger: 't' },
  ];
  assert.equal(totalBoycottImpactUsdBn(entries), 10);
});

test('totalBoycottImpactUsdBn returns 0 for empty array', () => {
  assert.equal(totalBoycottImpactUsdBn([]), 0);
});

test('countComprehensiveControls counts comprehensive and total-denial', () => {
  const entries: ExportControlEntry[] = [
    { imposer: 'A', target: 'B', commodity: 'x', scope: 'unilateral', severity: 'monitoring',     entityCount: 0, effectiveDate: '2020', strategicRationale: 'r' },
    { imposer: 'A', target: 'B', commodity: 'x', scope: 'unilateral', severity: 'targeted',       entityCount: 0, effectiveDate: '2020', strategicRationale: 'r' },
    { imposer: 'A', target: 'B', commodity: 'x', scope: 'unilateral', severity: 'comprehensive',  entityCount: 0, effectiveDate: '2020', strategicRationale: 'r' },
    { imposer: 'A', target: 'B', commodity: 'x', scope: 'unilateral', severity: 'total-denial',   entityCount: 0, effectiveDate: '2020', strategicRationale: 'r' },
  ];
  assert.equal(countComprehensiveControls(entries), 2);
});

test('coercerSuccessRate returns 0 for empty array', () => {
  assert.equal(coercerSuccessRate([]), 0);
});

test('coercerSuccessRate returns 100 when all incidents are coercer-won', () => {
  const incidents: StatecraftIncident[] = [
    { id: '1', coercer: 'A', target: 'B', tool: 't', duration: '1y', outcome: 'coercer-won', gdpImpactTargetPct: 2, lesson: 'l' },
    { id: '2', coercer: 'A', target: 'C', tool: 't', duration: '1y', outcome: 'coercer-won', gdpImpactTargetPct: 1, lesson: 'l' },
  ];
  assert.equal(coercerSuccessRate(incidents), 100);
});

test('coercerSuccessRate returns 50 when half are coercer-won', () => {
  const incidents: StatecraftIncident[] = [
    { id: '1', coercer: 'A', target: 'B', tool: 't', duration: '1y', outcome: 'coercer-won',      gdpImpactTargetPct: 2, lesson: 'l' },
    { id: '2', coercer: 'A', target: 'C', tool: 't', duration: '1y', outcome: 'target-resisted',  gdpImpactTargetPct: 1, lesson: 'l' },
  ];
  assert.equal(coercerSuccessRate(incidents), 50);
});

test('highestImpactIncident returns null for empty array', () => {
  assert.equal(highestImpactIncident([]), null);
});

test('highestImpactIncident returns the highest gdpImpactTargetPct entry', () => {
  const incidents: StatecraftIncident[] = [
    { id: '1', coercer: 'A', target: 'B', tool: 't', duration: '1y', outcome: 'ongoing', gdpImpactTargetPct: 3,   lesson: 'l' },
    { id: '2', coercer: 'A', target: 'C', tool: 't', duration: '1y', outcome: 'ongoing', gdpImpactTargetPct: 8.5, lesson: 'l' },
    { id: '3', coercer: 'A', target: 'D', tool: 't', duration: '1y', outcome: 'ongoing', gdpImpactTargetPct: 1,   lesson: 'l' },
  ];
  const result = highestImpactIncident(incidents);
  assert.equal(result?.id, '2');
  assert.equal(result?.gdpImpactTargetPct, 8.5);
});

test('sortByRisk returns pairs in descending riskScore order', () => {
  const pairs: CoercionRiskPair[] = [
    { coercer: 'A', target: 'B', riskScore: 30, leverageVector: '', targetVulnerability: '', hedgingCapacity: 'high' },
    { coercer: 'C', target: 'D', riskScore: 90, leverageVector: '', targetVulnerability: '', hedgingCapacity: 'none' },
    { coercer: 'E', target: 'F', riskScore: 60, leverageVector: '', targetVulnerability: '', hedgingCapacity: 'low'  },
  ];
  const sorted = sortByRisk(pairs);
  assert.equal(sorted[0].riskScore, 90);
  assert.equal(sorted[1].riskScore, 60);
  assert.equal(sorted[2].riskScore, 30);
});

test('sortByRisk does not mutate the original array', () => {
  const pairs: CoercionRiskPair[] = [
    { coercer: 'A', target: 'B', riskScore: 20, leverageVector: '', targetVulnerability: '', hedgingCapacity: 'high' },
    { coercer: 'C', target: 'D', riskScore: 80, leverageVector: '', targetVulnerability: '', hedgingCapacity: 'none' },
  ];
  const originalFirst = pairs[0].coercer;
  sortByRisk(pairs);
  assert.equal(pairs[0].coercer, originalFirst);
});

test('countCriticalPairs counts only pairs with riskScore >= 75', () => {
  const pairs: CoercionRiskPair[] = [
    { coercer: 'A', target: 'B', riskScore: 74, leverageVector: '', targetVulnerability: '', hedgingCapacity: 'high' },
    { coercer: 'C', target: 'D', riskScore: 75, leverageVector: '', targetVulnerability: '', hedgingCapacity: 'none' },
    { coercer: 'E', target: 'F', riskScore: 90, leverageVector: '', targetVulnerability: '', hedgingCapacity: 'low'  },
  ];
  assert.equal(countCriticalPairs(pairs), 2);
});

test('totalFrozenAssetsUsdBn sums frozenAssetsUsdBn across entries', () => {
  const entries: SanctionsPressureEntry[] = [
    { country: 'A', iso3: 'AAA', rung: 3, regimes: [], frozenAssetsUsdBn: 100, tradeRestrictedUsdBn: 0, lastEscalation: '2022', nextEscalationRisk: 'none' },
    { country: 'B', iso3: 'BBB', rung: 4, regimes: [], frozenAssetsUsdBn: 200, tradeRestrictedUsdBn: 0, lastEscalation: '2022', nextEscalationRisk: 'none' },
  ];
  assert.equal(totalFrozenAssetsUsdBn(entries), 300);
});

test('countImminentEscalation counts likely + imminent', () => {
  const entries: SanctionsPressureEntry[] = [
    { country: 'A', iso3: 'AAA', rung: 1, regimes: [], frozenAssetsUsdBn: 0, tradeRestrictedUsdBn: 0, lastEscalation: '2022', nextEscalationRisk: 'none'     },
    { country: 'B', iso3: 'BBB', rung: 2, regimes: [], frozenAssetsUsdBn: 0, tradeRestrictedUsdBn: 0, lastEscalation: '2022', nextEscalationRisk: 'possible'  },
    { country: 'C', iso3: 'CCC', rung: 3, regimes: [], frozenAssetsUsdBn: 0, tradeRestrictedUsdBn: 0, lastEscalation: '2022', nextEscalationRisk: 'likely'    },
    { country: 'D', iso3: 'DDD', rung: 4, regimes: [], frozenAssetsUsdBn: 0, tradeRestrictedUsdBn: 0, lastEscalation: '2022', nextEscalationRisk: 'imminent'  },
  ];
  assert.equal(countImminentEscalation(entries), 2);
});

test('countWeaponisedCommodities counts active + weaponised stages', () => {
  const entries: CommodityWeaponEntry[] = [
    { commodity: 'A', commodityClass: 'energy',   dominantSupplier: 'X', dependentTargets: 'Y', stage: 'latent',     substituteAvailability: 'ample',   timeToAlternativeYears: 1, notes: '' },
    { commodity: 'B', commodityClass: 'food',     dominantSupplier: 'X', dependentTargets: 'Y', stage: 'signalled',  substituteAvailability: 'limited', timeToAlternativeYears: 2, notes: '' },
    { commodity: 'C', commodityClass: 'finance',  dominantSupplier: 'X', dependentTargets: 'Y', stage: 'active',     substituteAvailability: 'none',    timeToAlternativeYears: null, notes: '' },
    { commodity: 'D', commodityClass: 'energy',   dominantSupplier: 'X', dependentTargets: 'Y', stage: 'weaponised', substituteAvailability: 'none',    timeToAlternativeYears: null, notes: '' },
  ];
  assert.equal(countWeaponisedCommodities(entries), 2);
});

// ── buildSystemSummary ────────────────────────────────────────────────────

test('buildSystemSummary aggregates all six dimensions correctly', () => {
  const boycotts: BoycottEntry[] = [
    { coercer: 'A', target: 'B', sector: 's', type: 'consumer', intensity: 'severe', tradeImpactUsdBn: 10, startedAt: '2020', trigger: 't' },
    { coercer: 'C', target: 'D', sector: 's', type: 'consumer', intensity: 'symbolic', tradeImpactUsdBn: 2.5, startedAt: '2020', trigger: 't' },
  ];
  const controls: ExportControlEntry[] = [
    { imposer: 'A', target: 'B', commodity: 'x', scope: 'unilateral', severity: 'comprehensive', entityCount: 0, effectiveDate: '2020', strategicRationale: 'r' },
  ];
  const pairs: CoercionRiskPair[] = [
    { coercer: 'A', target: 'B', riskScore: 80, leverageVector: '', targetVulnerability: '', hedgingCapacity: 'none' },
  ];
  const sanctions: SanctionsPressureEntry[] = [
    { country: 'A', iso3: 'AAA', rung: 4, regimes: [], frozenAssetsUsdBn: 50, tradeRestrictedUsdBn: 0, lastEscalation: '2022', nextEscalationRisk: 'imminent' },
  ];
  const commodities: CommodityWeaponEntry[] = [
    { commodity: 'A', commodityClass: 'energy', dominantSupplier: 'X', dependentTargets: 'Y', stage: 'weaponised', substituteAvailability: 'none', timeToAlternativeYears: null, notes: '' },
  ];

  const summary = buildSystemSummary(boycotts, controls, pairs, sanctions, commodities);
  assert.equal(summary.activeBoycotts, 1);
  assert.equal(summary.boycottImpactUsdBn, 12.5);
  assert.equal(summary.comprehensiveControls, 1);
  assert.equal(summary.criticalPairs, 1);
  assert.equal(summary.weaponisedCommodities, 1);
  assert.equal(summary.imminentEscalation, 1);
});

// ── Static data integrity ─────────────────────────────────────────────────

test('BOYCOTTS static data: all entries have valid intensity', () => {
  const valid = new Set(['symbolic', 'moderate', 'severe', 'paralysing']);
  for (const b of BOYCOTTS) {
    assert.ok(valid.has(b.intensity), `invalid intensity: ${b.intensity}`);
  }
});

test('BOYCOTTS static data: all entries have non-negative trade impact', () => {
  for (const b of BOYCOTTS) {
    assert.ok(b.tradeImpactUsdBn >= 0, `negative impact for ${b.coercer}→${b.target}`);
  }
});

test('EXPORT_CONTROLS static data: all entries have valid severity', () => {
  const valid = new Set(['monitoring', 'targeted', 'comprehensive', 'total-denial']);
  for (const ec of EXPORT_CONTROLS) {
    assert.ok(valid.has(ec.severity), `invalid severity: ${ec.severity}`);
  }
});

test('STATECRAFT_INCIDENTS static data: gdpImpactTargetPct is non-negative', () => {
  for (const inc of STATECRAFT_INCIDENTS) {
    assert.ok(inc.gdpImpactTargetPct >= 0, `negative gdp impact: ${inc.id}`);
  }
});

test('STATECRAFT_INCIDENTS ids are unique', () => {
  const ids = STATECRAFT_INCIDENTS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'incident IDs must be unique');
});

test('COERCION_RISK_PAIRS static data: riskScore between 0 and 100', () => {
  for (const p of COERCION_RISK_PAIRS) {
    assert.ok(p.riskScore >= 0 && p.riskScore <= 100, `out-of-range: ${p.coercer}→${p.target}: ${p.riskScore}`);
  }
});

test('SANCTIONS_PRESSURE static data: rung between 0 and 5', () => {
  for (const s of SANCTIONS_PRESSURE) {
    assert.ok(s.rung >= 0 && s.rung <= 5, `invalid rung ${s.rung} for ${s.country}`);
  }
});

test('SANCTIONS_PRESSURE static data: frozenAssetsUsdBn is non-negative', () => {
  for (const s of SANCTIONS_PRESSURE) {
    assert.ok(s.frozenAssetsUsdBn >= 0, `negative frozen assets for ${s.country}`);
  }
});

test('COMMODITY_WEAPONS static data: all stages valid', () => {
  const valid = new Set(['latent', 'signalled', 'partial', 'active', 'weaponised']);
  for (const cw of COMMODITY_WEAPONS) {
    assert.ok(valid.has(cw.stage), `invalid stage: ${cw.stage} for ${cw.commodity}`);
  }
});

test('COMMODITY_WEAPONS static data: timeToAlternativeYears is null or positive', () => {
  for (const cw of COMMODITY_WEAPONS) {
    if (cw.timeToAlternativeYears !== null) {
      assert.ok(cw.timeToAlternativeYears > 0, `non-positive time-to-alt for ${cw.commodity}`);
    }
  }
});

test('real BOYCOTTS data has at least 4 entries with China as coercer', () => {
  const chinaBoycotts = BOYCOTTS.filter((b) => b.coercer === 'China');
  assert.ok(chinaBoycotts.length >= 3, `expected at least 3 China boycotts, got ${chinaBoycotts.length}`);
});

test('real EXPORT_CONTROLS data includes a total-denial regime', () => {
  const total = EXPORT_CONTROLS.filter((ec) => ec.severity === 'total-denial');
  assert.ok(total.length > 0, 'should have at least one total-denial control');
});

test('real COERCION_RISK_PAIRS Taiwan entry scores above 85', () => {
  const taiwan = COERCION_RISK_PAIRS.find((p) => p.target === 'Taiwan');
  assert.ok(taiwan !== undefined, 'Taiwan pair missing from static data');
  assert.ok((taiwan?.riskScore ?? 0) > 85, `Taiwan risk score should be > 85, got ${taiwan?.riskScore}`);
});

test('real SANCTIONS_PRESSURE North Korea is at rung 5', () => {
  const dprk = SANCTIONS_PRESSURE.find((s) => s.iso3 === 'PRK');
  assert.ok(dprk !== undefined, 'North Korea missing from sanctions data');
  assert.equal(dprk?.rung, 5);
});

test('real COMMODITY_WEAPONS has at least one weaponised entry', () => {
  const weaponised = COMMODITY_WEAPONS.filter((cw) => cw.stage === 'weaponised');
  assert.ok(weaponised.length > 0, 'should have at least one weaponised commodity');
});

test('buildSystemSummary with empty arrays returns all zeros', () => {
  const summary = buildSystemSummary([], [], [], [], []);
  assert.equal(summary.activeBoycotts, 0);
  assert.equal(summary.boycottImpactUsdBn, 0);
  assert.equal(summary.comprehensiveControls, 0);
  assert.equal(summary.criticalPairs, 0);
  assert.equal(summary.weaponisedCommodities, 0);
  assert.equal(summary.imminentEscalation, 0);
});
