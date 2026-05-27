import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyInstabilityTier,
  tierToLabel,
  tierToRenderClass,
  scoreProtestIntensity,
  scoreDisplacementPressure,
  scoreResponseCapacity,
  computeCompositeRisk,
  identifyDominantDriver,
  buildCityResult,
  sortCitiesByRisk,
  filterByTier,
  getMockCityData,
  buildPanelRenderData,
  type InstabilityTier,
  type CityRawData,
} from '../urban-instability-helpers.ts';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCity(overrides: Partial<CityRawData> = {}): CityRawData {
  return {
    name: 'Test City',
    country: 'Test Country',
    protestIntensity: 50,
    riotFrequency: 50,
    gangControlPercent: 50,
    vigilanteActivity: 50,
    govResponseCapacity: 50,
    displacementPressure: 50,
    economicGrievanceIndex: 50,
    lastUpdated: '2026-05-27T00:00:00Z',
    ...overrides,
  };
}

// ── classifyInstabilityTier ────────────────────────────────────────────────

test('classifyInstabilityTier: 0 → low', () => {
  assert.equal(classifyInstabilityTier(0), 'low');
});

test('classifyInstabilityTier: 24 → low', () => {
  assert.equal(classifyInstabilityTier(24), 'low');
});

test('classifyInstabilityTier: 25 → moderate', () => {
  assert.equal(classifyInstabilityTier(25), 'moderate');
});

test('classifyInstabilityTier: 39 → moderate', () => {
  assert.equal(classifyInstabilityTier(39), 'moderate');
});

test('classifyInstabilityTier: 40 → elevated', () => {
  assert.equal(classifyInstabilityTier(40), 'elevated');
});

test('classifyInstabilityTier: 54 → elevated', () => {
  assert.equal(classifyInstabilityTier(54), 'elevated');
});

test('classifyInstabilityTier: 55 → high', () => {
  assert.equal(classifyInstabilityTier(55), 'high');
});

test('classifyInstabilityTier: 69 → high', () => {
  assert.equal(classifyInstabilityTier(69), 'high');
});

test('classifyInstabilityTier: 70 → severe', () => {
  assert.equal(classifyInstabilityTier(70), 'severe');
});

test('classifyInstabilityTier: 84 → severe', () => {
  assert.equal(classifyInstabilityTier(84), 'severe');
});

test('classifyInstabilityTier: 85 → critical', () => {
  assert.equal(classifyInstabilityTier(85), 'critical');
});

test('classifyInstabilityTier: 100 → critical', () => {
  assert.equal(classifyInstabilityTier(100), 'critical');
});

// ── tierToLabel ────────────────────────────────────────────────────────────

test('tierToLabel: all 6 tiers return non-empty strings', () => {
  const tiers: InstabilityTier[] = ['critical', 'severe', 'high', 'elevated', 'moderate', 'low'];
  for (const tier of tiers) {
    const label = tierToLabel(tier);
    assert.ok(typeof label === 'string' && label.length > 0, `tierToLabel(${tier}) returned empty`);
  }
});

test('tierToLabel: critical returns "Critical"', () => {
  assert.equal(tierToLabel('critical'), 'Critical');
});

test('tierToLabel: low returns "Low"', () => {
  assert.equal(tierToLabel('low'), 'Low');
});

// ── tierToRenderClass ──────────────────────────────────────────────────────

test('tierToRenderClass: all 6 tiers return tier-xxx format', () => {
  const tiers: InstabilityTier[] = ['critical', 'severe', 'high', 'elevated', 'moderate', 'low'];
  for (const tier of tiers) {
    const cls = tierToRenderClass(tier);
    assert.ok(cls.startsWith('tier-'), `tierToRenderClass(${tier}) does not start with 'tier-'`);
    assert.ok(cls === `tier-${tier}`, `tierToRenderClass(${tier}) should equal 'tier-${tier}'`);
  }
});

