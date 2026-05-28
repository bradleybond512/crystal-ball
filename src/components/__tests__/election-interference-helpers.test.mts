import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreInterferenceSophistication,
  classifyThreatLevel,
  filterByActor,
  filterByPhase,
  computeTacticFrequency,
  rankElectionsByRisk,
  computeNetRisk,
  getActiveOperationsByCountry,
  buildRenderData,
  type InterferenceOperation,
  type ElectionRisk,
  type ThreatActor,
  type InterferenceTactic,
  type ElectionPhase,
} from '../election-interference-helpers.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const makeOp = (overrides: Partial<InterferenceOperation> = {}): InterferenceOperation => ({
  id: 'test-op-1',
  actor: 'Russia',
  targetCountry: 'TestLand',
  tactics: ['disinformation'],
  sophisticationScore: 50,
  detectionDate: '2026-01-01',
  electionPhase: 'campaign',
  confirmed: true,
  ...overrides,
});

const makeRisk = (overrides: Partial<ElectionRisk> = {}): ElectionRisk => ({
  country: 'TestLand',
  electionDate: '2026-06-01',
  riskScore: 70,
  primaryThreats: ['Russia'],
  activeTactics: ['disinformation'],
  resilienceScore: 50,
  ...overrides,
});

// ---------------------------------------------------------------------------
// scoreInterferenceSophistication
// ---------------------------------------------------------------------------
describe('scoreInterferenceSophistication', () => {
  it('returns base score for single tactic, confirmed op', () => {
    const op = makeOp({ sophisticationScore: 50, tactics: ['disinformation'], confirmed: true });
    // tacticBonus = 1*5*0.3 = 1.5; confirmationBonus = 10*0.2 = 2
    const result = scoreInterferenceSophistication(op);
    assert.equal(result, Math.min(100, 50 + 1.5 + 2));
  });

  it('caps at 100 for very high scores', () => {
    const op = makeOp({ sophisticationScore: 95, tactics: ['disinformation', 'hack-and-leak', 'social-media-manipulation', 'voter-suppression'], confirmed: true });
    const result = scoreInterferenceSophistication(op);
    assert.equal(result, 100);
  });

  it('adds no confirmation bonus for unconfirmed op', () => {
    const opConfirmed = makeOp({ sophisticationScore: 60, tactics: ['disinformation'], confirmed: true });
    const opUnconfirmed = makeOp({ sophisticationScore: 60, tactics: ['disinformation'], confirmed: false });
    assert.ok(scoreInterferenceSophistication(opConfirmed) > scoreInterferenceSophistication(opUnconfirmed));
  });

  it('more tactics = higher score', () => {
    const op1 = makeOp({ sophisticationScore: 60, tactics: ['disinformation'], confirmed: false });
    const op2 = makeOp({ sophisticationScore: 60, tactics: ['disinformation', 'hack-and-leak'], confirmed: false });
    assert.ok(scoreInterferenceSophistication(op2) > scoreInterferenceSophistication(op1));
  });

  it('score is never negative', () => {
    const op = makeOp({ sophisticationScore: 0, tactics: [], confirmed: false });
    assert.ok(scoreInterferenceSophistication(op) >= 0);
  });
});

// ---------------------------------------------------------------------------
// classifyThreatLevel
// ---------------------------------------------------------------------------
describe('classifyThreatLevel', () => {
  it('returns critical for score >= 85', () => {
    assert.equal(classifyThreatLevel(85), 'critical');
    assert.equal(classifyThreatLevel(100), 'critical');
    assert.equal(classifyThreatLevel(92), 'critical');
  });

  it('returns high for score 65-84', () => {
    assert.equal(classifyThreatLevel(65), 'high');
    assert.equal(classifyThreatLevel(84), 'high');
    assert.equal(classifyThreatLevel(72), 'high');
  });

  it('returns medium for score 40-64', () => {
    assert.equal(classifyThreatLevel(40), 'medium');
    assert.equal(classifyThreatLevel(64), 'medium');
    assert.equal(classifyThreatLevel(50), 'medium');
  });

  it('returns low for score < 40', () => {
    assert.equal(classifyThreatLevel(39), 'low');
    assert.equal(classifyThreatLevel(0), 'low');
    assert.equal(classifyThreatLevel(1), 'low');
  });

  it('boundary: 84 is high, 85 is critical', () => {
    assert.equal(classifyThreatLevel(84), 'high');
    assert.equal(classifyThreatLevel(85), 'critical');
  });

  it('boundary: 64 is medium, 65 is high', () => {
    assert.equal(classifyThreatLevel(64), 'medium');
    assert.equal(classifyThreatLevel(65), 'high');
  });
});

