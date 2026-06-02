import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONFLICT_ECONOMY_PROFILES,
  revenueClass,
  revenueClassLabel,
  revenueClassColor,
  resourceTypeLabel,
  resourceTypeClass,
  formatRevenueBillions,
  getByResourceType,
  getHighRevenue,
  getByRegion,
  computeGlobalConflictEconomyIndex,
  buildRenderData,
  type ResourceType,
  type RevenueClass,
  type ConflictRegion,
  type ConflictEconomyProfile,
} from '../warlord-economics-helpers.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<ConflictEconomyProfile> = {}): ConflictEconomyProfile {
  return {
    id: 'test-profile',
    name: 'Test — Resources',
    country: 'Test Country',
    region: 'Middle East',
    controllingActor: 'Test Actor',
    externalBackers: [],
    primaryRevenueSources: ['taxation'],
    annualRevenueMinBillions: 0.1,
    annualRevenueMaxBillions: 0.3,
    annualRevenueMidBillions: 0.2,
    keyNote: 'Test note.',
    ...overrides,
  };
}

// ── CONFLICT_ECONOMY_PROFILES catalogue ───────────────────────────────────

test('CONFLICT_ECONOMY_PROFILES: has exactly 10 profiles', () => {
  assert.equal(CONFLICT_ECONOMY_PROFILES.length, 10);
});

test('CONFLICT_ECONOMY_PROFILES: all ids are unique', () => {
  const ids = CONFLICT_ECONOMY_PROFILES.map((p) => p.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, 'Duplicate profile ids found');
});

test('CONFLICT_ECONOMY_PROFILES: all profiles have non-empty name', () => {
  for (const p of CONFLICT_ECONOMY_PROFILES) {
    assert.ok(p.name.length > 0, `Profile ${p.id} has empty name`);
  }
});

test('CONFLICT_ECONOMY_PROFILES: all annualRevenueMidBillions > 0', () => {
  for (const p of CONFLICT_ECONOMY_PROFILES) {
    assert.ok(p.annualRevenueMidBillions > 0, `Profile ${p.id} has non-positive mid revenue`);
  }
});

test('CONFLICT_ECONOMY_PROFILES: mid is within min-max range', () => {
  for (const p of CONFLICT_ECONOMY_PROFILES) {
    assert.ok(
      p.annualRevenueMidBillions >= p.annualRevenueMinBillions &&
      p.annualRevenueMidBillions <= p.annualRevenueMaxBillions,
      `Profile ${p.id}: mid ${p.annualRevenueMidBillions} not in [${p.annualRevenueMinBillions}, ${p.annualRevenueMaxBillions}]`,
    );
  }
});

test('CONFLICT_ECONOMY_PROFILES: all profiles have at least one revenue source', () => {
  for (const p of CONFLICT_ECONOMY_PROFILES) {
    assert.ok(p.primaryRevenueSources.length > 0, `Profile ${p.id} has no revenue sources`);
  }
});

test('CONFLICT_ECONOMY_PROFILES: includes DRC minerals profile', () => {
  const found = CONFLICT_ECONOMY_PROFILES.find((p) => p.id === 'drc-minerals');
  assert.ok(found != null, 'drc-minerals profile missing');
});

test('CONFLICT_ECONOMY_PROFILES: includes Afghanistan narcotics profile', () => {
  const found = CONFLICT_ECONOMY_PROFILES.find((p) => p.id === 'afghanistan-narcotics');
  assert.ok(found != null);
});

test('CONFLICT_ECONOMY_PROFILES: includes Sudan RSF gold profile', () => {
  const found = CONFLICT_ECONOMY_PROFILES.find((p) => p.id === 'sudan-rsf-gold');
  assert.ok(found != null);
});

test('CONFLICT_ECONOMY_PROFILES: includes Haiti gangs profile', () => {
  const found = CONFLICT_ECONOMY_PROFILES.find((p) => p.id === 'haiti-gangs');
  assert.ok(found != null);
});

