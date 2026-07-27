import assert from 'node:assert/strict';
import test from 'node:test';
import {
  airstrikesToObservations,
  conflictEventsToObservations,
  createConflictObservationDeduper,
  newsClustersToObservations,
  orefAlertsToObservations,
  unrestEventsToObservations,
  ucdpEventsToObservations,
} from '../conflict-observation-adapters.ts';

test('ACLED and UCDP rows normalize to bounded conflict observations', () => {
  const acled = conflictEventsToObservations([{
    id: 'ACLED-1',
    eventType: 'battle',
    subEventType: 'Armed clash',
    country: 'Ukraine',
    region: 'Kyiv',
    location: 'Kyiv',
    lat: 50.45,
    lon: 30.52,
    time: new Date(2_000),
    fatalities: 1,
    actors: ['Armed Forces of Ukraine', 'Russian Forces'],
    source: 'ACLED',
  }]);
  const ucdp = ucdpEventsToObservations([{
    id: 'UCDP-1',
    date_start: '2026-07-27',
    date_end: '2026-07-27',
    latitude: 50.45,
    longitude: 30.52,
    country: 'Ukraine',
    side_a: 'Ukraine',
    side_b: 'Russia',
    deaths_best: 2,
    deaths_low: 1,
    deaths_high: 3,
    type_of_violence: 'state-based',
    source_original: 'UCDP',
  }]);

  assert.equal(acled.length, 1);
  assert.equal(acled[0]?.sourceId, 'acled');
  assert.equal(acled[0]?.domain, 'conflict');
  assert.ok(acled[0]?.entityIds.includes('ukr'));
  assert.ok(acled[0]?.tags.includes('event-type:armed-conflict'));
  assert.ok(acled[0]?.tags.includes('region:ukraine'));

  assert.equal(ucdp.length, 1);
  assert.equal(ucdp[0]?.sourceId, 'ucdp');
  assert.ok(ucdp[0]?.entityIds.includes('ukr'));
  assert.ok(ucdp[0]?.tags.includes('event-type:armed-conflict'));
});

test('UCDP non-state violence remains an armed-conflict event', () => {
  const observations = ucdpEventsToObservations([{
    id: 'UCDP-NON-STATE',
    date_start: '2026-07-27',
    date_end: '2026-07-27',
    latitude: 15,
    longitude: 30,
    country: 'Sudan',
    side_a: 'Group A',
    side_b: 'Group B',
    deaths_best: 2,
    deaths_low: 1,
    deaths_high: 3,
    type_of_violence: 'non-state',
    source_original: 'UCDP',
  }]);

  assert.ok(observations[0]?.tags.includes('event-type:armed-conflict'));
  assert.ok(!observations[0]?.tags.includes('event-type:remote-violence'));
});

test('social-unrest rows normalize into exact civil-unrest observations', () => {
  const observations = unrestEventsToObservations([{
    id: 'UNREST-1',
    title: 'Large demonstration in Khartoum',
    eventType: 'demonstration',
    city: 'Khartoum',
    country: 'Sudan',
    region: 'Khartoum',
    lat: 15.5,
    lon: 32.5,
    time: new Date(2_000),
    severity: 'high',
    sources: ['ACLED'],
    sourceType: 'acled',
    actors: ['Civil society coalition'],
    confidence: 'high',
    validated: true,
  }]);

  assert.equal(observations[0]?.sourceId, 'acled');
  assert.equal(observations[0]?.domain, 'conflict');
  assert.ok(observations[0]?.entityIds.includes('sdn'));
  assert.ok(observations[0]?.tags.includes('event-type:civil-unrest'));
  assert.ok(observations[0]?.tags.includes('region:sudan'));
  assert.ok(observations[0]?.tags.includes('region:sdn'));
});

test('airstrike and OREF adapters expose military and security event contracts', () => {
  const airstrikes = airstrikesToObservations([{
    id: 'strike-1',
    date: '2026-07-27T01:00:00.000Z',
    country: 'Israel',
    region: 'Northern District',
    location: 'Haifa',
    lat: 32.8,
    lon: 35,
    actor: 'Actor A',
    targetActor: 'Actor B',
    eventType: 'Explosions/Remote violence',
    subEventType: 'Air/drone strike',
    fatalities: 0,
    notes: 'oversized provider note must not be retained',
  }]);
  const alerts = orefAlertsToObservations([{
    id: 'oref-1',
    cat: '1',
    title: 'Missiles',
    data: ['Haifa'],
    desc: 'Enter protected space',
    alertDate: '2026-07-27T01:05:00.000Z',
  }]);

  assert.equal(airstrikes[0]?.domain, 'military');
  assert.equal(airstrikes[0]?.sourceId, 'acled');
  assert.ok(airstrikes[0]?.tags.includes('event-type:airstrike'));
  assert.equal(
    (airstrikes[0]?.raw as { notes?: unknown } | null)?.notes,
    undefined,
  );

  assert.equal(alerts[0]?.domain, 'security');
  assert.equal(alerts[0]?.sourceId, 'oref');
  assert.ok(alerts[0]?.entityIds.includes('isr'));
  assert.ok(alerts[0]?.tags.includes('event-type:security-alert'));
  assert.ok(alerts[0]?.tags.includes('region:israel'));
});

