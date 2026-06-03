import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseYoutubeChannelFeed,
  parsePatreonAudioRss,
  parsePatreonIdentity,
} from '../s2-underground-media.ts';

const ATOM = `<?xml version="1.0"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <entry>
  <yt:videoId>dQw4w9WgXcQ</yt:videoId>
  <title>Global Intelligence Summary - 01 JUN</title>
  <published>2026-06-01T12:00:00+00:00</published>
  <media:group><media:thumbnail url="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"/></media:group>
 </entry>
</feed>`;

describe('parseYoutubeChannelFeed', () => {
  it('extracts video items', () => {
    const items = parseYoutubeChannelFeed(ATOM);
    assert.equal(items.length, 1);
    assert.equal(items[0]!.videoId, 'dQw4w9WgXcQ');
    assert.equal(items[0]!.title, 'Global Intelligence Summary - 01 JUN');
    assert.equal(items[0]!.thumbnail, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.ok(items[0]!.published.startsWith('2026-06-01'));
  });
  it('returns [] on garbage', () => {
    assert.deepEqual(parseYoutubeChannelFeed('not xml'), []);
  });
});

const RSS = `<rss><channel>
 <item>
  <title>Patron Brief 12</title>
  <pubDate>Mon, 01 Jun 2026 12:00:00 GMT</pubDate>
  <enclosure url="https://cdn.patreon.com/a/12.mp3?token=abc" type="audio/mpeg" length="123"/>
  <itunes:duration>1830</itunes:duration>
 </item>
</channel></rss>`;

describe('parsePatreonAudioRss', () => {
  it('extracts audio episodes', () => {
    const eps = parsePatreonAudioRss(RSS);
    assert.equal(eps.length, 1);
    assert.equal(eps[0]!.title, 'Patron Brief 12');
    assert.equal(eps[0]!.audioUrl, 'https://cdn.patreon.com/a/12.mp3?token=abc');
    assert.equal(eps[0]!.durationSec, 1830);
  });
  it('ignores items with no audio enclosure', () => {
    assert.deepEqual(parsePatreonAudioRss('<rss><channel><item><title>x</title></item></channel></rss>'), []);
  });
});

const IDENTITY = {
  data: { id: 'user1', type: 'user' },
  included: [
    {
      type: 'member',
      attributes: { patron_status: 'active_patron', currently_entitled_amount_cents: 500 },
      relationships: { campaign: { data: { id: 'CAMP1' } } },
    },
  ],
};

describe('parsePatreonIdentity', () => {
  it('reports active membership to the target campaign', () => {
    const s = parsePatreonIdentity(IDENTITY, 'CAMP1');
    assert.equal(s.active, true);
    assert.equal(s.amountCents, 500);
  });
  it('reports inactive when campaign not matched', () => {
    assert.equal(parsePatreonIdentity(IDENTITY, 'OTHER').active, false);
  });
});
