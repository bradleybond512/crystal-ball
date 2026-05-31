import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGlobalCoalitionIndex,
  getByHealth,
  getFracturingCoalitions,
  getCriticalDefectionRisk,
  computeTotalMembers,
  rankByCohesion,
  healthClass,
  defectionClass,
  impactClass,
  buildRenderData,
  type Coalition,
  type CoalitionHealth,
  type DefectionRisk,
} from '../coalition-dynamics-helpers.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeCoalition(overrides: Partial<Coalition> = {}): Coalition {
  return {
    id: 'TEST',
    name: 'Test Coalition',
    type: 'Security Alliance',
    members: ['A', 'B', 'C'],
    formedYear: 2020,
    health: 'Stable',
    cohesionScore: 5,
    purposeAchieved: 5,
    defectionRisk: 'Low',
    keyFaultLine: 'none',
    recentDevelopment: 'none',
    aggressorFocus: 'none',
    ...overrides,
  };
}

// ─── computeGlobalCoalitionIndex ─────────────────────────────────────────────

describe('computeGlobalCoalitionIndex', () => {
  test('empty array returns 50', () => {
    assert.equal(computeGlobalCoalitionIndex([]), 50);
  });

  test('single coalition: score*10', () => {
    assert.equal(computeGlobalCoalitionIndex([makeCoalition({ cohesionScore: 7 })]), 70);
  });

  test('two coalitions: average*10', () => {
    const cs = [
      makeCoalition({ cohesionScore: 6 }),
      makeCoalition({ cohesionScore: 8 }),
    ];
    assert.equal(computeGlobalCoalitionIndex(cs), 70); // avg=7, *10=70
  });

  test('three coalitions rounds correctly', () => {
    const cs = [
      makeCoalition({ cohesionScore: 5 }),
      makeCoalition({ cohesionScore: 5 }),
      makeCoalition({ cohesionScore: 6 }),
    ];
    // avg = 16/3 = 5.333..., *10 = 53.33 -> Math.round = 53
    assert.equal(computeGlobalCoalitionIndex(cs), 53);
  });

  test('max score 10 gives index 100', () => {
    assert.equal(computeGlobalCoalitionIndex([makeCoalition({ cohesionScore: 10 })]), 100);
  });

  test('min score 0 gives index 0', () => {
    assert.equal(computeGlobalCoalitionIndex([makeCoalition({ cohesionScore: 0 })]), 0);
  });

  test('returns number type', () => {
    assert.equal(typeof computeGlobalCoalitionIndex([makeCoalition()]), 'number');
  });
});

// ─── getByHealth ──────────────────────────────────────────────────────────────

describe('getByHealth', () => {
  const pool: Coalition[] = [
    makeCoalition({ id: 'S1', health: 'Strengthening' }),
    makeCoalition({ id: 'S2', health: 'Stable' }),
    makeCoalition({ id: 'S3', health: 'Stressed' }),
    makeCoalition({ id: 'S4', health: 'Fracturing' }),
    makeCoalition({ id: 'S5', health: 'Collapsed' }),
    makeCoalition({ id: 'S6', health: 'Strengthening' }),
  ];

  test('Strengthening returns matching items', () => {
    const r = getByHealth(pool, 'Strengthening');
    assert.equal(r.length, 2);
    assert.ok(r.every(c => c.health === 'Strengthening'));
  });

  test('Stable returns only Stable', () => {
    const r = getByHealth(pool, 'Stable');
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'S2');
  });

  test('Stressed returns only Stressed', () => {
    const r = getByHealth(pool, 'Stressed');
    assert.equal(r.length, 1);
  });

  test('Fracturing returns only Fracturing', () => {
    const r = getByHealth(pool, 'Fracturing');
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'S4');
  });

  test('Collapsed returns only Collapsed', () => {
    const r = getByHealth(pool, 'Collapsed');
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'S5');
  });

  test('no match returns empty array', () => {
    const r = getByHealth([makeCoalition({ health: 'Stable' })], 'Collapsed');
    assert.equal(r.length, 0);
  });

  test('empty input returns empty array', () => {
    assert.deepEqual(getByHealth([], 'Stable'), []);
  });
});

