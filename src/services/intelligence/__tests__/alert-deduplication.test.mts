/**
 * alert-deduplication.ts — deterministic unit tests
 *
 * Covers: check() primary/duplicate logic, time-window boundary,
 * severity matching, distance gating, duplicate-of-duplicate flattening,
 * ring-buffer capacity, getRecords filtering, getStats, subscribe/
 * unsubscribe, config defaults (global + domain overrides), setConfig,
 * storage persist/rehydrate/corrupt, and the singleton helpers.
 *
 * All tests use injectable clock and null storage for isolation.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import {
  AlertDeduplicationService,
  getAlertDeduplicationService,
  resetForTests,
  CONFIGS_STORAGE_KEY,
  RECORDS_STORAGE_KEY,
} from '../alert-deduplication.js';
import type {
  AlertInput,
  StorageLike,
  DeduplicationConfig,
  DeduplicationRecord,
} from '../alert-deduplication.js';

// ── Fixtures ──────────────────────────────────────────────────────────────

const NYC  = { lat: 40.7128, lon: -74.006 };
const LA   = { lat: 34.0522, lon: -118.2437 };  // ~3,940 km from NYC
const NJL  = { lat: 40.735,  lon: -74.172 };    // ~14 km from NYC
const BASE = 1_700_000_000_000;

let _idSeq = 0;

function makeAlert(overrides: Partial<AlertInput> = {}): AlertInput {
  return {
    id: `alert-${++_idSeq}`,
    domain: 'finance',
    severity: 'HIGH',
    timestamp: BASE,
    ...overrides,
  };
}

function makeStorage(initial: Record<string, string> = {}): StorageLike & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, value); },
  };
}

function makeService(
  nowMs: number = BASE,
  storage: StorageLike | null = null,
): AlertDeduplicationService {
  const t = nowMs;
  return new AlertDeduplicationService({ storage, now: () => t });
}

/** Returns a service with an advanceable clock for window boundary tests. */
function makeServiceWithClock(
  nowMs: number = BASE,
  storage: StorageLike | null = null,
): { svc: AlertDeduplicationService; setNow: (t: number) => void } {
  let t = nowMs;
  const svc = new AlertDeduplicationService({ storage, now: () => t });
  return { svc, setNow: (ms: number) => { t = ms; } };
}

// ── check() — primary vs duplicate ───────────────────────────────────────

describe('check() — primary vs duplicate', () => {
  it('first alert in a domain is NOT a duplicate', () => {
    const svc = makeService();
    const result = svc.check(makeAlert({ domain: 'finance' }));
    assert.equal(result.isDuplicate, false);
    assert.equal(result.primaryAlertId, null);
    assert.equal(result.reason, null);
  });

  it('second alert in same domain within window IS a duplicate', () => {
    const svc = makeService();
    // Include lat/lon so the default maxDistanceKm: 250 check passes
    const first = makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE, ...NYC });
    const second = makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE + 1000, ...NYC });
    svc.check(first);
    const result = svc.check(second);
    assert.equal(result.isDuplicate, true);
    assert.equal(result.primaryAlertId, first.id);
  });

  it('different domains do not deduplicate each other', () => {
    const svc = makeService();
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE }));
    const result = svc.check(makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE + 1000 }));
    assert.equal(result.isDuplicate, false);
  });

  it('reason string is null for non-duplicates and non-null for duplicates', () => {
    const svc = makeService();
    // cyber domain: matchSeverity: false, maxDistanceKm: null — simplest domain for basic dedup
    svc.check(makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE }));
    const dup = svc.check(makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE + 100 }));
    assert.ok(typeof dup.reason === 'string' && dup.reason.length > 0);
  });

  it('reason includes domain name', () => {
    const svc = makeService();
    svc.check(makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE }));
    const dup = svc.check(makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE + 100 }));
    assert.ok(dup.reason?.includes('cyber'));
  });
});

// ── Time window boundary ──────────────────────────────────────────────────

