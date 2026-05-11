import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adaptDotCam,
  adaptDotCams,
  parseCoCameras,
  parseFlCameras,
  parseWaCameras,
} from '../dot511-adapter.ts';

// ── adaptDotCam ─────────────────────────────────────────────────────────

test('adaptDotCam: maps to WebcamFeed with traffic category', () => {
  const f = adaptDotCam({
    id: 'cam-1',
    title: 'I-94 East at Exit 100',
    state: 'NY',
    lat: 41.6,
    lon: -86.7,
    imageUrl: 'https://example.com/cam.jpg',
    direction: 'East',
  });
  assert.ok(f);
  assert.equal(f.source, 'DOT511');
  assert.equal(f.category, 'traffic');
  assert.equal(f.id, 'DOT:NY:cam-1');
  assert.equal(f.metadata.state, 'NY');
  assert.equal(f.metadata.direction, 'East');
});

test('adaptDotCam: returns null on missing imageUrl', () => {
  assert.equal(
    adaptDotCam({ id: 'x', title: 't', state: 'NY', lat: 1, lon: 1, imageUrl: '' }),
    null,
  );
});

test('adaptDotCam: returns null on (0,0) coords (placeholder)', () => {
  assert.equal(
    adaptDotCam({ id: 'x', title: 't', state: 'NY', lat: 0, lon: 0, imageUrl: 'x' }),
    null,
  );
});

test('adaptDotCam: returns null on NaN coords', () => {
  assert.equal(
    adaptDotCam({ id: 'x', title: 't', state: 'NY', lat: Number.NaN, lon: 1, imageUrl: 'x' }),
    null,
  );
});

test('adaptDotCams: filters bad rows and produces good ones', () => {
  const out = adaptDotCams([
    { id: 'a', title: 'A', state: 'CA', lat: 34, lon: -118, imageUrl: 'a' },
    { id: 'b', title: 'B', state: 'CA', lat: 0, lon: 0, imageUrl: 'b' },
    null as unknown as never,
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, 'DOT:CA:a');
});

// ── parseWaCameras ──────────────────────────────────────────────────────

test('parseWaCameras: parses WSDOT shape', () => {
  const out = parseWaCameras([
    {
      CameraID: 9999,
      Title: 'I-5 NB at Tacoma',
      CameraLocation: { Latitude: 47.25, Longitude: -122.44, Direction: 'NB', RoadName: 'I-5' },
      ImageURL: 'https://wsdot.example/cam9999.jpg',
      IsActive: true,
    },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.state, 'WA');
  assert.equal(out[0]?.id, '9999');
  assert.equal(out[0]?.lat, 47.25);
});

test('parseWaCameras: drops inactive cameras', () => {
  const out = parseWaCameras([
    {
      CameraID: 1,
      Title: 'X',
      CameraLocation: { Latitude: 47, Longitude: -122 },
      ImageURL: 'x',
      IsActive: false,
    },
  ]);
  assert.equal(out.length, 0);
});

test('parseWaCameras: tolerates non-array payload', () => {
  assert.equal(parseWaCameras(null).length, 0);
  assert.equal(parseWaCameras({ error: 'x' }).length, 0);
});

// ── parseCoCameras ──────────────────────────────────────────────────────

test('parseCoCameras: parses cotrip flat shape', () => {
  const out = parseCoCameras([
    {
      id: 'co-1',
      description: 'I-70 EB Vail',
      latitude: 39.64,
      longitude: -106.37,
      imageURL: 'https://cotrip.example/co-1.jpg',
      routeName: 'I-70',
    },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.state, 'CO');
  assert.equal(out[0]?.title, 'I-70 EB Vail');
});

test('parseCoCameras: parses GeoJSON Feature shape', () => {
  const out = parseCoCameras({
    features: [
      {
        properties: { id: 'co-2', description: 'Loveland Pass', imageUrl: 'x' },
        geometry: { coordinates: [-105.88, 39.67] },
      },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]?.lat, 39.67);
});

// ── parseFlCameras ──────────────────────────────────────────────────────

test('parseFlCameras: parses fl511 shape (PascalCase)', () => {
  const out = parseFlCameras([
    {
      Id: 'fl-1',
      Description: 'I-95 SB Jacksonville',
      Latitude: 30.33,
      Longitude: -81.66,
      Url: 'https://fl511.example/fl-1.jpg',
      Roadway: 'I-95',
    },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.state, 'FL');
  assert.equal(out[0]?.imageUrl, 'https://fl511.example/fl-1.jpg');
});

test('parseFlCameras: parses fl511 shape (camelCase fallback)', () => {
  const out = parseFlCameras({
    cameras: [
      {
        id: 'fl-2',
        description: 'Tampa I-275',
        latitude: 27.95,
        longitude: -82.46,
        imageUrl: 'https://fl511.example/fl-2.jpg',
      },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, 'fl-2');
});

test('parseFlCameras: drops cams missing image URL', () => {
  const out = parseFlCameras([
    { Id: 'x', Latitude: 27, Longitude: -82 },
  ]);
  assert.equal(out.length, 0);
});
