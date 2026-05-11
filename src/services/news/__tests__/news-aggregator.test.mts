import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeArticle,
  aggregateHeadlines,
  classifyTopic,
  isBreaking,
  BREAKING_AGE_MS,
} from '../news-aggregator.ts';

const NOW = Date.UTC(2026, 4, 11, 12, 0, 0);

// ── classifyTopic ─────────────────────────────────────────────────────

test('classify: cyber-breach title → security', () => {
  assert.equal(classifyTopic('Massive ransomware breach hits hospital', 'https://ex.com/a', 'reuters'), 'security');
});

test('classify: NATO + sanction → geopolitical', () => {
  assert.equal(classifyTopic('NATO debates new sanctions on Iran', 'https://ex.com/b', 'bbc'), 'geopolitical');
});

test('classify: earthquake + tsunami → natural_disasters', () => {
  assert.equal(classifyTopic('M7 earthquake triggers tsunami warning', 'https://ex.com/c', 'usgs'), 'natural_disasters');
});

test('classify: inflation + Fed → economic', () => {
  assert.equal(classifyTopic('Fed signals rate cut as inflation eases', 'https://ex.com/d', 'wsj'), 'economic');
});

test('classify: outbreak + WHO → health', () => {
  assert.equal(classifyTopic('WHO confirms new measles outbreak', 'https://ex.com/e', 'who.int'), 'health');
});

test('classify: unrelated headline → general', () => {
  assert.equal(classifyTopic('Local bakery wins regional pastry award', 'https://ex.com/f', 'townpaper'), 'general');
});

// ── normalizeArticle ──────────────────────────────────────────────────

test('normalize: title + url required; missing fields → null', () => {
  assert.equal(normalizeArticle({ title: 'X' }), null);
  assert.equal(normalizeArticle({ url: 'https://x.com/a' }), null);
});

test('normalize: GDELT seendate parsed to ms epoch', () => {
  const a = normalizeArticle({
    title: 'NATO summit opens',
    url: 'https://example.com/nato',
    domain: 'reuters.com',
    country: 'BE',
    seendate: '20260511T093000Z',
  });
  assert.ok(a);
  assert.equal(a!.publishedAt, Date.UTC(2026, 4, 11, 9, 30, 0));
  assert.equal(a!.source, 'reuters.com');
  assert.equal(a!.topic, 'geopolitical');
});

test('normalize: ms-epoch number and ISO string both accepted', () => {
  const fromEpoch = normalizeArticle({ title: 'x', url: 'https://e.com/1', timestamp: NOW });
  const fromIso = normalizeArticle({ title: 'x', url: 'https://e.com/2', publishedAt: '2026-05-11T12:00:00Z' });
  assert.equal(fromEpoch!.publishedAt, NOW);
  assert.equal(fromIso!.publishedAt, NOW);
});

test('normalize: seconds-since-epoch (e.g. 1746957600) is rescaled to ms', () => {
  const seconds = Math.floor(NOW / 1000);
  const a = normalizeArticle({ title: 'x', url: 'https://e.com/3', timestamp: seconds });
  assert.equal(a!.publishedAt, NOW);
});

test('normalize: id strips the query string + lowercases the URL', () => {
  const a = normalizeArticle({ title: 'X', url: 'https://Example.com/Story?utm=foo' });
  assert.equal(a!.id, 'https://example.com/story');
});

// ── aggregateHeadlines ────────────────────────────────────────────────

const F1 = [
  { title: 'Earthquake hits Japan', url: 'https://a.com/1', timestamp: NOW - 10 * 60_000 },
  { title: 'Cyberattack on hospital', url: 'https://a.com/2', timestamp: NOW - 5 * 60_000 },
];
const F2 = [
  { title: 'EU summit opens', url: 'https://b.com/1', timestamp: NOW - 2 * 60_000 },
  // duplicate of F1[1] with a newer timestamp + longer title — should win:
  { title: 'Cyberattack on hospital network in Belgium', url: 'https://A.com/2?utm=2', timestamp: NOW - 1 * 60_000 },
];

test('aggregate: dedups across feeds by url, keeping the newer + longer-title version', () => {
  const out = aggregateHeadlines([F1, F2]);
  const cyber = out.find((a) => a.id === 'https://a.com/2')!;
  assert.equal(cyber.title, 'Cyberattack on hospital network in Belgium');
  assert.equal(cyber.publishedAt, NOW - 1 * 60_000);
});

test('aggregate: results sorted newest first', () => {
  const out = aggregateHeadlines([F1, F2]);
  for (let i = 1; i < out.length; i++) {
    assert.ok((out[i - 1]!.publishedAt ?? 0) >= (out[i]!.publishedAt ?? 0));
  }
});

test('aggregate: topic filter narrows results', () => {
  const out = aggregateHeadlines([F1, F2], { topic: 'security' });
  assert.ok(out.every((a) => a.topic === 'security'));
  assert.ok(out.length >= 1);
});

test('aggregate: query filter substring-matches the title', () => {
  const out = aggregateHeadlines([F1, F2], { query: 'earthquake' });
  assert.equal(out.length, 1);
  assert.match(out[0]!.title, /Earthquake/);
});

test('aggregate: honors limit', () => {
  const out = aggregateHeadlines([F1, F2], { limit: 1 });
  assert.equal(out.length, 1);
});

test('aggregate: empty feeds return []', () => {
  assert.deepEqual(aggregateHeadlines([]), []);
  assert.deepEqual(aggregateHeadlines([[], []]), []);
});

test('aggregate: invalid rows (no title/url) are dropped silently', () => {
  const out = aggregateHeadlines([[{ title: 'x' }, { url: 'https://e.com' }, { title: 'ok', url: 'https://e.com/ok', timestamp: NOW }]]);
  assert.equal(out.length, 1);
});

// ── isBreaking ────────────────────────────────────────────────────────

test('breaking: article within 30 min is breaking', () => {
  const a = normalizeArticle({ title: 't', url: 'https://e.com/x', timestamp: NOW - 5 * 60_000 })!;
  assert.equal(isBreaking(a, NOW), true);
});

test('breaking: older than 30 min is not breaking', () => {
  const a = normalizeArticle({ title: 't', url: 'https://e.com/x', timestamp: NOW - BREAKING_AGE_MS - 1 })!;
  assert.equal(isBreaking(a, NOW), false);
});

test('breaking: null publishedAt is not breaking', () => {
  const a = normalizeArticle({ title: 't', url: 'https://e.com/x' })!;
  assert.equal(isBreaking(a, NOW), false);
});
