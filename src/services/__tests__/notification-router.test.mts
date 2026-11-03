import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import type { ReactorAlert, NormalizedThreat } from '../threat-reactor.ts';
import type { UnifiedAlert } from '../unified-alerts.ts';
import { getNotificationTraceRegistry, resetDiagnosticsState } from '../diagnostics/diagnostics-state.ts';

interface Recorder {
  putCalls: UnifiedAlert[];
  toastCalls: { title: string; body: string; severity: string }[];
  nativeCalls: { title: string; body: string; priority?: string }[];
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
 sendNativeNotification: async (title: string, body: string, priority: string) => {
 rec.nativeCalls.push({ title, body, priority });
 rec.fanoutOrder.push('native');
 return 'delivered' as const;
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

test('a natively rate-limited alert is traced as not delivered and stays retryable (R4-BUG-002)', async () => {
  const rec = makeRecorder();
  const deps = makeDeps(rec);
  const outcomes = ['rate_limited', 'delivered'] as const;
  let call = 0;
  deps.sendNativeNotification = async (title: string, body: string, priority: string) => {
    rec.nativeCalls.push({ title, body, priority });
    return outcomes[call++] ?? 'delivered';
  };
  const mod = await loadFresh();
  const stop = mod.startNotificationRouter(deps);

  await mod.__deliverForTesting(makeAlert({ severity: 'high' }, 'rl-1'));
  rec.now += 1_000;
  await mod.__deliverForTesting(makeAlert({ severity: 'high' }, 'rl-2'));
  stop();

  const traces = getNotificationTraceRegistry().all();
  const first = traces.find((t) => t.nativeResult?.error === 'native-rate-limited');
  assert.ok(first, 'rate-limited delivery must be traced as not delivered');
  assert.equal(first?.nativeResult?.delivered, false);
  // The router's own 60 s high window must not start on a non-delivery, so the
  // second high alert one second later still reaches the native layer.
  assert.equal(rec.nativeCalls.length, 2);
  assert.ok(traces.some((t) => t.nativeResult?.delivered === true));
});

test('router maps severity to native priority lanes', async () => {
  const mod = await loadFresh();
  assert.equal(mod.routerNativePriority('critical'), 'critical');
  assert.equal(mod.routerNativePriority('high'), 'high');
  assert.equal(mod.routerNativePriority('medium'), 'normal');
  assert.equal(mod.routerNativePriority('low'), 'normal');
});

test('releasing the last workspace stops every in-flight fanout after its current operation', async () => {
  for (const held of ['read', 'ghost', 'put', 'native', 'retry-ghost', 'retry-native']) {
    const mod = await loadFresh();
    const rec = makeRecorder(), original = makeDeps(rec);
    let enter!: () => void, resume!: () => void, holding = false;
    const reached = new Promise<void>((ok) => { enter = ok; });
    const gate = new Promise<void>((ok) => { resume = ok; });
    const pause = async (stage: string) => { if (holding && held.endsWith(stage)) { enter(); await gate; } };
    const deps = {
      ...original,
      isGhostMode: async () => { rec.fanoutOrder.push('read-mode'); await pause('ghost'); return false; },
      alertDB: {
        getAll: async () => { await pause('read'); return []; },
        put: async (alert: UnifiedAlert) => { await original.alertDB.put(alert); await pause('put'); },
      },
      sendNativeNotification: async (title: string, body: string, priority: string) => {
        await original.sendNativeNotification(title, body, priority);
        await pause('native');
        return holding ? 'delivered' as const : 'failed' as const;
      },
    };
    const stop = mod.startNotificationRouter(deps);
    const alert = makeAlert({ severity: 'high' });
    if (held.startsWith('retry-')) await mod.__deliverForTesting(alert);
    holding = true;
    const work = mod.__deliverForTesting(alert); await reached;
    stop();
    const replacement = makeRecorder();
    const stopReplacement = mod.startNotificationRouter(makeDeps(replacement));
    const issued = [...rec.fanoutOrder];
    resume(); await work;
    assert.deepEqual(rec.fanoutOrder, issued, held);
    // A stale native acknowledgement cannot consume the new instance's rate window.
    await mod.__deliverForTesting(makeAlert({ severity: 'high' }, 'fresh'));
    assert.equal(replacement.nativeCalls.length, 1, held);
    if (held === 'retry-native') {
      replacement.now += 60_001; await mod.__deliverForTesting(alert);
      assert.equal(replacement.putCalls.length, 1, 'stale acknowledgement cannot clear an outstanding retry');
    }
    stopReplacement();
  }
});

test('an in-flight delivery continues while another workspace still owns the router', async () => {
  const mod = await loadFresh(), rec = makeRecorder();
  const deps = makeDeps(rec);
  let resume!: (value: UnifiedAlert[]) => void;
  deps.alertDB.getAll = () => new Promise(ok => { resume = ok; });
  const first = mod.startNotificationRouter(deps), second = mod.startNotificationRouter(deps);
  const work = mod.__deliverForTesting(makeAlert({ severity: 'high' }));
  first(); resume([]); await work;
  assert.deepEqual(rec.fanoutOrder, ['put', 'toast', 'native', 'marker']);
  second();
});

type RouterModule = typeof import('../notification-router.ts');
let fixtureModule: string | undefined;
async function compileRouterFixture(): Promise<string> {
  if (fixtureModule) return fixtureModule;
  const { readFileSync } = await import('node:fs');
  const { default: ts } = await import('typescript');
  const source = readFileSync(new URL('../notification-router.ts', import.meta.url), 'utf8');
  // Preserve the controlled import promise; wrapping it in a synthetic module
  // namespace makes the dependency appear missing even to a live owner.
  fixtureModule = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: false },
  }).outputText;
  return fixtureModule;
}

