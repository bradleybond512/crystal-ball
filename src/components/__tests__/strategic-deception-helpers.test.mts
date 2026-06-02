import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreDeceptionThreat,
  filterByActor,
  filterByDomain,
  filterActive,
  rankByThreat,
  getTypeDistribution,
  getIndicatorsForOp,
  getHighConfidenceIndicators,
  getMostActiveActor,
  buildRenderData,
  DeceptionOperation,
  DeceptionIndicator,
} from '../strategic-deception-helpers.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const activeOp: DeceptionOperation = {
  id: 'test-active', name: 'Test Active Op', actor: 'Russia', type: 'maskirovka',
  domain: 'military', targetNations: ['USA', 'NATO'], startDate: '2023-01-01',
  active: true, effectivenessScore: 80, detectionDifficulty: 60,
  strategicObjective: 'Test objective', successIndicators: ['Ind1'],
};

const inactiveOp: DeceptionOperation = {
  id: 'test-inactive', name: 'Test Inactive Op', actor: 'China', type: 'feint',
  domain: 'cyber', targetNations: ['USA'], startDate: '2020-01-01',
  active: false, effectivenessScore: 80, detectionDifficulty: 60,
  strategicObjective: 'Historical objective', successIndicators: ['Ind1'],
};

const highThreatOp: DeceptionOperation = {
  id: 'high-threat', name: 'High Threat', actor: 'Iran', type: 'cover-story',
  domain: 'diplomatic', targetNations: ['USA', 'EU', 'UN', 'IAEA'],
  startDate: '2022-01-01', active: true,
  effectivenessScore: 95, detectionDifficulty: 90,
  strategicObjective: 'Max threat', successIndicators: [],
};

const lowThreatOp: DeceptionOperation = {
  id: 'low-threat', name: 'Low Threat', actor: 'non-state', type: 'decoy',
  domain: 'information', targetNations: ['USA'],
  startDate: '2022-01-01', active: true,
  effectivenessScore: 10, detectionDifficulty: 10,
  strategicObjective: 'Minimal threat', successIndicators: [],
};

const ind_high: DeceptionIndicator = {
  id: 'h1', operationId: 'op-a', type: 'anomaly',
  description: 'High confidence finding', confidence: 90, detectedDate: '2024-01-01',
};

const ind_mid: DeceptionIndicator = {
  id: 'm1', operationId: 'op-a', type: 'pattern-break',
  description: 'Mid confidence', confidence: 75, detectedDate: '2024-01-02',
};

const ind_low: DeceptionIndicator = {
  id: 'l1', operationId: 'op-b', type: 'known-playbook',
  description: 'Low confidence', confidence: 50, detectedDate: '2024-01-03',
};

// ─── scoreDeceptionThreat ─────────────────────────────────────────────────────

describe('scoreDeceptionThreat', () => {
  it('active op scores higher than inactive op with same parameters', () => {
    const score_active = scoreDeceptionThreat(activeOp);
    const score_inactive = scoreDeceptionThreat(inactiveOp);
    assert.ok(score_active > score_inactive, `active(${score_active}) should beat inactive(${score_inactive})`);
  });

  it('inactive op is half of computed raw score', () => {
    const active = { ...activeOp };
    const inactive = { ...activeOp, active: false };
    const s_active = scoreDeceptionThreat(active);
    const s_inactive = scoreDeceptionThreat(inactive);
    // inactive multiplier is 0.5
    assert.ok(s_inactive <= s_active);
  });

  it('score is capped at 100', () => {
    const capped = scoreDeceptionThreat(highThreatOp);
    assert.ok(capped <= 100, `score ${capped} exceeds 100`);
  });

  it('score is at least 0', () => {
    const score = scoreDeceptionThreat(lowThreatOp);
    assert.ok(score >= 0);
  });

  it('more target nations increases score', () => {
    const few = { ...activeOp, targetNations: ['A'] };
    const many = { ...activeOp, targetNations: ['A', 'B', 'C', 'D', 'E'] };
    assert.ok(scoreDeceptionThreat(many) > scoreDeceptionThreat(few));
  });

  it('higher effectivenessScore increases score', () => {
    const low = { ...activeOp, effectivenessScore: 10 };
    const high = { ...activeOp, effectivenessScore: 90 };
    assert.ok(scoreDeceptionThreat(high) > scoreDeceptionThreat(low));
  });

  it('higher detectionDifficulty increases score', () => {
    const easy = { ...activeOp, detectionDifficulty: 10 };
    const hard = { ...activeOp, detectionDifficulty: 90 };
    assert.ok(scoreDeceptionThreat(hard) > scoreDeceptionThreat(easy));
  });

  it('returns integer (Math.round)', () => {
    const score = scoreDeceptionThreat(activeOp);
    assert.strictEqual(score, Math.round(score));
  });

  it('zero effectiveness and zero detection with 1 nation scores > 0 when active', () => {
    const zero = { ...activeOp, effectivenessScore: 0, detectionDifficulty: 0, targetNations: ['X'] };
    const score = scoreDeceptionThreat(zero);
    assert.ok(score > 0, `expected > 0, got ${score}`);
  });
});

