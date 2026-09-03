import assert from 'node:assert/strict';
import test from 'node:test';

import type { SavedPlace } from '../saved-places.ts';
import type { UnifiedAlert } from '../unified-alerts.ts';

const NOW = Date.parse('2026-09-03T12:00:00.000Z');

interface DigestStorySeed {
  id: string;
  alertIds: string[];
  headline: string;
  narrative: string;
}

interface DigestStoryCard extends DigestStorySeed {
  locationText: string;
  impactText: string;
  impactStatus: 'likely' | 'possible' | 'no_reported_overlap' | 'unknown' | 'not_evaluated';
  evaluatedAt: number;
}

interface ProjectionInput {
  seeds: readonly DigestStorySeed[];
  alerts: readonly UnifiedAlert[];
  savedPlaces: readonly SavedPlace[];
  now: number;
}

type ProjectDigestStories = (input: ProjectionInput) => DigestStoryCard[];

const projectionModule = await import('../digest-alert-projection.ts').catch(() => null) as null | {
  projectDigestStories?: ProjectDigestStories;
};

function projector(): ProjectDigestStories {
  assert.equal(
    typeof projectionModule?.projectDigestStories,
    'function',
    'UX-026 requires a shared pure projectDigestStories service',
  );
  return projectionModule.projectDigestStories;
}

function alert(overrides: Partial<UnifiedAlert> = {}): UnifiedAlert {
  return {
    id: 'alert-1',
    source: 'nws',
    severity: 'high',
    title: 'Red Flag Warning',
    body: 'Dry fuels and strong winds.',
    timestamp: NOW - 60_000,
    relevanceScore: 1,
    acknowledged: false,
    pinned: false,
    ...overrides,
  };
}

function place(overrides: Partial<SavedPlace> = {}): SavedPlace {
  return {
    id: 'home',
    name: 'Home',
    lat: 0,
    lon: 0,
    radiusKm: 20,
    tags: ['home'],
    priority: 1,
    notes: '',
    offlinePinned: false,
    primary: true,
    source: 'manual',
    sortIndex: 1,
    createdAt: NOW - 10_000,
    updatedAt: NOW - 10_000,
    ...overrides,
  };
}

function seed(alertIds: string[], overrides: Partial<DigestStorySeed> = {}): DigestStorySeed {
  return {
    id: 'story-1',
    alertIds,
    headline: 'Red Flag Warning',
    narrative: 'Conditions may worsen quickly.',
    ...overrides,
  };
}

function projectOne(
  alerts: UnifiedAlert[],
  savedPlaces: SavedPlace[] = [place()],
  story = seed(alerts.slice(0, 1).map((item) => item.id)),
): DigestStoryCard {
  const cards = projector()({ seeds: [story], alerts, savedPlaces, now: NOW });
  assert.equal(cards.length, 1, 'one seed must project to one card');
  return cards[0]!;
}

function areaAlert(overrides: Partial<UnifiedAlert> = {}): UnifiedAlert {
  return alert({
    location: { lat: 0, lon: 0, label: 'Test County' },
    spatialScope: { kind: 'area', basis: 'nws-geometry' },
    raw: {
      areaDesc: 'Test County',
      expires: new Date(NOW + 60 * 60_000).toISOString(),
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-0.1, -0.1],
          [0.1, -0.1],
          [0.1, 0.1],
          [-0.1, 0.1],
          [-0.1, -0.1],
        ]],
      },
    },
    ...overrides,
  } as Partial<UnifiedAlert>);
}

test('projects mandatory deterministic location and impact rows', () => {
  const inputAlert = alert({
    source: 'earthquake',
    location: { lat: 41.61, lon: -86.72, label: 'Northern Indiana' },
    spatialScope: { kind: 'point', basis: 'reported-event' },
  } as Partial<UnifiedAlert>);
  const first = projectOne([inputAlert], [place({ lat: 41.61, lon: -86.72 })]);
  const second = projectOne([inputAlert], [place({ lat: 41.61, lon: -86.72 })]);

  assert.deepEqual(first, second, 'the same local evidence must produce the same card');
  assert.match(first.locationText, /^Location:/);
  assert.match(first.impactText, /^Saved-place impact:/);
  assert.equal(first.impactStatus, 'possible');
  assert.equal(first.evaluatedAt, NOW);
});