test('default transports cancel lazy imports and release old map-marker timers', async () => {
  const compiled = await compileRouterFixture();
  const effects = { get: 'read', put: 'store', native: 'send', map: 'mark' } as const;
  for (const [held, dispose] of [
    ...Object.keys(effects).flatMap(kind => [[kind, false], [kind, true]] as const),
    ['ttl', true] as const,
  ]) {
    const calls: string[] = [];
    let ttl: (() => void) | undefined;
    const timer = (fn: () => void) => { ttl = fn; calls.push('timer'); return 1; };
    const cancelTimer = () => { calls.push('cancel-timer'); };
    let resume!: () => void, enter!: () => void, dbLoaded = false;
    const reached = new Promise<void>(ok => { enter = ok; });
    const delay = new Promise<void>(ok => { resume = ok; });
    function imported(kind: string, module: unknown) {
      if (kind !== held) return module;
      enter(); return delay.then(() => module);
    }
    const exports: Record<string, any> = {};
    const load = (id: string) => {
      if (id === './alert-store') {
        const kind = dbLoaded ? 'put' : 'get'; dbLoaded = true;
        return imported(kind, { alertDB: {
          getAll: () => { calls.push('read'); return []; },
          put: () => { calls.push('store'); },
        } });
      }
      if (id === './mode-manager') return { isGhostMode: () => false };
      if (id === './native-notify') return imported('native', { notifyNative: () => { calls.push('send'); return 'delivered'; } });
      if (id === '../components/DeckGLMap') return imported('map', {
        addCyberReactorMarker() { calls.push('mark'); }, removeCyberReactorMarker() { calls.push('remove'); },
      });
      if (id === './threat-reactor') return { onAlert: () => () => {} };
      return {};
    };
    new Function('require', 'exports', 'setTimeout', 'clearTimeout', compiled)(load, exports, timer, cancelTimer);
    const stop = exports.startNotificationRouter();
    const work = exports.__deliverForTesting(makeAlert({ severity: 'critical' }));
    if (held === 'ttl') {
      await work; await new Promise(ok => setImmediate(ok));
      assert.ok(ttl, 'a live marker has a TTL');
      stop();
      assert.ok(calls.includes('cancel-timer'), 'last owner releases the timer');
      const replacement = exports.startNotificationRouter();
      ttl();
      assert.ok(!calls.includes('remove'), 'expired old timer cannot remove a replacement marker');
      replacement();
    } else {
      await reached; const started = [...calls];
      if (dispose) stop();
      const replacement = dispose ? exports.startNotificationRouter() : undefined;
      resume(); await work; await new Promise(ok => setImmediate(ok));
      if (dispose) assert.deepEqual(calls, started, held);
      else assert.ok(calls.includes(effects[held as keyof typeof effects]), `live ${held} dependency must perform the real fixture effect`);
      replacement?.(); stop();
    }
  }
});

