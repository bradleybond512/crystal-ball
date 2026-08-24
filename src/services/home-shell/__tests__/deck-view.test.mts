import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DECK_CONTRIBUTOR_SOURCE_IDS,
  DECK_STARTUP_BUDGET_MS,
  DEFAULT_DECK_PINS,
  buildDeckCards,
  formatAge,
  movePin,
  parseDeckPins,
  serializeDeckPins,
  togglePin,
} from '../deck-view.ts';
import type { ContributorEvidenceLike, PanelHealthLike } from '../deck-view.ts';

const NOW = 1_752_000_000_000;
const VALID = new Set(['markets', 'nws-alerts', 'live-news', ...DEFAULT_DECK_PINS]);

function health(overrides: Partial<PanelHealthLike> = {}): PanelHealthLike {
  return { panelId: 'markets', status: 'healthy', lastRenderAt: NOW - 32_000, ...overrides };
}

function contributor(overrides: Partial<ContributorEvidenceLike> = {}): ContributorEvidenceLike {
  return {
    sourceId: 'market-quotes',
    name: 'Market quotes',
    status: 'fresh',
    lastUpdateAt: NOW - 20_000,
    latestItemCount: 12,
    ...overrides,
  };
}

test('parseDeckPins round-trips valid pins', () => {
  const pins = parseDeckPins(serializeDeckPins(['markets', 'nws-alerts']), VALID);
  assert.deepEqual(pins, ['markets', 'nws-alerts']);
});

test('default Deck contributor mapping is explicit and leaves unmapped cards unverified', () => {
  assert.deepEqual(DECK_CONTRIBUTOR_SOURCE_IDS.earthquakes, ['usgs']);
  assert.deepEqual(DECK_CONTRIBUTOR_SOURCE_IDS['live-news'], ['rss']);
  for (const panelId of ['markets', 'shortage-radar', 'crypto', 'command-center', 'watchlist']) {
    assert.equal(DECK_CONTRIBUTOR_SOURCE_IDS[panelId], undefined);
  }
});

test('parseDeckPins falls back to defaults on garbage, null, or empty', () => {
  for (const raw of [null, '', 'not json', '{"a":1}', '[]', '[42]', '["unknown-panel"]']) {
    assert.deepEqual(parseDeckPins(raw, VALID), DEFAULT_DECK_PINS.filter((id) => VALID.has(id)));
  }
});

test('parseDeckPins drops unknown ids and dedupes', () => {
  const raw = JSON.stringify(['markets', 'ghost-panel', 'markets', 'live-news']);
  assert.deepEqual(parseDeckPins(raw, VALID), ['markets', 'live-news']);
});

test('togglePin adds then removes', () => {
  const added = togglePin(['markets'], 'live-news');
  assert.deepEqual(added, ['markets', 'live-news']);
  assert.deepEqual(togglePin(added, 'markets'), ['live-news']);
});

