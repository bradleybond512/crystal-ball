import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_THRESHOLDS,
  RANGES,
  SCHEMA_VERSION,
  STORAGE_KEY,
  __resetCache,
  loadThresholds,
  normalizeThresholds,
  resetThresholds,
  saveThresholds,
  validateOrdering,
  type ThresholdConfig,
} from '../alert-thresholds.ts';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
  has(key: string): boolean { return this.map.has(key); }
}

// Each test starts with a fresh cache so module-level state doesn't leak.
function fresh(): MemoryStorage {
  __resetCache();
  return new MemoryStorage();
}

// ── Defaults + normalization ───────────────────────────────────────────────

test('DEFAULT_THRESHOLDS exposes every domain with sane values', () => {
  assert.equal(DEFAULT_THRESHOLDS.seismic.pushMinMagnitude, 5.0);
  assert.equal(DEFAULT_THRESHOLDS.seismic.voiceMinMagnitude, 7.0);
  assert.equal(DEFAULT_THRESHOLDS.geomagnetic.pushMinKp, 7);
  assert.equal(DEFAULT_THRESHOLDS.geomagnetic.voiceMinKp, 8);
  assert.ok(DEFAULT_THRESHOLDS.wildfire.pushMinFRP > 0);
  assert.ok(DEFAULT_THRESHOLDS.wildfire.radiusKm > 0);
  assert.ok(DEFAULT_THRESHOLDS.airQuality.pushMinAQI >= 100);
  assert.ok(DEFAULT_THRESHOLDS.economic.pushMinVIX > 0);
  assert.equal(DEFAULT_THRESHOLDS.hurricane.pushMinCategory, 3);
});

test('normalizeThresholds returns defaults for null / non-object inputs', () => {
  assert.deepEqual(normalizeThresholds(null), DEFAULT_THRESHOLDS);
  assert.deepEqual(normalizeThresholds(undefined), DEFAULT_THRESHOLDS);
  assert.deepEqual(normalizeThresholds(42), DEFAULT_THRESHOLDS);
  assert.deepEqual(normalizeThresholds('hello'), DEFAULT_THRESHOLDS);
});

test('normalizeThresholds keeps user values when within range', () => {
  const out = normalizeThresholds({
    seismic: { pushMinMagnitude: 4.5, voiceMinMagnitude: 6.5 },
    geomagnetic: { pushMinKp: 6, voiceMinKp: 8 },
    economic: { pushMinVIX: 35, ofrFsiSigmas: 2.5 },
  });
  assert.equal(out.seismic.pushMinMagnitude, 4.5);
  assert.equal(out.seismic.voiceMinMagnitude, 6.5);
  assert.equal(out.geomagnetic.pushMinKp, 6);
  assert.equal(out.geomagnetic.voiceMinKp, 8);
  assert.equal(out.economic.pushMinVIX, 35);
  // Untouched buckets fall back to defaults
  assert.deepEqual(out.wildfire, DEFAULT_THRESHOLDS.wildfire);
});

test('normalizeThresholds clamps out-of-range numeric values', () => {
  const out = normalizeThresholds({
    seismic: { pushMinMagnitude: 99, voiceMinMagnitude: -5 },
    geomagnetic: { pushMinKp: 100, voiceMinKp: -1 },
    airQuality: { pushMinAQI: 9999 },
  });
  assert.equal(out.seismic.pushMinMagnitude, RANGES.seismic.pushMinMagnitude.max);
  assert.equal(out.seismic.voiceMinMagnitude, RANGES.seismic.voiceMinMagnitude.min);
  assert.equal(out.geomagnetic.pushMinKp, 9);
  assert.equal(out.geomagnetic.voiceMinKp, 0);
  assert.equal(out.airQuality.pushMinAQI, 500);
});

test('normalizeThresholds rejects non-numeric values silently', () => {
  const out = normalizeThresholds({
    seismic: { pushMinMagnitude: 'big', voiceMinMagnitude: null },
  });
  assert.equal(out.seismic.pushMinMagnitude, DEFAULT_THRESHOLDS.seismic.pushMinMagnitude);
  assert.equal(out.seismic.voiceMinMagnitude, DEFAULT_THRESHOLDS.seismic.voiceMinMagnitude);
});

test('normalizeThresholds drops a payload with mismatched schema version', () => {
  const out = normalizeThresholds({
    schema: 999,
    seismic: { pushMinMagnitude: 4.0 },
  });
  assert.equal(out.seismic.pushMinMagnitude, DEFAULT_THRESHOLDS.seismic.pushMinMagnitude);
});

test('normalizeThresholds keeps a payload with matching schema version', () => {
  const out = normalizeThresholds({
    schema: SCHEMA_VERSION,
    seismic: { pushMinMagnitude: 4.0, voiceMinMagnitude: 6.0 },
  });
  assert.equal(out.seismic.pushMinMagnitude, 4.0);
});

// ── validateOrdering ──────────────────────────────────────────────────────

test('validateOrdering accepts a config where voice ≥ push for seismic + geomag', () => {
  const ok: ThresholdConfig = {
    ...DEFAULT_THRESHOLDS,
    seismic: { pushMinMagnitude: 5, voiceMinMagnitude: 7 },
    geomagnetic: { pushMinKp: 7, voiceMinKp: 9 },
  };
  assert.deepEqual(validateOrdering(ok), []);
});