test('a synchronous toast or marker can release the last owner without arming further work', async () => {
  for (const at of ['toast', 'marker']) {
    const mod = await loadFresh(), rec = makeRecorder(), original = makeDeps(rec);
    let stop!: () => void;
    const deps = {
      ...original,
      showToast: (...args: Parameters<typeof original.showToast>) => {
        original.showToast(...args); if (at === 'toast') stop();
      },
      sendNativeNotification: async (...args: Parameters<typeof original.sendNativeNotification>) => {
        await original.sendNativeNotification(...args); return 'failed' as const;
      },
      addMapMarker: (...args: Parameters<typeof original.addMapMarker>) => { original.addMapMarker(...args); stop(); },
    };
    stop = mod.startNotificationRouter(deps);
    const alert = makeAlert({ severity: 'high' });
    await mod.__deliverForTesting(alert);
    assert.deepEqual(rec.fanoutOrder, at === 'toast' ? ['put', 'toast'] : ['put', 'toast', 'native', 'marker']);
    const replacement = makeRecorder();
    const release = mod.startNotificationRouter(makeDeps(replacement));
    await mod.__deliverForTesting(alert);
    assert.deepEqual(replacement.fanoutOrder, ['put', 'toast', 'native', 'marker'], 'disposed marker cannot arm a stale retry');
    release();
  }
});

test('pending imports attach only the current subscriber and final release removes it', async () => {
  type Callback = (alert: ReactorAlert) => Promise<boolean>;
  const live = new Set<Callback>();
  const reactor = { onAlert(handler: Callback) { live.add(handler); return () => live.delete(handler); } };
  const imported = Promise.withResolvers<typeof reactor>();
  const mod = {} as RouterModule;
  new Function('require', 'exports', await compileRouterFixture())(
    (id: string) => id === './threat-reactor' ? imported.promise : {}, mod,
  );
  const rec = makeRecorder();
  let clockReads = 0;
  const started = Promise.withResolvers<void>();
  const native = Promise.withResolvers<'delivered'>();
  let retry = false;
  const deps = {
    ...makeDeps(rec),
    now: () => { clockReads++; return rec.now; },
    sendNativeNotification: async () => {
      if (!retry) return 'failed' as const;
      started.resolve();
      return native.promise;
    },
  };
  const stale = mod.startNotificationRouter(deps);
  stale();
  const current = mod.startNotificationRouter(deps);
  const second = mod.startNotificationRouter(deps);
  imported.resolve(reactor);
  await new Promise<void>(done => setImmediate(done));
  assert.equal(live.size, 1, 'a stale import cannot register its callback');
  const [handler] = live;
  current();
  assert.equal(live.size, 1, 'second workspace still owns this subscription');
  const alert = makeAlert({severity: 'critical'});
  assert.equal(await handler(alert), false, 'an undelivered alert requests a retry');
  retry = true;
  const pending = handler(alert);
  await started.promise;
  second();
  assert.equal(live.size, 0, 'last owner physically removes the subscriber');
  native.resolve('delivered');
  assert.equal(await pending, true, 'a retired retry cannot request another replay');
  const previousReads = clockReads;
  assert.equal(await handler(alert), true);
  assert.equal(clockReads, previousReads, 'a stale callback cannot inspect the next workspace');
});
