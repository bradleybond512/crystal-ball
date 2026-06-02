import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getByCountry,
  getLargestFunds,
  getHighRiskFunds,
  getStrategicAcquisitions,
  computeTotalAum,
  transparencyClass,
  riskClass,
  buildRenderData,
  type SovereignWealthFund,
  type StrategicInvestment,
  type Transparency,
  type GeopoliticalRisk,
  type UsePattern,
} from '../sovereign-wealth-funds-helpers.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeFund(overrides: Partial<SovereignWealthFund> = {}): SovereignWealthFund {
  return {
    id: 'TEST001',
    name: 'Test Fund',
    country: 'Testland',
    aumBillions: 100,
    founded: 2000,
    strategicFocus: 'Diversified',
    transparency: 'Medium',
    geopoliticalRisk: 'Low',
    fundingSource: 'Test revenues',
    sanctioned: false,
    usePatterns: ['Diversification'],
    notableHoldings: ['Stock A', 'Bond B'],
    recentDevelopment: 'No changes.',
    ...overrides,
  };
}

function makeInvestment(overrides: Partial<StrategicInvestment> = {}): StrategicInvestment {
  return {
    id: 'INV001',
    date: '2024-01',
    fund: 'Test Fund',
    target: 'Test Target',
    sector: 'Finance',
    value: '$1B',
    usePattern: 'Diversification',
    geopoliticalSignal: 'None.',
    ...overrides,
  };
}

// ─── getByCountry ─────────────────────────────────────────────────────────────

describe('getByCountry', () => {
  test('returns matching funds by exact country name', () => {
    const funds = [makeFund({ country: 'Norway' }), makeFund({ country: 'China' })];
    assert.equal(getByCountry(funds, 'Norway').length, 1);
    assert.equal(getByCountry(funds, 'Norway')[0].country, 'Norway');
  });

  test('is case-insensitive', () => {
    const funds = [makeFund({ country: 'Norway' })];
    assert.equal(getByCountry(funds, 'norway').length, 1);
    assert.equal(getByCountry(funds, 'NORWAY').length, 1);
  });

  test('returns empty array for unknown country', () => {
    const funds = [makeFund({ country: 'Norway' })];
    assert.equal(getByCountry(funds, 'Iceland').length, 0);
  });

  test('returns multiple funds from same country', () => {
    const funds = [
      makeFund({ id: 'A', country: 'UAE' }),
      makeFund({ id: 'B', country: 'UAE' }),
      makeFund({ id: 'C', country: 'Norway' }),
    ];
    assert.equal(getByCountry(funds, 'UAE').length, 2);
  });

  test('returns empty for empty input', () => {
    assert.deepEqual(getByCountry([], 'Norway'), []);
  });
});

// ─── getLargestFunds ──────────────────────────────────────────────────────────

describe('getLargestFunds', () => {
  test('returns funds sorted by AUM descending', () => {
    const funds = [
      makeFund({ id: 'A', aumBillions: 500 }),
      makeFund({ id: 'B', aumBillions: 1000 }),
      makeFund({ id: 'C', aumBillions: 200 }),
    ];
    const result = getLargestFunds(funds, 3);
    assert.equal(result[0].aumBillions, 1000);
    assert.equal(result[1].aumBillions, 500);
    assert.equal(result[2].aumBillions, 200);
  });

  test('limits to n results', () => {
    const funds = Array.from({ length: 10 }, (_, i) => makeFund({ id: `F${i}`, aumBillions: i * 100 }));
    assert.equal(getLargestFunds(funds, 3).length, 3);
  });

  test('default n=5', () => {
    const funds = Array.from({ length: 10 }, (_, i) => makeFund({ id: `F${i}`, aumBillions: i * 100 }));
    assert.equal(getLargestFunds(funds).length, 5);
  });

  test('does not mutate original array', () => {
    const funds = [
      makeFund({ id: 'A', aumBillions: 100 }),
      makeFund({ id: 'B', aumBillions: 500 }),
    ];
    const original = [...funds];
    getLargestFunds(funds, 2);
    assert.equal(funds[0].id, original[0].id);
  });

  test('returns all when n >= length', () => {
    const funds = [makeFund({ aumBillions: 100 }), makeFund({ aumBillions: 200 })];
    assert.equal(getLargestFunds(funds, 10).length, 2);
  });

  test('returns empty for empty input', () => {
    assert.deepEqual(getLargestFunds([]), []);
  });
});

// ─── getHighRiskFunds ─────────────────────────────────────────────────────────

