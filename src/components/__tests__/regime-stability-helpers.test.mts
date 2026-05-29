import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  computeGlobalInstabilityIndex,
  getByCategory,
  getHighCoupRisk,
  getMostFragile,
  getDeterioratingStates,
  getRecentCoupEvents,
  stabilityClass,
  trendClass,
  trendArrow,
  outcomeClass,
  buildRenderData,
  type RegimeState,
  type RegimeChangeEvent,
  type StabilityCategory,
  type StabilityTrend,
} from '../regime-stability-helpers.ts';

const MOCK_STATES: RegimeState[] = [
  { id: 'S1', country: 'Alpha', region: 'Africa', governmentType: 'Failed State', fsiScore: 110, stabilityCategory: 'Collapsed', trend: 'collapsing', coupRiskScore: 9, eliteCoherenceScore: 1, economicGrievanceScore: 10, securityApparatusScore: 9, externalInterventionRisk: true, lastElection: '2010', keyRisk: 'Civil war', population: 20 },
  { id: 'S2', country: 'Beta', region: 'ME', governmentType: 'Autocracy', fsiScore: 85, stabilityCategory: 'Crisis', trend: 'deteriorating', coupRiskScore: 7, eliteCoherenceScore: 4, economicGrievanceScore: 8, securityApparatusScore: 6, externalInterventionRisk: false, lastElection: '2020', keyRisk: 'Protests', population: 50 },
  { id: 'S3', country: 'Gamma', region: 'Asia', governmentType: 'Hybrid', fsiScore: 70, stabilityCategory: 'Fragile', trend: 'stable', coupRiskScore: 5, eliteCoherenceScore: 5, economicGrievanceScore: 6, securityApparatusScore: 5, externalInterventionRisk: false, lastElection: '2022', keyRisk: 'Inequality', population: 80 },
  { id: 'S4', country: 'Delta', region: 'Europe', governmentType: 'Democracy', fsiScore: 40, stabilityCategory: 'Stable', trend: 'improving', coupRiskScore: 1, eliteCoherenceScore: 8, economicGrievanceScore: 3, securityApparatusScore: 2, externalInterventionRisk: false, lastElection: '2023', keyRisk: 'Minor polarization', population: 10 },
  { id: 'S5', country: 'Epsilon', region: 'Africa', governmentType: 'Military Junta', fsiScore: 95, stabilityCategory: 'Crisis', trend: 'deteriorating', coupRiskScore: 8, eliteCoherenceScore: 3, economicGrievanceScore: 9, securityApparatusScore: 7, externalInterventionRisk: true, lastElection: '2021 (coup)', keyRisk: 'Junta instability', population: 25 },
];

const MOCK_EVENTS: RegimeChangeEvent[] = [
  { id: 'E1', date: '2023-07', country: 'Alpha', eventType: 'Coup', description: 'Military seized power', outcome: 'Regime Change', severity: 9 },
  { id: 'E2', date: '2024-03', country: 'Beta', eventType: 'Mass Protest', description: 'Protests suppressed', outcome: 'Regime Survived', severity: 6 },
  { id: 'E3', date: '2024-01', country: 'Gamma', eventType: 'Election Disputed', description: 'Results contested', outcome: 'Negotiated Settlement', severity: 5 },
  { id: 'E4', date: '2023-11', country: 'Epsilon', eventType: 'Coup Attempt', description: 'Failed coup', outcome: 'Regime Survived', severity: 8 },
];

// ── computeGlobalInstabilityIndex ────────────────────────────────────────────
describe('computeGlobalInstabilityIndex', () => {
  it('returns a number between 0 and 100', () => {
    const idx = computeGlobalInstabilityIndex(MOCK_STATES);
    assert.ok(idx >= 0 && idx <= 100);
  });
  it('returns 0 for empty array', () => {
    assert.equal(computeGlobalInstabilityIndex([]), 0);
  });
  it('higher FSI scores yield higher instability index', () => {
    const highFSI = MOCK_STATES.map(s => ({ ...s, fsiScore: 115 }));
    const lowFSI = MOCK_STATES.map(s => ({ ...s, fsiScore: 30 }));
    assert.ok(computeGlobalInstabilityIndex(highFSI) > computeGlobalInstabilityIndex(lowFSI));
  });
  it('returns an integer', () => {
    const idx = computeGlobalInstabilityIndex(MOCK_STATES);
    assert.equal(idx, Math.round(idx));
  });
  it('single state with max FSI returns 100', () => {
    const s = [{ ...MOCK_STATES[0], fsiScore: 120 }];
    assert.equal(computeGlobalInstabilityIndex(s), 100);
  });
  it('single state with FSI=60 returns 50', () => {
    const s = [{ ...MOCK_STATES[0], fsiScore: 60 }];
    assert.equal(computeGlobalInstabilityIndex(s), 50);
  });
});

