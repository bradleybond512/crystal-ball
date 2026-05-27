import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyCapacityTier,
  scoreGovernanceEffectiveness,
  scoreRuleOfLaw,
  scoreServiceDelivery,
  scoreInstitutionalResilience,
  buildFragilityIndex,
  getCapacityTierColor,
  getCapacityTierLabel,
  buildCountryRenderData,
  buildAllCountriesRenderData,
  getTopFragileStates,
  computeRegionalRisk,
  assessInstabilityTrend,
  formatCapacityScore,
  COUNTRY_DATA,
  type CapacityTier,
  type CountryCapacityData,
} from '../state-capacity-helpers.ts';

// ── Helper fixture ────────────────────────────────────────────────────────

function makeData(overrides: Partial<CountryCapacityData> = {}): CountryCapacityData {
  return {
    countryCode: 'TST',
    countryName: 'Testland',
    region: 'Test Region',
    governmentEffectiveness: 5.0,
    bureaucraticQuality: 5.0,
    ruleOfLaw: 5.0,
    taxCollectionCapacity: 5.0,
    monopolyOnViolence: 5.0,
    serviceDelivery: 5.0,
    institutionalResilience: 5.0,
    ...overrides,
  };
}

// ── classifyCapacityTier ──────────────────────────────────────────────────

test('classifyCapacityTier: score >= 8.0 is collapsed', () => {
  assert.equal(classifyCapacityTier(8.0), 'collapsed');
  assert.equal(classifyCapacityTier(9.5), 'collapsed');
  assert.equal(classifyCapacityTier(10.0), 'collapsed');
});

test('classifyCapacityTier: score >= 6.0 and < 8.0 is fragile', () => {
  assert.equal(classifyCapacityTier(6.0), 'fragile');
  assert.equal(classifyCapacityTier(7.9), 'fragile');
});

test('classifyCapacityTier: score >= 4.0 and < 6.0 is weak', () => {
  assert.equal(classifyCapacityTier(4.0), 'weak');
  assert.equal(classifyCapacityTier(5.9), 'weak');
});

test('classifyCapacityTier: score >= 2.5 and < 4.0 is moderate', () => {
  assert.equal(classifyCapacityTier(2.5), 'moderate');
  assert.equal(classifyCapacityTier(3.9), 'moderate');
});

test('classifyCapacityTier: score < 2.5 is functional', () => {
  assert.equal(classifyCapacityTier(0.0), 'functional');
  assert.equal(classifyCapacityTier(2.4), 'functional');
});

test('classifyCapacityTier: boundary at exactly 8.0 is collapsed', () => {
  assert.equal(classifyCapacityTier(8.0), 'collapsed');
});

test('classifyCapacityTier: boundary at exactly 6.0 is fragile', () => {
  assert.equal(classifyCapacityTier(6.0), 'fragile');
});

// ── scoreGovernanceEffectiveness ──────────────────────────────────────────

test('scoreGovernanceEffectiveness: average of effectivenes and quality', () => {
  const d = makeData({ governmentEffectiveness: 4.0, bureaucraticQuality: 6.0 });
  assert.equal(scoreGovernanceEffectiveness(d), 5.0);
});

test('scoreGovernanceEffectiveness: clamped to 0 minimum', () => {
  const d = makeData({ governmentEffectiveness: -1, bureaucraticQuality: -1 });
  assert.equal(scoreGovernanceEffectiveness(d), 0);
});

test('scoreGovernanceEffectiveness: clamped to 10 maximum', () => {
  const d = makeData({ governmentEffectiveness: 10, bureaucraticQuality: 10 });
  assert.equal(scoreGovernanceEffectiveness(d), 10);
});

// ── scoreRuleOfLaw ────────────────────────────────────────────────────────

