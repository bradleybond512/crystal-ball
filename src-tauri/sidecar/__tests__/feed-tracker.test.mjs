/**
 * Sidecar feed-health tracker. Locks the recordFeedSuccess /
 * recordFeedFailure / getFeedSnapshots contract that FeedHealthPanel
 * reads via /api/health.feeds[].
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  recordFeedSuccess,
  recordFeedFailure,
  getFeedSnapshots,
  _resetFeedTracker,
} from '../local-api-server.mjs';

const NOW = Date.parse('2026-05-08T12:00:00Z');

test('recordFeedSuccess seeds a new entry with lastSuccessAt + lastAttemptAt', () => {
  _resetFeedTracker();
  recordFeedSuccess('usgs', NOW);
  const snaps = getFeedSnapshots();
  assert.equal(snaps.length, 1);
  assert.deepEqual(snaps[0], {
    key: 'usgs', lastSuccessAt: NOW, lastError: null, lastAttemptAt: NOW,
  });
});

test('recordFeedFailure sets lastError + lastAttemptAt without clearing prior success', () => {
  _resetFeedTracker();
  recordFeedSuccess('opensky', NOW - 60_000);
  recordFeedFailure('opensky', new Error('rate-limited'), NOW);
  const snap = getFeedSnapshots()[0];
  assert.equal(snap.lastError, 'rate-limited');
  assert.equal(snap.lastSuccessAt, NOW - 60_000);
  assert.equal(snap.lastAttemptAt, NOW);
});

test('recordFeedSuccess clears a previously-recorded error', () => {
  _resetFeedTracker();
  recordFeedFailure('gdelt', 'HTTP 503', NOW - 5000);
  recordFeedSuccess('gdelt', NOW);
  const snap = getFeedSnapshots()[0];
  assert.equal(snap.lastError, null);
  assert.equal(snap.lastSuccessAt, NOW);
});

test('recordFeedFailure handles plain-string errors', () => {
  _resetFeedTracker();
  recordFeedFailure('fred', 'CORS rejected', NOW);
  const snap = getFeedSnapshots()[0];
  assert.equal(snap.lastError, 'CORS rejected');
});

test('getFeedSnapshots is a stable snapshot — mutating the result does not feed back', () => {
  _resetFeedTracker();
  recordFeedSuccess('acled', NOW);
  const snaps = getFeedSnapshots();
  snaps[0].lastError = 'tampered';
  const after = getFeedSnapshots();
  assert.equal(after[0].lastError, null);
});

test('record* with empty key is a no-op (defensive)', () => {
  _resetFeedTracker();
  recordFeedSuccess('', NOW);
  recordFeedFailure(undefined, 'x', NOW);
  assert.equal(getFeedSnapshots().length, 0);
});
