import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  computeGlobalRearmamentIndex,
  getTopSpenders,
  getRearmingCountries,
  computeNATOComplianceRate,
  gdpPercentClass,
  trendClass,
  trendArrow,
  buildRenderData,
  type CountrySpending,
  type SpendingTrend,
} from '../global-military-spending-helpers.ts';

const MOCK_COUNTRIES: CountrySpending[] = [
  { id: 'T001', country: 'Alpha', region: 'Europe', budgetBn: 500, gdpPercent: 3.5, yoyChangePct: 5, trend: 'increasing', procurementFocus: ['Jets', 'Tanks'], natoMember: true, notes: 'Large NATO spender' },
  { id: 'T002', country: 'Beta', region: 'Asia', budgetBn: 200, gdpPercent: 1.5, yoyChangePct: 15, trend: 'surging', procurementFocus: ['Ships', 'Missiles'], natoMember: false, notes: 'Regional power' },
  { id: 'T003', country: 'Gamma', region: 'Middle East', budgetBn: 80, gdpPercent: 5.0, yoyChangePct: 2, trend: 'stable', procurementFocus: ['Air defense'], natoMember: false, notes: 'Gulf state' },
  { id: 'T004', country: 'Delta', region: 'Europe', budgetBn: 60, gdpPercent: 1.8, yoyChangePct: 20, trend: 'surging', procurementFocus: ['Drones', 'Artillery'], natoMember: true, notes: 'Surging NATO member' },
  { id: 'T005', country: 'Epsilon', region: 'North America', budgetBn: 50, gdpPercent: 2.0, yoyChangePct: 3, trend: 'stable', procurementFocus: ['Submarines', 'Cyber'], natoMember: true, notes: 'Meets 2% target' },
  { id: 'T006', country: 'Zeta', region: 'Asia', budgetBn: 30, gdpPercent: 0.8, yoyChangePct: -2, trend: 'decreasing', procurementFocus: ['Border security'], natoMember: false, notes: 'Cutting budget' },
];

// ── getTopSpenders ────────────────────────────────────────────────────────────
describe('getTopSpenders', () => {
  it('returns top 5 by default', () => {
    const top = getTopSpenders(MOCK_COUNTRIES);
    assert.equal(top.length, 5);
  });

  it('returns correct top N when specified', () => {
    const top = getTopSpenders(MOCK_COUNTRIES, 3);
    assert.equal(top.length, 3);
  });

  it('first result is the highest spender', () => {
    const top = getTopSpenders(MOCK_COUNTRIES);
    assert.equal(top[0].country, 'Alpha');
  });

  it('results are sorted descending by budgetBn', () => {
    const top = getTopSpenders(MOCK_COUNTRIES);
    for (let i = 0; i < top.length - 1; i++) {
      assert.ok(top[i].budgetBn >= top[i + 1].budgetBn);
    }
  });

  it('does not mutate the original array', () => {
    const original = MOCK_COUNTRIES.map(c => c.id);
    getTopSpenders(MOCK_COUNTRIES);
    assert.deepEqual(MOCK_COUNTRIES.map(c => c.id), original);
  });

  it('handles N larger than array length gracefully', () => {
    const top = getTopSpenders(MOCK_COUNTRIES, 100);
    assert.equal(top.length, MOCK_COUNTRIES.length);
  });

  it('handles empty array', () => {
    const top = getTopSpenders([]);
    assert.equal(top.length, 0);
  });

  it('returns exactly 1 entry when N=1', () => {
    const top = getTopSpenders(MOCK_COUNTRIES, 1);
    assert.equal(top.length, 1);
    assert.equal(top[0].country, 'Alpha');
  });
});

