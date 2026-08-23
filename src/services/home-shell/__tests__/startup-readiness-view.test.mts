import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHomeShellReadinessView,
  buildKeylessSourceReadiness,
} from '../startup-readiness-view.ts';
import type { DeckCardView } from '../deck-view.ts';
import type { KeylessSourceStateLike } from '../startup-readiness-view.ts';
import { getGdeltNewsAdapterEvidence } from '../keyless-adapter-evidence.ts';

const NOW = 1_752_000_000_000;

function card(
  panelId: string,
  readiness: DeckCardView['readiness'],
  hasRenderReport = readiness !== 'loading',
): DeckCardView {
  return {
    panelId,
    title: panelId,
    tone: readiness === 'useful' ? 'ok' : 'unknown',
    readiness,
    hasRenderReport,
    canRetryAllData: false,
    statusLabel: readiness,
  };
}

function source(
  id: KeylessSourceStateLike['id'],
  overrides: Partial<KeylessSourceStateLike> = {},
): KeylessSourceStateLike {
  return {
    id,
    status: 'no_data',
    lastUpdateAt: null,
    lastError: null,
    latestItemCount: 0,
    unknownReason: null,
    ...overrides,
  };
}

test('four keyless source rows require a fresh successful update to say working now', () => {
  const rows = buildKeylessSourceReadiness([
    source('usgs', { status: 'fresh', lastUpdateAt: NOW - 10_000, latestItemCount: 7 }),
    source('gdacs', { status: 'fresh', lastUpdateAt: NOW - 10_000, latestItemCount: 0 }),
    source('open-meteo', { status: 'error', lastError: 'forecast failed' }),
    source('gdelt-news'),
  ], NOW, NOW - 30_000);

  assert.deepEqual(rows.map((row) => row.id), ['usgs', 'gdacs', 'open-meteo', 'gdelt-news']);
  assert.deepEqual(rows.map((row) => row.state), ['working', 'working', 'degraded', 'unknown']);
  assert.match(rows[0]!.statusLabel, /working now.*7 items/i);
  assert.match(rows[1]!.statusLabel, /working now.*0 items.*not an all-clear signal/i);
  assert.doesNotMatch(rows[1]!.statusLabel, /no active|all clear/i);
  assert.equal(rows[2]!.canRetryAllData, true);
  assert.match(rows[3]!.nextStep, /Retry all data/i);
});

test('unknown sources load only within the budget and Open-Meteo without a saved place stays unknown', () => {
  const snapshots = [
    source('usgs'), source('gdacs'),
    source('open-meteo', { unknownReason: 'Add a saved place to start local forecasts.' }),
    source('gdelt-news'),
  ];
  const loading = buildKeylessSourceReadiness(snapshots, NOW, NOW - 29_999);
  assert.ok(loading.every((row) => row.state === 'loading'));

  const settled = buildKeylessSourceReadiness(snapshots, NOW, NOW - 30_000);
  assert.ok(settled.every((row) => row.state === 'unknown'));
  assert.match(settled.find((row) => row.id === 'open-meteo')!.statusLabel, /saved place/i);
  assert.equal(settled.find((row) => row.id === 'open-meteo')!.canRetryAllData, false);
});

test('startup readiness reports useful Deck data and contributor-backed keyless coverage', () => {
  const sources = buildKeylessSourceReadiness([
    source('usgs', { status: 'fresh', lastUpdateAt: NOW, latestItemCount: 3 }),
    source('gdacs'), source('open-meteo'), source('gdelt-news'),
  ], NOW, NOW - 29_000);
  const view = buildHomeShellReadinessView([
    card('earthquakes', 'useful'),
    card('weather', 'loading', false),
  ], sources);

  assert.equal(view.state, 'loading');
  assert.equal(view.headline, 'Keyless coverage is still loading');
  assert.equal(view.summary, '1 useful Deck card · 1 loading · 0 need attention');
  assert.equal(view.sources.length, 4);
  assert.match(view.setupNote, /adapters do not require configured credentials/i);
  assert.match(view.setupNote, /network and upstream availability still apply/i);
  assert.match(view.setupNote, /NewsAPI.*weather map tile overlays/i);
  assert.doesNotMatch(`${view.headline} ${view.summary} ${view.setupNote}`, /\d+ of \d+|optional keys|redundancy/i);
  assert.equal(view.showRetryAll, false);
});

test('a missing render report requires opening the panel and does not offer a global retry', () => {
  const view = buildHomeShellReadinessView([
    card('earthquakes', 'useful'),
    card('news', 'attention', false),
  ], []);

  assert.equal(view.state, 'attention');
  assert.equal(view.headline, 'Some first-run coverage needs attention');
  assert.equal(view.showRetryAll, false);
});

test('Retry all data appears only for a plausibly retryable contributor/source condition', () => {
  const retryable = { ...card('markets', 'attention', true), canRetryAllData: true };
  const view = buildHomeShellReadinessView([card('earthquakes', 'useful'), retryable], []);
  assert.equal(view.showRetryAll, true);
});

test('an empty Deck has a truthful setup state instead of claiming successful readiness', () => {
  const view = buildHomeShellReadinessView([], []);
  assert.equal(view.state, 'empty');
  assert.equal(view.headline, 'No Deck panels are pinned');
  assert.match(view.summary, /Pin a panel/i);
  assert.equal(view.showRetryAll, false);
});

test('GDELT first-run evidence accepts validated positive/zero output and rejects adapter fallback', () => {
  const event = {
    title: 'Validated event', url: 'https://example.test/event', source: 'example.test',
    tone: -2, country: 'US', timestamp: NOW,
  };
  assert.deepEqual(getGdeltNewsAdapterEvidence({ events: [event], updatedAt: NOW }), { itemCount: 1 });
  assert.deepEqual(getGdeltNewsAdapterEvidence({ events: [], updatedAt: NOW }), { itemCount: 0 });
  assert.equal(getGdeltNewsAdapterEvidence({ events: [], updatedAt: NOW, stale: true, error: 'upstream unavailable' }), null);
  assert.equal(getGdeltNewsAdapterEvidence({ events: [], updatedAt: NOW, error: true }), null);
  assert.equal(getGdeltNewsAdapterEvidence({ events: [], updatedAt: NOW, error: '' }), null);
  assert.equal(getGdeltNewsAdapterEvidence({ events: [], updatedAt: 0 }), null);
  assert.equal(getGdeltNewsAdapterEvidence({ events: [], updatedAt: Number.NaN }), null);
  assert.equal(getGdeltNewsAdapterEvidence({ events: [{ title: 'partial' }], updatedAt: NOW }), null);
});
