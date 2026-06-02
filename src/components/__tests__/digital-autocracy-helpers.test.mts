import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeGlobalFreedomIndex,
  getNotFreeCountries,
  getPartlyFreeCountries,
  getFreeCountries,
  countTotalBlockedPlatforms,
  computePopulationUnderRepression,
  getMostRestrictive,
  getWorseningCountries,
  categoryCssClass,
  incidentSeverityClass,
  trendIcon,
  buildRenderData,
  type CountryCensorship,
  type FreedomCategory,
  type CensorshipTrend,
  type IncidentSeverity,
} from '../digital-autocracy-helpers.ts';

const MOCK_COUNTRIES: CountryCensorship[] = [
  { country: 'Alpha', code: 'AL', freedomScore: 10, category: 'Not Free', blockedPlatforms: ['FB', 'YT', 'TW'], vpnUsage: 'High', socialCredit: true, shutdownsLastYear: 3, trend: 'worsening', population: 100 },
  { country: 'Beta', code: 'BE', freedomScore: 45, category: 'Partly Free', blockedPlatforms: ['TW'], vpnUsage: 'Medium', socialCredit: false, shutdownsLastYear: 1, trend: 'stable', population: 50 },
  { country: 'Gamma', code: 'GA', freedomScore: 80, category: 'Free', blockedPlatforms: [], vpnUsage: 'Low', socialCredit: false, shutdownsLastYear: 0, trend: 'improving', population: 80 },
  { country: 'Delta', code: 'DE', freedomScore: 20, category: 'Not Free', blockedPlatforms: ['FB', 'IG'], vpnUsage: 'Very High', socialCredit: false, shutdownsLastYear: 5, trend: 'worsening', population: 200 },
  { country: 'Epsilon', code: 'EP', freedomScore: 55, category: 'Partly Free', blockedPlatforms: [], vpnUsage: 'Low', socialCredit: false, shutdownsLastYear: 0, trend: 'improving', population: 30 },
];

describe('computeGlobalFreedomIndex', () => {
  it('returns average of freedom scores', () => {
    const avg = Math.round((10 + 45 + 80 + 20 + 55) / 5);
    assert.equal(computeGlobalFreedomIndex(MOCK_COUNTRIES), avg);
  });
  it('returns 0 for empty array', () => {
    assert.equal(computeGlobalFreedomIndex([]), 0);
  });
  it('returns score itself for single country', () => {
    assert.equal(computeGlobalFreedomIndex([MOCK_COUNTRIES[0]]), 10);
  });
  it('returns integer', () => {
    const idx = computeGlobalFreedomIndex(MOCK_COUNTRIES);
    assert.equal(idx, Math.round(idx));
  });
  it('returns 100 for all-free countries', () => {
    const all = MOCK_COUNTRIES.map(c => ({ ...c, freedomScore: 100 }));
    assert.equal(computeGlobalFreedomIndex(all), 100);
  });
});

describe('getNotFreeCountries', () => {
  it('returns only Not Free countries', () => {
    const nf = getNotFreeCountries(MOCK_COUNTRIES);
    assert.equal(nf.length, 2);
    assert.ok(nf.every(c => c.category === 'Not Free'));
  });
  it('returns empty when none Not Free', () => {
    const all = MOCK_COUNTRIES.map(c => ({ ...c, category: 'Free' as FreedomCategory }));
    assert.equal(getNotFreeCountries(all).length, 0);
  });
  it('returns all when all Not Free', () => {
    const all = MOCK_COUNTRIES.map(c => ({ ...c, category: 'Not Free' as FreedomCategory }));
    assert.equal(getNotFreeCountries(all).length, MOCK_COUNTRIES.length);
  });
});

describe('getPartlyFreeCountries', () => {
  it('returns only Partly Free countries', () => {
    const pf = getPartlyFreeCountries(MOCK_COUNTRIES);
    assert.equal(pf.length, 2);
    assert.ok(pf.every(c => c.category === 'Partly Free'));
  });
  it('returns empty when none', () => {
    const all = MOCK_COUNTRIES.map(c => ({ ...c, category: 'Free' as FreedomCategory }));
    assert.equal(getPartlyFreeCountries(all).length, 0);
  });
});

describe('getFreeCountries', () => {
  it('returns only Free countries', () => {
    const free = getFreeCountries(MOCK_COUNTRIES);
    assert.equal(free.length, 1);
    assert.ok(free.every(c => c.category === 'Free'));
  });
  it('returns empty when none Free', () => {
    const all = MOCK_COUNTRIES.map(c => ({ ...c, category: 'Not Free' as FreedomCategory }));
    assert.equal(getFreeCountries(all).length, 0);
  });
});

describe('countTotalBlockedPlatforms', () => {
  it('sums blocked platforms across all countries', () => {
    assert.equal(countTotalBlockedPlatforms(MOCK_COUNTRIES), 6); // 3+1+0+2+0
  });
  it('returns 0 for empty array', () => {
    assert.equal(countTotalBlockedPlatforms([]), 0);
  });
  it('returns 0 when no platforms blocked', () => {
    const all = MOCK_COUNTRIES.map(c => ({ ...c, blockedPlatforms: [] }));
    assert.equal(countTotalBlockedPlatforms(all), 0);
  });
});

describe('computePopulationUnderRepression', () => {
  it('sums population of Not Free countries only', () => {
    assert.equal(computePopulationUnderRepression(MOCK_COUNTRIES), 300); // 100+200
  });
  it('returns 0 when none Not Free', () => {
    const all = MOCK_COUNTRIES.map(c => ({ ...c, category: 'Free' as FreedomCategory }));
    assert.equal(computePopulationUnderRepression(all), 0);
  });
  it('returns 0 for empty array', () => {
    assert.equal(computePopulationUnderRepression([]), 0);
  });
});

