import assert from 'node:assert/strict';
import test from 'node:test';

import {
  JURISDICTION_PARSERS,
  NO_KEY_RESULT_NSW,
  NO_KEY_RESULT_UK,
  ROAD511_DISABLED_RESULT,
  parseAzCameras,
  parseGaCameras,
  parseIdCameras,
  parseNcCameras,
  parseNswCameras,
  parseOhgoCameras,
  parseOregonCameras,
  parseRoad511Cameras,
  parseUkCameras,
} from '../adapters/dot-extended.ts';

// ── OHGO (Ohio) ─────────────────────────────────────────────────────────

test('parseOhgoCameras: maps to DOT511 traffic feed', () => {
  const out = parseOhgoCameras([
    {
      id: 'oh-1',
      location: {
        latitude: 39.96,
        longitude: -82.99,
        description: 'I-70 EB at Hilliard-Rome',
      },
      imageUrl: 'https://publicapi.ohgo.com/cam/oh-1.jpg',
      isActive: true,
    },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.source, 'DOT511');
  assert.equal(out[0]?.category, 'traffic');
  assert.equal(out[0]?.id, 'DOT:OH:oh-1');
  assert.equal(out[0]?.metadata.jurisdiction, 'OH');
  assert.equal(out[0]?.metadata.state, 'OH');
});

test('parseOhgoCameras: drops inactive cams', () => {
  const out = parseOhgoCameras([
    { id: 'x', location: { latitude: 40, longitude: -83 }, imageUrl: 'x', isActive: false },
  ]);
  assert.equal(out.length, 0);
});

test('parseOhgoCameras: drops cams missing image url', () => {
  const out = parseOhgoCameras([
    { id: 'x', location: { latitude: 40, longitude: -83 } },
  ]);
  assert.equal(out.length, 0);
});

test('parseOhgoCameras: tolerates non-array payload', () => {
  assert.equal(parseOhgoCameras(null).length, 0);
  assert.equal(parseOhgoCameras({ error: 'down' }).length, 0);
});

// ── ibi511 (AZ/ID/GA) ───────────────────────────────────────────────────

test('parseAzCameras: parses ibi511 shape', () => {
  const out = parseAzCameras([
    {
      Id: 'az-9',
      Title: 'I-10 EB Phoenix',
      CameraLocation: {
        Latitude: 33.45,
        Longitude: -112.07,
        RoadName: 'I-10',
        Direction: 'East',
      },
      ImageURL: 'https://az511.com/cam/az-9.jpg',
      IsActive: true,
    },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, 'DOT:AZ:az-9');
  assert.equal(out[0]?.metadata.route, 'I-10');
  assert.equal(out[0]?.metadata.direction, 'East');
});

test('parseIdCameras: parses ibi511 with flat lat/lon fallback', () => {
  const out = parseIdCameras([
    {
      Id: 'id-1',
      Title: 'I-84 Boise',
      Latitude: 43.6,
      Longitude: -116.2,
      ImageUrl: 'https://511.idaho.gov/cam.jpg',
    },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, 'DOT:ID:id-1');
  assert.equal(out[0]?.lat, 43.6);
});

test('parseGaCameras: drops inactive', () => {
  const out = parseGaCameras([
    {
      Id: 'ga-1',
      CameraLocation: { Latitude: 33.7, Longitude: -84.4 },
      ImageURL: 'x',
      IsActive: false,
    },
  ]);
  assert.equal(out.length, 0);
});

// ── Oregon TripCheck ────────────────────────────────────────────────────

test('parseOregonCameras: maps streamUrl as snapshot, fallback to imageUrl', () => {
  const out = parseOregonCameras([
    {
      camId: 'or-1',
      latitude: 44.94,
      longitude: -123.03,
      streamUrl: 'https://tripcheck.com/stream/or-1.jpg',
      name: 'I-5 Salem NB',
      direction: 'NB',
    },
    {
      camId: 'or-2',
      latitude: 45.51,
      longitude: -122.67,
      imageUrl: 'https://tripcheck.com/img/or-2.jpg',
      name: 'I-405 Portland',
    },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0]?.snapshotUrl, 'https://tripcheck.com/stream/or-1.jpg');
  assert.equal(out[1]?.snapshotUrl, 'https://tripcheck.com/img/or-2.jpg');
});

// ── NCDOT (ArcGIS GeoJSON) ──────────────────────────────────────────────

test('parseNcCameras: parses ArcGIS GeoJSON', () => {
  const out = parseNcCameras({
    features: [
      {
        properties: {
          CAMERA_ID: 'NC-12345',
          LOCATION_DESCRIPTION: 'I-40 WB at Raleigh',
          IMAGE_URL: 'https://ncdot.gov/cam-12345.jpg',
          ROUTE: 'I-40',
        },
        geometry: { coordinates: [-78.64, 35.78] },
      },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, 'DOT:NC:NC-12345');
  assert.equal(out[0]?.lat, 35.78);
  assert.equal(out[0]?.lon, -78.64);
  assert.equal(out[0]?.metadata.route, 'I-40');
});

test('parseNcCameras: drops features missing coordinates', () => {
  const out = parseNcCameras({
    features: [
      { properties: { CAMERA_ID: 'X', IMAGE_URL: 'x' }, geometry: { coordinates: [] } },
    ],
  });
  assert.equal(out.length, 0);
});

// ── NSW (Australia) ─────────────────────────────────────────────────────

test('parseNswCameras: parses NSW GeoJSON FeatureCollection', () => {
  const out = parseNswCameras({
    features: [
      {
        properties: {
          href: 'https://api.transport.nsw.gov.au/cam/123.jpg',
          title: 'M1 Pacific Mwy NB',
          region: 'Sydney North',
          direction: 'NB',
        },
        geometry: { coordinates: [151.21, -33.87] },
      },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]?.metadata.country, 'AU');
  assert.equal(out[0]?.metadata.jurisdiction, 'NSW');
  assert.equal(out[0]?.metadata.region, 'Sydney North');
  assert.equal(out[0]?.lat, -33.87);
});

test('NO_KEY_RESULT_NSW: graceful no-key result has correct shape', () => {
  assert.equal(NO_KEY_RESULT_NSW.requiresKey, true);
  assert.equal(NO_KEY_RESULT_NSW.feeds.length, 0);
  assert.equal(NO_KEY_RESULT_NSW.keySource, 'opendata.transport.nsw.gov.au');
});

// ── UK National Highways ────────────────────────────────────────────────

test('parseUkCameras: maps coordinates.{latitude,longitude}', () => {
  const out = parseUkCameras([
    {
      id: 'uk-99',
      name: 'M25 Junction 9',
      coordinates: { latitude: 51.32, longitude: -0.31 },
      imageUrl: 'https://api.data.nationalhighways.co.uk/cam/uk-99.jpg',
      active: true,
      road: 'M25',
    },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, 'DOT:UK:uk-99');
  assert.equal(out[0]?.metadata.country, 'UK');
  assert.equal(out[0]?.metadata.route, 'M25');
});

test('parseUkCameras: drops inactive', () => {
  const out = parseUkCameras([
    {
      id: 'x',
      coordinates: { latitude: 51, longitude: -1 },
      imageUrl: 'x',
      active: false,
    },
  ]);
  assert.equal(out.length, 0);
});

test('NO_KEY_RESULT_UK: graceful no-key result has correct shape', () => {
  assert.equal(NO_KEY_RESULT_UK.requiresKey, true);
  assert.equal(NO_KEY_RESULT_UK.keySource, 'developer.data.nationalhighways.co.uk');
});

// ── Road511 (paid) ──────────────────────────────────────────────────────

test('ROAD511_DISABLED_RESULT: paid-disabled message has expected shape', () => {
  assert.equal(ROAD511_DISABLED_RESULT.isPaid, true);
  assert.equal(ROAD511_DISABLED_RESULT.disabled, true);
  assert.equal(ROAD511_DISABLED_RESULT.feeds.length, 0);
  assert.match(ROAD511_DISABLED_RESULT.message ?? '', /road511\.com/);
  assert.match(ROAD511_DISABLED_RESULT.message ?? '', /38,219/);
});

test('parseRoad511Cameras: tags jurisdiction in id and metadata', () => {
  const out = parseRoad511Cameras([
    {
      id: 'r1',
      jurisdiction: 'TX',
      latitude: 30.27,
      longitude: -97.74,
      imageUrl: 'https://road511.com/cam/r1.jpg',
      route: 'I-35',
      direction: 'SB',
    },
    {
      cameraId: 'r2',
      jurisdiction: 'BC',
      lat: 49.28,
      lon: -123.12,
      snapshotUrl: 'https://road511.com/cam/r2.jpg',
    },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0]?.id, 'DOT:TX:r1');
  assert.equal(out[0]?.metadata.provider, 'ROAD511');
  assert.equal(out[0]?.metadata.route, 'I-35');
  assert.equal(out[1]?.id, 'DOT:BC:r2');
  assert.equal(out[1]?.metadata.jurisdiction, 'BC');
});

// ── Router ──────────────────────────────────────────────────────────────

test('JURISDICTION_PARSERS: every jurisdiction has a parser', () => {
  const required = ['OH', 'AZ', 'ID', 'GA', 'OR', 'NC', 'NSW', 'UK', 'ROAD511'] as const;
  for (const j of required) {
    assert.equal(typeof JURISDICTION_PARSERS[j], 'function');
  }
});

test('JURISDICTION_PARSERS: all parsers produce DOT511 feeds with traffic category', () => {
  const fixtures: Record<string, unknown> = {
    OH: [
      {
        id: 1,
        location: { latitude: 40, longitude: -82, description: 'X' },
        imageUrl: 'x',
        isActive: true,
      },
    ],
    AZ: [
      {
        Id: 1,
        CameraLocation: { Latitude: 33, Longitude: -112 },
        ImageURL: 'x',
      },
    ],
    ID: [{ Id: 1, Latitude: 43, Longitude: -116, ImageUrl: 'x' }],
    GA: [{ Id: 1, CameraLocation: { Latitude: 33, Longitude: -84 }, ImageURL: 'x' }],
    OR: [{ camId: 1, latitude: 44, longitude: -123, imageUrl: 'x' }],
    NC: { features: [{ properties: { CAMERA_ID: 1, IMAGE_URL: 'x' }, geometry: { coordinates: [-78, 35] } }] },
    NSW: { features: [{ properties: { href: 'x', title: 't' }, geometry: { coordinates: [151, -33] } }] },
    UK: [{ id: 1, coordinates: { latitude: 51, longitude: -1 }, imageUrl: 'x' }],
    ROAD511: [{ id: 1, jurisdiction: 'TX', latitude: 30, longitude: -97, imageUrl: 'x' }],
  };
  for (const [j, payload] of Object.entries(fixtures)) {
    const feeds = JURISDICTION_PARSERS[j as keyof typeof JURISDICTION_PARSERS](payload);
    assert.ok(feeds.length >= 1, `${j} produced 0 feeds`);
    for (const feed of feeds) {
      assert.equal(feed.source, 'DOT511', `${j} feed wrong source`);
      assert.equal(feed.category, 'traffic', `${j} feed wrong category`);
    }
  }
});
