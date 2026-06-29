import assert from 'node:assert/strict';
import test from 'node:test';

import { catalogFromResponse } from '../fetcher.ts';
import type { WebcamFeed } from '../webcam-types.ts';

function feed(overrides: Partial<WebcamFeed> = {}): WebcamFeed {
  return {
    id: 'cam-1',
    source: 'FAA',
    name: 'Test Cam',
    lat: 41.6,
    lon: -86.7,
    snapshotUrl: 'https://example.com/cam.jpg',
    refreshIntervalSec: 60,
    category: 'weather',
    metadata: {},
    ...overrides,
  };
}

test('catalogFromResponse: builds catalog with feeds + bySource + sourceHealth', () => {
  const data = {
    feeds: [feed()],
    sourceHealth: [{ source: 'WINDY' as const, status: 'missing_key' as const, count: 0, needsKey: true, lastChecked: 1 }],
    updatedAt: 1000,
  };
  const catalog = catalogFromResponse(data);
  assert.equal(catalog.feeds.length, 1);
  assert.ok(catalog.bySource['FAA']?.length === 1);
  assert.equal(catalog.sourceHealth?.[0].status, 'missing_key');
});

test('catalogFromResponse: omits sourceHealth when absent', () => {
  const data = { feeds: [feed()], updatedAt: 2000 };
  const catalog = catalogFromResponse(data);
  assert.equal(catalog.feeds.length, 1);
  assert.equal(catalog.sourceHealth, undefined);
});

test('catalogFromResponse: handles empty feeds', () => {
  const data = { feeds: [], sourceHealth: [], updatedAt: 3000 };
  const catalog = catalogFromResponse(data);
  assert.equal(catalog.feeds.length, 0);
  assert.deepEqual(catalog.sourceHealth, []);
});
