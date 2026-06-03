import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGlobalDemocracyIndex,
  getByRegime,
  getErodingCountries,
  getImprovingCountries,
  computePopulationUnderAutocracy,
  rankByErosion,
  rankByScore,
  regimeClass,
  trendClass,
  trendArrow,
  buildRenderData,
  type CountryDemocracy,
  type DemocracyRegime,
  type BackslidingTrend,
} from '../democratic-backsliding-helpers.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function mkCountry(overrides: Partial<CountryDemocracy> = {}): CountryDemocracy {
  return {
    id: 'T01',
    country: 'Testland',
    region: 'Test Region',
    regime: 'Electoral Democracy',
    vdemScore: 0.5,
    electoralScore: 0.5,
    civilLibertiesScore: 0.5,
    ruleOfLawScore: 0.5,
    trend: 'stable',
    trendDeltaYr: 0,
    keyErosionEvent: 'none',
    population: 10,
    ...overrides,
  };
}

const LIBERAL = mkCountry({ id: 'L1', regime: 'Liberal Democracy', vdemScore: 0.85, trend: 'stable', trendDeltaYr: -0.01, population: 50 });
const ELECTORAL = mkCountry({ id: 'E1', regime: 'Electoral Democracy', vdemScore: 0.50, trend: 'eroding', trendDeltaYr: -0.05, population: 100 });
const AUTOC = mkCountry({ id: 'A1', regime: 'Electoral Autocracy', vdemScore: 0.25, trend: 'eroding', trendDeltaYr: -0.08, population: 80 });
const CLOSED = mkCountry({ id: 'C1', regime: 'Closed Autocracy', vdemScore: 0.08, trend: 'collapsing', trendDeltaYr: -0.15, population: 30 });
const IMPROVING = mkCountry({ id: 'I1', regime: 'Electoral Democracy', vdemScore: 0.55, trend: 'improving', trendDeltaYr: 0.06, population: 40 });

const SAMPLE = [LIBERAL, ELECTORAL, AUTOC, CLOSED, IMPROVING];

// ─── computeGlobalDemocracyIndex ─────────────────────────────────────────────

describe('computeGlobalDemocracyIndex', () => {
  test('returns 50 for empty array', () => {
    assert.equal(computeGlobalDemocracyIndex([]), 50);
  });

  test('single country: returns rounded score*100', () => {
    const c = mkCountry({ vdemScore: 0.72, population: 100 });
    assert.equal(computeGlobalDemocracyIndex([c]), 72);
  });

  test('population-weighted: large pop dominates', () => {
    const big = mkCountry({ vdemScore: 0.10, population: 1000 });
    const small = mkCountry({ id: 'S', vdemScore: 0.90, population: 10 });
    const idx = computeGlobalDemocracyIndex([big, small]);
    assert.ok(idx < 20, `expected <20 but got ${idx}`);
  });

  test('equal populations: returns arithmetic mean * 100 rounded', () => {
    const a = mkCountry({ vdemScore: 0.4, population: 50 });
    const b = mkCountry({ id: 'B', vdemScore: 0.6, population: 50 });
    assert.equal(computeGlobalDemocracyIndex([a, b]), 50);
  });

  test('perfect democracy: returns 100', () => {
    const c = mkCountry({ vdemScore: 1.0, population: 1 });
    assert.equal(computeGlobalDemocracyIndex([c]), 100);
  });

  test('total autocracy: returns 0', () => {
    const c = mkCountry({ vdemScore: 0.0, population: 1 });
    assert.equal(computeGlobalDemocracyIndex([c]), 0);
  });

  test('SAMPLE set produces a number in [0,100]', () => {
    const idx = computeGlobalDemocracyIndex(SAMPLE);
    assert.ok(idx >= 0 && idx <= 100);
  });

  test('result is an integer (Math.round applied)', () => {
    const idx = computeGlobalDemocracyIndex(SAMPLE);
    assert.equal(idx, Math.round(idx));
  });
});

// ─── getByRegime ──────────────────────────────────────────────────────────────

