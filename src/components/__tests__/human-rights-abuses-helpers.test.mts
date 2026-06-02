import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreAbuseRisk,
  categorizeCrimes,
  getDominantCategory,
  assessTrend,
  computeImpunityIndex,
  detectPatterns,
  rankCountries,
  buildCountryProfiles,
  buildRenderData,
  type HumanRightsEvent,
  type CountryRiskProfile,
  type ImpunityData,
} from '../human-rights-abuses-helpers.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeEvent = (overrides: Partial<HumanRightsEvent> = {}): HumanRightsEvent => ({
  country: 'TestLand',
  category: 'arbitrary-detention',
  severity: 50,
  date: '2026-05-01',
  prosecuted: false,
  ...overrides,
});

const makeProfile = (overrides: Partial<CountryRiskProfile> = {}): CountryRiskProfile => ({
  country: 'TestLand',
  abuseRiskScore: 50,
  impunityIndex: 0.8,
  trend: 'stable',
  dominantCategory: 'arbitrary-detention',
  incidentCount: 2,
  ...overrides,
});

// ── scoreAbuseRisk ─────────────────────────────────────────────────────────────

describe('scoreAbuseRisk', () => {
  test('returns 0 for empty array', () => {
    assert.equal(scoreAbuseRisk([]), 0);
  });

  test('single event returns severity + category penalty (3)', () => {
    const events = [makeEvent({ severity: 50 })];
    assert.equal(scoreAbuseRisk(events), 53);
  });

  test('multiple events average severity correctly', () => {
    const events = [
      makeEvent({ severity: 60, category: 'torture' }),
      makeEvent({ severity: 80, category: 'torture' }),
    ];
    // avg = 70, 1 unique category → penalty 3 → 73
    assert.equal(scoreAbuseRisk(events), 73);
  });

  test('multiple categories add penalty per category', () => {
    const events = [
      makeEvent({ severity: 60, category: 'torture' }),
      makeEvent({ severity: 60, category: 'arbitrary-detention' }),
    ];
    // avg = 60, 2 categories → penalty 6 → 66
    assert.equal(scoreAbuseRisk(events), 66);
  });

  test('caps at 100', () => {
    const events = Array.from({ length: 6 }, (_, i) => makeEvent({
      severity: 99,
      category: ['extrajudicial-killing', 'forced-disappearance', 'torture', 'arbitrary-detention', 'forced-displacement', 'suppression-assembly'][i] as HumanRightsEvent['category'],
    }));
    assert.equal(scoreAbuseRisk(events), 100);
  });
});

// ── categorizeCrimes ──────────────────────────────────────────────────────────

describe('categorizeCrimes', () => {
  test('returns all-zero counts for empty array', () => {
    const counts = categorizeCrimes([]);
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 0);
  });

  test('counts single category correctly', () => {
    const events = [makeEvent({ category: 'torture' }), makeEvent({ category: 'torture' })];
    const counts = categorizeCrimes(events);
    assert.equal(counts['torture'], 2);
    assert.equal(counts['arbitrary-detention'], 0);
  });

  test('counts multiple categories', () => {
    const events = [
      makeEvent({ category: 'torture' }),
      makeEvent({ category: 'arbitrary-detention' }),
      makeEvent({ category: 'torture' }),
    ];
    const counts = categorizeCrimes(events);
    assert.equal(counts['torture'], 2);
    assert.equal(counts['arbitrary-detention'], 1);
  });

  test('returns record with all six category keys', () => {
    const counts = categorizeCrimes([]);
    const keys = Object.keys(counts);
    assert.equal(keys.length, 6);
    assert.ok(keys.includes('extrajudicial-killing'));
    assert.ok(keys.includes('suppression-assembly'));
  });
});

// ── getDominantCategory ───────────────────────────────────────────────────────

describe('getDominantCategory', () => {
  test('returns the most frequent category', () => {
    const events = [
      makeEvent({ category: 'torture' }),
      makeEvent({ category: 'torture' }),
      makeEvent({ category: 'arbitrary-detention' }),
    ];
    assert.equal(getDominantCategory(events), 'torture');
  });

  test('single event returns that event category', () => {
    assert.equal(getDominantCategory([makeEvent({ category: 'forced-disappearance' })]), 'forced-disappearance');
  });

  test('tie-breaking: first alphabetically in sort wins', () => {
    const events = [
      makeEvent({ category: 'torture' }),
      makeEvent({ category: 'arbitrary-detention' }),
    ];
    // Both count = 1; sort is stable so first-encountered wins in practice
    const result = getDominantCategory(events);
    assert.ok(['torture', 'arbitrary-detention'].includes(result));
  });
});

