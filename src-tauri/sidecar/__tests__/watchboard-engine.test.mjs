/**
 * Watchboard engine — geofenced standing-query persistence + signal evaluation.
 * Each test inits the engine against a fresh temp file so module state resets.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, readFileSync } from 'node:fs';

import {
  initWatchboardEngine,
  evaluateSignal,
  getWatchboards,
  createWatchboard,
  updateWatchboard,
  deleteWatchboard,
  getRecentFirings,
} from '../watchboard-engine.mjs';

let counter = 0;
function freshStore() {
  const p = join(tmpdir(), `wb-test-${process.pid}-${counter++}.json`);
  if (existsSync(p)) rmSync(p);
  initWatchboardEngine(p);
  return p;
}

function tripwire(over = {}) {
  return {
    name: 'Hormuz maritime',
    shape: { type: 'circle', center: [56.3, 26.5], radiusKm: 150 },
    conditions: [{ id: 'c1', type: 'domain', value: 'maritime', description: 'maritime' }],
    enabled: true,
    ...over,
  };
}

function watchboard(over = {}) {
  return {
    name: 'Gulf watch',
    description: 'Persian Gulf standing queries',
    tripwires: [tripwire()],
    enabled: true,
    tags: ['maritime'],
    ...over,
  };
}

test('engine starts empty against a fresh store', () => {
  freshStore();
  assert.deepEqual(getWatchboards(), []);
  assert.deepEqual(getRecentFirings(), []);
});

test('createWatchboard assigns ids/timestamps and persists to disk', () => {
  const p = freshStore();
  const created = createWatchboard(watchboard());
  assert.ok(created.id, 'watchboard gets an id');
  assert.ok(created.createdAt, 'watchboard gets createdAt');
  assert.ok(created.tripwires[0].id, 'nested tripwire gets an id');
  assert.equal(created.tripwires[0].watchboardId, created.id, 'tripwire back-references its board');
  assert.equal(created.tripwires[0].fireCount, 0);
  assert.equal(getWatchboards().length, 1);

  // Persisted: a fresh engine pointed at the same file rehydrates it.
  assert.ok(existsSync(p));
  initWatchboardEngine(p);
  assert.equal(getWatchboards().length, 1);
  assert.equal(getWatchboards()[0].id, created.id);
});

test('updateWatchboard merges fields and bumps updatedAt; returns null for unknown id', () => {
  freshStore();
  const created = createWatchboard(watchboard());
  const updated = updateWatchboard(created.id, { name: 'Renamed', enabled: false });
  assert.equal(updated.name, 'Renamed');
  assert.equal(updated.enabled, false);
  assert.notEqual(updated.updatedAt, undefined);
  assert.equal(updateWatchboard('does-not-exist', { name: 'x' }), null);
});

test('deleteWatchboard removes the board and reports success', () => {
  freshStore();
  const created = createWatchboard(watchboard());
  assert.equal(deleteWatchboard(created.id), true);
  assert.equal(getWatchboards().length, 0);
  assert.equal(deleteWatchboard(created.id), false);
});

test('evaluateSignal fires a matching tripwire and records the firing', () => {
  freshStore();
  const created = createWatchboard(watchboard());
  const firings = evaluateSignal({
    lon: 56.3,
    lat: 26.5,
    domain: 'maritime',
    eventSummary: 'Tanker boarded near Hormuz',
  });
  assert.equal(firings.length, 1);
  assert.equal(firings[0].watchboardId, created.id);
  assert.equal(firings[0].tripwireId, created.tripwires[0].id);
  assert.equal(firings[0].domain, 'maritime');
  assert.ok(firings[0].firedAt);

  // fireCount + lastFiredAt updated on the stored tripwire.
  const tw = getWatchboards()[0].tripwires[0];
  assert.equal(tw.fireCount, 1);
  assert.ok(tw.lastFiredAt);

  // Recorded in the recent-firings ring.
  assert.equal(getRecentFirings().length, 1);
});

test('evaluateSignal returns nothing when the signal misses the geofence or conditions', () => {
  freshStore();
  createWatchboard(watchboard());
  // Right domain, wrong place (mid-Atlantic).
  assert.deepEqual(evaluateSignal({ lon: -30, lat: 0, domain: 'maritime' }), []);
  // Right place, wrong domain.
  assert.deepEqual(evaluateSignal({ lon: 56.3, lat: 26.5, domain: 'cyber' }), []);
  assert.equal(getRecentFirings().length, 0);
});

test('evaluateSignal ignores disabled watchboards and disabled tripwires', () => {
  freshStore();
  createWatchboard(watchboard({ enabled: false }));
  assert.deepEqual(evaluateSignal({ lon: 56.3, lat: 26.5, domain: 'maritime' }), []);

  freshStore();
  createWatchboard(watchboard({ tripwires: [tripwire({ enabled: false })] }));
  assert.deepEqual(evaluateSignal({ lon: 56.3, lat: 26.5, domain: 'maritime' }), []);
});

test('getRecentFirings returns most-recent-first and respects the limit', () => {
  freshStore();
  createWatchboard(watchboard());
  for (let i = 0; i < 5; i++) {
    evaluateSignal({ lon: 56.3, lat: 26.5, domain: 'maritime', eventSummary: `hit ${i}` });
  }
  assert.equal(getRecentFirings().length, 5);
  assert.equal(getRecentFirings(2).length, 2);
  // Most recent first.
  assert.equal(getRecentFirings()[0].eventSummary, 'hit 4');
});
