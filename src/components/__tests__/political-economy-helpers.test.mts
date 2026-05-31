import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getKleptocracyScore,
  getStateCapacityScore,
  getInstitutionalQuality,
  getCronyCaptureIndex,
  getResourceCurseScore,
  getOligarchConcentration,
  getSanctionsEvasionRisk,
  getCountryProfile,
  getAllCountries,
  getRiskTier,
  buildRenderData,
  TRACKED_COUNTRIES,
  type RiskTier,
} from '../political-economy-helpers.js';

// ── getRiskTier ────────────────────────────────────────────────────────────

test('getRiskTier returns critical for >= 85', () => {
  assert.equal(getRiskTier(85), 'critical');
  assert.equal(getRiskTier(100), 'critical');
  assert.equal(getRiskTier(92), 'critical');
});

test('getRiskTier returns high for 70–84', () => {
  assert.equal(getRiskTier(70), 'high');
  assert.equal(getRiskTier(84), 'high');
  assert.equal(getRiskTier(75), 'high');
});

test('getRiskTier returns elevated for 55–69', () => {
  assert.equal(getRiskTier(55), 'elevated');
  assert.equal(getRiskTier(69), 'elevated');
  assert.equal(getRiskTier(62), 'elevated');
});

test('getRiskTier returns moderate for 35–54', () => {
  assert.equal(getRiskTier(35), 'moderate');
  assert.equal(getRiskTier(54), 'moderate');
});

test('getRiskTier returns low for < 35', () => {
  assert.equal(getRiskTier(0), 'low');
  assert.equal(getRiskTier(34), 'low');
});

test('getRiskTier handles boundary 70 exactly as high not elevated', () => {
  assert.equal(getRiskTier(70), 'high');
  assert.equal(getRiskTier(69), 'elevated');
});

test('getRiskTier handles boundary 85 exactly as critical not high', () => {
  assert.equal(getRiskTier(85), 'critical');
  assert.equal(getRiskTier(84), 'high');
});

// ── getKleptocracyScore ────────────────────────────────────────────────────

test('getKleptocracyScore returns a score for Russia', () => {
  const s = getKleptocracyScore('Russia');
  assert.ok(s.overall >= 0 && s.overall <= 100);
  assert.ok(s.assetLooting >= 0);
  assert.ok(s.judicialCapture >= 0);
  assert.ok(typeof s.summary === 'string' && s.summary.length > 0);
});

test('getKleptocracyScore Russia overall is high risk (>= 85)', () => {
  const s = getKleptocracyScore('Russia');
  assert.ok(s.overall >= 85, `Expected >= 85, got ${s.overall}`);
});

test('getKleptocracyScore Venezuela overall is highest tier', () => {
  const s = getKleptocracyScore('Venezuela');
  assert.ok(s.overall >= 90);
});

test('getKleptocracyScore returns fallback for unknown country', () => {
  const s = getKleptocracyScore('Atlantis');
  assert.equal(s.overall, 50);
  assert.equal(s.summary, 'No data available.');
});

test('getKleptocracyScore all sub-scores are 0–100', () => {
  for (const country of TRACKED_COUNTRIES) {
    const s = getKleptocracyScore(country);
    assert.ok(s.assetLooting >= 0 && s.assetLooting <= 100, `${country} assetLooting out of range`);
    assert.ok(s.judicialCapture >= 0 && s.judicialCapture <= 100);
    assert.ok(s.capitalFlight >= 0 && s.capitalFlight <= 100);
    assert.ok(s.mediaSuppression >= 0 && s.mediaSuppression <= 100);
  }
});

// ── getStateCapacityScore ──────────────────────────────────────────────────

test('getStateCapacityScore returns valid data for DRC', () => {
  const s = getStateCapacityScore('DRC');
  assert.ok(s.overall <= 20, `DRC state capacity should be very low, got ${s.overall}`);
});

test('getStateCapacityScore Saudi Arabia has higher capacity than Venezuela', () => {
  const sa = getStateCapacityScore('Saudi Arabia');
  const ve = getStateCapacityScore('Venezuela');
  assert.ok(sa.overall > ve.overall);
});

test('getStateCapacityScore returns fallback for unknown', () => {
  const s = getStateCapacityScore('Narnia');
  assert.equal(s.overall, 50);
});

test('getStateCapacityScore all scores in range', () => {
  for (const country of TRACKED_COUNTRIES) {
    const s = getStateCapacityScore(country);
    assert.ok(s.overall >= 0 && s.overall <= 100);
    assert.ok(s.publicGoodsDelivery >= 0 && s.publicGoodsDelivery <= 100);
    assert.ok(s.fiscalCapacity >= 0 && s.fiscalCapacity <= 100);
  }
});

// ── getInstitutionalQuality ────────────────────────────────────────────────

test('getInstitutionalQuality returns 6 indicators', () => {
  const iq = getInstitutionalQuality('Iran');
  assert.ok(typeof iq.voiceAccountability === 'number');
  assert.ok(typeof iq.politicalStability === 'number');
  assert.ok(typeof iq.governmentEffectiveness === 'number');
  assert.ok(typeof iq.regulatoryQuality === 'number');
  assert.ok(typeof iq.ruleOfLaw === 'number');
  assert.ok(typeof iq.controlOfCorruption === 'number');
});

test('getInstitutionalQuality Venezuela has very low scores', () => {
  const iq = getInstitutionalQuality('Venezuela');
  assert.ok(iq.ruleOfLaw <= 10);
  assert.ok(iq.controlOfCorruption <= 10);
});

test('getInstitutionalQuality returns fallback for unknown', () => {
  const iq = getInstitutionalQuality('Wakanda');
  assert.equal(iq.voiceAccountability, 50);
});

