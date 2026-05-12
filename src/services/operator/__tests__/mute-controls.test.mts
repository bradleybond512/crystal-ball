import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseMutes,
  muteUntil,
  isMuted,
  remainingMs,
  pruneExpired,
  formatRemaining,
  createMuteStore,
  STORAGE_KEY,
  MUTE_DURATIONS,
} from '../mute-controls.ts';

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    _map: map,
  };
}

const NOW = 1_700_000_000_000;

test('MUTE_DURATIONS values are positive and ordered', () => {
  assert.ok(MUTE_DURATIONS['1h'] > 0);
  assert.ok(MUTE_DURATIONS['4h'] > MUTE_DURATIONS['1h']);
  assert.ok(MUTE_DURATIONS['24h'] > MUTE_DURATIONS['4h']);
});

test('parseMutes returns {} for null / malformed / non-object input', () => {
  assert.deepEqual(parseMutes(null, NOW), {});
  assert.deepEqual(parseMutes('', NOW), {});
  assert.deepEqual(parseMutes('not-json', NOW), {});
  assert.deepEqual(parseMutes('[1,2]', NOW), {}); // not a record
});

test('parseMutes prunes expired entries on read', () => {
  const raw = JSON.stringify({
    earthquakes: NOW - 1000,  // expired
    wildfire:    NOW + 1000,  // active
    cyber:       'bogus',     // not a number
  });
  const parsed = parseMutes(raw, NOW);
  assert.equal('earthquakes' in parsed, false);
  assert.equal(parsed.wildfire, NOW + 1000);
  assert.equal('cyber' in parsed, false);
});

test('muteUntil returns now + duration', () => {
  assert.equal(muteUntil(NOW, '1h'), NOW + MUTE_DURATIONS['1h']);
  assert.equal(muteUntil(NOW, '24h'), NOW + MUTE_DURATIONS['24h']);
});

test('isMuted: true when until > now, false otherwise', () => {
  assert.equal(isMuted({ wildfire: NOW + 1 }, 'wildfire', NOW), true);
  assert.equal(isMuted({ wildfire: NOW }, 'wildfire', NOW), false);
  assert.equal(isMuted({ wildfire: NOW - 1 }, 'wildfire', NOW), false);
  assert.equal(isMuted({}, 'wildfire', NOW), false);
});

test('remainingMs computes positive ms or 0', () => {
  assert.equal(remainingMs({ wildfire: NOW + 1000 }, 'wildfire', NOW), 1000);
  assert.equal(remainingMs({ wildfire: NOW - 5 }, 'wildfire', NOW), 0);
  assert.equal(remainingMs({}, 'wildfire', NOW), 0);
});

test('pruneExpired drops past entries, keeps future ones', () => {
  const m = { wildfire: NOW + 1000, cyber: NOW - 1 } as Record<string, number>;
  const out = pruneExpired(m, NOW);
  assert.deepEqual(Object.keys(out), ['wildfire']);
});

test('formatRemaining: hours+minutes / minutes / seconds / empty', () => {
  assert.equal(formatRemaining(0), '');
  assert.equal(formatRemaining(-5), '');
  assert.equal(formatRemaining(15_000), '15s');
  assert.equal(formatRemaining(90_000), '1m');
  assert.equal(formatRemaining(3_600_000), '1h 0m');
  assert.equal(formatRemaining(3_900_000), '1h 5m');
});

test('store.mute persists the entry; isMuted reads it back', () => {
  const storage = fakeStorage();
  let t = NOW;
  const store = createMuteStore(storage, () => t);
  store.mute('wildfire', '1h');
  assert.equal(store.isMuted('wildfire'), true);
  assert.equal(store.remainingMs('wildfire'), MUTE_DURATIONS['1h']);
  const stored = storage._map.get(STORAGE_KEY);
  assert.ok(stored?.includes('wildfire'));
});

test('store.isMuted flips false once the clock crosses the until value', () => {
  const storage = fakeStorage();
  let t = NOW;
  const store = createMuteStore(storage, () => t);
  store.mute('cyber', '1h');
  t = NOW + MUTE_DURATIONS['1h'] + 1; // advance past expiry
  assert.equal(store.isMuted('cyber'), false);
  assert.equal(store.remainingMs('cyber'), 0);
});

test('store.unmute clears the entry', () => {
  const storage = fakeStorage();
  const store = createMuteStore(storage, () => NOW);
  store.mute('wildfire', '4h');
  store.unmute('wildfire');
  assert.equal(store.isMuted('wildfire'), false);
});

test('store.list returns only non-expired entries even when storage had stale ones', () => {
  const storage = fakeStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({
    wildfire: NOW + 1000,
    cyber:    NOW - 1000,
  }));
  const store = createMuteStore(storage, () => NOW);
  const m = store.list();
  assert.equal('wildfire' in m, true);
  assert.equal('cyber' in m, false);
});