describe('time window boundary', () => {
  it('alert checked before window expires is still a duplicate', () => {
    const windowMs = 30 * 60_000; // cyber default: 30 min
    const { svc, setNow } = makeServiceWithClock();
    // cyber: maxDistanceKm: null, matchSeverity: false — no coordinate requirement
    svc.check(makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE }));
    setNow(BASE + windowMs - 1); // advance clock to 1 ms before expiry
    const result = svc.check(makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE + windowMs - 1 }));
    assert.equal(result.isDuplicate, true);
  });

  it('alert checked one millisecond after window expires is NOT a duplicate', () => {
    const windowMs = 30 * 60_000; // cyber default: 30 min
    const { svc, setNow } = makeServiceWithClock();
    svc.check(makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE }));
    setNow(BASE + windowMs); // advance clock to exactly windowMs → expired
    const result = svc.check(makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE + windowMs }));
    assert.equal(result.isDuplicate, false);
  });

  it('custom windowMs: within window is a duplicate', () => {
    const { svc, setNow } = makeServiceWithClock();
    svc.setConfig('finance', { windowMs: 5 * 60_000, maxDistanceKm: null, matchSeverity: true });
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE }));
    setNow(BASE + 4 * 60_000);
    assert.equal(svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE + 4 * 60_000 })).isDuplicate, true);
  });

  it('custom windowMs: beyond window is NOT a duplicate', () => {
    const { svc, setNow } = makeServiceWithClock();
    svc.setConfig('finance', { windowMs: 5 * 60_000, maxDistanceKm: null, matchSeverity: true });
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE }));
    setNow(BASE + 5 * 60_000); // clock at exactly windowMs after first → expired
    assert.equal(svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE + 5 * 60_000 })).isDuplicate, false);
  });
});

// ── Severity matching ─────────────────────────────────────────────────────

describe('severity matching', () => {
  it('matchSeverity: true — different severity is NOT a duplicate', () => {
    const svc = makeService();
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE }));
    const result = svc.check(makeAlert({ domain: 'finance', severity: 'MEDIUM', timestamp: BASE + 100 }));
    assert.equal(result.isDuplicate, false);
  });

  it('matchSeverity: true — same severity IS a duplicate', () => {
    const svc = makeService();
    // Use a domain configured with matchSeverity:true and maxDistanceKm:null
    svc.setConfig('biosurv', { matchSeverity: true, maxDistanceKm: null, windowMs: 60 * 60_000 });
    svc.check(makeAlert({ domain: 'biosurv', severity: 'HIGH', timestamp: BASE }));
    const result = svc.check(makeAlert({ domain: 'biosurv', severity: 'HIGH', timestamp: BASE + 100 }));
    assert.equal(result.isDuplicate, true);
  });

  it('matchSeverity: false — different severity still deduplicates', () => {
    const svc = makeService();
    svc.setConfig('geopolitical', { matchSeverity: false, windowMs: 60 * 60_000, maxDistanceKm: null });
    svc.check(makeAlert({ domain: 'geopolitical', severity: 'HIGH', timestamp: BASE }));
    const result = svc.check(makeAlert({ domain: 'geopolitical', severity: 'LOW', timestamp: BASE + 100 }));
    assert.equal(result.isDuplicate, true);
  });
});

// ── Distance gating ───────────────────────────────────────────────────────

