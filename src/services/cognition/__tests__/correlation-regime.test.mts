import test from 'node:test';
import assert from 'node:assert/strict';
import * as scan from '../regime-scan';
import * as monitor from '../regime-monitor';
import { getPressureHistory, startPressureHistory } from '../../pressure-history';
import { notificationDispatcher } from '../../notification-dispatcher';
import { setCognitionEnabled } from '../cognition-settings';

const NOW = Date.UTC(2026, 10, 5, 12);
const domains = ['finance', 'security', 'disaster', 'cyber'] as const;
function history(n = 10) {
  return Object.fromEntries(domains.map(d => [d, Array.from({ length: n }, (_, i) => ({ timestamp: NOW - (n - i - 1) * 120_000, value: 0, observed: true }))]));
}
function evidence() { return { scannedAt: NOW, completeObservedAt: NOW, shifts: {} }; }
function shift(overrides = {}) { return { metric: 'finance', detectedAt: NOW, triggerValue: 1, runLength: 0, changeProbability: 0.8, direction: 'up', explanation: 'fixture', ...overrides }; }

test('qualified scan distinguishes ten observed samples from cold and legacy data', () => {
  assert.equal(typeof scan.scanCorrelationRegime, 'function');
  assert.equal(scan.classifyCorrelationRegime(scan.scanCorrelationRegime(history(), NOW), NOW, true), 'calm');
  assert.equal(scan.classifyCorrelationRegime(scan.scanCorrelationRegime(history(9), NOW), NOW, true), undefined);
  const legacy = history();
  for (const samples of Object.values(legacy)) for (const s of samples) delete s.observed;
  assert.equal(scan.classifyCorrelationRegime(scan.scanCorrelationRegime(legacy, NOW), NOW, true), undefined);
});

test('invalid or nonchronological samples cannot qualify calm', () => {
  assert.equal(typeof scan.scanCorrelationRegime, 'function');
  for (const patch of [{ value: NaN }, { value: -0.1 }, { value: 1.1 }, { timestamp: 0 }, { timestamp: NOW + 1 }, { timestamp: NOW - 120_000 }, { observed: false }]) {
    const h = history(); Object.assign(h.finance[9], patch);
    assert.equal(scan.classifyCorrelationRegime(scan.scanCorrelationRegime(h, NOW), NOW, true), undefined, JSON.stringify(patch));
  }
});

test('positive shift survives incomplete other domains and uses valid pressure observations', () => {
  assert.equal(typeof scan.scanCorrelationRegime, 'function');
  const h = history(26); h.finance[25].value = 1; h.cyber = [];
  const e = scan.scanCorrelationRegime(h, NOW);
  assert.ok(e.shifts.finance);
  assert.equal(scan.classifyCorrelationRegime(e, NOW, true), 'shifted');
  h.finance[25].observed = false;
  assert.equal(scan.classifyCorrelationRegime(scan.scanCorrelationRegime(h, NOW), NOW, true), undefined);
});

test('classification fails closed for stale, future, disabled or failed scans', () => {
  assert.equal(typeof scan.classifyCorrelationRegime, 'function');
  assert.equal(scan.classifyCorrelationRegime(evidence(), NOW + 240_000, true), 'calm');
  for (const [e, now, enabled] of [[evidence(), NOW + 240_001, true], [evidence(), NOW - 1, true], [evidence(), NOW, false], [null, NOW, true], [evidence(), NaN, true], [{ ...evidence(), completeObservedAt: NOW - 240_001 }, NOW, true], [{ ...evidence(), completeObservedAt: NOW + 1 }, NOW, true]]) {
    assert.equal(scan.classifyCorrelationRegime(e, now, enabled), undefined);
  }
});

