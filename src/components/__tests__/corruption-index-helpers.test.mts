import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  getCategory,
  getByCategory,
  getMostCorrupt,
  getLeastCorrupt,
  getDecliningCountries,
  getImprovingCountries,
  categoryClass,
  trendClass,
  weightedGlobalAvg,
  unweightedGlobalAvg,
  buildRenderData,
  COUNTRIES,
  KEY_EVENTS,
  type CountryRecord,
  type CorruptionCategory,
  type CorruptionTrend,
} from '../corruption-index-helpers.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function mkCountry(overrides: Partial<CountryRecord> = {}): CountryRecord {
  return {
    country:     'Testland',
    code:        'TST',
    score:       50,
    trend:       'stable',
    keyRisk:     'None',
    populationM: 10,
    ...overrides,
  };
}

const MINI: CountryRecord[] = [
  mkCountry({ country: 'A', score: 80, trend: 'stable',    populationM: 20 }),
  mkCountry({ country: 'B', score: 50, trend: 'declining', populationM: 40 }),
  mkCountry({ country: 'C', score: 30, trend: 'improving', populationM: 10 }),
  mkCountry({ country: 'D', score: 10, trend: 'declining', populationM: 30 }),
];

// ── getCategory ───────────────────────────────────────────────────────────────

describe('getCategory', () => {
  it('scores 75+ are Clean', () => {
    assert.equal(getCategory(75),  'Clean');
    assert.equal(getCategory(90),  'Clean');
    assert.equal(getCategory(100), 'Clean');
  });

  it('scores 50–74 are Satisfactory', () => {
    assert.equal(getCategory(50), 'Satisfactory');
    assert.equal(getCategory(60), 'Satisfactory');
    assert.equal(getCategory(74), 'Satisfactory');
  });

  it('scores 25–49 are Problematic', () => {
    assert.equal(getCategory(25), 'Problematic');
    assert.equal(getCategory(36), 'Problematic');
    assert.equal(getCategory(49), 'Problematic');
  });

  it('scores below 25 are Very Corrupt', () => {
    assert.equal(getCategory(24), 'Very Corrupt');
    assert.equal(getCategory(11), 'Very Corrupt');
    assert.equal(getCategory(0),  'Very Corrupt');
  });

  it('boundary: exactly 75 is Clean', () => {
    assert.equal(getCategory(75), 'Clean');
  });

  it('boundary: exactly 50 is Satisfactory', () => {
    assert.equal(getCategory(50), 'Satisfactory');
  });

  it('boundary: exactly 25 is Problematic', () => {
    assert.equal(getCategory(25), 'Problematic');
  });
});

// ── getByCategory ─────────────────────────────────────────────────────────────

describe('getByCategory', () => {
  it('returns only Clean countries from MINI', () => {
    const result = getByCategory(MINI, 'Clean');
    assert.equal(result.length, 1);
    assert.equal(result[0].country, 'A');
  });

  it('returns only Satisfactory countries', () => {
    const result = getByCategory(MINI, 'Satisfactory');
    assert.equal(result.length, 1);
    assert.equal(result[0].country, 'B');
  });

  it('returns only Problematic countries', () => {
    const result = getByCategory(MINI, 'Problematic');
    assert.equal(result.length, 1);
    assert.equal(result[0].country, 'C');
  });

  it('returns only Very Corrupt countries', () => {
    const result = getByCategory(MINI, 'Very Corrupt');
    assert.equal(result.length, 1);
    assert.equal(result[0].country, 'D');
  });

  it('returns empty array when no match', () => {
    const empty: CountryRecord[] = [mkCountry({ score: 80 })];
    assert.equal(getByCategory(empty, 'Very Corrupt').length, 0);
  });

  it('does not mutate input array', () => {
    const copy = [...MINI];
    getByCategory(MINI, 'Clean');
    assert.deepEqual(MINI, copy);
  });
});

// ── getMostCorrupt ────────────────────────────────────────────────────────────