// ─── getFracturingCoalitions ──────────────────────────────────────────────────

describe('getFracturingCoalitions', () => {
  const pool: Coalition[] = [
    makeCoalition({ id: 'F1', health: 'Strengthening' }),
    makeCoalition({ id: 'F2', health: 'Stable' }),
    makeCoalition({ id: 'F3', health: 'Stressed' }),
    makeCoalition({ id: 'F4', health: 'Fracturing' }),
    makeCoalition({ id: 'F5', health: 'Collapsed' }),
  ];

  test('includes Stressed coalitions', () => {
    const r = getFracturingCoalitions(pool);
    assert.ok(r.some(c => c.id === 'F3'));
  });

  test('includes Fracturing coalitions', () => {
    const r = getFracturingCoalitions(pool);
    assert.ok(r.some(c => c.id === 'F4'));
  });

  test('includes Collapsed coalitions', () => {
    const r = getFracturingCoalitions(pool);
    assert.ok(r.some(c => c.id === 'F5'));
  });

  test('excludes Strengthening', () => {
    const r = getFracturingCoalitions(pool);
    assert.ok(!r.some(c => c.id === 'F1'));
  });

  test('excludes Stable', () => {
    const r = getFracturingCoalitions(pool);
    assert.ok(!r.some(c => c.id === 'F2'));
  });

  test('returns exactly 3 from fixture', () => {
    assert.equal(getFracturingCoalitions(pool).length, 3);
  });

  test('empty input returns empty array', () => {
    assert.deepEqual(getFracturingCoalitions([]), []);
  });
});

// ─── getCriticalDefectionRisk ──────────────────────────────────────────────────

describe('getCriticalDefectionRisk', () => {
  const pool: Coalition[] = [
    makeCoalition({ id: 'D1', defectionRisk: 'Low' }),
    makeCoalition({ id: 'D2', defectionRisk: 'Medium' }),
    makeCoalition({ id: 'D3', defectionRisk: 'High' }),
    makeCoalition({ id: 'D4', defectionRisk: 'Critical' }),
  ];

  test('includes High defection risk', () => {
    const r = getCriticalDefectionRisk(pool);
    assert.ok(r.some(c => c.id === 'D3'));
  });

  test('includes Critical defection risk', () => {
    const r = getCriticalDefectionRisk(pool);
    assert.ok(r.some(c => c.id === 'D4'));
  });

  test('excludes Low defection risk', () => {
    const r = getCriticalDefectionRisk(pool);
    assert.ok(!r.some(c => c.id === 'D1'));
  });

  test('excludes Medium defection risk', () => {
    const r = getCriticalDefectionRisk(pool);
    assert.ok(!r.some(c => c.id === 'D2'));
  });

  test('returns exactly 2 from fixture', () => {
    assert.equal(getCriticalDefectionRisk(pool).length, 2);
  });

  test('empty input returns empty array', () => {
    assert.deepEqual(getCriticalDefectionRisk([]), []);
  });
});

// ─── computeTotalMembers ──────────────────────────────────────────────────────