describe('distance gating', () => {
  it('maxDistanceKm: null disables distance check', () => {
    const svc = makeService();
    svc.setConfig('cyber', { maxDistanceKm: null, windowMs: 60 * 60_000, matchSeverity: false });
    svc.check(makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE, ...NYC }));
    // Even though LA is far from NYC, distance check is off
    const result = svc.check(makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE + 100, ...LA }));
    assert.equal(result.isDuplicate, true);
  });

  it('within distance → duplicate', () => {
    const svc = makeService();
    svc.setConfig('finance', { maxDistanceKm: 50, windowMs: 60 * 60_000, matchSeverity: true });
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE, ...NYC }));
    // NJL is ~14 km from NYC — within 50 km
    const result = svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE + 100, ...NJL }));
    assert.equal(result.isDuplicate, true);
  });

  it('beyond distance → NOT a duplicate', () => {
    const svc = makeService();
    svc.setConfig('finance', { maxDistanceKm: 50, windowMs: 60 * 60_000, matchSeverity: true });
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE, ...NYC }));
    // LA is ~3940 km from NYC — well beyond 50 km
    const result = svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE + 100, ...LA }));
    assert.equal(result.isDuplicate, false);
  });

  it('alert without lat/lon is NOT a duplicate when maxDistanceKm != null', () => {
    const svc = makeService();
    // default config has maxDistanceKm: 250
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE, ...NYC }));
    // Second alert has no coordinates → distance check fails → not deduped
    const result = svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE + 100 }));
    assert.equal(result.isDuplicate, false);
  });

  it('first alert without lat/lon is NOT matched by second with lat/lon', () => {
    const svc = makeService();
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE })); // no coords
    // candidate has no lat/lon, second alert has coords — still not a duplicate
    const result = svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE + 100, ...NYC }));
    assert.equal(result.isDuplicate, false);
  });

  it('reason string includes distance info when maxDistanceKm is set and both have coords', () => {
    const svc = makeService();
    svc.setConfig('finance', { maxDistanceKm: 250, windowMs: 60 * 60_000, matchSeverity: true });
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE, ...NYC }));
    const dup = svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE + 100, ...NJL }));
    assert.ok(dup.reason?.includes('250km'));
  });
});

// ── Domain default overrides ──────────────────────────────────────────────

describe('domain default overrides', () => {
  it('cyber domain default: windowMs = 30 min', () => {
    const svc = makeService();
    const cfg = svc.getConfig('cyber');
    assert.equal(cfg.windowMs, 30 * 60_000);
  });

  it('cyber domain default: maxDistanceKm = null', () => {
    const svc = makeService();
    const cfg = svc.getConfig('cyber');
    assert.equal(cfg.maxDistanceKm, null);
  });

  it('cyber domain default: matchSeverity = false', () => {
    const svc = makeService();
    const cfg = svc.getConfig('cyber');
    assert.equal(cfg.matchSeverity, false);
  });

  it('unknown domain falls back to global defaults', () => {
    const svc = makeService();
    const cfg = svc.getConfig('unknown-domain-xyz');
    assert.equal(cfg.windowMs, 60 * 60_000);
    assert.equal(cfg.maxDistanceKm, 250);
    assert.equal(cfg.matchSeverity, true);
  });
});

// ── setConfig / getConfig ─────────────────────────────────────────────────

describe('setConfig / getConfig', () => {
  it('setConfig replaces stored config for that domain', () => {
    const svc = makeService();
    svc.setConfig('finance', { windowMs: 5 * 60_000, maxDistanceKm: null, matchSeverity: false });
    const cfg = svc.getConfig('finance');
    assert.equal(cfg.windowMs, 5 * 60_000);
    assert.equal(cfg.maxDistanceKm, null);
    assert.equal(cfg.matchSeverity, false);
  });

  it('setConfig partial update merges with existing config', () => {
    const svc = makeService();
    svc.setConfig('finance', { windowMs: 5 * 60_000 });
    const cfg = svc.getConfig('finance');
    // Other fields come from global defaults
    assert.equal(cfg.windowMs, 5 * 60_000);
    assert.equal(cfg.maxDistanceKm, 250);
    assert.equal(cfg.matchSeverity, true);
  });
});

// ── Duplicate-of-duplicate flattening ────────────────────────────────────

describe('duplicate-of-duplicate flattening', () => {
  it('duplicate-of-duplicate has primaryAlertId pointing to original', () => {
    const svc = makeService();
    // cyber: maxDistanceKm:null, matchSeverity:false — no extra checks
    const original = makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE });
    const dup1 = makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE + 100 });
    const dup2 = makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE + 200 });

    svc.check(original);
    svc.check(dup1);
    const result = svc.check(dup2);

    assert.equal(result.isDuplicate, true);
    // Should flatten to the root original, not dup1
    assert.equal(result.primaryAlertId, original.id);
  });
});

// ── Ring-buffer capacity ──────────────────────────────────────────────────

describe('ring-buffer capacity', () => {
  it('records list never exceeds capacity', () => {
    const capacity = 10;
    const svc = new AlertDeduplicationService({ capacity, storage: null, now: () => BASE });
    for (let i = 0; i < 25; i += 1) {
      svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE + i * 1000 }));
    }
    const records = svc.getRecords();
    assert.ok(records.length <= capacity);
  });
});

