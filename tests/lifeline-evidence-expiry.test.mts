import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyExpiredLifelineEvidenceTransition,
  applyLifelineExpiryTransition,
  LifelineEvidenceExpiryScheduler,
  MAX_LIFELINE_EXPIRY_TIMER_DELAY_MS,
} from '../src/components/lifeline-evidence-expiry.ts';
import { buildCountyPowerDisclosure } from '../src/components/comms-lifeline-context.ts';
import type {
  LocalLogisticsSnapshot,
  LogisticsNode,
  ResourceObservation,
} from '../src/services/local-logistics-types.ts';

const NOW = Date.parse('2026-08-14T14:00:00.000Z');

class FakeClock {
  public nowMs = NOW;
  private nextId = 1;
  private readonly tasks = new Map<number, { dueAt: number; callback: () => void }>();

  public readonly now = (): number => this.nowMs;

  public readonly setTimer = (
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout> => {
    const id = this.nextId++;
    this.tasks.set(id, { dueAt: this.nowMs + delayMs, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  public readonly clearTimer = (handle: ReturnType<typeof setTimeout>): void => {
    this.tasks.delete(handle as unknown as number);
  };

  public pendingDelays(): number[] {
    return [...this.tasks.values()]
      .map((task) => task.dueAt - this.nowMs)
      .sort((left, right) => left - right);
  }

  public advanceBy(delayMs: number): void {
    const target = this.nowMs + delayMs;
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!next) break;
      const [id, task] = next;
      this.tasks.delete(id);
      this.nowMs = task.dueAt;
      task.callback();
    }
    this.nowMs = target;
  }
}

function makeSnapshot(options: {
  placeId?: string;
  fingerprint?: string;
  nodeExpiry?: number;
  observationExpiry?: number;
  outageExpiry?: number;
  includeProvider?: boolean;
} = {}): LocalLogisticsSnapshot {
  const placeId = options.placeId ?? 'home';
  const queryFingerprint = options.fingerprint ?? 'exact-home';
  const nodeExpiry = options.nodeExpiry;
  const observationExpiry = options.observationExpiry;
  const outageExpiry = options.outageExpiry;
  return {
    schemaVersion: 2,
    queryFingerprint,
    placeId,
    placeName: placeId === 'home' ? 'Home' : 'Work',
    effectiveRadiusKm: 25,
    countyFips: '18091',
    categories: [],
    sites: [],
    observations: observationExpiry === undefined ? [] : [{
      expiresAt: new Date(observationExpiry),
    } as ResourceObservation],
    nodes: nodeExpiry === undefined ? [] : [{
      expiresAt: new Date(nodeExpiry),
    } as LogisticsNode],
    areaConditions: outageExpiry === undefined ? [] : [{
      id: `odin:${placeId}`,
      type: 'power_outage',
      coverage: 'reported',
      countyFips: '18091',
      county: 'LaPorte',
      state: 'Indiana',
      customersOut: 25,
      observedAt: new Date(NOW),
      retrievedAt: new Date(NOW),
      expiresAt: new Date(outageExpiry),
      source: 'ornl-odin',
    }],
    providers: options.includeProvider === false ? [] : [{
      id: 'ornl-odin',
      state: 'ok',
      acceptedRows: outageExpiry === undefined ? 0 : 1,
      droppedRows: 0,
      observedAt: new Date(NOW),
      retrievedAt: new Date(NOW),
    }],
    fetchedAt: new Date(NOW),
    isStale: false,
    isExpired: false,
    staleAgeMs: 0,
    source: 'network',
  };
}

test('nearest expiry transitions panel, exact map identity, and ODIN comms without an external event', () => {
  const clock = new FakeClock();
  const accepted = makeSnapshot({
    outageExpiry: NOW + 1_000,
    observationExpiry: NOW + 2_000,
    nodeExpiry: NOW + 3_000,
  });
  const renders: number[] = [];
  const cleared: Array<{ placeId: string; queryFingerprint: string }> = [];
  const commsKnowledge: string[] = [];
  const transitionKinds: Array<string | undefined> = [];
  const scheduler = new LifelineEvidenceExpiryScheduler({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onExpiry: (snapshot, _expiresAt, kind?: string) => {
      transitionKinds.push(kind);
      applyExpiredLifelineEvidenceTransition(snapshot, {
        isCurrent: (identity) => identity.placeId === accepted.placeId
          && identity.queryFingerprint === accepted.queryFingerprint,
        renderAtExpiry: () => renders.push(clock.now()),
        clearExactOverlay: (identity) => cleared.push(identity),
        publishSnapshot: (current) => {
          commsKnowledge.push(buildCountyPowerDisclosure(current, clock.now()).knowledge);
        },
      });
    },
  });

  scheduler.track(accepted);
  assert.deepEqual(clock.pendingDelays(), [1_000]);
  clock.advanceBy(999);
  assert.deepEqual(renders, []);

  clock.advanceBy(1);
  assert.deepEqual(renders, [NOW + 1_000]);
  assert.deepEqual(transitionKinds, ['evidence']);
  assert.deepEqual(cleared, [{ placeId: 'home', queryFingerprint: 'exact-home' }]);
  assert.deepEqual(commsKnowledge, ['unknown']);
  assert.deepEqual(clock.pendingDelays(), [1_000], 'the next accepted expiry remains scheduled');
});

test('facility-provider coverage expiry repaints current-completeness claims without another event', () => {
  const clock = new FakeClock();
  const transitions: Array<{ at: number; kind: string | undefined }> = [];
  const scheduler = new LifelineEvidenceExpiryScheduler({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onExpiry: (_snapshot, _expiresAt, kind?: string) => transitions.push({ at: clock.now(), kind }),
  });
  const snapshot = makeSnapshot({ includeProvider: false });
  snapshot.providers = [{
    id: 'fema-open-shelters',
    state: 'empty',
    acceptedRows: 0,
    droppedRows: 0,
    observedAt: new Date(NOW),
    retrievedAt: new Date(NOW),
  }];
  scheduler.track(snapshot);

  assert.deepEqual(clock.pendingDelays(), [30 * 60_000]);
  clock.advanceBy(30 * 60_000 - 1);
  assert.deepEqual(transitions, []);
  clock.advanceBy(1);
  assert.deepEqual(transitions, [{ at: NOW + 30 * 60_000, kind: 'provider-coverage' }]);
});

test('provider-only coverage transition repaints without clearing or publishing evidence', () => {
  const effects: string[] = [];
  const transitioned = applyLifelineExpiryTransition(makeSnapshot(), 'provider-coverage', {
    isCurrent: () => true,
    renderAtExpiry: () => effects.push('render'),
    clearExactOverlay: () => effects.push('clear'),
    publishSnapshot: () => effects.push('publish'),
  });

  assert.equal(transitioned, true);
  assert.deepEqual(effects, ['render']);
});

test('evidence expiry wins when it shares a provider coverage deadline', () => {
  const clock = new FakeClock();
  const kinds: Array<string | undefined> = [];
  const scheduler = new LifelineEvidenceExpiryScheduler({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onExpiry: (_snapshot, _expiresAt, kind?: string) => kinds.push(kind),
  });
  scheduler.track(makeSnapshot({ nodeExpiry: NOW + 30 * 60_000 }));

  clock.advanceBy(30 * 60_000);
  assert.deepEqual(kinds, ['evidence']);
});

test('replacing the exact snapshot cancels the prior place transition', () => {
  const clock = new FakeClock();
  const transitioned: string[] = [];
  const scheduler = new LifelineEvidenceExpiryScheduler({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onExpiry: (snapshot) => transitioned.push(`${snapshot.placeId}|${snapshot.queryFingerprint}`),
  });
  scheduler.track(makeSnapshot({ placeId: 'home', fingerprint: 'home-v1', outageExpiry: NOW + 1_000 }));
  scheduler.track(makeSnapshot({ placeId: 'work', fingerprint: 'work-v1', outageExpiry: NOW + 2_000 }));

  clock.advanceBy(1_000);
  assert.deepEqual(transitioned, []);
  clock.advanceBy(1_000);
  assert.deepEqual(transitioned, ['work|work-v1']);
});

test('a stale exact-query identity cannot render, clear, or publish', () => {
  const stale = makeSnapshot({ placeId: 'home', fingerprint: 'home-v1', outageExpiry: NOW + 1_000 });
  const effects: string[] = [];
  const transitioned = applyExpiredLifelineEvidenceTransition(stale, {
    isCurrent: () => false,
    renderAtExpiry: () => effects.push('render'),
    clearExactOverlay: () => effects.push('clear'),
    publishSnapshot: () => effects.push('publish'),
  });

  assert.equal(transitioned, false);
  assert.deepEqual(effects, []);
});

test('already-expired evidence is ignored and far timers use a bounded delay', () => {
  const clock = new FakeClock();
  const transitions: number[] = [];
  const futureExpiry = NOW + MAX_LIFELINE_EXPIRY_TIMER_DELAY_MS + 250;
  const scheduler = new LifelineEvidenceExpiryScheduler({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onExpiry: () => transitions.push(clock.now()),
  });
  scheduler.track(makeSnapshot({ outageExpiry: NOW, nodeExpiry: futureExpiry, includeProvider: false }));

  assert.deepEqual(clock.pendingDelays(), [MAX_LIFELINE_EXPIRY_TIMER_DELAY_MS]);
  clock.advanceBy(MAX_LIFELINE_EXPIRY_TIMER_DELAY_MS);
  assert.deepEqual(transitions, []);
  assert.deepEqual(clock.pendingDelays(), [250]);
  clock.advanceBy(250);
  assert.deepEqual(transitions, [futureExpiry]);
  assert.deepEqual(clock.pendingDelays(), []);
});

test('destroy clears the outstanding transition and future tracking is inert', () => {
  const clock = new FakeClock();
  const transitions: number[] = [];
  const scheduler = new LifelineEvidenceExpiryScheduler({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onExpiry: () => transitions.push(clock.now()),
  });
  scheduler.track(makeSnapshot({ outageExpiry: NOW + 1_000 }));
  scheduler.destroy();
  assert.deepEqual(clock.pendingDelays(), []);

  clock.advanceBy(2_000);
  scheduler.track(makeSnapshot({ outageExpiry: clock.now() + 1_000 }));
  clock.advanceBy(1_000);
  assert.deepEqual(transitions, []);
  assert.deepEqual(clock.pendingDelays(), []);
});
