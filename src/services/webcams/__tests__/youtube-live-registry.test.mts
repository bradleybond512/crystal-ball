import assert from 'node:assert/strict';
import test from 'node:test';

import {
  YOUTUBE_LIVE_FEEDS,
  feedsForRegion,
} from '../youtube-live-registry.ts';

test('YOUTUBE_LIVE_FEEDS contains exactly 22 entries', () => {
  assert.equal(YOUTUBE_LIVE_FEEDS.length, 22);
});

test('feedsForRegion("iran") returns only iran entries', () => {
  const feeds = feedsForRegion('iran');
  assert.ok(feeds.length > 0, 'should have at least one iran feed');
  for (const f of feeds) {
    assert.equal(f.region, 'iran');
  }
});

test('feedsForRegion("all") returns all feeds', () => {
  const feeds = feedsForRegion('all');
  assert.equal(feeds.length, YOUTUBE_LIVE_FEEDS.length);
});

test('feedsForRegion("") returns all feeds', () => {
  const feeds = feedsForRegion('');
  assert.equal(feeds.length, YOUTUBE_LIVE_FEEDS.length);
});

test('every entry has a non-empty fallbackVideoId', () => {
  for (const f of YOUTUBE_LIVE_FEEDS) {
    assert.ok(
      typeof f.fallbackVideoId === 'string' && f.fallbackVideoId.length > 0,
      `${f.id} has empty fallbackVideoId`,
    );
  }
});
