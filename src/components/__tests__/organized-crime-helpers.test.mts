import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreOrganizationStrength,
  categorizeNetwork,
  assessStatePenetration,
  computeTransnationalReach,
  detectTerritoryConflicts,
  estimateRevenue,
  rankOrgs,
  buildRenderData,
  type CriminalOrg,
  type TerritoryConflict,
  type NetworkType,
  type CrimeActivity,
} from '../organized-crime-helpers.js';

const makeOrg = (overrides: Partial<CriminalOrg> = {}): CriminalOrg => ({
  id: 'test-org',
  name: 'Test Org',
  networkType: 'cartel',
  territory: ['Country A', 'Country B'],
  strengthScore: 80,
  statePenetration: 60,
  transnationalReach: 70,
  primaryActivities: ['drug-trafficking', 'money-laundering'],
  annualRevenueUSD: 1_000_000_000,
  ...overrides,
});

const makeConflict = (overrides: Partial<TerritoryConflict> = {}): TerritoryConflict => ({
  orgs: ['org-a', 'org-b'],
  region: 'Test Region',
  intensity: 'high',
  startDate: '2025-01-01',
  ...overrides,
});

describe('scoreOrganizationStrength', () => {
  test('returns a number', () => {
    const score = scoreOrganizationStrength(makeOrg());
    assert.equal(typeof score, 'number');
  });

  test('uses 0.4 weight on strengthScore', () => {
    const a = scoreOrganizationStrength(makeOrg({ strengthScore: 100, statePenetration: 0, transnationalReach: 0, annualRevenueUSD: 0 }));
    const b = scoreOrganizationStrength(makeOrg({ strengthScore: 0, statePenetration: 0, transnationalReach: 0, annualRevenueUSD: 0 }));
    assert.equal(a - b, 40);
  });

  test('uses 0.25 weight on statePenetration', () => {
    const a = scoreOrganizationStrength(makeOrg({ strengthScore: 0, statePenetration: 100, transnationalReach: 0, annualRevenueUSD: 0 }));
    const b = scoreOrganizationStrength(makeOrg({ strengthScore: 0, statePenetration: 0, transnationalReach: 0, annualRevenueUSD: 0 }));
    assert.equal(a - b, 25);
  });

  test('uses 0.2 weight on transnationalReach', () => {
    const a = scoreOrganizationStrength(makeOrg({ strengthScore: 0, statePenetration: 0, transnationalReach: 100, annualRevenueUSD: 0 }));
    const b = scoreOrganizationStrength(makeOrg({ strengthScore: 0, statePenetration: 0, transnationalReach: 0, annualRevenueUSD: 0 }));
    assert.equal(a - b, 20);
  });

  test('revenue component is capped at 100', () => {
    const highRev = scoreOrganizationStrength(makeOrg({ strengthScore: 0, statePenetration: 0, transnationalReach: 0, annualRevenueUSD: 999_999_999_999 }));
    const capRev = scoreOrganizationStrength(makeOrg({ strengthScore: 0, statePenetration: 0, transnationalReach: 0, annualRevenueUSD: 3_000_000_000 }));
    assert.equal(highRev, capRev);
  });

  test('score is rounded to integer', () => {
    const score = scoreOrganizationStrength(makeOrg({ strengthScore: 33, statePenetration: 33, transnationalReach: 33, annualRevenueUSD: 0 }));
    assert.equal(score, Math.round(score));
  });

  test('minimum inputs yield 0', () => {
    const score = scoreOrganizationStrength(makeOrg({ strengthScore: 0, statePenetration: 0, transnationalReach: 0, annualRevenueUSD: 0 }));
    assert.equal(score, 0);
  });
});

describe('categorizeNetwork', () => {
  test('returns cartel for cartel org', () => {
    assert.equal(categorizeNetwork(makeOrg({ networkType: 'cartel' })), 'cartel');
  });

  test('returns mafia for mafia org', () => {
    assert.equal(categorizeNetwork(makeOrg({ networkType: 'mafia' })), 'mafia');
  });

  test('returns triad for triad org', () => {
    assert.equal(categorizeNetwork(makeOrg({ networkType: 'triad' })), 'triad');
  });

  test('returns gang for gang org', () => {
    assert.equal(categorizeNetwork(makeOrg({ networkType: 'gang' })), 'gang');
  });

  test('returns hybrid for hybrid org', () => {
    assert.equal(categorizeNetwork(makeOrg({ networkType: 'hybrid' })), 'hybrid');
  });
});

describe('assessStatePenetration', () => {
  test('returns critical at 80', () => {
    assert.equal(assessStatePenetration(80), 'critical');
  });

  test('returns critical at 100', () => {
    assert.equal(assessStatePenetration(100), 'critical');
  });

  test('returns high at 60', () => {
    assert.equal(assessStatePenetration(60), 'high');
  });

  test('returns high at 79', () => {
    assert.equal(assessStatePenetration(79), 'high');
  });

  test('returns medium at 40', () => {
    assert.equal(assessStatePenetration(40), 'medium');
  });

  test('returns medium at 59', () => {
    assert.equal(assessStatePenetration(59), 'medium');
  });

  test('returns low at 39', () => {
    assert.equal(assessStatePenetration(39), 'low');
  });

  test('returns low at 0', () => {
    assert.equal(assessStatePenetration(0), 'low');
  });
});

