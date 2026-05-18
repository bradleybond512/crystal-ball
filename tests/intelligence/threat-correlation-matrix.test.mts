import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createThreatCorrelationMatrix,
  CELLS_STORAGE_KEY,
  WINDOWS_STORAGE_KEY,
  MAX_CELLS,
  BUILT_IN_DOMAINS,
  TREND_DELTA,
  HOT_PAIR_THRESHOLD,
  TREND_LOOKBACK_MS,
} from '../../src/services/intelligence/threat-correlation-matrix.ts';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, String(value)); },
    removeItem(key: string) { store.delete(key); },
    clear() { store.clear(); },
    key(i: number) { return [...store.keys()][i] ?? null; },
    get length() { return store.size; },
  };
}

const NOW = new Date('2026-05-18T12:00:00Z');
const NOW_MS = NOW.getTime();
const HOUR_MS = 60 * 60 * 1000;

// ── Constants ────────────────────────────────────────────────────────────

test('CELLS_STORAGE_KEY is "wm-threat-matrix-cells"', () => {
  assert.equal(CELLS_STORAGE_KEY, 'wm-threat-matrix-cells');
});

test('WINDOWS_STORAGE_KEY is "wm-threat-matrix-windows"', () => {
  assert.equal(WINDOWS_STORAGE_KEY, 'wm-threat-matrix-windows');
});

test('MAX_CELLS is 1000', () => {
  assert.equal(MAX_CELLS, 1000);
});

test('BUILT_IN_DOMAINS contains 8 entries', () => {
  assert.equal(BUILT_IN_DOMAINS.length, 8);
});

test('TREND_DELTA is 0.05', () => {
  assert.equal(TREND_DELTA, 0.05);
});

test('HOT_PAIR_THRESHOLD default is 0.3', () => {
  assert.equal(HOT_PAIR_THRESHOLD, 0.3);
});

test('TREND_LOOKBACK_MS is one hour', () => {
  assert.equal(TREND_LOOKBACK_MS, HOUR_MS);
});

// ── Init seeding ─────────────────────────────────────────────────────────

test('getDomains returns the 8 built-in domains on init', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  const domains = svc.getDomains();
  for (const d of BUILT_IN_DOMAINS) assert.ok(domains.includes(d), `missing ${d}`);
});

// ── recordCoElevation ────────────────────────────────────────────────────

test('recordCoElevation creates a cell with coElevatedCount=1', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.recordCoElevation('earthquake', 'maritime');
  const cell = svc.getCell('earthquake', 'maritime');
  assert.ok(cell);
  assert.equal(cell?.coElevatedCount, 1);
});

test('recordCoElevation order-independent: (A,B) === (B,A)', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.recordCoElevation('maritime', 'earthquake');
  const cell1 = svc.getCell('earthquake', 'maritime');
  const cell2 = svc.getCell('maritime', 'earthquake');
  assert.equal(cell1?.coElevatedCount, 1);
  assert.equal(cell2?.coElevatedCount, 1);
});

test('repeated recordCoElevation increments coElevatedCount', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  for (let i = 0; i < 3; i++) svc.recordCoElevation('earthquake', 'wildfire');
  assert.equal(svc.getCell('earthquake', 'wildfire')?.coElevatedCount, 3);
});

test('recordCoElevation rejects same-domain pair', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.recordCoElevation('earthquake', 'earthquake');
  assert.equal(svc.getCell('earthquake', 'earthquake'), null);
});

test('recordCoElevation registers new domains', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.recordCoElevation('space', 'finance');
  const domains = svc.getDomains();
  assert.ok(domains.includes('space'));
  assert.ok(domains.includes('finance'));
});

// ── recordWindow ─────────────────────────────────────────────────────────

test('recordWindow increments denominator for active cells', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.recordCoElevation('earthquake', 'maritime');
  svc.recordWindow();
  svc.recordWindow();
  // After 2 windows + 1 co-elevation, score = 1 / 2 = 0.5
  const cell = svc.getCell('earthquake', 'maritime');
  assert.ok(cell);
  assert.ok(Math.abs((cell?.correlationScore ?? 0) - 0.5) < 1e-9);
});

