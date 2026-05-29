import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeGlobalPreparednessIndex,
  getByReadiness,
  getCriticalGapCountries,
  getActiveOutbreaks,
  getPandemicPotential,
  computeAvgGhsi,
  rankByReadiness,
  readinessClass,
  severityClass,
  buildRenderData,
  type CountryReadiness,
  type ActiveOutbreak,
  type ReadinessLevel,
  type OutbreakSeverity,
} from '../pandemic-preparedness-helpers.ts';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mkCountry = (overrides: Partial<CountryReadiness> = {}): CountryReadiness => ({
  id: 'TEST',
  country: 'Testland',
  ghsiScore: 50,
  ihrScore: 55,
  readinessLevel: 'Adequate',
  detectionCapacity: 5,
  responseCapacity: 5,
  laboratoryCapacity: 5,
  healthSystemStrength: 5,
  keyGap: 'test gap',
  population: 100,
  ...overrides,
});

const mkOutbreak = (overrides: Partial<ActiveOutbreak> = {}): ActiveOutbreak => ({
  id: 'O_TEST',
  pathogen: 'TestVirus',
  pathogenClass: 'Respiratory',
  country: 'Testland',
  region: 'Test Region',
  severity: 'Watch',
  startDate: '2024-01',
  caseCount: 10,
  deathCount: 1,
  cfr: 10,
  humanTransmission: false,
  internationalRisk: 'Low',
  description: 'Test description',
  whoStatus: 'WHO monitoring',
  ...overrides,
});

// ─── computeGlobalPreparednessIndex ──────────────────────────────────────────

test('computeGlobalPreparednessIndex: empty array returns 0', () => {
  assert.strictEqual(computeGlobalPreparednessIndex([]), 0);
});

test('computeGlobalPreparednessIndex: single country returns its ghsiScore', () => {
  const c = mkCountry({ ghsiScore: 60, population: 100 });
  assert.strictEqual(computeGlobalPreparednessIndex([c]), 60);
});

test('computeGlobalPreparednessIndex: population-weighted average', () => {
  const a = mkCountry({ ghsiScore: 80, population: 300 }); // contrib 24000
  const b = mkCountry({ ghsiScore: 20, population: 100 }); // contrib 2000
  // wavg = 26000/400 = 65
  assert.strictEqual(computeGlobalPreparednessIndex([a, b]), 65);
});

test('computeGlobalPreparednessIndex: rounds correctly', () => {
  const a = mkCountry({ ghsiScore: 73, population: 335 }); // 24455
  const b = mkCountry({ ghsiScore: 42, population: 1440 }); // 60480
  // total = 84935 / 1775 = 47.85... → rounds to 48
  assert.strictEqual(computeGlobalPreparednessIndex([a, b]), 48);
});

test('computeGlobalPreparednessIndex: all same score = that score', () => {
  const countries = [
    mkCountry({ ghsiScore: 55, population: 200 }),
    mkCountry({ ghsiScore: 55, population: 300 }),
    mkCountry({ ghsiScore: 55, population: 500 }),
  ];
  assert.strictEqual(computeGlobalPreparednessIndex(countries), 55);
});

// ─── getByReadiness ───────────────────────────────────────────────────────────

test('getByReadiness: returns only Strong countries', () => {
  const countries = [
    mkCountry({ readinessLevel: 'Strong' }),
    mkCountry({ readinessLevel: 'Adequate' }),
    mkCountry({ readinessLevel: 'Weak' }),
  ];
  const result = getByReadiness(countries, 'Strong');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0]!.readinessLevel, 'Strong');
});

test('getByReadiness: returns only Adequate countries', () => {
  const countries = [
    mkCountry({ readinessLevel: 'Strong' }),
    mkCountry({ readinessLevel: 'Adequate' }),
    mkCountry({ readinessLevel: 'Adequate' }),
  ];
  assert.strictEqual(getByReadiness(countries, 'Adequate').length, 2);
});

