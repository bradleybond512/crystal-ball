import { strict as assert } from 'node:assert';
import test from 'node:test';
import { getPath, buildFeedsFromConfig } from '../webcam-config-loader.ts';
import type { WebcamSourceConfig } from '../webcam-config-loader.ts';

// ── getPath ──────────────────────────────────────────────────────────────────

test('getPath: simple one-level key', () => {
  assert.equal(getPath({ a: 1 }, 'a'), 1);
});

test('getPath: nested dotted path', () => {
  assert.equal(getPath({ a: { b: { c: 42 } } }, 'a.b.c'), 42);
});

test('getPath: numeric index into array', () => {
  assert.equal(getPath({ items: ['x', 'y', 'z'] }, 'items.1'), 'y');
});

test('getPath: numeric index then object key (items.0.cameras style)', () => {
  const obj = { items: [{ cameras: [{ id: '99' }] }] };
  const result = getPath(obj, 'items.0.cameras');
  assert.deepEqual(result, [{ id: '99' }]);
});

test('getPath: missing intermediate key returns undefined', () => {
  assert.equal(getPath({ a: {} }, 'a.b.c'), undefined);
});

test('getPath: null root returns undefined', () => {
  assert.equal(getPath(null, 'a'), undefined);
});

// ── buildFeedsFromConfig: json + arrayPath + dotted getters ─────────────────

const BASIC_CONFIG: WebcamSourceConfig = {
  id: 'CALTRANS',
  mode: 'json',
  url: 'https://example.com/cams.json',
  arrayPath: 'data',
  map: {
    id: 'cctv.index',
    name: 'cctv.location.locationName',
    lat: 'cctv.location.latitude',
    lon: 'cctv.location.longitude',
    snapshotUrl: 'cctv.imageData.static.currentImageURL',
    streamUrl: 'cctv.imageData.streamingVideoURL',
  },
  category: 'traffic',
  refreshIntervalSec: 60,
  metadata: { source: 'caltrans', district: 'd11' },
};

const BASIC_PAYLOAD = {
  data: [
    {
      cctv: {
        index: '1',
        location: {
          locationName: 'SR-163 Test Cam',
          latitude: '32.772',
          longitude: '-117.160',
        },
        imageData: {
          streamingVideoURL: 'https://wzmedia.dot.ca.gov/stream.m3u8',
          static: {
            currentImageURL: 'https://cwwp2.dot.ca.gov/image.jpg',
          },
        },
      },
    },
    {
      cctv: {
        index: '2',
        location: {
          locationName: 'SR-163 No Image',
          latitude: '32.760',
          longitude: '-117.163',
        },
        imageData: {
          static: {
            currentImageURL: '',
          },
        },
      },
    },
  ],
};

test('buildFeedsFromConfig: extracts feed from json payload with dotted paths', () => {
  const feeds = buildFeedsFromConfig(BASIC_CONFIG, [BASIC_PAYLOAD]);
  assert.equal(feeds.length, 1, 'empty snapshotUrl row should be dropped');
  const [f] = feeds;
  assert.ok(f);
  assert.equal(f.id, 'CALTRANS:1');
  assert.equal(f.name, 'SR-163 Test Cam');
  assert.equal(f.source, 'CALTRANS');
  assert.equal(f.category, 'traffic');
  assert.equal(f.refreshIntervalSec, 60);
  assert.deepEqual(f.metadata, { source: 'caltrans', district: 'd11' });
});

test('buildFeedsFromConfig: string coords parsed to finite numbers', () => {
  const feeds = buildFeedsFromConfig(BASIC_CONFIG, [BASIC_PAYLOAD]);
  const [f] = feeds;
  assert.ok(f);
  assert.equal(typeof f.lat, 'number');
  assert.equal(typeof f.lon, 'number');
  assert.ok(Number.isFinite(f.lat));
  assert.ok(Number.isFinite(f.lon));
  assert.ok(Math.abs(f.lat - 32.772) < 0.001);
  assert.ok(Math.abs(f.lon - -117.160) < 0.001);
});

test('buildFeedsFromConfig: .m3u8 streamUrl → streamType hls', () => {
  const feeds = buildFeedsFromConfig(BASIC_CONFIG, [BASIC_PAYLOAD]);
  const [f] = feeds;
  assert.ok(f);
  assert.equal(f.streamUrl, 'https://wzmedia.dot.ca.gov/stream.m3u8');
  assert.equal(f.streamType, 'hls');
});

