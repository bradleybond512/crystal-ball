import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveLifelineChanges } from '../lifeline-changes.ts';
import { deriveLifelineSituation } from '../lifeline-domain.ts';
import type {
  AreaCondition,
  LocalLogisticsSnapshot,
  ResourceObservation,
  ResourceSite,
} from '../../local-logistics-types.ts';

const T0 = Date.parse('2026-08-14T13:00:00.000Z');
const T1 = Date.parse('2026-08-14T14:00:00.000Z');

const SITE: ResourceSite = {
  id: 'fema:shelter:1',
  kind: 'shelter',
  name: 'North Shelter',
  lat: 41.61,
  lon: -86.72,
  sourceRefs: [{ provider: 'fema', recordId: '1' }],
  capabilities: {},
};

function observation(
  operational: ResourceObservation['operational'],
  observedAt: number,
  expiresAt = observedAt + 2 * 60 * 60_000,
): ResourceObservation {
  return {
    id: `obs-${operational}-${observedAt}`,
    siteId: SITE.id,
    provider: 'fema',
    verification: 'official',
    operational,
    inventory: 'unknown',
    power: 'unknown',
    access: 'unknown',
    observedAt: new Date(observedAt),
    expiresAt: new Date(expiresAt),
    confidence: 'high',
    sourceUrl: 'https://gis.fema.gov/example',
  };
}

function area(customersOut: number, observedAt: number, coverage: AreaCondition['coverage'] = 'reported'): AreaCondition {
  return {
    id: 'ornl-odin:18091:county',
    type: 'power_outage',
    coverage,
    countyFips: '18091',
    county: 'LaPorte',
    state: 'Indiana',
    customersOut,
    observedAt: new Date(observedAt),
    expiresAt: new Date(observedAt + 2 * 60 * 60_000),
    source: 'ornl-odin',
  };
}

function snapshot(at: number, overrides: Partial<LocalLogisticsSnapshot> = {}): LocalLogisticsSnapshot {
  return {
    schemaVersion: 2,
    queryFingerprint: 'exact-query',
    placeId: 'home',
    placeName: 'Home',
    effectiveRadiusKm: 25,
    countyFips: '18091',
    categories: ['shelter'],
    sites: [SITE],
    observations: [observation('open', at)],
    nodes: [],
    areaConditions: [],
    providers: [],
    fetchedAt: new Date(at),
    isStale: false,
    isExpired: false,
    staleAgeMs: 0,
    source: 'network',
    ...overrides,
  };
}

test('an explicit current official open-to-closed report creates a shadow-only status candidate', () => {
  const before = deriveLifelineSituation(snapshot(T0), T0);
  const after = deriveLifelineSituation(snapshot(T1, { observations: [observation('closed', T1)] }), T1);
  const changes = deriveLifelineChanges(before, after);

  const operational = changes.find((change) => change.attribute === 'operational');
  assert.equal(operational?.kind, 'site-status-changed');
  assert.equal(operational?.from, 'open');
  assert.equal(operational?.to, 'closed');
  assert.equal(operational?.shadowOnly, true);
});

test('FEMA disappearance becomes coverage lost and never a closed-shelter claim', () => {
  const before = deriveLifelineSituation(snapshot(T0), T0);
  const after = deriveLifelineSituation(snapshot(T1, { sites: [], observations: [] }), T1);
  const changes = deriveLifelineChanges(before, after);

  assert.ok(changes.some((change) => change.kind === 'site-coverage-lost'));
  assert.ok(changes.every((change) => change.to !== 'closed'));
  assert.ok(changes.every((change) => change.kind !== 'site-status-changed'));
});

test('expiration becomes evidence-unknown rather than closed', () => {
  const before = deriveLifelineSituation(snapshot(T0), T0);
  const afterSnapshot = snapshot(T1, {
    observations: [observation('open', T0, T1)],
  });
  const after = deriveLifelineSituation(afterSnapshot, T1);
  const changes = deriveLifelineChanges(before, after);

  const operational = changes.find((change) => change.attribute === 'operational');
  assert.equal(operational?.kind, 'site-evidence-became-unknown');
  assert.equal(operational?.to, 'unknown');
});