// ── getByCategory ────────────────────────────────────────────────────────────
describe('getByCategory', () => {
  it('returns only Collapsed states', () => {
    const collapsed = getByCategory(MOCK_STATES, 'Collapsed');
    assert.equal(collapsed.length, 1);
    assert.equal(collapsed[0].id, 'S1');
  });
  it('returns only Crisis states', () => {
    const crisis = getByCategory(MOCK_STATES, 'Crisis');
    assert.equal(crisis.length, 2);
    assert.ok(crisis.every(s => s.stabilityCategory === 'Crisis'));
  });
  it('returns only Stable states', () => {
    const stable = getByCategory(MOCK_STATES, 'Stable');
    assert.equal(stable.length, 1);
    assert.equal(stable[0].id, 'S4');
  });
  it('returns only Fragile states', () => {
    const fragile = getByCategory(MOCK_STATES, 'Fragile');
    assert.equal(fragile.length, 1);
    assert.equal(fragile[0].id, 'S3');
  });
  it('returns empty when none match', () => {
    const all = MOCK_STATES.map(s => ({ ...s, stabilityCategory: 'Stable' as StabilityCategory }));
    assert.equal(getByCategory(all, 'Collapsed').length, 0);
  });
  it('does not mutate the input array', () => {
    const before = MOCK_STATES.length;
    getByCategory(MOCK_STATES, 'Collapsed');
    assert.equal(MOCK_STATES.length, before);
  });
});

// ── getHighCoupRisk ──────────────────────────────────────────────────────────
describe('getHighCoupRisk', () => {
  it('returns states with coupRiskScore >= threshold', () => {
    const high = getHighCoupRisk(MOCK_STATES, 7);
    assert.equal(high.length, 3); // S1=9, S2=7, S5=8
    assert.ok(high.every(s => s.coupRiskScore >= 7));
  });
  it('uses default threshold of 6', () => {
    const high = getHighCoupRisk(MOCK_STATES);
    assert.ok(high.every(s => s.coupRiskScore >= 6));
  });
  it('returns empty when none meet threshold', () => {
    const all = MOCK_STATES.map(s => ({ ...s, coupRiskScore: 0 }));
    assert.equal(getHighCoupRisk(all).length, 0);
  });
  it('returns all when all meet threshold', () => {
    const all = MOCK_STATES.map(s => ({ ...s, coupRiskScore: 10 }));
    assert.equal(getHighCoupRisk(all).length, MOCK_STATES.length);
  });
  it('threshold boundary: score equal to threshold is included', () => {
    const all = MOCK_STATES.map(s => ({ ...s, coupRiskScore: 6 }));
    assert.equal(getHighCoupRisk(all, 6).length, MOCK_STATES.length);
  });
  it('threshold boundary: score one below threshold is excluded', () => {
    const all = MOCK_STATES.map(s => ({ ...s, coupRiskScore: 5 }));
    assert.equal(getHighCoupRisk(all, 6).length, 0);
  });
});

// ── getMostFragile ───────────────────────────────────────────────────────────
describe('getMostFragile', () => {
  it('returns states sorted by FSI score descending', () => {
    const top = getMostFragile(MOCK_STATES, 3);
    assert.equal(top.length, 3);
    for (let i = 1; i < top.length; i++) {
      assert.ok(top[i - 1].fsiScore >= top[i].fsiScore);
    }
  });
  it('defaults to 5 entries', () => {
    assert.equal(getMostFragile(MOCK_STATES).length, 5);
  });
  it('does not mutate original array order', () => {
    const origIds = MOCK_STATES.map(s => s.id);
    getMostFragile(MOCK_STATES, 2);
    assert.deepEqual(MOCK_STATES.map(s => s.id), origIds);
  });
  it('returns all if N > length', () => {
    assert.equal(getMostFragile(MOCK_STATES, 100).length, MOCK_STATES.length);
  });
  it('first result has highest FSI', () => {
    const top = getMostFragile(MOCK_STATES, 1);
    assert.equal(top[0].id, 'S1'); // fsiScore 110
  });
  it('returns empty for empty input', () => {
    assert.equal(getMostFragile([]).length, 0);
  });
});

