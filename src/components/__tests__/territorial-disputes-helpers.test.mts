import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGlobalTensionIndex,
  getActiveWars,
  getFrozenConflicts,
  getEscalatingDisputes,
  getNuclearRiskDisputes,
  getMostSevere,
  phaseBadgeClass,
  trendArrow,
  severityClass,
  buildRenderData,
  type TerritorialDispute,
  type DisputePhase,
  type DiplomaticTrend,
} from '../territorial-disputes-helpers.js';

const MOCK_DISPUTES: TerritorialDispute[] = [
  { id: 'M1', name: 'War A', parties: ['X', 'Y'], region: 'Europe', phase: 'Active War', trend: 'escalating', severityScore: 10, nuclearRisk: true, activeViolence: true, disputedArea: 'Zone A', description: '', keyDevelopment: '' },
  { id: 'M2', name: 'Standoff B', parties: ['A', 'B'], region: 'Asia', phase: 'Standoff', trend: 'stable', severityScore: 7, nuclearRisk: false, activeViolence: false, disputedArea: 'Zone B', description: '', keyDevelopment: '' },
  { id: 'M3', name: 'Frozen C', parties: ['C', 'D'], region: 'Africa', phase: 'Frozen Conflict', trend: 'de-escalating', severityScore: 5, nuclearRisk: false, activeViolence: false, disputedArea: 'Zone C', description: '', keyDevelopment: '' },
  { id: 'M4', name: 'Escalating D', parties: ['E', 'F'], region: 'Pacific', phase: 'Escalating', trend: 'escalating', severityScore: 8, nuclearRisk: true, activeViolence: false, disputedArea: 'Zone D', description: '', keyDevelopment: '' },
  { id: 'M5', name: 'Latent E', parties: ['G', 'H'], region: 'Arctic', phase: 'Latent', trend: 'stable', severityScore: 3, nuclearRisk: false, activeViolence: false, disputedArea: 'Zone E', description: '', keyDevelopment: '' },
];

describe('computeGlobalTensionIndex', () => {
  it('returns a number between 0 and 100', () => {
    const idx = computeGlobalTensionIndex(MOCK_DISPUTES);
    assert.ok(idx >= 0 && idx <= 100);
  });
  it('returns 0 for empty array', () => {
    assert.equal(computeGlobalTensionIndex([]), 0);
  });
  it('returns higher index for more active conflicts', () => {
    const allWar = MOCK_DISPUTES.map(d => ({ ...d, phase: 'Active War' as DisputePhase, severityScore: 10 }));
    const allLatent = MOCK_DISPUTES.map(d => ({ ...d, phase: 'Latent' as DisputePhase, severityScore: 2 }));
    assert.ok(computeGlobalTensionIndex(allWar) > computeGlobalTensionIndex(allLatent));
  });
  it('returns an integer', () => {
    const idx = computeGlobalTensionIndex(MOCK_DISPUTES);
    assert.equal(idx, Math.round(idx));
  });
  it('single active war with max severity returns high index', () => {
    const single = [{ ...MOCK_DISPUTES[0], severityScore: 10, phase: 'Active War' as DisputePhase, trend: 'escalating' as DiplomaticTrend }];
    assert.ok(computeGlobalTensionIndex(single) > 0);
  });
  it('de-escalating trend lowers the index vs stable trend', () => {
    const base = [{ ...MOCK_DISPUTES[0], phase: 'Active War' as DisputePhase, severityScore: 10 }];
    const stableVer = [{ ...base[0], trend: 'stable' as DiplomaticTrend }];
    const deEscVer = [{ ...base[0], trend: 'de-escalating' as DiplomaticTrend }];
    assert.ok(computeGlobalTensionIndex(stableVer) >= computeGlobalTensionIndex(deEscVer));
  });
  it('escalating trend raises the index vs stable trend', () => {
    const stable = [{ ...MOCK_DISPUTES[1], trend: 'stable' as DiplomaticTrend }];
    const esc = [{ ...MOCK_DISPUTES[1], trend: 'escalating' as DiplomaticTrend }];
    assert.ok(computeGlobalTensionIndex(esc) >= computeGlobalTensionIndex(stable));
  });
});

describe('getActiveWars', () => {
  it('returns only Active War disputes', () => {
    const wars = getActiveWars(MOCK_DISPUTES);
    assert.equal(wars.length, 1);
    assert.equal(wars[0].id, 'M1');
  });
  it('returns empty for no active wars', () => {
    const noWar = MOCK_DISPUTES.filter(d => d.phase !== 'Active War');
    assert.equal(getActiveWars(noWar).length, 0);
  });
  it('returns all when all are active wars', () => {
    const all = MOCK_DISPUTES.map(d => ({ ...d, phase: 'Active War' as DisputePhase }));
    assert.equal(getActiveWars(all).length, MOCK_DISPUTES.length);
  });
  it('does not return Escalating disputes', () => {
    const wars = getActiveWars(MOCK_DISPUTES);
    assert.ok(wars.every(d => d.phase === 'Active War'));
  });
});