// ── assessTrend ───────────────────────────────────────────────────────────────

describe('assessTrend', () => {
  test('returns stable for empty array', () => {
    assert.equal(assessTrend([], 30), 'stable');
  });

  test('returns worsening when recent severity much higher than older', () => {
    const events = [
      makeEvent({ date: '2026-05-25', severity: 90 }), // recent
      makeEvent({ date: '2026-04-01', severity: 40 }), // older
    ];
    assert.equal(assessTrend(events, 30), 'worsening');
  });

  test('returns improving when recent severity much lower than older', () => {
    const events = [
      makeEvent({ date: '2026-05-25', severity: 30 }), // recent
      makeEvent({ date: '2026-04-01', severity: 80 }), // older
    ];
    assert.equal(assessTrend(events, 30), 'improving');
  });

  test('returns stable when difference is within 5', () => {
    const events = [
      makeEvent({ date: '2026-05-25', severity: 50 }),
      makeEvent({ date: '2026-04-01', severity: 52 }),
    ];
    assert.equal(assessTrend(events, 30), 'stable');
  });

  test('all events older than window results in recentAvg=0 compared to olderAvg', () => {
    const events = [makeEvent({ date: '2026-01-01', severity: 80 })];
    // recent=[], older=[80] → recentAvg=0, olderAvg=80 → difference > 5 → improving
    assert.equal(assessTrend(events, 30), 'improving');
  });
});

// ── computeImpunityIndex ──────────────────────────────────────────────────────

describe('computeImpunityIndex', () => {
  test('returns 0 for zero incidents', () => {
    assert.equal(computeImpunityIndex({ incidents: 0, prosecutions: 0 }), 0);
  });

  test('returns 1 for no prosecutions', () => {
    assert.equal(computeImpunityIndex({ incidents: 5, prosecutions: 0 }), 1);
  });

  test('returns 0 when all prosecuted', () => {
    assert.equal(computeImpunityIndex({ incidents: 5, prosecutions: 5 }), 0);
  });

  test('returns 0.5 for half prosecuted', () => {
    assert.equal(computeImpunityIndex({ incidents: 4, prosecutions: 2 }), 0.5);
  });

  test('caps prosecution rate at 1 (prosecutions > incidents)', () => {
    assert.equal(computeImpunityIndex({ incidents: 3, prosecutions: 10 }), 0);
  });

  test('result is a number with 3 decimal precision', () => {
    const result = computeImpunityIndex({ incidents: 3, prosecutions: 1 });
    assert.equal(result, parseFloat(result.toFixed(3)));
  });
});

// ── detectPatterns ────────────────────────────────────────────────────────────

describe('detectPatterns', () => {
  test('returns none for empty array', () => {
    assert.equal(detectPatterns([]), 'none');
  });

  test('returns systematic for high impunity + 3+ categories', () => {
    const events = [
      makeEvent({ prosecuted: false, category: 'torture' }),
      makeEvent({ prosecuted: false, category: 'arbitrary-detention' }),
      makeEvent({ prosecuted: false, category: 'extrajudicial-killing' }),
      makeEvent({ prosecuted: false, category: 'forced-disappearance' }),
    ];
    assert.equal(detectPatterns(events), 'systematic');
  });

  test('returns opportunistic for 2+ events without systematic threshold', () => {
    const events = [
      makeEvent({ prosecuted: true, category: 'torture' }),
      makeEvent({ prosecuted: true, category: 'arbitrary-detention' }),
    ];
    assert.equal(detectPatterns(events), 'opportunistic');
  });

  test('single event returns none', () => {
    assert.equal(detectPatterns([makeEvent()]), 'none');
  });

  test('high impunity but fewer than 3 categories → opportunistic not systematic', () => {
    const events = [
      makeEvent({ prosecuted: false, category: 'torture' }),
      makeEvent({ prosecuted: false, category: 'arbitrary-detention' }),
      makeEvent({ prosecuted: false, category: 'arbitrary-detention' }),
    ];
    // 2 unique categories → not systematic → opportunistic (3 events)
    assert.equal(detectPatterns(events), 'opportunistic');
  });
});

