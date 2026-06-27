import assert from 'node:assert/strict';
import test from 'node:test';

import { isSafetyFeedPath } from '../sw-safety-feeds.ts';

// vite.config.ts excludes these from the cacheable `api-responses` NetworkFirst
// rule and routes them to NetworkOnly, so the web-build service worker can never
// serve a stale safety alert as fresh during a connectivity gap. This guards the
// set from silently drifting back into the cacheable rule.

test('every safety-critical realtime feed is marked NOT cacheable', () => {
  for (const path of [
    '/api/nws-alerts',
    '/api/alerts/active',                 // IPAWS
    '/api/oref-alerts',                   // Israel rocket sirens (round-5: was missing)
    '/api/volcano-alerts',
    '/api/earthquakes',
    '/api/earthquakes/feed',
    '/api/earthquakes/significant',
    '/api/weather/active-warnings',
    '/api/weather/spc-outlook',
    '/api/weather/tropical',              // tropical cyclone (round-5: was missing)
  ]) {
    assert.equal(isSafetyFeedPath(path), true, `${path} must NOT be cached by the service worker`);
  }
});

test('non-safety /api endpoints remain cacheable (not flagged)', () => {
  for (const path of [
    '/api/polymarket',
    '/api/markets',
    '/api/weather/seaice',        // a slow non-alert weather feed — fine to cache
    '/api/weather/spc-outlookz',  // not the real endpoint — must not over-match
    '/api/earthquakesx',          // must not over-match the earthquakes prefix
    '/api/news',
    '/api/disease-intel',
    '/api/health',
  ]) {
    assert.equal(isSafetyFeedPath(path), false, `${path} should stay cacheable`);
  }
});
