import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateGroupCounts,
  extractGroups,
  parseRedditListing,
  type RedditListing,
} from '../ransomware-mentions.ts';

test('extractGroups: empty input → empty', () => {
  assert.deepEqual(extractGroups(''), []);
});

test('extractGroups: single known group, case-insensitive', () => {
  assert.deepEqual(extractGroups('LOCKBIT hits hospital'), ['LockBit']);
  assert.deepEqual(extractGroups('lockbit again'), ['LockBit']);
});

test('extractGroups: multiple groups, deduplicated, sorted', () => {
  const out = extractGroups('ALPHV / BlackCat split — LockBit picks up the pieces');
  assert.deepEqual(out, ['ALPHV', 'BlackCat', 'LockBit']);
});

test('extractGroups: unrelated text → empty', () => {
  assert.deepEqual(extractGroups('Just a normal post about backups'), []);
});

test('parseRedditListing: empty listing → empty', () => {
  assert.deepEqual(parseRedditListing({ data: { children: [] } }), []);
  assert.deepEqual(parseRedditListing({}), []);
});

test('parseRedditListing: drops entries missing required fields', () => {
  const listing: RedditListing = {
    data: {
      children: [
        { data: { id: 'a', title: 'good', subreddit: 'sysadmin', permalink: '/r/sysadmin/a/', created_utc: 1700000000 } },
        { data: { id: 'b' } },
        { data: { title: 'no id', subreddit: 'x', permalink: '/x/', created_utc: 1 } },
      ],
    },
  };
  const out = parseRedditListing(listing);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 'a');
  assert.equal(out[0]!.url, 'https://www.reddit.com/r/sysadmin/a/');
});

test('parseRedditListing: extracts groups from title and selftext', () => {
  const listing: RedditListing = {
    data: {
      children: [{
        data: {
          id: 'a',
          title: 'LockBit demands ransom',
          selftext: 'ALPHV not involved this time',
          subreddit: 'cybersecurity',
          permalink: '/r/cybersecurity/a/',
          created_utc: 1700000000,
        },
      }],
    },
  };
  const [m] = parseRedditListing(listing);
  assert.deepEqual(m!.groups, ['ALPHV', 'LockBit']);
});

test('parseRedditListing: sorted newest-first', () => {
  const listing: RedditListing = {
    data: {
      children: [
        { data: { id: 'old', title: 't', subreddit: 's', permalink: '/p1', created_utc: 1700000000 } },
        { data: { id: 'new', title: 't', subreddit: 's', permalink: '/p2', created_utc: 1700001000 } },
        { data: { id: 'mid', title: 't', subreddit: 's', permalink: '/p3', created_utc: 1700000500 } },
      ],
    },
  };
  const out = parseRedditListing(listing);
  assert.deepEqual(out.map((m) => m.id), ['new', 'mid', 'old']);
});

test('aggregateGroupCounts: empty → empty', () => {
  assert.deepEqual(aggregateGroupCounts([]), []);
});

test('aggregateGroupCounts: counts and sorts', () => {
  const mentions = [
    { id: '1', title: '', subreddit: '', url: '', createdAt: 0, score: 0, comments: 0, author: '', groups: ['LockBit', 'ALPHV'] },
    { id: '2', title: '', subreddit: '', url: '', createdAt: 0, score: 0, comments: 0, author: '', groups: ['LockBit'] },
    { id: '3', title: '', subreddit: '', url: '', createdAt: 0, score: 0, comments: 0, author: '', groups: ['Akira'] },
  ];
  const counts = aggregateGroupCounts(mentions);
  assert.deepEqual(counts, [
    { group: 'LockBit', count: 2 },
    // Ties broken by case-insensitive localeCompare → Akira < ALPHV
    { group: 'Akira', count: 1 },
    { group: 'ALPHV', count: 1 },
  ]);
});