test('getByReadiness: returns only Weak countries', () => {
  const countries = [mkCountry({ readinessLevel: 'Weak' }), mkCountry({ readinessLevel: 'Strong' })];
  const result = getByReadiness(countries, 'Weak');
  assert.strictEqual(result.length, 1);
});

test('getByReadiness: returns Critical Gap countries', () => {
  const countries = [
    mkCountry({ readinessLevel: 'Critical Gap' }),
    mkCountry({ readinessLevel: 'Critical Gap' }),
    mkCountry({ readinessLevel: 'Adequate' }),
  ];
  assert.strictEqual(getByReadiness(countries, 'Critical Gap').length, 2);
});

test('getByReadiness: empty array returns empty', () => {
  assert.deepStrictEqual(getByReadiness([], 'Strong'), []);
});

test('getByReadiness: no match returns empty', () => {
  const countries = [mkCountry({ readinessLevel: 'Weak' })];
  assert.deepStrictEqual(getByReadiness(countries, 'Strong'), []);
});

// ─── getCriticalGapCountries ──────────────────────────────────────────────────

test('getCriticalGapCountries: includes Critical Gap', () => {
  const c = mkCountry({ readinessLevel: 'Critical Gap' });
  assert.ok(getCriticalGapCountries([c]).length > 0);
});

test('getCriticalGapCountries: includes Weak', () => {
  const c = mkCountry({ readinessLevel: 'Weak' });
  assert.ok(getCriticalGapCountries([c]).length > 0);
});

test('getCriticalGapCountries: excludes Strong', () => {
  const c = mkCountry({ readinessLevel: 'Strong' });
  assert.strictEqual(getCriticalGapCountries([c]).length, 0);
});

test('getCriticalGapCountries: excludes Adequate', () => {
  const c = mkCountry({ readinessLevel: 'Adequate' });
  assert.strictEqual(getCriticalGapCountries([c]).length, 0);
});

test('getCriticalGapCountries: mixed bag correct count', () => {
  const countries = [
    mkCountry({ readinessLevel: 'Critical Gap' }),
    mkCountry({ readinessLevel: 'Weak' }),
    mkCountry({ readinessLevel: 'Adequate' }),
    mkCountry({ readinessLevel: 'Strong' }),
  ];
  assert.strictEqual(getCriticalGapCountries(countries).length, 2);
});

// ─── getActiveOutbreaks ───────────────────────────────────────────────────────

test('getActiveOutbreaks: Watch without humanTransmission is excluded', () => {
  const o = mkOutbreak({ severity: 'Watch', humanTransmission: false });
  assert.strictEqual(getActiveOutbreaks([o]).length, 0);
});

test('getActiveOutbreaks: Watch WITH humanTransmission is included', () => {
  const o = mkOutbreak({ severity: 'Watch', humanTransmission: true });
  assert.strictEqual(getActiveOutbreaks([o]).length, 1);
});

test('getActiveOutbreaks: Alert is included', () => {
  const o = mkOutbreak({ severity: 'Alert', humanTransmission: false });
  assert.strictEqual(getActiveOutbreaks([o]).length, 1);
});

test('getActiveOutbreaks: Outbreak is included', () => {
  const o = mkOutbreak({ severity: 'Outbreak' });
  assert.strictEqual(getActiveOutbreaks([o]).length, 1);
});

test('getActiveOutbreaks: Epidemic is included', () => {
  const o = mkOutbreak({ severity: 'Epidemic' });
  assert.strictEqual(getActiveOutbreaks([o]).length, 1);
});

test('getActiveOutbreaks: Pandemic Potential is included', () => {
  const o = mkOutbreak({ severity: 'Pandemic Potential' });
  assert.strictEqual(getActiveOutbreaks([o]).length, 1);
});

test('getActiveOutbreaks: empty array returns empty', () => {
  assert.deepStrictEqual(getActiveOutbreaks([]), []);
});

// ─── getPandemicPotential ─────────────────────────────────────────────────────

