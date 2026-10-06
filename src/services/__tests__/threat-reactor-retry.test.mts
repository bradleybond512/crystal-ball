import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import type { DeviceFingerprint } from '../device-identity.ts';
import type { NativeNotifyOutcome } from '../native-notify.ts';
import type { NormalizedThreat } from '../threat-reactor.ts';
import type { UnifiedAlert } from '../unified-alerts.ts';
import { getNotificationTraceRegistry, resetDiagnosticsState } from '../diagnostics/diagnostics-state.ts';

// R4-BUG-002 next-cycle retry, end to end: the real reactor ingest, the real
// router subscription and an inbox that keeps what was stored. A threat the
// native layer did not deliver must reach the native layer again when it is
// ingested again; a delivered threat stays deduped; inbox, toast and map
// marker happen once.

type ScriptedOutcome = NativeNotifyOutcome | 'throw';

interface Harness {
  inbox: Map<string, UnifiedAlert>;
  puts: number;
  toasts: string[];
  markers: string[];
  native: { title: string; priority: string }[];
  outcomes: ScriptedOutcome[];
  ghost: boolean;
  now: number;
}

const START = 1_700_000_000_000;
const NEXT_CYCLE_MS = 2 * 60_000;
const FINGERPRINT: DeviceFingerprint = { asn: 7922, asnOrg: 'COMCAST', country: 'US', os: 'macos', fetchedAt: 0 };

function harness(outcomes: ScriptedOutcome[]): Harness {
  return { inbox: new Map(), puts: 0, toasts: [], markers: [], native: [], outcomes, ghost: false, now: START };
}

function routerDeps(h: Harness) {
  return {
    alertDB: {
      put: async (a: UnifiedAlert) => {
        h.puts += 1;
        h.inbox.set(a.id, a);
      },
      getAll: async (opts?: { since?: number }) =>
        [...h.inbox.values()].filter((a) => opts?.since == null || a.timestamp >= opts.since),
    },
    showToast: (title: string) => {
      h.toasts.push(title);
    },
    sendNativeNotification: async (title: string, _body: string, priority: string) => {
      h.native.push({ title, priority });
      const outcome = h.outcomes.shift() ?? 'delivered';
      if (outcome === 'throw') throw new Error('native bridge down');
      return outcome;
    },
    addMapMarker: (_lat: number, _lon: number, alertId: string) => {
      h.markers.push(alertId);
    },
    isGhostMode: () => h.ghost,
    now: () => h.now,
  };
}

function makeThreat(over: Partial<NormalizedThreat> = {}): NormalizedThreat {
  return {
    id: 'cve-1',
    source: 'feodo',
    indicator: '203.0.113.7',
    indicatorType: 'ip',
    severity: 'high',
    country: 'FR',
    title: 'Botnet C2 active',
    body: 'body',
    lat: 48.85,
    lon: 2.35,
    ...over,
  };
}

/** Lets every pending microtask of a fake-only delivery run. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

type Reactor = typeof import('../threat-reactor.ts');

/**
 * The router subscribes through an async import. Below-threshold probes (an
 * ASN match at low severity) are emitted by the reactor and only traced by
 * the router, so the first such trace proves the subscription is live
 * without touching the inbox, toast, native or map fakes.
 */
async function untilSubscribed(reactor: Reactor): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    await reactor.ingest([makeThreat({ indicator: `probe-${i}`, severity: 'low', asn: 7922 })]);
    await flush();
    if (getNotificationTraceRegistry().all().some((e) => e.decisionReason === 'below-min-severity')) {
      resetDiagnosticsState();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('router never subscribed to the reactor');
}

async function start(h: Harness) {
  (globalThis as unknown as { __wmReactorFingerprint?: () => Promise<DeviceFingerprint> })
    .__wmReactorFingerprint = async () => FINGERPRINT;
  const reactor = await import('../threat-reactor.ts');
  reactor.__resetForTesting();
  reactor.__setClockForTesting(() => h.now);
  const url = new URL('../notification-router.ts', import.meta.url).href + `?t=${Math.random()}`;
  const router = (await import(url)) as typeof import('../notification-router.ts');
  const stop = router.startNotificationRouter(routerDeps(h));
  await untilSubscribed(reactor);
  return { reactor, stop };
}

async function ingestCycle(reactor: Reactor, h: Harness, threat: NormalizedThreat): Promise<void> {
  h.now += NEXT_CYCLE_MS;
  await reactor.ingest([threat]);
  await flush();
}

function deliveredTraces(): number {
  return getNotificationTraceRegistry().all().filter((e) => e.nativeResult?.delivered === true).length;
}

beforeEach(() => {
  resetDiagnosticsState();
});

afterEach(() => {
  delete (globalThis as Partial<{ __wmReactorFingerprint: unknown }>).__wmReactorFingerprint;
});