describe('getByRegime', () => {
  test('returns only Liberal Democracy countries', () => {
    const result = getByRegime(SAMPLE, 'Liberal Democracy');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'L1');
  });

  test('returns only Electoral Democracy countries', () => {
    const result = getByRegime(SAMPLE, 'Electoral Democracy');
    assert.equal(result.length, 2); // ELECTORAL + IMPROVING
    assert.ok(result.every(c => c.regime === 'Electoral Democracy'));
  });

  test('returns only Electoral Autocracy countries', () => {
    const result = getByRegime(SAMPLE, 'Electoral Autocracy');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'A1');
  });

  test('returns only Closed Autocracy countries', () => {
    const result = getByRegime(SAMPLE, 'Closed Autocracy');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'C1');
  });

  test('returns empty array when no match', () => {
    const result = getByRegime([LIBERAL], 'Closed Autocracy');
    assert.equal(result.length, 0);
  });

  test('does not mutate original array', () => {
    const orig = [...SAMPLE];
    getByRegime(SAMPLE, 'Liberal Democracy');
    assert.equal(SAMPLE.length, orig.length);
  });
});

// ─── getErodingCountries ─────────────────────────────────────────────────────

describe('getErodingCountries', () => {
  test('includes eroding trend', () => {
    const eroding = mkCountry({ trend: 'eroding' });
    assert.equal(getErodingCountries([eroding]).length, 1);
  });

  test('includes collapsing trend', () => {
    const collapsing = mkCountry({ trend: 'collapsing' });
    assert.equal(getErodingCountries([collapsing]).length, 1);
  });

  test('excludes stable trend', () => {
    const stable = mkCountry({ trend: 'stable' });
    assert.equal(getErodingCountries([stable]).length, 0);
  });

  test('excludes improving trend', () => {
    const improving = mkCountry({ trend: 'improving' });
    assert.equal(getErodingCountries([improving]).length, 0);
  });

  test('SAMPLE: finds ELECTORAL, AUTOC, and CLOSED (eroding+collapsing)', () => {
    const result = getErodingCountries(SAMPLE);
    assert.equal(result.length, 3);
    assert.ok(result.some(c => c.id === 'E1'));
    assert.ok(result.some(c => c.id === 'A1'));
    assert.ok(result.some(c => c.id === 'C1'));
  });

  test('empty input returns empty array', () => {
    assert.equal(getErodingCountries([]).length, 0);
  });
});

// ─── getImprovingCountries ───────────────────────────────────────────────────

describe('getImprovingCountries', () => {
  test('returns only improving countries', () => {
    const result = getImprovingCountries(SAMPLE);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'I1');
  });

  test('excludes eroding', () => {
    assert.equal(getImprovingCountries([ELECTORAL]).length, 0);
  });

  test('excludes collapsing', () => {
    assert.equal(getImprovingCountries([CLOSED]).length, 0);
  });

  test('excludes stable', () => {
    assert.equal(getImprovingCountries([LIBERAL]).length, 0);
  });

  test('empty input returns empty array', () => {
    assert.equal(getImprovingCountries([]).length, 0);
  });
});

// ─── computePopulationUnderAutocracy ────────────────────────────────────────

describe('computePopulationUnderAutocracy', () => {
  test('sums Electoral Autocracy + Closed Autocracy populations', () => {
    const result = computePopulationUnderAutocracy(SAMPLE);
    assert.equal(result, AUTOC.population + CLOSED.population); // 80 + 30 = 110
  });

  test('excludes Liberal Democracy population', () => {
    const result = computePopulationUnderAutocracy([LIBERAL]);
    assert.equal(result, 0);
  });

  test('excludes Electoral Democracy population', () => {
    const result = computePopulationUnderAutocracy([ELECTORAL]);
    assert.equal(result, 0);
  });

  test('counts Electoral Autocracy alone', () => {
    assert.equal(computePopulationUnderAutocracy([AUTOC]), AUTOC.population);
  });

  test('counts Closed Autocracy alone', () => {
    assert.equal(computePopulationUnderAutocracy([CLOSED]), CLOSED.population);
  });

  test('returns 0 for empty array', () => {
    assert.equal(computePopulationUnderAutocracy([]), 0);
  });
});

// ─── rankByErosion ───────────────────────────────────────────────────────────

describe('rankByErosion', () => {
  test('sorts ascending by trendDeltaYr (worst first)', () => {
    const ranked = rankByErosion(SAMPLE);
    for (let i = 0; i < ranked.length - 1; i++) {
      assert.ok(ranked[i].trendDeltaYr <= ranked[i + 1].trendDeltaYr,
        `index ${i}: ${ranked[i].trendDeltaYr} > ${ranked[i + 1].trendDeltaYr}`);
    }
  });

  test('first element has most negative delta', () => {
    const ranked = rankByErosion(SAMPLE);
    const minDelta = Math.min(...SAMPLE.map(c => c.trendDeltaYr));
    assert.equal(ranked[0].trendDeltaYr, minDelta);
  });

  test('does not mutate original array order', () => {
    const before = SAMPLE.map(c => c.id);
    rankByErosion(SAMPLE);
    const after = SAMPLE.map(c => c.id);
    assert.deepEqual(before, after);
  });

  test('single element array returns copy', () => {
    const result = rankByErosion([LIBERAL]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'L1');
  });

  test('empty array returns empty', () => {
    assert.equal(rankByErosion([]).length, 0);
  });
});