test('CONFLICT_ECONOMY_PROFILES: Myanmar mid revenue is 2.0B', () => {
  const myanmar = CONFLICT_ECONOMY_PROFILES.find((p) => p.id === 'myanmar-uwsa');
  assert.ok(myanmar != null);
  assert.equal(myanmar.annualRevenueMidBillions, 2.0);
});

// ── revenueClass ─────────────────────────────────────────────────────────

test('revenueClass: 0 -> micro', () => {
  assert.equal(revenueClass(0), 'micro');
});

test('revenueClass: 0.049 -> micro', () => {
  assert.equal(revenueClass(0.049), 'micro');
});

test('revenueClass: 0.05 -> minor', () => {
  assert.equal(revenueClass(0.05), 'minor');
});

test('revenueClass: 0.075 -> minor (Somalia mid)', () => {
  assert.equal(revenueClass(0.075), 'minor');
});

test('revenueClass: 0.199 -> minor', () => {
  assert.equal(revenueClass(0.199), 'minor');
});

test('revenueClass: 0.2 -> moderate', () => {
  assert.equal(revenueClass(0.2), 'moderate');
});

test('revenueClass: 0.35 -> moderate (Yemen mid)', () => {
  assert.equal(revenueClass(0.35), 'moderate');
});

test('revenueClass: 0.499 -> moderate', () => {
  assert.equal(revenueClass(0.499), 'moderate');
});

test('revenueClass: 0.5 -> major', () => {
  assert.equal(revenueClass(0.5), 'major');
});

test('revenueClass: 0.8 -> major', () => {
  assert.equal(revenueClass(0.8), 'major');
});

test('revenueClass: 0.999 -> major', () => {
  assert.equal(revenueClass(0.999), 'major');
});

test('revenueClass: 1.0 -> mega', () => {
  assert.equal(revenueClass(1.0), 'mega');
});

test('revenueClass: 1.5 -> mega (Afghanistan mid)', () => {
  assert.equal(revenueClass(1.5), 'mega');
});

test('revenueClass: 2.0 -> mega (Myanmar mid)', () => {
  assert.equal(revenueClass(2.0), 'mega');
});

// ── revenueClassLabel ────────────────────────────────────────────────────

test('revenueClassLabel: all 5 bands return non-empty strings', () => {
  const bands: RevenueClass[] = ['micro', 'minor', 'moderate', 'major', 'mega'];
  for (const b of bands) {
    const label = revenueClassLabel(b);
    assert.ok(typeof label === 'string' && label.length > 0, `revenueClassLabel(${b}) empty`);
  }
});

test('revenueClassLabel: mega contains >$1B', () => {
  assert.ok(revenueClassLabel('mega').includes('1B') || revenueClassLabel('mega').includes('>'));
});

// ── revenueClassColor ────────────────────────────────────────────────────

test('revenueClassColor: all 5 bands return non-empty strings', () => {
  const bands: RevenueClass[] = ['micro', 'minor', 'moderate', 'major', 'mega'];
  for (const b of bands) {
    const color = revenueClassColor(b);
    assert.ok(typeof color === 'string' && color.length > 0);
  }
});

test('revenueClassColor: mega color differs from micro color', () => {
  assert.notEqual(revenueClassColor('mega'), revenueClassColor('micro'));
});

// ── resourceTypeLabel ────────────────────────────────────────────────────

test('resourceTypeLabel: minerals -> Minerals', () => {
  assert.equal(resourceTypeLabel('minerals'), 'Minerals');
});

test('resourceTypeLabel: gold -> Gold', () => {
  assert.equal(resourceTypeLabel('gold'), 'Gold');
});

test('resourceTypeLabel: port-fees -> Port Fees', () => {
  assert.equal(resourceTypeLabel('port-fees'), 'Port Fees');
});

test('resourceTypeLabel: kidnapping -> Kidnapping / Ransom', () => {
  assert.ok(resourceTypeLabel('kidnapping').includes('Kidnapping'));
});

