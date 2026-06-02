import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreOperationSeverity,
  classifyIntensity,
  filterByActor,
  filterActive,
  rankByEscalationPotential,
  getTacticDistribution,
  computeGlobalGrayZoneIndex,
  getMostDangerousActor,
  getRecentIncidents,
  buildRenderData,
  type GrayZoneOperation,
  type GrayIncident,
  type GrayActor,
  type GrayTactic,
} from '../gray-zone-conflict-helpers';

// ── fixtures ──────────────────────────────────────────────────────────────────
function makeOp(overrides: Partial<GrayZoneOperation> = {}): GrayZoneOperation {
  return {
    id: 'test-op',
    name: 'Test Operation',
    actor: 'Russia',
    targetNation: 'Ukraine',
    tactics: ['sabotage'],
    domain: 'military',
    startDate: '2022-01-01',
    active: true,
    intensity: 'high',
    escalationPotential: 60,
    deniabilityScore: 50,
    responseConstraint: 'test constraint',
    ...overrides,
  };
}

function makeIncident(overrides: Partial<GrayIncident> = {}): GrayIncident {
  return {
    id: 'test-inc',
    date: '2024-06-01',
    actor: 'Russia',
    targetNation: 'Germany',
    tactic: 'sabotage',
    description: 'Test incident',
    escalationDelta: 5,
    ...overrides,
  };
}

// ── classifyIntensity ─────────────────────────────────────────────────────────
describe('classifyIntensity', () => {
  it('returns extreme for 80', () => { assert.strictEqual(classifyIntensity(80), 'extreme'); });
  it('returns extreme for 100', () => { assert.strictEqual(classifyIntensity(100), 'extreme'); });
  it('returns extreme for 81', () => { assert.strictEqual(classifyIntensity(81), 'extreme'); });
  it('returns high for 79', () => { assert.strictEqual(classifyIntensity(79), 'high'); });
  it('returns high for 60', () => { assert.strictEqual(classifyIntensity(60), 'high'); });
  it('returns moderate for 59', () => { assert.strictEqual(classifyIntensity(59), 'moderate'); });
  it('returns moderate for 35', () => { assert.strictEqual(classifyIntensity(35), 'moderate'); });
  it('returns low for 34', () => { assert.strictEqual(classifyIntensity(34), 'low'); });
  it('returns low for 0', () => { assert.strictEqual(classifyIntensity(0), 'low'); });
  it('returns low for 1', () => { assert.strictEqual(classifyIntensity(1), 'low'); });
});

// ── scoreOperationSeverity ────────────────────────────────────────────────────
describe('scoreOperationSeverity', () => {
  it('scores extreme intensity higher than high', () => {
    const extreme = makeOp({ intensity: 'extreme', tactics: ['sabotage'], deniabilityScore: 50 });
    const high = makeOp({ intensity: 'high', tactics: ['sabotage'], deniabilityScore: 50 });
    assert.ok(scoreOperationSeverity(extreme) > scoreOperationSeverity(high));
  });
  it('scores high intensity higher than moderate', () => {
    const high = makeOp({ intensity: 'high', tactics: ['sabotage'], deniabilityScore: 50 });
    const mod = makeOp({ intensity: 'moderate', tactics: ['sabotage'], deniabilityScore: 50 });
    assert.ok(scoreOperationSeverity(high) > scoreOperationSeverity(mod));
  });
  it('scores moderate higher than low', () => {
    const mod = makeOp({ intensity: 'moderate', tactics: ['sabotage'], deniabilityScore: 50 });
    const low = makeOp({ intensity: 'low', tactics: ['sabotage'], deniabilityScore: 50 });
    assert.ok(scoreOperationSeverity(mod) > scoreOperationSeverity(low));
  });
  it('caps result at 100', () => {
    const op = makeOp({ intensity: 'extreme', tactics: ['sabotage','disinformation','cyber-harassment','espionage','assassination'], deniabilityScore: 0 });
    assert.ok(scoreOperationSeverity(op) <= 100);
  });
  it('tactic bonus is capped at 25 (5 tactics)', () => {
    const fiveTactics = makeOp({ intensity: 'low', tactics: ['sabotage','disinformation','cyber-harassment','espionage','assassination'], deniabilityScore: 100 });
    const sixTactics = makeOp({ intensity: 'low', tactics: ['sabotage','disinformation','cyber-harassment','espionage','assassination','lawfare'], deniabilityScore: 100 });
    assert.strictEqual(scoreOperationSeverity(fiveTactics), scoreOperationSeverity(sixTactics));
  });
  it('low deniability increases score', () => {
    const lowDen = makeOp({ intensity: 'moderate', tactics: ['sabotage'], deniabilityScore: 10 });
    const highDen = makeOp({ intensity: 'moderate', tactics: ['sabotage'], deniabilityScore: 90 });
    assert.ok(scoreOperationSeverity(lowDen) > scoreOperationSeverity(highDen));
  });
  it('returns a non-negative number', () => {
    const op = makeOp({ intensity: 'low', tactics: [], deniabilityScore: 100 });
    assert.ok(scoreOperationSeverity(op) >= 0);
  });
});