test('movePin reorders and clamps at edges', () => {
  assert.deepEqual(movePin(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b']);
  assert.deepEqual(movePin(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
  assert.deepEqual(movePin(['a', 'b', 'c'], 'missing', 1), ['a', 'b', 'c']);
});

test('movePin clamps at the high edge', () => {
  assert.deepEqual(movePin(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c']);
});

test('buildDeckCards marks a card useful only from fresh positive contributor evidence', () => {
  const cards = buildDeckCards(
    ['markets', 'nws-alerts', 'live-news'],
    {
      names: { markets: { name: 'Markets' }, 'nws-alerts': { name: 'NWS Alerts' } },
      health: [
        health(),
        health({ panelId: 'nws-alerts', status: 'failing', lastError: 'feed unreachable' }),
      ],
      narratives: { markets: 'S&P −0.4 · AAPL +1.2' },
      contributors: { markets: [contributor()] },
    },
    NOW,
  );
  assert.equal(cards.length, 3);
  assert.deepEqual(
    cards.map((c) => c.tone),
    ['ok', 'error', 'unknown'],
  );
  assert.equal(cards[0]!.title, 'Markets');
  assert.equal(cards[0]!.readiness, 'useful');
  assert.equal(cards[0]!.statusLabel, 'data contributor working now · Market quotes · 12 items in latest update');
  assert.equal(cards[0]!.narrative, 'S&P −0.4 · AAPL +1.2');
  assert.equal(cards[1]!.statusLabel, 'panel-reported error · feed unreachable');
  assert.equal(cards[2]!.title, 'live-news'); // no name entry → id fallback
  assert.equal(cards[2]!.statusLabel, 'waiting for first panel render · 0s of 30s');
  assert.equal(cards[2]!.readiness, 'loading');
  assert.equal(cards[2]!.hasRenderReport, false);
  assert.equal(cards[2]!.canRetryAllData, false);
});

test('cold cards settle from bounded startup to an honest actionable no-report state', () => {
  const start = NOW - DECK_STARTUP_BUDGET_MS;

  const [stillStarting] = buildDeckCards(
    ['live-news'],
    { names: {}, health: [], narratives: {} },
    start + DECK_STARTUP_BUDGET_MS - 1,
    start,
  );
  assert.equal(stillStarting!.readiness, 'loading');
  assert.equal(stillStarting!.hasRenderReport, false);
  assert.match(stillStarting!.statusLabel, /^waiting for first panel render · 29s of 30s$/);

  const [settled] = buildDeckCards(
    ['live-news'],
    { names: {}, health: [], narratives: {} },
    start + DECK_STARTUP_BUDGET_MS,
    start,
  );
  assert.equal(settled!.readiness, 'attention');
  assert.equal(settled!.hasRenderReport, false);
  assert.equal(settled!.statusLabel, 'no recent panel render after 30s · open panel');
  assert.doesNotMatch(settled!.statusLabel, /provider|data|offline|failed|unreachable|usable|live/i);
});

test('healthy panel render without contributor evidence settles actionable and unverified', () => {
  const [card] = buildDeckCards(
    ['markets'],
    { names: {}, health: [health()], narratives: {} },
    NOW,
    NOW - DECK_STARTUP_BUDGET_MS * 10,
  );
  assert.equal(card!.hasRenderReport, true);
  assert.equal(card!.readiness, 'attention');
  assert.equal(card!.statusLabel, 'panel rendered; data usefulness unverified · open panel');
  assert.equal(card!.canRetryAllData, false);
});

test('fresh zero-row contributor evidence is explicit and never treated as useful or all-clear', () => {
  const [card] = buildDeckCards(
    ['markets'],
    {
      names: {}, health: [health()], narratives: {},
      contributors: { markets: [contributor({ latestItemCount: 0 })] },
    },
    NOW,
    NOW - DECK_STARTUP_BUDGET_MS,
  );
  assert.equal(card!.readiness, 'attention');
  assert.match(card!.statusLabel, /latest update returned 0 items/i);
  assert.doesNotMatch(card!.statusLabel, /all clear|useful|working now/i);
});

test('a fresh label with a stale or future timestamp cannot claim contributor usefulness', () => {
  for (const lastUpdateAt of [NOW - 15 * 60_000, NOW + 1]) {
    const [card] = buildDeckCards(
      ['markets'],
      {
        names: {}, health: [health()], narratives: {},
        contributors: { markets: [contributor({ lastUpdateAt })] },
      },
      NOW,
      NOW - DECK_STARTUP_BUDGET_MS,
    );
    assert.equal(card!.readiness, 'attention');
    assert.equal(card!.statusLabel, 'panel rendered; data usefulness unverified · open panel');
    assert.doesNotMatch(card!.statusLabel, /working now|data contributor/i);
  }
});

test('a failed mapped contributor makes Retry all data plausible after the budget', () => {
  const [card] = buildDeckCards(
    ['markets'],
    {
      names: {}, health: [health()], narratives: {},
      contributors: { markets: [contributor({ status: 'error', latestItemCount: 0, lastError: 'upstream failed' })] },
    },
    NOW,
    NOW - DECK_STARTUP_BUDGET_MS,
  );
  assert.equal(card!.readiness, 'attention');
  assert.equal(card!.canRetryAllData, true);
  assert.match(card!.statusLabel, /contributor data unavailable.*open panel/i);
});

test('unsafe status renders error tone', () => {
  const cards = buildDeckCards(
    ['markets'],
    { names: {}, health: [health({ status: 'unsafe' })], narratives: {} },
    NOW,
  );
  assert.equal(cards[0]!.tone, 'error');
  assert.equal(cards[0]!.readiness, 'attention');
});

test('failing status uses neutral panel-reported error copy', () => {
  const cards = buildDeckCards(
    ['markets'],
    { names: {}, health: [health({ status: 'failing' })], narratives: {} },
    NOW,
  );
  assert.equal(cards[0]!.statusLabel, 'panel-reported error · 32s ago');
  assert.equal(cards[0]!.canRetryAllData, false);
});

test('stale statuses render as stale tone with age', () => {
  const cards = buildDeckCards(
    ['markets'],
    { names: {}, health: [health({ status: 'stale', lastRenderAt: NOW - 6 * 60_000 })], narratives: {} },
    NOW,
  );
  assert.equal(cards[0]!.tone, 'stale');
  assert.equal(cards[0]!.readiness, 'attention');
  assert.equal(cards[0]!.statusLabel, 'panel report stale · 6m ago');
});

test('formatAge buckets seconds, minutes, hours', () => {
  assert.equal(formatAge(5_000), '5s');
  assert.equal(formatAge(6 * 60_000), '6m');
  assert.equal(formatAge(3 * 3_600_000), '3h');
  assert.equal(formatAge(-50), '0s');
});
