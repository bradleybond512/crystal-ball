import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUP_RISK_COUNTRIES,
  RECENT_COUPS,
  getByRiskLevel,
  getCriticalRisk,
  getByRegion,
  getRisingTrend,
  getRecentCoupsByType,
  computeGlobalCoupRiskIndex,
  riskLevelClass,
  trendClass,
  trendArrow,
  buildRenderData,
  type CoupRiskCountry,
  type RecentCoup,
} from '../coup-risk-helpers.js';

describe('coup-risk-helpers: dataset integrity', () => {
  it('has exactly 12 countries', () => {
    assert.equal(COUP_RISK_COUNTRIES.length, 12);
  });

  it('has exactly 8 recent coups', () => {
    assert.equal(RECENT_COUPS.length, 8);
  });

  it('all country ids are unique', () => {
    const ids = new Set(COUP_RISK_COUNTRIES.map((c) => c.id));
    assert.equal(ids.size, 12);
  });

  it('all recent coup ids are unique', () => {
    const ids = new Set(RECENT_COUPS.map((c) => c.id));
    assert.equal(ids.size, 8);
  });

  it('includes the expected core countries', () => {
    const ids = COUP_RISK_COUNTRIES.map((c) => c.id);
    for (const id of ['myanmar', 'sudan', 'burkina-faso', 'mali', 'niger', 'guinea', 'venezuela', 'ethiopia', 'pakistan', 'bangladesh', 'bolivia', 'gabon']) {
      assert.ok(ids.includes(id), `missing country ${id}`);
    }
  });

  it('includes the expected recent coups', () => {
    const ids = RECENT_COUPS.map((c) => c.id);
    for (const id of ['myanmar-2021', 'mali-2021', 'guinea-2021', 'sudan-2021', 'burkina-2022a', 'burkina-2022b', 'niger-2023', 'bolivia-2024']) {
      assert.ok(ids.includes(id), `missing coup ${id}`);
    }
  });
});

describe('coup-risk-helpers: field bounds', () => {
  it('all riskScore values are 0-100', () => {
    for (const c of COUP_RISK_COUNTRIES) {
      assert.ok(c.riskScore >= 0 && c.riskScore <= 100, `${c.id} riskScore out of range`);
    }
  });

  it('all militaryInfluence values are 0-10', () => {
    for (const c of COUP_RISK_COUNTRIES) {
      assert.ok(c.militaryInfluence >= 0 && c.militaryInfluence <= 10, `${c.id} militaryInfluence out of range`);
    }
  });

  it('all economicCrisis values are 0-10', () => {
    for (const c of COUP_RISK_COUNTRIES) {
      assert.ok(c.economicCrisis >= 0 && c.economicCrisis <= 10, `${c.id} economicCrisis out of range`);
    }
  });

  it('all protestIntensity values are 0-10', () => {
    for (const c of COUP_RISK_COUNTRIES) {
      assert.ok(c.protestIntensity >= 0 && c.protestIntensity <= 10, `${c.id} protestIntensity out of range`);
    }
  });

  it('all civilMilitaryTension values are 0-10', () => {
    for (const c of COUP_RISK_COUNTRIES) {
      assert.ok(c.civilMilitaryTension >= 0 && c.civilMilitaryTension <= 10, `${c.id} civilMilitaryTension out of range`);
    }
  });

  it('every country has at least one key factor', () => {
    for (const c of COUP_RISK_COUNTRIES) {
      assert.ok(Array.isArray(c.keyFactors) && c.keyFactors.length > 0, `${c.id} missing keyFactors`);
    }
  });

  it('riskLevel is one of the four valid values', () => {
    const valid = new Set(['critical', 'high', 'medium', 'low']);
    for (const c of COUP_RISK_COUNTRIES) {
      assert.ok(valid.has(c.riskLevel), `${c.id} invalid riskLevel`);
    }
  });

  it('trend is one of the three valid values', () => {
    const valid = new Set(['rising', 'stable', 'falling']);
    for (const c of COUP_RISK_COUNTRIES) {
      assert.ok(valid.has(c.trend), `${c.id} invalid trend`);
    }
  });

  it('lastCoupAttempt is null or a plausible year', () => {
    for (const c of COUP_RISK_COUNTRIES) {
      if (c.lastCoupAttempt !== null) {
        assert.ok(c.lastCoupAttempt >= 1950 && c.lastCoupAttempt <= 2024, `${c.id} implausible year`);
      }
    }
  });

  it('recentMutinyAttempt is boolean for all', () => {
    for (const c of COUP_RISK_COUNTRIES) {
      assert.equal(typeof c.recentMutinyAttempt, 'boolean');
    }
  });

  it('recent coup type is valid for all', () => {
    const valid = new Set(['successful', 'attempted', 'self-coup']);
    for (const c of RECENT_COUPS) {
      assert.ok(valid.has(c.type), `${c.id} invalid type`);
    }
  });

  it('recent coup years are between 2020 and 2024', () => {
    for (const c of RECENT_COUPS) {
      assert.ok(c.year >= 2020 && c.year <= 2024, `${c.id} year out of range`);
    }
  });
});

