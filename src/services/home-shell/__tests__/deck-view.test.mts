import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_DECK_PINS,
  buildDeckCards,
  formatAge,
  movePin,
  parseDeckPins,
  serializeDeckPins,
  togglePin,
} from '../deck-view.ts';
import type { PanelHealthLike } from '../deck-view.ts';

const NOW = 1_752_000_000_000;
const VALID = new Set(['markets', 'nws-alerts', 'live-news', ...DEFAULT_DECK_PINS]);

function health(overrides: Partial<PanelHealthLike> = {}): PanelHealthLike {
  return { panelId: 'markets', status: 'healthy', lastRenderAt: NOW - 32_000, ...overrides };
}

test('parseDeckPins round-trips valid pins', () => {
  const pins = parseDeckPins(serializeDeckPins(['markets', 'nws-alerts']), VALID);
  assert.deepEqual(pins, ['markets', 'nws-alerts']);
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

test('buildDeckCards maps health to tones and labels', () => {
  const cards = buildDeckCards(
    ['markets', 'nws-alerts', 'live-news'],
    {
      names: { markets: { name: 'Markets' }, 'nws-alerts': { name: 'NWS Alerts' } },
      health: [
        health(),
        health({ panelId: 'nws-alerts', status: 'failing', lastError: 'feed unreachable' }),
      ],
      narratives: { markets: 'S&P −0.4 · AAPL +1.2' },
    },
    NOW,
  );
  assert.equal(cards.length, 3);
  assert.deepEqual(
    cards.map((c) => c.tone),
    ['ok', 'error', 'unknown'],
  );
  assert.equal(cards[0]!.title, 'Markets');
  assert.equal(cards[0]!.statusLabel, 'live · 32s');
  assert.equal(cards[0]!.narrative, 'S&P −0.4 · AAPL +1.2');
  assert.ok(cards[1]!.statusLabel.includes('feed unreachable'));
  assert.equal(cards[2]!.title, 'live-news'); // no name entry → id fallback
  assert.equal(cards[2]!.statusLabel, 'not loaded');
});

test('stale statuses render as stale tone with age', () => {
  const cards = buildDeckCards(
    ['markets'],
    { names: {}, health: [health({ status: 'stale', lastRenderAt: NOW - 6 * 60_000 })], narratives: {} },
    NOW,
  );
  assert.equal(cards[0]!.tone, 'stale');
  assert.equal(cards[0]!.statusLabel, 'stale · 6m');
});

test('formatAge buckets seconds, minutes, hours', () => {
  assert.equal(formatAge(5_000), '5s');
  assert.equal(formatAge(6 * 60_000), '6m');
  assert.equal(formatAge(3 * 3_600_000), '3h');
  assert.equal(formatAge(-50), '0s');
});