// ── Individual index functions ─────────────────────────────────────────────

test('getCronyCaptureIndex is in 0–100 for all countries', () => {
  for (const country of TRACKED_COUNTRIES) {
    const v = getCronyCaptureIndex(country);
    assert.ok(v >= 0 && v <= 100, `${country}: ${v}`);
  }
});

test('getCronyCaptureIndex Venezuela is highest', () => {
  const ve = getCronyCaptureIndex('Venezuela');
  assert.ok(ve >= 90);
});

test('getCronyCaptureIndex returns 50 for unknown country', () => {
  assert.equal(getCronyCaptureIndex('Eldorado'), 50);
});

test('getResourceCurseScore DRC is very high', () => {
  const v = getResourceCurseScore('DRC');
  assert.ok(v >= 88);
});

test('getResourceCurseScore Hungary is low (no petro-state)', () => {
  const v = getResourceCurseScore('Hungary');
  assert.ok(v <= 10);
});

test('getOligarchConcentration Russia is high', () => {
  assert.ok(getOligarchConcentration('Russia') >= 85);
});

test('getSanctionsEvasionRisk Iran is very high', () => {
  assert.ok(getSanctionsEvasionRisk('Iran') >= 85);
});

test('getSanctionsEvasionRisk returns 50 for unknown', () => {
  assert.equal(getSanctionsEvasionRisk('Nowhere'), 50);
});

// ── getCountryProfile ──────────────────────────────────────────────────────

test('getCountryProfile returns a complete profile for Russia', () => {
  const p = getCountryProfile('Russia');
  assert.equal(p.country, 'Russia');
  assert.equal(p.iso2, 'RU');
  assert.ok(p.overallScore >= 0 && p.overallScore <= 100);
  assert.ok(['critical','high','elevated','moderate','low'].includes(p.tier));
});

test('getCountryProfile tier matches overallScore', () => {
  for (const country of TRACKED_COUNTRIES) {
    const p = getCountryProfile(country);
    const expectedTier = getRiskTier(p.overallScore);
    assert.equal(p.tier, expectedTier, `${country}: tier mismatch`);
  }
});

test('getCountryProfile Venezuela is critical tier', () => {
  const p = getCountryProfile('Venezuela');
  assert.equal(p.tier, 'critical');
});

test('getCountryProfile overall score is a round integer', () => {
  for (const country of TRACKED_COUNTRIES) {
    const p = getCountryProfile(country);
    assert.equal(p.overallScore, Math.round(p.overallScore));
  }
});

// ── getAllCountries ────────────────────────────────────────────────────────

test('getAllCountries returns exactly 15 profiles', () => {
  const profiles = getAllCountries();
  assert.equal(profiles.length, 15);
});

test('getAllCountries includes all tracked countries', () => {
  const profiles = getAllCountries();
  const names = new Set(profiles.map((p) => p.country));
  for (const country of TRACKED_COUNTRIES) {
    assert.ok(names.has(country), `Missing: ${country}`);
  }
});

test('getAllCountries all profiles have valid tier', () => {
  const validTiers: RiskTier[] = ['critical', 'high', 'elevated', 'moderate', 'low'];
  for (const p of getAllCountries()) {
    assert.ok(validTiers.includes(p.tier), `${p.country}: invalid tier ${p.tier}`);
  }
});

test('getAllCountries all iso2 codes are 2 characters', () => {
  for (const p of getAllCountries()) {
    assert.equal(p.iso2.length, 2, `${p.country} iso2 wrong length: ${p.iso2}`);
  }
});

// ── buildRenderData ────────────────────────────────────────────────────────

test('buildRenderData returns 15 profiles', () => {
  const data = buildRenderData();
  assert.equal(data.profiles.length, 15);
});

test('buildRenderData profiles are sorted by overallScore descending', () => {
  const data = buildRenderData();
  for (let i = 1; i < data.profiles.length; i++) {
    assert.ok(
      data.profiles[i - 1]!.overallScore >= data.profiles[i]!.overallScore,
      `Sort violated at index ${i}: ${data.profiles[i-1]!.country}(${data.profiles[i-1]!.overallScore}) < ${data.profiles[i]!.country}(${data.profiles[i]!.overallScore})`,
    );
  }
});

test('buildRenderData criticalCount + highCount equals count of critical+high profiles', () => {
  const data = buildRenderData();
  const expected =
    data.profiles.filter((p) => p.tier === 'critical' || p.tier === 'high').length;
  assert.equal(data.criticalCount + data.highCount, expected);
});

test('buildRenderData criticalCount matches profiles with tier=critical', () => {
  const data = buildRenderData();
  const expected = data.profiles.filter((p) => p.tier === 'critical').length;
  assert.equal(data.criticalCount, expected);
});

test('buildRenderData generatedAt is a recent timestamp', () => {
  const before = Date.now();
  const data = buildRenderData();
  const after = Date.now();
  assert.ok(data.generatedAt >= before && data.generatedAt <= after);
});

test('buildRenderData Venezuela appears before Hungary (higher risk)', () => {
  const data = buildRenderData();
  const veIdx = data.profiles.findIndex((p) => p.country === 'Venezuela');
  const huIdx = data.profiles.findIndex((p) => p.country === 'Hungary');
  assert.ok(veIdx < huIdx, `Venezuela(${veIdx}) should rank higher than Hungary(${huIdx})`);
});

test('buildRenderData Russia appears in top 4', () => {
  const data = buildRenderData();
  const idx = data.profiles.findIndex((p) => p.country === 'Russia');
  assert.ok(idx <= 3, `Russia at index ${idx}, expected in top 4`);
});
