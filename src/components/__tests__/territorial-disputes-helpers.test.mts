import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  scoreDisputeSeverity,
  filterByPhase,
  filterByRegion,
  filterByTrend,
  rankByseverity,
  computeGlobalTensionIndex,
  getPhaseDistribution,
  getIncidentsForDispute,
  getRecentHighSeverityIncidents,
  buildRenderData,
  type TerritorialDispute,
  type DisputeIncident,
  type DisputePhase,
  type DisputeRegion,
} from '../territorial-disputes-helpers.ts';

// ── fixtures ─────────────────────────────────────────────────────────────────

function makeDispute(overrides: Partial<TerritorialDispute> = {}): TerritorialDispute {
  return {
    id: 'test-dispute',
    name: 'Test Dispute',
    region: 'Europe',
    claimants: ['A', 'B'],
    primaryAggressor: 'A',
    phase: 'contested',
    escalationTrend: 'stable',
    militaryPresenceScore: 50,
    economicStakes: 50,
    resolutionProspect: 50,
    affectedAreaKm2: 1000,
    keyIssue: 'Test issue',
    lastIncident: '2024-01-01',
    ...overrides,
  };
}

function makeIncident(overrides: Partial<DisputeIncident> = {}): DisputeIncident {
  return {
    id: 'inc-1',
    disputeId: 'test-dispute',
    date: '2024-06-01',
    type: 'naval-incident',
    severity: 5,
    description: 'Test incident',
    ...overrides,
  };
}

// ── scoreDisputeSeverity ──────────────────────────────────────────────────────

describe('scoreDisputeSeverity', () => {
  it('armed-conflict yields higher score than diplomatic', () => {
    const armed = makeDispute({ phase: 'armed-conflict', militaryPresenceScore: 50, economicStakes: 50, escalationTrend: 'stable' });
    const diplo = makeDispute({ phase: 'diplomatic', militaryPresenceScore: 50, economicStakes: 50, escalationTrend: 'stable' });
    assert.ok(scoreDisputeSeverity(armed) > scoreDisputeSeverity(diplo));
  });

  it('escalating trend multiplies score upward vs stable', () => {
    const escalating = makeDispute({ escalationTrend: 'escalating' });
    const stable = makeDispute({ escalationTrend: 'stable' });
    assert.ok(scoreDisputeSeverity(escalating) > scoreDisputeSeverity(stable));
  });

  it('de-escalating trend reduces score vs stable', () => {
    const deesc = makeDispute({ escalationTrend: 'de-escalating' });
    const stable = makeDispute({ escalationTrend: 'stable' });
    assert.ok(scoreDisputeSeverity(deesc) < scoreDisputeSeverity(stable));
  });

  it('result is capped at 100', () => {
    const extreme = makeDispute({ phase: 'armed-conflict', militaryPresenceScore: 100, economicStakes: 100, escalationTrend: 'escalating' });
    assert.ok(scoreDisputeSeverity(extreme) <= 100);
  });

  it('result is a non-negative integer', () => {
    const d = makeDispute();
    const score = scoreDisputeSeverity(d);
    assert.ok(Number.isInteger(score));
    assert.ok(score >= 0);
  });

  it('higher militaryPresenceScore raises severity', () => {
    const lo = makeDispute({ militaryPresenceScore: 10 });
    const hi = makeDispute({ militaryPresenceScore: 90 });
    assert.ok(scoreDisputeSeverity(hi) > scoreDisputeSeverity(lo));
  });

  it('higher economicStakes raises severity', () => {
    const lo = makeDispute({ economicStakes: 10 });
    const hi = makeDispute({ economicStakes: 90 });
    assert.ok(scoreDisputeSeverity(hi) > scoreDisputeSeverity(lo));
  });

  it('phase ordering: armed-conflict > militarized > contested > frozen-conflict > diplomatic', () => {
    const phases: DisputePhase[] = ['armed-conflict', 'militarized', 'contested', 'frozen-conflict', 'diplomatic'];
    const scores = phases.map(phase => scoreDisputeSeverity(makeDispute({ phase, militaryPresenceScore: 0, economicStakes: 0, escalationTrend: 'stable' })));
    for (let i = 0; i < scores.length - 1; i++) {
      assert.ok(scores[i] > scores[i + 1], `${phases[i]} should score higher than ${phases[i + 1]}`);
    }
  });
});