// ── scoreProtestIntensity ──────────────────────────────────────────────────

test('scoreProtestIntensity: both zero → 0', () => {
  assert.equal(scoreProtestIntensity(0, 0), 0);
});

test('scoreProtestIntensity: both 100 → 100', () => {
  assert.equal(scoreProtestIntensity(100, 100), 100);
});

test('scoreProtestIntensity: 60%/40% weighting applied', () => {
  // 60*0.6 + 40*0.4 = 36 + 16 = 52
  assert.equal(scoreProtestIntensity(60, 40), 52);
});

test('scoreProtestIntensity: clamped to 0', () => {
  assert.equal(scoreProtestIntensity(0, 0), 0);
});

// ── scoreDisplacementPressure ──────────────────────────────────────────────

test('scoreDisplacementPressure: both zero → 0', () => {
  assert.equal(scoreDisplacementPressure(0, 0), 0);
});

test('scoreDisplacementPressure: both 100 → 100', () => {
  assert.equal(scoreDisplacementPressure(100, 100), 100);
});

test('scoreDisplacementPressure: 70%/30% weighting applied', () => {
  // 70*0.7 + 30*0.3 = 49 + 9 = 58
  assert.equal(scoreDisplacementPressure(70, 30), 58);
});

// ── scoreResponseCapacity ──────────────────────────────────────────────────

test('scoreResponseCapacity: 0 → 100 (worst governance)', () => {
  assert.equal(scoreResponseCapacity(0), 100);
});

test('scoreResponseCapacity: 100 → 0 (best governance)', () => {
  assert.equal(scoreResponseCapacity(100), 0);
});

test('scoreResponseCapacity: 50 → 50', () => {
  assert.equal(scoreResponseCapacity(50), 50);
});

test('scoreResponseCapacity: 75 → 25', () => {
  assert.equal(scoreResponseCapacity(75), 25);
});

// ── computeCompositeRisk ───────────────────────────────────────────────────

test('computeCompositeRisk: all zeros → 0', () => {
  const city = makeCity({
    protestIntensity: 0,
    riotFrequency: 0,
    gangControlPercent: 0,
    vigilanteActivity: 0,
    govResponseCapacity: 100, // inverted → 0
    displacementPressure: 0,
    economicGrievanceIndex: 0,
  });
  assert.equal(computeCompositeRisk(city), 0);
});

test('computeCompositeRisk: all max inputs → 100', () => {
  const city = makeCity({
    protestIntensity: 100,
    riotFrequency: 100,
    gangControlPercent: 100,
    vigilanteActivity: 100,
    govResponseCapacity: 0,
    displacementPressure: 100,
    economicGrievanceIndex: 100,
  });
  assert.equal(computeCompositeRisk(city), 100);
});

test('computeCompositeRisk: result clamped to 0–100', () => {
  const city = makeCity({
    protestIntensity: 200,
    riotFrequency: 200,
    gangControlPercent: 200,
    vigilanteActivity: 200,
    govResponseCapacity: 0,
    displacementPressure: 200,
    economicGrievanceIndex: 200,
  });
  const risk = computeCompositeRisk(city);
  assert.ok(risk >= 0 && risk <= 100, `Expected 0–100, got ${risk}`);
});

test('computeCompositeRisk: realistic city values produce expected range', () => {
  const city = makeCity({
    protestIntensity: 70,
    riotFrequency: 60,
    gangControlPercent: 65,
    vigilanteActivity: 45,
    govResponseCapacity: 30,
    displacementPressure: 70,
    economicGrievanceIndex: 85,
  });
  const risk = computeCompositeRisk(city);
  assert.ok(risk > 0 && risk <= 100, `Expected in 0–100, got ${risk}`);
  assert.ok(risk > 50, `Expected high risk for this city, got ${risk}`);
});

// ── identifyDominantDriver ─────────────────────────────────────────────────