test('score capped at 1.0', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  for (let i = 0; i < 5; i++) svc.recordCoElevation('a', 'b');
  svc.recordWindow();
  const cell = svc.getCell('a', 'b');
  assert.equal(cell?.correlationScore, 1);
});

test('score = coElevatedCount / windows for typical case', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  // 2 co-elevations over 8 windows → 0.25
  svc.recordCoElevation('cyber', 'geopolitical');
  svc.recordCoElevation('cyber', 'geopolitical');
  for (let i = 0; i < 8; i++) svc.recordWindow();
  const cell = svc.getCell('cyber', 'geopolitical');
  assert.ok(cell);
  assert.ok(Math.abs((cell?.correlationScore ?? 0) - 0.25) < 1e-9);
});

// ── Trend ────────────────────────────────────────────────────────────────

test('trend = stable when not enough history', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.recordCoElevation('a', 'b');
  assert.equal(svc.getCell('a', 'b')?.trend, 'stable');
});

test('trend = rising when score increased >0.05 vs lookback window', () => {
  let t = NOW_MS;
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => t });
  // Build a low baseline at NOW_MS: 1 elevation across many windows → score ≈ 0.1
  svc.recordCoElevation('a', 'b');
  for (let i = 0; i < 9; i++) svc.recordWindow();
  // Wait > 1 hour, then drive score way up
  t += HOUR_MS + 1000;
  for (let i = 0; i < 50; i++) svc.recordCoElevation('a', 'b'); // score capped at 1.0
  const cell = svc.getCell('a', 'b');
  assert.equal(cell?.trend, 'rising');
});

test('trend = falling when score decreased >0.05 vs lookback window', () => {
  let t = NOW_MS;
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => t });
  for (let i = 0; i < 5; i++) svc.recordCoElevation('a', 'b');
  svc.recordWindow(); // score=1.0 (5/1 capped)
  t += HOUR_MS + 1000;
  // Many windows, no new elevations → score drops
  for (let i = 0; i < 100; i++) svc.recordWindow();
  // score now 5 / 101 ≈ 0.05
  const cell = svc.getCell('a', 'b');
  assert.equal(cell?.trend, 'falling');
});

// ── getCell ──────────────────────────────────────────────────────────────

test('getCell returns null for unrecorded pair', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  assert.equal(svc.getCell('unknown-a', 'unknown-b'), null);
});

test('getCell returns same cell regardless of arg order', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.recordCoElevation('a', 'b');
  const c1 = svc.getCell('a', 'b');
  const c2 = svc.getCell('b', 'a');
  assert.equal(c1?.coElevatedCount, c2?.coElevatedCount);
});

// ── getSnapshot ──────────────────────────────────────────────────────────

test('getSnapshot.domains lists all registered domains', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  const snap = svc.getSnapshot();
  assert.equal(snap.domains.length, BUILT_IN_DOMAINS.length);
});

test('getSnapshot.cells lists recorded cells', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.recordCoElevation('earthquake', 'wildfire');
  const snap = svc.getSnapshot();
  assert.ok(snap.cells.some((c) => c.domainA === 'earthquake' && c.domainB === 'wildfire'));
});

test('getSnapshot.hotPairs only includes score>=0.5 sorted desc', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  // pair1: hot (1 elevation, 1 window → 1.0)
  svc.recordCoElevation('cyber', 'geopolitical');
  // pair2: not hot (1 elevation, 4 windows → 0.25)
  svc.recordCoElevation('aviation', 'weather');
  svc.recordWindow();
  svc.recordWindow();
  svc.recordWindow();
  svc.recordWindow();
  // Now cyber-geopolitical: 1/4 = 0.25 also → no hot pairs
  // To make at least one hot: add 3 more elevations to cyber-geopolitical
  for (let i = 0; i < 3; i++) svc.recordCoElevation('cyber', 'geopolitical');
  // cyber-geopolitical: 4/4 = 1.0, aviation-weather: 1/4 = 0.25
  const snap = svc.getSnapshot();
  assert.ok(snap.hotPairs.length >= 1);
  assert.ok(snap.hotPairs.every((p) => p.score >= 0.5));
  // Sorted desc
  for (let i = 0; i + 1 < snap.hotPairs.length; i++) {
    const a = snap.hotPairs[i]?.score ?? 0;
    const b = snap.hotPairs[i + 1]?.score ?? 0;
    assert.ok(a >= b);
  }
});