describe('getHighRiskFunds', () => {
  test('returns High and Critical risk funds', () => {
    const funds = [
      makeFund({ id: 'A', geopoliticalRisk: 'High' }),
      makeFund({ id: 'B', geopoliticalRisk: 'Critical' }),
      makeFund({ id: 'C', geopoliticalRisk: 'Low' }),
      makeFund({ id: 'D', geopoliticalRisk: 'Moderate' }),
    ];
    const result = getHighRiskFunds(funds);
    assert.equal(result.length, 2);
    assert.ok(result.every((f) => f.geopoliticalRisk === 'High' || f.geopoliticalRisk === 'Critical'));
  });

  test('excludes Low and Moderate risk funds', () => {
    const funds = [
      makeFund({ geopoliticalRisk: 'Low' }),
      makeFund({ geopoliticalRisk: 'Moderate' }),
    ];
    assert.equal(getHighRiskFunds(funds).length, 0);
  });

  test('returns empty for empty input', () => {
    assert.deepEqual(getHighRiskFunds([]), []);
  });

  test('all High risk funds included', () => {
    const funds = [
      makeFund({ id: 'A', geopoliticalRisk: 'High' }),
      makeFund({ id: 'B', geopoliticalRisk: 'High' }),
    ];
    assert.equal(getHighRiskFunds(funds).length, 2);
  });
});

// ─── getStrategicAcquisitions ─────────────────────────────────────────────────

describe('getStrategicAcquisitions', () => {
  test('filters by use pattern', () => {
    const investments = [
      makeInvestment({ id: 'A', usePattern: 'Sports Washing' }),
      makeInvestment({ id: 'B', usePattern: 'Tech Acquisition' }),
      makeInvestment({ id: 'C', usePattern: 'Sports Washing' }),
    ];
    const result = getStrategicAcquisitions(investments, 'Sports Washing');
    assert.equal(result.length, 2);
    assert.ok(result.every((i) => i.usePattern === 'Sports Washing'));
  });

  test('returns empty when no pattern matches', () => {
    const investments = [makeInvestment({ usePattern: 'Diversification' })];
    assert.equal(getStrategicAcquisitions(investments, 'Sanctions Evasion').length, 0);
  });

  test('returns empty for empty input', () => {
    assert.deepEqual(getStrategicAcquisitions([], 'Sports Washing'), []);
  });

  test('exact pattern match only', () => {
    const investments = [makeInvestment({ usePattern: 'Port & Infrastructure' })];
    assert.equal(getStrategicAcquisitions(investments, 'Tech Acquisition').length, 0);
    assert.equal(getStrategicAcquisitions(investments, 'Port & Infrastructure').length, 1);
  });
});

// ─── computeTotalAum ──────────────────────────────────────────────────────────

describe('computeTotalAum', () => {
  test('sums aumBillions across all funds', () => {
    const funds = [
      makeFund({ aumBillions: 500 }),
      makeFund({ aumBillions: 1000 }),
      makeFund({ aumBillions: 250 }),
    ];
    assert.equal(computeTotalAum(funds), 1750);
  });

  test('returns 0 for empty array', () => {
    assert.equal(computeTotalAum([]), 0);
  });

  test('single fund returns its own AUM', () => {
    assert.equal(computeTotalAum([makeFund({ aumBillions: 1700 })]), 1700);
  });

  test('returns number type', () => {
    assert.equal(typeof computeTotalAum([makeFund()]), 'number');
  });
});

// ─── transparencyClass ────────────────────────────────────────────────────────

describe('transparencyClass', () => {
  const cases: [Transparency, string][] = [
    ['High', 'transp-high'],
    ['Medium', 'transp-medium'],
    ['Low', 'transp-low'],
    ['Opaque', 'transp-opaque'],
  ];

  for (const [input, expected] of cases) {
    test(`${input} => "${expected}"`, () => {
      assert.equal(transparencyClass(input), expected);
    });
  }

  test('returns string type', () => {
    assert.equal(typeof transparencyClass('High'), 'string');
  });
});

// ─── riskClass ────────────────────────────────────────────────────────────────

describe('riskClass', () => {
  const cases: [GeopoliticalRisk, string][] = [
    ['Low', 'risk-low'],
    ['Moderate', 'risk-moderate'],
    ['High', 'risk-high'],
    ['Critical', 'risk-critical'],
  ];

  for (const [input, expected] of cases) {
    test(`${input} => "${expected}"`, () => {
      assert.equal(riskClass(input), expected);
    });
  }

  test('returns string type', () => {
    assert.equal(typeof riskClass('Low'), 'string');
  });
});