test('shift field allowlists and six-hour horizon reject malformed evidence', () => {
  assert.equal(typeof scan.classifyCorrelationRegime, 'function');
  const shifted = { ...evidence(), completeObservedAt: null, shifts: { finance: shift() } };
  assert.equal(scan.classifyCorrelationRegime(shifted, NOW, true), 'shifted');
  assert.equal(scan.classifyCorrelationRegime(shifted, NOW + 240_001, true), undefined, 'stale scan cannot retain a still-young shift');
  for (const patch of [{ metric: 'unknown' }, { detectedAt: NOW + 1 }, { detectedAt: NaN }, { direction: 'sideways' }, { triggerValue: 2 }, { changeProbability: NaN }, { changeProbability: 0 }, { changeProbability: -1 }, { changeProbability: 1.1 }, { runLength: -1 }, { runLength: NaN }]) {
    assert.equal(scan.classifyCorrelationRegime({ ...shifted, shifts: { finance: shift(patch) } }, NOW, true), undefined, JSON.stringify(patch));
  }
  assert.equal(scan.classifyCorrelationRegime({ ...shifted, shifts: { finance: shift({ detectedAt: NOW - 21_600_000 }) } }, NOW, true), 'shifted');
  assert.equal(scan.classifyCorrelationRegime({ ...shifted, shifts: { finance: shift({ detectedAt: NOW - 21_600_001 }) } }, NOW, true), undefined);
});

test('live ingress witnesses actual values before fallback, monitor read honors kill and freshness', t => {
  assert.equal(typeof monitor.getCorrelationRegime, 'function');
  const storage = new Map();
  t.mock.method(notificationDispatcher, 'dispatchNotification', () => undefined);
  t.mock.method(Date, 'now', () => now);
  let now = NOW - 40 * 120_000;
  const doc = new EventTarget();
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } });
  t.after(() => {
    monitor._resetRegimeMonitorForTests();
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete globalThis.document;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage); else delete globalThis.localStorage;
  });
  startPressureHistory(); monitor._resetRegimeMonitorForTests(); monitor.startRegimeMonitor();
  const emit = (pressure, timestamp = now) => doc.dispatchEvent(new CustomEvent('cb:mode-advisory', { detail: { pressure, timestamp } }));
  for (let i = 0; i < 10; i++) { now += 120_000; emit({ finance: 0, security: 0, disaster: 0, cyber: 0 }); }
  assert.equal(monitor.getCorrelationRegime(now), 'calm');
  setCognitionEnabled('bocpd', false);
  assert.equal(monitor.getCorrelationRegime(now), undefined);
  setCognitionEnabled('bocpd', true);
  assert.equal(monitor.getCorrelationRegime(now + 240_001), undefined);
  now += 1; emit({ finance: 0, security: 0, disaster: 0 });
  assert.equal(monitor.getCorrelationRegime(now), undefined, 'unscanned ingress cannot retain the old complete witness');
  now += 120_000; emit({ finance: 0, security: 0, disaster: 0 });
  assert.equal(getPressureHistory().cyber.at(-1).value, 0, 'existing UI fallback preserved');
  assert.notEqual(getPressureHistory().cyber.at(-1).observed, true);
  assert.equal(monitor.getCorrelationRegime(now), undefined);
  now += 120_000; emit({ finance: 0, security: 0, disaster: 0, cyber: 0 }, 0);
  assert.notEqual(getPressureHistory().finance.at(-1).observed, true, 'fallback timestamp is not real observation');
  assert.equal(monitor.getCorrelationRegime(now), undefined);
  for (let i = 0; i < 10; i++) { now += 120_000; emit({ finance: 0, security: 0, disaster: 0, cyber: 0 }); }
  assert.equal(monitor.getCorrelationRegime(now), 'calm');
  const sample = getPressureHistory().finance[0];
  Object.defineProperty(sample, 'value', { configurable: true, get() { throw new Error('scan fixture'); } });
  now += 120_000; emit({ finance: 0, security: 0, disaster: 0, cyber: 0 });
  assert.equal(monitor.getCorrelationRegime(now), undefined, 'failed scan discards previous calm evidence');
  Object.defineProperty(sample, 'value', { configurable: true, writable: true, value: 0 });
});