// ---------------------------------------------------------------------------
// filterByActor
// ---------------------------------------------------------------------------
describe('filterByActor', () => {
  const ops = [
    makeOp({ id: 'r1', actor: 'Russia' }),
    makeOp({ id: 'r2', actor: 'Russia' }),
    makeOp({ id: 'c1', actor: 'China' }),
    makeOp({ id: 'i1', actor: 'Iran' }),
  ];

  it('filters to only the specified actor', () => {
    const result = filterByActor(ops, 'Russia');
    assert.equal(result.length, 2);
    assert.ok(result.every(o => o.actor === 'Russia'));
  });

  it('returns empty array when actor has no ops', () => {
    assert.deepEqual(filterByActor(ops, 'North Korea'), []);
  });

  it('returns single result for unique actor', () => {
    const result = filterByActor(ops, 'Iran');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'i1');
  });

  it('does not mutate original array', () => {
    const original = [...ops];
    filterByActor(ops, 'Russia');
    assert.equal(ops.length, original.length);
  });
});

// ---------------------------------------------------------------------------
// filterByPhase
// ---------------------------------------------------------------------------
describe('filterByPhase', () => {
  const ops = [
    makeOp({ id: 'p1', electionPhase: 'campaign' }),
    makeOp({ id: 'p2', electionPhase: 'pre-campaign' }),
    makeOp({ id: 'p3', electionPhase: 'campaign' }),
    makeOp({ id: 'p4', electionPhase: 'election-day' }),
  ];

  it('filters to only the specified phase', () => {
    const result = filterByPhase(ops, 'campaign');
    assert.equal(result.length, 2);
    assert.ok(result.every(o => o.electionPhase === 'campaign'));
  });

  it('returns empty for phase with no matches', () => {
    assert.deepEqual(filterByPhase(ops, 'post-election'), []);
  });

  it('returns single match for unique phase', () => {
    const result = filterByPhase(ops, 'election-day');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'p4');
  });
});

// ---------------------------------------------------------------------------
// computeTacticFrequency
// ---------------------------------------------------------------------------
describe('computeTacticFrequency', () => {
  it('counts all six tactic keys even with no matches', () => {
    const freq = computeTacticFrequency([]);
    const keys: InterferenceTactic[] = ['disinformation', 'hack-and-leak', 'social-media-manipulation', 'voter-suppression', 'financial-influence', 'election-infrastructure-attack'];
    for (const k of keys) assert.equal(freq[k], 0);
  });

  it('counts single-tactic ops correctly', () => {
    const ops = [makeOp({ tactics: ['disinformation'] }), makeOp({ tactics: ['disinformation'] })];
    const freq = computeTacticFrequency(ops);
    assert.equal(freq['disinformation'], 2);
    assert.equal(freq['hack-and-leak'], 0);
  });

  it('counts multi-tactic ops, each tactic independently', () => {
    const ops = [makeOp({ tactics: ['disinformation', 'hack-and-leak'] })];
    const freq = computeTacticFrequency(ops);
    assert.equal(freq['disinformation'], 1);
    assert.equal(freq['hack-and-leak'], 1);
  });

  it('returns all 6 keys', () => {
    const freq = computeTacticFrequency([]);
    assert.equal(Object.keys(freq).length, 6);
  });
});

// ---------------------------------------------------------------------------
// rankElectionsByRisk
// ---------------------------------------------------------------------------
describe('rankElectionsByRisk', () => {
  it('sorts descending by riskScore', () => {
    const risks = [makeRisk({ riskScore: 60 }), makeRisk({ riskScore: 90 }), makeRisk({ riskScore: 75 })];
    const ranked = rankElectionsByRisk(risks);
    assert.equal(ranked[0].riskScore, 90);
    assert.equal(ranked[1].riskScore, 75);
    assert.equal(ranked[2].riskScore, 60);
  });

  it('does not mutate original array', () => {
    const risks = [makeRisk({ riskScore: 50 }), makeRisk({ riskScore: 80 })];
    const original = [...risks];
    rankElectionsByRisk(risks);
    assert.equal(risks[0].riskScore, original[0].riskScore);
  });

  it('handles empty array', () => {
    assert.deepEqual(rankElectionsByRisk([]), []);
  });

  it('handles single-element array', () => {
    const r = makeRisk({ riskScore: 55 });
    assert.equal(rankElectionsByRisk([r]).length, 1);
  });
});