// ─── rankByScore ──────────────────────────────────────────────────────────────

describe('rankByScore', () => {
  test('sorts ascending by vdemScore (lowest first)', () => {
    const ranked = rankByScore(SAMPLE);
    for (let i = 0; i < ranked.length - 1; i++) {
      assert.ok(ranked[i].vdemScore <= ranked[i + 1].vdemScore,
        `index ${i}: ${ranked[i].vdemScore} > ${ranked[i + 1].vdemScore}`);
    }
  });

  test('first element has lowest vdemScore', () => {
    const ranked = rankByScore(SAMPLE);
    const minScore = Math.min(...SAMPLE.map(c => c.vdemScore));
    assert.equal(ranked[0].vdemScore, minScore);
  });

  test('last element has highest vdemScore', () => {
    const ranked = rankByScore(SAMPLE);
    const maxScore = Math.max(...SAMPLE.map(c => c.vdemScore));
    assert.equal(ranked[ranked.length - 1].vdemScore, maxScore);
  });

  test('does not mutate original array', () => {
    const before = SAMPLE.map(c => c.id);
    rankByScore(SAMPLE);
    const after = SAMPLE.map(c => c.id);
    assert.deepEqual(before, after);
  });

  test('empty array returns empty', () => {
    assert.equal(rankByScore([]).length, 0);
  });
});

// ─── regimeClass ──────────────────────────────────────────────────────────────

describe('regimeClass', () => {
  test('Liberal Democracy -> regime-liberal', () => {
    assert.equal(regimeClass('Liberal Democracy'), 'regime-liberal');
  });

  test('Electoral Democracy -> regime-electoral', () => {
    assert.equal(regimeClass('Electoral Democracy'), 'regime-electoral');
  });

  test('Electoral Autocracy -> regime-autoc', () => {
    assert.equal(regimeClass('Electoral Autocracy'), 'regime-autoc');
  });

  test('Closed Autocracy -> regime-closed', () => {
    assert.equal(regimeClass('Closed Autocracy'), 'regime-closed');
  });

  test('all regimes return non-empty strings', () => {
    const regimes: DemocracyRegime[] = ['Liberal Democracy', 'Electoral Democracy', 'Electoral Autocracy', 'Closed Autocracy'];
    for (const r of regimes) {
      assert.ok(regimeClass(r).length > 0);
    }
  });
});

// ─── trendClass ───────────────────────────────────────────────────────────────

describe('trendClass', () => {
  test('improving -> trend-up', () => {
    assert.equal(trendClass('improving'), 'trend-up');
  });

  test('stable -> trend-flat', () => {
    assert.equal(trendClass('stable'), 'trend-flat');
  });

  test('eroding -> trend-down', () => {
    assert.equal(trendClass('eroding'), 'trend-down');
  });

  test('collapsing -> trend-critical', () => {
    assert.equal(trendClass('collapsing'), 'trend-critical');
  });

  test('all trends return non-empty strings', () => {
    const trends: BackslidingTrend[] = ['improving', 'stable', 'eroding', 'collapsing'];
    for (const t of trends) {
      assert.ok(trendClass(t).length > 0);
    }
  });
});

// ─── trendArrow ───────────────────────────────────────────────────────────────

describe('trendArrow', () => {
  test('improving returns non-empty string', () => {
    assert.ok(trendArrow('improving').length > 0);
  });

  test('stable returns non-empty string', () => {
    assert.ok(trendArrow('stable').length > 0);
  });

  test('eroding returns non-empty string', () => {
    assert.ok(trendArrow('eroding').length > 0);
  });

  test('collapsing returns non-empty string', () => {
    assert.ok(trendArrow('collapsing').length > 0);
  });

  test('all four trends return distinct arrows', () => {
    const arrows = new Set(['improving', 'stable', 'eroding', 'collapsing'].map(t => trendArrow(t as BackslidingTrend)));
    assert.equal(arrows.size, 4, 'expected 4 distinct arrow values');
  });
});