describe('computeTransnationalReach', () => {
  test('incorporates territory count', () => {
    const a = computeTransnationalReach(makeOrg({ transnationalReach: 80, territory: ['A', 'B'] }));
    const b = computeTransnationalReach(makeOrg({ transnationalReach: 80, territory: ['A', 'B', 'C', 'D'] }));
    assert.ok(b > a, 'more territories should yield higher reach');
  });

  test('result is rounded to integer', () => {
    const r = computeTransnationalReach(makeOrg({ transnationalReach: 75, territory: ['A'] }));
    assert.equal(r, Math.round(r));
  });

  test('single territory baseline', () => {
    const r = computeTransnationalReach(makeOrg({ transnationalReach: 50, territory: ['A'] }));
    assert.equal(r, Math.round((50 + 5) / 2));
  });
});

describe('detectTerritoryConflicts', () => {
  test('returns only high-intensity conflicts', () => {
    const conflicts = [
      makeConflict({ intensity: 'high' }),
      makeConflict({ intensity: 'medium' }),
      makeConflict({ intensity: 'low' }),
    ];
    const result = detectTerritoryConflicts(conflicts);
    assert.equal(result.length, 1);
    assert.equal(result[0].intensity, 'high');
  });

  test('returns empty array when no high-intensity conflicts', () => {
    const result = detectTerritoryConflicts([makeConflict({ intensity: 'low' })]);
    assert.equal(result.length, 0);
  });

  test('returns all high-intensity conflicts', () => {
    const conflicts = [makeConflict({ intensity: 'high' }), makeConflict({ intensity: 'high' })];
    assert.equal(detectTerritoryConflicts(conflicts).length, 2);
  });

  test('empty input returns empty array', () => {
    assert.deepEqual(detectTerritoryConflicts([]), []);
  });
});

describe('estimateRevenue', () => {
  test('sums revenue of all orgs', () => {
    const orgs = [makeOrg({ annualRevenueUSD: 1000 }), makeOrg({ annualRevenueUSD: 2000 })];
    assert.equal(estimateRevenue(orgs), 3000);
  });

  test('returns 0 for empty list', () => {
    assert.equal(estimateRevenue([]), 0);
  });

  test('returns single org revenue', () => {
    assert.equal(estimateRevenue([makeOrg({ annualRevenueUSD: 5_000_000 })]), 5_000_000);
  });
});

describe('rankOrgs', () => {
  test('returns orgs in descending strength order', () => {
    const weak = makeOrg({ id: 'weak', strengthScore: 20, statePenetration: 20, transnationalReach: 20, annualRevenueUSD: 0 });
    const strong = makeOrg({ id: 'strong', strengthScore: 90, statePenetration: 80, transnationalReach: 80, annualRevenueUSD: 3_000_000_000 });
    const ranked = rankOrgs([weak, strong]);
    assert.equal(ranked[0].id, 'strong');
    assert.equal(ranked[1].id, 'weak');
  });

  test('does not mutate the input array', () => {
    const orgs = [makeOrg({ id: 'a', strengthScore: 50 }), makeOrg({ id: 'b', strengthScore: 90 })];
    const original = [...orgs];
    rankOrgs(orgs);
    assert.deepEqual(orgs.map(o => o.id), original.map(o => o.id));
  });

  test('returns same count as input', () => {
    const orgs = [makeOrg({ id: 'a' }), makeOrg({ id: 'b' }), makeOrg({ id: 'c' })];
    assert.equal(rankOrgs(orgs).length, 3);
  });

  test('empty input returns empty array', () => {
    assert.deepEqual(rankOrgs([]), []);
  });
});

describe('buildRenderData', () => {
  test('returns orgs array', () => {
    const data = buildRenderData();
    assert.ok(Array.isArray(data.orgs));
    assert.ok(data.orgs.length > 0);
  });

  test('returns conflicts array', () => {
    const data = buildRenderData();
    assert.ok(Array.isArray(data.conflicts));
  });

  test('totalRevenue is positive number', () => {
    const data = buildRenderData();
    assert.ok(data.totalRevenue > 0);
  });

  test('highIntensityConflicts is a non-negative integer', () => {
    const data = buildRenderData();
    assert.ok(Number.isInteger(data.highIntensityConflicts));
    assert.ok(data.highIntensityConflicts >= 0);
  });

  test('orgs are ranked in descending strength order', () => {
    const data = buildRenderData();
    for (let i = 0; i < data.orgs.length - 1; i++) {
      assert.ok(
        scoreOrganizationStrength(data.orgs[i]) >= scoreOrganizationStrength(data.orgs[i + 1]),
        `org at index ${i} should be >= org at index ${i + 1}`
      );
    }
  });

  test('highIntensityConflicts matches count of high conflicts', () => {
    const data = buildRenderData();
    const counted = data.conflicts.filter(c => c.intensity === 'high').length;
    assert.equal(data.highIntensityConflicts, counted);
  });

  test('totalRevenue matches sum of org revenues', () => {
    const data = buildRenderData();
    const sum = data.orgs.reduce((acc, o) => acc + o.annualRevenueUSD, 0);
    assert.equal(data.totalRevenue, sum);
  });
});