test('OSM directory status changes cannot create operational candidates', () => {
  const directorySite: ResourceSite = {
    ...SITE,
    id: 'osm:node:1',
    sourceRefs: [{ provider: 'osm', recordId: 'node/1' }],
  };
  const directoryObservation = (value: ResourceObservation['operational'], at: number): ResourceObservation => ({
    ...observation(value, at),
    id: `osm-${value}-${at}`,
    siteId: directorySite.id,
    provider: 'osm',
    verification: 'directory',
  });
  const before = deriveLifelineSituation(snapshot(T0, {
    sites: [directorySite], observations: [directoryObservation('open', T0)],
  }), T0);
  const after = deriveLifelineSituation(snapshot(T1, {
    sites: [directorySite], observations: [directoryObservation('closed', T1)],
  }), T1);

  assert.deepEqual(deriveLifelineChanges(before, after), []);
});

test('county outage changes remain area candidates and never facility-power candidates', () => {
  const before = deriveLifelineSituation(snapshot(T0, { areaConditions: [area(10, T0)] }), T0);
  const after = deriveLifelineSituation(snapshot(T1, { areaConditions: [area(50, T1)] }), T1);
  const changes = deriveLifelineChanges(before, after);

  assert.ok(changes.some((change) => (
    change.kind === 'area-outage-changed'
      && change.attribute === 'county-customers-out'
      && change.from === 10
      && change.to === 50
  )));
  assert.ok(changes.every((change) => !(change.scope === 'site' && change.attribute === 'power')));
});

test('a newly reported official shelter is a report candidate, not a proven opening transition', () => {
  const before = deriveLifelineSituation(snapshot(T0, { sites: [], observations: [] }), T0);
  const after = deriveLifelineSituation(snapshot(T1), T1);
  const changes = deriveLifelineChanges(before, after);

  const operational = changes.find((change) => change.attribute === 'operational');
  assert.equal(operational?.kind, 'site-status-reported');
  assert.equal(operational?.from, 'unknown');
  assert.equal(operational?.to, 'open');
});

test('an initial baseline emits no changes, and output is bounded deterministically', () => {
  const baseline = deriveLifelineSituation(snapshot(T0), T0);
  assert.deepEqual(deriveLifelineChanges(null, baseline), []);

  const sites = Array.from({ length: 8 }, (_, index): ResourceSite => ({
    ...SITE,
    id: `site-${index}`,
    name: `Site ${index}`,
    sourceRefs: [{ provider: 'fema', recordId: String(index) }],
  }));
  const previous = deriveLifelineSituation(snapshot(T0, {
    sites,
    observations: sites.map((item) => ({ ...observation('open', T0), id: `old-${item.id}`, siteId: item.id })),
  }), T0);
  const current = deriveLifelineSituation(snapshot(T1, {
    sites,
    observations: sites.map((item) => ({ ...observation('closed', T1), id: `new-${item.id}`, siteId: item.id })),
  }), T1);
  const changes = deriveLifelineChanges(previous, current, { maxCandidates: 3 });

  assert.equal(changes.length, 3);
  assert.deepEqual(changes.map((change) => change.subjectId), ['site-0', 'site-1', 'site-2']);
});

test('different query fingerprints and out-of-order situations establish a new baseline', () => {
  const previous = deriveLifelineSituation(snapshot(T0), T0);
  const changedStatus = deriveLifelineSituation(snapshot(T1, {
    observations: [observation('closed', T1)],
  }), T1);
  const differentQuery = {
    ...changedStatus,
    queryFingerprint: 'different-location-or-options',
  };
  assert.deepEqual(deriveLifelineChanges(previous, differentQuery), []);

  const olderCurrent = {
    ...changedStatus,
    derivedAt: new Date(T0),
  };
  assert.deepEqual(deriveLifelineChanges(previous, olderCurrent), []);
});