// ── getRearmingCountries ──────────────────────────────────────────────────────
describe('getRearmingCountries', () => {
  it('uses default threshold of 10%', () => {
    const rearming = getRearmingCountries(MOCK_COUNTRIES);
    // Beta (15%) and Delta (20%) qualify
    assert.equal(rearming.length, 2);
  });

  it('all returned countries meet the custom threshold', () => {
    const rearming = getRearmingCountries(MOCK_COUNTRIES, 5);
    assert.ok(rearming.every(c => c.yoyChangePct >= 5));
  });

  it('includes countries exactly at the threshold', () => {
    const rearming = getRearmingCountries(MOCK_COUNTRIES, 15);
    assert.ok(rearming.some(c => c.yoyChangePct === 15));
  });

  it('returns empty when threshold is very high', () => {
    const rearming = getRearmingCountries(MOCK_COUNTRIES, 100);
    assert.equal(rearming.length, 0);
  });

  it('handles empty array', () => {
    assert.equal(getRearmingCountries([]).length, 0);
  });

  it('excludes decreasing countries at default threshold', () => {
    const rearming = getRearmingCountries(MOCK_COUNTRIES);
    assert.ok(!rearming.some(c => c.country === 'Zeta'));
  });

  it('stable-trend countries below threshold are excluded', () => {
    const rearming = getRearmingCountries(MOCK_COUNTRIES, 10);
    assert.ok(!rearming.some(c => c.country === 'Gamma'));
  });
});

// ── computeGlobalRearmamentIndex ─────────────────────────────────────────────
describe('computeGlobalRearmamentIndex', () => {
  it('returns a number between 0 and 100', () => {
    const idx = computeGlobalRearmamentIndex(MOCK_COUNTRIES);
    assert.ok(idx >= 0 && idx <= 100);
  });

  it('returns 0 for empty array', () => {
    assert.equal(computeGlobalRearmamentIndex([]), 0);
  });

  it('higher average YoY yields higher index', () => {
    const high = MOCK_COUNTRIES.map(c => ({ ...c, yoyChangePct: 30 }));
    const low = MOCK_COUNTRIES.map(c => ({ ...c, yoyChangePct: 0 }));
    assert.ok(computeGlobalRearmamentIndex(high) > computeGlobalRearmamentIndex(low));
  });

  it('returns an integer', () => {
    const idx = computeGlobalRearmamentIndex(MOCK_COUNTRIES);
    assert.equal(idx, Math.round(idx));
  });

  it('30% average YoY yields index of exactly 100', () => {
    const countries = MOCK_COUNTRIES.map(c => ({ ...c, yoyChangePct: 30 }));
    assert.equal(computeGlobalRearmamentIndex(countries), 100);
  });

  it('0% average YoY yields index of 0', () => {
    const countries = MOCK_COUNTRIES.map(c => ({ ...c, yoyChangePct: 0 }));
    assert.equal(computeGlobalRearmamentIndex(countries), 0);
  });

  it('clamps to 100 for very high average YoY', () => {
    const countries = MOCK_COUNTRIES.map(c => ({ ...c, yoyChangePct: 100 }));
    assert.equal(computeGlobalRearmamentIndex(countries), 100);
  });

  it('clamps to 0 for negative average YoY', () => {
    const countries = MOCK_COUNTRIES.map(c => ({ ...c, yoyChangePct: -50 }));
    assert.equal(computeGlobalRearmamentIndex(countries), 0);
  });

  it('single country at 15% YoY yields 50', () => {
    const countries = [{ ...MOCK_COUNTRIES[0], yoyChangePct: 15 }];
    assert.equal(computeGlobalRearmamentIndex(countries), 50);
  });
});

// ── computeNATOComplianceRate ─────────────────────────────────────────────────
describe('computeNATOComplianceRate', () => {
  it('returns a number between 0 and 100', () => {
    const rate = computeNATOComplianceRate(MOCK_COUNTRIES);
    assert.ok(rate >= 0 && rate <= 100);
  });

  it('returns 0 when no NATO members exist', () => {
    const nonNATO = MOCK_COUNTRIES.map(c => ({ ...c, natoMember: false }));
    assert.equal(computeNATOComplianceRate(nonNATO), 0);
  });

  it('returns 100 when all NATO members meet 2% target', () => {
    const allCompliant = MOCK_COUNTRIES.map(c => ({ ...c, natoMember: true, gdpPercent: 2.5 }));
    assert.equal(computeNATOComplianceRate(allCompliant), 100);
  });

  it('returns correct percentage for mixed compliance', () => {
    // Alpha (3.5% NATO - compliant), Delta (1.8% NATO - not), Epsilon (2.0% NATO - compliant)
    const rate = computeNATOComplianceRate(MOCK_COUNTRIES);
    assert.equal(rate, Math.round((2 / 3) * 100));
  });

  it('handles empty array', () => {
    assert.equal(computeNATOComplianceRate([]), 0);
  });

  it('2.0% exactly is considered compliant', () => {
    const countries = [{ ...MOCK_COUNTRIES[0], natoMember: true, gdpPercent: 2.0 }];
    assert.equal(computeNATOComplianceRate(countries), 100);
  });

  it('1.99% is NOT considered compliant', () => {
    const countries = [{ ...MOCK_COUNTRIES[0], natoMember: true, gdpPercent: 1.99 }];
    assert.equal(computeNATOComplianceRate(countries), 0);
  });

  it('returns an integer', () => {
    const rate = computeNATOComplianceRate(MOCK_COUNTRIES);
    assert.equal(rate, Math.round(rate));
  });
});

