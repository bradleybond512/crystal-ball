import assert from 'node:assert/strict';
import test from 'node:test';
import * as lifelineMapHelpers from '../src/components/disaster-lifelines-map-helpers.ts';
const {
  bindLifelinePopupActions,
  buildLifelinesPlaceMatchSignature,
  buildExternalMapsUrl,
  createMapAsyncInitGuard,
  getTemporaryMapBounds,
  getLifelineMarkerPresentation,
  parseLifelinesOverlayEventDetailWithContext,
} = lifelineMapHelpers;
import type { LocalLogisticsSnapshot } from '../src/services/local-logistics-types.ts';
import type { SavedPlace } from '../src/services/saved-places.ts';

const NOW = Date.parse('2026-08-14T14:00:00.000Z');
const PLACE: SavedPlace = {
  id: 'home', name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25,
  tags: ['home'], priority: 0, notes: '', offlinePinned: true, primary: true,
  source: 'manual', sortIndex: 1, createdAt: NOW, updatedAt: NOW,
};

function node(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fema:shelter:42',
    kind: 'shelter',
    category: 'shelter',
    name: 'County Shelter',
    lat: 41.6,
    lon: -86.7,
    distanceKm: 4.2,
    address: '100 Main St, La Porte, IN',
    publicPhone: '+1 (219) 555-0100',
    sourceRefs: [{ provider: 'fema', recordId: '42' }],
    capabilities: {},
    source: 'FEMA Open Shelters',
    freshness: 'fresh',
    hazardCompatibility: 'evacuation',
    fetchedAt: new Date(NOW - 60_000),
    operational: 'open',
    inventory: 'unknown',
    power: 'unknown',
    access: 'unknown',
    verification: 'official',
    observedAt: new Date(NOW - 60_000),
    expiresAt: new Date(NOW + 60_000),
    confidence: 'high',
    sourceUrl: 'https://gis.fema.gov/arcgis/rest/services/NSS/OpenShelters/FeatureServer',
    directoryOnly: false,
    ...overrides,
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  const nodes = [node()];
  return {
    schemaVersion: 2,
    queryFingerprint: 'v2|41.60000|-86.70000|25.00|shelter|3',
    placeId: 'home',
    placeName: 'Home',
    effectiveRadiusKm: 25,
    categories: ['shelter'],
    sites: [],
    observations: [],
    nodes,
    areaConditions: [],
    providers: [],
    fetchedAt: new Date(NOW - 60_000),
    isStale: false,
    isExpired: false,
    staleAgeMs: 0,
    source: 'network',
    ...overrides,
  };
}

function parseLifelinesOverlayEventDetail(value: unknown, now = NOW): LocalLogisticsSnapshot | null {
  const cached = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as { snapshot?: unknown }).snapshot as LocalLogisticsSnapshot
    : null;
  return parseLifelinesOverlayEventDetailWithContext(value, now, {
    getPlace: (placeId) => placeId === PLACE.id ? PLACE : null,
    getCachedSnapshot: () => cached,
  });
}

test('marker styling follows evidence instead of treating every directory result as open', () => {
  assert.equal(getLifelineMarkerPresentation(node(), NOW).state, 'official-open');
  assert.equal(
    getLifelineMarkerPresentation(node({ directoryOnly: true, verification: 'directory' }), NOW).state,
    'directory',
  );
  assert.equal(
    getLifelineMarkerPresentation(node({ operational: 'closed' }), NOW).state,
    'official-closed',
  );
  assert.equal(
    getLifelineMarkerPresentation(node({ expiresAt: new Date(NOW - 1) }), NOW).state,
    'expired',
  );
});

test('hotel presentation selects the shared directory disclosure and fails closed', () => {
  const presentation = getLifelineMarkerPresentation(node({
    kind: 'hotel',
    category: 'hotel',
    directoryOnly: false,
    verification: 'directory',
    operational: 'open',
    inventory: 'available',
    power: 'grid',
    access: 'reachable',
  }), NOW);

  assert.equal(presentation.isHotelDirectory, true);
  assert.equal(
    presentation.evidenceLabel,
    'Directory listing only. Vacancy, current operation, power, and access are unknown. Confirm directly with the property before relying on it.',
  );
  assert.deepEqual(presentation.status, {
    operational: 'unknown', inventory: 'unknown', power: 'unknown', access: 'unknown',
  });
});