test('complete current NWS geometry distinguishes inside, near, and complete misses', async (t) => {
  const inputAlert = areaAlert();
  const cases = [
    {
      name: 'inside',
      savedPlace: place({ lat: 0, lon: 0 }),
      status: 'likely',
      impact: /Likely — Home is inside the reported NWS alert area\./,
    },
    {
      name: 'near',
      savedPlace: place({ lat: 0, lon: 0.2, radiusKm: 20 }),
      status: 'possible',
      impact: /Possible — Home is within its saved watch radius of the reported alert area\./,
    },
    {
      name: 'complete miss',
      savedPlace: place({ lat: 1, lon: 1, radiusKm: 5 }),
      status: 'no_reported_overlap',
      impact: /No reported overlap.+This is not an all-clear\./,
    },
  ] as const;

  for (const item of cases) {
    await t.test(item.name, () => {
      const card = projectOne([inputAlert], [item.savedPlace]);
      assert.equal(card.locationText, 'Location: Test County (NWS alert area).');
      assert.equal(card.impactStatus, item.status);
      assert.match(card.impactText, item.impact);
      assert.doesNotMatch(card.impactText, /\bsafe\b|\bunaffected\b|\ball clear\b/i);
    });
  }
});

test('complete NWS coverage names three impacted places in saved-place order and counts the remainder', () => {
  const impactedPlaces = [
    place({ id: 'home', name: 'Home', lat: 0, lon: 0, primary: true }),
    place({ id: 'work', name: 'Work', lat: 0.01, lon: 0.01, primary: false }),
    place({ id: 'family', name: 'Family', lat: -0.01, lon: -0.01, primary: false }),
    place({ id: 'school', name: 'School', lat: 0.02, lon: -0.02, primary: false }),
    place({ id: 'cabin', name: 'Cabin', lat: -0.02, lon: 0.02, primary: false }),
  ];
  const first = projectOne([areaAlert()], impactedPlaces);
  const second = projectOne([areaAlert()], impactedPlaces);

  assert.equal(first.impactStatus, 'likely');
  assert.equal(first.impactText, second.impactText, 'place naming must be deterministic');
  const homeIndex = first.impactText.indexOf('Home');
  const workIndex = first.impactText.indexOf('Work');
  const familyIndex = first.impactText.indexOf('Family');
  assert.ok(homeIndex >= 0 && workIndex > homeIndex && familyIndex > workIndex,
    'the first three impacted places must follow saved-place order');
  assert.doesNotMatch(first.impactText, /School|Cabin/, 'overflow place names must stay bounded');
  assert.match(first.impactText, /and 2 more/i);
});

test('centroid-only and incomplete area evidence fail closed to unknown', async (t) => {
  const cases: Array<{ name: string; value: UnifiedAlert }> = [
    {
      name: 'centroid',
      value: alert({
        location: { lat: 0, lon: -160, label: 'Pacific Basin' },
        spatialScope: { kind: 'point', basis: 'regional-centroid' },
      } as Partial<UnifiedAlert>),
    },
    {
      name: 'cold rehydration without raw geometry',
      value: areaAlert({ raw: undefined }),
    },
    {
      name: 'expired geometry',
      value: areaAlert({
        raw: {
          areaDesc: 'Test County',
          expires: new Date(NOW - 1).toISOString(),
          geometry: { type: 'Polygon', coordinates: [[[-1, -1], [1, -1], [1, 1], [-1, -1]]] },
        },
      }),
    },
    {
      name: 'malformed geometry',
      value: areaAlert({
        raw: {
          areaDesc: 'Test County',
          expires: new Date(NOW + 60_000).toISOString(),
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [181, 0], [0, 1], [0, 0]]] },
        },
      }),
    },
  ];

  for (const item of cases) {
    await t.test(item.name, () => {
      const card = projectOne([item.value], [place({ lat: 50, lon: 50 })]);
      assert.equal(card.impactStatus, 'unknown');
      assert.match(card.impactText, /Unknown — .*no complete usable impact area\./);
      assert.doesNotMatch(card.impactText, /No reported overlap/i);
    });
  }
});

test('an explicit global alert is possible at all places, never automatically likely', () => {
  const globalAlert = alert({
    source: 'space-weather',
    location: undefined,
    spatialScope: { kind: 'global', basis: 'producer' },
  } as Partial<UnifiedAlert>);
  const card = projectOne([globalAlert], [place(), place({ id: 'work', name: 'Work', primary: false })]);

  assert.equal(card.locationText, 'Location: Worldwide.');
  assert.equal(card.impactStatus, 'possible');
  assert.equal(
    card.impactText,
    'Saved-place impact: Possible at all saved places — this alert has global scope; local effects are not confirmed.',
  );
});

