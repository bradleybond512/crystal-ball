import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSituationV2AlertBridge,
  shouldReemit,
  situationToAlert,
  toEmitRecord,
  traceDomainFor,
} from '../situation-alert-bridge-v2';
import type { Situation, SituationIngestResult } from '../../intelligence/situation-store-v2';
import type { UnifiedAlert } from '../../unified-alerts';
import type { ObservationEvent } from '../../../types/intelligence';

const T0 = Date.UTC(2026, 6, 1, 12, 0, 0);
const HOUR = 3_600_000;

function obs(id: string): ObservationEvent {
  return {
    id, sourceId: 'src', domain: 'weather', timestamp: T0, severity: 'HIGH',
    title: id, raw: null, entityIds: [], tags: [],
  };
}

function situation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 'sit-v2-abc-1',
    name: 'Red-flag conditions + wildfire ignition',
    domain: 'weather',
    relatedDomains: ['infra'],
    severity: 'high',
    status: 'active',
    confidence: 0.72,
    observations: [obs('a'), obs('b')],
    edges: [{ confidence: 0.7 }] as never,
    entityIds: ['county:X'],
    tags: [],
    location: { lat: 41.6, lon: -86.7 },
    createdAt: new Date(T0),
    updatedAt: new Date(T0 + HOUR),
    ...overrides,
  } as Situation;
}

// ── gates ────────────────────────────────────────────────────────────────

test('a correlated active situation maps to an alert with stable id + source correlation', () => {
  const a = situationToAlert(situation(), T0 + 2 * HOUR)!;
  assert.equal(a.id, 'sit-v2-abc-1');
  assert.equal(a.source, 'correlation');
  assert.equal(a.severity, 'high');
  assert.equal(a.timestamp, T0 + 2 * HOUR, 'stamped with emit time, not updatedAt');
  assert.equal(a.relevanceScore, 72);
  assert.ok(a.location);
  assert.match(a.body, /2 correlated signals across weather, infra — confidence 72%/);
  assert.equal(a.acknowledged, false);
  assert.equal(a.pinned, false);
});

test('gate: watching (singleton) situations never alert', () => {
  assert.equal(situationToAlert(situation({ status: 'watching' }), T0), null);
  assert.equal(situationToAlert(situation({ status: 'resolved' }), T0), null);
});

test('gate: fewer than 2 observations or zero edges never alert', () => {
  assert.equal(situationToAlert(situation({ observations: [obs('a')] }), T0), null);
  assert.equal(situationToAlert(situation({ edges: [] as never }), T0), null);
});

test('gate: severity floor medium, confidence floor 0.5', () => {
  assert.equal(situationToAlert(situation({ severity: 'low' }), T0), null);
  assert.equal(situationToAlert(situation({ confidence: 0.49 }), T0), null);
  assert.equal(situationToAlert(situation({ confidence: Number.NaN }), T0), null);
  assert.ok(situationToAlert(situation({ severity: 'medium', confidence: 0.5 }), T0));
});

test('unlocated situations alert without a location (global domains)', () => {
  const a = situationToAlert(situation({ location: undefined }), T0)!;
  assert.equal(a.location, undefined);
});

// ── re-emit discipline ───────────────────────────────────────────────────

test('shouldReemit: first sight yes; unchanged no; each meaningful change yes', () => {
  const s = situation();
  const rec = toEmitRecord(s);
  assert.equal(shouldReemit(undefined, s), true);
  assert.equal(shouldReemit(rec, s), false);
  assert.equal(shouldReemit(rec, situation({ severity: 'critical' })), true);
  assert.equal(shouldReemit(rec, situation({ status: 'resolved' })), true);
  assert.equal(shouldReemit(rec, situation({ confidence: 0.83 })), true);
  assert.equal(shouldReemit(rec, situation({ confidence: 0.75 })), false);
  assert.equal(
    shouldReemit(rec, situation({ observations: [obs('a'), obs('b'), obs('c')] })),
    true,
  );
});

// ── wiring ───────────────────────────────────────────────────────────────

interface FakeStore {
  listeners: ((s: Situation[]) => void)[];
  items: Situation[];
  subscribeMutations(l: (result: SituationIngestResult) => void): () => void;
  list(): Situation[];
}

function fakeStore(items: Situation[]): FakeStore {
  return {
    listeners: [],
    items,
    subscribeMutations(l) {
      let previous = new Map(this.items.map((item) => [item.id, item]));
      this.listeners.push((items) => {
        const current = new Map(items.map((item) => [item.id, item]));
        const mutations: SituationIngestResult['mutations'] = items.map((item) => ({
          kind: previous.has(item.id) ? 'updated' : 'created',
          situationId: item.id,
          situation: item,
          observationIds: item.observations.map((observation) => observation.id),
        }));
        for (const [id, item] of previous) {
          if (!current.has(id)) mutations.push({
            kind: 'removed', situationId: id, situation: item, observationIds: [],
          });
        }
        previous = current;
        l({ status: mutations.length > 0 ? 'changed' : 'unchanged', mutations });
      });
      return () => {};
    },
    list() { return this.items; },
  };
}

test('bridge: initial sync emits once, unchanged notify does not re-emit', () => {
  const store = fakeStore([situation()]);
  const ingested: UnifiedAlert[][] = [];
  const cleanup = createSituationV2AlertBridge(store, {
    ingest: (b) => ingested.push(b),
    now: () => T0,
  });
  assert.equal(ingested.length, 1);
  store.listeners[0]!(store.items);
  assert.equal(ingested.length, 1, 'no re-emit without meaningful change');
  cleanup();
});