describe('getFrozenConflicts', () => {
  it('returns only Frozen Conflict disputes', () => {
    const frozen = getFrozenConflicts(MOCK_DISPUTES);
    assert.equal(frozen.length, 1);
    assert.equal(frozen[0].id, 'M3');
  });
  it('returns empty when none frozen', () => {
    const noFrozen = MOCK_DISPUTES.filter(d => d.phase !== 'Frozen Conflict');
    assert.equal(getFrozenConflicts(noFrozen).length, 0);
  });
  it('all returned disputes are Frozen Conflict', () => {
    const frozen = getFrozenConflicts(MOCK_DISPUTES);
    assert.ok(frozen.every(d => d.phase === 'Frozen Conflict'));
  });
});

describe('getEscalatingDisputes', () => {
  it('returns disputes with Escalating phase or escalating trend', () => {
    const esc = getEscalatingDisputes(MOCK_DISPUTES);
    assert.ok(esc.length >= 2);
  });
  it('includes Escalating phase even with stable trend', () => {
    const d = [{ ...MOCK_DISPUTES[3], trend: 'stable' as DiplomaticTrend }];
    assert.equal(getEscalatingDisputes(d).length, 1);
  });
  it('includes escalating trend even if phase is Standoff', () => {
    const d = [{ ...MOCK_DISPUTES[1], trend: 'escalating' as DiplomaticTrend }];
    assert.equal(getEscalatingDisputes(d).length, 1);
  });
  it('does not include Latent/stable disputes', () => {
    const d = [{ ...MOCK_DISPUTES[4], trend: 'stable' as DiplomaticTrend, phase: 'Latent' as DisputePhase }];
    assert.equal(getEscalatingDisputes(d).length, 0);
  });
  it('returns empty for empty array', () => {
    assert.deepEqual(getEscalatingDisputes([]), []);
  });
});

describe('getNuclearRiskDisputes', () => {
  it('returns only nuclear-risk disputes', () => {
    const nuke = getNuclearRiskDisputes(MOCK_DISPUTES);
    assert.equal(nuke.length, 2);
    assert.ok(nuke.every(d => d.nuclearRisk));
  });
  it('returns empty when none have nuclear risk', () => {
    const noNuke = MOCK_DISPUTES.map(d => ({ ...d, nuclearRisk: false }));
    assert.equal(getNuclearRiskDisputes(noNuke).length, 0);
  });
  it('returns all when all have nuclear risk', () => {
    const allNuke = MOCK_DISPUTES.map(d => ({ ...d, nuclearRisk: true }));
    assert.equal(getNuclearRiskDisputes(allNuke).length, MOCK_DISPUTES.length);
  });
});

describe('getMostSevere', () => {
  it('returns top N by severity score descending', () => {
    const top = getMostSevere(MOCK_DISPUTES, 3);
    assert.equal(top.length, 3);
    for (let i = 1; i < top.length; i++) {
      assert.ok(top[i - 1].severityScore >= top[i].severityScore);
    }
  });
  it('does not mutate original array', () => {
    const orig = MOCK_DISPUTES.map(d => d.id);
    getMostSevere(MOCK_DISPUTES, 2);
    assert.deepEqual(MOCK_DISPUTES.map(d => d.id), orig);
  });
  it('returns all when N > array length', () => {
    const top = getMostSevere(MOCK_DISPUTES, 100);
    assert.equal(top.length, MOCK_DISPUTES.length);
  });
  it('defaults to 3 items', () => {
    assert.equal(getMostSevere(MOCK_DISPUTES).length, 3);
  });
  it('returns empty for empty input', () => {
    assert.deepEqual(getMostSevere([]), []);
  });
  it('first result is highest severity', () => {
    const top = getMostSevere(MOCK_DISPUTES, 1);
    assert.equal(top[0].severityScore, Math.max(...MOCK_DISPUTES.map(d => d.severityScore)));
  });
});

