import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  computeGlobalFreedomIndex,
  getByCategory,
  getDecliningCountries,
  getMostJailed,
  getHighRiskCountries,
  freedomClass,
  trendClass,
  trendArrow,
  incidentStatusClass,
  buildRenderData,
  type CountryFreedom,
  type FreedomCategory,
  type FreedomTrend,
} from '../media-freedom-helpers.ts';

// ── Fixtures ────────────────────────────────────────────────────────────────
function makeCountry(overrides: Partial<CountryFreedom> = {}): CountryFreedom {
  return {
    id: 'TEST',
    country: 'Testland',
    rsfScore: 50,
    category: 'Satisfactory',
    trend: 'stable',
    journalistsJailed: 0,
    notes: 'test',
    population: 10,
    ...overrides,
  };
}

const MOCK_COUNTRIES: CountryFreedom[] = [
  makeCountry({ id: 'T1', country: 'Alpha',   rsfScore: 94, category: 'Free',         trend: 'stable',    journalistsJailed: 0,  population: 5    }),
  makeCountry({ id: 'T2', country: 'Beta',    rsfScore: 79, category: 'Good',         trend: 'improving', journalistsJailed: 0,  population: 84   }),
  makeCountry({ id: 'T3', country: 'Gamma',   rsfScore: 66, category: 'Satisfactory', trend: 'declining', journalistsJailed: 0,  population: 335  }),
  makeCountry({ id: 'T4', country: 'Delta',   rsfScore: 55, category: 'Problematic',  trend: 'declining', journalistsJailed: 2,  population: 10   }),
  makeCountry({ id: 'T5', country: 'Epsilon', rsfScore: 32, category: 'Difficult',    trend: 'declining', journalistsJailed: 17, population: 85   }),
  makeCountry({ id: 'T6', country: 'Zeta',    rsfScore: 8,  category: 'Very Serious', trend: 'stable',    journalistsJailed: 100,population: 1410 }),
];

// ── computeGlobalFreedomIndex ─────────────────────────────────────────────────
describe('computeGlobalFreedomIndex', () => {
  it('returns 0 for empty array', () => {
    assert.equal(computeGlobalFreedomIndex([]), 0);
  });
  it('returns a number between 0 and 100', () => {
    const idx = computeGlobalFreedomIndex(MOCK_COUNTRIES);
    assert.ok(idx >= 0 && idx <= 100, `Expected 0-100, got ${idx}`);
  });
  it('returns an integer', () => {
    const idx = computeGlobalFreedomIndex(MOCK_COUNTRIES);
    assert.equal(idx, Math.round(idx));
  });
  it('single country with score 94 returns 94', () => {
    assert.equal(computeGlobalFreedomIndex([makeCountry({ rsfScore: 94 })]), 94);
  });
  it('population weighting: large low-score country pulls index down', () => {
    const withBig  = computeGlobalFreedomIndex(MOCK_COUNTRIES);
    const withoutBig = computeGlobalFreedomIndex(MOCK_COUNTRIES.filter(c => c.id !== 'T6'));
    assert.ok(withoutBig > withBig, 'Removing the large low-score country should raise index');
  });
  it('all same score returns that score', () => {
    const all50 = MOCK_COUNTRIES.map(c => ({ ...c, rsfScore: 50 }));
    assert.equal(computeGlobalFreedomIndex(all50), 50);
  });
  it('all score 0 returns 0', () => {
    const all0 = MOCK_COUNTRIES.map(c => ({ ...c, rsfScore: 0 }));
    assert.equal(computeGlobalFreedomIndex(all0), 0);
  });
  it('single country with score 100 returns 100', () => {
    assert.equal(computeGlobalFreedomIndex([makeCountry({ rsfScore: 100 })]), 100);
  });
});

