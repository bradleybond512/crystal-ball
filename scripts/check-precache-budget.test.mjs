import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractPrecacheUrls,
  summarizePrecache,
} from './check-precache-budget.mjs';

test('precache budget counts entries and bytes from the generated service worker', () => {
  const source = 'precacheAndRoute([{url:"assets/app.js",revision:null},{url:"favicon.svg",revision:"abc"}],{})';
  const urls = extractPrecacheUrls(source);
  const summary = summarizePrecache(urls, (url) => ({
    'assets/app.js': 120,
    'favicon.svg': 30,
  })[url] ?? 0);

  assert.deepEqual(urls, ['assets/app.js', 'favicon.svg']);
  assert.deepEqual(summary, {
    entries: 2,
    bytes: 150,
    forbidden: [],
  });
});

test('precache budget identifies obsolete vault frame sheets', () => {
  const summary = summarizePrecache(
    ['vault-frames-001.png', 'assets/app.js'],
    () => 1,
  );

  assert.deepEqual(summary.forbidden, ['vault-frames-001.png']);
});