// ── filterByPhase ─────────────────────────────────────────────────────────────

describe('filterByPhase', () => {
  it('returns only disputes matching phase', () => {
    const disputes = [
      makeDispute({ id: 'a', phase: 'armed-conflict' }),
      makeDispute({ id: 'b', phase: 'diplomatic' }),
      makeDispute({ id: 'c', phase: 'armed-conflict' }),
    ];
    const result = filterByPhase(disputes, 'armed-conflict');
    assert.equal(result.length, 2);
    assert.ok(result.every(d => d.phase === 'armed-conflict'));
  });

  it('returns empty array when no matches', () => {
    const disputes = [makeDispute({ phase: 'diplomatic' })];
    assert.deepEqual(filterByPhase(disputes, 'contested'), []);
  });

  it('does not mutate the original array', () => {
    const disputes = [makeDispute({ phase: 'militarized' })];
    filterByPhase(disputes, 'militarized');
    assert.equal(disputes.length, 1);
  });
});

// ── filterByRegion ────────────────────────────────────────────────────────────

describe('filterByRegion', () => {
  it('returns only disputes in the given region', () => {
    const disputes = [
      makeDispute({ id: 'a', region: 'Europe' }),
      makeDispute({ id: 'b', region: 'Asia-Pacific' }),
      makeDispute({ id: 'c', region: 'Europe' }),
    ];
    const result = filterByRegion(disputes, 'Europe');
    assert.equal(result.length, 2);
    assert.ok(result.every(d => d.region === 'Europe'));
  });

  it('returns empty array when no matches', () => {
    const disputes = [makeDispute({ region: 'Africa' })];
    assert.deepEqual(filterByRegion(disputes, 'Arctic'), []);
  });

  it('handles all region values without error', () => {
    const regions: DisputeRegion[] = ['Asia-Pacific', 'Europe', 'Middle East', 'Africa', 'Arctic', 'Americas', 'South Asia'];
    for (const region of regions) {
      const d = makeDispute({ region });
      assert.equal(filterByRegion([d], region).length, 1);
    }
  });
});

// ── filterByTrend ─────────────────────────────────────────────────────────────

describe('filterByTrend', () => {
  it('filters escalating correctly', () => {
    const disputes = [
      makeDispute({ id: 'a', escalationTrend: 'escalating' }),
      makeDispute({ id: 'b', escalationTrend: 'stable' }),
    ];
    const result = filterByTrend(disputes, 'escalating');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'a');
  });

  it('filters de-escalating correctly', () => {
    const disputes = [
      makeDispute({ id: 'x', escalationTrend: 'de-escalating' }),
      makeDispute({ id: 'y', escalationTrend: 'stable' }),
    ];
    assert.equal(filterByTrend(disputes, 'de-escalating').length, 1);
  });

  it('returns empty when trend absent', () => {
    assert.deepEqual(filterByTrend([makeDispute({ escalationTrend: 'stable' })], 'de-escalating'), []);
  });
});

// ── rankByseverity ────────────────────────────────────────────────────────────

describe('rankByseverity', () => {
  it('returns disputes sorted highest to lowest severity', () => {
    const disputes = [
      makeDispute({ id: 'low', phase: 'diplomatic', militaryPresenceScore: 0, economicStakes: 0, escalationTrend: 'stable' }),
      makeDispute({ id: 'high', phase: 'armed-conflict', militaryPresenceScore: 100, economicStakes: 100, escalationTrend: 'escalating' }),
      makeDispute({ id: 'mid', phase: 'militarized', militaryPresenceScore: 50, economicStakes: 50, escalationTrend: 'stable' }),
    ];
    const ranked = rankByseverity(disputes);
    assert.equal(ranked[0].id, 'high');
    assert.equal(ranked[ranked.length - 1].id, 'low');
  });

  it('does not mutate original array', () => {
    const disputes = [makeDispute({ id: 'a' }), makeDispute({ id: 'b' })];
    const original = [...disputes];
    rankByseverity(disputes);
    assert.deepEqual(disputes.map(d => d.id), original.map(d => d.id));
  });

  it('handles empty array', () => {
    assert.deepEqual(rankByseverity([]), []);
  });

  it('handles single element', () => {
    const d = makeDispute();
    assert.equal(rankByseverity([d]).length, 1);
  });
});

