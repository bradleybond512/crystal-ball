import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { UnifiedAlert } from '../unified-alerts.ts';

const now = 1_790_000_000_000;
const fiveMinutes = 300_000;
const values = new Map<string, string>();
let flashes: string[] = [];
const timers: number[] = [];
let audioAttempts = 0;
let mapRows: { id: string; severity: string }[] = [];

function surface(name: string) {
  return { classList: { add: () => flashes.push(name), remove() {}, contains: () => false } };
}
const document = Object.assign(new EventTarget(), {
  body: surface('window'),
  querySelector: (selector: string) => surface(selector),
});
document.addEventListener('cb:alert-pulses', event => { mapRows = (event as CustomEvent).detail; });
Object.assign(globalThis, {
  document, requestAnimationFrame: () => 0,
  window: {
    setTimeout(fn: () => void, delay: number) { timers.push(delay); return setTimeout(fn, delay); },
  },
  AudioContext: class { constructor() { audioAttempts++; throw new Error('No physical audio device in fixture'); } },
  localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
});
const { unifiedAlertStore } = await import('../unified-alerts.ts');
const { notificationDispatcher } = await import('../notification-dispatcher.ts');
const { alertDB } = await import('../alert-store.ts');
const { startAlertReactions } = await import('../alert-reactions.ts');
const { scoreAlert } = await import('../alert-routing.ts');
startAlertReactions();

beforeEach(t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  t.mock.method(notificationDispatcher, 'dispatchNotification', () => {});
  t.mock.method(alertDB, 'putBatch', async () => {});
  flashes = [];
  timers.length = 0;
  mapRows = [];
  audioAttempts = 0;
});

function alert(id: string, source: 'correlation' | 'nws'): UnifiedAlert {
  return {
    id, source, severity: 'critical', title: id, body: 'fixture',
    timestamp: now, location: { lat: 0, lon: 0 }, relevanceScore: source === 'correlation' ? 100 : 0,
    acknowledged: false, pinned: false,
  };
}

function ingest(...alerts: UnifiedAlert[]) {
  unifiedAlertStore.ingest(alerts);
  unifiedAlertStore._flushNowForTest();
}

const warningPanel = '[data-panel="unified-alert-inbox"]';

test('critical derived batch remains visible at original severity without flashes, sound or a reminder', t => {
  const derived = alert('derived-only', 'correlation');
  ingest(derived);
  assert.equal(unifiedAlertStore.getAll().find(item => item.id === derived.id)?.severity, 'critical');
  assert.ok(mapRows.some(row => row.id === derived.id && row.severity === 'critical'));
  assert.deepEqual(flashes, []);
  assert.equal(audioAttempts, 0);
  assert.ok(!timers.includes(fiveMinutes));
  t.mock.timers.tick(fiveMinutes);
  assert.deepEqual(flashes, []);
  assert.equal(audioAttempts, 0);
});

test('higher-ranked derived item leaves the NWS reaction and reminder available in a mixed batch', t => {
  const derived = alert('mixed-derived', 'correlation');
  const warning = alert('mixed-warning', 'nws');
  assert.ok(scoreAlert(derived) > scoreAlert(warning));
  ingest(derived, warning);
  for (const item of [derived, warning]) assert.ok(mapRows.some(row => row.id === item.id));
  assert.deepEqual(flashes, [warningPanel, 'window']);
  assert.equal(audioAttempts, 1);
  assert.equal(timers.filter(delay => delay === fiveMinutes).length, 1);
  t.mock.timers.tick(fiveMinutes);
  assert.deepEqual(flashes, [warningPanel, 'window', warningPanel, 'window']);
  assert.equal(audioAttempts, 2);
});

test('a hot derived item does not promote a below-threshold warning into an interruption', () => {
  const derived = alert('hot-derived', 'correlation');
  const advisory = { ...alert('advisory', 'nws'), severity: 'low' as const };
  ingest(derived, advisory);
  assert.ok(mapRows.some(row => row.id === derived.id));
  assert.ok(!mapRows.some(row => row.id === advisory.id));
  assert.deepEqual(flashes, []);
  assert.equal(audioAttempts, 0);
  assert.ok(!timers.includes(fiveMinutes));
});

test('an outstanding NWS reminder cannot interrupt after a derived alert replaces that store ID', t => {
  const warning = alert('reused-id', 'nws');
  ingest(warning);
  assert.deepEqual(flashes, [warningPanel, 'window']);
  ingest(alert(warning.id, 'correlation'));
  assert.equal(unifiedAlertStore.getAll().find(item => item.id === warning.id)?.source, 'correlation');
  t.mock.timers.tick(fiveMinutes);
  assert.deepEqual(flashes, [warningPanel, 'window']);
  assert.equal(audioAttempts, 1);
});