test('getPandemicPotential: Pandemic Potential severity included', () => {
  const o = mkOutbreak({ severity: 'Pandemic Potential', internationalRisk: 'Low' });
  assert.strictEqual(getPandemicPotential([o]).length, 1);
});

test('getPandemicPotential: Very High risk included regardless of severity', () => {
  const o = mkOutbreak({ severity: 'Watch', internationalRisk: 'Very High' });
  assert.strictEqual(getPandemicPotential([o]).length, 1);
});

test('getPandemicPotential: Alert with Moderate risk excluded', () => {
  const o = mkOutbreak({ severity: 'Alert', internationalRisk: 'Moderate' });
  assert.strictEqual(getPandemicPotential([o]).length, 0);
});

test('getPandemicPotential: Watch with Low risk excluded', () => {
  const o = mkOutbreak({ severity: 'Watch', internationalRisk: 'Low' });
  assert.strictEqual(getPandemicPotential([o]).length, 0);
});

test('getPandemicPotential: empty array returns empty', () => {
  assert.deepStrictEqual(getPandemicPotential([]), []);
});

// ─── computeAvgGhsi ───────────────────────────────────────────────────────────

test('computeAvgGhsi: empty array returns 0', () => {
  assert.strictEqual(computeAvgGhsi([]), 0);
});

test('computeAvgGhsi: single country returns its score', () => {
  assert.strictEqual(computeAvgGhsi([mkCountry({ ghsiScore: 72 })]), 72);
});

test('computeAvgGhsi: two countries average', () => {
  const a = mkCountry({ ghsiScore: 60 });
  const b = mkCountry({ ghsiScore: 40 });
  assert.strictEqual(computeAvgGhsi([a, b]), 50);
});

test('computeAvgGhsi: rounds correctly', () => {
  const a = mkCountry({ ghsiScore: 50 });
  const b = mkCountry({ ghsiScore: 51 });
  const c = mkCountry({ ghsiScore: 52 });
  // avg = 153/3 = 51
  assert.strictEqual(computeAvgGhsi([a, b, c]), 51);
});

// ─── rankByReadiness ──────────────────────────────────────────────────────────

test('rankByReadiness: ascending GHSI order', () => {
  const countries = [
    mkCountry({ ghsiScore: 80 }),
    mkCountry({ ghsiScore: 30 }),
    mkCountry({ ghsiScore: 55 }),
  ];
  const result = rankByReadiness(countries);
  assert.strictEqual(result[0]!.ghsiScore, 30);
  assert.strictEqual(result[1]!.ghsiScore, 55);
  assert.strictEqual(result[2]!.ghsiScore, 80);
});

test('rankByReadiness: does not mutate input array', () => {
  const countries = [
    mkCountry({ ghsiScore: 80 }),
    mkCountry({ ghsiScore: 30 }),
  ];
  const original = [...countries];
  rankByReadiness(countries);
  assert.strictEqual(countries[0]!.ghsiScore, original[0]!.ghsiScore);
});

test('rankByReadiness: single element returns single', () => {
  const c = mkCountry({ ghsiScore: 42 });
  const result = rankByReadiness([c]);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0]!.ghsiScore, 42);
});

test('rankByReadiness: empty array returns empty', () => {
  assert.deepStrictEqual(rankByReadiness([]), []);
});

// ─── readinessClass ───────────────────────────────────────────────────────────

test('readinessClass: Strong => read-strong', () => {
  assert.strictEqual(readinessClass('Strong'), 'read-strong');
});

test('readinessClass: Adequate => read-adequate', () => {
  assert.strictEqual(readinessClass('Adequate'), 'read-adequate');
});

test('readinessClass: Weak => read-weak', () => {
  assert.strictEqual(readinessClass('Weak'), 'read-weak');
});

test('readinessClass: Critical Gap => read-critical', () => {
  assert.strictEqual(readinessClass('Critical Gap'), 'read-critical');
});

// ─── severityClass ────────────────────────────────────────────────────────────

test('severityClass: Watch => sev-watch', () => {
  assert.strictEqual(severityClass('Watch'), 'sev-watch');
});