test('corroborated news clusters emit one event per independent named source', () => {
  const observations = newsClustersToObservations([{
    id: 'cluster-1',
    primaryTitle: 'Military escalation reported in Ukraine',
    primarySource: 'Reuters',
    primaryLink: 'https://example.test/primary',
    sourceCount: 2,
    topSources: [
      { name: 'Reuters', tier: 1, url: 'https://example.test/reuters' },
      { name: 'Associated Press', tier: 1, url: 'https://example.test/ap' },
    ],
    allItems: [
      {
        source: 'Reuters',
        title: 'Military escalation reported in Ukraine',
        link: 'https://example.test/reuters',
        pubDate: new Date(2_000),
        isAlert: true,
        locationName: 'Ukraine',
      },
      {
        source: 'Associated Press',
        title: 'Military escalation reported in Ukraine',
        link: 'https://example.test/ap',
        pubDate: new Date(2_500),
        isAlert: true,
        locationName: 'Ukraine',
      },
    ],
    firstSeen: new Date(2_000),
    lastUpdated: new Date(2_500),
    isAlert: true,
    threat: {
      level: 'high',
      category: 'military',
      confidence: 0.9,
      source: 'keyword',
    },
  }]);

  assert.deepEqual(
    observations.map((observation) => observation.sourceId),
    ['news:reuters', 'news:associated-press'],
  );
  assert.ok(observations.every((observation) =>
    observation.tags.includes('event-type:military-activity')));
  assert.ok(observations.every((observation) =>
    observation.tags.includes('region:ukraine')));
  assert.ok(observations.every((observation) =>
    observation.entityIds.includes('ukr')));
});

test('corroborated protest news uses the civil-unrest event contract', () => {
  const observations = newsClustersToObservations([{
    id: 'protest-cluster',
    primaryTitle: 'Large demonstration reported in Sudan',
    topSources: [
      { name: 'Reuters' },
      { name: 'Associated Press' },
    ],
    allItems: [
      {
        source: 'Reuters',
        pubDate: new Date(2_000),
        locationName: 'Sudan',
      },
      {
        source: 'Associated Press',
        pubDate: new Date(2_500),
        locationName: 'Sudan',
      },
    ],
    threat: { level: 'medium', category: 'protest' },
  } as never]);

  assert.equal(observations.length, 2);
  assert.ok(observations.every((observation) =>
    observation.tags.includes('event-type:civil-unrest')));
  assert.ok(observations.every((observation) =>
    observation.tags.includes('region:sdn')));
});

test('adapters fail closed on malformed rows and cap untrusted batches', () => {
  const malformed = conflictEventsToObservations([{
    id: '',
    eventType: 'battle',
    country: 'Ukraine',
    lat: Number.NaN,
    lon: 30,
    time: new Date('invalid'),
    actors: [],
  } as never]);
  assert.deepEqual(malformed, []);

  const unknownUnrestSource = unrestEventsToObservations([{
    id: 'unsafe-source',
    title: 'Demonstration',
    eventType: 'demonstration',
    country: 'Ukraine',
    lat: 50,
    lon: 30,
    time: new Date(2_000),
    severity: 'medium',
    sources: [],
    sourceType: 'unsafe source',
  } as never]);
  assert.deepEqual(unknownUnrestSource, []);

  const oversized = Array.from({ length: 500 }, (_, index) => ({
    id: `event-${index}`,
    eventType: 'battle',
    country: 'Ukraine',
    lat: 50,
    lon: 30,
    time: new Date(2_000 + index),
    actors: ['Actor'],
  }));
  assert.ok(conflictEventsToObservations(oversized as never).length <= 200);
});

test('news severity preserves the upstream threat level', () => {
  const observations = newsClustersToObservations([{
    id: 'low-cluster',
    primaryTitle: 'Military activity noted in Ukraine',
    topSources: [
      { name: 'Reuters' },
      { name: 'Associated Press' },
    ],
    allItems: [
      {
        source: 'Reuters',
        pubDate: new Date(2_000),
        locationName: 'Ukraine',
      },
      {
        source: 'Associated Press',
        pubDate: new Date(2_500),
        locationName: 'Ukraine',
      },
    ],
    threat: { level: 'low', category: 'military' },
  } as never]);

  assert.ok(observations.length > 0);
  assert.ok(observations.every((observation) => observation.severity === 'LOW'));
});

test('bounded ingest dedupe suppresses refresh duplicates and evicts oldest ids', () => {
  const dedupe = createConflictObservationDeduper(2);
  const observations = conflictEventsToObservations([{
    id: 'one',
    eventType: 'battle',
    country: 'Ukraine',
    lat: 50,
    lon: 30,
    time: new Date(2_000),
    actors: ['Actor'],
  }, {
    id: 'two',
    eventType: 'battle',
    country: 'Ukraine',
    lat: 50,
    lon: 30,
    time: new Date(2_500),
    actors: ['Actor'],
  }] as never);
  assert.equal(dedupe(observations).length, 2);
  assert.equal(dedupe(observations).length, 0);

  const third = conflictEventsToObservations([{
    id: 'three',
    eventType: 'battle',
    country: 'Ukraine',
    lat: 50,
    lon: 30,
    time: new Date(3_000),
    actors: ['Actor'],
  }] as never);
  assert.equal(dedupe(third).length, 1);
  assert.equal(dedupe([observations[0]!]).length, 1);
});