// ── filterByActor ─────────────────────────────────────────────────────────────
describe('filterByActor', () => {
  const ops = [
    makeOp({ id: 'r1', actor: 'Russia' }),
    makeOp({ id: 'c1', actor: 'China' }),
    makeOp({ id: 'r2', actor: 'Russia' }),
    makeOp({ id: 'ir1', actor: 'Iran' }),
  ];
  it('returns only Russia operations', () => {
    const result = filterByActor(ops, 'Russia');
    assert.strictEqual(result.length, 2);
    assert.ok(result.every(o => o.actor === 'Russia'));
  });
  it('returns only China operations', () => {
    const result = filterByActor(ops, 'China');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'c1');
  });
  it('returns empty array for actor with no ops', () => {
    assert.strictEqual(filterByActor(ops, 'North Korea').length, 0);
  });
  it('does not mutate original array', () => {
    const originalLen = ops.length;
    filterByActor(ops, 'Russia');
    assert.strictEqual(ops.length, originalLen);
  });
});

// ── filterActive ──────────────────────────────────────────────────────────────
describe('filterActive', () => {
  const ops = [
    makeOp({ id: 'a1', active: true }),
    makeOp({ id: 'i1', active: false }),
    makeOp({ id: 'a2', active: true }),
  ];
  it('returns only active operations', () => {
    const result = filterActive(ops);
    assert.strictEqual(result.length, 2);
    assert.ok(result.every(o => o.active));
  });
  it('returns empty array when all inactive', () => {
    assert.strictEqual(filterActive([makeOp({ active: false })]).length, 0);
  });
  it('handles empty input', () => {
    assert.strictEqual(filterActive([]).length, 0);
  });
});

// ── rankByEscalationPotential ─────────────────────────────────────────────────
describe('rankByEscalationPotential', () => {
  const ops = [
    makeOp({ id: 'low', escalationPotential: 20 }),
    makeOp({ id: 'high', escalationPotential: 90 }),
    makeOp({ id: 'mid', escalationPotential: 55 }),
  ];
  it('sorts descending by escalationPotential', () => {
    const ranked = rankByEscalationPotential(ops);
    assert.strictEqual(ranked[0].escalationPotential, 90);
    assert.strictEqual(ranked[1].escalationPotential, 55);
    assert.strictEqual(ranked[2].escalationPotential, 20);
  });
  it('does not mutate original array', () => {
    const firstId = ops[0].id;
    rankByEscalationPotential(ops);
    assert.strictEqual(ops[0].id, firstId);
  });
  it('handles single element', () => {
    const single = [makeOp({ escalationPotential: 42 })];
    assert.strictEqual(rankByEscalationPotential(single)[0].escalationPotential, 42);
  });
  it('handles empty array', () => {
    assert.strictEqual(rankByEscalationPotential([]).length, 0);
  });
});

// ── getTacticDistribution ─────────────────────────────────────────────────────
describe('getTacticDistribution', () => {
  it('counts each tactic correctly', () => {
    const ops = [
      makeOp({ tactics: ['sabotage', 'disinformation'] }),
      makeOp({ tactics: ['sabotage', 'cyber-harassment'] }),
    ];
    const dist = getTacticDistribution(ops);
    assert.strictEqual(dist['sabotage'], 2);
    assert.strictEqual(dist['disinformation'], 1);
    assert.strictEqual(dist['cyber-harassment'], 1);
    assert.strictEqual(dist['lawfare'], 0);
  });
  it('returns zero for all tactics with empty ops', () => {
    const dist = getTacticDistribution([]);
    assert.ok(Object.values(dist).every(v => v === 0));
  });
  it('has keys for all 10 tactic types', () => {
    const dist = getTacticDistribution([]);
    const tactics: GrayTactic[] = ['lawfare','economic-coercion','cyber-harassment','proxy-violence','disinformation','espionage','maritime-harassment','election-interference','assassination','sabotage'];
    for (const t of tactics) assert.ok(t in dist);
  });
});

// ── computeGlobalGrayZoneIndex ────────────────────────────────────────────────
describe('computeGlobalGrayZoneIndex', () => {
  it('averages escalationPotential of active ops', () => {
    const ops = [
      makeOp({ active: true, escalationPotential: 80 }),
      makeOp({ active: true, escalationPotential: 60 }),
    ];
    assert.strictEqual(computeGlobalGrayZoneIndex(ops), 70);
  });
  it('ignores inactive ops', () => {
    const ops = [
      makeOp({ active: true, escalationPotential: 50 }),
      makeOp({ active: false, escalationPotential: 100 }),
    ];
    assert.strictEqual(computeGlobalGrayZoneIndex(ops), 50);
  });
  it('returns 0 for empty ops', () => {
    assert.strictEqual(computeGlobalGrayZoneIndex([]), 0);
  });
  it('returns 0 when all ops inactive', () => {
    const ops = [makeOp({ active: false, escalationPotential: 90 })];
    assert.strictEqual(computeGlobalGrayZoneIndex(ops), 0);
  });
});