test('bridge: meaningful change re-emits with newer timestamp (update-in-place contract)', () => {
  const store = fakeStore([situation()]);
  const ingested: UnifiedAlert[][] = [];
  let clock = T0;
  const cleanup = createSituationV2AlertBridge(store, {
    ingest: (b) => ingested.push(b),
    now: () => clock,
  });
  clock = T0 + 2 * HOUR;
  const escalated = situation({ severity: 'critical' });
  store.items = [escalated];
  store.listeners[0]!(store.items);
  assert.equal(ingested.length, 2);
  assert.equal(ingested[1]![0]!.id, 'sit-v2-abc-1', 'same id → store updates in place');
  assert.equal(ingested[1]![0]!.timestamp, T0 + 2 * HOUR, 'monotonic emit-time stamp');
  cleanup();
});

test('bridge: resolved situations shed their emit record (re-fire on recurrence is allowed)', () => {
  const store = fakeStore([situation()]);
  const ingested: UnifiedAlert[][] = [];
  const cleanup = createSituationV2AlertBridge(store, { ingest: (b) => ingested.push(b), now: () => T0 });
  store.items = [];
  store.listeners[0]!(store.items);
  store.items = [situation()];
  store.listeners[0]!(store.items);
  assert.equal(ingested.length, 2, 'recurrence after eviction alerts again');
  cleanup();
});

test('bridge: trace registry gets a non-safety-critical candidate + in_app dispatch per emit', () => {
  const registered: unknown[] = [];
  const dispatched: [string, string][] = [];
  const store = fakeStore([situation()]);
  const cleanup = createSituationV2AlertBridge(store, {
    ingest: () => {},
    now: () => T0,
    registry: {
      register: (c) => { registered.push(c); },
      dispatch: (id, rung) => { dispatched.push([id, rung]); },
    } as never,
  });
  assert.equal(registered.length, 1);
  const cand = registered[0] as { safetyCritical: boolean; domain: string; situationId: string };
  assert.equal(cand.safetyCritical, false, 'correlation never overrides quiet hours');
  assert.equal(cand.domain, 'weather');
  assert.equal(cand.situationId, 'sit-v2-abc-1');
  assert.deepEqual(dispatched[0], [`sitv2-sit-v2-abc-1-${T0 + HOUR}`, 'in_app']);
  cleanup();
});

test('bridge: a throwing registry never blocks the alert emit', () => {
  const ingested: UnifiedAlert[][] = [];
  const store = fakeStore([situation()]);
  const cleanup = createSituationV2AlertBridge(store, {
    ingest: (b) => ingested.push(b),
    now: () => T0,
    registry: {
      register: () => { throw new Error('boom'); },
      dispatch: () => { throw new Error('boom'); },
    } as never,
  });
  assert.equal(ingested.length, 1);
  cleanup();
});

test('bridge: gated situations produce no ingest call at all', () => {
  const ingested: UnifiedAlert[][] = [];
  const store = fakeStore([situation({ status: 'watching' }), situation({ id: 'sit-v2-low', severity: 'low' })]);
  const cleanup = createSituationV2AlertBridge(store, { ingest: (b) => ingested.push(b), now: () => T0 });
  assert.equal(ingested.length, 0);
  cleanup();
});

test('traceDomainFor maps live domains and falls back to other', () => {
  assert.equal(traceDomainFor('weather'), 'weather');
  assert.equal(traceDomainFor('infra'), 'energy');
  assert.equal(traceDomainFor('macro'), 'market');
  assert.equal(traceDomainFor('maritime'), 'other');
});

test('REGRESSION: resolved-in-store then reactivated situation alerts again', () => {
  const ingested: UnifiedAlert[][] = [];
  const store = fakeStore([situation()]);
  const cleanup = createSituationV2AlertBridge(store, { ingest: (b) => ingested.push(b), now: () => T0 });
  assert.equal(ingested.length, 1);
  // Same id flips to resolved but REMAINS in the store.
  store.items = [situation({ status: 'resolved' })];
  store.listeners[0]!(store.items);
  // Reactivation with identical severity/confidence/obs must re-alert.
  store.items = [situation()];
  store.listeners[0]!(store.items);
  assert.equal(ingested.length, 2, 'reactivation after in-store resolution alerts again');
  cleanup();
});

test('REGRESSION: a backwards wall clock cannot make an escalation stamp older than its predecessor', () => {
  const ingested: UnifiedAlert[][] = [];
  const store = fakeStore([situation()]);
  let clock = T0 + 2 * HOUR;
  const cleanup = createSituationV2AlertBridge(store, {
    ingest: (b) => ingested.push(b),
    now: () => clock,
  });
  const first = ingested[0]![0]!.timestamp;
  clock = T0; // clock rewinds two hours
  store.items = [situation({ severity: 'critical' })];
  store.listeners[0]!(store.items);
  assert.equal(ingested.length, 2);
  assert.ok(
    ingested[1]![0]!.timestamp > first,
    `escalation stamp ${ingested[1]![0]!.timestamp} must beat prior ${first}`,
  );
  cleanup();
});

test('REGRESSION: a persisted store alert with a future timestamp is cleared by the emit stamp', () => {
  const ingested: UnifiedAlert[][] = [];
  const store = fakeStore([situation()]);
  const persistedFutureTs = T0 + 5 * HOUR;
  const cleanup = createSituationV2AlertBridge(store, {
    ingest: (b) => ingested.push(b),
    now: () => T0,
    existingTimestampFor: () => persistedFutureTs,
  });
  assert.equal(ingested.length, 1);
  assert.ok(
    ingested[0]![0]!.timestamp > persistedFutureTs,
    'stamp must clear the persisted alert so the store accepts the update',
  );
  cleanup();
});