for (const outcome of ['rate_limited', 'failed', 'unavailable', 'throw'] as const) {
  test(`a ${outcome} native send is retried when the same threat is ingested again; inbox, toast and map stay one-time`, async () => {
    const h = harness([outcome, 'delivered']);
    const { reactor, stop } = await start(h);
    try {
      const threat = makeThreat();
      await ingestCycle(reactor, h, threat);
      assert.equal(h.native.length, 1, 'the first ingest reaches the native layer');
      assert.equal(deliveredTraces(), 0, 'a non-delivery is not traced as delivered');

      await ingestCycle(reactor, h, threat);
      assert.equal(h.native.length, 2, 'the same threat is retried natively on the next ingest');
      assert.equal(h.native[1]?.priority, 'high');
      assert.equal(deliveredTraces(), 1, 'the retry is traced as delivered');

      await ingestCycle(reactor, h, threat);
      assert.equal(h.native.length, 2, 'once delivered, the same threat stays deduped');

      assert.equal(h.puts, 1, 'the inbox row is written once');
      assert.equal(h.inbox.size, 1);
      assert.equal(h.toasts.length, 1, 'the toast is shown once');
      assert.equal(h.markers.length, 1, 'the map marker is added once');
    } finally {
      stop();
    }
  });
}

test('a delivered threat stays deduped across later ingests', async () => {
  const h = harness(['delivered']);
  const { reactor, stop } = await start(h);
  try {
    const threat = makeThreat({ severity: 'critical' });
    await ingestCycle(reactor, h, threat);
    await ingestCycle(reactor, h, threat);
    await ingestCycle(reactor, h, threat);
    assert.equal(h.native.length, 1);
    assert.equal(h.native[0]?.priority, 'critical');
    assert.equal(h.puts, 1);
    assert.equal(h.toasts.length, 1);
    assert.equal(h.markers.length, 1);
  } finally {
    stop();
  }
});

test('a retry honors ghost mode and stays retryable until a send is delivered', async () => {
  const h = harness(['rate_limited', 'delivered']);
  const { reactor, stop } = await start(h);
  try {
    const threat = makeThreat();
    await ingestCycle(reactor, h, threat);
    assert.equal(h.native.length, 1);

    h.ghost = true;
    await ingestCycle(reactor, h, threat);
    assert.equal(h.native.length, 1, 'ghost mode suppresses the native retry');
    assert.equal(h.markers.length, 1, 'a retry never adds a map marker');

    h.ghost = false;
    await ingestCycle(reactor, h, threat);
    assert.equal(h.native.length, 2, 'the retry resumes after ghost mode ends');

    await ingestCycle(reactor, h, threat);
    assert.equal(h.native.length, 2, 'and is deduped once delivered');
    assert.equal(h.toasts.length, 1);
    assert.equal(h.puts, 1);
  } finally {
    stop();
  }
});

test('an alert first seen in Ghost Mode is not sent natively later (existing Ghost Mode policy)', async () => {
  const h = harness(['delivered']);
  h.ghost = true;
  const { reactor, stop } = await start(h);
  try {
    const threat = makeThreat();
    await ingestCycle(reactor, h, threat);
    h.ghost = false;
    await ingestCycle(reactor, h, threat);
    await ingestCycle(reactor, h, threat);
    assert.equal(h.native.length, 0, 'a policy skip settles the alert; it is not retried');
    assert.equal(h.puts, 1);
    assert.equal(h.toasts.length, 1);
    assert.equal(h.markers.length, 0);
  } finally {
    stop();
  }
});

test('router: the same alert id is sent natively again after a non-delivery, with a persistent inbox', async () => {
  const h = harness(['rate_limited', 'delivered']);
  const url = new URL('../notification-router.ts', import.meta.url).href + `?t=${Math.random()}`;
  const router = (await import(url)) as typeof import('../notification-router.ts');
  const stop = router.startNotificationRouter(routerDeps(h));
  try {
    const alert = {
      threat: makeThreat(),
      relevance: { score: 30, reason: 'high_severity' as const, explanation: 'x' },
      alertId: 'same-id',
      createdAt: h.now,
    };
    await router.__deliverForTesting(alert);
    h.now += NEXT_CYCLE_MS;
    await router.__deliverForTesting({ ...alert, createdAt: h.now });
    h.now += NEXT_CYCLE_MS;
    await router.__deliverForTesting({ ...alert, createdAt: h.now });

    assert.equal(h.native.length, 2, 'retried once after the non-delivery, then deduped');
    assert.equal(h.puts, 1);
    assert.equal(h.toasts.length, 1);
    assert.equal(h.markers.length, 1);
    const reasons = getNotificationTraceRegistry().all().map((e) => e.decisionReason);
    assert.equal(reasons.filter((r) => r === 'duplicate-within-window').length, 1);
  } finally {
    stop();
  }
});