describe('getMostRestrictive', () => {
  it('returns countries sorted by freedomScore ascending', () => {
    const top = getMostRestrictive(MOCK_COUNTRIES, 3);
    assert.equal(top.length, 3);
    for (let i = 1; i < top.length; i++) {
      assert.ok(top[i - 1].freedomScore <= top[i].freedomScore);
    }
  });
  it('defaults to 5 entries', () => {
    assert.equal(getMostRestrictive(MOCK_COUNTRIES).length, 5);
  });
  it('does not mutate original array', () => {
    const orig = MOCK_COUNTRIES.map(c => c.code);
    getMostRestrictive(MOCK_COUNTRIES, 2);
    assert.deepEqual(MOCK_COUNTRIES.map(c => c.code), orig);
  });
  it('returns all if N > array length', () => {
    assert.equal(getMostRestrictive(MOCK_COUNTRIES, 100).length, MOCK_COUNTRIES.length);
  });
  it('returns empty for empty input', () => {
    assert.deepEqual(getMostRestrictive([]), []);
  });
});

describe('getWorseningCountries', () => {
  it('returns only worsening-trend countries', () => {
    const worse = getWorseningCountries(MOCK_COUNTRIES);
    assert.equal(worse.length, 2); // Alpha and Delta
    assert.ok(worse.every(c => c.trend === 'worsening'));
  });
  it('returns empty when none worsening', () => {
    const all = MOCK_COUNTRIES.map(c => ({ ...c, trend: 'stable' as CensorshipTrend }));
    assert.equal(getWorseningCountries(all).length, 0);
  });
});

describe('categoryCssClass', () => {
  it('returns cat-not-free for Not Free', () => {
    assert.equal(categoryCssClass('Not Free'), 'cat-not-free');
  });
  it('returns cat-partly for Partly Free', () => {
    assert.equal(categoryCssClass('Partly Free'), 'cat-partly');
  });
  it('returns cat-free for Free', () => {
    assert.equal(categoryCssClass('Free'), 'cat-free');
  });
});

describe('incidentSeverityClass', () => {
  it('returns sev-critical for Critical', () => {
    assert.equal(incidentSeverityClass('Critical'), 'sev-critical');
  });
  it('returns sev-high for High', () => {
    assert.equal(incidentSeverityClass('High'), 'sev-high');
  });
  it('returns sev-medium for Medium', () => {
    assert.equal(incidentSeverityClass('Medium'), 'sev-medium');
  });
  it('returns sev-low for Low', () => {
    assert.equal(incidentSeverityClass('Low'), 'sev-low');
  });
});

describe('trendIcon', () => {
  it('returns up arrow for improving', () => {
    assert.equal(trendIcon('improving'), '↑');
  });
  it('returns right arrow for stable', () => {
    assert.equal(trendIcon('stable'), '→');
  });
  it('returns down arrow for worsening', () => {
    assert.equal(trendIcon('worsening'), '↓');
  });
});

describe('buildRenderData', () => {
  it('returns all required fields', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.countries));
    assert.ok(Array.isArray(d.incidents));
    assert.equal(typeof d.globalFreedomIndex, 'number');
    assert.equal(typeof d.notFreeCount, 'number');
    assert.equal(typeof d.partlyFreeCount, 'number');
    assert.equal(typeof d.freeCount, 'number');
    assert.equal(typeof d.totalBlockedPlatforms, 'number');
    assert.equal(typeof d.populationUnderRepression, 'number');
  });
  it('countries array is non-empty', () => {
    assert.ok(buildRenderData().countries.length > 0);
  });
  it('incidents array is non-empty', () => {
    assert.ok(buildRenderData().incidents.length > 0);
  });
  it('notFreeCount matches actual', () => {
    const d = buildRenderData();
    assert.equal(d.notFreeCount, d.countries.filter(c => c.category === 'Not Free').length);
  });
  it('partlyFreeCount matches actual', () => {
    const d = buildRenderData();
    assert.equal(d.partlyFreeCount, d.countries.filter(c => c.category === 'Partly Free').length);
  });
  it('freeCount matches actual', () => {
    const d = buildRenderData();
    assert.equal(d.freeCount, d.countries.filter(c => c.category === 'Free').length);
  });
  it('globalFreedomIndex is between 0 and 100', () => {
    const idx = buildRenderData().globalFreedomIndex;
    assert.ok(idx >= 0 && idx <= 100);
  });
  it('all freedomScores are 0-100', () => {
    for (const c of buildRenderData().countries) {
      assert.ok(c.freedomScore >= 0 && c.freedomScore <= 100);
    }
  });
  it('all categories are valid', () => {
    const valid = new Set(['Free', 'Partly Free', 'Not Free']);
    for (const c of buildRenderData().countries) {
      assert.ok(valid.has(c.category));
    }
  });
  it('all trends are valid', () => {
    const valid = new Set(['improving', 'stable', 'worsening']);
    for (const c of buildRenderData().countries) {
      assert.ok(valid.has(c.trend));
    }
  });
  it('populationUnderRepression matches not-free sum', () => {
    const d = buildRenderData();
    const sum = d.countries.filter(c => c.category === 'Not Free').reduce((s, c) => s + c.population, 0);
    assert.equal(d.populationUnderRepression, sum);
  });
  it('totalBlockedPlatforms matches sum', () => {
    const d = buildRenderData();
    const sum = d.countries.reduce((s, c) => s + c.blockedPlatforms.length, 0);
    assert.equal(d.totalBlockedPlatforms, sum);
  });
});