describe('coup-risk-helpers: specific values', () => {
  it('Myanmar has riskScore 92', () => {
    const m = COUP_RISK_COUNTRIES.find((c) => c.id === 'myanmar');
    assert.ok(m);
    assert.equal(m.riskScore, 92);
  });

  it('Myanmar has the highest riskScore', () => {
    const max = Math.max(...COUP_RISK_COUNTRIES.map((c) => c.riskScore));
    assert.equal(max, 92);
    const top = [...COUP_RISK_COUNTRIES].sort((a, b) => b.riskScore - a.riskScore)[0];
    assert.equal(top.id, 'myanmar');
  });

  it('Sudan has riskScore 88', () => {
    assert.equal(COUP_RISK_COUNTRIES.find((c) => c.id === 'sudan')?.riskScore, 88);
  });

  it('Myanmar has maximum military influence and civil-military tension', () => {
    const m = COUP_RISK_COUNTRIES.find((c) => c.id === 'myanmar')!;
    assert.equal(m.militaryInfluence, 10);
    assert.equal(m.civilMilitaryTension, 10);
  });

  it('Ethiopia and Pakistan have null lastCoupAttempt', () => {
    assert.equal(COUP_RISK_COUNTRIES.find((c) => c.id === 'ethiopia')?.lastCoupAttempt, null);
    assert.equal(COUP_RISK_COUNTRIES.find((c) => c.id === 'pakistan')?.lastCoupAttempt, null);
  });

  it('bolivia-2024 is the only attempted coup', () => {
    const attempted = RECENT_COUPS.filter((c) => c.type === 'attempted');
    assert.equal(attempted.length, 1);
    assert.equal(attempted[0].id, 'bolivia-2024');
  });
});

describe('coup-risk-helpers: getByRiskLevel', () => {
  it('returns only critical countries', () => {
    const r = getByRiskLevel(COUP_RISK_COUNTRIES, 'critical');
    assert.ok(r.every((c) => c.riskLevel === 'critical'));
  });

  it('critical level returns 3 entries', () => {
    assert.equal(getByRiskLevel(COUP_RISK_COUNTRIES, 'critical').length, 3);
  });

  it('high level returns 4 entries', () => {
    assert.equal(getByRiskLevel(COUP_RISK_COUNTRIES, 'high').length, 4);
  });

  it('medium level returns 5 entries', () => {
    assert.equal(getByRiskLevel(COUP_RISK_COUNTRIES, 'medium').length, 5);
  });

  it('low level returns 0 entries', () => {
    assert.equal(getByRiskLevel(COUP_RISK_COUNTRIES, 'low').length, 0);
  });
});

describe('coup-risk-helpers: getCriticalRisk', () => {
  it('returns myanmar, sudan, burkina-faso', () => {
    const ids = getCriticalRisk(COUP_RISK_COUNTRIES).map((c) => c.id).sort();
    assert.deepEqual(ids, ['burkina-faso', 'myanmar', 'sudan']);
  });

  it('matches getByRiskLevel critical', () => {
    assert.equal(getCriticalRisk(COUP_RISK_COUNTRIES).length, getByRiskLevel(COUP_RISK_COUNTRIES, 'critical').length);
  });
});

describe('coup-risk-helpers: getByRegion', () => {
  it('West Africa returns mali, niger, guinea, burkina-faso', () => {
    const ids = getByRegion(COUP_RISK_COUNTRIES, 'West Africa').map((c) => c.id).sort();
    assert.deepEqual(ids, ['burkina-faso', 'guinea', 'mali', 'niger']);
  });

  it('East Africa returns sudan and ethiopia', () => {
    const ids = getByRegion(COUP_RISK_COUNTRIES, 'East Africa').map((c) => c.id).sort();
    assert.deepEqual(ids, ['ethiopia', 'sudan']);
  });

  it('unknown region returns empty', () => {
    assert.equal(getByRegion(COUP_RISK_COUNTRIES, 'Atlantis').length, 0);
  });
});

describe('coup-risk-helpers: getRisingTrend', () => {
  it('returns myanmar and sudan', () => {
    const ids = getRisingTrend(COUP_RISK_COUNTRIES).map((c) => c.id).sort();
    assert.deepEqual(ids, ['myanmar', 'sudan']);
  });

  it('all returned have rising trend', () => {
    assert.ok(getRisingTrend(COUP_RISK_COUNTRIES).every((c) => c.trend === 'rising'));
  });
});