// ── getRecords ────────────────────────────────────────────────────────────

describe('getRecords', () => {
  it('returns records in newest-first order', () => {
    const svc = makeService();
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE }));
    svc.check(makeAlert({ domain: 'cyber', severity: 'LOW', timestamp: BASE + 1000 }));
    const records = svc.getRecords();
    assert.equal(records.length, 2);
    // Newest first — cyber was added last
    assert.equal(records[0]!.domain, 'cyber');
  });

  it('filters by domain', () => {
    const svc = makeService();
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE }));
    svc.check(makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE + 100 }));
    const records = svc.getRecords({ domain: 'finance' });
    assert.equal(records.length, 1);
    assert.equal(records[0]!.domain, 'finance');
  });

  it('filters by isDuplicate: true', () => {
    const svc = makeService();
    // cyber: maxDistanceKm:null so second becomes a duplicate
    svc.check(makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE }));
    svc.check(makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE + 100 }));
    const dups = svc.getRecords({ isDuplicate: true });
    assert.equal(dups.length, 1);
    assert.equal(dups[0]!.isDuplicate, true);
  });

  it('respects limit parameter', () => {
    const svc = makeService();
    for (let i = 0; i < 5; i += 1) {
      svc.check(makeAlert({ domain: `d${i}`, severity: 'HIGH', timestamp: BASE + i * 1000 }));
    }
    const limited = svc.getRecords({}, 3);
    assert.equal(limited.length, 3);
  });
});

// ── getStats ──────────────────────────────────────────────────────────────

describe('getStats', () => {
  it('returns zeros for no records', () => {
    const svc = makeService();
    const stats = svc.getStats();
    assert.equal(stats.total, 0);
    assert.equal(stats.duplicates, 0);
    assert.equal(stats.suppressionRate, 0);
  });

  it('computes total, duplicates, suppressionRate correctly', () => {
    const svc = makeService();
    // cyber: maxDistanceKm:null — two cyber alerts produce a duplicate
    svc.check(makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE }));
    svc.check(makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE + 100 }));  // dup
    svc.check(makeAlert({ domain: 'geopolitical', severity: 'HIGH', timestamp: BASE + 200, ...NYC })); // primary
    const stats = svc.getStats();
    assert.equal(stats.total, 3);
    assert.equal(stats.duplicates, 1);
    assert.equal(stats.suppressionRate, Number((1 / 3).toFixed(4)));
  });

  it('byDomain breakdown is accurate', () => {
    const svc = makeService();
    svc.check(makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE }));
    svc.check(makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE + 100 }));  // dup
    svc.check(makeAlert({ domain: 'geopolitical', severity: 'HIGH', timestamp: BASE + 200, ...NYC })); // primary
    const stats = svc.getStats();
    assert.equal(stats.byDomain['cyber']?.total, 2);
    assert.equal(stats.byDomain['cyber']?.duplicates, 1);
    assert.equal(stats.byDomain['geopolitical']?.total, 1);
    assert.equal(stats.byDomain['geopolitical']?.duplicates, 0);
  });
});

// ── subscribe / unsubscribe ───────────────────────────────────────────────

describe('subscribe / unsubscribe', () => {
  it('subscriber receives every check record', () => {
    const svc = makeService();
    const received: DeduplicationRecord[] = [];
    svc.subscribe((r) => { received.push(r); });
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE }));
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE + 100 }));
    assert.equal(received.length, 2);
  });

  it('unsubscribe via returned function stops notifications', () => {
    const svc = makeService();
    const received: DeduplicationRecord[] = [];
    const unsub = svc.subscribe((r) => { received.push(r); });
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE }));
    unsub();
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE + 100 }));
    assert.equal(received.length, 1);
  });

  it('unsubscribe via unsubscribe() method stops notifications', () => {
    const svc = makeService();
    const received: DeduplicationRecord[] = [];
    const cb = (r: DeduplicationRecord) => { received.push(r); };
    svc.subscribe(cb);
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE }));
    svc.unsubscribe(cb);
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE + 100 }));
    assert.equal(received.length, 1);
  });

  it('multiple subscribers each receive notification', () => {
    const svc = makeService();
    let countA = 0;
    let countB = 0;
    svc.subscribe(() => { countA++; });
    svc.subscribe(() => { countB++; });
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE }));
    assert.equal(countA, 1);
    assert.equal(countB, 1);
  });
});

