import assert from 'node:assert/strict';
import test from 'node:test';

import {
  catalogFromResponse,
  clearWebcamCatalogCache,
  fetchUnifiedWebcams,
} from '../fetcher.ts';
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

test('fetchUnifiedWebcams allows a cold catalog request to outlive the generic API timeout', async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeoutDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
  assert.ok(originalTimeoutDescriptor);
  const timeoutController = new AbortController();
  let timeoutMs: number | undefined;
  let receivedSignal: AbortSignal | null | undefined;

  Object.defineProperty(AbortSignal, 'timeout', {
    configurable: true,
    value: (ms: number) => {
      timeoutMs = ms;
      return timeoutController.signal;
    },
  });
  globalThis.fetch = (async (_input, init) => {
    receivedSignal = init?.signal;
    return Response.json({ feeds: [feed()], updatedAt: 4000 });
  }) as typeof fetch;

  try {
    const catalog = await fetchUnifiedWebcams();
    assert.equal(catalog.feeds.length, 1);
    assert.equal(timeoutMs, 30_000);
    assert.equal(receivedSignal, timeoutController.signal);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(AbortSignal, 'timeout', originalTimeoutDescriptor);
    clearWebcamCatalogCache();
  }
});

test('fetchUnifiedWebcams surfaces an HTTP failure when no cached catalog exists', async () => {
  const originalFetch = globalThis.fetch;
  clearWebcamCatalogCache();
  globalThis.fetch = (async () => Response.json(
    { error: 'catalog unavailable' },
    { status: 503 },
  )) as typeof fetch;

  try {
    await assert.rejects(fetchUnifiedWebcams(), /Webcam catalog request failed: HTTP 503/);
  } finally {
    globalThis.fetch = originalFetch;
    clearWebcamCatalogCache();
  }
});

test('fetchUnifiedWebcams preserves explicit caller cancellation', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let receivedSignal: AbortSignal | null | undefined;
  clearWebcamCatalogCache();
  globalThis.fetch = (async (_input, init) => {
    receivedSignal = init?.signal;
    return Response.json({ feeds: [feed()], updatedAt: 5000 });
  }) as typeof fetch;

  try {
    await fetchUnifiedWebcams({ signal: controller.signal });
    assert.equal(receivedSignal, controller.signal);
  } finally {
    globalThis.fetch = originalFetch;
    clearWebcamCatalogCache();
  }
});