// ── resourceTypeClass ────────────────────────────────────────────────────

test('resourceTypeClass: all known types return a non-empty CSS class', () => {
  const types: ResourceType[] = ['minerals', 'gold', 'narcotics', 'cocaine', 'jade', 'oil', 'timber', 'taxation', 'kidnapping', 'port-fees'];
  for (const t of types) {
    const cls = resourceTypeClass(t);
    assert.ok(typeof cls === 'string' && cls.length > 0, `resourceTypeClass(${t}) empty`);
  }
});

test('resourceTypeClass: port-fees has valid CSS class', () => {
  assert.ok(resourceTypeClass('port-fees').startsWith('wep-'));
});

// ── formatRevenueBillions ────────────────────────────────────────────────

test('formatRevenueBillions: sub-100M displays as M', () => {
  const result = formatRevenueBillions(0.075, 0.05, 0.1);
  assert.ok(result.includes('M'), 'Expected M in result: ' + result);
});

test('formatRevenueBillions: 1.2B displays as B', () => {
  const result = formatRevenueBillions(1.2, 0.9, 1.5);
  assert.ok(result.includes('B'), 'Expected B in result: ' + result);
});

test('formatRevenueBillions: includes est range', () => {
  const result = formatRevenueBillions(0.35, 0.2, 0.5);
  assert.ok(result.includes('est'), 'Expected "est" in result: ' + result);
});

// ── getByResourceType ────────────────────────────────────────────────────

test('getByResourceType: gold returns DRC and Sudan', () => {
  const results = getByResourceType(CONFLICT_ECONOMY_PROFILES, 'gold');
  const ids = results.map((p) => p.id);
  assert.ok(ids.includes('drc-minerals'), 'DRC missing');
  assert.ok(ids.includes('sudan-rsf-gold'), 'Sudan missing');
});

test('getByResourceType: narcotics returns Afghanistan and Colombia', () => {
  const results = getByResourceType(CONFLICT_ECONOMY_PROFILES, 'narcotics');
  const ids = results.map((p) => p.id);
  assert.ok(ids.includes('afghanistan-narcotics'));
  assert.ok(ids.includes('colombia-armed-groups'));
});

test('getByResourceType: jade returns Myanmar', () => {
  const results = getByResourceType(CONFLICT_ECONOMY_PROFILES, 'jade');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'myanmar-uwsa');
});

test('getByResourceType: port-fees returns Yemen and Haiti', () => {
  const results = getByResourceType(CONFLICT_ECONOMY_PROFILES, 'port-fees');
  const ids = results.map((p) => p.id);
  assert.ok(ids.includes('yemen-houthi'));
  assert.ok(ids.includes('haiti-gangs'));
});

test('getByResourceType: unknown type returns empty array', () => {
  const results = getByResourceType(CONFLICT_ECONOMY_PROFILES, 'cocaine');
  // cocaine appears in Colombia
  assert.ok(results.length >= 1);
});

test('getByResourceType: returns empty for all-empty profiles', () => {
  const results = getByResourceType([], 'gold');
  assert.equal(results.length, 0);
});

// ── getHighRevenue ───────────────────────────────────────────────────────

test('getHighRevenue: threshold 1.0 returns mega profiles', () => {
  const results = getHighRevenue(CONFLICT_ECONOMY_PROFILES, 1.0);
  assert.ok(results.length >= 3, 'Expected at least 3 mega-revenue profiles');
});

test('getHighRevenue: threshold 0.5 includes Colombia', () => {
  const results = getHighRevenue(CONFLICT_ECONOMY_PROFILES, 0.5);
  const ids = results.map((p) => p.id);
  assert.ok(ids.includes('colombia-armed-groups'));
});

test('getHighRevenue: threshold 0.5 excludes Somalia (0.075B)', () => {
  const results = getHighRevenue(CONFLICT_ECONOMY_PROFILES, 0.5);
  const ids = results.map((p) => p.id);
  assert.ok(!ids.includes('somalia-al-shabaab'));
});

