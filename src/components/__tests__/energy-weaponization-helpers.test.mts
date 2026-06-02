import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGlobalEnergyRiskIndex,
  getHighRiskDependencies,
  getOngoingCoercion,
  getTotalHistoricImpactBn,
  getCriticalDependencies,
  rankBySeverity,
  riskLevelClass,
  actionClass,
  buildRenderData,
  type EnergyDependency,
  type EnergyCoercionEvent,
  type DependencyRisk,
  type CoercionAction,
} from '../energy-weaponization-helpers.js';

const MOCK_DEPS: EnergyDependency[] = [
  { id: 'D1', importer: 'A', exporter: 'B', commodity: 'Natural Gas', dependencyPct: 80, riskLevel: 'Critical', alternativeExists: false, annualVolume: '50 BCM' },
  { id: 'D2', importer: 'C', exporter: 'D', commodity: 'Oil', dependencyPct: 50, riskLevel: 'High', alternativeExists: true, annualVolume: '2 Mb/d' },
  { id: 'D3', importer: 'E', exporter: 'F', commodity: 'Coal', dependencyPct: 20, riskLevel: 'Medium', alternativeExists: true, annualVolume: '10 Mt' },
  { id: 'D4', importer: 'G', exporter: 'H', commodity: 'Oil', dependencyPct: 10, riskLevel: 'Low', alternativeExists: true, annualVolume: '1 Mb/d' },
];

const MOCK_EVENTS: EnergyCoercionEvent[] = [
  { id: 'E1', date: '2022-03', actor: 'X', target: 'Y', action: 'Supply Cut', commodity: 'Gas', severityScore: 10, description: 'Big cut', ongoing: true, estimatedImpactBn: 200 },
  { id: 'E2', date: '2021-01', actor: 'P', target: 'Q', action: 'Embargo', commodity: 'Oil', severityScore: 6, description: 'Embargo', ongoing: false, estimatedImpactBn: 30 },
  { id: 'E3', date: '2020-05', actor: 'R', target: 'S', action: 'Price Spike', commodity: 'Oil', severityScore: 4, description: 'Spike', ongoing: false, estimatedImpactBn: 10 },
];

describe('computeGlobalEnergyRiskIndex', () => {
  it('returns a number between 0 and 100', () => {
    const idx = computeGlobalEnergyRiskIndex(MOCK_DEPS, MOCK_EVENTS);
    assert.ok(idx >= 0 && idx <= 100, `Got ${idx}`);
  });
  it('returns 0 for empty arrays', () => {
    assert.equal(computeGlobalEnergyRiskIndex([], []), 0);
  });
  it('returns higher index with more critical dependencies', () => {
    const allCrit = MOCK_DEPS.map(d => ({ ...d, riskLevel: 'Critical' as DependencyRisk, dependencyPct: 100 }));
    const allLow = MOCK_DEPS.map(d => ({ ...d, riskLevel: 'Low' as DependencyRisk, dependencyPct: 5 }));
    assert.ok(computeGlobalEnergyRiskIndex(allCrit, []) > computeGlobalEnergyRiskIndex(allLow, []));
  });
  it('ongoing events increase the risk index', () => {
    const withOngoing = computeGlobalEnergyRiskIndex(MOCK_DEPS, MOCK_EVENTS);
    const noOngoing = computeGlobalEnergyRiskIndex(MOCK_DEPS, []);
    assert.ok(withOngoing > noOngoing);
  });
  it('returns integer', () => {
    const idx = computeGlobalEnergyRiskIndex(MOCK_DEPS, MOCK_EVENTS);
    assert.equal(idx, Math.round(idx));
  });
  it('never exceeds 100', () => {
    const allMax = MOCK_DEPS.map(d => ({ ...d, riskLevel: 'Critical' as DependencyRisk, dependencyPct: 100 }));
    const maxEvents = MOCK_EVENTS.map(e => ({ ...e, ongoing: true, severityScore: 10 }));
    assert.ok(computeGlobalEnergyRiskIndex(allMax, maxEvents) <= 100);
  });
});

describe('getHighRiskDependencies', () => {
  it('returns High and Critical dependencies', () => {
    const hr = getHighRiskDependencies(MOCK_DEPS);
    assert.equal(hr.length, 2); // D1=Critical, D2=High
    assert.ok(hr.every(d => d.riskLevel === 'High' || d.riskLevel === 'Critical'));
  });
  it('returns empty when none high/critical', () => {
    const all = MOCK_DEPS.map(d => ({ ...d, riskLevel: 'Low' as DependencyRisk }));
    assert.equal(getHighRiskDependencies(all).length, 0);
  });
  it('returns all when all critical', () => {
    const all = MOCK_DEPS.map(d => ({ ...d, riskLevel: 'Critical' as DependencyRisk }));
    assert.equal(getHighRiskDependencies(all).length, MOCK_DEPS.length);
  });
});

describe('getOngoingCoercion', () => {
  it('returns only ongoing events', () => {
    const ongoing = getOngoingCoercion(MOCK_EVENTS);
    assert.equal(ongoing.length, 1);
    assert.equal(ongoing[0].id, 'E1');
  });
  it('returns empty when none ongoing', () => {
    const none = MOCK_EVENTS.map(e => ({ ...e, ongoing: false }));
    assert.equal(getOngoingCoercion(none).length, 0);
  });
  it('returns all when all ongoing', () => {
    const all = MOCK_EVENTS.map(e => ({ ...e, ongoing: true }));
    assert.equal(getOngoingCoercion(all).length, MOCK_EVENTS.length);
  });
});