test('identifyDominantDriver: returns a non-empty string', () => {
  const city = makeCity();
  const driver = identifyDominantDriver(city);
  assert.ok(typeof driver === 'string' && driver.length > 0);
});

test('identifyDominantDriver: identifies gang control as dominant', () => {
  const city = makeCity({
    protestIntensity: 10,
    riotFrequency: 10,
    gangControlPercent: 95,
    vigilanteActivity: 10,
    govResponseCapacity: 90, // inverted → 10
    displacementPressure: 10,
    economicGrievanceIndex: 10,
  });
  const driver = identifyDominantDriver(city);
  assert.equal(driver, 'Gang Territorial Control');
});

test('identifyDominantDriver: identifies displacement as dominant', () => {
  const city = makeCity({
    protestIntensity: 10,
    riotFrequency: 10,
    gangControlPercent: 10,
    vigilanteActivity: 10,
    govResponseCapacity: 90, // inverted → 10
    displacementPressure: 99,
    economicGrievanceIndex: 10,
  });
  const driver = identifyDominantDriver(city);
  assert.equal(driver, 'Displacement Pressure');
});

// ── buildCityResult ────────────────────────────────────────────────────────

test('buildCityResult: compositeRisk in 0–100', () => {
  const result = buildCityResult(makeCity());
  assert.ok(result.compositeRisk >= 0 && result.compositeRisk <= 100);
});

test('buildCityResult: tier matches classifyInstabilityTier', () => {
  const city = makeCity({ protestIntensity: 90, riotFrequency: 90, gangControlPercent: 90, vigilanteActivity: 90, govResponseCapacity: 5, displacementPressure: 90, economicGrievanceIndex: 90 });
  const result = buildCityResult(city);
  assert.equal(result.tier, classifyInstabilityTier(result.compositeRisk));
});

test('buildCityResult: has dominantDriver', () => {
  const result = buildCityResult(makeCity());
  assert.ok(typeof result.dominantDriver === 'string' && result.dominantDriver.length > 0);
});

test('buildCityResult: renderClass is tier-xxx', () => {
  const result = buildCityResult(makeCity());
  assert.ok(result.renderClass.startsWith('tier-'));
});

// ── sortCitiesByRisk ───────────────────────────────────────────────────────

test('sortCitiesByRisk: first element has highest risk', () => {
  const cities = getMockCityData();
  const results = cities.map(buildCityResult);
  const sorted = sortCitiesByRisk(results);
  assert.ok(sorted[0].compositeRisk >= sorted[sorted.length - 1].compositeRisk);
});

test('sortCitiesByRisk: last element has lowest risk', () => {
  const cities = getMockCityData();
  const results = cities.map(buildCityResult);
  const sorted = sortCitiesByRisk(results);
  for (let i = 0; i < sorted.length - 1; i++) {
    assert.ok(sorted[i].compositeRisk >= sorted[i + 1].compositeRisk, `sorted[${i}].compositeRisk (${sorted[i].compositeRisk}) < sorted[${i+1}].compositeRisk (${sorted[i+1].compositeRisk})`);
  }
});

test('sortCitiesByRisk: does not mutate original array', () => {
  const results = getMockCityData().map(buildCityResult);
  const original = results.map((r) => r.compositeRisk);
  sortCitiesByRisk(results);
  const after = results.map((r) => r.compositeRisk);
  assert.deepEqual(original, after);
});

// ── filterByTier ───────────────────────────────────────────────────────────

test('filterByTier: low includes all tiers', () => {
  const results = getMockCityData().map(buildCityResult);
  const filtered = filterByTier(results, 'low');
  assert.equal(filtered.length, results.length);
});

test('filterByTier: critical only includes critical tier', () => {
  const results = getMockCityData().map(buildCityResult);
  const filtered = filterByTier(results, 'critical');
  for (const r of filtered) {
    assert.equal(r.tier, 'critical');
  }
});

