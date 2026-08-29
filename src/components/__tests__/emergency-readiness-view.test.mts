import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_LIFELINE_EXPIRY_TIMER_DELAY_MS } from '../lifeline-evidence-expiry.ts';
import { buildSnapshot } from '../../services/survival/world-snapshot.ts';
import type { WorldSnapshot } from '../../services/survival/survival-types.ts';

const NOW = Date.parse('2026-08-25T16:00:00.000Z');

interface ReadinessApi {
  projectEmergencyReadiness?: (...args: unknown[]) => {
    cards: Array<{ id: string; status: string; capturedAtMs: number | null; expiresAtMs: number | null }>;
    pack: null | { artifacts: Array<{ kind: string; capturedAtMs: number | null }> };
    deadlinesMs: number[];
  };
  renderEmergencyReadiness?: (view: unknown) => string;
  EmergencyReadinessDeadlineScheduler?: new (options: {
    now: () => number;
    setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
    clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
    onDeadline: () => void;
  }) => { track: (deadlines: readonly number[]) => void; destroy: () => void };
}

const api = await import('../emergency-readiness-view.ts').catch(() => ({} as ReadinessApi)) as ReadinessApi;

function requireFunction<K extends keyof ReadinessApi>(name: K): NonNullable<ReadinessApi[K]> {
  const value = api[name];
  assert.equal(typeof value, 'function', `${String(name)} should be exported`);
  return value as NonNullable<ReadinessApi[K]>;
}

function snapshot(capturedAtMs = NOW): WorldSnapshot {
  return buildSnapshot({
    weatherAlerts: [],
    savedPlaces: [{
      id: 'home',
      label: 'Home <script>window.pwned=true</script>',
      lat: 41.6111,
      lon: -86.7225,
      radiusKm: 25,
    }],
    weatherFetchedAtMs: capturedAtMs - 60_000,
  }, { now: capturedAtMs });
}

test('projects exactly four independent capability cards with their own timestamps', () => {
  const project = requireFunction('projectEmergencyReadiness');
  const view = project(snapshot(), {
    placeLabel: 'Home',
    receipt: {
      placeId: 'home',
      capturedAt: new Date(NOW - 5 * 60_000),
      expiresAt: new Date(NOW + 60 * 60_000),
      isExpired: false,
    },
  }, { now: NOW });

  assert.deepEqual(view.cards.map((card) => card.id), [
    'grid-down', 'offline-playbook', 'comms-fallback', 'lifelines',
  ]);
  assert.equal(view.cards.length, 4);
  assert.equal(view.cards[0]?.capturedAtMs, NOW);
  assert.equal(view.cards[1]?.capturedAtMs, NOW);
  assert.equal(view.cards[1]?.expiresAtMs, null);
  assert.equal(view.cards[2]?.capturedAtMs, NOW);
  assert.equal(view.cards[2]?.expiresAtMs, null);
  assert.equal(view.cards[3]?.capturedAtMs, NOW - 5 * 60_000);
  assert.equal(view.cards[3]?.expiresAtMs, NOW + 60 * 60_000);
});

test('degrades cards independently and always keeps all four visible without aggregate readiness', () => {
  const project = requireFunction('projectEmergencyReadiness');
  const render = requireFunction('renderEmergencyReadiness');
  const view = project(snapshot(NOW - 30 * 60 * 60_000), {
    placeLabel: 'Home <script>window.pwned=true</script>',
    receipt: null,
  }, { now: NOW });
  const html = render(view);

  assert.equal(view.cards.length, 4);
  assert.equal(view.cards[0]?.status, 'degraded');
  assert.equal(view.cards[3]?.status, 'unavailable');
  assert.equal((html.match(/data-readiness-card=/g) ?? []).length, 4);
  assert.match(html, /<section[^>]+aria-labelledby=/);
  assert.equal((html.match(/<h3/g) ?? []).length, 4);
  assert.equal((html.match(/<dl/g) ?? []).length, 4);
  assert.ok((html.match(/<time/g) ?? []).length >= 3);
  assert.equal((html.match(/No independent expiry/g) ?? []).length, 2);
  assert.match(html, /Home &lt;script&gt;window\.pwned=true&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /Emergency Pack ready|combined score|overall readiness|aggregate/i);
  assert.match(html, /aria-live="polite"/);
});

test('empty restored state still renders four truthful unavailable cards', () => {
  const project = requireFunction('projectEmergencyReadiness');
  const render = requireFunction('renderEmergencyReadiness');
  const view = project(null, null, { now: NOW });

  assert.equal(view.cards.length, 4);
  assert.ok(view.cards.every((card) => card.status === 'unavailable'));
  assert.equal((render(view).match(/data-readiness-card=/g) ?? []).length, 4);
});

test('Emergency Pack artifacts expose each receipt evidence age instead of commit time', () => {
  const project = requireFunction('projectEmergencyReadiness');
  const evidenceTimes = [NOW - 5 * 60_000, NOW - 45 * 60_000];
  const view = project(snapshot(), null, {
    now: NOW,
    emergencyPack: {
      places: [{ id: 'home', name: 'Home' }],
      selectedPlaceId: 'home',
      readiness: {
        status: 'partial',
        packId: 'pack-1',
        requiredKinds: ['lifelines', 'alerts'],
        optionalKinds: [],
        receipts: ['lifelines', 'alerts'].map((kind, index) => ({
          kind,
          capturedAt: new Date(evidenceTimes[index]!).toISOString(),
          expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
          semanticState: 'verified',
          summary: `${kind} captured`,
        })),
        missingKinds: [],
        expiredKinds: [],
      },
      contactConsent: true,
      captureState: { status: 'idle', completed: 0, total: 2, message: '' },
    },
  });

  assert.deepEqual(
    view.pack?.artifacts.map(({ kind, capturedAtMs }) => ({ kind, capturedAtMs })),
    [
      { kind: 'lifelines', capturedAtMs: evidenceTimes[0] },
      { kind: 'alerts', capturedAtMs: evidenceTimes[1] },
    ],
  );
});

test('deadline scheduler chooses the nearest expiry, bounds long waits, and ignores stale generations', () => {
  const Scheduler = requireFunction('EmergencyReadinessDeadlineScheduler');
  let now = NOW;
  let fired = 0;
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  const delays: number[] = [];
  const cleared: number[] = [];
  const scheduler = new Scheduler({
    now: () => now,
    setTimer: (callback, delayMs) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      delays.push(delayMs);
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (handle) => {
      const id = handle as unknown as number;
      cleared.push(id);
      callbacks.delete(id);
    },
    onDeadline: () => { fired += 1; },
  });

  scheduler.track([NOW + 2 * MAX_LIFELINE_EXPIRY_TIMER_DELAY_MS, NOW + 1_000]);
  assert.equal(delays.at(-1), 1_000, 'nearest future deadline should win');
  const staleCallback = callbacks.get(1);
  assert.ok(staleCallback);

  scheduler.track([NOW + 2 * MAX_LIFELINE_EXPIRY_TIMER_DELAY_MS]);
  assert.ok(cleared.includes(1));
  assert.equal(delays.at(-1), MAX_LIFELINE_EXPIRY_TIMER_DELAY_MS, 'long waits should be chunked');
  staleCallback();
  assert.equal(fired, 0, 'replaced generation must not fire');

  now += 2 * MAX_LIFELINE_EXPIRY_TIMER_DELAY_MS;
  callbacks.get(2)?.();
  assert.equal(fired, 1);
  scheduler.destroy();
  assert.ok(cleared.length >= 1, 'destroy should clear any owned timeout');
});
