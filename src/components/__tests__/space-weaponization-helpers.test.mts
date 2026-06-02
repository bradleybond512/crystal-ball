import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreProgramThreat,
  classifyThreatTier,
  filterByNation,
  filterByCategory,
  rankProgramsByThreat,
  computeTotalDebrisRisk,
  getNationCapabilityScore,
  getCategoryDistribution,
  getMostAdvancedNation,
  buildRenderData,
  type SpaceWeaponProgram,
  type SpaceIncident,
} from '../space-weaponization-helpers.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeProgram = (overrides: Partial<SpaceWeaponProgram> = {}): SpaceWeaponProgram => ({
  id: 'test-prog',
  nation: 'USA',
  category: 'ASAT-KE',
  name: 'Test Program',
  developmentStage: 'operational',
  orbitThreats: ['LEO'],
  debrisRisk: 50,
  strategicImpact: 80,
  deterrenceValue: 60,
  estimatedTestsCompleted: 3,
  ...overrides,
});

const makeIncident = (overrides: Partial<SpaceIncident> = {}): SpaceIncident => ({
  id: 'test-inc',
  date: '2023-01-01',
  nation: 'USA',
  category: 'ASAT-KE',
  description: 'Test incident',
  debrisGenerated: 100,
  severity: 'high',
  ...overrides,
});

// ── scoreProgramThreat ────────────────────────────────────────────────────────

describe('scoreProgramThreat', () => {
  it('returns a number between 0 and 100', () => {
    const score = scoreProgramThreat(makeProgram());
    assert.ok(score >= 0 && score <= 100, `score ${score} out of range`);
  });

  it('returns correct score for all-100 operational program (formula max is 76)', () => {
    // (100*0.4 + 100*0.3 + (100*0.2)*0.3) * 1.0 = 40+30+6 = 76; Math.min(100,...) does not change it
    const p = makeProgram({ strategicImpact: 100, deterrenceValue: 100, debrisRisk: 100, developmentStage: 'operational' });
    assert.equal(scoreProgramThreat(p), 76);
  });

  it('Math.min cap: score never exceeds 100', () => {
    const p = makeProgram({ strategicImpact: 999, deterrenceValue: 999, debrisRisk: 999, developmentStage: 'operational' });
    assert.ok(scoreProgramThreat(p) <= 100);
  });

  it('operational stage multiplier is 1.0 (highest)', () => {
    const operational = makeProgram({ developmentStage: 'operational', strategicImpact: 80, deterrenceValue: 60, debrisRisk: 50 });
    const testing = makeProgram({ developmentStage: 'testing', strategicImpact: 80, deterrenceValue: 60, debrisRisk: 50 });
    assert.ok(scoreProgramThreat(operational) > scoreProgramThreat(testing));
  });

  it('conceptual stage yields lowest score', () => {
    const conceptual = makeProgram({ developmentStage: 'conceptual' });
    const development = makeProgram({ developmentStage: 'development' });
    assert.ok(scoreProgramThreat(conceptual) < scoreProgramThreat(development));
  });

  it('development stage multiplier is 0.5', () => {
    const op = makeProgram({ developmentStage: 'operational', strategicImpact: 100, deterrenceValue: 100, debrisRisk: 0 });
    const dev = makeProgram({ developmentStage: 'development', strategicImpact: 100, deterrenceValue: 100, debrisRisk: 0 });
    assert.ok(scoreProgramThreat(op) > scoreProgramThreat(dev));
  });

  it('zero debris risk with operational gives high score for high strategic/deterrence', () => {
    const p = makeProgram({ debrisRisk: 0, strategicImpact: 100, deterrenceValue: 100, developmentStage: 'operational' });
    assert.equal(scoreProgramThreat(p), 70); // (100*0.4 + 100*0.3 + 0*0.3) * 1.0 = 70
  });

  it('debris risk contributes positively to score (30% weight)', () => {
    const noDebris = makeProgram({ debrisRisk: 0, strategicImpact: 50, deterrenceValue: 50, developmentStage: 'operational' });
    const highDebris = makeProgram({ debrisRisk: 100, strategicImpact: 50, deterrenceValue: 50, developmentStage: 'operational' });
    assert.ok(scoreProgramThreat(highDebris) > scoreProgramThreat(noDebris));
  });

  it('returns integer (rounded)', () => {
    const score = scoreProgramThreat(makeProgram({ strategicImpact: 73, deterrenceValue: 61, debrisRisk: 33 }));
    assert.equal(score, Math.round(score));
  });

});