// ── getMostDangerousActor ─────────────────────────────────────────────────────
describe('getMostDangerousActor', () => {
  it('returns actor with highest single escalationPotential', () => {
    const ops = [
      makeOp({ actor: 'Russia', escalationPotential: 70 }),
      makeOp({ actor: 'China', escalationPotential: 95 }),
      makeOp({ actor: 'Iran', escalationPotential: 60 }),
    ];
    assert.strictEqual(getMostDangerousActor(ops), 'China');
  });
  it('uses max per actor not sum', () => {
    const ops = [
      makeOp({ actor: 'Russia', escalationPotential: 50 }),
      makeOp({ actor: 'Russia', escalationPotential: 55 }),
      makeOp({ actor: 'China', escalationPotential: 60 }),
    ];
    assert.strictEqual(getMostDangerousActor(ops), 'China');
  });
  it('returns Russia as fallback for empty ops', () => {
    assert.strictEqual(getMostDangerousActor([]), 'Russia');
  });
});

// ── getRecentIncidents ────────────────────────────────────────────────────────
describe('getRecentIncidents', () => {
  it('filters out old incidents beyond default 180 days', () => {
    const old = makeIncident({ date: '2020-01-01', escalationDelta: 9 });
    const recent = makeIncident({ id: 'r', date: new Date(Date.now() - 10 * 86400000).toISOString().slice(0,10), escalationDelta: 3 });
    const result = getRecentIncidents([old, recent]);
    assert.ok(result.some(i => i.id === 'r'));
    assert.ok(!result.some(i => i.date === '2020-01-01'));
  });
  it('sorts by escalationDelta descending', () => {
    const now = new Date(Date.now() - 5 * 86400000).toISOString().slice(0,10);
    const incidents = [
      makeIncident({ id: 'a', date: now, escalationDelta: 2 }),
      makeIncident({ id: 'b', date: now, escalationDelta: 8 }),
      makeIncident({ id: 'c', date: now, escalationDelta: 5 }),
    ];
    const result = getRecentIncidents(incidents);
    assert.strictEqual(result[0].escalationDelta, 8);
    assert.strictEqual(result[1].escalationDelta, 5);
    assert.strictEqual(result[2].escalationDelta, 2);
  });
  it('respects custom days window', () => {
    const borderline = makeIncident({ id: 'b', date: new Date(Date.now() - 10 * 86400000).toISOString().slice(0,10) });
    assert.strictEqual(getRecentIncidents([borderline], 5).length, 0);
    assert.strictEqual(getRecentIncidents([borderline], 15).length, 1);
  });
  it('returns empty for all old incidents', () => {
    assert.strictEqual(getRecentIncidents([makeIncident({ date: '2010-01-01' })]).length, 0);
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────
describe('buildRenderData', () => {
  it('returns all required keys', () => {
    const data = buildRenderData();
    assert.ok('operations' in data);
    assert.ok('recentIncidents' in data);
    assert.ok('globalGrayZoneIndex' in data);
    assert.ok('mostDangerousActor' in data);
    assert.ok('tacticDistribution' in data);
    assert.ok('activeCount' in data);
  });
  it('operations are sorted by escalationPotential descending', () => {
    const { operations } = buildRenderData();
    for (let i = 0; i < operations.length - 1; i++) {
      assert.ok(operations[i].escalationPotential >= operations[i + 1].escalationPotential);
    }
  });
  it('activeCount matches number of active operations', () => {
    const { operations, activeCount } = buildRenderData();
    assert.strictEqual(activeCount, operations.filter(o => o.active).length);
  });
  it('globalGrayZoneIndex is between 0 and 100', () => {
    const { globalGrayZoneIndex } = buildRenderData();
    assert.ok(globalGrayZoneIndex >= 0);
    assert.ok(globalGrayZoneIndex <= 100);
  });
  it('mostDangerousActor is a valid GrayActor', () => {
    const validActors: GrayActor[] = ['Russia','China','Iran','North Korea','Turkey','non-state','hybrid'];
    const { mostDangerousActor } = buildRenderData();
    assert.ok(validActors.includes(mostDangerousActor));
  });
  it('tacticDistribution has all tactic keys', () => {
    const { tacticDistribution } = buildRenderData();
    const tactics: GrayTactic[] = ['lawfare','economic-coercion','cyber-harassment','proxy-violence','disinformation','espionage','maritime-harassment','election-interference','assassination','sabotage'];
    for (const t of tactics) assert.ok(t in tacticDistribution);
  });
  it('is deterministic — same output on repeated calls', () => {
    const a = buildRenderData();
    const b = buildRenderData();
    assert.strictEqual(a.globalGrayZoneIndex, b.globalGrayZoneIndex);
    assert.strictEqual(a.mostDangerousActor, b.mostDangerousActor);
    assert.strictEqual(a.activeCount, b.activeCount);
  });
});