test('getHighRevenue: threshold 0 returns all profiles', () => {
  const results = getHighRevenue(CONFLICT_ECONOMY_PROFILES, 0);
  assert.equal(results.length, CONFLICT_ECONOMY_PROFILES.length);
});

test('getHighRevenue: very high threshold returns empty', () => {
  const results = getHighRevenue(CONFLICT_ECONOMY_PROFILES, 100);
  assert.equal(results.length, 0);
});

// ── getByRegion ──────────────────────────────────────────────────────────

test('getByRegion: East Africa returns Sudan and Somalia', () => {
  const results = getByRegion(CONFLICT_ECONOMY_PROFILES, 'East Africa');
  const ids = results.map((p) => p.id);
  assert.ok(ids.includes('sudan-rsf-gold'));
  assert.ok(ids.includes('somalia-al-shabaab'));
});

test('getByRegion: Caribbean returns Haiti', () => {
  const results = getByRegion(CONFLICT_ECONOMY_PROFILES, 'Caribbean');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'haiti-gangs');
});

test('getByRegion: unknown region returns empty', () => {
  const results = getByRegion(CONFLICT_ECONOMY_PROFILES, 'West Africa' as ConflictRegion);
  assert.equal(results.length, 0);
});

test('getByRegion: South Asia returns Afghanistan', () => {
  const results = getByRegion(CONFLICT_ECONOMY_PROFILES, 'South Asia');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'afghanistan-narcotics');
});

// ── computeGlobalConflictEconomyIndex ────────────────────────────────────

test('computeGlobalConflictEconomyIndex: profileCount matches input', () => {
  const idx = computeGlobalConflictEconomyIndex(CONFLICT_ECONOMY_PROFILES);
  assert.equal(idx.profileCount, 10);
});

test('computeGlobalConflictEconomyIndex: totalAnnualRevenueBillions > 0', () => {
  const idx = computeGlobalConflictEconomyIndex(CONFLICT_ECONOMY_PROFILES);
  assert.ok(idx.totalAnnualRevenueBillions > 0);
});

test('computeGlobalConflictEconomyIndex: indexScore in 0-100', () => {
  const idx = computeGlobalConflictEconomyIndex(CONFLICT_ECONOMY_PROFILES);
  assert.ok(idx.indexScore >= 0 && idx.indexScore <= 100);
});

test('computeGlobalConflictEconomyIndex: megaRevenueCount >= 3', () => {
  const idx = computeGlobalConflictEconomyIndex(CONFLICT_ECONOMY_PROFILES);
  assert.ok(idx.megaRevenueCount >= 3, 'Expected at least 3 mega actors (DRC, Afghanistan, Sudan, Myanmar)');
});

test('computeGlobalConflictEconomyIndex: topRegions has at most 3 entries', () => {
  const idx = computeGlobalConflictEconomyIndex(CONFLICT_ECONOMY_PROFILES);
  assert.ok(idx.topRegions.length <= 3);
});

test('computeGlobalConflictEconomyIndex: topRegions sorted descending by totalBillions', () => {
  const idx = computeGlobalConflictEconomyIndex(CONFLICT_ECONOMY_PROFILES);
  for (let i = 0; i < idx.topRegions.length - 1; i++) {
    assert.ok(
      idx.topRegions[i].totalBillions >= idx.topRegions[i + 1].totalBillions,
      'topRegions not sorted descending',
    );
  }
});

test('computeGlobalConflictEconomyIndex: dominantResourceTypes has at most 5 entries', () => {
  const idx = computeGlobalConflictEconomyIndex(CONFLICT_ECONOMY_PROFILES);
  assert.ok(idx.dominantResourceTypes.length <= 5);
});

test('computeGlobalConflictEconomyIndex: dominantResourceTypes sorted descending', () => {
  const idx = computeGlobalConflictEconomyIndex(CONFLICT_ECONOMY_PROFILES);
  for (let i = 0; i < idx.dominantResourceTypes.length - 1; i++) {
    assert.ok(
      idx.dominantResourceTypes[i].profileCount >= idx.dominantResourceTypes[i + 1].profileCount,
      'dominantResourceTypes not sorted descending',
    );
  }
});

