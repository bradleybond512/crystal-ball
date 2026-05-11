import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeSignalWatch,
  parseSignalListing,
  type RedditListing,
  type SignalPost,
} from '../signal-watch.ts';

const NOW_SEC = 1_745_000_000;
const HOUR = 3600;

function post(id: string, ageSec: number): SignalPost {
  return {
    id,
    title: `t ${id}`,
    subreddit: 's',
    url: `https://www.reddit.com/r/s/${id}/`,
    createdAt: NOW_SEC - ageSec,
    score: 0,
    comments: 0,
    author: 'a',
  };
}

test('parseSignalListing: drops malformed entries', () => {
  const listing: RedditListing = {
    data: {
      children: [
        { data: { id: 'a', title: 't', subreddit: 's', permalink: '/r/s/a/', created_utc: 1700000000 } },
        { data: { id: 'b' } },
        { data: { title: 'no id', subreddit: 'x', permalink: '/x/', created_utc: 1 } },
      ],
    },
  };
  const out = parseSignalListing(listing);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 'a');
});

test('parseSignalListing: sorted newest-first', () => {
  const listing: RedditListing = {
    data: {
      children: [
        { data: { id: 'old', title: 't', subreddit: 's', permalink: '/p/old', created_utc: 1 } },
        { data: { id: 'new', title: 't', subreddit: 's', permalink: '/p/new', created_utc: 100 } },
        { data: { id: 'mid', title: 't', subreddit: 's', permalink: '/p/mid', created_utc: 50 } },
      ],
    },
  };
  const out = parseSignalListing(listing);
  assert.deepEqual(out.map((p) => p.id), ['new', 'mid', 'old']);
});

test('parseSignalListing: empty listing → empty', () => {
  assert.deepEqual(parseSignalListing({}), []);
  assert.deepEqual(parseSignalListing({ data: { children: [] } }), []);
});

test('computeSignalWatch: empty posts → all zeros, normal', () => {
  const r = computeSignalWatch('k', [], NOW_SEC);
  assert.equal(r.lastHourCount, 0);
  assert.equal(r.baselineRate, 0);
  assert.equal(r.surgeLevel, 'normal');
  assert.equal(r.totalSeen, 0);
});

test('computeSignalWatch: 5 posts in last hour, 0 baseline → spike', () => {
  const posts = [
    post('a', 5 * 60),
    post('b', 10 * 60),
    post('c', 20 * 60),
    post('d', 30 * 60),
    post('e', 50 * 60),
  ];
  const r = computeSignalWatch('k', posts, NOW_SEC);
  assert.equal(r.lastHourCount, 5);
  assert.equal(r.baselineRate, 0);
  // 5 / max(0, 0.1) = 50, which is well above 5 (spike threshold)
  assert.equal(r.surgeLevel, 'spike');
});

test('computeSignalWatch: matched baseline → normal', () => {
  // 1 post per hour for the last 24h
  const posts: SignalPost[] = [];
  for (let i = 0; i < 24; i++) {
    posts.push(post(`p${i}`, i * HOUR + 60));
  }
  const r = computeSignalWatch('k', posts, NOW_SEC);
  assert.equal(r.lastHourCount, 1);
  assert.equal(r.baselineRate, 1); // 23 prior posts / 23 hours
  assert.equal(r.surgeRatio, 1);
  assert.equal(r.surgeLevel, 'normal');
});

test('computeSignalWatch: 2x baseline → elevated band', () => {
  const posts: SignalPost[] = [
    // 2 posts in last hour
    post('a', 10 * 60),
    post('b', 50 * 60),
  ];
  // ~1.04 baseline (24 prior posts / 23 hours)
  for (let i = 0; i < 24; i++) {
    posts.push(post(`p${i}`, (i + 2) * HOUR + 60));
  }
  const r = computeSignalWatch('k', posts, NOW_SEC);
  assert.equal(r.lastHourCount, 2);
  // Surge ratio about 2/1.04 = 1.92 → elevated
  assert.equal(r.surgeLevel, 'elevated');
});

test('computeSignalWatch: 3x baseline → surge band', () => {
  const posts: SignalPost[] = [
    post('a', 5 * 60), post('b', 15 * 60), post('c', 25 * 60),
  ];
  for (let i = 0; i < 24; i++) {
    posts.push(post(`p${i}`, (i + 2) * HOUR + 60));
  }
  const r = computeSignalWatch('k', posts, NOW_SEC);
  assert.equal(r.lastHourCount, 3);
  // 3 / 1.04 ≈ 2.88 → surge band
  assert.equal(r.surgeLevel, 'surge');
});

test('computeSignalWatch: returns up to 10 recent', () => {
  const posts: SignalPost[] = [];
  for (let i = 0; i < 25; i++) posts.push(post(`p${i}`, i * 60));
  const r = computeSignalWatch('k', posts, NOW_SEC);
  assert.equal(r.recent.length, 10);
  assert.equal(r.totalSeen, 25);
});

test('computeSignalWatch: posts older than 24h are excluded from baseline', () => {
  const posts: SignalPost[] = [
    post('recent', 30 * 60),
    post('day-old', 25 * HOUR), // older than 24h, should not affect baseline
  ];
  const r = computeSignalWatch('k', posts, NOW_SEC);
  assert.equal(r.lastHourCount, 1);
  assert.equal(r.baselineRate, 0);
});