test('severityClass: Alert => sev-alert', () => {
  assert.strictEqual(severityClass('Alert'), 'sev-alert');
});

test('severityClass: Outbreak => sev-outbreak', () => {
  assert.strictEqual(severityClass('Outbreak'), 'sev-outbreak');
});

test('severityClass: Epidemic => sev-epidemic', () => {
  assert.strictEqual(severityClass('Epidemic'), 'sev-epidemic');
});

test('severityClass: Pandemic Potential => sev-pandemic', () => {
  assert.strictEqual(severityClass('Pandemic Potential'), 'sev-pandemic');
});

// ─── buildRenderData ──────────────────────────────────────────────────────────

test('buildRenderData: returns object without throwing', () => {
  const d = buildRenderData();
  assert.ok(d !== null && typeof d === 'object');
});

test('buildRenderData: countries array non-empty', () => {
  assert.ok(buildRenderData().countries.length > 0);
});

test('buildRenderData: outbreaks array non-empty', () => {
  assert.ok(buildRenderData().outbreaks.length > 0);
});

test('buildRenderData: globalPreparednessIndex is positive number', () => {
  const gpi = buildRenderData().globalPreparednessIndex;
  assert.ok(typeof gpi === 'number' && gpi > 0);
});

test('buildRenderData: globalPreparednessIndex within 0-100', () => {
  const gpi = buildRenderData().globalPreparednessIndex;
  assert.ok(gpi >= 0 && gpi <= 100);
});

test('buildRenderData: criticalGapCount matches getCriticalGapCountries length', () => {
  const { countries, criticalGapCount } = buildRenderData();
  assert.strictEqual(criticalGapCount, getCriticalGapCountries(countries).length);
});

test('buildRenderData: activeOutbreakCount matches getActiveOutbreaks length', () => {
  const { outbreaks, activeOutbreakCount } = buildRenderData();
  assert.strictEqual(activeOutbreakCount, getActiveOutbreaks(outbreaks).length);
});

test('buildRenderData: pandemicPotentialCount matches getPandemicPotential length', () => {
  const { outbreaks, pandemicPotentialCount } = buildRenderData();
  assert.strictEqual(pandemicPotentialCount, getPandemicPotential(outbreaks).length);
});

test('buildRenderData: avgGhsiScore matches computeAvgGhsi', () => {
  const { countries, avgGhsiScore } = buildRenderData();
  assert.strictEqual(avgGhsiScore, computeAvgGhsi(countries));
});

test('buildRenderData: all countries have valid readinessLevel', () => {
  const levels: ReadinessLevel[] = ['Strong', 'Adequate', 'Weak', 'Critical Gap'];
  for (const c of buildRenderData().countries) {
    assert.ok(levels.includes(c.readinessLevel), `Unexpected level: ${c.readinessLevel}`);
  }
});

test('buildRenderData: all countries have GHSI in 0-100', () => {
  for (const c of buildRenderData().countries) {
    assert.ok(c.ghsiScore >= 0 && c.ghsiScore <= 100, `GHSI out of range for ${c.country}: ${c.ghsiScore}`);
  }
});

test('buildRenderData: all outbreaks have valid severity', () => {
  const severities: OutbreakSeverity[] = ['Watch', 'Alert', 'Outbreak', 'Epidemic', 'Pandemic Potential'];
  for (const o of buildRenderData().outbreaks) {
    assert.ok(severities.includes(o.severity), `Unexpected severity: ${o.severity}`);
  }
});

test('buildRenderData: all countries have positive population', () => {
  for (const c of buildRenderData().countries) {
    assert.ok(c.population > 0, `Non-positive population for ${c.country}`);
  }
});

test('buildRenderData: 12 countries in dataset', () => {
  assert.strictEqual(buildRenderData().countries.length, 12);
});

test('buildRenderData: 8 outbreaks in dataset', () => {
  assert.strictEqual(buildRenderData().outbreaks.length, 8);
});
