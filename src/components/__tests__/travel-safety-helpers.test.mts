import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advisoryLabel,
  advisoryColor,
  countByAdvisoryLevel,
  filterByLevel,
  filterByMinLevel,
  filterByContinent,
  sortByRiskDescending,
  countriesUnderEvacuation,
  hasEntryRestrictions,
  topRiskyCountries,
  recentCriticalAlerts,
  alertsByCountry,
  computeRiskProfile,
  dominantRiskCategory,
  buildRenderData,
  type CountryAdvisory,
  type SafetyAlert,
  type AdvisoryLevel,
} from '../travel-safety-helpers.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeAdvisory(over: Partial<CountryAdvisory> = {}): CountryAdvisory {
  return {
    country: 'Testland',
    countryCode: 'TS',
    continent: 'europe',
    advisoryLevel: 1,
    primaryRisks: ['crime'],
    summary: 'Test summary',
    lastUpdated: '2026-01-01',
    entryRestrictions: false,
    evacuationStatus: 'none',
    ...over,
  };
}

function makeAlert(over: Partial<SafetyAlert> = {}): SafetyAlert {
  return {
    id: 'a1',
    date: '2026-01-01',
    countryCode: 'TS',
    country: 'Testland',
    title: 'Test alert',
    severity: 'medium',
    category: 'crime',
    ...over,
  };
}

// ── advisoryLabel ─────────────────────────────────────────────────────────

test('advisoryLabel: level 1 is Normal Precautions', () => {
  assert.equal(advisoryLabel(1), 'Normal Precautions');
});

test('advisoryLabel: level 2 is Exercise Caution', () => {
  assert.equal(advisoryLabel(2), 'Exercise Caution');
});

test('advisoryLabel: level 3 is Reconsider Travel', () => {
  assert.equal(advisoryLabel(3), 'Reconsider Travel');
});

test('advisoryLabel: level 4 is Do Not Travel', () => {
  assert.equal(advisoryLabel(4), 'Do Not Travel');
});

// ── advisoryColor ─────────────────────────────────────────────────────────

test('advisoryColor: level 1 is green', () => {
  assert.equal(advisoryColor(1), '#22c55e');
});

test('advisoryColor: level 4 is red', () => {
  assert.equal(advisoryColor(4), '#ef4444');
});

test('advisoryColor: all four levels return distinct hex colors', () => {
  const colors = ([1, 2, 3, 4] as AdvisoryLevel[]).map(advisoryColor);
  assert.equal(new Set(colors).size, 4);
});

test('advisoryColor: all values start with #', () => {
  for (const lvl of [1, 2, 3, 4] as AdvisoryLevel[]) {
    assert.ok(advisoryColor(lvl).startsWith('#'));
  }
});

// ── countByAdvisoryLevel ──────────────────────────────────────────────────

test('countByAdvisoryLevel: counts each level correctly', () => {
  const advisories = [
    makeAdvisory({ advisoryLevel: 1 }),
    makeAdvisory({ advisoryLevel: 1 }),
    makeAdvisory({ advisoryLevel: 4 }),
  ];
  const counts = countByAdvisoryLevel(advisories);
  assert.equal(counts[1], 2);
  assert.equal(counts[4], 1);
  assert.equal(counts[2], 0);
  assert.equal(counts[3], 0);
});

test('countByAdvisoryLevel: empty list returns all zeros', () => {
  const counts = countByAdvisoryLevel([]);
  assert.equal(counts[1] + counts[2] + counts[3] + counts[4], 0);
});

// ── filterByLevel ─────────────────────────────────────────────────────────

test('filterByLevel: returns only matching level', () => {
  const advisories = [makeAdvisory({ advisoryLevel: 2 }), makeAdvisory({ advisoryLevel: 4 })];
  assert.equal(filterByLevel(advisories, 2).length, 1);
  assert.equal(filterByLevel(advisories, 2)[0]!.advisoryLevel, 2);
});

test('filterByLevel: returns empty when none match', () => {
  assert.equal(filterByLevel([makeAdvisory({ advisoryLevel: 1 })], 3).length, 0);
});

// ── filterByMinLevel ──────────────────────────────────────────────────────

