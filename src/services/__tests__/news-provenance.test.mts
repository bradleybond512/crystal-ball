import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  acquisitionAge, newsDeliveryGroup, normalizeAcquisition,
  normalizeNewsProvenance, publicationMetadata,
  newsAcquisitionToProto, newsProvenanceToProto,
} from '../news-provenance.ts';

const NOW = Date.parse('2026-10-30T12:00:00Z');

test('legacy and malformed metadata never acquire receipt or cache-write times', () => {
  assert.deepEqual(normalizeAcquisition({ timestamp: NOW, cachedAt: NOW }, NOW), {
    outcome: 'unknown', delivery: 'unknown', attemptedAt: null,
    acquiredAt: null, cacheStoredAt: null, acceptedCount: 0,
  });
  const result = normalizeAcquisition({
    outcome: 'timeout', delivery: 'persistent_cache', acceptedCount: 3,
    attemptedAt: NOW, cacheStoredAt: NOW - 1000,
  }, NOW);
  assert.equal(result.acquiredAt, null);
  assert.equal(result.outcome, 'timeout');
  assert.equal(result.delivery, 'persistent_cache');
  assert.equal(result.acceptedCount, 3);
});

test('enum metadata is allowlisted and proto enum names normalize safely', () => {
  const result = normalizeAcquisition({
    outcome: 'NEWS_OUTCOME_RATE_LIMITED', delivery: 'NEWS_DELIVERY_SERVER_CACHE',
    attemptedAt: NOW, acquiredAt: NOW - 500, cacheStoredAt: NOW - 400, acceptedCount: 2,
  }, NOW);
  assert.equal(result.outcome, 'rate_limited');
  assert.equal(result.delivery, 'server_cache');
  assert.equal(result.acquiredAt, NOW - 500);
  for (const acceptedCount of [-1, 1.5, NaN, Infinity, '3']) {
    assert.equal(normalizeAcquisition({ outcome: 'green', delivery: 'live', acceptedCount }, NOW).acceptedCount, 0);
  }
  assert.equal(normalizeAcquisition({ outcome: 'green' }, NOW).outcome, 'unknown');
  assert.equal(normalizeAcquisition({ delivery: 'live' }, NOW).delivery, 'unknown');
});

test('invalid and future timestamps stay unknown and acquisition age is not invented', () => {
  for (const value of [0, -1, NaN, Infinity, '2026-10-30', NOW + 1]) {
    assert.equal(normalizeAcquisition({ acquiredAt: value, attemptedAt: value, cacheStoredAt: value }, NOW).acquiredAt, null);
  }
  assert.equal(acquisitionAge({ acquiredAt: null }, NOW), null);
  assert.equal(acquisitionAge({ acquiredAt: NOW + 1 }, NOW), null);
  assert.equal(acquisitionAge({ acquiredAt: NOW - 7_200_000 }, NOW), 7_200_000);
});

test('publication truth distinguishes absent, malformed, future, and known dates', () => {
  for (const value of [null, undefined, '', '   ']) {
    assert.deepEqual(publicationMetadata(value, NOW), { publicationState: 'missing', publishedAt: null });
  }
  for (const value of ['not-a-date', {}, NaN, 0]) {
    assert.deepEqual(publicationMetadata(value, NOW), { publicationState: 'invalid', publishedAt: null });
  }
  assert.deepEqual(publicationMetadata(NOW + 1, NOW), { publicationState: 'unknown', publishedAt: null });
  assert.deepEqual(publicationMetadata('2026-10-30T11:00:00Z', NOW), {
    publicationState: 'known', publishedAt: NOW - 3_600_000,
  });
});

test('delivery groups come from configured URL hostname or fixed provider', () => {
  assert.equal(newsDeliveryGroup('https://news.google.com/rss/search?q=test'), 'google-rss');
  assert.equal(newsDeliveryGroup('https://feeds.Example.org/path'), 'rss-direct:feeds.example.org');
  assert.equal(newsDeliveryGroup('/api/rss-proxy?url=https%3A%2F%2Fnews.google.com%2Frss'), 'google-rss');
  assert.equal(newsDeliveryGroup('http://127.0.0.1:1234/api/rss-proxy?url=https%3A%2F%2Ffeeds.example.org%2Frss'), 'rss-direct:feeds.example.org');
  assert.equal(newsDeliveryGroup('/api/rss-proxy?url=not-an-absolute-url'), 'unknown');
  assert.equal(newsDeliveryGroup('/api/rss-proxy?url=%2Fapi%2Frss-proxy%3Furl%3Dhttps%253A%252F%252Fnews.google.com'), 'unknown');
  assert.equal(newsDeliveryGroup('gdelt'), 'gdelt');
  assert.equal(newsDeliveryGroup('newsapi'), 'newsapi');
  assert.equal(newsDeliveryGroup('newsdata'), 'newsdata');
  for (const value of ['https://news.google.com.evil.test/rss', 'file:///tmp/rss', 'publisher name', 'javascript:evil']) {
    assert.notEqual(newsDeliveryGroup(value), 'google-rss');
  }
  assert.equal(newsDeliveryGroup('publisher name'), 'unknown');
});

test('provenance never promotes a legacy publication or GDELT observation', () => {
  const unknown = normalizeNewsProvenance({ publishedAt: NOW - 1000, pubDate: NOW - 1000, observedAt: NOW - 1000 }, NOW);
  assert.equal(unknown.publicationState, 'unknown');
  assert.equal(unknown.publishedAt, null);
  assert.equal(unknown.observedAt, NOW - 1000);
  const known = normalizeNewsProvenance({
    sourceId: 'feed:one', deliveryGroup: 'rss-direct:feeds.example.org',
    publicationState: 'NEWS_PUBLICATION_STATE_KNOWN', publishedAt: NOW - 1000,
  }, NOW);
  assert.equal(known.publicationState, 'known');
  assert.equal(known.publishedAt, NOW - 1000);
  assert.equal(known.deliveryGroup, 'rss-direct:feeds.example.org');
  assert.equal(normalizeNewsProvenance({ publicationState: 'known', publishedAt: NOW + 1 }, NOW).publicationState, 'unknown');
});

test('protobuf serialization round-trips unknowns and retains explicit acquisition evidence', () => {
  const acquisition = normalizeAcquisition({
    outcome: 'ok', delivery: 'upstream', attemptedAt: NOW - 100,
    acquiredAt: NOW, acceptedCount: 2,
  }, NOW);
  const wire = newsAcquisitionToProto(acquisition, NOW);
  assert.equal(wire.outcome, 'NEWS_OUTCOME_OK');
  assert.equal('cacheStoredAt' in wire, false);
  assert.deepEqual(normalizeAcquisition(wire, NOW), acquisition);
  const unknown = normalizeNewsProvenance(undefined, NOW);
  const unknownWire = newsProvenanceToProto(unknown, NOW);
  assert.equal('publishedAt' in unknownWire, false);
  assert.equal('acquiredAt' in unknownWire, false);
  assert.deepEqual(normalizeNewsProvenance(unknownWire, NOW), unknown);
});