test('scoreRuleOfLaw: weighted combination of ruleOfLaw and monopolyOnViolence', () => {
  const d = makeData({ ruleOfLaw: 10.0, monopolyOnViolence: 0.0 });
  assert.equal(scoreRuleOfLaw(d), 6.0);
});

test('scoreRuleOfLaw: clamped to range [0, 10]', () => {
  const d = makeData({ ruleOfLaw: 0, monopolyOnViolence: 0 });
  assert.equal(scoreRuleOfLaw(d), 0);
});

// ── scoreServiceDelivery ──────────────────────────────────────────────────

test('scoreServiceDelivery: weighted combination', () => {
  const d = makeData({ serviceDelivery: 10.0, taxCollectionCapacity: 0.0 });
  assert.equal(scoreServiceDelivery(d), 7.0);
});

test('scoreServiceDelivery: all 5 gives 5', () => {
  const d = makeData({ serviceDelivery: 5.0, taxCollectionCapacity: 5.0 });
  assert.equal(scoreServiceDelivery(d), 5.0);
});

// ── scoreInstitutionalResilience ──────────────────────────────────────────

test('scoreInstitutionalResilience: returns clamped institutionalResilience', () => {
  assert.equal(scoreInstitutionalResilience(makeData({ institutionalResilience: 7.5 })), 7.5);
  assert.equal(scoreInstitutionalResilience(makeData({ institutionalResilience: 15 })), 10);
  assert.equal(scoreInstitutionalResilience(makeData({ institutionalResilience: -1 })), 0);
});

// ── buildFragilityIndex ───────────────────────────────────────────────────

test('buildFragilityIndex: perfect governance gives near-zero fragility', () => {
  const d = makeData({
    governmentEffectiveness: 10,
    bureaucraticQuality: 10,
    ruleOfLaw: 10,
    taxCollectionCapacity: 10,
    monopolyOnViolence: 10,
    serviceDelivery: 10,
    institutionalResilience: 10,
  });
  assert.equal(buildFragilityIndex(d), 0);
});

test('buildFragilityIndex: zero governance gives near-maximum fragility', () => {
  const d = makeData({
    governmentEffectiveness: 0,
    bureaucraticQuality: 0,
    ruleOfLaw: 0,
    taxCollectionCapacity: 0,
    monopolyOnViolence: 0,
    serviceDelivery: 0,
    institutionalResilience: 0,
  });
  assert.equal(buildFragilityIndex(d), 10);
});

test('buildFragilityIndex: returns value in range [0, 10]', () => {
  for (const code of COUNTRY_DATA.keys()) {
    const data = COUNTRY_DATA.get(code)!;
    const idx = buildFragilityIndex(data);
    assert.ok(idx >= 0 && idx <= 10, `${code}: fragility ${idx} out of range`);
  }
});

test('buildFragilityIndex: mid-range inputs produce mid-range fragility', () => {
  const d = makeData(); // all 5.0
  const idx = buildFragilityIndex(d);
  assert.ok(idx > 3 && idx < 7, `expected mid-range, got ${idx}`);
});

// ── getCapacityTierColor ──────────────────────────────────────────────────

test('getCapacityTierColor: covers all five tiers', () => {
  const tiers: CapacityTier[] = ['collapsed', 'fragile', 'weak', 'moderate', 'functional'];
  for (const t of tiers) {
    const c = getCapacityTierColor(t);
    assert.ok(c.startsWith('#'), `${t}: expected hex color, got ${c}`);
  }
});

test('getCapacityTierColor: collapsed is red', () => {
  assert.match(getCapacityTierColor('collapsed'), /ef4444/);
});

test('getCapacityTierColor: functional is green', () => {
  assert.match(getCapacityTierColor('functional'), /22c55e/);
});

// ── getCapacityTierLabel ──────────────────────────────────────────────────