describe('getMostCorrupt', () => {
  it('returns N countries with the lowest scores first', () => {
    const result = getMostCorrupt(MINI, 2);
    assert.equal(result.length, 2);
    assert.equal(result[0].score, 10);
    assert.equal(result[1].score, 30);
  });

  it('default n=5 is capped at array length', () => {
    const result = getMostCorrupt(MINI);
    assert.equal(result.length, 4);
  });

  it('does not mutate the input array', () => {
    const snap = MINI.map(c => c.country);
    getMostCorrupt(MINI, 3);
    assert.deepEqual(MINI.map(c => c.country), snap);
  });

  it('handles n=1', () => {
    const result = getMostCorrupt(MINI, 1);
    assert.equal(result.length, 1);
    assert.equal(result[0].score, 10);
  });

  it('handles empty input', () => {
    assert.deepEqual(getMostCorrupt([], 3), []);
  });
});

// ── getLeastCorrupt ───────────────────────────────────────────────────────────

describe('getLeastCorrupt', () => {
  it('returns N countries with the highest scores first', () => {
    const result = getLeastCorrupt(MINI, 2);
    assert.equal(result.length, 2);
    assert.equal(result[0].score, 80);
    assert.equal(result[1].score, 50);
  });

  it('does not mutate input array', () => {
    const snap = MINI.map(c => c.score);
    getLeastCorrupt(MINI, 3);
    assert.deepEqual(MINI.map(c => c.score), snap);
  });

  it('handles empty input', () => {
    assert.deepEqual(getLeastCorrupt([], 3), []);
  });

  it('n=1 returns single cleanest country', () => {
    const result = getLeastCorrupt(MINI, 1);
    assert.equal(result[0].score, 80);
  });
});

// ── getDecliningCountries ─────────────────────────────────────────────────────

describe('getDecliningCountries', () => {
  it('returns only declining countries', () => {
    const result = getDecliningCountries(MINI);
    assert.equal(result.length, 2);
    assert.ok(result.every(c => c.trend === 'declining'));
  });

  it('handles all-stable list', () => {
    const stable = [mkCountry({ trend: 'stable' }), mkCountry({ trend: 'stable' })];
    assert.equal(getDecliningCountries(stable).length, 0);
  });

  it('handles empty input', () => {
    assert.deepEqual(getDecliningCountries([]), []);
  });
});

// ── getImprovingCountries ─────────────────────────────────────────────────────

describe('getImprovingCountries', () => {
  it('returns only improving countries', () => {
    const result = getImprovingCountries(MINI);
    assert.equal(result.length, 1);
    assert.equal(result[0].country, 'C');
  });

  it('handles empty input', () => {
    assert.deepEqual(getImprovingCountries([]), []);
  });

  it('handles no improving countries', () => {
    const flat = [mkCountry({ trend: 'stable' }), mkCountry({ trend: 'declining' })];
    assert.equal(getImprovingCountries(flat).length, 0);
  });
});

// ── categoryClass ─────────────────────────────────────────────────────────────

describe('categoryClass', () => {
  it('Clean maps to cat-clean', () => {
    assert.equal(categoryClass('Clean'), 'cat-clean');
  });

  it('Satisfactory maps to cat-satisfactory', () => {
    assert.equal(categoryClass('Satisfactory'), 'cat-satisfactory');
  });

  it('Problematic maps to cat-problematic', () => {
    assert.equal(categoryClass('Problematic'), 'cat-problematic');
  });

  it('Very Corrupt maps to cat-very-corrupt', () => {
    assert.equal(categoryClass('Very Corrupt'), 'cat-very-corrupt');
  });

  it('all four categories produce distinct CSS classes', () => {
    const cats: CorruptionCategory[] = ['Clean', 'Satisfactory', 'Problematic', 'Very Corrupt'];
    const classes = cats.map(categoryClass);
    assert.equal(new Set(classes).size, 4);
  });
});

// ── trendClass ────────────────────────────────────────────────────────────────

describe('trendClass', () => {
  it('improving maps to trend-improving', () => {
    assert.equal(trendClass('improving'), 'trend-improving');
  });

  it('stable maps to trend-stable', () => {
    assert.equal(trendClass('stable'), 'trend-stable');
  });

  it('declining maps to trend-declining', () => {
    assert.equal(trendClass('declining'), 'trend-declining');
  });

  it('all three trends produce distinct CSS classes', () => {
    const trends: CorruptionTrend[] = ['improving', 'stable', 'declining'];
    const classes = trends.map(trendClass);
    assert.equal(new Set(classes).size, 3);
  });
});