describe('getTotalHistoricImpactBn', () => {
  it('sums estimated impact across all events', () => {
    assert.equal(getTotalHistoricImpactBn(MOCK_EVENTS), 240); // 200+30+10
  });
  it('returns 0 for empty array', () => {
    assert.equal(getTotalHistoricImpactBn([]), 0);
  });
  it('handles single event', () => {
    assert.equal(getTotalHistoricImpactBn([MOCK_EVENTS[0]]), 200);
  });
});

describe('getCriticalDependencies', () => {
  it('returns only Critical-level dependencies', () => {
    const crit = getCriticalDependencies(MOCK_DEPS);
    assert.equal(crit.length, 1);
    assert.equal(crit[0].id, 'D1');
  });
  it('returns empty when none critical', () => {
    const all = MOCK_DEPS.map(d => ({ ...d, riskLevel: 'Low' as DependencyRisk }));
    assert.equal(getCriticalDependencies(all).length, 0);
  });
});

describe('rankBySeverity', () => {
  it('returns events sorted by severityScore descending', () => {
    const sorted = rankBySeverity(MOCK_EVENTS);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i - 1].severityScore >= sorted[i].severityScore);
    }
  });
  it('does not mutate original array', () => {
    const orig = MOCK_EVENTS.map(e => e.id);
    rankBySeverity(MOCK_EVENTS);
    assert.deepEqual(MOCK_EVENTS.map(e => e.id), orig);
  });
  it('handles empty array', () => {
    assert.deepEqual(rankBySeverity([]), []);
  });
  it('handles single event', () => {
    const sorted = rankBySeverity([MOCK_EVENTS[0]]);
    assert.equal(sorted.length, 1);
  });
});

describe('riskLevelClass', () => {
  it('returns risk-critical for Critical', () => {
    assert.equal(riskLevelClass('Critical'), 'risk-critical');
  });
  it('returns risk-high for High', () => {
    assert.equal(riskLevelClass('High'), 'risk-high');
  });
  it('returns risk-medium for Medium', () => {
    assert.equal(riskLevelClass('Medium'), 'risk-medium');
  });
  it('returns risk-low for Low', () => {
    assert.equal(riskLevelClass('Low'), 'risk-low');
  });
});

describe('actionClass', () => {
  it('returns action-cut for Supply Cut', () => {
    assert.equal(actionClass('Supply Cut'), 'action-cut');
  });
  it('returns action-price for Price Spike', () => {
    assert.equal(actionClass('Price Spike'), 'action-price');
  });
  it('returns action-transit for Transit Disruption', () => {
    assert.equal(actionClass('Transit Disruption'), 'action-transit');
  });
  it('returns action-attack for Infrastructure Attack', () => {
    assert.equal(actionClass('Infrastructure Attack'), 'action-attack');
  });
  it('returns action-embargo for Embargo', () => {
    assert.equal(actionClass('Embargo'), 'action-embargo');
  });
  it('returns action-price for Weaponized Pricing', () => {
    assert.equal(actionClass('Weaponized Pricing'), 'action-price');
  });
});

describe('buildRenderData', () => {
  it('returns all required fields', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.dependencies));
    assert.ok(Array.isArray(d.events));
    assert.equal(typeof d.globalEnergyRiskIndex, 'number');
    assert.equal(typeof d.ongoingCoercionCount, 'number');
    assert.ok(Array.isArray(d.highRiskDyads));
    assert.equal(typeof d.totalHistoricImpactBn, 'number');
    assert.equal(typeof d.criticalDependencyCount, 'number');
  });
  it('dependencies array is non-empty', () => {
    assert.ok(buildRenderData().dependencies.length > 0);
  });
  it('events array is non-empty', () => {
    assert.ok(buildRenderData().events.length > 0);
  });
  it('globalEnergyRiskIndex is 0-100', () => {
    const idx = buildRenderData().globalEnergyRiskIndex;
    assert.ok(idx >= 0 && idx <= 100);
  });
  it('ongoingCoercionCount matches actual ongoing events', () => {
    const d = buildRenderData();
    assert.equal(d.ongoingCoercionCount, d.events.filter(e => e.ongoing).length);
  });
  it('criticalDependencyCount matches actual', () => {
    const d = buildRenderData();
    assert.equal(d.criticalDependencyCount, d.dependencies.filter(dep => dep.riskLevel === 'Critical').length);
  });
  it('totalHistoricImpactBn matches sum', () => {
    const d = buildRenderData();
    const sum = d.events.reduce((s, e) => s + e.estimatedImpactBn, 0);
    assert.equal(d.totalHistoricImpactBn, sum);
  });
  it('highRiskDyads are all High or Critical', () => {
    const d = buildRenderData();
    assert.ok(d.highRiskDyads.every(dep => dep.riskLevel === 'High' || dep.riskLevel === 'Critical'));
  });
  it('all dependencyPct values are 0-100', () => {
    for (const dep of buildRenderData().dependencies) {
      assert.ok(dep.dependencyPct >= 0 && dep.dependencyPct <= 100);
    }
  });
  it('all event severityScores are 1-10', () => {
    for (const ev of buildRenderData().events) {
      assert.ok(ev.severityScore >= 1 && ev.severityScore <= 10);
    }
  });
  it('all riskLevel values are valid', () => {
    const valid = new Set(['Low', 'Medium', 'High', 'Critical']);
    for (const dep of buildRenderData().dependencies) {
      assert.ok(valid.has(dep.riskLevel));
    }
  });
});