test('expired hotel presentation composes expiry and projects all states to unknown', () => {
  const presentation = getLifelineMarkerPresentation(node({
    kind: 'hotel',
    category: 'hotel',
    directoryOnly: true,
    verification: 'directory',
    operational: 'open',
    inventory: 'available',
    power: 'grid',
    access: 'reachable',
    expiresAt: new Date(NOW - 1),
  }), NOW);

  assert.equal(presentation.state, 'expired');
  assert.equal(
    presentation.evidenceLabel,
    'Verification expired — status unknown. Directory listing only. Vacancy, current operation, power, and access are unknown. Confirm directly with the property before relying on it.',
  );
  assert.deepEqual(presentation.status, {
    operational: 'unknown', inventory: 'unknown', power: 'unknown', access: 'unknown',
  });
});

test('non-hotel presentation preserves official state values and generic evidence', () => {
  const presentation = getLifelineMarkerPresentation(node({
    operational: 'open', inventory: 'available', power: 'grid', access: 'reachable',
  }), NOW);

  assert.equal(presentation.isHotelDirectory, false);
  assert.equal(presentation.evidenceLabel, 'Official report: open');
  assert.deepEqual(presentation.status, {
    operational: 'open', inventory: 'available', power: 'grid', access: 'reachable',
  });
});

test('recovery centers have a distinct neutral category and are never labeled as lodging', () => {
  const presentation = getLifelineMarkerPresentation(node({ kind: 'recovery', category: 'recovery' }), NOW);
  assert.equal(presentation.categoryLabel, 'Recovery center');
  assert.equal(presentation.glyph, 'R');
  assert.notEqual(presentation.categoryLabel, 'Shelter');
  assert.notEqual(presentation.categoryLabel, 'Hotel');
});

test('lifelines overlay event accepts only a bounded, validated active snapshot', () => {
  const valid = snapshot();
  const parsed = parseLifelinesOverlayEventDetail({ snapshot: { ...valid, sites: [{ attacker: true }] } }, NOW);
  assert.equal(parsed?.placeId, 'home');
  assert.deepEqual(parsed?.sites, []);
  assert.equal(parsed?.nodes[0]?.distanceKm, 0);
  assert.equal(parseLifelinesOverlayEventDetail({ snapshot: valid, extra: true }, NOW), null);
  assert.equal(
    parseLifelinesOverlayEventDetail({ snapshot: snapshot({ nodes: [node({ lat: 91 })] }) }, NOW),
    null,
  );
  assert.equal(
    parseLifelinesOverlayEventDetail({ snapshot: snapshot({ nodes: [node({ operational: 'maybe' })] }) }, NOW),
    null,
  );
  assert.equal(
    parseLifelinesOverlayEventDetail({ snapshot: snapshot({ nodes: [node({ expiresAt: 'tomorrow' })] }) }, NOW),
    null,
  );
  const accessorNode = node();
  Object.defineProperty(accessorNode, 'operational', { enumerable: true, get: () => 'open' });
  assert.equal(parseLifelinesOverlayEventDetail({ snapshot: snapshot({ nodes: [accessorNode] }) }, NOW), null);
  assert.equal(parseLifelinesOverlayEventDetail({
    snapshot: snapshot({ nodes: new Array(1) }),
  }, NOW), null);
});

