import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sidecarParseYoutubeChannelFeed,
  sidecarParsePatreonAudioRss,
  patreonStateStore,
} from '../local-api-server.mjs';

test('sidecarParseYoutubeChannelFeed mirrors renderer parser', () => {
  const xml = '<feed><entry><yt:videoId>dQw4w9WgXcQ</yt:videoId><title>x</title><published>2026-06-01T00:00:00Z</published></entry></feed>';
  const items = sidecarParseYoutubeChannelFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].videoId, 'dQw4w9WgXcQ');
});

test('sidecarParseYoutubeChannelFeed returns [] on garbage', () => {
  assert.deepEqual(sidecarParseYoutubeChannelFeed('nope'), []);
});

test('sidecarParsePatreonAudioRss extracts audio enclosures', () => {
  const xml = '<rss><channel><item><title>x</title><enclosure url="https://c/1.mp3" type="audio/mpeg"/></item></channel></rss>';
  const eps = sidecarParsePatreonAudioRss(xml);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].audioUrl, 'https://c/1.mp3');
});

test('sidecarParsePatreonAudioRss ignores non-audio items', () => {
  assert.deepEqual(sidecarParsePatreonAudioRss('<rss><channel><item><title>x</title></item></channel></rss>'), []);
});

test('patreon OAuth state issue/consume is single-use', () => {
  const s = patreonStateStore.issue();
  assert.equal(typeof s, 'string');
  assert.equal(patreonStateStore.consume(s), true);
  assert.equal(patreonStateStore.consume(s), false);
});