test('getCapacityTierLabel: returns human-readable string for all tiers', () => {
  assert.equal(getCapacityTierLabel('collapsed'), 'Collapsed');
  assert.equal(getCapacityTierLabel('fragile'), 'Fragile');
  assert.equal(getCapacityTierLabel('weak'), 'Weak');
  assert.equal(getCapacityTierLabel('moderate'), 'Moderate');
  assert.equal(getCapacityTierLabel('functional'), 'Functional');
});

// ── buildCountryRenderData ────────────────────────────────────────────────

test('buildCountryRenderData: returns null for unknown code', () => {
  assert.equal(buildCountryRenderData('ZZZ'), null);
});

test('buildCountryRenderData: returns null for empty string', () => {
  assert.equal(buildCountryRenderData(''), null);
});

test('buildCountryRenderData: SYR returns a valid render object', () => {
  const rd = buildCountryRenderData('SYR');
  assert.ok(rd !== null);
  assert.equal(rd!.countryCode, 'SYR');
  assert.equal(rd!.countryName, 'Syria');
  assert.ok(rd!.fragility >= 0 && rd!.fragility <= 10);
  assert.ok(rd!.tierLabel.length > 0);
  assert.ok(rd!.tierColor.startsWith('#'));
  assert.match(rd!.formattedFragility, /\d+\.\d\/10/);
});

test('buildCountryRenderData: formattedFragility matches formatCapacityScore', () => {
  const rd = buildCountryRenderData('IRQ')!;
  assert.equal(rd.formattedFragility, formatCapacityScore(rd.fragility));
});

test('buildCountryRenderData: tier consistent with fragility score', () => {
  for (const code of COUNTRY_DATA.keys()) {
    const rd = buildCountryRenderData(code)!;
    if (rd.fragility >= 8.0) assert.equal(rd.tier, 'collapsed', `${code} should be collapsed`);
    else if (rd.fragility >= 6.0) assert.equal(rd.tier, 'fragile', `${code} should be fragile`);
    else if (rd.fragility >= 4.0) assert.equal(rd.tier, 'weak', `${code} should be weak`);
  }
});

// ── buildAllCountriesRenderData ───────────────────────────────────────────

test('buildAllCountriesRenderData: returns 15 entries', () => {
  const all = buildAllCountriesRenderData();
  assert.equal(all.length, 15);
});

test('buildAllCountriesRenderData: sorted by fragility descending', () => {
  const all = buildAllCountriesRenderData();
  for (let i = 1; i < all.length; i++) {
    assert.ok(
      all[i - 1]!.fragility >= all[i]!.fragility,
      `Row ${i - 1} fragility ${all[i - 1]!.fragility} should be >= ${all[i]!.fragility}`,
    );
  }
});

test('buildAllCountriesRenderData: every country has a non-empty region', () => {
  for (const rd of buildAllCountriesRenderData()) {
    assert.ok(rd.region.length > 0, `${rd.countryCode}: missing region`);
  }
});

// ── getTopFragileStates ───────────────────────────────────────────────────

test('getTopFragileStates(3): returns exactly 3 countries', () => {
  assert.equal(getTopFragileStates(3).length, 3);
});

test('getTopFragileStates(1): returns the single most fragile country', () => {
  const top1 = getTopFragileStates(1);
  const all = buildAllCountriesRenderData();
  assert.equal(top1[0]!.countryCode, all[0]!.countryCode);
});

test('getTopFragileStates(0): returns empty array', () => {
  assert.equal(getTopFragileStates(0).length, 0);
});

test('getTopFragileStates(20): returns at most 15', () => {
  assert.equal(getTopFragileStates(20).length, 15);
});

// ── computeRegionalRisk ───────────────────────────────────────────────────

test('computeRegionalRisk: unknown region returns zero summary', () => {
  const r = computeRegionalRisk('Atlantis');
  assert.equal(r.countryCount, 0);
  assert.equal(r.averageFragility, 0);
  assert.equal(r.dominantTier, 'functional');
});