test('buildFeedsFromConfig: no streamUrl → streamType snapshot', () => {
  const payload = {
    data: [
      {
        cctv: {
          index: '3',
          location: { locationName: 'No Stream', latitude: '34.0', longitude: '-118.0' },
          imageData: { static: { currentImageURL: 'https://example.com/img.jpg' } },
        },
      },
    ],
  };
  const feeds = buildFeedsFromConfig(BASIC_CONFIG, [payload]);
  const [f] = feeds;
  assert.ok(f);
  assert.equal(f.streamUrl, undefined);
  assert.equal(f.streamType, 'snapshot');
});

// ── function getter ──────────────────────────────────────────────────────────

test('buildFeedsFromConfig: function getter for snapshotUrl', () => {
  interface TflRow {
    id: string;
    commonName: string;
    lat: number;
    lon: number;
    additionalProperties: Array<{ key: string; value: string }>;
  }
  const CONFIG_FN: WebcamSourceConfig = {
    id: 'TFL',
    mode: 'json',
    url: 'https://api.tfl.gov.uk/Place/Type/JamCam',
    map: {
      id: (row) => `TFL:${(row as TflRow).id}`,
      name: 'commonName',
      lat: 'lat',
      lon: 'lon',
      snapshotUrl: (row) => {
        const r = row as TflRow;
        return r.additionalProperties.find((p) => p.key === 'imageUrl')?.value ?? '';
      },
    },
    category: 'traffic',
    refreshIntervalSec: 60,
  };

  const payload = [
    {
      id: 'JamCams_00001.00865',
      commonName: 'A406 Test',
      lat: 51.600,
      lon: -0.015,
      additionalProperties: [
        { key: 'imageUrl', value: 'https://s3.amazonaws.com/jamcams.tfl.gov.uk/00001.00865.jpg' },
      ],
    },
  ];

  const feeds = buildFeedsFromConfig(CONFIG_FN, [payload]);
  assert.equal(feeds.length, 1);
  const [f] = feeds;
  assert.ok(f);
  assert.equal(f.id, 'TFL:TFL:JamCams_00001.00865');
  assert.equal(f.snapshotUrl, 'https://s3.amazonaws.com/jamcams.tfl.gov.uk/00001.00865.jpg');
  assert.equal(f.streamType, 'snapshot');
});

// ── fan-out over multiple payloads ───────────────────────────────────────────

test('buildFeedsFromConfig: fan-out over multiple payloads', () => {
  const makePayload = (index: string, lat: string, lon: string) => ({
    data: [
      {
        cctv: {
          index,
          location: { locationName: `Cam ${index}`, latitude: lat, longitude: lon },
          imageData: { static: { currentImageURL: `https://example.com/${index}.jpg` } },
        },
      },
    ],
  });

  const feeds = buildFeedsFromConfig(BASIC_CONFIG, [
    makePayload('10', '34.0', '-118.0'),
    makePayload('11', '34.1', '-118.1'),
    makePayload('12', '34.2', '-118.2'),
  ]);
  assert.equal(feeds.length, 3);
  assert.equal(feeds[0]?.id, 'CALTRANS:10');
  assert.equal(feeds[1]?.id, 'CALTRANS:11');
  assert.equal(feeds[2]?.id, 'CALTRANS:12');
});

// ── onlineWhen filter ────────────────────────────────────────────────────────

test('buildFeedsFromConfig: onlineWhen=false drops the row', () => {
  const config: WebcamSourceConfig = {
    ...BASIC_CONFIG,
    onlineWhen: (row) => {
      const r = row as { cctv?: { inService?: string } };
      return r?.cctv?.inService === 'true';
    },
  };

  const payload = {
    data: [
      {
        cctv: {
          index: '1',
          inService: 'false',
          location: { locationName: 'Offline Cam', latitude: '32.0', longitude: '-117.0' },
          imageData: { static: { currentImageURL: 'https://example.com/img.jpg' } },
        },
      },
      {
        cctv: {
          index: '2',
          inService: 'true',
          location: { locationName: 'Online Cam', latitude: '32.5', longitude: '-117.5' },
          imageData: { static: { currentImageURL: 'https://example.com/img2.jpg' } },
        },
      },
    ],
  };

  const feeds = buildFeedsFromConfig(config, [payload]);
  assert.equal(feeds.length, 1);
  assert.equal(feeds[0]?.id, 'CALTRANS:2');
});

// ── drop rows with invalid coords ────────────────────────────────────────────

test('buildFeedsFromConfig: drops rows with non-finite coords', () => {
  const payload = {
    data: [
      {
        cctv: {
          index: '5',
          location: { locationName: 'Bad Coords', latitude: 'not-a-number', longitude: 'bad' },
          imageData: { static: { currentImageURL: 'https://example.com/img.jpg' } },
        },
      },
    ],
  };
  const feeds = buildFeedsFromConfig(BASIC_CONFIG, [payload]);
  assert.equal(feeds.length, 0);
});