test('filterByMinLevel: includes equal and above', () => {
  const advisories = [
    makeAdvisory({ advisoryLevel: 1 }),
    makeAdvisory({ advisoryLevel: 3 }),
    makeAdvisory({ advisoryLevel: 4 }),
  ];
  const result = filterByMinLevel(advisories, 3);
  assert.equal(result.length, 2);
  for (const a of result) assert.ok(a.advisoryLevel >= 3);
});

test('filterByMinLevel: min 1 returns all', () => {
  const advisories = [1, 2, 3, 4].map((l) => makeAdvisory({ advisoryLevel: l as AdvisoryLevel }));
  assert.equal(filterByMinLevel(advisories, 1).length, 4);
});

// ── filterByContinent ─────────────────────────────────────────────────────

test('filterByContinent: returns only matching continent', () => {
  const advisories = [
    makeAdvisory({ continent: 'europe' }),
    makeAdvisory({ continent: 'africa' }),
  ];
  const result = filterByContinent(advisories, 'europe');
  assert.equal(result.length, 1);
  assert.equal(result[0]!.continent, 'europe');
});

test('filterByContinent: returns empty for unmatched', () => {
  assert.equal(filterByContinent([makeAdvisory({ continent: 'europe' })], 'americas').length, 0);
});

// ── sortByRiskDescending ──────────────────────────────────────────────────

test('sortByRiskDescending: level 4 appears before level 1', () => {
  const advisories = [makeAdvisory({ advisoryLevel: 1 }), makeAdvisory({ advisoryLevel: 4 })];
  const sorted = sortByRiskDescending(advisories);
  assert.equal(sorted[0]!.advisoryLevel, 4);
});

test('sortByRiskDescending: does not mutate original array', () => {
  const a = makeAdvisory({ advisoryLevel: 1 });
  const b = makeAdvisory({ advisoryLevel: 4 });
  const arr = [a, b];
  sortByRiskDescending(arr);
  assert.equal(arr[0]!.advisoryLevel, 1);
});

test('sortByRiskDescending: empty input returns empty', () => {
  assert.deepEqual(sortByRiskDescending([]), []);
});

// ── countriesUnderEvacuation ──────────────────────────────────────────────

test('countriesUnderEvacuation: excludes none status', () => {
  const advisories = [
    makeAdvisory({ evacuationStatus: 'none' }),
    makeAdvisory({ evacuationStatus: 'voluntary' }),
    makeAdvisory({ evacuationStatus: 'ordered' }),
  ];
  const result = countriesUnderEvacuation(advisories);
  assert.equal(result.length, 2);
});

test('countriesUnderEvacuation: returns empty when all none', () => {
  assert.equal(countriesUnderEvacuation([makeAdvisory({ evacuationStatus: 'none' })]).length, 0);
});

// ── hasEntryRestrictions ──────────────────────────────────────────────────

test('hasEntryRestrictions: returns true when restricted', () => {
  assert.ok(hasEntryRestrictions(makeAdvisory({ entryRestrictions: true })));
});

test('hasEntryRestrictions: returns false when not restricted', () => {
  assert.ok(!hasEntryRestrictions(makeAdvisory({ entryRestrictions: false })));
});

// ── topRiskyCountries ─────────────────────────────────────────────────────

test('topRiskyCountries: default limit of 5', () => {
  const advisories = [1, 2, 3, 4, 1, 2, 3].map((l) => makeAdvisory({ advisoryLevel: l as AdvisoryLevel }));
  assert.equal(topRiskyCountries(advisories).length, 5);
});

test('topRiskyCountries: first result has highest level', () => {
  const advisories = [makeAdvisory({ advisoryLevel: 1 }), makeAdvisory({ advisoryLevel: 4 })];
  assert.equal(topRiskyCountries(advisories)[0]!.advisoryLevel, 4);
});

test('topRiskyCountries: custom limit respected', () => {
  const advisories = [1, 2, 3, 4].map((l) => makeAdvisory({ advisoryLevel: l as AdvisoryLevel }));
  assert.equal(topRiskyCountries(advisories, 2).length, 2);
});

// ── recentCriticalAlerts ──────────────────────────────────────────────────

