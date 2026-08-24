import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import type { ReactorAlert, NormalizedThreat } from '../threat-reactor.ts';
import type { UnifiedAlert } from '../unified-alerts.ts';
import { getNotificationTraceRegistry, resetDiagnosticsState } from '../diagnostics/diagnostics-state.ts';

interface Recorder {
  putCalls: UnifiedAlert[];
  toastCalls: { title: string; body: string; severity: string }[];
  nativeCalls: { title: string; body: string }[];
  markerCalls: { lat: number; lon: number; alertId: string }[];
  fanoutOrder: string[];
  ghost: boolean;
  existing: UnifiedAlert[];
  now: number;
}

function makeRecorder(): Recorder {
  return {
 putCalls: [],
 toastCalls: [],
 nativeCalls: [],
 markerCalls: [],
 fanoutOrder: [],
 ghost: false,
 existing: [],
 now: 1_700_000_000_000,
  };
}

function makeDeps(rec: Recorder) {
  return {
 alertDB: {
 put: async (a: UnifiedAlert) => {
 rec.putCalls.push(a);
 rec.fanoutOrder.push('put');
 },
 getAll: async (_opts?: { since?: number }) => rec.existing,
 },
 showToast: (title: string, body: string, severity: string) => {
 rec.toastCalls.push({ title, body, severity });
 rec.fanoutOrder.push('toast');
 },
 sendNativeNotification: async (title: string, body: string) => {
 rec.nativeCalls.push({ title, body });
 rec.fanoutOrder.push('native');
 },
 addMapMarker: (lat: number, lon: number, alertId: string) => {
 rec.markerCalls.push({ lat, lon, alertId });
 rec.fanoutOrder.push('marker');
 },
 isGhostMode: () => rec.ghost,
 now: () => rec.now,
  };
}

function makeThreat(over: Partial<NormalizedThreat> = {}): NormalizedThreat {
  return {
 id: 'a',
 source: 'feodo',
 indicator: '1.2.3.4',
 indicatorType: 'ip',
 severity: 'medium',
 title: 'Threat',
 body: 'body',
 lat: 10,
 lon: 20,
 ...over,
  };
}

function makeAlert(over: Partial<NormalizedThreat> = {}, alertId = 'aid1'): ReactorAlert {
  return {
 threat: makeThreat(over),
 relevance: { score: 50, reason: 'high_severity', explanation: 'x' },
 alertId,
 createdAt: 1_700_000_000_000,
  };
}

async function loadFresh() {
  const url = new URL('../notification-router.ts', import.meta.url).href + `?t=${Math.random()}`;
  return (await import(url)) as typeof import('../notification-router.ts');
}

beforeEach(() => {
  resetDiagnosticsState();
  // clean localStorage stub
  (globalThis as { localStorage?: Storage }).localStorage = {
 _s: new Map<string, string>(),
 getItem(k: string) { return (this._s as Map<string, string>).get(k) ?? null; },
 setItem(k: string, v: string) { (this._s as Map<string, string>).set(k, v); },
 removeItem(k: string) { (this._s as Map<string, string>).delete(k); },
 clear() { (this._s as Map<string, string>).clear(); },
 key() { return null; },
 length: 0,
  } as unknown as Storage;
});

test('severity gate: minSeverity=high drops a medium alert', async () => {
  const rec = makeRecorder();
  const mod = await loadFresh();
  mod.updateRouterConfig({ minSeverity: 'high' });
  const stop = mod.startNotificationRouter(makeDeps(rec));
  await mod.__deliverForTesting(makeAlert({ severity: 'medium' }));
  stop();
  assert.equal(rec.putCalls.length, 0);
  assert.equal(rec.nativeCalls.length, 0);
});

test('rate limit: two consecutive medium alerts -> only first native, both inbox', async () => {
  const rec = makeRecorder();
  const mod = await loadFresh();
  mod.updateRouterConfig({ minSeverity: 'low' });
  const stop = mod.startNotificationRouter(makeDeps(rec));
  await mod.__deliverForTesting(makeAlert({ severity: 'medium', indicator: 'x1' }, 'id1'));
  rec.now += 1000;
  await mod.__deliverForTesting(makeAlert({ severity: 'medium', indicator: 'x2' }, 'id2'));
  stop();
  assert.equal(rec.putCalls.length, 2);
  assert.equal(rec.nativeCalls.length, 1);
});

test('critical alerts bypass rate limit', async () => {
  const rec = makeRecorder();
  const mod = await loadFresh();
  const stop = mod.startNotificationRouter(makeDeps(rec));
  await mod.__deliverForTesting(makeAlert({ severity: 'critical' }, 'c1'));
  rec.now += 10;
  await mod.__deliverForTesting(makeAlert({ severity: 'critical' }, 'c2'));
  stop();
  assert.equal(rec.nativeCalls.length, 2);
});