// ── computeGlobalTensionIndex ─────────────────────────────────────────────────

describe('computeGlobalTensionIndex', () => {
  it('returns 0 for empty array', () => {
    assert.equal(computeGlobalTensionIndex([]), 0);
  });

  it('returns average severity rounded to integer', () => {
    const d1 = makeDispute({ phase: 'armed-conflict', militaryPresenceScore: 100, economicStakes: 100, escalationTrend: 'stable' });
    const d2 = makeDispute({ phase: 'diplomatic', militaryPresenceScore: 0, economicStakes: 0, escalationTrend: 'stable' });
    const index = computeGlobalTensionIndex([d1, d2]);
    assert.ok(Number.isInteger(index));
    assert.ok(index > 0 && index < 100);
  });

  it('single dispute returns its own severity score', () => {
    const d = makeDispute({ phase: 'militarized', militaryPresenceScore: 50, economicStakes: 50, escalationTrend: 'stable' });
    assert.equal(computeGlobalTensionIndex([d]), scoreDisputeSeverity(d));
  });

  it('is non-negative', () => {
    const disputes = [makeDispute(), makeDispute({ phase: 'diplomatic' })];
    assert.ok(computeGlobalTensionIndex(disputes) >= 0);
  });
});

// ── getPhaseDistribution ──────────────────────────────────────────────────────

describe('getPhaseDistribution', () => {
  it('counts each phase correctly', () => {
    const disputes = [
      makeDispute({ phase: 'armed-conflict' }),
      makeDispute({ phase: 'armed-conflict' }),
      makeDispute({ phase: 'militarized' }),
      makeDispute({ phase: 'diplomatic' }),
    ];
    const dist = getPhaseDistribution(disputes);
    assert.equal(dist['armed-conflict'], 2);
    assert.equal(dist['militarized'], 1);
    assert.equal(dist['diplomatic'], 1);
    assert.equal(dist['contested'], 0);
    assert.equal(dist['frozen-conflict'], 0);
  });

  it('all phases present in result even with zero count', () => {
    const dist = getPhaseDistribution([makeDispute({ phase: 'diplomatic' })]);
    const phases: DisputePhase[] = ['armed-conflict', 'militarized', 'contested', 'frozen-conflict', 'diplomatic'];
    for (const p of phases) assert.ok(p in dist);
  });

  it('returns all zeros for empty input', () => {
    const dist = getPhaseDistribution([]);
    const total = Object.values(dist).reduce((s, v) => s + v, 0);
    assert.equal(total, 0);
  });

  it('total count equals input length', () => {
    const disputes = [makeDispute(), makeDispute({ phase: 'militarized' }), makeDispute({ phase: 'diplomatic' })];
    const dist = getPhaseDistribution(disputes);
    const total = Object.values(dist).reduce((s, v) => s + v, 0);
    assert.equal(total, disputes.length);
  });
});

// ── getIncidentsForDispute ────────────────────────────────────────────────────

describe('getIncidentsForDispute', () => {
  it('returns only incidents for specified disputeId', () => {
    const incidents = [
      makeIncident({ id: 'i1', disputeId: 'x' }),
      makeIncident({ id: 'i2', disputeId: 'y' }),
      makeIncident({ id: 'i3', disputeId: 'x' }),
    ];
    const result = getIncidentsForDispute(incidents, 'x');
    assert.equal(result.length, 2);
    assert.ok(result.every(i => i.disputeId === 'x'));
  });

  it('returns empty array when no match', () => {
    const incidents = [makeIncident({ disputeId: 'a' })];
    assert.deepEqual(getIncidentsForDispute(incidents, 'z'), []);
  });

  it('sorts by date descending', () => {
    const incidents = [
      makeIncident({ id: 'old', disputeId: 'x', date: '2024-01-01' }),
      makeIncident({ id: 'new', disputeId: 'x', date: '2024-12-01' }),
      makeIncident({ id: 'mid', disputeId: 'x', date: '2024-06-01' }),
    ];
    const result = getIncidentsForDispute(incidents, 'x');
    assert.equal(result[0].id, 'new');
    assert.equal(result[result.length - 1].id, 'old');
  });
});

// ── getRecentHighSeverityIncidents ────────────────────────────────────────────