test('computeRegionalRisk: Sub-Saharan Africa has multiple countries', () => {
  const r = computeRegionalRisk('Sub-Saharan Africa');
  assert.ok(r.countryCount >= 5, `expected >= 5 SSA countries, got ${r.countryCount}`);
  assert.ok(r.averageFragility > 0);
});

test('computeRegionalRisk: averageFragility is within [0,10]', () => {
  for (const region of ['Middle East', 'Sub-Saharan Africa', 'Latin America', 'South Asia']) {
    const r = computeRegionalRisk(region);
    if (r.countryCount > 0) {
      assert.ok(r.averageFragility >= 0 && r.averageFragility <= 10,
        `${region}: avg fragility ${r.averageFragility} out of range`);
    }
  }
});

test('computeRegionalRisk: collapsedCount + fragileCount + weakCount <= countryCount', () => {
  const r = computeRegionalRisk('Sub-Saharan Africa');
  assert.ok(r.collapsedCount + r.fragileCount + r.weakCount <= r.countryCount);
});

// ── assessInstabilityTrend ────────────────────────────────────────────────

test('assessInstabilityTrend: high monopoly vs low rule-of-law is deteriorating', () => {
  const d = makeData({ monopolyOnViolence: 8.0, ruleOfLaw: 1.0, institutionalResilience: 1.0 });
  assert.equal(assessInstabilityTrend(d), 'deteriorating');
});

test('assessInstabilityTrend: low monopoly vs high rule-of-law is improving', () => {
  const d = makeData({ monopolyOnViolence: 1.0, ruleOfLaw: 8.0, institutionalResilience: 8.0 });
  assert.equal(assessInstabilityTrend(d), 'improving');
});

test('assessInstabilityTrend: balanced inputs return stable', () => {
  const d = makeData({ monopolyOnViolence: 5.0, ruleOfLaw: 5.0, institutionalResilience: 5.0 });
  assert.equal(assessInstabilityTrend(d), 'stable');
});

// ── formatCapacityScore ───────────────────────────────────────────────────

test('formatCapacityScore: formats zero correctly', () => {
  assert.equal(formatCapacityScore(0), '0.0/10');
});

test('formatCapacityScore: formats 10 correctly', () => {
  assert.equal(formatCapacityScore(10), '10.0/10');
});

test('formatCapacityScore: rounds to 1 decimal place', () => {
  assert.equal(formatCapacityScore(7.333), '7.3/10');
  assert.equal(formatCapacityScore(3.666), '3.7/10');
});

// ── COUNTRY_DATA integrity ────────────────────────────────────────────────

test('COUNTRY_DATA: has exactly 15 entries', () => {
  assert.equal(COUNTRY_DATA.size, 15);
});

test('COUNTRY_DATA: all scores are in [0, 10]', () => {
  const keys: (keyof CountryCapacityData)[] = [
    'governmentEffectiveness', 'bureaucraticQuality', 'ruleOfLaw',
    'taxCollectionCapacity', 'monopolyOnViolence', 'serviceDelivery',
    'institutionalResilience',
  ];
  for (const [code, d] of COUNTRY_DATA) {
    for (const k of keys) {
      const v = d[k] as number;
      assert.ok(v >= 0 && v <= 10, `${code}.${k} = ${v} out of [0,10]`);
    }
  }
});

test('COUNTRY_DATA: all entries have non-empty countryName and region', () => {
  for (const [code, d] of COUNTRY_DATA) {
    assert.ok(d.countryName.length > 0, `${code}: missing countryName`);
    assert.ok(d.region.length > 0, `${code}: missing region`);
  }
});

test('COUNTRY_DATA: SYR and YEM are among the most fragile', () => {
  const top5 = getTopFragileStates(5).map((r) => r.countryCode);
  assert.ok(top5.includes('SYR') || top5.includes('YEM'), `Expected SYR or YEM in top 5, got: ${top5.join(',')}`);
});