describe('phaseBadgeClass', () => {
  it('returns phase-war for Active War', () => {
    assert.equal(phaseBadgeClass('Active War'), 'phase-war');
  });
  it('returns phase-escalating for Escalating', () => {
    assert.equal(phaseBadgeClass('Escalating'), 'phase-escalating');
  });
  it('returns phase-standoff for Standoff', () => {
    assert.equal(phaseBadgeClass('Standoff'), 'phase-standoff');
  });
  it('returns phase-frozen for Frozen Conflict', () => {
    assert.equal(phaseBadgeClass('Frozen Conflict'), 'phase-frozen');
  });
  it('returns phase-negotiation for Negotiation', () => {
    assert.equal(phaseBadgeClass('Negotiation'), 'phase-negotiation');
  });
  it('returns phase-latent for Latent', () => {
    assert.equal(phaseBadgeClass('Latent'), 'phase-latent');
  });
});

describe('trendArrow', () => {
  it('returns up arrow for escalating', () => {
    assert.equal(trendArrow('escalating'), '↑');
  });
  it('returns right arrow for stable', () => {
    assert.equal(trendArrow('stable'), '→');
  });
  it('returns down arrow for de-escalating', () => {
    assert.equal(trendArrow('de-escalating'), '↓');
  });
});

describe('severityClass', () => {
  it('returns sev-critical for score >= 9', () => {
    assert.equal(severityClass(9), 'sev-critical');
    assert.equal(severityClass(10), 'sev-critical');
  });
  it('returns sev-high for score 7-8', () => {
    assert.equal(severityClass(7), 'sev-high');
    assert.equal(severityClass(8), 'sev-high');
  });
  it('returns sev-medium for score 5-6', () => {
    assert.equal(severityClass(5), 'sev-medium');
    assert.equal(severityClass(6), 'sev-medium');
  });
  it('returns sev-low for score < 5', () => {
    assert.equal(severityClass(4), 'sev-low');
    assert.equal(severityClass(0), 'sev-low');
  });
});

describe('buildRenderData', () => {
  it('returns all required fields', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.disputes));
    assert.equal(typeof d.globalTensionIndex, 'number');
    assert.equal(typeof d.activeWarCount, 'number');
    assert.equal(typeof d.frozenConflictCount, 'number');
    assert.equal(typeof d.escalatingCount, 'number');
    assert.equal(typeof d.nuclearRiskCount, 'number');
    assert.ok(Array.isArray(d.mostSevere));
  });
  it('disputes array is non-empty', () => {
    assert.ok(buildRenderData().disputes.length > 0);
  });
  it('globalTensionIndex is between 0 and 100', () => {
    const idx = buildRenderData().globalTensionIndex;
    assert.ok(idx >= 0 && idx <= 100);
  });
  it('activeWarCount matches actual active wars', () => {
    const d = buildRenderData();
    assert.equal(d.activeWarCount, d.disputes.filter(x => x.phase === 'Active War').length);
  });
  it('nuclearRiskCount matches actual nuclear-risk disputes', () => {
    const d = buildRenderData();
    assert.equal(d.nuclearRiskCount, d.disputes.filter(x => x.nuclearRisk).length);
  });
  it('mostSevere has at most 3 entries', () => {
    assert.ok(buildRenderData().mostSevere.length <= 3);
  });
  it('mostSevere entries are sorted descending by severity', () => {
    const ms = buildRenderData().mostSevere;
    for (let i = 1; i < ms.length; i++) {
      assert.ok(ms[i - 1].severityScore >= ms[i].severityScore);
    }
  });
  it('all disputes have valid phase values', () => {
    const valid = new Set(['Active War', 'Frozen Conflict', 'Escalating', 'Standoff', 'Negotiation', 'Latent']);
    for (const d of buildRenderData().disputes) {
      assert.ok(valid.has(d.phase), `Invalid phase: ${d.phase}`);
    }
  });
  it('all disputes have valid trend values', () => {
    const valid = new Set(['escalating', 'stable', 'de-escalating']);
    for (const d of buildRenderData().disputes) {
      assert.ok(valid.has(d.trend), `Invalid trend: ${d.trend}`);
    }
  });
  it('all severity scores are 1-10', () => {
    for (const d of buildRenderData().disputes) {
      assert.ok(d.severityScore >= 1 && d.severityScore <= 10);
    }
  });
  it('all disputes have non-empty parties arrays', () => {
    for (const d of buildRenderData().disputes) {
      assert.ok(d.parties.length > 0);
    }
  });
  it('frozenConflictCount matches actual frozen conflicts', () => {
    const d = buildRenderData();
    assert.equal(d.frozenConflictCount, d.disputes.filter(x => x.phase === 'Frozen Conflict').length);
  });
  it('escalatingCount matches disputes with escalating trend', () => {
    const d = buildRenderData();
    assert.equal(d.escalatingCount, d.disputes.filter(x => x.trend === 'escalating').length);
  });
  it('all disputes have unique ids', () => {
    const ids = buildRenderData().disputes.map(d => d.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
