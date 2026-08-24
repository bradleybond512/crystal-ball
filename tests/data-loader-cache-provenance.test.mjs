import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dataLoader = await readFile(new URL('../src/app/data-loader.ts', import.meta.url), 'utf8');

function bodyBetween(start, end) {
  const from = dataLoader.indexOf(start);
  const to = dataLoader.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return dataLoader.slice(from, to);
}

test('USGS natural loader keeps offline-cache provenance before freshness bookkeeping', () => {
  const body = bodyBetween('  async loadNatural(): Promise<void> {', '  async loadTechEvents(): Promise<void> {');
  assert.match(body, /withOfflineCache\('earthquake-data'/);
  assert.match(body, /fetchEarthquakesTracked\(\)/);
  assert.match(body, /const earthquakeSnapshot = earthquakeResult\.value/);
  assert.match(body, /feedFreshnessFromSnapshot\(earthquakeSnapshot\)/);
  assert.match(body, /getEarthquakeSuccessfulUpdate\(earthquakeResultData, freshness\.fresh\)/);
  assert.match(body, /dataFreshness\.recordError\('usgs', staleReason\)/);
  assert.doesNotMatch(body, /withOfflineCache\('earthquake-data',[\s\S]*?\.then\(r => r\.data\)/);
});

test('RSS category loader labels offline snapshots instead of reporting cached items as live', () => {
  const body = bodyBetween(
    '  private async loadNewsCategory(',
    '  async loadNews(): Promise<void> {',
  );
  assert.match(body, /const rssSnapshot = await withOfflineCache\(`news-rss:\$\{category\}`/);
  assert.match(body, /fetchCategoryFeedsTracked\(enabledFeeds/);
  assert.match(body, /feedFreshnessFromSnapshot\(rssSnapshot\)/);
  assert.match(body, /const dataState: BreakerDataState = freshness\.fresh/);
  assert.match(body, /mode: 'cached', timestamp: freshness\.staleTimestamp, offline: true/);
  assert.doesNotMatch(body, /dataFreshness\.record(?:Update|Error)\('rss'/);
  assert.doesNotMatch(body, /updateApi\('RSS2JSON'/);
});

test('RSS digest and global health preserve aggregate provenance across all categories', () => {
  const digestBody = bodyBetween(
    '  private async tryFetchDigest()',
    '  private persistDigest(',
  );
  assert.match(digestBody, /Promise<RssDigestFetchResult>/);
  assert.match(digestBody, /mode: 'cached'/);
  assert.match(digestBody, /mode: 'live'/);

  const newsBody = bodyBetween('  async loadNews(): Promise<void> {', '  async loadMarkets(): Promise<void> {');
  assert.match(newsBody, /getRssSuccessfulUpdate\(rssLoadResults\)/);
  assert.match(newsBody, /dataFreshness\.recordUpdate\('rss', successfulUpdate\.itemCount, successfulUpdate\.updatedAt\)/);
  assert.match(newsBody, /dataFreshness\.recordError\('rss', staleReason\)/);
  assert.equal((newsBody.match(/updateApi\('RSS2JSON'/g) ?? []).length, 2);
});

test('FRED loader preserves cached snapshot age and never advances economic freshness on fallback', () => {
  const body = bodyBetween('  async loadFredData(): Promise<void> {', '  async loadOilAnalytics(): Promise<void> {');
  assert.match(body, /const fredSnapshot = await withOfflineCache\('economic-data'/);
  assert.match(body, /fetchFredDataTracked\(\)/);
  assert.match(body, /feedFreshnessFromSnapshot\(fredSnapshot\)/);
  assert.match(body, /getFredSuccessfulUpdate\(fredResult, freshness\.fresh\)/);
  assert.match(body, /getOldestValidTimestamp\(freshness\.staleTimestamp, fredResult\.dataState\.timestamp\)/);
  assert.match(body, /economicPanel\?\.update\(data, fallbackTimestamp\)/);
  assert.match(body, /dataFreshness\.recordError\('economic', staleReason\)/);
});