test('computeGlobalConflictEconomyIndex: empty profiles returns zero index', () => {
  const idx = computeGlobalConflictEconomyIndex([]);
  assert.equal(idx.totalAnnualRevenueBillions, 0);
  assert.equal(idx.indexScore, 0);
  assert.equal(idx.profileCount, 0);
});

test('computeGlobalConflictEconomyIndex: single mega profile gives indexScore >= 10', () => {
  const single = [makeProfile({ annualRevenueMidBillions: 1.0 })];
  const idx = computeGlobalConflictEconomyIndex(single);
  assert.ok(idx.indexScore >= 10);
});

// ── buildRenderData ──────────────────────────────────────────────────────

test('buildRenderData: rows length equals profile count', () => {
  const data = buildRenderData(CONFLICT_ECONOMY_PROFILES);
  assert.equal(data.rows.length, CONFLICT_ECONOMY_PROFILES.length);
});

test('buildRenderData: each row has a revenueClass', () => {
  const data = buildRenderData(CONFLICT_ECONOMY_PROFILES);
  const valid: RevenueClass[] = ['micro', 'minor', 'moderate', 'major', 'mega'];
  for (const row of data.rows) {
    assert.ok(valid.includes(row.revenueClass), `Invalid revenueClass: ${row.revenueClass}`);
  }
});

test('buildRenderData: each row has non-empty revenueRangeLabel', () => {
  const data = buildRenderData(CONFLICT_ECONOMY_PROFILES);
  for (const row of data.rows) {
    assert.ok(row.revenueRangeLabel.length > 0);
  }
});

test('buildRenderData: each row has at least one resourceLabel', () => {
  const data = buildRenderData(CONFLICT_ECONOMY_PROFILES);
  for (const row of data.rows) {
    assert.ok(row.resourceLabels.length > 0);
  }
});

test('buildRenderData: highRevenueProfiles only includes profiles >= 0.5B', () => {
  const data = buildRenderData(CONFLICT_ECONOMY_PROFILES);
  for (const p of data.highRevenueProfiles) {
    assert.ok(p.annualRevenueMidBillions >= 0.5, `Profile ${p.id} below 0.5B threshold`);
  }
});

test('buildRenderData: globalIndex.profileCount equals 10', () => {
  const data = buildRenderData(CONFLICT_ECONOMY_PROFILES);
  assert.equal(data.globalIndex.profileCount, 10);
});

test('buildRenderData: updatedAt is a valid ISO string', () => {
  const data = buildRenderData(CONFLICT_ECONOMY_PROFILES);
  assert.ok(!Number.isNaN(Date.parse(data.updatedAt)));
});

test('buildRenderData: accepts custom now string', () => {
  const now = '2026-01-15T12:00:00.000Z';
  const data = buildRenderData(CONFLICT_ECONOMY_PROFILES, now);
  assert.equal(data.updatedAt, now);
});

test('buildRenderData: empty profiles returns empty rows', () => {
  const data = buildRenderData([]);
  assert.equal(data.rows.length, 0);
});

test('buildRenderData: Somalia row revenueClass is minor', () => {
  const data = buildRenderData(CONFLICT_ECONOMY_PROFILES);
  const somaliaRow = data.rows.find((r) => r.profile.id === 'somalia-al-shabaab');
  assert.ok(somaliaRow != null);
  assert.equal(somaliaRow.revenueClass, 'minor');
});

test('buildRenderData: Myanmar row revenueClass is mega', () => {
  const data = buildRenderData(CONFLICT_ECONOMY_PROFILES);
  const myanmarRow = data.rows.find((r) => r.profile.id === 'myanmar-uwsa');
  assert.ok(myanmarRow != null);
  assert.equal(myanmarRow.revenueClass, 'mega');
});