// ---------------------------------------------------------------------------
// computeNetRisk
// ---------------------------------------------------------------------------
describe('computeNetRisk', () => {
  it('computes riskScore minus 30% of resilienceScore', () => {
    const r = makeRisk({ riskScore: 80, resilienceScore: 60 });
    // 80 - 60*0.3 = 80 - 18 = 62
    assert.equal(computeNetRisk(r), 62);
  });

  it('never returns negative', () => {
    const r = makeRisk({ riskScore: 10, resilienceScore: 100 });
    assert.equal(computeNetRisk(r), 0);
  });

  it('rounds to integer', () => {
    const r = makeRisk({ riskScore: 70, resilienceScore: 33 });
    const result = computeNetRisk(r);
    assert.equal(result, Math.round(70 - 33 * 0.3));
    assert.equal(typeof result, 'number');
    assert.equal(result % 1, 0);
  });

  it('zero resilience returns full risk score', () => {
    const r = makeRisk({ riskScore: 75, resilienceScore: 0 });
    assert.equal(computeNetRisk(r), 75);
  });
});

// ---------------------------------------------------------------------------
// getActiveOperationsByCountry
// ---------------------------------------------------------------------------
describe('getActiveOperationsByCountry', () => {
  it('counts operations per country', () => {
    const ops = [
      makeOp({ targetCountry: 'UK' }),
      makeOp({ targetCountry: 'UK' }),
      makeOp({ targetCountry: 'France' }),
    ];
    const counts = getActiveOperationsByCountry(ops);
    assert.equal(counts['UK'], 2);
    assert.equal(counts['France'], 1);
  });

  it('returns empty object for empty input', () => {
    assert.deepEqual(getActiveOperationsByCountry([]), {});
  });

  it('each country appears only once in output', () => {
    const ops = [makeOp({ targetCountry: 'Japan' })];
    const counts = getActiveOperationsByCountry(ops);
    assert.equal(Object.keys(counts).length, 1);
    assert.equal(counts['Japan'], 1);
  });
});

// ---------------------------------------------------------------------------
// buildRenderData
// ---------------------------------------------------------------------------
describe('buildRenderData', () => {
  it('returns risks sorted by riskScore descending', () => {
    const { risks } = buildRenderData();
    for (let i = 0; i < risks.length - 1; i++) {
      assert.ok(risks[i].riskScore >= risks[i + 1].riskScore);
    }
  });

  it('recentOps has at most 6 entries', () => {
    const { recentOps } = buildRenderData();
    assert.ok(recentOps.length <= 6);
  });

  it('tacticFrequency has all 6 tactic keys', () => {
    const { tacticFrequency } = buildRenderData();
    const keys: InterferenceTactic[] = ['disinformation', 'hack-and-leak', 'social-media-manipulation', 'voter-suppression', 'financial-influence', 'election-infrastructure-attack'];
    for (const k of keys) assert.ok(k in tacticFrequency);
  });

  it('mostActiveActor is a valid ThreatActor', () => {
    const { mostActiveActor } = buildRenderData();
    const valid: ThreatActor[] = ['Russia', 'China', 'Iran', 'North Korea', 'domestic'];
    assert.ok(valid.includes(mostActiveActor));
  });

  it('mostActiveActor is Russia (highest count in MOCK_OPS)', () => {
    const { mostActiveActor } = buildRenderData();
    assert.equal(mostActiveActor, 'Russia');
  });

  it('risks array is non-empty', () => {
    const { risks } = buildRenderData();
    assert.ok(risks.length > 0);
  });

  it('recentOps array is non-empty', () => {
    const { recentOps } = buildRenderData();
    assert.ok(recentOps.length > 0);
  });

  it('social-media-manipulation is the most frequent tactic', () => {
    const { tacticFrequency } = buildRenderData();
    const maxCount = Math.max(...Object.values(tacticFrequency));
    assert.equal(tacticFrequency['social-media-manipulation'], maxCount);
  });
});
