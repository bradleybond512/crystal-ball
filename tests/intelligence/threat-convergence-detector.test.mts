/**
 * Tests for ThreatConvergenceDetector — multi-domain "perfect storm"
 * detector that fires when several domains elevate within a window.
 *
 * Built with injectable storage + clock so the tests never touch real
 * localStorage or Date.now.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CRITICAL_FLOOR,
  DEFAULT_MIN_DOMAINS,
  DEFAULT_MIN_SEVERITY,
  DEFAULT_WINDOW_MS,
  MAX_ELEVATIONS,
  MAX_EVENTS,
  STORAGE_KEY,
  THREAT_FLOOR,
  ThreatConvergenceDetector,
  __internals,
  getThreatConvergenceDetector,
  labelForScore,
  type StorageLike,
} from '../../src/services/intelligence/threat-convergence-detector.ts';

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

interface AdvanceableClock { (): number; advance: (ms: number) => void; set: (t: number) => void }

function makeClock(start = NOW): AdvanceableClock {
  let t = start;
  const fn = (() => t) as AdvanceableClock;
  fn.advance = (ms) => { t += ms; };
  fn.set = (next) => { t = next; };
  return fn;
}

const NOW = 1_745_000_000_000;

// ── labelForScore ────────────────────────────────────────────────────

test('labelForScore returns ELEVATED below the threat floor', () => {
  assert.equal(labelForScore(0), 'ELEVATED CONVERGENCE');
  assert.equal(labelForScore(0.4), 'ELEVATED CONVERGENCE');
  assert.equal(labelForScore(THREAT_FLOOR), 'ELEVATED CONVERGENCE');
});

test('labelForScore returns THREAT in the (0.4, 0.7] range', () => {
  assert.equal(labelForScore(0.41), 'THREAT CONVERGENCE');
  assert.equal(labelForScore(0.7), 'THREAT CONVERGENCE');
  assert.equal(labelForScore(CRITICAL_FLOOR), 'THREAT CONVERGENCE');
});

test('labelForScore returns CRITICAL above 0.7', () => {
  assert.equal(labelForScore(0.71), 'CRITICAL CONVERGENCE');
  assert.equal(labelForScore(1), 'CRITICAL CONVERGENCE');
});

// ── recordElevation ──────────────────────────────────────────────────

test('recordElevation stamps now() when no timestamp is supplied', () => {
  const clock = makeClock();
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock });
  const elevation = det.recordElevation('finance', 3);
  assert.equal(elevation.timestamp, clock());
  assert.equal(elevation.domain, 'finance');
  assert.equal(elevation.severity, 3);
});

test('recordElevation honors an explicit timestamp', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  const elevation = det.recordElevation('finance', 3, NOW - 500_000);
  assert.equal(elevation.timestamp, NOW - 500_000);
});

test('recordElevation returns a defensive copy', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  const elevation = det.recordElevation('finance', 3, NOW);
  elevation.severity = 99;
  assert.equal(det.getElevations()[0]!.severity, 3);
});

test('getElevations returns defensive copies of the underlying ring', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  det.recordElevation('finance', 3, NOW);
  const all = det.getElevations();
  all[0]!.domain = 'mutated';
  assert.equal(det.getElevations()[0]!.domain, 'finance');
});

test('elevation ring evicts oldest past MAX_ELEVATIONS', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  for (let i = 0; i < MAX_ELEVATIONS + 25; i += 1) {
    det.recordElevation(`d-${i}`, 2, NOW + i);
  }
  assert.equal(det.getElevations().length, MAX_ELEVATIONS);
  // Oldest 25 entries should be gone.
  assert.equal(det.getElevations()[0]!.domain, 'd-25');
});

// ── detect: basic firing semantics ───────────────────────────────────

test('detect returns null when fewer than minDomains have elevated', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  det.recordElevation('finance', 3, NOW - 1000);
  det.recordElevation('cyber', 3, NOW - 1000);
  assert.equal(det.detect(), null);
});

test('detect returns null when no elevations sit inside the window', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  // All elevations are older than the default 1h window.
  for (const d of ['a', 'b', 'c']) det.recordElevation(d, 3, NOW - 2 * DEFAULT_WINDOW_MS);
  assert.equal(det.detect(), null);
});

test('detect returns null when severities are all below minSeverity', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  for (const d of ['a', 'b', 'c']) det.recordElevation(d, 1, NOW - 1000);
  assert.equal(det.detect(), null);
});

test('detect fires when 3 distinct domains elevate inside the window', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  det.recordElevation('finance', 3, NOW - 1000);
  det.recordElevation('cyber', 3, NOW - 1000);
  det.recordElevation('maritime', 3, NOW - 1000);
  const event = det.detect()!;
  assert.ok(event);
  assert.deepEqual(event.domains.sort(), ['cyber', 'finance', 'maritime']);
  assert.equal(event.minSeverity, DEFAULT_MIN_SEVERITY);
  assert.equal(event.windowMs, DEFAULT_WINDOW_MS);
});

test('detect stamps detectedAt with the current clock', () => {
  const clock = makeClock();
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock });
  for (const d of ['a', 'b', 'c']) det.recordElevation(d, 3, NOW);
  const event = det.detect()!;
  assert.equal(event.detectedAt, clock());
});

test('detect assigns ids prefixed with tcd-', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  for (const d of ['a', 'b', 'c']) det.recordElevation(d, 3, NOW);
  assert.match(det.detect()!.id, /^tcd-/);
});

test('detect ids are unique across consecutive firings', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  for (const d of ['a', 'b', 'c']) det.recordElevation(d, 3, NOW);
  const a = det.detect()!;
  const b = det.detect()!;
  assert.notEqual(a.id, b.id);
});

test('detect domains list is sorted alphabetically', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  det.recordElevation('zulu', 3, NOW);
  det.recordElevation('alpha', 3, NOW);
  det.recordElevation('mike', 3, NOW);
  const event = det.detect()!;
  assert.deepEqual(event.domains, ['alpha', 'mike', 'zulu']);
});

test('detect dedupes multiple elevations from the same domain', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  for (let i = 0; i < 5; i += 1) det.recordElevation('finance', 3, NOW - i * 1000);
  det.recordElevation('cyber', 3, NOW - 1000);
  det.recordElevation('maritime', 3, NOW - 1000);
  const event = det.detect()!;
  assert.equal(event.domains.length, 3);
});

// ── detect: parameter overrides ──────────────────────────────────────

test('detect honors a tighter custom windowMs', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  // Three elevations spread across 2h.
  det.recordElevation('a', 3, NOW - 30 * 60_000);
  det.recordElevation('b', 3, NOW - 60 * 60_000);
  det.recordElevation('c', 3, NOW - 90 * 60_000);
  // 1h window only covers the first two → < minDomains → null.
  assert.equal(det.detect(60 * 60_000, 2, 3), null);
  // 2h window covers all three → fires.
  assert.ok(det.detect(2 * 60 * 60_000, 2, 3));
});

test('detect honors a custom minSeverity threshold', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  for (const d of ['a', 'b', 'c']) det.recordElevation(d, 2, NOW);
  // All elevations are exactly severity 2; minSeverity=3 → null.
  assert.equal(det.detect(DEFAULT_WINDOW_MS, 3, 3), null);
  // minSeverity=2 → fires.
  assert.ok(det.detect(DEFAULT_WINDOW_MS, 2, 3));
});

test('detect honors a custom minDomains', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  det.recordElevation('a', 3, NOW);
  det.recordElevation('b', 3, NOW);
  // Default minDomains=3 → null with two domains.
  assert.equal(det.detect(), null);
  // Custom minDomains=2 → fires.
  assert.ok(det.detect(DEFAULT_WINDOW_MS, 2, 2));
});

// ── detect: scoring + label ──────────────────────────────────────────

test('detect scores: ratio * (avgSeverity / 4)', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  // Universe = 3 domains, all 3 match, avg severity 3 → 1 * 0.75 = 0.75.
  for (const d of ['a', 'b', 'c']) det.recordElevation(d, 3, NOW);
  const event = det.detect()!;
  assert.equal(event.score, 0.75);
});

test('detect labels CRITICAL when score is above 0.7', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  for (const d of ['a', 'b', 'c']) det.recordElevation(d, 4, NOW);
  const event = det.detect()!;
  assert.ok(event.score > CRITICAL_FLOOR);
  assert.equal(event.label, 'CRITICAL CONVERGENCE');
});

test('detect labels THREAT when score is in (0.4, 0.7]', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  // Universe = 4 (one is noise), 3 match @ severity 2.5 avg → 0.75 * 0.625 ≈ 0.469.
  det.recordElevation('a', 3, NOW);
  det.recordElevation('b', 2, NOW);
  det.recordElevation('c', 2, NOW);
  det.recordElevation('noise', 1, NOW); // adds to universe but won't match
  const event = det.detect()!;
  assert.ok(event.score > THREAT_FLOOR && event.score <= CRITICAL_FLOOR,
    `expected (${THREAT_FLOOR}, ${CRITICAL_FLOOR}], got ${event.score}`);
  assert.equal(event.label, 'THREAT CONVERGENCE');
});

test('detect labels ELEVATED at or below the threat floor', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  // 3 match out of 8 unique-domain universe, all severity 2 → 0.375 * 0.5 = 0.1875.
  for (let i = 0; i < 8; i += 1) det.recordElevation(`d-${i}`, 1, NOW);
  for (const d of ['d-0', 'd-1', 'd-2']) det.recordElevation(d, 2, NOW);
  const event = det.detect()!;
  assert.ok(event.score <= THREAT_FLOOR);
  assert.equal(event.label, 'ELEVATED CONVERGENCE');
});

test('detect uses the strongest severity per domain when computing avg', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  det.recordElevation('a', 2, NOW - 2000);
  det.recordElevation('a', 4, NOW - 1000); // strongest a
  det.recordElevation('b', 4, NOW - 1000);
  det.recordElevation('c', 4, NOW - 1000);
  const event = det.detect()!;
  // avg = (4+4+4)/3 = 4 → score = 1 * 1 = 1 (CRITICAL)
  assert.equal(event.score, 1);
});

test('detect score caps at 1 even when matching > totalDomains via overcounting', () => {
  // Edge case: if the universe is empty (clean instance) but we
  // somehow detected, the formula's denominator clamps to the match
  // count so the ratio stays at 1.
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  for (const d of ['a', 'b', 'c']) det.recordElevation(d, 4, NOW);
  const event = det.detect()!;
  assert.ok(event.score <= 1);
});

// ── History ──────────────────────────────────────────────────────────

test('getHistory returns nothing when no events have fired', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  assert.deepEqual(det.getHistory(), []);
});

test('getHistory returns events newest-first', () => {
  const clock = makeClock();
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock });
  for (const d of ['a', 'b', 'c']) det.recordElevation(d, 3, clock());
  const first = det.detect()!;
  clock.advance(1000);
  const second = det.detect()!;
  const history = det.getHistory();
  assert.equal(history[0]!.id, second.id);
  assert.equal(history[1]!.id, first.id);
});

test('getHistory honors limit', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  for (const d of ['a', 'b', 'c']) det.recordElevation(d, 3, NOW);
  for (let i = 0; i < 5; i += 1) det.detect();
  assert.equal(det.getHistory(2).length, 2);
  assert.equal(det.getHistory(0).length, 0);
});

test('getHistory returns defensive copies', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  for (const d of ['a', 'b', 'c']) det.recordElevation(d, 3, NOW);
  det.detect();
  const history = det.getHistory();
  history[0]!.domains.push('mutated');
  assert.equal(det.getHistory()[0]!.domains.includes('mutated'), false);
});

test('event ring evicts oldest past MAX_EVENTS', () => {
  const det = new ThreatConvergenceDetector({ storage: makeFakeStorage(), clock: () => NOW });
  for (const d of ['a', 'b', 'c']) det.recordElevation(d, 3, NOW);
  for (let i = 0; i < MAX_EVENTS + 10; i += 1) det.detect();
  assert.equal(det.getHistory().length, MAX_EVENTS);
});

// ── Persistence ──────────────────────────────────────────────────────

test('elevations + events survive a fresh instance', () => {
  const storage = makeFakeStorage();
  const det1 = new ThreatConvergenceDetector({ storage, clock: () => NOW });
  for (const d of ['a', 'b', 'c']) det1.recordElevation(d, 3, NOW);
  det1.detect();
  const det2 = new ThreatConvergenceDetector({ storage, clock: () => NOW });
  assert.equal(det2.getElevations().length, 3);
  assert.equal(det2.getHistory().length, 1);
});

test('corrupt persistence blob is ignored', () => {
  const storage = makeFakeStorage({ [STORAGE_KEY]: 'not-json' });
  const det = new ThreatConvergenceDetector({ storage, clock: () => NOW });
  assert.deepEqual(det.getElevations(), []);
  assert.deepEqual(det.getHistory(), []);
});

test('non-object persistence payload is ignored', () => {
  const storage = makeFakeStorage({ [STORAGE_KEY]: JSON.stringify([1, 2, 3]) });
  const det = new ThreatConvergenceDetector({ storage, clock: () => NOW });
  assert.deepEqual(det.getElevations(), []);
});

test('null storage works (no-op persistence)', () => {
  const det = new ThreatConvergenceDetector({ storage: null, clock: () => NOW });
  for (const d of ['a', 'b', 'c']) det.recordElevation(d, 3, NOW);
  assert.ok(det.detect());
});

test('resetForTesting clears state + persisted blob', () => {
  const storage = makeFakeStorage();
  const det = new ThreatConvergenceDetector({ storage, clock: () => NOW });
  for (const d of ['a', 'b', 'c']) det.recordElevation(d, 3, NOW);
  det.detect();
  det.resetForTesting();
  assert.equal(det.getElevations().length, 0);
  assert.equal(det.getHistory().length, 0);
  assert.equal(storage.raw.has(STORAGE_KEY), false);
});

// ── Singleton ────────────────────────────────────────────────────────

test('ThreatConvergenceDetector.getInstance returns a stable singleton', () => {
  ThreatConvergenceDetector._resetForTests();
  const a = ThreatConvergenceDetector.getInstance();
  const b = ThreatConvergenceDetector.getInstance();
  assert.equal(a, b);
  ThreatConvergenceDetector._resetForTests();
});

test('getThreatConvergenceDetector mirrors getInstance', () => {
  ThreatConvergenceDetector._resetForTests();
  const a = getThreatConvergenceDetector();
  const b = ThreatConvergenceDetector.getInstance();
  assert.equal(a, b);
  ThreatConvergenceDetector._resetForTests();
});

test('singleton reset returns a fresh instance', () => {
  const a = ThreatConvergenceDetector.getInstance();
  ThreatConvergenceDetector._resetForTests();
  const b = ThreatConvergenceDetector.getInstance();
  assert.notEqual(a, b);
  ThreatConvergenceDetector._resetForTests();
});

test('__internals exposes the documented thresholds', () => {
  assert.equal(__internals.CRITICAL_FLOOR, 0.7);
  assert.equal(__internals.THREAT_FLOOR, 0.4);
  assert.equal(__internals.DEFAULT_MIN_DOMAINS, DEFAULT_MIN_DOMAINS);
});