test('recentCriticalAlerts: excludes high and medium severity', () => {
  const alerts = [
    makeAlert({ severity: 'critical', date: '2026-05-01' }),
    makeAlert({ severity: 'high', date: '2026-05-02' }),
    makeAlert({ severity: 'medium', date: '2026-05-03' }),
  ];
  const result = recentCriticalAlerts(alerts);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.severity, 'critical');
});

test('recentCriticalAlerts: sorted newest first', () => {
  const alerts = [
    makeAlert({ id: 'a', severity: 'critical', date: '2026-01-01' }),
    makeAlert({ id: 'b', severity: 'critical', date: '2026-05-01' }),
  ];
  const result = recentCriticalAlerts(alerts);
  assert.equal(result[0]!.id, 'b');
});

test('recentCriticalAlerts: respects limit', () => {
  const alerts = Array.from({ length: 10 }, (_, i) =>
    makeAlert({ id: String(i), severity: 'critical', date: '2026-01-01' })
  );
  assert.equal(recentCriticalAlerts(alerts, 3).length, 3);
});

// ── alertsByCountry ───────────────────────────────────────────────────────

test('alertsByCountry: returns only matching country code', () => {
  const alerts = [makeAlert({ countryCode: 'US' }), makeAlert({ countryCode: 'GB' })];
  assert.equal(alertsByCountry(alerts, 'US').length, 1);
});

test('alertsByCountry: returns empty for unknown code', () => {
  assert.equal(alertsByCountry([makeAlert({ countryCode: 'US' })], 'ZZ').length, 0);
});

// ── computeRiskProfile ────────────────────────────────────────────────────

test('computeRiskProfile: counts risk categories across advisories', () => {
  const advisories = [
    makeAdvisory({ primaryRisks: ['crime', 'terrorism'] }),
    makeAdvisory({ primaryRisks: ['crime'] }),
  ];
  const profile = computeRiskProfile(advisories);
  assert.equal(profile['crime'], 2);
  assert.equal(profile['terrorism'], 1);
  assert.equal(profile['health'], 0);
});

test('computeRiskProfile: all seven categories present in output', () => {
  const profile = computeRiskProfile([]);
  const keys = Object.keys(profile);
  assert.equal(keys.length, 7);
});

// ── dominantRiskCategory ──────────────────────────────────────────────────

test('dominantRiskCategory: returns category with highest count', () => {
  const advisories = [
    makeAdvisory({ primaryRisks: ['terrorism', 'terrorism'] }),
    makeAdvisory({ primaryRisks: ['crime'] }),
  ];
  assert.equal(dominantRiskCategory(advisories), 'terrorism');
});

// ── buildRenderData ───────────────────────────────────────────────────────

test('buildRenderData: advisories list is non-empty', () => {
  const data = buildRenderData();
  assert.ok(data.advisories.length > 0);
});

test('buildRenderData: advisories sorted descending by level', () => {
  const data = buildRenderData();
  assert.equal(data.advisories[0]!.advisoryLevel, 4);
});

test('buildRenderData: criticalAlerts are all critical severity', () => {
  const data = buildRenderData();
  for (const a of data.criticalAlerts) {
    assert.equal(a.severity, 'critical');
  }
});

test('buildRenderData: levelCounts has all four levels', () => {
  const data = buildRenderData();
  assert.ok('1' in data.levelCounts || 1 in data.levelCounts);
  assert.ok('4' in data.levelCounts || 4 in data.levelCounts);
});

test('buildRenderData: evacuationCountries contains no none-status entries', () => {
  const data = buildRenderData();
  for (const c of data.evacuationCountries) {
    assert.notEqual(c.evacuationStatus, 'none');
  }
});

test('buildRenderData: topRisky has at most 5 entries', () => {
  const data = buildRenderData();
  assert.ok(data.topRisky.length <= 5);
});

test('buildRenderData: dominantRisk is a valid RiskCategory', () => {
  const valid = new Set(['crime', 'terrorism', 'civil-unrest', 'health', 'natural-disaster', 'kidnapping', 'infrastructure']);
  const data = buildRenderData();
  assert.ok(valid.has(data.dominantRisk));
});
