/**
 * AlertRulesService tests.
 *
 * Covers:
 *   - constants + service alias
 *   - threshold knob defaults / clamp / persistence
 *   - suppression-window knob defaults / persistence / invalid input
 *   - domain-weight knob defaults / clamp / persistence
 *   - isAlertSuppressed: threshold gate, cooldown gate, no-window pass-through
 *   - applyPreset for all four presets
 *   - storage hydrate, corruption tolerance, version mismatch, per-knob isolation
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  AlertRulesService,
  AlertRulesService_,
  ALL_DOMAINS,
  DEFAULT_SUPPRESSION_MS,
  DEFAULT_THRESHOLD,
  DEFAULT_WEIGHT,
  SUPPRESSION_PRESETS_MS,
  SUPPRESSION_STORAGE_KEY,
  THRESHOLDS_STORAGE_KEY,
  WEIGHTS_STORAGE_KEY,
  __internals,
  __resetAlertRulesServiceSingleton,
  getAlertRulesService,
  type StorageLike,
} from '../../src/services/intelligence/alert-rules.ts';

// ── Fixtures ──────────────────────────────────────────────────────────

const T0 = 1_780_000_000_000;
const MIN = 60_000;

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

function makeService(
  options: Partial<ConstructorParameters<typeof AlertRulesService>[0]> = {},
): { service: AlertRulesService; storage: StorageLike & { data: Map<string, string> } } {
  const storage = (options.storage as ReturnType<typeof memoryStorage> | undefined) ?? memoryStorage();
  const service = new AlertRulesService({
    storage,
    clock: options.clock ?? (() => T0),
  });
  return { service, storage };
}

// ── 1. Constants + exports (4 tests) ──────────────────────────────────

describe('constants / exports', () => {
  it('storage keys match spec', () => {
    assert.equal(THRESHOLDS_STORAGE_KEY, 'wm-alert-rules-thresholds');
    assert.equal(SUPPRESSION_STORAGE_KEY, 'wm-alert-rules-suppression');
    assert.equal(WEIGHTS_STORAGE_KEY, 'wm-alert-rules-weights');
  });

  it('ALL_DOMAINS covers the 11 notification domains', () => {
    assert.equal(ALL_DOMAINS.length, 11);
    assert.ok(ALL_DOMAINS.includes('earthquakes'));
    assert.ok(ALL_DOMAINS.includes('supply'));
  });

  it('SUPPRESSION_PRESETS_MS exposes 0 / 15m / 30m / 1h / 4h', () => {
    assert.deepEqual([...SUPPRESSION_PRESETS_MS], [0, 15 * MIN, 30 * MIN, 60 * MIN, 240 * MIN]);
  });

  it('default knob values are documented', () => {
    assert.equal(DEFAULT_THRESHOLD, 2);
    assert.equal(DEFAULT_SUPPRESSION_MS, 0);
    assert.equal(DEFAULT_WEIGHT, 1);
  });
});

// ── 2. Threshold knob (5 tests) ───────────────────────────────────────

describe('threshold knob', () => {
  it('defaults to medium (2) for every domain', () => {
    const { service } = makeService();
    for (const d of ALL_DOMAINS) assert.equal(service.getThreshold(d), DEFAULT_THRESHOLD);
  });

  it('setThreshold stores + reads back the rounded value', () => {
    const { service } = makeService();
    service.setThreshold('weather', 3);
    assert.equal(service.getThreshold('weather'), 3);
  });

  it('setThreshold clamps to [0, 4]', () => {
    const { service } = makeService();
    service.setThreshold('cyber', -5);
    assert.equal(service.getThreshold('cyber'), 0);
    service.setThreshold('cyber', 99);
    assert.equal(service.getThreshold('cyber'), 4);
  });

  it('setThreshold rounds non-integer input', () => {
    const { service } = makeService();
    service.setThreshold('aviation', 2.7);
    assert.equal(service.getThreshold('aviation'), 3);
  });

  it('setThreshold persists under THRESHOLDS_STORAGE_KEY', () => {
    const { service, storage } = makeService();
    service.setThreshold('weather', 4);
    const raw = JSON.parse(storage.getItem(THRESHOLDS_STORAGE_KEY)!);
    assert.equal(raw.version, 1);
    assert.equal(raw.values.weather, 4);
  });
});

// ── 3. Suppression-window knob (4 tests) ──────────────────────────────

describe('suppression-window knob', () => {
  it('defaults to 0 (no cooldown) for every domain', () => {
    const { service } = makeService();
    for (const d of ALL_DOMAINS) assert.equal(service.getSuppressionWindow(d), DEFAULT_SUPPRESSION_MS);
  });

  it('setSuppressionWindow stores + reads back', () => {
    const { service } = makeService();
    service.setSuppressionWindow('weather', 30 * MIN);
    assert.equal(service.getSuppressionWindow('weather'), 30 * MIN);
  });

  it('setSuppressionWindow rejects negative / non-finite input (falls back to default)', () => {
    const { service } = makeService();
    service.setSuppressionWindow('cyber', -10);
    assert.equal(service.getSuppressionWindow('cyber'), DEFAULT_SUPPRESSION_MS);
    service.setSuppressionWindow('cyber', Number.NaN);
    assert.equal(service.getSuppressionWindow('cyber'), DEFAULT_SUPPRESSION_MS);
  });

  it('setSuppressionWindow persists under SUPPRESSION_STORAGE_KEY', () => {
    const { service, storage } = makeService();
    service.setSuppressionWindow('weather', 15 * MIN);
    const raw = JSON.parse(storage.getItem(SUPPRESSION_STORAGE_KEY)!);
    assert.equal(raw.values.weather, 15 * MIN);
  });
});

// ── 4. Domain-weight knob (4 tests) ──────────────────────────────────

describe('domain-weight knob', () => {
  it('defaults to 1.0 for every domain', () => {
    const { service } = makeService();
    for (const d of ALL_DOMAINS) assert.equal(service.getDomainWeight(d), DEFAULT_WEIGHT);
  });

  it('setDomainWeight stores + reads back', () => {
    const { service } = makeService();
    service.setDomainWeight('cyber', 0.4);
    assert.equal(service.getDomainWeight('cyber'), 0.4);
  });

  it('setDomainWeight clamps to [0, 1]', () => {
    const { service } = makeService();
    service.setDomainWeight('aviation', -1);
    assert.equal(service.getDomainWeight('aviation'), 0);
    service.setDomainWeight('aviation', 3);
    assert.equal(service.getDomainWeight('aviation'), 1);
  });

  it('setDomainWeight persists under WEIGHTS_STORAGE_KEY', () => {
    const { service, storage } = makeService();
    service.setDomainWeight('cyber', 0.25);
    const raw = JSON.parse(storage.getItem(WEIGHTS_STORAGE_KEY)!);
    assert.equal(raw.values.cyber, 0.25);
  });
});

// ── 5. isAlertSuppressed — composite gate (6 tests) ──────────────────

describe('isAlertSuppressed', () => {
  it('returns true when severity is below the per-domain threshold', () => {
    const { service } = makeService();
    service.setThreshold('weather', 3);
    assert.equal(service.isAlertSuppressed('weather', 2), true);
  });

  it('returns false when severity meets the threshold and no cooldown set', () => {
    const { service } = makeService();
    service.setThreshold('weather', 3);
    assert.equal(service.isAlertSuppressed('weather', 3), false);
  });

  it('records lastAlertAt only when the alert is not suppressed', () => {
    let now = T0;
    const service = new AlertRulesService({ storage: memoryStorage(), clock: () => now });
    service.setSuppressionWindow('weather', 30 * MIN);
    // First call: passes both gates, stamps lastAlertAt.
    assert.equal(service.isAlertSuppressed('weather', 3), false);
    now += 10 * MIN;
    // Second call within window: cooldown blocks.
    assert.equal(service.isAlertSuppressed('weather', 3), true);
  });

  it('lets a second alert through once the cooldown window expires', () => {
    let now = T0;
    const service = new AlertRulesService({ storage: memoryStorage(), clock: () => now });
    service.setSuppressionWindow('weather', 15 * MIN);
    assert.equal(service.isAlertSuppressed('weather', 3), false);
    now += 16 * MIN;
    assert.equal(service.isAlertSuppressed('weather', 3), false);
  });

  it('threshold suppression does not consume the cooldown gate', () => {
    let now = T0;
    const service = new AlertRulesService({ storage: memoryStorage(), clock: () => now });
    service.setThreshold('weather', 3);
    service.setSuppressionWindow('weather', 30 * MIN);
    // Below-threshold call — should not stamp lastAlertAt.
    assert.equal(service.isAlertSuppressed('weather', 2), true);
    now += 1 * MIN;
    // First above-threshold call must still pass the cooldown gate.
    assert.equal(service.isAlertSuppressed('weather', 3), false);
  });

  it('window=0 means no cooldown — back-to-back alerts both pass', () => {
    const { service } = makeService();
    service.setSuppressionWindow('weather', 0);
    assert.equal(service.isAlertSuppressed('weather', 3), false);
    assert.equal(service.isAlertSuppressed('weather', 3), false);
  });
});

// ── 6. applyPreset (4 tests) ──────────────────────────────────────────

describe('applyPreset', () => {
  it('"all" lowers every domain threshold to 0', () => {
    const { service } = makeService();
    service.applyPreset('all');
    for (const d of ALL_DOMAINS) assert.equal(service.getThreshold(d), 0);
  });

  it('"high-priority" raises every threshold to 3', () => {
    const { service } = makeService();
    service.applyPreset('high-priority');
    for (const d of ALL_DOMAINS) assert.equal(service.getThreshold(d), 3);
  });

  it('"crisis" raises every threshold to 4 (critical-only)', () => {
    const { service } = makeService();
    service.applyPreset('crisis');
    for (const d of ALL_DOMAINS) assert.equal(service.getThreshold(d), 4);
  });

  it('"silent" suppresses every domain (no alert at severity 4 passes)', () => {
    const { service } = makeService();
    service.applyPreset('silent');
    for (const d of ALL_DOMAINS) assert.equal(service.isAlertSuppressed(d, 4), true);
  });
});

// ── 7. Storage hydrate (4 tests) ──────────────────────────────────────

describe('storage hydrate', () => {
  it('hydrates thresholds from a pre-seeded v1 blob on first read', () => {
    const storage = memoryStorage();
    storage.setItem(THRESHOLDS_STORAGE_KEY, JSON.stringify({ version: 1, values: { weather: 4 } }));
    const { service } = makeService({ storage });
    assert.equal(service.getThreshold('weather'), 4);
  });

  it('ignores a corrupt JSON blob without throwing', () => {
    const storage = memoryStorage();
    storage.setItem(THRESHOLDS_STORAGE_KEY, '<<not json>>');
    const { service } = makeService({ storage });
    assert.equal(service.getThreshold('weather'), DEFAULT_THRESHOLD);
  });

  it('ignores a payload with the wrong version', () => {
    const storage = memoryStorage();
    storage.setItem(THRESHOLDS_STORAGE_KEY, JSON.stringify({ version: 2, values: { weather: 4 } }));
    const { service } = makeService({ storage });
    assert.equal(service.getThreshold('weather'), DEFAULT_THRESHOLD);
  });

  it('hydrates suppression + weights from their own keys (per-knob isolation)', () => {
    const storage = memoryStorage();
    storage.setItem(SUPPRESSION_STORAGE_KEY, JSON.stringify({ version: 1, values: { cyber: 30 * MIN } }));
    storage.setItem(WEIGHTS_STORAGE_KEY, JSON.stringify({ version: 1, values: { cyber: 0.5 } }));
    const { service } = makeService({ storage });
    assert.equal(service.getSuppressionWindow('cyber'), 30 * MIN);
    assert.equal(service.getDomainWeight('cyber'), 0.5);
    // Thresholds blob is missing — defaults apply.
    assert.equal(service.getThreshold('cyber'), DEFAULT_THRESHOLD);
  });
});

// ── 8. Singleton (3 tests) ────────────────────────────────────────────

describe('singleton', () => {
  beforeEach(() => { __resetAlertRulesServiceSingleton(); });

  it('getAlertRulesService returns the same instance across calls', () => {
    const a = getAlertRulesService();
    const b = getAlertRulesService();
    assert.strictEqual(a, b);
  });

  it('AlertRulesService_.getInstance is the same accessor', () => {
    const a = AlertRulesService_.getInstance();
    const b = getAlertRulesService();
    assert.strictEqual(a, b);
  });

  it('__resetAlertRulesServiceSingleton drops the cached instance', () => {
    const a = getAlertRulesService();
    __resetAlertRulesServiceSingleton();
    const b = getAlertRulesService();
    assert.notStrictEqual(a, b);
  });
});

// ── 9. Test seam (1 test) ─────────────────────────────────────────────

describe('resetForTesting', () => {
  it('wipes every knob and clears the persisted blobs', () => {
    const { service, storage } = makeService();
    service.setThreshold('weather', 4);
    service.setSuppressionWindow('cyber', 30 * MIN);
    service.setDomainWeight('aviation', 0.3);
    service.resetForTesting();
    assert.equal(service.getThreshold('weather'), DEFAULT_THRESHOLD);
    assert.equal(service.getSuppressionWindow('cyber'), DEFAULT_SUPPRESSION_MS);
    assert.equal(service.getDomainWeight('aviation'), DEFAULT_WEIGHT);
    for (const key of [THRESHOLDS_STORAGE_KEY, SUPPRESSION_STORAGE_KEY, WEIGHTS_STORAGE_KEY]) {
      assert.equal(storage.getItem(key), null);
    }
  });
});

// ── 10. __internals smoke (1 test) ────────────────────────────────────

describe('__internals', () => {
  it('presetSettings mirrors applyPreset behaviour', () => {
    assert.equal(__internals.presetSettings('all').threshold, 0);
    assert.equal(__internals.presetSettings('high-priority').threshold, 3);
    assert.equal(__internals.presetSettings('crisis').threshold, 4);
    assert.equal(__internals.presetSettings('silent').threshold, 5);
    assert.equal(__internals.isValidThreshold(2), true);
    assert.equal(__internals.isValidThreshold(99), false);
  });
});