test('trace confidence stays finite when relevance is non-finite', async () => {
  const rec = makeRecorder();
  const mod = await loadFresh();
  const stop = mod.startNotificationRouter(makeDeps(rec));
  const candidate = makeAlert({ severity: 'high' }, 'non-finite');
  candidate.relevance.score = Number.NaN;

  await mod.__deliverForTesting(candidate);
  stop();

  const [entry] = getNotificationTraceRegistry().all();
  assert.equal(entry?.candidate.confidence, 0);
  assert.equal(entry?.candidate.userRelevance, 0);
});

test('ghost mode: skips native + map marker, still writes inbox + toast', async () => {
  const rec = makeRecorder();
  rec.ghost = true;
  const mod = await loadFresh();
  const stop = mod.startNotificationRouter(makeDeps(rec));
  await mod.__deliverForTesting(makeAlert({ severity: 'critical' }, 'g1'));
  stop();
  assert.equal(rec.putCalls.length, 1);
  assert.equal(rec.toastCalls.length, 1);
  assert.equal(rec.nativeCalls.length, 0);
  assert.equal(rec.markerCalls.length, 0);
});

test('dedupe: existing alert with same id from <24h ago skips everything', async () => {
  const rec = makeRecorder();
  rec.existing = [
 {
 id: 'dup1',
 source: 'cyber',
 severity: 'high',
 title: 't',
 body: 'b',
 timestamp: rec.now - 1000,
 relevanceScore: 50,
 acknowledged: false,
 pinned: false,
 },
  ];
  const mod = await loadFresh();
  const stop = mod.startNotificationRouter(makeDeps(rec));
  await mod.__deliverForTesting(makeAlert({ severity: 'high' }, 'dup1'));
  stop();
  assert.equal(rec.putCalls.length, 0);
  assert.equal(rec.toastCalls.length, 0);
  assert.equal(rec.nativeCalls.length, 0);
  assert.equal(rec.markerCalls.length, 0);
});

test('fan-out order: put -> toast -> native -> marker', async () => {
  const rec = makeRecorder();
  const mod = await loadFresh();
  const stop = mod.startNotificationRouter(makeDeps(rec));
  await mod.__deliverForTesting(makeAlert({ severity: 'critical' }, 'fo1'));
  stop();
  assert.deepEqual(rec.fanoutOrder, ['put', 'toast', 'native', 'marker']);
});

test('notifyToast=false suppresses toast but other channels still fire', async () => {
  const rec = makeRecorder();
  const mod = await loadFresh();
  mod.updateRouterConfig({ notifyToast: false });
  const stop = mod.startNotificationRouter(makeDeps(rec));
  await mod.__deliverForTesting(makeAlert({ severity: 'critical' }, 'nt1'));
  stop();
  assert.equal(rec.toastCalls.length, 0);
  assert.equal(rec.putCalls.length, 1);
  assert.equal(rec.nativeCalls.length, 1);
  assert.equal(rec.markerCalls.length, 1);
});

test('severity gate is recorded in the production notification trace', async () => {
  const rec = makeRecorder();
  const mod = await loadFresh();
  mod.updateRouterConfig({ minSeverity: 'high' });
  const stop = mod.startNotificationRouter(makeDeps(rec));

  await mod.__deliverForTesting(makeAlert({ severity: 'medium' }, 'trace-severity'));
  stop();

  const [entry] = getNotificationTraceRegistry().all();
  assert.equal(entry?.decision, 'suppressed');
  assert.equal(entry?.decisionReason, 'below-min-severity');
});

test('ghost-mode native suppression is recorded while in-app delivery remains dispatched', async () => {
  const rec = makeRecorder();
  rec.ghost = true;
  const mod = await loadFresh();
  const stop = mod.startNotificationRouter(makeDeps(rec));

  await mod.__deliverForTesting(makeAlert({ severity: 'critical' }, 'trace-ghost'));
  stop();

  const [entry] = getNotificationTraceRegistry().all();
  assert.equal(entry?.decision, 'dispatched');
  assert.equal(entry?.rung, 'in_app');
  assert.deepEqual(entry?.nativeResult, {
    delivered: false,
    surface: 'in_app',
    error: 'ghost-mode',
  });
});

test('native delivery failure is recorded in the production notification trace', async () => {
  const rec = makeRecorder();
  const deps = makeDeps(rec);
  deps.sendNativeNotification = async () => { throw new Error('native down'); };
  const mod = await loadFresh();
  const stop = mod.startNotificationRouter(deps);

  await mod.__deliverForTesting(makeAlert({ severity: 'critical' }, 'trace-native-failure'));
  stop();

  const [entry] = getNotificationTraceRegistry().all();
  assert.deepEqual(entry?.nativeResult, {
    delivered: false,
    surface: 'failed',
    error: 'native-delivery-failed',
  });
});
