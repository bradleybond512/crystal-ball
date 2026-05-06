import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adaptAlertWildfireCamera,
  adaptAlertWildfireResponse,
} from '../alertwildfire-adapter.ts';

test('adaptAlertWildfireCamera: parses canonical shape', () => {
  const f = adaptAlertWildfireCamera({
    name: 'Axis-Glass-Mtn-Lookout',
    latitude: 41.6,
    longitude: -121.5,
    state: 'CA',
    region: 'Modoc',
    active: true,
    imageUrl: 'https://cameras.alertwildfire.org/example.jpg',
    streamUrl: 'https://cameras.alertwildfire.org/example.m3u8',
    ptz: true,
  });
  assert.ok(f);
  assert.equal(f.source, 'ALERTWILDFIRE');
  assert.equal(f.category, 'fire');
  assert.equal(f.id, 'ALERTWILDFIRE:Axis-Glass-Mtn-Lookout');
  assert.equal(f.metadata.state, 'CA');
  assert.equal(f.metadata.ptz, 'true');
  assert.ok(f.streamUrl);
});

test('adaptAlertWildfireCamera: drops inactive cameras', () => {
  assert.equal(
    adaptAlertWildfireCamera({
      name: 'X',
      latitude: 1,
      longitude: 1,
      active: false,
      imageUrl: 'x',
    }),
    null,
  );
});

test('adaptAlertWildfireCamera: drops cameras with status: offline', () => {
  assert.equal(
    adaptAlertWildfireCamera({
      name: 'X',
      latitude: 1,
      longitude: 1,
      status: 'offline',
      imageUrl: 'x',
    }),
    null,
  );
});

test('adaptAlertWildfireCamera: synthesizes snapshotUrl when missing', () => {
  const f = adaptAlertWildfireCamera({
    name: 'cam-1',
    latitude: 1,
    longitude: 1,
    active: true,
  });
  assert.ok(f);
  assert.ok(f.snapshotUrl.includes('cam-1'));
  assert.ok(f.snapshotUrl.includes('latest-frame.jpg'));
});

test('adaptAlertWildfireCamera: drops on missing name', () => {
  assert.equal(
    adaptAlertWildfireCamera({
      latitude: 1,
      longitude: 1,
      active: true,
      imageUrl: 'x',
    }),
    null,
  );
});

test('adaptAlertWildfireResponse: handles GeoJSON Feature shape', () => {
  const out = adaptAlertWildfireResponse({
    features: [
      {
        properties: { name: 'cam-a', state: 'OR' },
        geometry: { coordinates: [-120, 45] },
      },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]?.lat, 45);
  assert.equal(out[0]?.lon, -120);
});

test('adaptAlertWildfireResponse: handles bare array', () => {
  const out = adaptAlertWildfireResponse([
    { name: 'a', latitude: 1, longitude: 1, active: true, imageUrl: 'x' },
  ]);
  assert.equal(out.length, 1);
});

test('adaptAlertWildfireResponse: handles { cameras: [...] } envelope', () => {
  const out = adaptAlertWildfireResponse({
    cameras: [
      { name: 'a', latitude: 1, longitude: 1, active: true, imageUrl: 'x' },
      { name: 'b', latitude: 2, longitude: 2, active: true, imageUrl: 'y' },
    ],
  });
  assert.equal(out.length, 2);
});
