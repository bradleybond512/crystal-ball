import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  AlertDeduplicationService,
  resetForTests,
  type DeduplicationRecord,
} from '../../src/services/intelligence/alert-deduplication.ts';

const NOW = 1_745_000_000_000;
const HOUR_MS = 60 * 60_000;

function makeAlert(o: Partial<{ id: string; domain: string; severity: string; lat?: number; lon?: number; timestamp: number }> = {}): { id: string; domain: string; severity: string; lat?: number; lon?: number; timestamp: number } {
  return {
    id: o.id ?? 'alert-' + Math.random().toString(36).slice(2, 8),
    domain: o.domain ?? 'earthquake',
    severity: o.severity ?? 'HIGH',
    lat: o.lat ?? 35.7,
    lon: o.lon ?? 139.7,
    timestamp: o.timestamp ?? NOW,
  };
}

// ── First alert (no duplicate possible) ─────────────────────────────

describe('AlertDeduplicationService.check — first alert', () => {
  beforeEach(() => { resetForTests(); });

  it('returns isDuplicate=false + primaryAlertId=null on first ever alert', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    const result = s.check(makeAlert({ id: 'first' }));
    assert.equal(result.isDuplicate, false);
    assert.equal(result.primaryAlertId, null);
  });

  it('records the alert as not-a-duplicate', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    s.check(makeAlert({ id: 'first' }));
    const records = s.getRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0]?.alertId, 'first');
    assert.equal(records[0]?.isDuplicate, false);
    assert.equal(records[0]?.primaryAlertId, null);
  });
});

// ── Duplicate detection by domain + severity + location ─────────────

describe('AlertDeduplicationService.check — duplicate match', () => {
  beforeEach(() => { resetForTests(); });

  it('same domain/severity/location within window → duplicate', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    s.check(makeAlert({ id: 'first', timestamp: NOW }));
    const dup = s.check(makeAlert({ id: 'second', timestamp: NOW + 60_000 }));
    assert.equal(dup.isDuplicate, true);
    assert.equal(dup.primaryAlertId, 'first');
  });

  it('different domain is NOT a duplicate', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    s.check(makeAlert({ id: 'a', domain: 'earthquake' }));
    const dup = s.check(makeAlert({ id: 'b', domain: 'weather' }));
    assert.equal(dup.isDuplicate, false);
  });

  it('different severity is NOT a duplicate (matchSeverity=true default)', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    s.check(makeAlert({ id: 'a', severity: 'HIGH' }));
    const dup = s.check(makeAlert({ id: 'b', severity: 'MEDIUM' }));
    assert.equal(dup.isDuplicate, false);
  });

  it('outside time window → NOT a duplicate', () => {
    let t = NOW;
    const s = new AlertDeduplicationService({ now: () => t });
    s.check(makeAlert({ id: 'a', timestamp: NOW }));
    t = NOW + 2 * HOUR_MS;
    const dup = s.check(makeAlert({ id: 'b', timestamp: NOW + 2 * HOUR_MS }));
    assert.equal(dup.isDuplicate, false);
  });

  it('outside distance threshold → NOT a duplicate', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    s.check(makeAlert({ id: 'tokyo', lat: 35.7, lon: 139.7 }));
    // San Francisco ~8,000km away
    const dup = s.check(makeAlert({ id: 'sf', lat: 37.7, lon: -122.4 }));
    assert.equal(dup.isDuplicate, false);
  });

  it('reason field describes why a match was detected', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    s.check(makeAlert({ id: 'a' }));
    const dup = s.check(makeAlert({ id: 'b' }));
    assert.ok(dup.reason && dup.reason.length > 0);
  });

  it('non-duplicate reason is null', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    const r = s.check(makeAlert({ id: 'first' }));
    assert.equal(r.reason, null);
  });

  it('duplicate record carries primaryAlertId', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    s.check(makeAlert({ id: 'first' }));
    s.check(makeAlert({ id: 'second' }));
    const records = s.getRecords();
    const second = records.find((r) => r.alertId === 'second')!;
    assert.equal(second.primaryAlertId, 'first');
    assert.equal(second.isDuplicate, true);
  });

  it('duplicate of an already-duplicate alert points to the ORIGINAL primary (flattened)', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    s.check(makeAlert({ id: 'root' }));
    s.check(makeAlert({ id: 'first-dup' }));
    const third = s.check(makeAlert({ id: 'second-dup' }));
    assert.equal(third.primaryAlertId, 'root');
  });

  it('checking the SAME alert id twice does not match itself as primary', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    const first = s.check(makeAlert({ id: 'same-id' }));
    assert.equal(first.isDuplicate, false);
    const second = s.check(makeAlert({ id: 'same-id' }));
    // Second call with same id matches the first record by domain/severity/location/window.
    // primaryAlertId must be 'same-id' (the first record), not self.
    assert.equal(second.isDuplicate, true);
    assert.equal(second.primaryAlertId, 'same-id');
  });
});