test('validateOrdering flags inverted seismic / geomag thresholds', () => {
  const bad: ThresholdConfig = {
    ...DEFAULT_THRESHOLDS,
    seismic: { pushMinMagnitude: 7, voiceMinMagnitude: 5 },
    geomagnetic: { pushMinKp: 8, voiceMinKp: 5 },
  };
  const errors = validateOrdering(bad);
  assert.equal(errors.length, 2);
  assert.match(errors[0]!, /seismic/i);
  assert.match(errors[1]!, /geomag/i);
});

// ── Persistence ────────────────────────────────────────────────────────────

test('loadThresholds returns defaults on first run', () => {
  const storage = fresh();
  const config = loadThresholds(storage);
  assert.deepEqual(config, DEFAULT_THRESHOLDS);
});

test('saveThresholds → loadThresholds round-trip persists user values', () => {
  const storage = fresh();
  const written = saveThresholds(
    { ...DEFAULT_THRESHOLDS, seismic: { pushMinMagnitude: 4.5, voiceMinMagnitude: 6.5 } },
    storage,
  );
  assert.equal(written.seismic.pushMinMagnitude, 4.5);
  // Drop cache so we exercise storage I/O on the load.
  __resetCache();
  const loaded = loadThresholds(storage);
  assert.equal(loaded.seismic.pushMinMagnitude, 4.5);
  assert.equal(loaded.seismic.voiceMinMagnitude, 6.5);
});

test('saveThresholds writes the schema version into storage', () => {
  const storage = fresh();
  saveThresholds(DEFAULT_THRESHOLDS, storage);
  const raw = storage.getItem(STORAGE_KEY)!;
  const parsed = JSON.parse(raw) as { schema: number };
  assert.equal(parsed.schema, SCHEMA_VERSION);
});

test('loadThresholds tolerates corrupt JSON and returns defaults', () => {
  const storage = fresh();
  storage.setItem(STORAGE_KEY, '{not valid json');
  const loaded = loadThresholds(storage);
  assert.deepEqual(loaded, DEFAULT_THRESHOLDS);
});

test('loadThresholds normalises stored payloads with out-of-range values', () => {
  const storage = fresh();
  storage.setItem(STORAGE_KEY, JSON.stringify({
    schema: SCHEMA_VERSION,
    seismic: { pushMinMagnitude: -5, voiceMinMagnitude: 99 },
  }));
  const loaded = loadThresholds(storage);
  assert.equal(loaded.seismic.pushMinMagnitude, RANGES.seismic.pushMinMagnitude.min);
  assert.equal(loaded.seismic.voiceMinMagnitude, RANGES.seismic.voiceMinMagnitude.max);
});

test('resetThresholds clears storage and returns defaults', () => {
  const storage = fresh();
  saveThresholds(
    { ...DEFAULT_THRESHOLDS, seismic: { pushMinMagnitude: 4.0, voiceMinMagnitude: 6.0 } },
    storage,
  );
  assert.ok(storage.has(STORAGE_KEY));
  const reset = resetThresholds(storage);
  assert.deepEqual(reset, DEFAULT_THRESHOLDS);
  assert.ok(!storage.has(STORAGE_KEY));
});

test('loadThresholds caches the result — second call without storage still returns it', () => {
  const storage = fresh();
  saveThresholds(
    { ...DEFAULT_THRESHOLDS, geomagnetic: { pushMinKp: 5, voiceMinKp: 8 } },
    storage,
  );
  const first = loadThresholds(storage);
  assert.equal(first.geomagnetic.pushMinKp, 5);
  // Second call with no storage at all should still hit the cache.
  const second = loadThresholds(null);
  assert.equal(second.geomagnetic.pushMinKp, 5);
});

test('end-to-end: load → mutate via UI → save → reload preserves user changes', () => {
  const storage = fresh();
  // First open of settings — defaults.
  const initial = loadThresholds(storage);
  assert.equal(initial.airQuality.pushMinAQI, 150);

  // User drags the AQI slider to 200; UI builds a new config and calls save.
  const mutated: ThresholdConfig = {
    ...initial,
    airQuality: { pushMinAQI: 200 },
  };
  saveThresholds(mutated, storage);

  // App restart — module-level cache is dropped.
  __resetCache();
  const reloaded = loadThresholds(storage);
  assert.equal(reloaded.airQuality.pushMinAQI, 200);

  // User clicks "Restore defaults" — back to initial.
  resetThresholds(storage);
  __resetCache();
  const afterReset = loadThresholds(storage);
  assert.deepEqual(afterReset, DEFAULT_THRESHOLDS);
});

test('saveThresholds tolerates a storage host that throws on setItem', () => {
  __resetCache();
  const throwing: { getItem: () => null; setItem: () => never; removeItem: () => void } = {
    getItem: () => null,
    setItem: () => { throw new Error('quota exceeded'); },
    removeItem: () => { /* noop */ },
  };
  // Should not throw — in-memory cache still updated.
  const written = saveThresholds(
    { ...DEFAULT_THRESHOLDS, seismic: { pushMinMagnitude: 3.5, voiceMinMagnitude: 6.5 } },
    throwing,
  );
  assert.equal(written.seismic.pushMinMagnitude, 3.5);
  // loadThresholds should now serve the cached value even with the broken storage.
  const loaded = loadThresholds(throwing);
  assert.equal(loaded.seismic.pushMinMagnitude, 3.5);
});
