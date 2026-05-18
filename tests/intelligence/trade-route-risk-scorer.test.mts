/**
 * Tests for TradeRouteRiskScorerService — per-route risk tracking
 * driven by proximity-weighted situation impact scores.
 *
 * The service is built with injectable storage + clock so the tests
 * never touch real localStorage or Date.now.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FACTOR_TTL_MS,
  MAX_UPDATES,
  ROLLING_WINDOW_SIZE,
  ROUTES_STORAGE_KEY,
  TradeRouteRiskScorerService,
  UPDATES_STORAGE_KEY,
  __internals,
  __resetTradeRouteRiskScorerServiceSingleton,
  classifyRiskLevel,
  computeImpactScore,
  getTradeRouteRiskScorerService,
  type StorageLike,
  type TradeRoute,
} from '../../src/services/intelligence/trade-route-risk-scorer.ts';

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

interface AdvanceableClock {
  (): number;
  advance: (ms: number) => void;
}

function advanceableClock(start = NOW): AdvanceableClock {
  let t = start;
  const fn = (() => t) as AdvanceableClock;
  fn.advance = (ms) => { t += ms; };
  return fn;
}

const NOW = 1_745_000_000_000;
const ROUTE_ID = 'suez-canal'; // radiusKm = 50

// ── classifyRiskLevel ────────────────────────────────────────────────

test('classifyRiskLevel returns the correct band for boundary values', () => {
  assert.equal(classifyRiskLevel(0), 'minimal');
  assert.equal(classifyRiskLevel(0.24), 'minimal');
  assert.equal(classifyRiskLevel(0.25), 'elevated');
  assert.equal(classifyRiskLevel(0.49), 'elevated');
  assert.equal(classifyRiskLevel(0.5), 'high');
  assert.equal(classifyRiskLevel(0.74), 'high');
  assert.equal(classifyRiskLevel(0.75), 'critical');
  assert.equal(classifyRiskLevel(1), 'critical');
});

// ── computeImpactScore ───────────────────────────────────────────────

test('computeImpactScore is 1.0 for critical at distance 0', () => {
  assert.equal(computeImpactScore('critical', 0, 50), 1);
});

test('computeImpactScore is 0 for events outside the radius', () => {
  assert.equal(computeImpactScore('critical', 100, 50), 0);
});

test('computeImpactScore scales linearly with distance', () => {
  // critical (severity/4 = 1) at half radius → 0.5
  assert.equal(computeImpactScore('critical', 25, 50), 0.5);
});

test('computeImpactScore uses severity case-insensitively', () => {
  assert.equal(computeImpactScore('CRITICAL', 0, 50), 1);
  assert.equal(computeImpactScore('High', 0, 50), 0.75);
});

test('computeImpactScore returns 0 for unknown severity', () => {
  assert.equal(computeImpactScore('bogus', 0, 50), 0);
});

test('computeImpactScore returns 0 for zero radius', () => {
  assert.equal(computeImpactScore('critical', 0, 0), 0);
});

// ── Seeding ──────────────────────────────────────────────────────────

test('seed catalog populates 12 routes at init', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const all = svc.getAllRoutes();
  assert.equal(all.length, 12);
  assert.equal(all.length, __internals.SEED_ROUTES.length);
  assert.ok(all.some((r) => r.id === 'suez-canal'));
  assert.ok(all.some((r) => r.id === 'panama-canal'));
  assert.ok(all.some((r) => r.id === 'north-atlantic-air-corridor'));
});

test('seeding is idempotent — repeated hydration does not duplicate', () => {
  const storage = makeFakeStorage();
  const svc1 = new TradeRouteRiskScorerService({ storage, clock: fixedClock(NOW) });
  const before = svc1.getAllRoutes().length;
  const svc2 = new TradeRouteRiskScorerService({ storage, clock: fixedClock(NOW) });
  assert.equal(svc2.getAllRoutes().length, before);
});

test('all seeded routes start at minimal with score 0', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  for (const r of svc.getAllRoutes()) {
    assert.equal(r.riskScore, 0);
    assert.equal(r.riskLevel, 'minimal');
    assert.equal(r.contributingFactors.length, 0);
  }
});

// ── updateRisk ───────────────────────────────────────────────────────

test('updateRisk raises score and reclassifies level', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  svc.updateRisk(ROUTE_ID, 'sit-1', 'maritime', 'critical', 0);
  const r = svc.getRisk(ROUTE_ID)!;
  assert.equal(r.riskScore, 1);
  assert.equal(r.riskLevel, 'critical');
});

test('updateRisk returns undefined for unknown route', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  assert.equal(svc.updateRisk('nope', 's-1', 'd', 'high', 0), undefined);
});

test('updateRisk attaches a contributing-factor string per update', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  svc.updateRisk(ROUTE_ID, 'sit-1', 'maritime', 'high', 10);
  const r = svc.getRisk(ROUTE_ID)!;
  assert.equal(r.contributingFactors.length, 1);
  assert.match(r.contributingFactors[0]!, /maritime\/high/);
});

test('riskScore is the rolling max across recent factors', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  svc.updateRisk(ROUTE_ID, 'sit-1', 'm', 'critical', 0);  // impact 1.0
  svc.updateRisk(ROUTE_ID, 'sit-2', 'm', 'low', 0);       // impact 0.25
  assert.equal(svc.getRisk(ROUTE_ID)!.riskScore, 1, 'max stays at the earlier critical');
});

test('riskScore decays when older factor falls out of the rolling window', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  // Fill the window with critical, then push enough low impacts to evict
  // the critical entry.
  svc.updateRisk(ROUTE_ID, 'sit-crit', 'm', 'critical', 0);
  for (let i = 0; i < ROLLING_WINDOW_SIZE; i += 1) {
    svc.updateRisk(ROUTE_ID, `sit-low-${i}`, 'm', 'low', 0);
  }
  // Now the window holds only low impacts → score 0.25.
  assert.ok(svc.getRisk(ROUTE_ID)!.riskScore <= 0.25);
});

test('riskScore decays when factors age past the 7-day TTL', () => {
  const clock = advanceableClock(NOW);
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock });
  svc.updateRisk(ROUTE_ID, 'sit-crit', 'm', 'critical', 0);
  assert.equal(svc.getRisk(ROUTE_ID)!.riskScore, 1);
  clock.advance(FACTOR_TTL_MS + 60_000);
  // Trigger a recompute by pushing a stale-driven low impact.
  svc.updateRisk(ROUTE_ID, 'sit-low', 'm', 'low', 0);
  assert.equal(svc.getRisk(ROUTE_ID)!.riskScore, 0.25);
});

test('updateRisk on a source outside radius does not raise the score', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const radius = svc.getRisk(ROUTE_ID)!.radiusKm;
  svc.updateRisk(ROUTE_ID, 's-1', 'm', 'critical', radius * 2);
  assert.equal(svc.getRisk(ROUTE_ID)!.riskScore, 0);
});

test('updateRisk returns the update event with id + recordedAt', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const u = svc.updateRisk(ROUTE_ID, 'sit-1', 'm', 'high', 10)!;
  assert.ok(u.id.startsWith('trr-'));
  assert.equal(u.recordedAt, NOW);
});

// ── Reads / filters ──────────────────────────────────────────────────

test('getAllRoutes sorted by riskScore desc', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  svc.updateRisk('suez-canal', 's', 'm', 'critical', 0);
  svc.updateRisk('panama-canal', 's', 'm', 'medium', 0);
  const all = svc.getAllRoutes();
  assert.ok(all[0]!.riskScore >= all[1]!.riskScore);
  assert.equal(all[0]!.id, 'suez-canal');
});

test('getAllRoutes filters by type', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const land = svc.getAllRoutes({ type: 'land' });
  assert.ok(land.length > 0);
  assert.ok(land.every((r) => r.type === 'land'));
});

test('getAllRoutes filters by riskLevel', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  svc.updateRisk('suez-canal', 's', 'm', 'critical', 0);
  const crit = svc.getAllRoutes({ riskLevel: 'critical' });
  assert.equal(crit.length, 1);
  assert.equal(crit[0]!.id, 'suez-canal');
});

test('getAllRoutes returns defensive copies', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const all = svc.getAllRoutes();
  all[0]!.riskScore = 99;
  assert.notEqual(svc.getAllRoutes()[0]!.riskScore, 99);
});

// ── Summary ──────────────────────────────────────────────────────────

test('getSummary tallies critical + high and computes totalTradeAtRiskUsd', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  // suez = 1T critical at distance 0 → score 1.0 → critical.
  // hormuz = 700B; high (severity 3) / 4 = 0.75 → also critical.
  svc.updateRisk('suez-canal', 's', 'm', 'critical', 0);
  svc.updateRisk('strait-of-hormuz', 's', 'm', 'high', 0);
  const s = svc.getSummary();
  const ids = (rs: readonly TradeRoute[]): string[] => rs.map((r) => r.id).sort();
  assert.deepEqual(ids(s.critical), ['strait-of-hormuz', 'suez-canal']);
  assert.equal(s.high.length, 0);
  assert.equal(s.totalTradeAtRiskUsd, 1_000_000_000_000 + 700_000_000_000);
});

test('getSummary places medium-impact routes in the "high" bucket', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  // medium (severity 2) / 4 = 0.5 → high band.
  svc.updateRisk('panama-canal', 's', 'm', 'medium', 0);
  assert.equal(svc.getRisk('panama-canal')!.riskLevel, 'high');
  const s = svc.getSummary();
  assert.equal(s.high.length, 1);
  assert.equal(s.high[0]!.id, 'panama-canal');
  assert.equal(s.totalTradeAtRiskUsd, 270_000_000_000);
});

test('getSummary excludes minimal + elevated from trade-at-risk total', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  // Score 0.3 with severity medium and proximity factor 0.6:
  //   impactScore = 0.5 * 0.6 = 0.3 → elevated.
  const radius = svc.getRisk('panama-canal')!.radiusKm;
  svc.updateRisk('panama-canal', 's', 'm', 'medium', radius * 0.4);
  assert.equal(svc.getRisk('panama-canal')!.riskLevel, 'elevated');
  const s = svc.getSummary();
  assert.equal(s.totalTradeAtRiskUsd, 0);
});

// ── getUpdates ───────────────────────────────────────────────────────

test('getUpdates returns newest-first across all routes', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  svc.updateRisk('suez-canal', 's-a', 'm', 'high', 0);
  svc.updateRisk('panama-canal', 's-b', 'm', 'high', 0);
  const u = svc.getUpdates();
  assert.equal(u[0]!.routeId, 'panama-canal');
  assert.equal(u[1]!.routeId, 'suez-canal');
});

test('getUpdates filters by routeId + honors limit', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  for (let i = 0; i < 4; i += 1) svc.updateRisk('suez-canal', `s-${i}`, 'm', 'high', 0);
  for (let i = 0; i < 2; i += 1) svc.updateRisk('panama-canal', `p-${i}`, 'm', 'high', 0);
  const onlySuez = svc.getUpdates('suez-canal');
  assert.ok(onlySuez.every((u) => u.routeId === 'suez-canal'));
  assert.equal(svc.getUpdates(undefined, 3).length, 3);
});

// ── Ring buffer ──────────────────────────────────────────────────────

test('updates ring buffer evicts oldest past MAX_UPDATES', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  for (let i = 0; i < MAX_UPDATES + 10; i += 1) {
    svc.updateRisk('suez-canal', `s-${i}`, 'm', 'high', 0);
  }
  assert.equal(svc.getUpdates().length, MAX_UPDATES);
});

// ── Subscribe ─────────────────────────────────────────────────────────

test('subscribe receives both the route + update snapshots', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  let lastRouteScore = -1;
  let updates = 0;
  const off = svc.subscribe((route, _update) => {
    lastRouteScore = route.riskScore;
    updates += 1;
  });
  svc.updateRisk('suez-canal', 's-1', 'm', 'critical', 0);
  off();
  svc.updateRisk('suez-canal', 's-2', 'm', 'critical', 0);
  assert.equal(updates, 1);
  assert.equal(lastRouteScore, 1);
});

test('listener that throws does not stop other listeners', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  let good = 0;
  svc.subscribe(() => { throw new Error('bad'); });
  svc.subscribe(() => { good += 1; });
  svc.updateRisk('suez-canal', 's-1', 'm', 'high', 0);
  assert.equal(good, 1);
});

test('unsubscribe stops further notifications', () => {
  const svc = new TradeRouteRiskScorerService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  let count = 0;
  const cb = (): void => { count += 1; };
  svc.subscribe(cb);
  svc.unsubscribe(cb);
  svc.updateRisk('suez-canal', 's-1', 'm', 'high', 0);
  assert.equal(count, 0);
});

// ── Persistence ───────────────────────────────────────────────────────

test('routes survive a fresh service instance', () => {
  const storage = makeFakeStorage();
  const svc1 = new TradeRouteRiskScorerService({ storage, clock: fixedClock(NOW) });
  svc1.updateRisk('suez-canal', 's-1', 'm', 'critical', 0);
  const svc2 = new TradeRouteRiskScorerService({ storage, clock: fixedClock(NOW) });
  const r = svc2.getRisk('suez-canal')!;
  assert.equal(r.riskScore, 1);
  assert.equal(r.riskLevel, 'critical');
});

test('updates survive a fresh service instance', () => {
  const storage = makeFakeStorage();
  const svc1 = new TradeRouteRiskScorerService({ storage, clock: fixedClock(NOW) });
  svc1.updateRisk('suez-canal', 's-1', 'm', 'high', 0);
  const svc2 = new TradeRouteRiskScorerService({ storage, clock: fixedClock(NOW) });
  assert.equal(svc2.getUpdates().length, 1);
});

test('rolling window is rebuilt from persisted updates after hydrate', () => {
  const clock = advanceableClock(NOW);
  const storage = makeFakeStorage();
  const svc1 = new TradeRouteRiskScorerService({ storage, clock });
  svc1.updateRisk('suez-canal', 's-crit', 'm', 'critical', 0);
  // Restart the service — without rebuild the next low impact would
  // win the rolling-max and the score would drop.
  const svc2 = new TradeRouteRiskScorerService({ storage, clock });
  svc2.updateRisk('suez-canal', 's-low', 'm', 'low', 0);
  assert.equal(svc2.getRisk('suez-canal')!.riskScore, 1, 'critical from hydrated history should still win the max');
});

test('corrupt routes blob is ignored but seeds still apply', () => {
  const storage = makeFakeStorage({ [ROUTES_STORAGE_KEY]: 'not-json' });
  const svc = new TradeRouteRiskScorerService({ storage, clock: fixedClock(NOW) });
  assert.equal(svc.getAllRoutes().length, 12);
});

test('corrupt updates blob is ignored', () => {
  const storage = makeFakeStorage({ [UPDATES_STORAGE_KEY]: 'not-json' });
  const svc = new TradeRouteRiskScorerService({ storage, clock: fixedClock(NOW) });
  assert.equal(svc.getUpdates().length, 0);
});

test('null storage works (no-op persistence)', () => {
  const svc = new TradeRouteRiskScorerService({ storage: null, clock: fixedClock(NOW) });
  svc.updateRisk('suez-canal', 's-1', 'm', 'critical', 0);
  assert.equal(svc.getRisk('suez-canal')!.riskScore, 1);
});

test('resetForTesting clears state + persisted blobs and re-seeds', () => {
  const storage = makeFakeStorage();
  const svc = new TradeRouteRiskScorerService({ storage, clock: fixedClock(NOW) });
  svc.updateRisk('suez-canal', 's-1', 'm', 'critical', 0);
  svc.resetForTesting();
  assert.equal(svc.getUpdates().length, 0);
  assert.equal(svc.getRisk('suez-canal')!.riskScore, 0);
  assert.equal(svc.getAllRoutes().length, 12);
});

// ── Singleton ─────────────────────────────────────────────────────────

test('getTradeRouteRiskScorerService returns a stable singleton', () => {
  __resetTradeRouteRiskScorerServiceSingleton();
  const a = getTradeRouteRiskScorerService();
  const b = getTradeRouteRiskScorerService();
  assert.equal(a, b);
  __resetTradeRouteRiskScorerServiceSingleton();
});

test('singleton reset returns a fresh instance', () => {
  const a = getTradeRouteRiskScorerService();
  __resetTradeRouteRiskScorerServiceSingleton();
  const b = getTradeRouteRiskScorerService();
  assert.notEqual(a, b);
  __resetTradeRouteRiskScorerServiceSingleton();
});