// ─── buildRenderData ──────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  test('returns object with required fields', () => {
    const data = buildRenderData();
    assert.ok('funds' in data);
    assert.ok('investments' in data);
    assert.ok('totalAumTrillions' in data);
    assert.ok('highRiskCount' in data);
    assert.ok('sanctionedCount' in data);
    assert.ok('largestFund' in data);
  });

  test('funds array has 12 entries', () => {
    const { funds } = buildRenderData();
    assert.equal(funds.length, 12);
  });

  test('investments array has 8 entries', () => {
    const { investments } = buildRenderData();
    assert.equal(investments.length, 8);
  });

  test('totalAumTrillions is a positive number', () => {
    const { totalAumTrillions } = buildRenderData();
    assert.ok(totalAumTrillions > 0);
    assert.equal(typeof totalAumTrillions, 'number');
  });

  test('totalAumTrillions rounds to one decimal', () => {
    const { totalAumTrillions } = buildRenderData();
    // Should be consistent with Math.round(total/1000 * 10)/10
    assert.equal(totalAumTrillions, Math.round(totalAumTrillions * 10) / 10);
  });

  test('highRiskCount > 0 (several high-risk funds exist)', () => {
    const { highRiskCount } = buildRenderData();
    assert.ok(highRiskCount > 0);
  });

  test('sanctionedCount >= 1 (Russia RDIF is sanctioned)', () => {
    const { sanctionedCount } = buildRenderData();
    assert.ok(sanctionedCount >= 1);
  });

  test('largestFund is Norway GPFG ($1.7T)', () => {
    const { largestFund } = buildRenderData();
    assert.ok(largestFund !== null);
    assert.ok(largestFund!.aumBillions === 1700);
    assert.match(largestFund!.name, /Norway|GPFG/i);
  });

  test('all funds have required fields', () => {
    const { funds } = buildRenderData();
    for (const fund of funds) {
      assert.ok(fund.id, `fund missing id`);
      assert.ok(fund.name, `fund missing name`);
      assert.ok(fund.country, `fund missing country`);
      assert.ok(fund.aumBillions > 0, `${fund.id} has non-positive AUM`);
      assert.ok(Array.isArray(fund.usePatterns), `${fund.id} usePatterns not array`);
      assert.ok(Array.isArray(fund.notableHoldings), `${fund.id} notableHoldings not array`);
    }
  });

  test('all investments have required fields', () => {
    const { investments } = buildRenderData();
    for (const inv of investments) {
      assert.ok(inv.id, `investment missing id`);
      assert.ok(inv.fund, `investment missing fund`);
      assert.ok(inv.target, `investment missing target`);
      assert.ok(inv.usePattern, `investment missing usePattern`);
      assert.ok(inv.geopoliticalSignal, `investment missing geopoliticalSignal`);
    }
  });

  test('Norway GPFG is present with correct data', () => {
    const { funds } = buildRenderData();
    const norway = funds.find((f) => f.id === 'SWF001');
    assert.ok(norway);
    assert.equal(norway!.country, 'Norway');
    assert.equal(norway!.transparency, 'High');
    assert.equal(norway!.geopoliticalRisk, 'Low');
    assert.equal(norway!.sanctioned, false);
  });

  test('Russia RDIF is present and sanctioned', () => {
    const { funds } = buildRenderData();
    const rdif = funds.find((f) => f.id === 'SWF010');
    assert.ok(rdif);
    assert.equal(rdif!.sanctioned, true);
    assert.equal(rdif!.geopoliticalRisk, 'Critical');
    assert.equal(rdif!.transparency, 'Opaque');
  });

  test('Saudi PIF has Sports Washing pattern', () => {
    const { funds } = buildRenderData();
    const pif = funds.find((f) => f.id === 'SWF004');
    assert.ok(pif);
    assert.ok(pif!.usePatterns.includes('Sports Washing'));
  });

  test('buildRenderData is idempotent (same output on repeated calls)', () => {
    const a = buildRenderData();
    const b = buildRenderData();
    assert.equal(a.funds.length, b.funds.length);
    assert.equal(a.totalAumTrillions, b.totalAumTrillions);
    assert.equal(a.highRiskCount, b.highRiskCount);
  });

  test('highRiskCount matches manual count of High+Critical funds', () => {
    const { funds, highRiskCount } = buildRenderData();
    const manual = funds.filter(
      (f) => f.geopoliticalRisk === 'High' || f.geopoliticalRisk === 'Critical',
    ).length;
    assert.equal(highRiskCount, manual);
  });

  test('sanctionedCount matches manual count', () => {
    const { funds, sanctionedCount } = buildRenderData();
    const manual = funds.filter((f) => f.sanctioned).length;
    assert.equal(sanctionedCount, manual);
  });

  test('investments include Newcastle United entry', () => {
    const { investments } = buildRenderData();
    const newcastle = investments.find((i) => i.id === 'SI001');
    assert.ok(newcastle);
    assert.equal(newcastle!.usePattern, 'Sports Washing');
    assert.match(newcastle!.target, /Newcastle/i);
  });

  test('investments include LIV Golf entry', () => {
    const { investments } = buildRenderData();
    const liv = investments.find((i) => i.id === 'SI002');
    assert.ok(liv);
    assert.equal(liv!.fund, 'Saudi PIF');
    assert.match(liv!.target, /LIV/i);
  });

  test('all fund IDs are unique', () => {
    const { funds } = buildRenderData();
    const ids = funds.map((f) => f.id);
    assert.equal(ids.length, new Set(ids).size);
  });

  test('all investment IDs are unique', () => {
    const { investments } = buildRenderData();
    const ids = investments.map((i) => i.id);
    assert.equal(ids.length, new Set(ids).size);
  });
});
