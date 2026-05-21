/**
 * Tests for AlertFatigueDetector — the rolling-window fatigue score, the
 * recommendation ladder, and the LocalStorage persistence path.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AlertFatigueDetector,
  STORAGE_KEY,
  recommendationFor,
  type StorageLike,
} from '../../src/services/intelligence/alert-fatigue-detector.ts';

// ── Test helpers ──────────────────────────────────────────────────────────

function makeStorage(): StorageLike & { getRaw(): string | null; size(): number } {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    getRaw: () => map.get(STORAGE_KEY) ?? null,
    size: () => map.size,
  };
}

function makeClock(start: number): { now: () => number; advance(ms: number): void; set(ms: number): void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
    set: (ms: number) => { t = ms; },
  };
}

const T0 = Date.parse('2026-05-18T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

// ── recordAlert ───────────────────────────────────────────────────────────

test('recordAlert returns a unique id per alert', () => {
  const clock = makeClock(T0);
  const d = new AlertFatigueDetector({ storage: null, now: clock.now });
  const a = d.recordAlert('weather', 50);
  const b = d.recordAlert('weather', 50);
  assert.notEqual(a, b);
});

test('recordAlert clamps severity into [0, 100]', () => {
  const clock = makeClock(T0);
  const d = new AlertFatigueDetector({ storage: null, now: clock.now });
  d.recordAlert('weather', -10);
  d.recordAlert('weather', 250);
  const all = d.getAllAlerts();
  assert.equal(all[0]?.severity, 0);
  assert.equal(all[1]?.severity, 100);
});

test('recordAlert handles non-finite severity by clamping to 0', () => {
  const d = new AlertFatigueDetector({ storage: null, now: makeClock(T0).now });
  d.recordAlert('w', Number.NaN);
  assert.equal(d.getAllAlerts()[0]?.severity, 0);
});

test('recordAlert stamps the current clock time on each record', () => {
  const clock = makeClock(T0);
  const d = new AlertFatigueDetector({ storage: null, now: clock.now });
  d.recordAlert('w', 10);
  clock.advance(5 * MIN);
  d.recordAlert('w', 10);
  const all = d.getAllAlerts();
  assert.equal(all[0]?.timestamp, T0);
  assert.equal(all[1]?.timestamp, T0 + 5 * MIN);
});

test('recordAlert enforces capacity (oldest dropped)', () => {
  const clock = makeClock(T0);
  const d = new AlertFatigueDetector({ storage: null, now: clock.now, capacity: 3 });
  d.recordAlert('w', 10);
  d.recordAlert('w', 20);
  d.recordAlert('w', 30);
  d.recordAlert('w', 40);
  const all = d.getAllAlerts();
  assert.equal(all.length, 3);
  assert.deepEqual(all.map((a) => a.severity), [20, 30, 40]);
});

// ── acknowledge ───────────────────────────────────────────────────────────

test('acknowledge flips the matching record', () => {
  const d = new AlertFatigueDetector({ storage: null, now: makeClock(T0).now });
  const id = d.recordAlert('w', 50);
  assert.equal(d.getAllAlerts()[0]?.acknowledged, false);
  d.acknowledge(id);
  assert.equal(d.getAllAlerts()[0]?.acknowledged, true);
});

test('acknowledge is a no-op for an unknown id', () => {
  const d = new AlertFatigueDetector({ storage: null, now: makeClock(T0).now });
  d.recordAlert('w', 50);
  d.acknowledge('does-not-exist');
  assert.equal(d.getAllAlerts()[0]?.acknowledged, false);
});

test('acknowledge twice is idempotent', () => {
  const d = new AlertFatigueDetector({ storage: null, now: makeClock(T0).now });
  const id = d.recordAlert('w', 50);
  d.acknowledge(id);
  d.acknowledge(id);
  assert.equal(d.getAllAlerts()[0]?.acknowledged, true);
});

// ── getFatigueReport: window & math ───────────────────────────────────────

test('empty detector returns zero alertCount + zero score + recommendation none', () => {
  const d = new AlertFatigueDetector({ storage: null, now: makeClock(T0).now });
  const r = d.getFatigueReport();
  assert.equal(r.alertCount, 0);
  assert.equal(r.ackRate, 0);
  assert.equal(r.fatigueScore, 0);
  assert.equal(r.recommendation, 'none');
  assert.equal(r.topDomain, '');
});

test('only alerts inside the window count toward the report', () => {
  const clock = makeClock(T0);
  const d = new AlertFatigueDetector({ storage: null, now: clock.now });
  d.recordAlert('w', 50);          // T0 (will fall out)
  clock.advance(2 * HOUR);
  d.recordAlert('q', 50);          // T0 + 2h
  d.recordAlert('q', 50);          // T0 + 2h
  // Default window = 1h, so only the two recent alerts should count.
  const r = d.getFatigueReport();
  assert.equal(r.alertCount, 2);
  assert.equal(r.topDomain, 'q');
});

test('windowMs override narrows the window', () => {
  const clock = makeClock(T0);
  const d = new AlertFatigueDetector({ storage: null, now: clock.now });
  d.recordAlert('w', 50);
  clock.advance(10 * MIN);
  d.recordAlert('w', 50);
  // 5-minute window misses the older alert
  const r = d.getFatigueReport(5 * MIN);
  assert.equal(r.alertCount, 1);
});

test('windowMs <= 0 falls back to default 1h window', () => {
  const clock = makeClock(T0);
  const d = new AlertFatigueDetector({ storage: null, now: clock.now });
  d.recordAlert('w', 50);
  const r = d.getFatigueReport(0);
  assert.equal(r.windowMs, HOUR);
  assert.equal(r.alertCount, 1);
});

test('ackRate counts acknowledged in-window alerts only', () => {
  const clock = makeClock(T0);
  const d = new AlertFatigueDetector({ storage: null, now: clock.now });
  const a = d.recordAlert('w', 50);
  d.recordAlert('w', 50);
  d.acknowledge(a);
  const r = d.getFatigueReport();
  assert.equal(r.ackRate, 0.5);
});

test('fatigueScore = (count/50) × (1 - ackRate), clamped to 1', () => {
  const clock = makeClock(T0);
  const d = new AlertFatigueDetector({ storage: null, now: clock.now });
  // 25 unacked alerts → volume=0.5, quality=1.0, score=0.5
  for (let i = 0; i < 25; i++) d.recordAlert('w', 50);
  const r = d.getFatigueReport();
  assert.equal(r.alertCount, 25);
  assert.equal(r.ackRate, 0);
  assert.equal(r.fatigueScore, 0.5);
});

test('fatigueScore drops to 0 when every alert is acknowledged', () => {
  const clock = makeClock(T0);
  const d = new AlertFatigueDetector({ storage: null, now: clock.now });
  const ids: string[] = [];
  for (let i = 0; i < 25; i++) ids.push(d.recordAlert('w', 50));
  for (const id of ids) d.acknowledge(id);
  const r = d.getFatigueReport();
  assert.equal(r.ackRate, 1);
  assert.equal(r.fatigueScore, 0);
  assert.equal(r.recommendation, 'none');
});

test('fatigueScore saturates at 1 when volume > saturation reference', () => {
  const d = new AlertFatigueDetector({ storage: null, now: makeClock(T0).now });
  for (let i = 0; i < 200; i++) d.recordAlert('w', 50);
  const r = d.getFatigueReport();
  assert.equal(r.fatigueScore, 1);
  assert.equal(r.recommendation, 'escalate-only');
});

// ── topDomain ─────────────────────────────────────────────────────────────

test('topDomain reports the most-frequent domain in window', () => {
  const d = new AlertFatigueDetector({ storage: null, now: makeClock(T0).now });
  d.recordAlert('weather', 50);
  d.recordAlert('weather', 50);
  d.recordAlert('cyber', 50);
  assert.equal(d.getFatigueReport().topDomain, 'weather');
});

test('topDomain tiebreaker is insertion order (first observed wins)', () => {
  const d = new AlertFatigueDetector({ storage: null, now: makeClock(T0).now });
  d.recordAlert('cyber', 50);
  d.recordAlert('weather', 50);
  // Both tied at 1 each → cyber wins (recorded first).
  assert.equal(d.getFatigueReport().topDomain, 'cyber');
});

// ── recommendation ladder ─────────────────────────────────────────────────

test('recommendationFor maps score 0.81 → escalate-only', () => {
  assert.equal(recommendationFor(0.81), 'escalate-only');
});

test('recommendationFor maps score 0.51 → suppress-low', () => {
  assert.equal(recommendationFor(0.51), 'suppress-low');
});

test('recommendationFor maps score 0.31 → batch', () => {
  assert.equal(recommendationFor(0.31), 'batch');
});

test('recommendationFor maps score 0 → none', () => {
  assert.equal(recommendationFor(0), 'none');
});

test('recommendationFor: thresholds use strict > (boundary stays in lower bucket)', () => {
  // 0.3 is NOT > 0.3, so stays at 'none'
  assert.equal(recommendationFor(0.3), 'none');
  // 0.5 is NOT > 0.5, so stays at 'batch'
  assert.equal(recommendationFor(0.5), 'batch');
  // 0.8 is NOT > 0.8, so stays at 'suppress-low'
  assert.equal(recommendationFor(0.8), 'suppress-low');
});

// ── getAlertRate ──────────────────────────────────────────────────────────

test('getAlertRate returns 0 on empty detector', () => {
  const d = new AlertFatigueDetector({ storage: null, now: makeClock(T0).now });
  assert.equal(d.getAlertRate(HOUR), 0);
});

test('getAlertRate returns alerts/min over the window', () => {
  const clock = makeClock(T0);
  const d = new AlertFatigueDetector({ storage: null, now: clock.now });
  // 6 alerts inside the last 30 min → 6/30 = 0.2 alerts/min.
  for (let i = 0; i < 6; i++) d.recordAlert('w', 10);
  assert.equal(d.getAlertRate(30 * MIN), 0.2);
});

test('getAlertRate excludes alerts outside the window', () => {
  const clock = makeClock(T0);
  const d = new AlertFatigueDetector({ storage: null, now: clock.now });
  d.recordAlert('w', 10);
  clock.advance(2 * HOUR);
  // Now the alert is outside a 1h window.
  assert.equal(d.getAlertRate(HOUR), 0);
});

// ── Storage persistence ───────────────────────────────────────────────────

test('persist + hydrate round-trips alerts across instances', () => {
  const storage = makeStorage();
  const clock = makeClock(T0);
  const a = new AlertFatigueDetector({ storage, now: clock.now });
  const id1 = a.recordAlert('weather', 60);
  a.recordAlert('cyber', 80);
  a.acknowledge(id1);

  const b = new AlertFatigueDetector({ storage, now: clock.now });
  const all = b.getAllAlerts();
  assert.equal(all.length, 2);
  assert.equal(all[0]?.acknowledged, true);
  assert.equal(all[1]?.acknowledged, false);
  assert.equal(all[1]?.domain, 'cyber');
});

test('persist writes under STORAGE_KEY = wm-alert-fatigue', () => {
  const storage = makeStorage();
  const d = new AlertFatigueDetector({ storage, now: makeClock(T0).now });
  d.recordAlert('weather', 50);
  assert.equal(STORAGE_KEY, 'wm-alert-fatigue');
  assert.ok(storage.getRaw());
});

test('hydrate ignores malformed records without throwing', () => {
  const storage = makeStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ alerts: [
    { id: 'good', domain: 'w', severity: 50, timestamp: T0, acknowledged: false },
    { id: 'bad-missing-severity', domain: 'w', timestamp: T0, acknowledged: false },
    null,
    'not-an-object',
  ] }));
  const d = new AlertFatigueDetector({ storage, now: makeClock(T0).now });
  const all = d.getAllAlerts();
  assert.equal(all.length, 1);
  assert.equal(all[0]?.id, 'good');
});

test('hydrate from corrupt JSON falls back to empty detector', () => {
  const storage = makeStorage();
  storage.setItem(STORAGE_KEY, '{this is not json');
  const d = new AlertFatigueDetector({ storage, now: makeClock(T0).now });
  assert.equal(d.getAllAlerts().length, 0);
});

test('hydrate trims oversized persisted state to capacity', () => {
  const storage = makeStorage();
  const records = Array.from({ length: 1010 }, (_, i) => ({
    id: `r${i}`, domain: 'w', severity: 10, timestamp: T0, acknowledged: false,
  }));
  storage.setItem(STORAGE_KEY, JSON.stringify({ alerts: records }));
  const d = new AlertFatigueDetector({ storage, now: makeClock(T0).now });
  assert.equal(d.getAllAlerts().length, 1000); // default capacity
});

test('persist swallows storage errors (does not throw on setItem failure)', () => {
  const failing: StorageLike = {
    getItem: () => null,
    setItem: () => { throw new Error('quota exceeded'); },
  };
  const d = new AlertFatigueDetector({ storage: failing, now: makeClock(T0).now });
  assert.doesNotThrow(() => d.recordAlert('w', 50));
});

// ── Singleton ─────────────────────────────────────────────────────────────

test('getInstance returns the same instance across calls', () => {
  AlertFatigueDetector.resetForTests();
  const a = AlertFatigueDetector.getInstance();
  const b = AlertFatigueDetector.getInstance();
  assert.equal(a, b);
  AlertFatigueDetector.resetForTests();
});

test('resetForTests forces a fresh instance', () => {
  AlertFatigueDetector.resetForTests();
  const a = AlertFatigueDetector.getInstance();
  AlertFatigueDetector.resetForTests();
  const b = AlertFatigueDetector.getInstance();
  assert.notEqual(a, b);
  AlertFatigueDetector.resetForTests();
});

// ── End-to-end recommendation scenario ────────────────────────────────────

test('escalate-only fires under sustained unacked alert flood', () => {
  const clock = makeClock(T0);
  const d = new AlertFatigueDetector({ storage: null, now: clock.now });
  for (let i = 0; i < 45; i++) d.recordAlert('w', 50);
  const r = d.getFatigueReport();
  // 45/50 × 1 = 0.9 → escalate-only
  assert.equal(r.recommendation, 'escalate-only');
});

test('batch fires in the early-stress band', () => {
  const clock = makeClock(T0);
  const d = new AlertFatigueDetector({ storage: null, now: clock.now });
  for (let i = 0; i < 20; i++) d.recordAlert('w', 50);
  // 20/50 × 1 = 0.4 → batch
  assert.equal(d.getFatigueReport().recommendation, 'batch');
});

test('recommendation backs off once user starts acknowledging', () => {
  const clock = makeClock(T0);
  const d = new AlertFatigueDetector({ storage: null, now: clock.now });
  const ids: string[] = [];
  for (let i = 0; i < 30; i++) ids.push(d.recordAlert('w', 50));
  // 30/50 × 1 = 0.6 → suppress-low
  assert.equal(d.getFatigueReport().recommendation, 'suppress-low');
  // Now ack 25 of them: 30/50 × (5/30) = 0.1 → none
  for (let i = 0; i < 25; i++) d.acknowledge(ids[i]!);
  assert.equal(d.getFatigueReport().recommendation, 'none');
});