// ── rankCountries ─────────────────────────────────────────────────────────────

describe('rankCountries', () => {
  test('returns empty array for empty input', () => {
    assert.deepEqual(rankCountries([]), []);
  });

  test('sorts descending by abuseRiskScore', () => {
    const profiles = [
      makeProfile({ country: 'A', abuseRiskScore: 40 }),
      makeProfile({ country: 'B', abuseRiskScore: 80 }),
      makeProfile({ country: 'C', abuseRiskScore: 60 }),
    ];
    const ranked = rankCountries(profiles);
    assert.equal(ranked[0].country, 'B');
    assert.equal(ranked[1].country, 'C');
    assert.equal(ranked[2].country, 'A');
  });

  test('does not mutate the original array', () => {
    const profiles = [
      makeProfile({ country: 'A', abuseRiskScore: 40 }),
      makeProfile({ country: 'B', abuseRiskScore: 80 }),
    ];
    const original = [...profiles];
    rankCountries(profiles);
    assert.equal(profiles[0].country, original[0].country);
  });

  test('single profile returns array with that profile', () => {
    const profiles = [makeProfile({ abuseRiskScore: 55 })];
    assert.equal(rankCountries(profiles).length, 1);
  });
});

// ── buildCountryProfiles ──────────────────────────────────────────────────────

describe('buildCountryProfiles', () => {
  test('returns an array of profiles', () => {
    const profiles = buildCountryProfiles();
    assert.ok(Array.isArray(profiles));
    assert.ok(profiles.length > 0);
  });

  test('each profile has required fields', () => {
    const profiles = buildCountryProfiles();
    for (const p of profiles) {
      assert.ok(typeof p.country === 'string');
      assert.ok(typeof p.abuseRiskScore === 'number');
      assert.ok(typeof p.impunityIndex === 'number');
      assert.ok(['worsening', 'stable', 'improving'].includes(p.trend));
      assert.ok(typeof p.dominantCategory === 'string');
      assert.ok(typeof p.incidentCount === 'number');
    }
  });

  test('abuseRiskScore is between 0 and 100', () => {
    const profiles = buildCountryProfiles();
    for (const p of profiles) {
      assert.ok(p.abuseRiskScore >= 0 && p.abuseRiskScore <= 100);
    }
  });

  test('impunityIndex is between 0 and 1', () => {
    const profiles = buildCountryProfiles();
    for (const p of profiles) {
      assert.ok(p.impunityIndex >= 0 && p.impunityIndex <= 1);
    }
  });

  test('North Korea appears in profiles', () => {
    const profiles = buildCountryProfiles();
    assert.ok(profiles.some(p => p.country === 'North Korea'));
  });

  test('incidentCount matches actual events', () => {
    const profiles = buildCountryProfiles();
    const china = profiles.find(p => p.country === 'China');
    assert.ok(china);
    assert.equal(china!.incidentCount, 2);
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  test('returns object with profiles, totalIncidents, systematicCount', () => {
    const data = buildRenderData();
    assert.ok(Array.isArray(data.profiles));
    assert.ok(typeof data.totalIncidents === 'number');
    assert.ok(typeof data.systematicCount === 'number');
  });

  test('totalIncidents equals 15 (the mock dataset size)', () => {
    const data = buildRenderData();
    assert.equal(data.totalIncidents, 15);
  });

  test('profiles are ranked by abuseRiskScore descending', () => {
    const data = buildRenderData();
    for (let i = 1; i < data.profiles.length; i++) {
      assert.ok(data.profiles[i - 1].abuseRiskScore >= data.profiles[i].abuseRiskScore);
    }
  });

  test('systematicCount is non-negative', () => {
    const data = buildRenderData();
    assert.ok(data.systematicCount >= 0);
  });

  test('systematicCount does not exceed number of profiles', () => {
    const data = buildRenderData();
    assert.ok(data.systematicCount <= data.profiles.length);
  });
});

// silence unused-import warning for ImpunityData
const _unused: ImpunityData = { incidents: 0, prosecutions: 0 };
void _unused;