// ── gdpPercentClass ────────────────────────────────────────────────────────────
describe('gdpPercentClass', () => {
  it('returns mil-critical for exactly 4.0', () => {
    assert.equal(gdpPercentClass(4.0), 'mil-critical');
  });

  it('returns mil-critical for values above 4.0', () => {
    assert.equal(gdpPercentClass(6.7), 'mil-critical');
    assert.equal(gdpPercentClass(34.0), 'mil-critical');
  });

  it('returns mil-high for 2.5 to <4.0', () => {
    assert.equal(gdpPercentClass(2.5), 'mil-high');
    assert.equal(gdpPercentClass(3.9), 'mil-high');
    assert.equal(gdpPercentClass(2.7), 'mil-high');
  });

  it('returns mil-moderate for exactly 2.0', () => {
    assert.equal(gdpPercentClass(2.0), 'mil-moderate');
  });

  it('returns mil-moderate for 2.0 to <2.5', () => {
    assert.equal(gdpPercentClass(2.4), 'mil-moderate');
    assert.equal(gdpPercentClass(2.3), 'mil-moderate');
  });

  it('returns mil-low for 1.5 to <2.0', () => {
    assert.equal(gdpPercentClass(1.5), 'mil-low');
    assert.equal(gdpPercentClass(1.9), 'mil-low');
  });

  it('returns mil-minimal for values below 1.5', () => {
    assert.equal(gdpPercentClass(1.4), 'mil-minimal');
    assert.equal(gdpPercentClass(0.8), 'mil-minimal');
    assert.equal(gdpPercentClass(0), 'mil-minimal');
  });
});

// ── trendClass ─────────────────────────────────────────────────────────────────
describe('trendClass', () => {
  it('returns trend-surging for surging trend', () => {
    assert.equal(trendClass('surging'), 'trend-surging');
  });

  it('returns trend-up for increasing trend', () => {
    assert.equal(trendClass('increasing'), 'trend-up');
  });

  it('returns trend-flat for stable trend', () => {
    assert.equal(trendClass('stable'), 'trend-flat');
  });

  it('returns trend-down for decreasing trend', () => {
    assert.equal(trendClass('decreasing'), 'trend-down');
  });
});

// ── trendArrow ─────────────────────────────────────────────────────────────────
describe('trendArrow', () => {
  it('returns double up arrow for surging', () => {
    assert.equal(trendArrow('surging'), '\u2191\u2191');
  });

  it('returns single up arrow for increasing', () => {
    assert.equal(trendArrow('increasing'), '\u2191');
  });

  it('returns right arrow for stable', () => {
    assert.equal(trendArrow('stable'), '\u2192');
  });

  it('returns down arrow for decreasing', () => {
    assert.equal(trendArrow('decreasing'), '\u2193');
  });
});