test('filterByTier: high excludes low, moderate, elevated', () => {
  const results = getMockCityData().map(buildCityResult);
  const filtered = filterByTier(results, 'high');
  for (const r of filtered) {
    assert.ok(['high', 'severe', 'critical'].includes(r.tier), `Unexpected tier: ${r.tier}`);
  }
});

// ── getMockCityData ────────────────────────────────────────────────────────

test('getMockCityData: returns exactly 10 cities', () => {
  const cities = getMockCityData();
  assert.equal(cities.length, 10);
});

test('getMockCityData: all have required properties', () => {
  const cities = getMockCityData();
  for (const city of cities) {
    assert.ok(typeof city.name === 'string' && city.name.length > 0, `city.name missing`);
    assert.ok(typeof city.country === 'string' && city.country.length > 0, `city.country missing`);
    assert.ok(typeof city.protestIntensity === 'number');
    assert.ok(typeof city.riotFrequency === 'number');
    assert.ok(typeof city.gangControlPercent === 'number');
    assert.ok(typeof city.vigilanteActivity === 'number');
    assert.ok(typeof city.govResponseCapacity === 'number');
    assert.ok(typeof city.displacementPressure === 'number');
    assert.ok(typeof city.economicGrievanceIndex === 'number');
    assert.ok(typeof city.lastUpdated === 'string' && city.lastUpdated.length > 0);
  }
});

test('getMockCityData: all numeric fields in 0–100', () => {
  const cities = getMockCityData();
  const numericFields: Array<keyof CityRawData> = [
    'protestIntensity',
    'riotFrequency',
    'gangControlPercent',
    'vigilanteActivity',
    'govResponseCapacity',
    'displacementPressure',
    'economicGrievanceIndex',
  ];
  for (const city of cities) {
    for (const field of numericFields) {
      const val = city[field] as number;
      assert.ok(val >= 0 && val <= 100, `${city.name}.${field} = ${val} is out of 0–100`);
    }
  }
});

test('getMockCityData: includes Caracas', () => {
  const cities = getMockCityData();
  const names = cities.map((c) => c.name);
  assert.ok(names.includes('Caracas'), 'Caracas not found');
});

test('getMockCityData: includes Port-au-Prince', () => {
  const cities = getMockCityData();
  const names = cities.map((c) => c.name);
  assert.ok(names.includes('Port-au-Prince'));
});

// ── buildPanelRenderData ───────────────────────────────────────────────────

test('buildPanelRenderData: returns 10 results', () => {
  const results = buildPanelRenderData(getMockCityData());
  assert.equal(results.length, 10);
});

test('buildPanelRenderData: results sorted descending by compositeRisk', () => {
  const results = buildPanelRenderData(getMockCityData());
  for (let i = 0; i < results.length - 1; i++) {
    assert.ok(
      results[i].compositeRisk >= results[i + 1].compositeRisk,
      `results[${i}].compositeRisk (${results[i].compositeRisk}) < results[${i+1}].compositeRisk (${results[i+1].compositeRisk})`,
    );
  }
});

test('buildPanelRenderData: all results have valid tier', () => {
  const validTiers: InstabilityTier[] = ['critical', 'severe', 'high', 'elevated', 'moderate', 'low'];
  const results = buildPanelRenderData(getMockCityData());
  for (const r of results) {
    assert.ok(validTiers.includes(r.tier), `Invalid tier: ${r.tier}`);
  }
});

test('buildPanelRenderData: all compositeRisk values in 0–100', () => {
  const results = buildPanelRenderData(getMockCityData());
  for (const r of results) {
    assert.ok(r.compositeRisk >= 0 && r.compositeRisk <= 100, `compositeRisk ${r.compositeRisk} out of range`);
  }
});

test('buildPanelRenderData: all have dominantDriver', () => {
  const results = buildPanelRenderData(getMockCityData());
  for (const r of results) {
    assert.ok(typeof r.dominantDriver === 'string' && r.dominantDriver.length > 0);
  }
});