// ── weightedGlobalAvg ─────────────────────────────────────────────────────────

describe('weightedGlobalAvg', () => {
  it('returns 0 for empty array', () => {
    assert.equal(weightedGlobalAvg([]), 0);
  });

  it('returns score unchanged for single country', () => {
    const c = [mkCountry({ score: 60, populationM: 100 })];
    assert.equal(weightedGlobalAvg(c), 60);
  });

  it('weights by population correctly', () => {
    // 80*20 + 10*20 = 1600+200 = 1800 / 40 = 45
    const c = [
      mkCountry({ score: 80, populationM: 20 }),
      mkCountry({ score: 10, populationM: 20 }),
    ];
    assert.equal(weightedGlobalAvg(c), 45);
  });

  it('larger population pulls avg toward its score', () => {
    // big country with low score should drag avg down
    const c = [
      mkCountry({ score: 90, populationM: 10 }),
      mkCountry({ score: 20, populationM: 1000 }),
    ];
    assert.ok(weightedGlobalAvg(c) < unweightedGlobalAvg(c));
  });
});

// ── unweightedGlobalAvg ───────────────────────────────────────────────────────

describe('unweightedGlobalAvg', () => {
  it('returns 0 for empty array', () => {
    assert.equal(unweightedGlobalAvg([]), 0);
  });

  it('returns score for single-country list', () => {
    const c = [mkCountry({ score: 42 })];
    assert.equal(unweightedGlobalAvg(c), 42);
  });

  it('computes arithmetic mean', () => {
    const c = [mkCountry({ score: 30 }), mkCountry({ score: 70 })];
    assert.equal(unweightedGlobalAvg(c), 50);
  });

  it('rounds to one decimal place', () => {
    const c = [mkCountry({ score: 10 }), mkCountry({ score: 20 }), mkCountry({ score: 35 })];
    // (10+20+35)/3 = 65/3 = 21.666... → 21.7
    assert.equal(unweightedGlobalAvg(c), 21.7);
  });
});

// ── COUNTRIES data integrity ───────────────────────────────────────────────────

describe('COUNTRIES data integrity', () => {
  it('has exactly 20 entries', () => {
    assert.equal(COUNTRIES.length, 20);
  });

  it('all scores are in range 0–100', () => {
    for (const c of COUNTRIES) {
      assert.ok(c.score >= 0 && c.score <= 100, `${c.country} score ${c.score} out of range`);
    }
  });

  it('all trends are valid values', () => {
    const valid = new Set(['improving', 'stable', 'declining']);
    for (const c of COUNTRIES) {
      assert.ok(valid.has(c.trend), `${c.country} has invalid trend: ${c.trend}`);
    }
  });

  it('all country codes are 3-character strings', () => {
    for (const c of COUNTRIES) {
      assert.equal(c.code.length, 3, `${c.country} code '${c.code}' is not 3 chars`);
    }
  });

  it('all populationM values are positive', () => {
    for (const c of COUNTRIES) {
      assert.ok(c.populationM > 0, `${c.country} populationM is not positive`);
    }
  });

  it('no duplicate country names', () => {
    const names = COUNTRIES.map(c => c.country);
    assert.equal(new Set(names).size, COUNTRIES.length);
  });

  it('Denmark has highest score (90)', () => {
    const dnk = COUNTRIES.find(c => c.country === 'Denmark');
    assert.ok(dnk);
    assert.equal(dnk.score, 90);
  });

  it('Somalia has lowest score (11)', () => {
    const som = COUNTRIES.find(c => c.country === 'Somalia');
    assert.ok(som);
    assert.equal(som.score, 11);
  });

  it('Russia is declining', () => {
    const rus = COUNTRIES.find(c => c.country === 'Russia');
    assert.ok(rus);
    assert.equal(rus.trend, 'declining');
  });

  it('South Korea is improving', () => {
    const kor = COUNTRIES.find(c => c.country === 'South Korea');
    assert.ok(kor);
    assert.equal(kor.trend, 'improving');
  });
});

// ── KEY_EVENTS data integrity ─────────────────────────────────────────────────