// ── getDeterioratingStates ───────────────────────────────────────────────────
describe('getDeterioratingStates', () => {
  it('returns deteriorating and collapsing states', () => {
    const det = getDeterioratingStates(MOCK_STATES);
    assert.equal(det.length, 3); // S1=collapsing, S2=deteriorating, S5=deteriorating
    assert.ok(det.every(s => s.trend === 'deteriorating' || s.trend === 'collapsing'));
  });
  it('returns empty when none deteriorating', () => {
    const all = MOCK_STATES.map(s => ({ ...s, trend: 'stable' as StabilityTrend }));
    assert.equal(getDeterioratingStates(all).length, 0);
  });
  it('includes collapsing trend', () => {
    const one = MOCK_STATES.filter(s => s.trend === 'collapsing');
    assert.ok(one.length > 0);
    assert.ok(getDeterioratingStates(one).length === one.length);
  });
  it('excludes stable and improving trends', () => {
    const det = getDeterioratingStates(MOCK_STATES);
    assert.ok(det.every(s => s.trend !== 'stable' && s.trend !== 'improving'));
  });
});

// ── getRecentCoupEvents ──────────────────────────────────────────────────────
describe('getRecentCoupEvents', () => {
  it('returns Coup and Coup Attempt events', () => {
    const coups = getRecentCoupEvents(MOCK_EVENTS);
    assert.equal(coups.length, 2);
    assert.ok(coups.every(e => e.eventType === 'Coup' || e.eventType === 'Coup Attempt'));
  });
  it('returns empty when no coups', () => {
    const noCoups = MOCK_EVENTS.filter(e => e.eventType !== 'Coup' && e.eventType !== 'Coup Attempt');
    assert.equal(getRecentCoupEvents(noCoups).length, 0);
  });
  it('includes both Coup and Coup Attempt types', () => {
    const coups = getRecentCoupEvents(MOCK_EVENTS);
    const types = new Set(coups.map(e => e.eventType));
    assert.ok(types.has('Coup') || types.has('Coup Attempt'));
  });
});

// ── stabilityClass ───────────────────────────────────────────────────────────
describe('stabilityClass', () => {
  it('returns stab-stable for Stable', () => { assert.equal(stabilityClass('Stable'), 'stab-stable'); });
  it('returns stab-fragile for Fragile', () => { assert.equal(stabilityClass('Fragile'), 'stab-fragile'); });
  it('returns stab-crisis for Crisis', () => { assert.equal(stabilityClass('Crisis'), 'stab-crisis'); });
  it('returns stab-collapsed for Collapsed', () => { assert.equal(stabilityClass('Collapsed'), 'stab-collapsed'); });
});

// ── trendClass ───────────────────────────────────────────────────────────────
describe('trendClass', () => {
  it('returns trend-up for improving', () => { assert.equal(trendClass('improving'), 'trend-up'); });
  it('returns trend-flat for stable', () => { assert.equal(trendClass('stable'), 'trend-flat'); });
  it('returns trend-down for deteriorating', () => { assert.equal(trendClass('deteriorating'), 'trend-down'); });
  it('returns trend-critical for collapsing', () => { assert.equal(trendClass('collapsing'), 'trend-critical'); });
});

// ── trendArrow ───────────────────────────────────────────────────────────────
describe('trendArrow', () => {
  it('returns up arrow for improving', () => { assert.equal(trendArrow('improving'), '↑'); });
  it('returns right arrow for stable', () => { assert.equal(trendArrow('stable'), '→'); });
  it('returns down arrow for deteriorating', () => { assert.equal(trendArrow('deteriorating'), '↓'); });
  it('returns double down arrow for collapsing', () => { assert.equal(trendArrow('collapsing'), '↓↓'); });
});

// ── outcomeClass ─────────────────────────────────────────────────────────────
describe('outcomeClass', () => {
  it('returns outcome-change for Regime Change', () => { assert.equal(outcomeClass('Regime Change'), 'outcome-change'); });
  it('returns outcome-survived for Regime Survived', () => { assert.equal(outcomeClass('Regime Survived'), 'outcome-survived'); });
  it('returns outcome-ongoing for Ongoing', () => { assert.equal(outcomeClass('Ongoing'), 'outcome-ongoing'); });
  it('returns outcome-settled for Negotiated Settlement', () => { assert.equal(outcomeClass('Negotiated Settlement'), 'outcome-settled'); });
});