test('no configured saved places is explicitly not evaluated', () => {
  const card = projectOne([areaAlert()], []);
  assert.equal(card.impactStatus, 'not_evaluated');
  assert.equal(card.impactText, 'Saved-place impact: Not evaluated — no saved places are configured.');
});

test('zero latitude and longitude are valid reported-event coordinates', () => {
  const inputAlert = alert({
    source: 'earthquake',
    location: { lat: 0, lon: 0 },
    spatialScope: { kind: 'point', basis: 'reported-event' },
  } as Partial<UnifiedAlert>);
  const card = projectOne([inputAlert], [place({ lat: 0, lon: 0, radiusKm: 1 })]);

  assert.equal(card.locationText, 'Location: Near 0.00° N, 0.00° E.');
  assert.equal(card.impactStatus, 'possible');
});

test('centroid and missing-location wording remain explicit without implying a footprint', async (t) => {
  await t.test('named centroid', () => {
    const card = projectOne([alert({
      location: { lat: 0, lon: -160, label: 'Pacific Basin' },
      spatialScope: { kind: 'point', basis: 'regional-centroid' },
    } as Partial<UnifiedAlert>)]);
    assert.equal(card.locationText, 'Location: Pacific Basin (reported area centroid).');
    assert.equal(card.impactStatus, 'unknown');
  });

  await t.test('not reported', () => {
    const card = projectOne([alert({ location: undefined })]);
    assert.equal(card.locationText, 'Location: Not reported.');
    assert.equal(card.impactStatus, 'unknown');
  });
});

test('a missing correlation member prevents a complete-negative conclusion', () => {
  const member = areaAlert({ id: 'member-present' });
  const correlation = alert({
    id: 'correlation-1',
    source: 'correlation',
    location: undefined,
    spatialScope: { kind: 'members' },
    correlationMembers: ['member-present', 'member-pruned'],
  } as Partial<UnifiedAlert>);
  const card = projectOne(
    [correlation, member],
    [place({ lat: 40, lon: 40, radiusKm: 5 })],
    seed(['correlation-1']),
  );

  assert.equal(card.impactStatus, 'unknown');
  assert.match(card.impactText, /Unknown/);
  assert.doesNotMatch(card.impactText, /No reported overlap/i);
});

test('positive member evidence remains visible while partial evidence is named unknown', () => {
  const member = areaAlert({ id: 'member-present' });
  const correlation = alert({
    id: 'correlation-1',
    source: 'correlation',
    spatialScope: { kind: 'members' },
    correlationMembers: ['member-present', 'member-pruned'],
  } as Partial<UnifiedAlert>);
  const card = projectOne([correlation, member], [place()], seed(['correlation-1']));

  assert.equal(card.impactStatus, 'likely');
  assert.match(card.impactText, /Likely — Home/);
  assert.match(card.impactText, /Unknown/);
});

test('multi-member locations are deduplicated, bounded, and ordered deterministically', () => {
  const members = ['Japan', 'Pacific Basin', 'Alaska', 'Hawaii', 'Japan'].map((label, index) => alert({
    id: `member-${index}`,
    location: { lat: index, lon: index, label },
    spatialScope: { kind: 'point', basis: 'centroid' },
  } as Partial<UnifiedAlert>));
  const correlation = alert({
    id: 'correlation-1',
    source: 'correlation',
    spatialScope: { kind: 'members' },
    correlationMembers: members.map((item) => item.id),
  } as Partial<UnifiedAlert>);
  const card = projectOne([correlation, ...members], [place()], seed(['correlation-1']));

  assert.equal(card.locationText, 'Locations: Japan; Pacific Basin; Alaska; and 1 more.');
  assert.equal(card.impactStatus, 'unknown');
});

test('oversized geometry exhausts the bounded evaluator as unknown instead of truncating to a miss', () => {
  const vertices = Array.from({ length: 50_100 }, (_, index) => {
    const angle = (index / 50_099) * Math.PI * 2;
    return [Math.cos(angle), Math.sin(angle)];
  });
  vertices.push(vertices[0]!);
  const inputAlert = areaAlert({
    raw: {
      areaDesc: 'Oversized County',
      expires: new Date(NOW + 60_000).toISOString(),
      geometry: { type: 'Polygon', coordinates: [vertices] },
    },
  });
  const card = projectOne([inputAlert], [place({ lat: 20, lon: 20 })]);

  assert.equal(card.impactStatus, 'unknown');
  assert.doesNotMatch(card.impactText, /No reported overlap/i);
});