// ─── buildRenderData ──────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  const data = buildRenderData();

  test('returns countries array with length > 0', () => {
    assert.ok(data.countries.length > 0);
  });

  test('returns exactly 15 countries', () => {
    assert.equal(data.countries.length, 15);
  });

  test('returns events array with length > 0', () => {
    assert.ok(data.events.length > 0);
  });

  test('returns exactly 8 events', () => {
    assert.equal(data.events.length, 8);
  });

  test('globalDemocracyIndex is a number in [0, 100]', () => {
    assert.ok(typeof data.globalDemocracyIndex === 'number');
    assert.ok(data.globalDemocracyIndex >= 0 && data.globalDemocracyIndex <= 100);
  });

  test('liberalCount is correct', () => {
    const expected = data.countries.filter(c => c.regime === 'Liberal Democracy').length;
    assert.equal(data.liberalCount, expected);
  });

  test('electoralDemCount is correct', () => {
    const expected = data.countries.filter(c => c.regime === 'Electoral Democracy').length;
    assert.equal(data.electoralDemCount, expected);
  });

  test('electoralAutocCount is correct', () => {
    const expected = data.countries.filter(c => c.regime === 'Electoral Autocracy').length;
    assert.equal(data.electoralAutocCount, expected);
  });

  test('closedAutocCount is correct', () => {
    const expected = data.countries.filter(c => c.regime === 'Closed Autocracy').length;
    assert.equal(data.closedAutocCount, expected);
  });

  test('regime counts sum to total country count', () => {
    const total = data.liberalCount + data.electoralDemCount + data.electoralAutocCount + data.closedAutocCount;
    assert.equal(total, data.countries.length);
  });

  test('erodingCount includes both eroding and collapsing', () => {
    const expected = data.countries.filter(c => c.trend === 'eroding' || c.trend === 'collapsing').length;
    assert.equal(data.erodingCount, expected);
  });

  test('populationUnderAutocracy is correct', () => {
    const expected = data.countries
      .filter(c => c.regime === 'Electoral Autocracy' || c.regime === 'Closed Autocracy')
      .reduce((s, c) => s + c.population, 0);
    assert.equal(data.populationUnderAutocracy, expected);
  });

  test('all countries have valid vdemScore in [0,1]', () => {
    for (const c of data.countries) {
      assert.ok(c.vdemScore >= 0 && c.vdemScore <= 1, `${c.country} vdemScore ${c.vdemScore} out of range`);
    }
  });

  test('all countries have non-empty id', () => {
    for (const c of data.countries) {
      assert.ok(c.id.length > 0);
    }
  });

  test('all countries have non-empty country name', () => {
    for (const c of data.countries) {
      assert.ok(c.country.length > 0);
    }
  });

  test('all events have severity in [1,10]', () => {
    for (const ev of data.events) {
      assert.ok(ev.severity >= 1 && ev.severity <= 10, `Event ${ev.id} severity ${ev.severity} out of range`);
    }
  });

  test('all events have non-empty id', () => {
    for (const ev of data.events) {
      assert.ok(ev.id.length > 0);
    }
  });

  test('all events have non-empty description', () => {
    for (const ev of data.events) {
      assert.ok(ev.description.length > 0);
    }
  });

  test('buildRenderData is deterministic (called twice yields same counts)', () => {
    const d2 = buildRenderData();
    assert.equal(data.globalDemocracyIndex, d2.globalDemocracyIndex);
    assert.equal(data.liberalCount, d2.liberalCount);
    assert.equal(data.erodingCount, d2.erodingCount);
    assert.equal(data.populationUnderAutocracy, d2.populationUnderAutocracy);
  });

  test('South Korea is present (Dec 2024 martial law case)', () => {
    assert.ok(data.countries.some(c => c.country === 'South Korea'));
  });

  test('Georgia is present with collapsing trend', () => {
    const georgia = data.countries.find(c => c.country === 'Georgia');
    assert.ok(georgia);
    assert.equal(georgia!.trend, 'collapsing');
  });

  test('Venezuela is Closed Autocracy', () => {
    const ven = data.countries.find(c => c.country === 'Venezuela');
    assert.ok(ven);
    assert.equal(ven!.regime, 'Closed Autocracy');
  });

  test('events include an Election Manipulation event', () => {
    assert.ok(data.events.some(e => e.category === 'Election Manipulation'));
  });

  test('events include an Emergency Powers event', () => {
    assert.ok(data.events.some(e => e.category === 'Emergency Powers'));
  });

  test('at least one ongoing event exists', () => {
    assert.ok(data.events.some(e => e.ongoing === true));
  });

  test('at least one resolved (non-ongoing) event exists', () => {
    assert.ok(data.events.some(e => e.ongoing === false));
  });
});