test('event boundary enforces provider provenance and bounded source times', () => {
  assert.ok(parseLifelinesOverlayEventDetail({
    snapshot: snapshot({ nodes: [node({
      sourceRefs: [
        { provider: 'fema', recordId: '42' },
        { provider: 'osm', recordId: 'way/99' },
      ],
    })] }),
  }, NOW));
  assert.equal(parseLifelinesOverlayEventDetail({
    snapshot: snapshot({ nodes: [node({
      sourceRefs: [
        { provider: 'osm', recordId: 'way/99' },
        { provider: 'fema', recordId: '42' },
      ],
    })] }),
  }, NOW), null);
  const validOsm = node({
    id: 'osm:hotel:42', kind: 'hotel', category: 'hotel',
    sourceRefs: [{ provider: 'osm', recordId: '42' }],
    source: 'OpenStreetMap directory',
    sourceUrl: 'https://www.openstreetmap.org/node/42',
    url: 'https://www.openstreetmap.org/node/42',
    verification: 'directory', directoryOnly: true, operational: 'unknown',
    inventory: 'unknown', power: 'unknown', access: 'unknown', confidence: 'low',
    expiresAt: new Date(NOW + 60 * 60 * 1000),
  });
  const osmSnapshot = (nodes: unknown[]) => snapshot({
    queryFingerprint: 'v2|41.60000|-86.70000|25.00|hotel|3',
    categories: ['hotel'],
    nodes,
  });
  assert.ok(parseLifelinesOverlayEventDetail({ snapshot: osmSnapshot([validOsm]) }, NOW));
  assert.equal(parseLifelinesOverlayEventDetail({
    snapshot: osmSnapshot([node({
      ...validOsm,
      verification: 'official', directoryOnly: false, operational: 'open', confidence: 'high',
    })]),
  }, NOW), null);
  assert.equal(parseLifelinesOverlayEventDetail({
    snapshot: snapshot({ nodes: [node({ kind: 'hotel', category: 'hotel' })] }),
  }, NOW), null);
  assert.equal(parseLifelinesOverlayEventDetail({
    snapshot: snapshot({ nodes: [node({
      observedAt: new Date(NOW + 5 * 60 * 1000 + 1),
      retrievedAt: new Date(NOW + 5 * 60 * 1000 + 1),
      expiresAt: new Date(NOW + 6 * 60 * 1000),
    })] }),
  }, NOW), null);
  assert.equal(parseLifelinesOverlayEventDetail({
    snapshot: snapshot({ nodes: [node({ expiresAt: new Date(NOW + 31 * 60 * 1000) })] }),
  }, NOW), null);
  assert.equal(parseLifelinesOverlayEventDetail({
    snapshot: snapshot({ nodes: [node({ lat: 0, lon: 0, distanceKm: 0 })] }),
  }, NOW), null);
  assert.equal(parseLifelinesOverlayEventDetail({
    snapshot: snapshot({ nodes: [node({
      lat: -41.59999962745353,
      lon: 93.3000002309571,
      distanceKm: 0,
    })] }),
  }, NOW), null);
  assert.equal(parseLifelinesOverlayEventDetail({
    snapshot: snapshot({ nodes: [node({
      kind: 'recovery', category: 'recovery', source: 'FEMA Disaster Recovery Centers',
    })] }),
  }, NOW), null);
});

test('same saved-place id cannot mask moved coordinates or changed radius', () => {
  const original = { id: 'home', name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 };
  assert.notEqual(
    buildLifelinesPlaceMatchSignature(original),
    buildLifelinesPlaceMatchSignature({ ...original, lat: 42.1 }),
  );
  assert.notEqual(
    buildLifelinesPlaceMatchSignature(original),
    buildLifelinesPlaceMatchSignature({ ...original, radiusKm: 40 }),
  );
});

test('map event receiver rejects an old exact cache after a same-ID place move or replacement', () => {
  const accepted = snapshot() as LocalLogisticsSnapshot;
  const exactContext = {
    getPlace: () => PLACE,
    getCachedSnapshot: () => accepted,
  };
  assert.ok(parseLifelinesOverlayEventDetailWithContext({ snapshot: accepted }, NOW, exactContext));

  const moved = { ...PLACE, lat: 42.1, updatedAt: NOW + 1 };
  assert.equal(parseLifelinesOverlayEventDetailWithContext({ snapshot: accepted }, NOW, {
    getPlace: () => moved,
    getCachedSnapshot: () => null,
  }), null);

  const replacementFetchedAt = new Date(NOW - 30_000);
  const replacement = snapshot({
    fetchedAt: replacementFetchedAt,
    nodes: [node({ fetchedAt: replacementFetchedAt })],
  }) as LocalLogisticsSnapshot;
  assert.equal(parseLifelinesOverlayEventDetailWithContext({ snapshot: accepted }, NOW, {
    getPlace: () => PLACE,
    getCachedSnapshot: () => replacement,
  }), null);
});