// ── buildRenderData ────────────────────────────────────────────────────────────
describe('buildRenderData', () => {
  it('returns a non-null object', () => {
    const data = buildRenderData();
    assert.ok(data !== null && typeof data === 'object');
  });

  it('countries array has exactly 15 entries', () => {
    const { countries } = buildRenderData();
    assert.equal(countries.length, 15);
  });

  it('hotspots array is non-empty', () => {
    const { hotspots } = buildRenderData();
    assert.ok(hotspots.length > 0);
  });

  it('events array is non-empty', () => {
    const { events } = buildRenderData();
    assert.ok(events.length > 0);
  });

  it('globalRearmamentIndex is between 0 and 100', () => {
    const { globalRearmamentIndex } = buildRenderData();
    assert.ok(globalRearmamentIndex >= 0 && globalRearmamentIndex <= 100);
  });

  it('topSpenders has exactly 5 entries', () => {
    const { topSpenders } = buildRenderData();
    assert.equal(topSpenders.length, 5);
  });

  it('USA is the top spender', () => {
    const { topSpenders } = buildRenderData();
    assert.equal(topSpenders[0].country, 'USA');
  });

  it('rearmingCount matches countries with YoY >= 10%', () => {
    const { countries, rearmingCount } = buildRenderData();
    const expected = countries.filter(c => c.yoyChangePct >= 10).length;
    assert.equal(rearmingCount, expected);
  });

  it('natoComplianceRate is between 0 and 100', () => {
    const { natoComplianceRate } = buildRenderData();
    assert.ok(natoComplianceRate >= 0 && natoComplianceRate <= 100);
  });

  it('totalGlobalSpendingBn is positive', () => {
    const { totalGlobalSpendingBn } = buildRenderData();
    assert.ok(totalGlobalSpendingBn > 0);
  });

  it('totalGlobalSpendingBn equals sum of all country budgets', () => {
    const { countries, totalGlobalSpendingBn } = buildRenderData();
    const expected = countries.reduce((s, c) => s + c.budgetBn, 0);
    assert.equal(totalGlobalSpendingBn, expected);
  });

  it('all countries have valid trend values', () => {
    const { countries } = buildRenderData();
    const valid: SpendingTrend[] = ['stable', 'increasing', 'surging', 'decreasing'];
    assert.ok(countries.every(c => valid.includes(c.trend)));
  });

  it('all countries have non-empty procurementFocus', () => {
    const { countries } = buildRenderData();
    assert.ok(countries.every(c => c.procurementFocus.length > 0));
  });

  it('all countries have positive budgetBn', () => {
    const { countries } = buildRenderData();
    assert.ok(countries.every(c => c.budgetBn > 0));
  });

  it('all countries have positive gdpPercent', () => {
    const { countries } = buildRenderData();
    assert.ok(countries.every(c => c.gdpPercent > 0));
  });

  it('USA budget is 916B', () => {
    const { countries } = buildRenderData();
    const usa = countries.find(c => c.country === 'USA');
    assert.ok(usa !== undefined);
    assert.equal(usa.budgetBn, 916);
  });

  it('Poland trend is surging', () => {
    const { countries } = buildRenderData();
    const poland = countries.find(c => c.country === 'Poland');
    assert.ok(poland !== undefined);
    assert.equal(poland.trend, 'surging');
  });

  it('Russia trend is surging', () => {
    const { countries } = buildRenderData();
    const russia = countries.find(c => c.country === 'Russia');
    assert.ok(russia !== undefined);
    assert.equal(russia.trend, 'surging');
  });

  it('all hotspots have severity between 1 and 10', () => {
    const { hotspots } = buildRenderData();
    assert.ok(hotspots.every(hs => hs.severity >= 1 && hs.severity <= 10));
  });

  it('all events have positive valueUsdBn', () => {
    const { events } = buildRenderData();
    assert.ok(events.every(e => e.valueUsdBn > 0));
  });

  it('all countries have non-empty notes', () => {
    const { countries } = buildRenderData();
    assert.ok(countries.every(c => c.notes.length > 0));
  });

  it('all countries have non-empty id', () => {
    const { countries } = buildRenderData();
    assert.ok(countries.every(c => c.id.length > 0));
  });

  it('topSpenders are in descending budget order', () => {
    const { topSpenders } = buildRenderData();
    for (let i = 0; i < topSpenders.length - 1; i++) {
      assert.ok(topSpenders[i].budgetBn >= topSpenders[i + 1].budgetBn);
    }
  });

  it('all events have non-empty countries array', () => {
    const { events } = buildRenderData();
    assert.ok(events.every(e => e.countries.length > 0));
  });

  it('all hotspots have non-empty drivingForce', () => {
    const { hotspots } = buildRenderData();
    assert.ok(hotspots.every(hs => hs.drivingForce.length > 0));
  });
});