describe('KEY_EVENTS data integrity', () => {
  it('has 4 key events', () => {
    assert.equal(KEY_EVENTS.length, 4);
  });

  it('all events have a year between 2020 and 2030', () => {
    for (const e of KEY_EVENTS) {
      assert.ok(e.year >= 2020 && e.year <= 2030, `Event year ${e.year} unexpected`);
    }
  });

  it('all events have non-empty titles', () => {
    for (const e of KEY_EVENTS) {
      assert.ok(e.title.length > 0);
    }
  });

  it('all events have non-empty descriptions', () => {
    for (const e of KEY_EVENTS) {
      assert.ok(e.description.length > 0);
    }
  });

  it('FTX event is present', () => {
    assert.ok(KEY_EVENTS.some(e => e.title.includes('FTX')));
  });

  it('Nigeria event is present', () => {
    assert.ok(KEY_EVENTS.some(e => e.title.includes('Nigeria')));
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  it('returns without throwing', () => {
    assert.doesNotThrow(() => buildRenderData());
  });

  it('countries array has 20 entries', () => {
    assert.equal(buildRenderData().countries.length, 20);
  });

  it('countries are sorted highest-score first', () => {
    const { countries } = buildRenderData();
    for (let i = 0; i < countries.length - 1; i++) {
      assert.ok(
        countries[i].score >= countries[i + 1].score,
        `Index ${i} (${countries[i].score}) > index ${i + 1} (${countries[i + 1].score})`,
      );
    }
  });

  it('category counts sum to 20', () => {
    const d = buildRenderData();
    assert.equal(
      d.cleanCount + d.satisfactoryCount + d.problematicCount + d.veryCorruptCount,
      20,
    );
  });

  it('cleanCount matches actual data (Denmark/Finland/Norway/Singapore/Netherlands/Germany = 6)', () => {
    assert.equal(buildRenderData().cleanCount, 6);
  });

  it('globalAvgWeighted is a number between 0 and 100', () => {
    const { globalAvgWeighted } = buildRenderData();
    assert.ok(globalAvgWeighted >= 0 && globalAvgWeighted <= 100);
  });

  it('globalAvgUnweighted is a number between 0 and 100', () => {
    const { globalAvgUnweighted } = buildRenderData();
    assert.ok(globalAvgUnweighted >= 0 && globalAvgUnweighted <= 100);
  });

  it('weighted avg is pulled below unweighted due to large corrupt populations', () => {
    const { globalAvgWeighted, globalAvgUnweighted } = buildRenderData();
    // India+China alone are huge and score 39/42 — drags weighted avg down
    assert.ok(globalAvgWeighted < globalAvgUnweighted);
  });

  it('mostCorrupt has 5 entries', () => {
    assert.equal(buildRenderData().mostCorrupt.length, 5);
  });

  it('mostCorrupt first entry is Somalia (score 11)', () => {
    assert.equal(buildRenderData().mostCorrupt[0].country, 'Somalia');
  });

  it('leastCorrupt has 5 entries', () => {
    assert.equal(buildRenderData().leastCorrupt.length, 5);
  });

  it('leastCorrupt first entry is Denmark (score 90)', () => {
    assert.equal(buildRenderData().leastCorrupt[0].country, 'Denmark');
  });

  it('topEvents is exactly KEY_EVENTS', () => {
    assert.deepEqual(buildRenderData().topEvents, KEY_EVENTS);
  });

  it('decliningCount + improvingCount <= 20', () => {
    const { decliningCount, improvingCount } = buildRenderData();
    assert.ok(decliningCount + improvingCount <= 20);
  });

  it('declining countries include Russia, Venezuela, Nigeria', () => {
    const { countries } = buildRenderData();
    const declining = getDecliningCountries(countries);
    const names = declining.map(c => c.country);
    assert.ok(names.includes('Russia'));
    assert.ok(names.includes('Venezuela'));
    assert.ok(names.includes('Nigeria'));
  });

  it('improving countries include South Korea', () => {
    const { countries } = buildRenderData();
    const improving = getImprovingCountries(countries);
    assert.ok(improving.some(c => c.country === 'South Korea'));
  });

  it('does not mutate COUNTRIES', () => {
    const before = COUNTRIES.map(c => ({ ...c }));
    buildRenderData();
    assert.deepEqual(COUNTRIES, before);
  });
});
