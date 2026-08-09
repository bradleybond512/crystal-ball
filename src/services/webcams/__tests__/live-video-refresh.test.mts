import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchLiveVideoInfo } from '../../live-news.ts';

test('fetchLiveVideoInfo force refresh bypasses both memory and HTTP caches', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<RequestInit | undefined> = [];
  let videoId = 'CachedVid01';
  globalThis.fetch = async (_input, init) => {
    calls.push(init);
    return Response.json({ videoId, hlsUrl: null });
  };

  try {
    const channel = `@retry-test-${Date.now()}`;
    assert.equal((await fetchLiveVideoInfo(channel)).videoId, 'CachedVid01');
    videoId = 'FreshVid001';
    assert.equal((await fetchLiveVideoInfo(channel)).videoId, 'CachedVid01');
    assert.equal(calls.length, 1, 'normal lookup should reuse the memory cache');

    assert.equal((await fetchLiveVideoInfo(channel, true)).videoId, 'FreshVid001');
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.cache, 'no-store');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