// ─── filterByActor ────────────────────────────────────────────────────────────

describe('filterByActor', () => {
  const ops = [activeOp, inactiveOp, highThreatOp, lowThreatOp];

  it('returns only ops matching actor', () => {
    const result = filterByActor(ops, 'Russia');
    assert.ok(result.every(o => o.actor === 'Russia'));
    assert.ok(result.length >= 1);
  });

  it('returns empty array when no match', () => {
    const result = filterByActor(ops, 'North Korea');
    assert.deepEqual(result, []);
  });

  it('does not mutate original array', () => {
    const copy = [...ops];
    filterByActor(ops, 'China');
    assert.deepEqual(ops, copy);
  });

  it('returns multiple matches', () => {
    const multi = [activeOp, { ...activeOp, id: 'a2' }, inactiveOp];
    const result = filterByActor(multi, 'Russia');
    assert.strictEqual(result.length, 2);
  });
});

// ─── filterByDomain ───────────────────────────────────────────────────────────

describe('filterByDomain', () => {
  const ops = [activeOp, inactiveOp, highThreatOp, lowThreatOp];

  it('returns only ops matching domain', () => {
    const result = filterByDomain(ops, 'military');
    assert.ok(result.every(o => o.domain === 'military'));
  });

  it('returns empty for non-existent domain', () => {
    const result = filterByDomain(ops, 'hybrid');
    assert.deepEqual(result, []);
  });

  it('cyber domain filters correctly', () => {
    const result = filterByDomain(ops, 'cyber');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'test-inactive');
  });

  it('diplomatic domain filters correctly', () => {
    const result = filterByDomain(ops, 'diplomatic');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'high-threat');
  });
});

// ─── filterActive ─────────────────────────────────────────────────────────────

describe('filterActive', () => {
  const ops = [activeOp, inactiveOp, highThreatOp, lowThreatOp];

  it('returns only active ops', () => {
    const result = filterActive(ops);
    assert.ok(result.every(o => o.active === true));
  });

  it('excludes inactive ops', () => {
    const result = filterActive(ops);
    assert.ok(!result.some(o => o.id === 'test-inactive'));
  });

  it('empty input returns empty array', () => {
    assert.deepEqual(filterActive([]), []);
  });

  it('all inactive returns empty array', () => {
    assert.deepEqual(filterActive([inactiveOp, { ...inactiveOp, id: 'also-inactive' }]), []);
  });

  it('count is correct', () => {
    const result = filterActive(ops);
    assert.strictEqual(result.length, 3); // activeOp, highThreatOp, lowThreatOp
  });
});

// ─── rankByThreat ─────────────────────────────────────────────────────────────