// ── classifyThreatTier ────────────────────────────────────────────────────────

describe('classifyThreatTier', () => {
  it('score >= 80 is critical', () => {
    assert.equal(classifyThreatTier(80), 'critical');
    assert.equal(classifyThreatTier(100), 'critical');
    assert.equal(classifyThreatTier(95), 'critical');
  });

  it('score 60-79 is high', () => {
    assert.equal(classifyThreatTier(60), 'high');
    assert.equal(classifyThreatTier(79), 'high');
    assert.equal(classifyThreatTier(70), 'high');
  });

  it('score 40-59 is medium', () => {
    assert.equal(classifyThreatTier(40), 'medium');
    assert.equal(classifyThreatTier(59), 'medium');
    assert.equal(classifyThreatTier(50), 'medium');
  });

  it('score < 40 is low', () => {
    assert.equal(classifyThreatTier(0), 'low');
    assert.equal(classifyThreatTier(39), 'low');
    assert.equal(classifyThreatTier(20), 'low');
  });

  it('boundary 80 is critical not high', () => {
    assert.equal(classifyThreatTier(80), 'critical');
    assert.equal(classifyThreatTier(79), 'high');
  });

  it('boundary 60 is high not medium', () => {
    assert.equal(classifyThreatTier(60), 'high');
    assert.equal(classifyThreatTier(59), 'medium');
  });

  it('boundary 40 is medium not low', () => {
    assert.equal(classifyThreatTier(40), 'medium');
    assert.equal(classifyThreatTier(39), 'low');
  });
});

// ── filterByNation ────────────────────────────────────────────────────────────

describe('filterByNation', () => {
  const programs = [
    makeProgram({ id: 'a', nation: 'USA' }),
    makeProgram({ id: 'b', nation: 'China' }),
    makeProgram({ id: 'c', nation: 'USA' }),
    makeProgram({ id: 'd', nation: 'Russia' }),
  ];

  it('returns only programs for specified nation', () => {
    const result = filterByNation(programs, 'USA');
    assert.equal(result.length, 2);
    assert.ok(result.every(p => p.nation === 'USA'));
  });

  it('returns empty array when nation not present', () => {
    assert.deepEqual(filterByNation(programs, 'DPRK'), []);
  });

  it('does not mutate input array', () => {
    const copy = [...programs];
    filterByNation(programs, 'China');
    assert.deepEqual(programs, copy);
  });

  it('returns single match', () => {
    const result = filterByNation(programs, 'Russia');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'd');
  });

  it('handles empty input', () => {
    assert.deepEqual(filterByNation([], 'USA'), []);
  });
});

// ── filterByCategory ──────────────────────────────────────────────────────────

describe('filterByCategory', () => {
  const programs = [
    makeProgram({ id: 'a', category: 'ASAT-KE' }),
    makeProgram({ id: 'b', category: 'jamming' }),
    makeProgram({ id: 'c', category: 'ASAT-KE' }),
    makeProgram({ id: 'd', category: 'co-orbital' }),
  ];

  it('returns only programs with specified category', () => {
    const result = filterByCategory(programs, 'ASAT-KE');
    assert.equal(result.length, 2);
    assert.ok(result.every(p => p.category === 'ASAT-KE'));
  });

  it('returns empty array when category absent', () => {
    assert.deepEqual(filterByCategory(programs, 'hypersonic'), []);
  });

  it('handles empty input', () => {
    assert.deepEqual(filterByCategory([], 'jamming'), []);
  });

  it('returns correct single match', () => {
    const result = filterByCategory(programs, 'co-orbital');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'd');
  });
});

// ── rankProgramsByThreat ──────────────────────────────────────────────────────