describe('getRecentHighSeverityIncidents', () => {
  it('returns only incidents at or above minSeverity', () => {
    const incidents = [
      makeIncident({ id: 'lo', severity: 3 }),
      makeIncident({ id: 'hi', severity: 8 }),
      makeIncident({ id: 'mid', severity: 5 }),
    ];
    const result = getRecentHighSeverityIncidents(incidents, 5);
    assert.ok(result.every(i => i.severity >= 5));
    assert.equal(result.length, 2);
  });

  it('default minSeverity is 5', () => {
    const incidents = [makeIncident({ severity: 4 }), makeIncident({ id: 'pass', severity: 5 })];
    const result = getRecentHighSeverityIncidents(incidents);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'pass');
  });

  it('sorts by severity descending', () => {
    const incidents = [
      makeIncident({ id: 'a', severity: 6, date: '2024-01-01' }),
      makeIncident({ id: 'b', severity: 9, date: '2024-01-01' }),
      makeIncident({ id: 'c', severity: 7, date: '2024-01-01' }),
    ];
    const result = getRecentHighSeverityIncidents(incidents, 5);
    assert.equal(result[0].id, 'b');
  });

  it('returns empty array when nothing meets threshold', () => {
    const incidents = [makeIncident({ severity: 1 }), makeIncident({ severity: 2 })];
    assert.deepEqual(getRecentHighSeverityIncidents(incidents, 5), []);
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  it('returns object with all expected keys', () => {
    const data = buildRenderData();
    assert.ok('disputes' in data);
    assert.ok('recentIncidents' in data);
    assert.ok('globalTensionIndex' in data);
    assert.ok('escalatingCount' in data);
    assert.ok('armedConflictCount' in data);
    assert.ok('phaseDistribution' in data);
  });

  it('disputes array is non-empty', () => {
    assert.ok(buildRenderData().disputes.length > 0);
  });

  it('disputes are sorted highest severity first', () => {
    const { disputes } = buildRenderData();
    for (let i = 0; i < disputes.length - 1; i++) {
      assert.ok(scoreDisputeSeverity(disputes[i]) >= scoreDisputeSeverity(disputes[i + 1]));
    }
  });

  it('globalTensionIndex is a non-negative integer', () => {
    const { globalTensionIndex } = buildRenderData();
    assert.ok(Number.isInteger(globalTensionIndex));
    assert.ok(globalTensionIndex >= 0);
  });

  it('escalatingCount matches disputes with escalating trend', () => {
    const { disputes, escalatingCount } = buildRenderData();
    const actual = disputes.filter(d => d.escalationTrend === 'escalating').length;
    assert.equal(escalatingCount, actual);
  });

  it('armedConflictCount matches disputes with armed-conflict phase', () => {
    const { disputes, armedConflictCount } = buildRenderData();
    const actual = disputes.filter(d => d.phase === 'armed-conflict').length;
    assert.equal(armedConflictCount, actual);
  });

  it('phaseDistribution totals match dispute count', () => {
    const { disputes, phaseDistribution } = buildRenderData();
    const total = Object.values(phaseDistribution).reduce((s, v) => s + v, 0);
    assert.equal(total, disputes.length);
  });

  it('recentIncidents all have severity >= 5', () => {
    const { recentIncidents } = buildRenderData();
    assert.ok(recentIncidents.every(i => i.severity >= 5));
  });

  it('ukraine-russia is present in disputes', () => {
    const { disputes } = buildRenderData();
    assert.ok(disputes.some(d => d.id === 'ukraine-russia'));
  });

  it('taiwan-strait is present in disputes', () => {
    const { disputes } = buildRenderData();
    assert.ok(disputes.some(d => d.id === 'taiwan-strait'));
  });

  it('ukraine-russia has phase armed-conflict', () => {
    const { disputes } = buildRenderData();
    const d = disputes.find(d => d.id === 'ukraine-russia');
    assert.equal(d?.phase, 'armed-conflict');
  });

  it('all disputes have non-empty claimants', () => {
    const { disputes } = buildRenderData();
    assert.ok(disputes.every(d => d.claimants.length > 0));
  });

  it('all disputes have affectedAreaKm2 > 0', () => {
    const { disputes } = buildRenderData();
    assert.ok(disputes.every(d => d.affectedAreaKm2 > 0));
  });

  it('all disputes have a valid lastIncident date string', () => {
    const { disputes } = buildRenderData();
    assert.ok(disputes.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d.lastIncident)));
  });
});