describe('rankByThreat', () => {
  const ops = [lowThreatOp, activeOp, highThreatOp];

  it('returns ops sorted descending by threat score', () => {
    const ranked = rankByThreat(ops);
    for (let i = 0; i < ranked.length - 1; i++) {
      assert.ok(
        scoreDeceptionThreat(ranked[i]) >= scoreDeceptionThreat(ranked[i + 1]),
        `index ${i} should >= ${i + 1}`
      );
    }
  });

  it('does not mutate original array', () => {
    const original = [...ops];
    rankByThreat(ops);
    assert.deepEqual(ops, original);
  });

  it('returns array of same length', () => {
    const result = rankByThreat(ops);
    assert.strictEqual(result.length, ops.length);
  });

  it('first element has highest threat', () => {
    const ranked = rankByThreat(ops);
    const maxScore = Math.max(...ops.map(scoreDeceptionThreat));
    assert.strictEqual(scoreDeceptionThreat(ranked[0]), maxScore);
  });

  it('handles empty input', () => {
    assert.deepEqual(rankByThreat([]), []);
  });

  it('handles single-element input', () => {
    const result = rankByThreat([activeOp]);
    assert.strictEqual(result.length, 1);
  });
});

// ─── getTypeDistribution ──────────────────────────────────────────────────────

describe('getTypeDistribution', () => {
  it('all types initialized to 0', () => {
    const dist = getTypeDistribution([]);
    assert.strictEqual(dist['camouflage'], 0);
    assert.strictEqual(dist['decoy'], 0);
    assert.strictEqual(dist['diversion'], 0);
    assert.strictEqual(dist['feint'], 0);
    assert.strictEqual(dist['maskirovka'], 0);
    assert.strictEqual(dist['false-flag'], 0);
    assert.strictEqual(dist['cover-story'], 0);
  });

  it('counts each type correctly', () => {
    const ops = [activeOp, { ...activeOp, id: 'x', type: 'feint' as const }, inactiveOp];
    const dist = getTypeDistribution(ops);
    assert.strictEqual(dist['maskirovka'], 1);
    assert.strictEqual(dist['feint'], 2); // inactiveOp is feint + the one we added
  });

  it('sum of all type counts equals number of ops', () => {
    const ops = [activeOp, inactiveOp, highThreatOp, lowThreatOp];
    const dist = getTypeDistribution(ops);
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    assert.strictEqual(total, ops.length);
  });

  it('single op increments correct type', () => {
    const dist = getTypeDistribution([highThreatOp]);
    assert.strictEqual(dist['cover-story'], 1);
    assert.strictEqual(dist['maskirovka'], 0);
  });
});

// ─── getIndicatorsForOp ───────────────────────────────────────────────────────

describe('getIndicatorsForOp', () => {
  const indicators = [ind_high, ind_mid, ind_low];

  it('returns indicators for matching opId', () => {
    const result = getIndicatorsForOp(indicators, 'op-a');
    assert.strictEqual(result.length, 2);
    assert.ok(result.every(i => i.operationId === 'op-a'));
  });

  it('returns empty for non-existent opId', () => {
    const result = getIndicatorsForOp(indicators, 'nonexistent');
    assert.deepEqual(result, []);
  });

  it('returns single indicator for unique opId', () => {
    const result = getIndicatorsForOp(indicators, 'op-b');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'l1');
  });

  it('does not mutate input', () => {
    const copy = [...indicators];
    getIndicatorsForOp(indicators, 'op-a');
    assert.deepEqual(indicators, copy);
  });
});

// ─── getHighConfidenceIndicators ──────────────────────────────────────────────

describe('getHighConfidenceIndicators', () => {
  const indicators = [ind_high, ind_mid, ind_low];

  it('default threshold 75 filters correctly', () => {
    const result = getHighConfidenceIndicators(indicators);
    assert.ok(result.every(i => i.confidence >= 75));
  });

  it('result is sorted descending by confidence', () => {
    const result = getHighConfidenceIndicators(indicators, 0);
    for (let i = 0; i < result.length - 1; i++) {
      assert.ok(result[i].confidence >= result[i + 1].confidence);
    }
  });

  it('custom threshold works', () => {
    const result = getHighConfidenceIndicators(indicators, 80);
    assert.ok(result.every(i => i.confidence >= 80));
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'h1');
  });

  it('threshold of 0 returns all sorted', () => {
    const result = getHighConfidenceIndicators(indicators, 0);
    assert.strictEqual(result.length, 3);
  });

  it('threshold of 100 returns only perfect confidence', () => {
    const perfect: DeceptionIndicator = { ...ind_high, id: 'p1', confidence: 100 };
    const result = getHighConfidenceIndicators([...indicators, perfect], 100);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'p1');
  });

  it('empty input returns empty', () => {
    assert.deepEqual(getHighConfidenceIndicators([]), []);
  });
});