describe('rankProgramsByThreat', () => {
  it('returns programs sorted descending by threat score', () => {
    const programs = [
      makeProgram({ id: 'low', strategicImpact: 10, deterrenceValue: 10, debrisRisk: 0 }),
      makeProgram({ id: 'high', strategicImpact: 100, deterrenceValue: 100, debrisRisk: 100 }),
      makeProgram({ id: 'mid', strategicImpact: 50, deterrenceValue: 50, debrisRisk: 50 }),
    ];
    const ranked = rankProgramsByThreat(programs);
    assert.equal(ranked[0].id, 'high');
    assert.equal(ranked[2].id, 'low');
  });

  it('does not mutate the original array', () => {
    const programs = [makeProgram({ id: 'a' }), makeProgram({ id: 'b' })];
    const original = programs.map(p => p.id);
    rankProgramsByThreat(programs);
    assert.deepEqual(programs.map(p => p.id), original);
  });

  it('returns all programs (no filtering)', () => {
    const programs = [makeProgram({ id: 'a' }), makeProgram({ id: 'b' }), makeProgram({ id: 'c' })];
    assert.equal(rankProgramsByThreat(programs).length, 3);
  });

  it('handles single-element array', () => {
    const p = makeProgram();
    assert.deepEqual(rankProgramsByThreat([p]), [p]);
  });

  it('handles empty array', () => {
    assert.deepEqual(rankProgramsByThreat([]), []);
  });
});

// ── computeTotalDebrisRisk ────────────────────────────────────────────────────

describe('computeTotalDebrisRisk', () => {
  it('sums all debrisGenerated values', () => {
    const incidents = [
      makeIncident({ debrisGenerated: 100 }),
      makeIncident({ debrisGenerated: 200 }),
      makeIncident({ debrisGenerated: 50 }),
    ];
    assert.equal(computeTotalDebrisRisk(incidents), 350);
  });

  it('returns 0 for empty array', () => {
    assert.equal(computeTotalDebrisRisk([]), 0);
  });

  it('returns 0 when all incidents have 0 debris', () => {
    const incidents = [makeIncident({ debrisGenerated: 0 }), makeIncident({ debrisGenerated: 0 })];
    assert.equal(computeTotalDebrisRisk(incidents), 0);
  });

  it('handles single incident', () => {
    assert.equal(computeTotalDebrisRisk([makeIncident({ debrisGenerated: 42 })]), 42);
  });
});

// ── getNationCapabilityScore ──────────────────────────────────────────────────

describe('getNationCapabilityScore', () => {
  it('returns 0 for nation with no programs', () => {
    const programs = [makeProgram({ nation: 'China' })];
    assert.equal(getNationCapabilityScore(programs, 'Japan'), 0);
  });

  it('returns average threat score for nation', () => {
    const p1 = makeProgram({ nation: 'Russia', strategicImpact: 100, deterrenceValue: 100, debrisRisk: 0, developmentStage: 'operational' });
    const p2 = makeProgram({ nation: 'Russia', strategicImpact: 0, deterrenceValue: 0, debrisRisk: 0, developmentStage: 'operational' });
    // Scores: 70 and 0, avg = 35
    const score = getNationCapabilityScore([p1, p2], 'Russia');
    assert.equal(score, 35);
  });

  it('single program returns its own score', () => {
    const p = makeProgram({ nation: 'India', strategicImpact: 100, deterrenceValue: 100, debrisRisk: 0, developmentStage: 'operational' });
    assert.equal(getNationCapabilityScore([p], 'India'), scoreProgramThreat(p));
  });

  it('ignores programs from other nations', () => {
    const p1 = makeProgram({ nation: 'USA', strategicImpact: 0, deterrenceValue: 0, debrisRisk: 0 });
    const p2 = makeProgram({ nation: 'China', strategicImpact: 100, deterrenceValue: 100, debrisRisk: 0, developmentStage: 'operational' });
    assert.ok(getNationCapabilityScore([p1, p2], 'China') > getNationCapabilityScore([p1, p2], 'USA'));
  });
});

// ── getCategoryDistribution ───────────────────────────────────────────────────