test('shared temporary bounds include full geometry and fail safe at the antimeridian', () => {
  assert.deepEqual(getTemporaryMapBounds([[-100, 30], [-80, 48], [-90, 60]]), {
    minLon: -100, minLat: 30, maxLon: -80, maxLat: 60, crossesAntimeridian: false,
  });
  assert.deepEqual(getTemporaryMapBounds([[179, 10], [-179, 12]]), {
    minLon: -180, minLat: 10, maxLon: 180, maxLat: 12, crossesAntimeridian: true,
  });
});

test('async map generation guard rejects completion after teardown', async () => {
  const guard = createMapAsyncInitGuard();
  const generation = guard.begin();
  let constructed = false;
  const delayedCompletion = Promise.resolve().then(() => {
    if (guard.isCurrent(generation)) constructed = true;
  });
  guard.dispose();
  await delayedCompletion;
  assert.equal(constructed, false);
});

test('external maps URL is inert data until a click handler explicitly opens it', () => {
  const url = new URL(buildExternalMapsUrl(node()));
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'www.openstreetmap.org');
  assert.equal(url.searchParams.get('mlat'), '41.6');
  assert.equal(url.searchParams.get('mlon'), '-86.7');
  assert.equal(url.hash, '#map=16/41.6/-86.7');
});

test('lifeline call href accepts only bounded, explicitly formatted phone numbers', () => {
  const buildLifelineCallHref = (lifelineMapHelpers as {
    buildLifelineCallHref?: (phone: string | undefined) => string | null;
  }).buildLifelineCallHref;
  assert.equal(typeof buildLifelineCallHref, 'function');
  if (!buildLifelineCallHref) return;
  assert.equal(buildLifelineCallHref('+1 (219) 555-0100'), 'tel:+12195550100');
  assert.equal(buildLifelineCallHref('219-555-0100'), 'tel:2195550100');
  assert.equal(buildLifelineCallHref(undefined), null);
  assert.equal(buildLifelineCallHref(''), null);
  assert.equal(buildLifelineCallHref('555-CALL'), null);
  assert.equal(buildLifelineCallHref('21+95550100'), null);
  assert.equal(buildLifelineCallHref('123456'), null);
  assert.equal(buildLifelineCallHref('+1234567890123456'), null);
});

test('popup copy and external-map effects remain inert until their buttons are clicked', async () => {
  type ClickHandler = () => void;
  const button = (copyKind?: 'address' | 'coordinates') => {
    let click: ClickHandler | null = null;
    return {
      dataset: copyKind ? { lifelineCopy: copyKind } : {},
      addEventListener: (type: string, listener: ClickHandler) => { if (type === 'click') click = listener; },
      click: () => click?.(),
    };
  };
  const address = button('address');
  const coordinates = button('coordinates');
  const maps = button();
  const status = { textContent: '' };
  const root = {
    querySelectorAll: (selector: string) => selector === '[data-lifeline-copy]' ? [address, coordinates] : [],
    querySelector: (selector: string) => selector === '[data-lifeline-open-maps]' ? maps : status,
  } as unknown as ParentNode;
  const copied: string[] = [];
  const opened: string[] = [];

  bindLifelinePopupActions(root, node(), {
    writeClipboard: async (value) => { copied.push(value); },
    openMaps: (url) => { opened.push(url); },
  });
  assert.deepEqual(copied, []);
  assert.deepEqual(opened, []);

  address.click();
  coordinates.click();
  maps.click();
  await Promise.resolve();

  assert.deepEqual(copied, ['100 Main St, La Porte, IN', '41.600000, -86.700000']);
  assert.equal(opened.length, 1);
  assert.match(opened[0] ?? '', /^https:\/\/www\.openstreetmap\.org\//);
});