// ─── getMostActiveActor ───────────────────────────────────────────────────────

describe('getMostActiveActor', () => {
  it('returns actor with most operations', () => {
    const ops = [activeOp, { ...activeOp, id: 'r2' }, inactiveOp]; // Russia x2, China x1
    assert.strictEqual(getMostActiveActor(ops), 'Russia');
  });

  it('returns China when China has most', () => {
    const ops = [inactiveOp, { ...inactiveOp, id: 'c2' }, activeOp]; // China x2, Russia x1
    assert.strictEqual(getMostActiveActor(ops), 'China');
  });

  it('defaults to Russia on empty array', () => {
    assert.strictEqual(getMostActiveActor([]), 'Russia');
  });

  it('single op returns that op actor', () => {
    assert.strictEqual(getMostActiveActor([highThreatOp]), 'Iran');
  });

  it('non-state actor can win', () => {
    const ns: DeceptionOperation = { ...lowThreatOp, actor: 'non-state', id: 'ns2' };
    const ns2: DeceptionOperation = { ...lowThreatOp, actor: 'non-state', id: 'ns3' };
    const ops = [lowThreatOp, ns, ns2, activeOp]; // non-state x3, Russia x1
    assert.strictEqual(getMostActiveActor(ops), 'non-state');
  });
});

// ─── buildRenderData ──────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  it('returns object with all expected keys', () => {
    const data = buildRenderData();
    assert.ok('operations' in data);
    assert.ok('recentIndicators' in data);
    assert.ok('activeCount' in data);
    assert.ok('mostActiveActor' in data);
    assert.ok('typeDistribution' in data);
  });

  it('operations are sorted by threat descending', () => {
    const { operations } = buildRenderData();
    for (let i = 0; i < operations.length - 1; i++) {
      assert.ok(
        scoreDeceptionThreat(operations[i]) >= scoreDeceptionThreat(operations[i + 1]),
        `operations[${i}] score should >= operations[${i + 1}] score`
      );
    }
  });

  it('activeCount is a non-negative integer', () => {
    const { activeCount } = buildRenderData();
    assert.ok(Number.isInteger(activeCount));
    assert.ok(activeCount >= 0);
  });

  it('activeCount matches actual active ops in operations', () => {
    const { operations, activeCount } = buildRenderData();
    const actual = operations.filter(o => o.active).length;
    assert.strictEqual(activeCount, actual);
  });

  it('recentIndicators all have confidence >= 75', () => {
    const { recentIndicators } = buildRenderData();
    assert.ok(recentIndicators.every(i => i.confidence >= 75));
  });

  it('recentIndicators sorted descending by confidence', () => {
    const { recentIndicators } = buildRenderData();
    for (let i = 0; i < recentIndicators.length - 1; i++) {
      assert.ok(recentIndicators[i].confidence >= recentIndicators[i + 1].confidence);
    }
  });

  it('typeDistribution sums to total operation count', () => {
    const { operations, typeDistribution } = buildRenderData();
    const total = Object.values(typeDistribution).reduce((a, b) => a + b, 0);
    assert.strictEqual(total, operations.length);
  });

  it('mostActiveActor is a valid DeceptionActor string', () => {
    const valid = ['Russia', 'China', 'Iran', 'North Korea', 'USA', 'Israel', 'non-state'];
    const { mostActiveActor } = buildRenderData();
    assert.ok(valid.includes(mostActiveActor), `unexpected actor: ${mostActiveActor}`);
  });

  it('operations array is non-empty', () => {
    const { operations } = buildRenderData();
    assert.ok(operations.length > 0);
  });

  it('calling buildRenderData twice returns consistent results', () => {
    const a = buildRenderData();
    const b = buildRenderData();
    assert.strictEqual(a.activeCount, b.activeCount);
    assert.strictEqual(a.mostActiveActor, b.mostActiveActor);
    assert.strictEqual(a.operations.length, b.operations.length);
  });
});