describe('getCategoryDistribution', () => {
  it('returns all categories with 0 for empty input', () => {
    const dist = getCategoryDistribution([]);
    assert.equal(dist['ASAT-KE'], 0);
    assert.equal(dist['jamming'], 0);
    assert.equal(dist['co-orbital'], 0);
  });

  it('counts each category correctly', () => {
    const programs = [
      makeProgram({ category: 'ASAT-KE' }),
      makeProgram({ category: 'ASAT-KE' }),
      makeProgram({ category: 'jamming' }),
    ];
    const dist = getCategoryDistribution(programs);
    assert.equal(dist['ASAT-KE'], 2);
    assert.equal(dist['jamming'], 1);
    assert.equal(dist['co-orbital'], 0);
  });

  it('includes all 7 category keys', () => {
    const dist = getCategoryDistribution([]);
    const keys = Object.keys(dist);
    assert.ok(keys.includes('ASAT-KE'));
    assert.ok(keys.includes('ASAT-DEW'));
    assert.ok(keys.includes('co-orbital'));
    assert.ok(keys.includes('jamming'));
    assert.ok(keys.includes('spoofing'));
    assert.ok(keys.includes('cyber-space'));
    assert.ok(keys.includes('hypersonic'));
    assert.equal(keys.length, 7);
  });
});

// ── getMostAdvancedNation ─────────────────────────────────────────────────────

describe('getMostAdvancedNation', () => {
  it('returns the nation with highest average capability score', () => {
    const programs = [
      makeProgram({ nation: 'China', strategicImpact: 100, deterrenceValue: 100, debrisRisk: 100, developmentStage: 'operational' }),
      makeProgram({ nation: 'USA', strategicImpact: 10, deterrenceValue: 10, debrisRisk: 0, developmentStage: 'operational' }),
    ];
    assert.equal(getMostAdvancedNation(programs), 'China');
  });

  it('returns a valid SpacePowerNation value', () => {
    const valid = ['USA', 'China', 'Russia', 'India', 'Japan', 'ESA', 'DPRK', 'Iran'];
    const programs = [makeProgram({ nation: 'Russia' })];
    const result = getMostAdvancedNation(programs);
    assert.ok(valid.includes(result));
  });

  it('is deterministic for same input', () => {
    const programs = [
      makeProgram({ id: 'a', nation: 'India' }),
      makeProgram({ id: 'b', nation: 'USA' }),
    ];
    assert.equal(getMostAdvancedNation(programs), getMostAdvancedNation(programs));
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  it('returns an object with all required fields', () => {
    const data = buildRenderData();
    assert.ok(Array.isArray(data.programs));
    assert.ok(Array.isArray(data.recentIncidents));
    assert.equal(typeof data.totalDebrisObjects, 'number');
    assert.equal(typeof data.leadingNation, 'string');
    assert.equal(typeof data.categoryDistribution, 'object');
  });

  it('programs array is non-empty', () => {
    assert.ok(buildRenderData().programs.length > 0);
  });

  it('programs are ranked by threat (descending)', () => {
    const { programs } = buildRenderData();
    for (let i = 0; i < programs.length - 1; i++) {
      assert.ok(
        scoreProgramThreat(programs[i]) >= scoreProgramThreat(programs[i + 1]),
        `programs[${i}] score should be >= programs[${i + 1}] score`
      );
    }
  });

  it('recentIncidents has at most 5 entries', () => {
    assert.ok(buildRenderData().recentIncidents.length <= 5);
  });

  it('recentIncidents are sorted newest first', () => {
    const { recentIncidents } = buildRenderData();
    for (let i = 0; i < recentIncidents.length - 1; i++) {
      assert.ok(recentIncidents[i].date >= recentIncidents[i + 1].date);
    }
  });

  it('totalDebrisObjects is a non-negative number', () => {
    assert.ok(buildRenderData().totalDebrisObjects >= 0);
  });

  it('totalDebrisObjects is greater than zero (known incidents have debris)', () => {
    assert.ok(buildRenderData().totalDebrisObjects > 0);
  });

  it('leadingNation is a non-empty string', () => {
    assert.ok(buildRenderData().leadingNation.length > 0);
  });

  it('categoryDistribution has 7 keys', () => {
    assert.equal(Object.keys(buildRenderData().categoryDistribution).length, 7);
  });

  it('categoryDistribution counts sum to total programs count', () => {
    const data = buildRenderData();
    const total = Object.values(data.categoryDistribution).reduce((s, v) => s + v, 0);
    assert.equal(total, data.programs.length);
  });

  it('is deterministic — returns same shape on repeated calls', () => {
    const a = buildRenderData();
    const b = buildRenderData();
    assert.equal(a.programs.length, b.programs.length);
    assert.equal(a.totalDebrisObjects, b.totalDebrisObjects);
    assert.equal(a.leadingNation, b.leadingNation);
  });
});