// ── getByCategory ─────────────────────────────────────────────────────────────
describe('getByCategory', () => {
  it('returns only Free countries', () => {
    const free = getByCategory(MOCK_COUNTRIES, 'Free');
    assert.equal(free.length, 1);
    assert.equal(free[0].id, 'T1');
  });
  it('returns only Good countries', () => {
    const good = getByCategory(MOCK_COUNTRIES, 'Good');
    assert.equal(good.length, 1);
    assert.equal(good[0].id, 'T2');
  });
  it('returns only Satisfactory countries', () => {
    const sat = getByCategory(MOCK_COUNTRIES, 'Satisfactory');
    assert.equal(sat.length, 1);
    assert.equal(sat[0].id, 'T3');
  });
  it('returns only Problematic countries', () => {
    const prob = getByCategory(MOCK_COUNTRIES, 'Problematic');
    assert.equal(prob.length, 1);
    assert.equal(prob[0].id, 'T4');
  });
  it('returns only Difficult countries', () => {
    const diff = getByCategory(MOCK_COUNTRIES, 'Difficult');
    assert.equal(diff.length, 1);
    assert.equal(diff[0].id, 'T5');
  });
  it('returns only Very Serious countries', () => {
    const vs = getByCategory(MOCK_COUNTRIES, 'Very Serious');
    assert.equal(vs.length, 1);
    assert.equal(vs[0].id, 'T6');
  });
  it('returns empty when none match', () => {
    const all = MOCK_COUNTRIES.map(c => ({ ...c, category: 'Free' as FreedomCategory }));
    assert.equal(getByCategory(all, 'Very Serious').length, 0);
  });
  it('does not mutate input array', () => {
    const before = MOCK_COUNTRIES.length;
    getByCategory(MOCK_COUNTRIES, 'Free');
    assert.equal(MOCK_COUNTRIES.length, before);
  });
});

// ── getDecliningCountries ─────────────────────────────────────────────────────
describe('getDecliningCountries', () => {
  it('returns only declining trend countries', () => {
    const dec = getDecliningCountries(MOCK_COUNTRIES);
    assert.ok(dec.every(c => c.trend === 'declining'));
  });
  it('returns correct count (T3, T4, T5 are declining)', () => {
    assert.equal(getDecliningCountries(MOCK_COUNTRIES).length, 3);
  });
  it('returns empty when none are declining', () => {
    const all = MOCK_COUNTRIES.map(c => ({ ...c, trend: 'stable' as FreedomTrend }));
    assert.equal(getDecliningCountries(all).length, 0);
  });
  it('returns all when all are declining', () => {
    const all = MOCK_COUNTRIES.map(c => ({ ...c, trend: 'declining' as FreedomTrend }));
    assert.equal(getDecliningCountries(all).length, MOCK_COUNTRIES.length);
  });
  it('does not include improving trend', () => {
    const dec = getDecliningCountries(MOCK_COUNTRIES);
    assert.ok(!dec.some(c => c.trend === 'improving'));
  });
  it('does not mutate input array', () => {
    const before = MOCK_COUNTRIES.length;
    getDecliningCountries(MOCK_COUNTRIES);
    assert.equal(MOCK_COUNTRIES.length, before);
  });
});

// ── getMostJailed ─────────────────────────────────────────────────────────────
describe('getMostJailed', () => {
  it('returns countries sorted by journalistsJailed descending', () => {
    const top = getMostJailed(MOCK_COUNTRIES);
    assert.equal(top[0].journalistsJailed, 100);
    assert.equal(top[1].journalistsJailed, 17);
    assert.equal(top[2].journalistsJailed, 2);
  });
  it('excludes countries with 0 jailed', () => {
    const top = getMostJailed(MOCK_COUNTRIES);
    assert.ok(top.every(c => c.journalistsJailed > 0));
  });
  it('respects n parameter: n=2 returns 2', () => {
    assert.equal(getMostJailed(MOCK_COUNTRIES, 2).length, 2);
  });
  it('respects n parameter: n=1 returns 1', () => {
    assert.equal(getMostJailed(MOCK_COUNTRIES, 1).length, 1);
  });
  it('returns empty when all have 0 jailed', () => {
    const none = MOCK_COUNTRIES.map(c => ({ ...c, journalistsJailed: 0 }));
    assert.equal(getMostJailed(none).length, 0);
  });
  it('default n=5 caps output at 5 even if more qualify', () => {
    const many = Array.from({ length: 10 }, (_, i) => makeCountry({ id: `X${i}`, journalistsJailed: i + 1 }));
    assert.equal(getMostJailed(many).length, 5);
  });
  it('does not mutate input array', () => {
    const before = MOCK_COUNTRIES.length;
    getMostJailed(MOCK_COUNTRIES);
    assert.equal(MOCK_COUNTRIES.length, before);
  });
});