// ── Storage persist / rehydrate ───────────────────────────────────────────

describe('storage persist / rehydrate', () => {
  it('configs are persisted after setConfig', () => {
    const storage = makeStorage();
    const svc = new AlertDeduplicationService({ storage, now: () => BASE });
    svc.setConfig('finance', { windowMs: 5 * 60_000, maxDistanceKm: null, matchSeverity: false });
    const raw = storage.store.get(CONFIGS_STORAGE_KEY);
    assert.ok(raw !== undefined, 'configs should be in storage');
    const parsed = JSON.parse(raw!) as { configs: DeduplicationConfig[] };
    assert.ok(Array.isArray(parsed.configs));
    assert.equal(parsed.configs[0]?.domain, 'finance');
  });

  it('records are persisted after check', () => {
    const storage = makeStorage();
    const svc = new AlertDeduplicationService({ storage, now: () => BASE });
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE }));
    const raw = storage.store.get(RECORDS_STORAGE_KEY);
    assert.ok(raw !== undefined, 'records should be in storage');
  });

  it('new instance rehydrates configs from storage', () => {
    const storage = makeStorage();
    const svc1 = new AlertDeduplicationService({ storage, now: () => BASE });
    svc1.setConfig('finance', { windowMs: 5 * 60_000, maxDistanceKm: null, matchSeverity: false });
    const svc2 = new AlertDeduplicationService({ storage, now: () => BASE });
    const cfg = svc2.getConfig('finance');
    assert.equal(cfg.windowMs, 5 * 60_000);
  });

  it('new instance rehydrates records from storage and deduplicates against them', () => {
    const storage = makeStorage();
    const svc1 = new AlertDeduplicationService({ storage, now: () => BASE });
    // cyber: maxDistanceKm:null so rehydrated record will match without coords
    const first = makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE });
    svc1.check(first);

    // New instance with same storage — rehydrated record acts as the primary
    const svc2 = new AlertDeduplicationService({ storage, now: () => BASE });
    const result = svc2.check(makeAlert({ domain: 'cyber', severity: 'HIGH', timestamp: BASE + 100 }));
    assert.equal(result.isDuplicate, true);
    assert.equal(result.primaryAlertId, first.id);
  });

  it('corrupt configs storage is silently ignored', () => {
    const storage = makeStorage({ [CONFIGS_STORAGE_KEY]: 'not-json{{' });
    assert.doesNotThrow(() => {
      const svc = new AlertDeduplicationService({ storage, now: () => BASE });
      svc.getConfig('finance');
    });
  });

  it('corrupt records storage is silently ignored', () => {
    const storage = makeStorage({ [RECORDS_STORAGE_KEY]: 'not-json{{' });
    assert.doesNotThrow(() => {
      const svc = new AlertDeduplicationService({ storage, now: () => BASE });
      svc.getRecords();
    });
  });

  it('null storage constructor param disables persistence', () => {
    const svc = new AlertDeduplicationService({ storage: null, now: () => BASE });
    svc.check(makeAlert({ domain: 'finance', severity: 'HIGH', timestamp: BASE }));
    // Should not throw
    assert.equal(svc.getRecords().length, 1);
  });
});

// ── Singleton ─────────────────────────────────────────────────────────────

describe('singleton', () => {
  beforeEach(() => {
    resetForTests();
  });

  it('getAlertDeduplicationService returns same instance on repeated calls', () => {
    const a = getAlertDeduplicationService();
    const b = getAlertDeduplicationService();
    assert.strictEqual(a, b);
  });

  it('resetForTests creates a fresh instance on next call', () => {
    const a = getAlertDeduplicationService();
    resetForTests();
    const b = getAlertDeduplicationService();
    assert.notStrictEqual(a, b);
  });
});