// ── Per-domain config ──────────────────────────────────────────────

describe('AlertDeduplicationService — per-domain config', () => {
  beforeEach(() => { resetForTests(); });

  it('cyber domain ignores location (matchDistance=null) — far-apart alerts dedupe', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    s.check(makeAlert({ id: 'a', domain: 'cyber', lat: 35.7, lon: 139.7, severity: 'HIGH' }));
    const dup = s.check(makeAlert({ id: 'b', domain: 'cyber', lat: 37.7, lon: -122.4, severity: 'HIGH' }));
    assert.equal(dup.isDuplicate, true);
  });

  it('cyber domain ignores severity (matchSeverity=false default for cyber)', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    s.check(makeAlert({ id: 'a', domain: 'cyber', severity: 'HIGH' }));
    const dup = s.check(makeAlert({ id: 'b', domain: 'cyber', severity: 'MEDIUM' }));
    assert.equal(dup.isDuplicate, true);
  });

  it('cyber default window is 30min (shorter than global 60min)', () => {
    let t = NOW;
    const s = new AlertDeduplicationService({ now: () => t });
    s.check(makeAlert({ id: 'a', domain: 'cyber', timestamp: NOW }));
    t = NOW + 35 * 60_000; // 35min later
    const dup = s.check(makeAlert({ id: 'b', domain: 'cyber', timestamp: NOW + 35 * 60_000 }));
    assert.equal(dup.isDuplicate, false);
  });

  it('getConfig returns default for unknown domain', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    const config = s.getConfig('mystery-domain');
    assert.equal(config.windowMs, 3600000);
    assert.equal(config.maxDistanceKm, 250);
    assert.equal(config.matchSeverity, true);
  });

  it('getConfig returns cyber-specific defaults', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    const config = s.getConfig('cyber');
    assert.equal(config.windowMs, 1800000);
    assert.equal(config.maxDistanceKm, null);
    assert.equal(config.matchSeverity, false);
  });

  it('setConfig partial update merges with current config', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    s.setConfig('earthquake', { windowMs: 7200000 });
    const config = s.getConfig('earthquake');
    assert.equal(config.windowMs, 7200000);
    assert.equal(config.maxDistanceKm, 250); // unchanged
  });

  it('setConfig changes affect subsequent checks', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    s.setConfig('earthquake', { matchSeverity: false });
    s.check(makeAlert({ id: 'a', severity: 'HIGH' }));
    const dup = s.check(makeAlert({ id: 'b', severity: 'MEDIUM' }));
    assert.equal(dup.isDuplicate, true);
  });

  it('setConfig with maxDistanceKm=null disables geo check', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    s.setConfig('earthquake', { maxDistanceKm: null });
    s.check(makeAlert({ id: 'tokyo', lat: 35.7, lon: 139.7 }));
    const dup = s.check(makeAlert({ id: 'sf', lat: 37.7, lon: -122.4 }));
    assert.equal(dup.isDuplicate, true);
  });

  it('alert missing lat/lon is not geo-matched (no distance to compare)', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    s.check(makeAlert({ id: 'a', lat: 35.7, lon: 139.7 }));
    const dup = s.check({ id: 'b', domain: 'earthquake', severity: 'HIGH', timestamp: NOW });
    assert.equal(dup.isDuplicate, false);
  });
});

// ── getRecords ──────────────────────────────────────────────────────

describe('AlertDeduplicationService.getRecords', () => {
  beforeEach(() => { resetForTests(); });

  it('LIFO order', () => {
    let t = NOW;
    const s = new AlertDeduplicationService({ now: () => t });
    s.check(makeAlert({ id: 'first', timestamp: NOW }));
    t += 1000;
    s.check(makeAlert({ id: 'second', timestamp: NOW + 1000 }));
    const records = s.getRecords();
    assert.equal(records[0]?.alertId, 'second');
    assert.equal(records[1]?.alertId, 'first');
  });

  it('filter by domain', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    s.check(makeAlert({ id: 'eq', domain: 'earthquake' }));
    s.check(makeAlert({ id: 'wx', domain: 'weather' }));
    assert.equal(s.getRecords({ domain: 'earthquake' }).length, 1);
    assert.equal(s.getRecords({ domain: 'weather' }).length, 1);
  });

  it('filter by isDuplicate', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    s.check(makeAlert({ id: 'first' }));
    s.check(makeAlert({ id: 'dup' }));
    assert.equal(s.getRecords({ isDuplicate: true }).length, 1);
    assert.equal(s.getRecords({ isDuplicate: false }).length, 1);
  });

  it('limit honored', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    for (let i = 0; i < 5; i++) s.check(makeAlert({ id: `a-${i}` }));
    assert.equal(s.getRecords(undefined, 3).length, 3);
  });
});

