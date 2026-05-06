import assert from 'node:assert/strict';
import test from 'node:test';

import { adaptNpsResponse, adaptNpsWebcam } from '../nps-adapter.ts';

test('adaptNpsWebcam: parses canonical NPS shape', () => {
  const f = adaptNpsWebcam({
    id: 'GLAC-LMC',
    title: 'Logan Pass Visitor Center',
    description: 'View of the parking lot',
    status: 'Active',
    latitude: '48.6963',
    longitude: '-113.7178',
    images: [{ url: 'https://nps.example/glac-lmc.jpg' }],
    relatedParks: [{ fullName: 'Glacier National Park', parkCode: 'glac', states: 'MT' }],
  });
  assert.ok(f);
  assert.equal(f.source, 'NPS');
  assert.equal(f.category, 'nature');
  assert.equal(f.id, 'NPS:GLAC-LMC');
  assert.equal(f.metadata.park, 'Glacier National Park');
  assert.equal(f.metadata.states, 'MT');
});

test('adaptNpsWebcam: drops cams with status != active', () => {
  assert.equal(
    adaptNpsWebcam({
      id: 'X',
      status: 'Inactive',
      latitude: 1,
      longitude: 1,
      images: [{ url: 'x' }],
    }),
    null,
  );
});

test('adaptNpsWebcam: drops cams with no image URL', () => {
  assert.equal(
    adaptNpsWebcam({
      id: 'X',
      latitude: 1,
      longitude: 1,
      images: [],
    }),
    null,
  );
});

test('adaptNpsWebcam: parses string lat/lon', () => {
  const f = adaptNpsWebcam({
    id: 'X',
    latitude: '44.5',
    longitude: '-110.5',
    images: [{ url: 'x' }],
  });
  assert.equal(f?.lat, 44.5);
  assert.equal(f?.lon, -110.5);
});

test('adaptNpsResponse: handles { data: [...] } envelope', () => {
  const out = adaptNpsResponse({
    data: [
      { id: 'a', latitude: 1, longitude: 1, images: [{ url: 'x' }] },
      { id: 'b', latitude: 1, longitude: 1, images: [{ url: 'y' }] },
    ],
  });
  assert.equal(out.length, 2);
});

test('adaptNpsResponse: empty array for non-object', () => {
  assert.equal(adaptNpsResponse(null).length, 0);
  assert.equal(adaptNpsResponse([]).length, 0);
});
