/**
 * Tests for WatchAreaAlertingService — named circular watch areas
 * with per-domain severity thresholds and geo-gated alert firing.
 *
 * The service is built with injectable storage + clock so the tests
 * never touch real localStorage or Date.now.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALERTS_STORAGE_KEY,
  AREAS_STORAGE_KEY,
  MAX_ALERTS,
  SEVERITY_RANK,
  WatchAreaAlertingService,
  __internals,
  __resetWatchAreaAlertingServiceSingleton,
  getWatchAreaAlertingService,
  haversineKm,
  type CheckSource,
  type StorageLike,
  type WatchAreaAlert,
} from '../../src/services/intelligence/watch-area-alerting.ts';

// ── Fakes ─────────────────────────────────────────────────────────────

function makeFakeStorage(seed: Record<string, string> = {}): StorageLike & {
  raw: Map<string, string>;
} {
  const raw = new Map<string, string>(Object.entries(seed));
  return {
    raw,
    getItem(key: string): string | null { return raw.get(key) ?? null; },
    setItem(key: string, value: string): void { raw.set(key, value); },
    removeItem(key: string): void { raw.delete(key); },
  };
}

function fixedClock(t: number): () => number { return () => t; }
function tickingClock(start: number, step = 1): () => number {
  let t = start;
  return () => { t += step; return t; };
}

const NOW = 1_745_000_000_000;
const TOKYO = { lat: 35.6762, lon: 139.6503 };
const YOKOHAMA = { lat: 35.4437, lon: 139.6380 }; // ~26 km south of Tokyo
const NEW_YORK = { lat: 40.7128, lon: -74.0060 }; // ~10,900 km from Tokyo

function source(overrides: Partial<CheckSource> = {}): CheckSource {
  return {
    id: 'obs-1', type: 'observation', domain: 'earthquake', severity: 'high',
    lat: TOKYO.lat, lon: TOKYO.lon, ...overrides,
  };
}

// ── Haversine ────────────────────────────────────────────────────────

test('haversineKm returns 0 for identical points', () => {
  assert.equal(haversineKm(TOKYO.lat, TOKYO.lon, TOKYO.lat, TOKYO.lon), 0);
});

test('haversineKm approximates known distances', () => {
  const d = haversineKm(TOKYO.lat, TOKYO.lon, YOKOHAMA.lat, YOKOHAMA.lon);
  assert.ok(d > 20 && d < 35, `Tokyo→Yokohama ~26km, got ${d}`);
});

test('severity rank uses lowercase normalization', () => {
  assert.equal(__internals.severityRankOf('HIGH'), SEVERITY_RANK.high);
  assert.equal(__internals.severityRankOf('Critical'), SEVERITY_RANK.critical);
  assert.equal(__internals.severityRankOf('bogus'), 0);
});

// ── createArea / CRUD ────────────────────────────────────────────────

test('createArea persists a new area with id + createdAt', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const area = svc.createArea({
    name: 'Tokyo', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  assert.ok(area.id.startsWith('area-'));
  assert.equal(area.createdAt, NOW);
  assert.equal(area.thresholds.earthquake, 'high');
});

test('updateArea applies a partial change and persists', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const area = svc.createArea({
    name: 'Tokyo', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  const updated = svc.updateArea(area.id, { name: 'Greater Tokyo', radiusKm: 200 })!;
  assert.equal(updated.name, 'Greater Tokyo');
  assert.equal(updated.radiusKm, 200);
});

test('updateArea returns undefined for unknown id', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  assert.equal(svc.updateArea('nope', { name: 'x' }), undefined);
});

test('deleteArea removes the entry', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const a = svc.createArea({ name: 'x', lat: 0, lon: 0, radiusKm: 1, enabled: true, thresholds: {} });
  assert.equal(svc.deleteArea(a.id), true);
  assert.equal(svc.deleteArea(a.id), false);
});

test('getAreas returns defensive copies', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  svc.createArea({ name: 'x', lat: 0, lon: 0, radiusKm: 1, enabled: true, thresholds: { earthquake: 'high' } });
  const areas = svc.getAreas();
  areas[0]!.thresholds.earthquake = 'low';
  assert.equal(svc.getAreas()[0]!.thresholds.earthquake, 'high');
});

// ── check ────────────────────────────────────────────────────────────

test('check fires an alert when source is in range and meets threshold', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.createArea({
    name: 'Tokyo', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  const fired = svc.check(source({ severity: 'high' }));
  assert.equal(fired.length, 1);
  assert.equal(fired[0]!.watchAreaName, 'Tokyo');
});

test('check fires an alert for a source on the same point (distance 0)', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.createArea({
    name: 'Tokyo', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  const fired = svc.check(source());
  assert.equal(fired[0]!.distanceKm, 0);
});

test('check fires for a source within radius (Yokohama → Tokyo 100km)', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.createArea({
    name: 'Tokyo', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  const fired = svc.check(source({ lat: YOKOHAMA.lat, lon: YOKOHAMA.lon }));
  assert.equal(fired.length, 1);
  assert.ok(fired[0]!.distanceKm > 20 && fired[0]!.distanceKm < 35);
});

test('check does not fire when source is outside radius', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.createArea({
    name: 'Tokyo', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  const fired = svc.check(source({ lat: NEW_YORK.lat, lon: NEW_YORK.lon }));
  assert.equal(fired.length, 0);
});

test('check does not fire when severity is below threshold', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.createArea({
    name: 'Tokyo', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  const fired = svc.check(source({ severity: 'medium' }));
  assert.equal(fired.length, 0);
});

test('check fires when severity exceeds threshold (critical > high)', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.createArea({
    name: 'Tokyo', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  const fired = svc.check(source({ severity: 'critical' }));
  assert.equal(fired.length, 1);
});

test('check does not fire when domain is not in thresholds', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.createArea({
    name: 'Tokyo', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  const fired = svc.check(source({ domain: 'weather', severity: 'critical' }));
  assert.equal(fired.length, 0);
});

test('check skips disabled areas', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.createArea({
    name: 'Tokyo', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: false, thresholds: { earthquake: 'high' },
  });
  assert.equal(svc.check(source()).length, 0);
});

test('check without source coords matches domain+threshold only (no geo gate)', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.createArea({
    name: 'Tokyo', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  const fired = svc.check({ id: 'obs-x', type: 'observation', domain: 'earthquake', severity: 'critical' });
  assert.equal(fired.length, 1);
  assert.equal(fired[0]!.distanceKm, Number.POSITIVE_INFINITY);
});

test('check fires alerts for multiple matching areas', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.createArea({
    name: 'Tokyo', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 200,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  svc.createArea({
    name: 'Yokohama', lat: YOKOHAMA.lat, lon: YOKOHAMA.lon, radiusKm: 200,
    enabled: true, thresholds: { earthquake: 'medium' },
  });
  const fired = svc.check(source());
  assert.equal(fired.length, 2);
});

test('check returns defensive copies', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.createArea({
    name: 'Tokyo', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  const fired = svc.check(source());
  fired[0]!.acknowledged = true;
  assert.equal(svc.getAlerts({})[0]!.acknowledged, false);
});

// ── Acknowledge ──────────────────────────────────────────────────────

test('acknowledge flips an alert + is idempotent', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.createArea({
    name: 'Tokyo', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  const fired = svc.check(source())[0]!;
  const acked = svc.acknowledge(fired.id)!;
  assert.equal(acked.acknowledged, true);
  const again = svc.acknowledge(fired.id);
  assert.equal(again?.acknowledged, true);
});

test('acknowledge returns undefined for unknown id', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  assert.equal(svc.acknowledge('waa-nope'), undefined);
});

// ── Reads ─────────────────────────────────────────────────────────────

test('getAlerts filters by watchAreaId', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const a = svc.createArea({
    name: 'A', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  svc.createArea({
    name: 'B', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  svc.check(source());
  const onlyA = svc.getAlerts({ watchAreaId: a.id });
  assert.ok(onlyA.every((al) => al.watchAreaId === a.id));
});

test('getAlerts filters by acknowledged', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.createArea({
    name: 'A', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  const fired = svc.check(source())[0]!;
  svc.acknowledge(fired.id);
  assert.equal(svc.getAlerts({ acknowledged: true }).length, 1);
  assert.equal(svc.getAlerts({ acknowledged: false }).length, 0);
});

test('getAlerts is newest-first with optional limit', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.createArea({
    name: 'A', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  const a = svc.check(source({ id: 'a' }))[0]!;
  const b = svc.check(source({ id: 'b' }))[0]!;
  const c = svc.check(source({ id: 'c' }))[0]!;
  const ordered = svc.getAlerts({});
  assert.deepEqual(ordered.map((x) => x.id), [c.id, b.id, a.id]);
  assert.equal(svc.getAlerts({}, 2).length, 2);
});

// ── Stats ────────────────────────────────────────────────────────────

test('getStats reflects current areas + alerts', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const a = svc.createArea({
    name: 'A', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  svc.createArea({
    name: 'B', lat: 0, lon: 0, radiusKm: 100,
    enabled: false, thresholds: {},
  });
  svc.check(source());
  const s = svc.getStats();
  assert.equal(s.totalAreas, 2);
  assert.equal(s.enabledAreas, 1);
  assert.equal(s.totalAlerts, 1);
  assert.equal(s.unacknowledgedAlerts, 1);
  assert.equal(s.alertsByArea[a.id], 1);
});

// ── Ring buffer ──────────────────────────────────────────────────────

test('alerts ring buffer evicts oldest past MAX_ALERTS', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.createArea({
    name: 'A', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  for (let i = 0; i < MAX_ALERTS + 10; i += 1) svc.check(source({ id: `o-${i}` }));
  assert.equal(svc.getStats().totalAlerts, MAX_ALERTS);
});

// ── Subscribe ─────────────────────────────────────────────────────────

test('subscribe fires per alert', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.createArea({
    name: 'A', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  const seen: WatchAreaAlert[] = [];
  const off = svc.subscribe((a) => seen.push(a));
  svc.check(source({ id: 'o1' }));
  svc.check(source({ id: 'o2' }));
  off();
  svc.check(source({ id: 'o3' }));
  assert.equal(seen.length, 2);
});

test('listener that throws does not stop other listeners', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.createArea({
    name: 'A', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  let good = 0;
  svc.subscribe(() => { throw new Error('bad'); });
  svc.subscribe(() => { good += 1; });
  svc.check(source());
  assert.equal(good, 1);
});

test('unsubscribe stops further notifications', () => {
  const svc = new WatchAreaAlertingService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.createArea({
    name: 'A', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  let count = 0;
  const cb = (): void => { count += 1; };
  svc.subscribe(cb);
  svc.unsubscribe(cb);
  svc.check(source());
  assert.equal(count, 0);
});

// ── Persistence ───────────────────────────────────────────────────────

test('areas survive a fresh service instance', () => {
  const storage = makeFakeStorage();
  const svc1 = new WatchAreaAlertingService({ storage, clock: fixedClock(NOW) });
  const a = svc1.createArea({
    name: 'Tokyo', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  const svc2 = new WatchAreaAlertingService({ storage, clock: fixedClock(NOW) });
  const restored = svc2.getAreas().find((x) => x.id === a.id)!;
  assert.equal(restored.name, 'Tokyo');
  assert.equal(restored.thresholds.earthquake, 'high');
});

test('alerts survive a fresh service instance', () => {
  const storage = makeFakeStorage();
  const svc1 = new WatchAreaAlertingService({ storage, clock: tickingClock(NOW) });
  svc1.createArea({
    name: 'Tokyo', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  svc1.check(source());
  const svc2 = new WatchAreaAlertingService({ storage, clock: tickingClock(NOW) });
  assert.equal(svc2.getStats().totalAlerts, 1);
});

test('corrupt areas blob is ignored', () => {
  const storage = makeFakeStorage({ [AREAS_STORAGE_KEY]: 'not-json' });
  const svc = new WatchAreaAlertingService({ storage, clock: fixedClock(NOW) });
  assert.equal(svc.getAreas().length, 0);
});

test('corrupt alerts blob is ignored', () => {
  const storage = makeFakeStorage({ [ALERTS_STORAGE_KEY]: 'not-json' });
  const svc = new WatchAreaAlertingService({ storage, clock: fixedClock(NOW) });
  assert.equal(svc.getAlerts({}).length, 0);
});

test('null storage works (no-op persistence)', () => {
  const svc = new WatchAreaAlertingService({ storage: null, clock: tickingClock(NOW) });
  svc.createArea({
    name: 'Tokyo', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  assert.equal(svc.check(source()).length, 1);
});

test('resetForTesting clears state + persisted blobs', () => {
  const storage = makeFakeStorage();
  const svc = new WatchAreaAlertingService({ storage, clock: tickingClock(NOW) });
  svc.createArea({
    name: 'Tokyo', lat: TOKYO.lat, lon: TOKYO.lon, radiusKm: 100,
    enabled: true, thresholds: { earthquake: 'high' },
  });
  svc.check(source());
  svc.resetForTesting();
  assert.equal(svc.getAreas().length, 0);
  assert.equal(svc.getAlerts({}).length, 0);
  assert.equal(storage.raw.has(AREAS_STORAGE_KEY), false);
  assert.equal(storage.raw.has(ALERTS_STORAGE_KEY), false);
});

// ── Singleton ─────────────────────────────────────────────────────────

test('getWatchAreaAlertingService returns a stable singleton', () => {
  __resetWatchAreaAlertingServiceSingleton();
  const a = getWatchAreaAlertingService();
  const b = getWatchAreaAlertingService();
  assert.equal(a, b);
  __resetWatchAreaAlertingServiceSingleton();
});

test('singleton reset returns a fresh instance', () => {
  const a = getWatchAreaAlertingService();
  __resetWatchAreaAlertingServiceSingleton();
  const b = getWatchAreaAlertingService();
  assert.notEqual(a, b);
  __resetWatchAreaAlertingServiceSingleton();
});