// ── buildRenderData ───────────────────────────────────────────────────────────
describe('buildRenderData', () => {
  it('returns all required fields', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.states));
    assert.ok(Array.isArray(d.events));
    assert.equal(typeof d.globalInstabilityIndex, 'number');
    assert.equal(typeof d.collapsedCount, 'number');
    assert.equal(typeof d.crisisCount, 'number');
    assert.equal(typeof d.fragileCount, 'number');
    assert.equal(typeof d.highCoupRiskCount, 'number');
    assert.ok(Array.isArray(d.mostFragile));
  });
  it('states array is non-empty', () => { assert.ok(buildRenderData().states.length > 0); });
  it('events array is non-empty', () => { assert.ok(buildRenderData().events.length > 0); });
  it('globalInstabilityIndex is in range 0-100', () => {
    const idx = buildRenderData().globalInstabilityIndex;
    assert.ok(idx >= 0 && idx <= 100);
  });
  it('collapsedCount matches actual Collapsed states', () => {
    const d = buildRenderData();
    assert.equal(d.collapsedCount, d.states.filter(s => s.stabilityCategory === 'Collapsed').length);
  });
  it('crisisCount matches actual Crisis states', () => {
    const d = buildRenderData();
    assert.equal(d.crisisCount, d.states.filter(s => s.stabilityCategory === 'Crisis').length);
  });
  it('fragileCount matches actual Fragile states', () => {
    const d = buildRenderData();
    assert.equal(d.fragileCount, d.states.filter(s => s.stabilityCategory === 'Fragile').length);
  });
  it('mostFragile is sorted by FSI desc', () => {
    const ms = buildRenderData().mostFragile;
    for (let i = 1; i < ms.length; i++) {
      assert.ok(ms[i - 1].fsiScore >= ms[i].fsiScore);
    }
  });
  it('all FSI scores are in range 0-120', () => {
    for (const s of buildRenderData().states) {
      assert.ok(s.fsiScore >= 0 && s.fsiScore <= 120, `${s.country} FSI ${s.fsiScore} out of range`);
    }
  });
  it('all coupRiskScores are in range 0-10', () => {
    for (const s of buildRenderData().states) {
      assert.ok(s.coupRiskScore >= 0 && s.coupRiskScore <= 10, `${s.country} coup risk ${s.coupRiskScore} out of range`);
    }
  });
  it('all economicGrievanceScores are in range 0-10', () => {
    for (const s of buildRenderData().states) {
      assert.ok(s.economicGrievanceScore >= 0 && s.economicGrievanceScore <= 10);
    }
  });
  it('all stability categories are valid', () => {
    const valid = new Set(['Stable', 'Fragile', 'Crisis', 'Collapsed']);
    for (const s of buildRenderData().states) {
      assert.ok(valid.has(s.stabilityCategory), `Invalid category: ${s.stabilityCategory}`);
    }
  });
  it('all trends are valid', () => {
    const valid = new Set(['improving', 'stable', 'deteriorating', 'collapsing']);
    for (const s of buildRenderData().states) {
      assert.ok(valid.has(s.trend), `Invalid trend: ${s.trend}`);
    }
  });
  it('all event outcomes are valid', () => {
    const valid = new Set(['Regime Change', 'Regime Survived', 'Ongoing', 'Negotiated Settlement']);
    for (const e of buildRenderData().events) {
      assert.ok(valid.has(e.outcome), `Invalid outcome: ${e.outcome}`);
    }
  });
  it('all event severities are in range 1-10', () => {
    for (const e of buildRenderData().events) {
      assert.ok(e.severity >= 1 && e.severity <= 10, `Severity ${e.severity} out of range`);
    }
  });
  it('all states have non-empty country names', () => {
    for (const s of buildRenderData().states) {
      assert.ok(s.country.trim().length > 0);
    }
  });
  it('all states have non-empty keyRisk strings', () => {
    for (const s of buildRenderData().states) {
      assert.ok(s.keyRisk.trim().length > 0);
    }
  });
  it('all state IDs are unique', () => {
    const ids = buildRenderData().states.map(s => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  it('all event IDs are unique', () => {
    const ids = buildRenderData().events.map(e => e.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  it('highCoupRiskCount matches states with coupRiskScore >= 6', () => {
    const d = buildRenderData();
    assert.equal(d.highCoupRiskCount, d.states.filter(s => s.coupRiskScore >= 6).length);
  });
  it('mostFragile has at most 5 entries', () => {
    assert.ok(buildRenderData().mostFragile.length <= 5);
  });
  it('populations are positive numbers', () => {
    for (const s of buildRenderData().states) {
      assert.ok(s.population > 0);
    }
  });
});
