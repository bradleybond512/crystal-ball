import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLocalLogisticsFingerprint,
  LOCAL_LOGISTICS_CATEGORIES,
  type LocalLogisticsSnapshot,
} from '../../local-logistics.ts';
import type { SavedPlace } from '../../saved-places.ts';

const prewarmModulePath = ['..', 'lifeline-prewarm.ts'].join('/');
const moduleUnderTest = await import(prewarmModulePath).catch(() => ({}));
const NOW = Date.parse('2026-08-25T15:00:00.000Z');

type Trigger = 'manual' | 'startup' | 'storm';

interface PrewarmState {
  placeId: string;
  radiusKm: number;
  queryFingerprint: string;
  phase: 'queued' | 'fetching' | 'verifying' | 'ready' | 'partial' | 'failed' | 'cooldown';
  triggers: Trigger[];
  retryAt: number | null;
  error: string | null;
}

interface Coordinator {
  enqueue(input: { place: SavedPlace; radiusKm?: number; trigger: Trigger }): Promise<void> | void;
  retry(placeId: string, queryFingerprint: string): Promise<void> | void;
  getState(placeId: string): PrewarmState | null;
  subscribe(listener: (state: PrewarmState) => void): () => void;
  resolveRadius(place: SavedPlace, explicitRadiusKm?: number): number;
  destroy?(): void;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function place(id: string, radiusKm = 25): SavedPlace {
  return {
    id,
    name: `Place ${id}`,
    lat: 41.6 + id.length / 100,
    lon: -86.7,
    radiusKm,
    tags: [],
    priority: 0,
    notes: '',
    offlinePinned: true,
    primary: false,
    source: 'manual',
    sortIndex: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function fingerprint(item: SavedPlace, radiusKm: number): string {
  return buildLocalLogisticsFingerprint(item, radiusKm, [...LOCAL_LOGISTICS_CATEGORIES]);
}

function snapshot(item: SavedPlace, radiusKm: number, source: LocalLogisticsSnapshot['source'] = 'network'): LocalLogisticsSnapshot {
  return {
    schemaVersion: 2,
    queryFingerprint: fingerprint(item, radiusKm),
    placeId: item.id,
    placeName: item.name,
    effectiveRadiusKm: radiusKm,
    categories: [...LOCAL_LOGISTICS_CATEGORIES],
    sites: [],
    observations: [],
    nodes: [],
    areaConditions: [],
    providers: [],
    fetchedAt: new Date(NOW),
    isStale: source === 'offline-cache',
    isExpired: false,
    staleAgeMs: 0,
    source,
  };
}

function createCoordinator(options: Record<string, unknown>): Coordinator {
  const factory = (moduleUnderTest as {
    createLifelinePrewarmCoordinator?: (input: Record<string, unknown>) => Coordinator;
  }).createLifelinePrewarmCoordinator;
  assert.equal(typeof factory, 'function', 'lifeline prewarm coordinator factory should exist');
  return factory(options);
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForTerminal(coordinator: Coordinator, placeId: string): Promise<PrewarmState> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const state = coordinator.getState(placeId);
    if (state && ['ready', 'partial', 'failed', 'cooldown'].includes(state.phase)) return state;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(`prewarm for ${placeId} did not reach a terminal state`);
}

function readyVerifier() {
  return { status: 'ready', exact: true };
}

test('publishes queued, fetching, verifying, and ready for one exact job', async () => {
  const item = place('home');
  const phases: string[] = [];
  const coordinator = createCoordinator({
    now: () => NOW,
    fetchSnapshot: async () => snapshot(item, 25),
    verifySnapshot: readyVerifier,
  });
  const unsubscribe = coordinator.subscribe((state) => phases.push(state.phase));

  void coordinator.enqueue({ place: item, radiusKm: 25, trigger: 'manual' });
  await waitForTerminal(coordinator, item.id);

  assert.deepEqual(phases, ['queued', 'fetching', 'verifying', 'ready']);
  assert.equal(coordinator.getState(item.id)?.queryFingerprint, fingerprint(item, 25));
  unsubscribe();
});

test('keeps every explicit 5, 10, 25, and 50 km choice in the fetched fingerprint', async () => {
  const requests: Array<{ placeId: string; radiusKm: number }> = [];
  const coordinator = createCoordinator({
    now: () => NOW,
    fetchSnapshot: async (item: SavedPlace, options: { radiusKm: number }) => {
      requests.push({ placeId: item.id, radiusKm: options.radiusKm });
      return snapshot(item, options.radiusKm);
    },
    verifySnapshot: readyVerifier,
  });

  for (const radiusKm of [5, 10, 25, 50]) {
    const item = place(`radius-${radiusKm}`);
    void coordinator.enqueue({ place: item, radiusKm, trigger: 'manual' });
    await waitForTerminal(coordinator, item.id);
    const state = coordinator.getState(item.id);
    assert.equal(state?.radiusKm, radiusKm);
    assert.equal(state?.queryFingerprint, fingerprint(item, radiusKm));
  }

  assert.deepEqual(requests.map((request) => request.radiusKm), [5, 10, 25, 50]);
});

test('limits work to two concurrent fetches', async () => {
  const pending = new Map<string, Deferred<LocalLogisticsSnapshot>>();
  let active = 0;
  let peak = 0;
  const coordinator = createCoordinator({
    now: () => NOW,
    fetchSnapshot: (item: SavedPlace, options: { radiusKm: number }) => {
      active += 1;
      peak = Math.max(peak, active);
      const request = deferred<LocalLogisticsSnapshot>();
      pending.set(item.id, request);
      return request.promise.finally(() => { active -= 1; });
    },
    verifySnapshot: readyVerifier,
  });

  for (const id of ['one', 'two', 'three']) {
    void coordinator.enqueue({ place: place(id), radiusKm: 25, trigger: 'startup' });
  }
  await flush();
  assert.equal(peak, 2);
  assert.deepEqual([...pending.keys()].sort(), ['one', 'two']);

  pending.get('one')?.resolve(snapshot(place('one'), 25));
  await flush();
  assert.equal(pending.has('three'), true, 'third job should begin only after a worker frees');
  pending.get('two')?.resolve(snapshot(place('two'), 25));
  pending.get('three')?.resolve(snapshot(place('three'), 25));
});

test('coalesces an exact job and records every trigger without a duplicate fetch', async () => {
  const item = place('same');
  const request = deferred<LocalLogisticsSnapshot>();
  let calls = 0;
  const coordinator = createCoordinator({
    now: () => NOW,
    fetchSnapshot: () => { calls += 1; return request.promise; },
    verifySnapshot: readyVerifier,
  });

  void coordinator.enqueue({ place: item, radiusKm: 25, trigger: 'startup' });
  void coordinator.enqueue({ place: item, radiusKm: 25, trigger: 'storm' });
  void coordinator.enqueue({ place: item, radiusKm: 25, trigger: 'manual' });
  await flush();

  assert.equal(calls, 1);
  assert.deepEqual(coordinator.getState(item.id)?.triggers, ['startup', 'storm', 'manual']);
  request.resolve(snapshot(item, 25));
});

test('serializes different fingerprints for one place and suppresses stale completion', async () => {
  const item = place('moving');
  const requests: Deferred<LocalLogisticsSnapshot>[] = [];
  const seen: PrewarmState[] = [];
  const coordinator = createCoordinator({
    now: () => NOW,
    fetchSnapshot: () => {
      const request = deferred<LocalLogisticsSnapshot>();
      requests.push(request);
      return request.promise;
    },
    verifySnapshot: readyVerifier,
  });
  coordinator.subscribe((state) => seen.push({ ...state }));

  void coordinator.enqueue({ place: item, radiusKm: 5, trigger: 'startup' });
  void coordinator.enqueue({ place: item, radiusKm: 50, trigger: 'manual' });
  await flush();
  assert.equal(requests.length, 1, 'a place should never have two active fingerprints');
  assert.equal(coordinator.getState(item.id)?.queryFingerprint, fingerprint(item, 50));

  requests[0]?.resolve(snapshot(item, 5));
  await flush();
  assert.equal(requests.length, 2);
  assert.equal(
    seen.some((state) => state.phase === 'ready' && state.queryFingerprint === fingerprint(item, 5)),
    false,
    'superseded completion must not publish ready',
  );
  requests[1]?.resolve(snapshot(item, 50));
  await waitForTerminal(coordinator, item.id);
  assert.equal(coordinator.getState(item.id)?.queryFingerprint, fingerprint(item, 50));
});

test('enters cooldown only after verified success', async () => {
  const item = place('cooldown');
  let calls = 0;
  const coordinator = createCoordinator({
    now: () => NOW,
    fetchSnapshot: async () => { calls += 1; return snapshot(item, 25); },
    verifySnapshot: readyVerifier,
  });

  void coordinator.enqueue({ place: item, radiusKm: 25, trigger: 'manual' });
  await waitForTerminal(coordinator, item.id);
  void coordinator.enqueue({ place: item, radiusKm: 25, trigger: 'storm' });
  await waitForTerminal(coordinator, item.id);

  assert.equal(calls, 1);
  assert.equal(coordinator.getState(item.id)?.phase, 'cooldown');
});

test('backs off failures and exact Retry bypasses backoff without changing the job', async () => {
  const item = place('retry');
  let calls = 0;
  const requested: number[] = [];
  const coordinator = createCoordinator({
    now: () => NOW,
    fetchSnapshot: async (_place: SavedPlace, options: { radiusKm: number }) => {
      calls += 1;
      requested.push(options.radiusKm);
      if (calls === 1) throw new Error('network unavailable');
      return snapshot(item, options.radiusKm);
    },
    verifySnapshot: readyVerifier,
  });

  void coordinator.enqueue({ place: item, radiusKm: 10, trigger: 'manual' });
  await waitForTerminal(coordinator, item.id);
  const failed = coordinator.getState(item.id);
  assert.equal(failed?.phase, 'failed');
  assert.ok((failed?.retryAt ?? 0) > NOW);
  void coordinator.enqueue({ place: item, radiusKm: 10, trigger: 'storm' });
  await waitForTerminal(coordinator, item.id);
  assert.equal(calls, 1, 'normal enqueue must respect failure backoff');

  void coordinator.retry(item.id, fingerprint(item, 10));
  await waitForTerminal(coordinator, item.id);
  assert.deepEqual(requested, [10, 10]);
  assert.equal(coordinator.getState(item.id)?.phase, 'ready');
});

test('rejects retry requests that do not exactly match the failed job', async () => {
  const item = place('wrong-retry');
  let calls = 0;
  const coordinator = createCoordinator({
    now: () => NOW,
    fetchSnapshot: async () => { calls += 1; throw new Error('offline'); },
    verifySnapshot: readyVerifier,
  });
  void coordinator.enqueue({ place: item, radiusKm: 25, trigger: 'manual' });
  await waitForTerminal(coordinator, item.id);

  void coordinator.retry(item.id, fingerprint(item, 50));
  await flush();

  assert.equal(calls, 1);
  assert.equal(coordinator.getState(item.id)?.queryFingerprint, fingerprint(item, 25));
});

test('publishes partial only when exact readback reports partial readiness', async () => {
  const item = place('partial');
  const coordinator = createCoordinator({
    now: () => NOW,
    fetchSnapshot: async () => snapshot(item, 25),
    verifySnapshot: () => ({ status: 'partial', exact: true }),
  });

  void coordinator.enqueue({ place: item, radiusKm: 25, trigger: 'manual' });
  await waitForTerminal(coordinator, item.id);

  assert.equal(coordinator.getState(item.id)?.phase, 'partial');
});

test('offline fallback, fingerprint mismatch, and failed storage verification never become ready', async () => {
  for (const scenario of [
    {
      name: 'offline fallback',
      fetch: (item: SavedPlace) => snapshot(item, 25, 'offline-cache'),
      verify: readyVerifier,
    },
    {
      name: 'fingerprint mismatch',
      fetch: (item: SavedPlace) => snapshot(item, 25),
      verify: () => ({ status: 'ready', exact: false }),
    },
    {
      name: 'storage failure',
      fetch: (item: SavedPlace) => snapshot(item, 25),
      verify: () => null,
    },
  ]) {
    const item = place(scenario.name.replace(/ /g, '-'));
    const coordinator = createCoordinator({
      now: () => NOW,
      fetchSnapshot: scenario.fetch,
      verifySnapshot: scenario.verify,
    });
    void coordinator.enqueue({ place: item, radiusKm: 25, trigger: 'manual' });
    await waitForTerminal(coordinator, item.id);
    assert.notEqual(coordinator.getState(item.id)?.phase, 'ready', scenario.name);
    assert.notEqual(coordinator.getState(item.id)?.phase, 'cooldown', scenario.name);
  }
});

test('destroyed subscribers receive no later state transitions', async () => {
  const item = place('unsubscribe');
  const request = deferred<LocalLogisticsSnapshot>();
  const phases: string[] = [];
  const coordinator = createCoordinator({
    now: () => NOW,
    fetchSnapshot: () => request.promise,
    verifySnapshot: readyVerifier,
  });
  const unsubscribe = coordinator.subscribe((state) => phases.push(state.phase));
  void coordinator.enqueue({ place: item, radiusKm: 25, trigger: 'manual' });
  await flush();
  unsubscribe();
  const countAtUnsubscribe = phases.length;
  request.resolve(snapshot(item, 25));
  await flush();

  assert.equal(phases.length, countAtUnsubscribe);
});