// ── getHighRiskCountries ──────────────────────────────────────────────────────
describe('getHighRiskCountries', () => {
  it('returns Difficult and Very Serious countries', () => {
    const hr = getHighRiskCountries(MOCK_COUNTRIES);
    assert.ok(hr.every(c => c.category === 'Difficult' || c.category === 'Very Serious'));
  });
  it('returns correct count (T5 Difficult + T6 Very Serious)', () => {
    assert.equal(getHighRiskCountries(MOCK_COUNTRIES).length, 2);
  });
  it('excludes Free countries', () => {
    assert.ok(!getHighRiskCountries(MOCK_COUNTRIES).some(c => c.category === 'Free'));
  });
  it('excludes Good countries', () => {
    assert.ok(!getHighRiskCountries(MOCK_COUNTRIES).some(c => c.category === 'Good'));
  });
  it('excludes Satisfactory countries', () => {
    assert.ok(!getHighRiskCountries(MOCK_COUNTRIES).some(c => c.category === 'Satisfactory'));
  });
  it('excludes Problematic countries', () => {
    assert.ok(!getHighRiskCountries(MOCK_COUNTRIES).some(c => c.category === 'Problematic'));
  });
  it('returns empty when no high-risk countries', () => {
    const all = MOCK_COUNTRIES.map(c => ({ ...c, category: 'Free' as FreedomCategory }));
    assert.equal(getHighRiskCountries(all).length, 0);
  });
  it('does not mutate input', () => {
    const before = MOCK_COUNTRIES.length;
    getHighRiskCountries(MOCK_COUNTRIES);
    assert.equal(MOCK_COUNTRIES.length, before);
  });
});

// ── freedomClass ──────────────────────────────────────────────────────────────
describe('freedomClass', () => {
  it('Free returns mf-free',               () => { assert.equal(freedomClass('Free'),         'mf-free');         });
  it('Good returns mf-good',               () => { assert.equal(freedomClass('Good'),         'mf-good');         });
  it('Satisfactory returns mf-satisfactory',() => { assert.equal(freedomClass('Satisfactory'),'mf-satisfactory'); });
  it('Problematic returns mf-problematic', () => { assert.equal(freedomClass('Problematic'),  'mf-problematic');  });
  it('Difficult returns mf-difficult',     () => { assert.equal(freedomClass('Difficult'),    'mf-difficult');    });
  it('Very Serious returns mf-very-serious',() => { assert.equal(freedomClass('Very Serious'),'mf-very-serious'); });
});

// ── trendClass ────────────────────────────────────────────────────────────────
describe('trendClass', () => {
  it('improving returns trend-up',   () => { assert.equal(trendClass('improving'), 'trend-up');   });
  it('stable returns trend-flat',    () => { assert.equal(trendClass('stable'),    'trend-flat'); });
  it('declining returns trend-down', () => { assert.equal(trendClass('declining'), 'trend-down'); });
});

// ── trendArrow ────────────────────────────────────────────────────────────────
describe('trendArrow', () => {
  it('improving returns up arrow ↑',    () => { assert.equal(trendArrow('improving'), '↑'); });
  it('stable returns right arrow →',   () => { assert.equal(trendArrow('stable'),    '→'); });
  it('declining returns down arrow ↓', () => { assert.equal(trendArrow('declining'), '↓'); });
});