describe('coup-risk-helpers: getRecentCoupsByType', () => {
  it('successful returns 7 entries', () => {
    assert.equal(getRecentCoupsByType(RECENT_COUPS, 'successful').length, 7);
  });

  it('attempted returns 1 entry (bolivia-2024)', () => {
    const a = getRecentCoupsByType(RECENT_COUPS, 'attempted');
    assert.equal(a.length, 1);
    assert.equal(a[0].id, 'bolivia-2024');
  });

  it('self-coup returns 0 entries', () => {
    assert.equal(getRecentCoupsByType(RECENT_COUPS, 'self-coup').length, 0);
  });

  it('all returned match requested type', () => {
    assert.ok(getRecentCoupsByType(RECENT_COUPS, 'successful').every((c) => c.type === 'successful'));
  });
});

describe('coup-risk-helpers: computeGlobalCoupRiskIndex', () => {
  it('returns a value in 0-100', () => {
    const idx = computeGlobalCoupRiskIndex(COUP_RISK_COUNTRIES);
    assert.ok(idx >= 0 && idx <= 100);
  });

  it('returns an integer', () => {
    const idx = computeGlobalCoupRiskIndex(COUP_RISK_COUNTRIES);
    assert.equal(idx, Math.round(idx));
  });

  it('returns 0 for empty input', () => {
    assert.equal(computeGlobalCoupRiskIndex([]), 0);
  });

  it('weights critical above medium (higher score for all-critical)', () => {
    const allCritical: CoupRiskCountry[] = COUP_RISK_COUNTRIES.map((c) => ({ ...c, riskLevel: 'critical' }));
    const allMedium: CoupRiskCountry[] = COUP_RISK_COUNTRIES.map((c) => ({ ...c, riskLevel: 'medium' }));
    assert.ok(computeGlobalCoupRiskIndex(allCritical) >= computeGlobalCoupRiskIndex(allMedium));
  });

  it('single critical country returns its own score', () => {
    const one = COUP_RISK_COUNTRIES.find((c) => c.id === 'myanmar')!;
    assert.equal(computeGlobalCoupRiskIndex([one]), one.riskScore);
  });
});

describe('coup-risk-helpers: riskLevelClass', () => {
  it('returns non-empty for all four levels', () => {
    for (const level of ['critical', 'high', 'medium', 'low'] as const) {
      assert.ok(riskLevelClass(level).length > 0, `empty class for ${level}`);
    }
  });

  it('returns distinct classes per level', () => {
    const classes = new Set(['critical', 'high', 'medium', 'low'].map((l) => riskLevelClass(l as CoupRiskCountry['riskLevel'])));
    assert.equal(classes.size, 4);
  });
});

describe('coup-risk-helpers: trendClass + trendArrow', () => {
  it('trendClass non-empty for all trends', () => {
    for (const t of ['rising', 'stable', 'falling'] as const) {
      assert.ok(trendClass(t).length > 0, `empty class for ${t}`);
    }
  });

  it('trendArrow returns the expected glyphs', () => {
    assert.equal(trendArrow('rising'), '↑');
    assert.equal(trendArrow('stable'), '→');
    assert.equal(trendArrow('falling'), '↓');
  });
});

describe('coup-risk-helpers: buildRenderData', () => {
  it('returns the full shape', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.countries));
    assert.ok(Array.isArray(d.recentCoups));
    assert.equal(typeof d.lastUpdated, 'string');
    assert.equal(typeof d.globalCoupRiskIndex, 'number');
  });

  it('carries all 12 countries and 8 coups', () => {
    const d = buildRenderData();
    assert.equal(d.countries.length, 12);
    assert.equal(d.recentCoups.length, 8);
  });

  it('globalCoupRiskIndex matches the standalone computation', () => {
    const d = buildRenderData();
    assert.equal(d.globalCoupRiskIndex, computeGlobalCoupRiskIndex(COUP_RISK_COUNTRIES));
  });

  it('globalCoupRiskIndex is within 0-100', () => {
    const d = buildRenderData();
    assert.ok(d.globalCoupRiskIndex >= 0 && d.globalCoupRiskIndex <= 100);
  });
});

describe('coup-risk-helpers: boundary cases', () => {
  it('getByRiskLevel handles empty array', () => {
    assert.deepEqual(getByRiskLevel([], 'critical'), []);
  });

  it('getCriticalRisk handles empty array', () => {
    assert.deepEqual(getCriticalRisk([]), []);
  });

  it('getByRegion handles empty array', () => {
    assert.deepEqual(getByRegion([], 'West Africa'), []);
  });

  it('getRisingTrend handles empty array', () => {
    assert.deepEqual(getRisingTrend([]), []);
  });

  it('getRecentCoupsByType handles empty array', () => {
    assert.deepEqual(getRecentCoupsByType([], 'successful'), []);
  });

  it('getRecentCoupsByType handles a custom fixture', () => {
    const fixture: RecentCoup[] = [
      { id: 'x', country: 'X', year: 2022, type: 'self-coup', method: 'm', outcome: 'o' },
    ];
    assert.equal(getRecentCoupsByType(fixture, 'self-coup').length, 1);
    assert.equal(getRecentCoupsByType(fixture, 'successful').length, 0);
  });
});