describe('computeTotalMembers', () => {
  test('no coalitions returns 0', () => {
    assert.equal(computeTotalMembers([]), 0);
  });

  test('single coalition returns its member count', () => {
    const c = makeCoalition({ members: ['USA', 'UK', 'France'] });
    assert.equal(computeTotalMembers([c]), 3);
  });

  test('deduplicates shared members', () => {
    const c1 = makeCoalition({ members: ['USA', 'UK'] });
    const c2 = makeCoalition({ members: ['USA', 'France'] });
    // USA shared, total unique = 3
    assert.equal(computeTotalMembers([c1, c2]), 3);
  });

  test('fully overlapping coalitions count once', () => {
    const c1 = makeCoalition({ members: ['A', 'B'] });
    const c2 = makeCoalition({ members: ['A', 'B'] });
    assert.equal(computeTotalMembers([c1, c2]), 2);
  });

  test('no overlap: sum of all members', () => {
    const c1 = makeCoalition({ members: ['A', 'B'] });
    const c2 = makeCoalition({ members: ['C', 'D', 'E'] });
    assert.equal(computeTotalMembers([c1, c2]), 5);
  });

  test('returns a number', () => {
    assert.equal(typeof computeTotalMembers([makeCoalition()]), 'number');
  });
});

// ─── rankByCohesion ───────────────────────────────────────────────────────────

describe('rankByCohesion', () => {
  const pool: Coalition[] = [
    makeCoalition({ id: 'R1', cohesionScore: 3 }),
    makeCoalition({ id: 'R2', cohesionScore: 9 }),
    makeCoalition({ id: 'R3', cohesionScore: 6 }),
  ];

  test('returns descending order', () => {
    const r = rankByCohesion(pool);
    assert.equal(r[0].id, 'R2');
    assert.equal(r[1].id, 'R3');
    assert.equal(r[2].id, 'R1');
  });

  test('does not mutate the original array', () => {
    const original = [...pool];
    rankByCohesion(pool);
    assert.deepEqual(pool.map(c => c.id), original.map(c => c.id));
  });

  test('returns same length', () => {
    assert.equal(rankByCohesion(pool).length, pool.length);
  });

  test('empty array returns empty array', () => {
    assert.deepEqual(rankByCohesion([]), []);
  });

  test('single-element returns same element', () => {
    const r = rankByCohesion([makeCoalition({ id: 'ONLY' })]);
    assert.equal(r[0].id, 'ONLY');
  });

  test('ties preserve array identity (both present)', () => {
    const c1 = makeCoalition({ id: 'T1', cohesionScore: 5 });
    const c2 = makeCoalition({ id: 'T2', cohesionScore: 5 });
    const r = rankByCohesion([c1, c2]);
    const ids = r.map(c => c.id);
    assert.ok(ids.includes('T1') && ids.includes('T2'));
  });
});

// ─── healthClass ──────────────────────────────────────────────────────────────

describe('healthClass', () => {
  test('Strengthening -> health-strong', () => {
    assert.equal(healthClass('Strengthening'), 'health-strong');
  });

  test('Stable -> health-stable', () => {
    assert.equal(healthClass('Stable'), 'health-stable');
  });

  test('Stressed -> health-stressed', () => {
    assert.equal(healthClass('Stressed'), 'health-stressed');
  });

  test('Fracturing -> health-fracturing', () => {
    assert.equal(healthClass('Fracturing'), 'health-fracturing');
  });

  test('Collapsed -> health-collapsed', () => {
    assert.equal(healthClass('Collapsed'), 'health-collapsed');
  });

  test('returns a non-empty string for all valid values', () => {
    const values: CoalitionHealth[] = ['Strengthening', 'Stable', 'Stressed', 'Fracturing', 'Collapsed'];
    for (const v of values) {
      assert.ok(healthClass(v).length > 0);
    }
  });
});

// ─── defectionClass ───────────────────────────────────────────────────────────

describe('defectionClass', () => {
  test('Low -> def-low', () => {
    assert.equal(defectionClass('Low'), 'def-low');
  });

  test('Medium -> def-medium', () => {
    assert.equal(defectionClass('Medium'), 'def-medium');
  });

  test('High -> def-high', () => {
    assert.equal(defectionClass('High'), 'def-high');
  });

  test('Critical -> def-critical', () => {
    assert.equal(defectionClass('Critical'), 'def-critical');
  });

  test('returns a string for all risk values', () => {
    const values: DefectionRisk[] = ['Low', 'Medium', 'High', 'Critical'];
    for (const v of values) {
      assert.equal(typeof defectionClass(v), 'string');
    }
  });
});