// ── incidentStatusClass ───────────────────────────────────────────────────────
describe('incidentStatusClass', () => {
  it('Resolved returns incident-resolved',     () => { assert.equal(incidentStatusClass('Resolved'),   'incident-resolved');   });
  it('Ongoing returns incident-ongoing',       () => { assert.equal(incidentStatusClass('Ongoing'),    'incident-ongoing');    });
  it('Escalating returns incident-escalating', () => { assert.equal(incidentStatusClass('Escalating'), 'incident-escalating'); });
});

// ── buildRenderData ───────────────────────────────────────────────────────────
describe('buildRenderData', () => {
  it('returns countries array with entries', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.countries));
    assert.ok(d.countries.length > 0);
  });
  it('returns incidents array with entries', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.incidents));
    assert.ok(d.incidents.length > 0);
  });
  it('globalFreedomIndex is in range 0-100', () => {
    const d = buildRenderData();
    assert.ok(d.globalFreedomIndex >= 0 && d.globalFreedomIndex <= 100);
  });
  it('category counts sum to total countries', () => {
    const d = buildRenderData();
    const sum = d.freeCount + d.goodCount + d.satisfactoryCount + d.problematicCount + d.difficultCount + d.verySeriousCount;
    assert.equal(sum, d.countries.length);
  });
  it('totalJailed equals sum of journalistsJailed across countries', () => {
    const d = buildRenderData();
    const sum = d.countries.reduce((s, c) => s + c.journalistsJailed, 0);
    assert.equal(d.totalJailed, sum);
  });
  it('decliningCount equals countries with declining trend', () => {
    const d = buildRenderData();
    const count = d.countries.filter(c => c.trend === 'declining').length;
    assert.equal(d.decliningCount, count);
  });
  it('highRisk only contains Difficult or Very Serious', () => {
    const d = buildRenderData();
    assert.ok(d.highRisk.every(c => c.category === 'Difficult' || c.category === 'Very Serious'));
  });
  it('China has highest journalistsJailed count', () => {
    const d = buildRenderData();
    const china = d.countries.find(c => c.country === 'China');
    assert.ok(china !== undefined, 'China must be present');
    const maxJailed = Math.max(...d.countries.map(c => c.journalistsJailed));
    assert.equal(china.journalistsJailed, maxJailed);
  });
  it('North Korea has lowest RSF score', () => {
    const d = buildRenderData();
    const nk = d.countries.find(c => c.country === 'North Korea');
    assert.ok(nk !== undefined, 'North Korea must be present');
    const minScore = Math.min(...d.countries.map(c => c.rsfScore));
    assert.equal(nk.rsfScore, minScore);
  });
  it('Norway has highest RSF score', () => {
    const d = buildRenderData();
    const norway = d.countries.find(c => c.country === 'Norway');
    assert.ok(norway !== undefined, 'Norway must be present');
    const maxScore = Math.max(...d.countries.map(c => c.rsfScore));
    assert.equal(norway.rsfScore, maxScore);
  });
  it('freeCount matches Free-category countries', () => {
    const d = buildRenderData();
    assert.equal(d.freeCount, d.countries.filter(c => c.category === 'Free').length);
  });
  it('verySeriousCount matches Very Serious-category countries', () => {
    const d = buildRenderData();
    assert.equal(d.verySeriousCount, d.countries.filter(c => c.category === 'Very Serious').length);
  });
  it('goodCount matches Good-category countries', () => {
    const d = buildRenderData();
    assert.equal(d.goodCount, d.countries.filter(c => c.category === 'Good').length);
  });
  it('highRisk count equals difficultCount + verySeriousCount', () => {
    const d = buildRenderData();
    assert.equal(d.highRisk.length, d.difficultCount + d.verySeriousCount);
  });
});