// ── getStats ───────────────────────────────────────────────────────

describe('AlertDeduplicationService.getStats', () => {
  beforeEach(() => { resetForTests(); });

  it('counts total and duplicates', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    s.check(makeAlert({ id: 'first' }));
    s.check(makeAlert({ id: 'second' }));
    s.check(makeAlert({ id: 'third' }));
    const stats = s.getStats();
    assert.equal(stats.total, 3);
    assert.equal(stats.duplicates, 2);
  });

  it('suppressionRate = duplicates / total', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    s.check(makeAlert({ id: 'a' }));
    s.check(makeAlert({ id: 'b' }));
    const stats = s.getStats();
    assert.ok(Math.abs(stats.suppressionRate - 0.5) < 1e-6);
  });

  it('suppressionRate is 0 when no records', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    assert.equal(s.getStats().suppressionRate, 0);
  });

  it('byDomain breaks down counts per domain', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    s.check(makeAlert({ id: 'a', domain: 'earthquake' }));
    s.check(makeAlert({ id: 'b', domain: 'earthquake' }));
    s.check(makeAlert({ id: 'c', domain: 'weather' }));
    const stats = s.getStats();
    assert.equal(stats.byDomain['earthquake']?.total, 2);
    assert.equal(stats.byDomain['earthquake']?.duplicates, 1);
    assert.equal(stats.byDomain['weather']?.total, 1);
    assert.equal(stats.byDomain['weather']?.duplicates, 0);
  });
});

// ── Subscribe ───────────────────────────────────────────────────────

describe('AlertDeduplicationService — subscribe', () => {
  beforeEach(() => { resetForTests(); });

  it('subscribe fires on every check (duplicate or not)', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    let calls = 0;
    let last: DeduplicationRecord | null = null;
    s.subscribe((rec) => { calls++; last = rec; });
    s.check(makeAlert({ id: 'a' }));
    s.check(makeAlert({ id: 'b' }));
    assert.equal(calls, 2);
    assert.equal(last?.alertId, 'b');
    assert.equal(last?.isDuplicate, true);
  });

  it('unsubscribe stops further callbacks', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    let calls = 0;
    const cb = (): void => { calls++; };
    s.subscribe(cb);
    s.check(makeAlert({ id: 'a' }));
    s.unsubscribe(cb);
    s.check(makeAlert({ id: 'b' }));
    assert.equal(calls, 1);
  });

  it('subscribe disposer also unsubscribes', () => {
    const s = new AlertDeduplicationService({ now: () => NOW });
    let calls = 0;
    const off = s.subscribe(() => { calls++; });
    s.check(makeAlert({ id: 'a' }));
    off();
    s.check(makeAlert({ id: 'b' }));
    assert.equal(calls, 1);
  });
});

// ── Persistence + ring buffer ───────────────────────────────────────

describe('AlertDeduplicationService — persistence', () => {
  beforeEach(() => { resetForTests(); });

  it('persists configs + records to separate storage keys', () => {
    const fakeStorage: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => fakeStorage[k] ?? null,
      setItem: (k: string, v: string) => { fakeStorage[k] = v; },
    };
    const a = new AlertDeduplicationService({ now: () => NOW, storage });
    a.setConfig('earthquake', { windowMs: 999_999 });
    a.check(makeAlert({ id: 'persisted' }));
    const b = new AlertDeduplicationService({ now: () => NOW, storage });
    assert.equal(b.getConfig('earthquake').windowMs, 999_999);
    assert.equal(b.getRecords().length, 1);
  });

  it('ring buffer caps records at supplied capacity', () => {
    const s = new AlertDeduplicationService({ now: () => NOW, capacity: 5 });
    for (let i = 0; i < 10; i++) {
      s.check(makeAlert({ id: `a-${i}`, lat: 35 + i * 5, lon: 139 + i * 5 })); // spaced out
    }
    assert.equal(s.getRecords().length, 5);
  });

  it('corrupted configs storage falls back to defaults', () => {
    const storage = {
      getItem: (k: string) => k === 'wm-dedup-configs' ? '{not-json' : null,
      setItem: () => {},
    };
    const s = new AlertDeduplicationService({ now: () => NOW, storage });
    assert.equal(s.getConfig('earthquake').windowMs, 3600000);
  });

  it('corrupted records storage falls back to empty', () => {
    const storage = {
      getItem: (k: string) => k === 'wm-dedup-records' ? '{not-json' : null,
      setItem: () => {},
    };
    const s = new AlertDeduplicationService({ now: () => NOW, storage });
    assert.equal(s.getRecords().length, 0);
  });
});
