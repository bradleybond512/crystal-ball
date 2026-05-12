import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildKeywordMatcher,
  DEFAULT_KEYWORDS,
  DEFAULT_SUBREDDITS,
  formatTimeAgo,
  parseRedditListing,
  parseSubredditList,
  type RedditPost,
} from '../reddit-service.ts';

const NOW = 1_715_000_000_000;

function post(overrides: Partial<RedditPost> = {}): RedditPost {
  return {
    id: 'abc',
    subreddit: 'netsec',
    title: 'A title',
    url: 'https://example.com',
    permalink: 'https://www.reddit.com/r/netsec/comments/abc/',
    score: 100,
    numComments: 10,
    createdUtc: Math.floor(NOW / 1000) - 60,
    flair: null,
    author: 'alice',
    domain: 'example.com',
    over18: false,
    ...overrides,
  };
}

// ── parseSubredditList ─────────────────────────────────────────────────

test('parseSubredditList: trims, strips r/ prefix, dedupes', () => {
  assert.deepEqual(
    parseSubredditList(' r/netsec , Cybersecurity , netsec ,r/RBI '),
    ['netsec', 'Cybersecurity', 'RBI'],
  );
});

test('parseSubredditList: rejects invalid characters and lengths', () => {
  assert.deepEqual(parseSubredditList('a, valid_name, with space, x'), ['valid_name']);
});

test('parseSubredditList: non-string returns empty', () => {
  assert.deepEqual(parseSubredditList(undefined), []);
  assert.deepEqual(parseSubredditList(null), []);
});

// ── parseRedditListing ─────────────────────────────────────────────────

test('parseRedditListing: extracts core fields from t3 children', () => {
  const out = parseRedditListing({
    kind: 'Listing',
    data: {
      children: [
        {
          kind: 't3',
          data: {
            id: 'p1', subreddit: 'netsec', title: 'New CVE',
            url: 'https://x.com', permalink: '/r/netsec/comments/p1/cve/',
            score: 42, num_comments: 7, created_utc: 1_715_000_000,
            link_flair_text: 'Vulnerability', author: 'bob', domain: 'x.com',
            over_18: false, stickied: false,
          },
        },
      ],
    },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 'p1');
  assert.equal(out[0]!.subreddit, 'netsec');
  assert.equal(out[0]!.flair, 'Vulnerability');
  assert.equal(out[0]!.permalink, 'https://www.reddit.com/r/netsec/comments/p1/cve/');
});

test('parseRedditListing: drops stickied posts', () => {
  const out = parseRedditListing({
    data: {
      children: [
        { kind: 't3', data: { id: '1', title: 'pinned', stickied: true } },
        { kind: 't3', data: { id: '2', title: 'real post' } },
      ],
    },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, '2');
});

test('parseRedditListing: skips children with wrong kind or missing id/title', () => {
  const out = parseRedditListing({
    data: {
      children: [
        { kind: 't1', data: { id: 'c1', title: 'comment' } }, // wrong kind
        { kind: 't3', data: { id: 'no-title' } },
        { kind: 't3', data: { title: 'no-id' } },
        { kind: 't3', data: { id: 'ok', title: 'kept' } },
      ],
    },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 'ok');
});

test('parseRedditListing: missing optional fields get defaults', () => {
  const out = parseRedditListing({
    data: { children: [{ kind: 't3', data: { id: 'x', title: 't' } }] },
  });
  assert.equal(out[0]!.score, 0);
  assert.equal(out[0]!.numComments, 0);
  assert.equal(out[0]!.author, '[deleted]');
  assert.equal(out[0]!.flair, null);
});

test('parseRedditListing: malformed input → []', () => {
  assert.deepEqual(parseRedditListing(null), []);
  assert.deepEqual(parseRedditListing({}), []);
  assert.deepEqual(parseRedditListing({ data: {} }), []);
});

// ── buildKeywordMatcher ────────────────────────────────────────────────

test('buildKeywordMatcher: case-insensitive match on title', () => {
  const match = buildKeywordMatcher(['breach', 'CVE-']);
  assert.equal(match(post({ title: 'Massive data BREACH at corp' })), 'breach');
  assert.equal(match(post({ title: 'Critical CVE-2025-9999 dropped' })), 'cve-');
});

test('buildKeywordMatcher: matches against flair and domain', () => {
  const match = buildKeywordMatcher(['ransomware']);
  assert.equal(match(post({ title: 'unrelated', flair: 'Ransomware', domain: 'x.com' })), 'ransomware');
  assert.equal(match(post({ title: 'unrelated', flair: null, domain: 'ransomware-news.com' })), 'ransomware');
});

test('buildKeywordMatcher: empty keyword list always returns null', () => {
  const match = buildKeywordMatcher([]);
  assert.equal(match(post({ title: 'anything' })), null);
});

test('buildKeywordMatcher: trims whitespace and ignores empty entries', () => {
  const match = buildKeywordMatcher(['  ', 'leak ', '']);
  assert.equal(match(post({ title: 'big leak from x' })), 'leak');
});

// ── formatTimeAgo ──────────────────────────────────────────────────────

test('formatTimeAgo: seconds, minutes, hours, days', () => {
  const nowSec = NOW / 1000;
  assert.equal(formatTimeAgo(nowSec - 30, NOW), '30s');
  assert.equal(formatTimeAgo(nowSec - 5 * 60, NOW), '5m');
  assert.equal(formatTimeAgo(nowSec - 3 * 3600, NOW), '3h');
  assert.equal(formatTimeAgo(nowSec - 4 * 86_400, NOW), '4d');
});

test('formatTimeAgo: invalid input → "—"', () => {
  assert.equal(formatTimeAgo(0, NOW), '—');
  assert.equal(formatTimeAgo(Number.NaN, NOW), '—');
});

// ── Defaults ──────────────────────────────────────────────────────────

test('DEFAULT_SUBREDDITS includes the threat-relevant set called out by spec', () => {
  for (const s of ['netsec', 'cybersecurity', 'worldnews', 'geopolitics', 'RBI', 'EmergencyManagement']) {
    assert.ok(DEFAULT_SUBREDDITS.includes(s), `missing ${s}`);
  }
});

test('DEFAULT_KEYWORDS includes spec-called-out terms', () => {
  for (const k of ['breach', 'ransomware', 'earthquake']) {
    assert.ok(DEFAULT_KEYWORDS.includes(k), `missing ${k}`);
  }
});
