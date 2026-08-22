import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveLifelineSituation } from '../lifeline-domain.ts';
import type {
  AreaCondition,
  LocalLogisticsSnapshot,
  ResourceObservation,
  ResourceSite,
} from '../../local-logistics-types.ts';

const NOW = Date.parse('2026-08-14T14:00:00.000Z');
const OBSERVED_AT = new Date(NOW - 10 * 60_000);
const EXPIRES_AT = new Date(NOW + 50 * 60_000);

function site(overrides: Partial<ResourceSite> = {}): ResourceSite {
  return {
    id: 'site-1',
    kind: 'shelter',
    name: 'North Shelter',
    lat: 41.61,
    lon: -86.72,
    sourceRefs: [{ provider: 'fema', recordId: '1' }],
    capabilities: {},
    ...overrides,
  };
}

function observation(overrides: Partial<ResourceObservation> = {}): ResourceObservation {
  return {
    id: 'observation-1',
    siteId: 'site-1',
    provider: 'fema',
    verification: 'official',
    operational: 'open',
    inventory: 'unknown',
    power: 'unknown',
    access: 'unknown',
    observedAt: OBSERVED_AT,
    expiresAt: EXPIRES_AT,
    confidence: 'high',
    sourceUrl: 'https://gis.fema.gov/example',
    ...overrides,
  };
}

function area(overrides: Partial<AreaCondition> = {}): AreaCondition {
  return {
    id: 'ornl-odin:18091:county',
    type: 'power_outage',
    coverage: 'reported',
    countyFips: '18091',
    county: 'LaPorte',
    state: 'Indiana',
    customersOut: 120,
    observedAt: OBSERVED_AT,
    expiresAt: EXPIRES_AT,
    source: 'ornl-odin',
    ...overrides,
  };
}

function snapshot(overrides: Partial<LocalLogisticsSnapshot> = {}): LocalLogisticsSnapshot {
  return {
    schemaVersion: 2,
    queryFingerprint: 'v2|41.61000|-86.72000|25.00|shelter|3',
    placeId: 'home',
    placeName: 'Home',
    effectiveRadiusKm: 25,
    countyFips: '18091',
    categories: ['shelter'],
    sites: [site()],
    observations: [observation()],
    nodes: [],
    areaConditions: [],
    providers: [],
    fetchedAt: OBSERVED_AT,
    isStale: false,
    isExpired: false,
    staleAgeMs: 0,
    source: 'network',
    ...overrides,
  };
}

test('a current official FEMA observation produces reported site facts', () => {
  const situation = deriveLifelineSituation(snapshot(), NOW);
  const result = situation.sites[0]!;

  assert.equal(result.operational.knowledge, 'reported');
  assert.equal(result.operational.value, 'open');
  assert.equal(result.operational.provider, 'fema');
  assert.equal(result.power.value, 'unknown');
});

test('expired official evidence becomes unknown in every operational dimension', () => {
  const expiredSite = site({ capabilities: { evacuationCapacity: 50 } });
  const expired = observation({ expiresAt: new Date(NOW) });
  const result = deriveLifelineSituation(snapshot({ sites: [expiredSite], observations: [expired] }), NOW).sites[0]!;

  for (const fact of [result.operational, result.inventory, result.power, result.access]) {
    assert.equal(fact.knowledge, 'unknown');
    assert.equal(fact.value, 'unknown');
    assert.equal(fact.reason, 'expired');
  }
  assert.equal(result.capacities[0]!.knowledge, 'unknown');
  assert.equal(result.capacities[0]!.value, null);
  assert.equal(result.capacities[0]!.reason, 'expired');
});

test('OSM directory fields never become operational, inventory, power, or access facts', () => {
  const directorySite = site({ sourceRefs: [{ provider: 'osm', recordId: 'node/1' }] });
  const untrustedStatus = observation({
    provider: 'osm',
    verification: 'directory',
    operational: 'open',
    inventory: 'available',
    power: 'grid',
    access: 'reachable',
  });
  const result = deriveLifelineSituation(snapshot({ sites: [directorySite], observations: [untrustedStatus] }), NOW).sites[0]!;

  for (const fact of [result.operational, result.inventory, result.power, result.access]) {
    assert.equal(fact.knowledge, 'unknown');
    assert.equal(fact.value, 'unknown');
    assert.equal(fact.reason, 'directory-not-operational');
  }
});

test('reported population below capacity is not treated as availability', () => {
  const capacitySite = site({
    capabilities: { postImpactCapacity: 100, reportedPopulation: 20 },
  });
  const capacityDerivedAvailability = observation({ inventory: 'available' });
  const result = deriveLifelineSituation(snapshot({
    sites: [capacitySite],
    observations: [capacityDerivedAvailability],
  }), NOW).sites[0]!;

  assert.equal(result.inventory.knowledge, 'unknown');
  assert.equal(result.inventory.value, 'unknown');
  assert.equal(result.inventory.reason, 'capacity-is-not-availability');
  assert.deepEqual(
    result.capacities.map((fact) => [fact.attribute, fact.value]),
    [['post-impact-capacity', 100], ['reported-population', 20]],
  );
});

test('a county outage remains area context and never changes facility power', () => {
  const result = deriveLifelineSituation(snapshot({ areaConditions: [area()] }), NOW);

  assert.equal(result.areas[0]!.customersOut.value, 120);
  assert.equal(result.areas[0]!.customersOut.knowledge, 'reported');
  assert.equal(result.sites[0]!.power.value, 'unknown');
  assert.equal(result.sites[0]!.power.reason, 'not-reported');
});

test('reported county zero is known while unknown coverage and expired coverage are unknown', () => {
  const knownZero = deriveLifelineSituation(snapshot({ areaConditions: [area({ customersOut: 0 })] }), NOW);
  assert.equal(knownZero.areas[0]!.customersOut.value, 0);
  assert.equal(knownZero.areas[0]!.customersOut.knowledge, 'reported');

  const unknown = deriveLifelineSituation(snapshot({
    areaConditions: [area({ coverage: 'unknown', customersOut: 0 })],
  }), NOW);
  assert.equal(unknown.areas[0]!.customersOut.value, null);
  assert.equal(unknown.areas[0]!.customersOut.knowledge, 'unknown');
  assert.equal(unknown.areas[0]!.customersOut.reason, 'coverage-unknown');

  const expired = deriveLifelineSituation(snapshot({
    areaConditions: [area({ customersOut: 0, expiresAt: new Date(NOW) })],
  }), NOW);
  assert.equal(expired.areas[0]!.customersOut.value, null);
  assert.equal(expired.areas[0]!.customersOut.reason, 'expired');
});

test('official evidence is preferred over a newer directory observation', () => {
  const newerDirectory = observation({
    id: 'directory-newer',
    provider: 'osm',
    verification: 'directory',
    operational: 'closed',
    observedAt: new Date(NOW - 60_000),
  });
  const result = deriveLifelineSituation(snapshot({
    observations: [newerDirectory, observation()],
  }), NOW).sites[0]!;

  assert.equal(result.operational.value, 'open');
  assert.equal(result.operational.provider, 'fema');
});
