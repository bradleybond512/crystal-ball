import assert from 'node:assert/strict';
import test from 'node:test';

import { adaptWindyResponse, adaptWindyWebcam } from '../windy-adapter.ts';

test('adaptWindyWebcam: parses canonical webcam', () => {
  const f = adaptWindyWebcam({
    webcamId: 12345,
    title: 'Vail Mountain — Patrol HQ',
    status: 'active',
    location: { latitude: 39.64, longitude: -106.37, city: 'Vail', country: 'United States', countryCode: 'US' },
    images: { current: { preview: 'https://windy.example/12345.jpg' } },
    player: { day: { embed: 'https://windy.example/embed/12345' } },
    categories: [{ name: 'Mountain' }],
  });
  assert.ok(f);
  assert.equal(f.source, 'WINDY');
  assert.equal(f.id, 'WINDY:12345');
  assert.equal(f.category, 'nature');
  assert.equal(f.metadata.city, 'Vail');
  assert.ok(f.streamUrl);
});

test('adaptWindyWebcam: drops inactive', () => {
  assert.equal(
    adaptWindyWebcam({
      webcamId: 1,
      status: 'inactive',
      location: { latitude: 1, longitude: 1 },
      images: { current: { preview: 'x' } },
    }),
    null,
  );
});

test('adaptWindyWebcam: drops on missing image', () => {
  assert.equal(
    adaptWindyWebcam({
      webcamId: 1,
      location: { latitude: 1, longitude: 1 },
      images: {},
    }),
    null,
  );
});

test('adaptWindyWebcam: drops on missing coords', () => {
  assert.equal(
    adaptWindyWebcam({
      webcamId: 1,
      location: {},
      images: { current: { preview: 'x' } },
    }),
    null,
  );
});

test('adaptWindyWebcam: traffic category from highway tags', () => {
  const f = adaptWindyWebcam({
    webcamId: 99,
    location: { latitude: 1, longitude: 1 },
    images: { current: { preview: 'x' } },
    categories: [{ name: 'Highway' }],
  });
  assert.equal(f?.category, 'traffic');
});

test('adaptWindyWebcam: coastal category from harbor tags', () => {
  const f = adaptWindyWebcam({
    webcamId: 100,
    location: { latitude: 1, longitude: 1 },
    images: { current: { preview: 'x' } },
    categories: [{ name: 'Harbor' }],
  });
  assert.equal(f?.category, 'coastal');
});

test('adaptWindyWebcam: defaults to weather category', () => {
  const f = adaptWindyWebcam({
    webcamId: 101,
    location: { latitude: 1, longitude: 1 },
    images: { current: { preview: 'x' } },
  });
  assert.equal(f?.category, 'weather');
});

test('adaptWindyResponse: handles { webcams: [...] } envelope', () => {
  const out = adaptWindyResponse({
    webcams: [
      {
        webcamId: 1,
        location: { latitude: 1, longitude: 1 },
        images: { current: { preview: 'x' } },
      },
      {
        webcamId: 2,
        location: { latitude: 2, longitude: 2 },
        images: { current: { preview: 'y' } },
      },
    ],
  });
  assert.equal(out.length, 2);
});

test('adaptWindyResponse: empty array on bad payload', () => {
  assert.equal(adaptWindyResponse(null).length, 0);
  assert.equal(adaptWindyResponse([]).length, 0);
});