test('getSnapshot.snapshotAt = now', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  assert.equal(svc.getSnapshot().snapshotAt, NOW_MS);
});

// ── getHotPairs ──────────────────────────────────────────────────────────

test('getHotPairs default threshold is 0.3', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.recordCoElevation('a', 'b'); // 1/0 → 1.0 after no window? Actually denom uses max(windows,1) → 1
  // No windows recorded yet so denom = 1, score = 1 → above 0.3
  const hot = svc.getHotPairs();
  assert.ok(hot.length >= 1);
});

test('getHotPairs custom threshold filters correctly', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.recordCoElevation('a', 'b');
  for (let i = 0; i < 10; i++) svc.recordWindow(); // score = 1/10 = 0.1
  assert.equal(svc.getHotPairs(0.5).length, 0);
  assert.equal(svc.getHotPairs(0.05).length, 1);
});

test('getHotPairs returns descending by score', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  // Higher score pair
  svc.recordCoElevation('a', 'b');
  svc.recordCoElevation('a', 'b');
  // Lower score pair
  svc.recordCoElevation('c', 'd');
  svc.recordWindow();
  svc.recordWindow();
  // a/b: 2/2 = 1.0, c/d: 1/2 = 0.5
  const hot = svc.getHotPairs(0.4);
  assert.ok(hot.length >= 2);
  assert.ok((hot[0]?.correlationScore ?? 0) >= (hot[1]?.correlationScore ?? 0));
});

// ── Ring buffer ──────────────────────────────────────────────────────────

test('cells ring-buffer evicts oldest at MAX_CELLS', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  // Generate MAX_CELLS + 50 unique pairs
  for (let i = 0; i < MAX_CELLS + 50; i++) {
    svc.recordCoElevation(`d${i}`, `e${i}`);
  }
  const snap = svc.getSnapshot();
  assert.ok(snap.cells.length <= MAX_CELLS, `cells=${snap.cells.length}`);
});

// ── subscribe ────────────────────────────────────────────────────────────

test('subscribe is notified on recordCoElevation', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.recordCoElevation('a', 'b');
  assert.ok(calls >= 1);
});

test('subscribe is notified on recordWindow', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.recordWindow();
  assert.ok(calls >= 1);
});

test('unsubscribe stops notifications', () => {
  const svc = createThreatCorrelationMatrix({ storage: createMemoryStorage(), now: () => NOW_MS });
  let calls = 0;
  const fn = () => { calls += 1; };
  svc.subscribe(fn);
  svc.unsubscribe(fn);
  svc.recordCoElevation('a', 'b');
  assert.equal(calls, 0);
});

// ── Persistence ──────────────────────────────────────────────────────────

test('cells persist across instances', () => {
  const storage = createMemoryStorage();
  const svc1 = createThreatCorrelationMatrix({ storage, now: () => NOW_MS });
  svc1.recordCoElevation('a', 'b');
  svc1.recordCoElevation('a', 'b');

  const svc2 = createThreatCorrelationMatrix({ storage, now: () => NOW_MS });
  const cell = svc2.getCell('a', 'b');
  assert.equal(cell?.coElevatedCount, 2);
});

test('windows persist across instances', () => {
  const storage = createMemoryStorage();
  const svc1 = createThreatCorrelationMatrix({ storage, now: () => NOW_MS });
  svc1.recordCoElevation('a', 'b');
  svc1.recordWindow();
  svc1.recordWindow();

  const svc2 = createThreatCorrelationMatrix({ storage, now: () => NOW_MS });
  // After 2 windows + 1 co-elevation: score = 1/2 = 0.5
  const cell = svc2.getCell('a', 'b');
  assert.ok(cell);
  assert.ok(Math.abs((cell?.correlationScore ?? 0) - 0.5) < 1e-9);
});