// ─── impactClass ──────────────────────────────────────────────────────────────

describe('impactClass', () => {
  test('Positive -> impact-pos', () => {
    assert.equal(impactClass('Positive'), 'impact-pos');
  });

  test('Negative -> impact-neg', () => {
    assert.equal(impactClass('Negative'), 'impact-neg');
  });

  test('Neutral -> impact-neutral', () => {
    assert.equal(impactClass('Neutral'), 'impact-neutral');
  });
});

// ─── buildRenderData ──────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  const data = buildRenderData();

  test('returns coalitions array', () => {
    assert.ok(Array.isArray(data.coalitions));
  });

  test('coalitions array is non-empty', () => {
    assert.ok(data.coalitions.length > 0);
  });

  test('returns 10 coalitions', () => {
    assert.equal(data.coalitions.length, 10);
  });

  test('returns events array', () => {
    assert.ok(Array.isArray(data.events));
  });

  test('events array is non-empty', () => {
    assert.ok(data.events.length > 0);
  });

  test('globalCoalitionIndex is a number', () => {
    assert.equal(typeof data.globalCoalitionIndex, 'number');
  });

  test('globalCoalitionIndex is in range 0-100', () => {
    assert.ok(data.globalCoalitionIndex >= 0 && data.globalCoalitionIndex <= 100);
  });

  test('strengtheningCount matches getByHealth Strengthening', () => {
    const expected = data.coalitions.filter(c => c.health === 'Strengthening').length;
    assert.equal(data.strengtheningCount, expected);
  });

  test('fracturingCount matches getFracturingCoalitions', () => {
    const expected = data.coalitions.filter(
      c => c.health === 'Stressed' || c.health === 'Fracturing' || c.health === 'Collapsed',
    ).length;
    assert.equal(data.fracturingCount, expected);
  });

  test('criticalDefectionCount matches getCriticalDefectionRisk', () => {
    const expected = data.coalitions.filter(
      c => c.defectionRisk === 'High' || c.defectionRisk === 'Critical',
    ).length;
    assert.equal(data.criticalDefectionCount, expected);
  });

  test('totalMembers is a positive number', () => {
    assert.ok(data.totalMembers > 0);
  });

  test('every coalition has a non-empty name', () => {
    assert.ok(data.coalitions.every(c => c.name.length > 0));
  });

  test('every coalition has at least one member', () => {
    assert.ok(data.coalitions.every(c => c.members.length > 0));
  });

  test('every coalition cohesionScore is 0-10', () => {
    assert.ok(data.coalitions.every(c => c.cohesionScore >= 0 && c.cohesionScore <= 10));
  });

  test('every event has a non-empty description', () => {
    assert.ok(data.events.every(e => e.description.length > 0));
  });

  test('every event severity is 1-10', () => {
    assert.ok(data.events.every(e => e.severity >= 1 && e.severity <= 10));
  });

  test('NATO is in coalitions', () => {
    assert.ok(data.coalitions.some(c => c.name === 'NATO'));
  });

  test('AUKUS is in coalitions', () => {
    assert.ok(data.coalitions.some(c => c.name === 'AUKUS'));
  });

  test('Five Eyes is in coalitions', () => {
    assert.ok(data.coalitions.some(c => c.name === 'Five Eyes'));
  });

  test('globalCoalitionIndex equals computeGlobalCoalitionIndex(coalitions)', () => {
    const expected = computeGlobalCoalitionIndex(data.coalitions);
    assert.equal(data.globalCoalitionIndex, expected);
  });

  test('strengtheningCount >= 0', () => {
    assert.ok(data.strengtheningCount >= 0);
  });

  test('fracturingCount >= 0', () => {
    assert.ok(data.fracturingCount >= 0);
  });

  test('criticalDefectionCount >= 0', () => {
    assert.ok(data.criticalDefectionCount >= 0);
  });
});
