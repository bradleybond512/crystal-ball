/**
 * Tests for SituationStoreV2 — Phase 3 named-Situation aggregator.
 *
 * Service tests run against:
 *   - a localStorage stub (codebase convention),
 *   - an injectable CorrelateEngine (deterministic rules, no built-ins),
 *   - an injectable clock so "now" stays stable across tests.
 *
 * Goal: prove the merging / severity / status / persistence behavior
 * the panels and notification ladder depend on.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// localStorage stub before any imports that may hydrate from it.
const __storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => __storage.get(k) ?? null,
  setItem: (k: string, v: string) => { __storage.set(k, v); },
  removeItem: (k: string) => { __storage.delete(k); },
  clear: () => { __storage.clear(); },
  get length() { return __storage.size; },
  key: (i: number) => [...__storage.keys()][i] ?? null,
} as Storage;

import {
  CorrelateEngine,
  type CorrelationRule,
} from '../../src/services/intelligence/correlate-engine.ts';
import type { ObservationEvent, ObservationSeverity } from '../../src/services/intelligence/observation-adapters.ts';
import {
  SituationStoreV2,
  __internals,
  __resetSituationStoreV2Singleton,
  getSituationStoreV2,
  type Situation,
} from '../../src/services/intelligence/situation-store-v2.ts';

// ── Helpers ───────────────────────────────────────────────────────────

const NOW = 1_745_000_000_000;

function makeEvent(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: `ev-${Math.random().toString(36).slice(2, 8)}`,
    sourceId: 'test',
    domain: 'weather',
    timestamp: NOW,
    severity: 'MEDIUM',
    title: 'Test event',
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

/** Always-match co-located rule so we can simulate any pair as correlated. */
const ALWAYS_RULE: CorrelationRule = {
  id: 'always-colocated',
  name: 'Always co-located',
  description: 'Test rule that matches any two observations within 1h.',
  domains: [],
  timeWindowMs: 60 * 60 * 1000,
  edgeType: 'co-located',
  matchFn: () => true,
};

const CAUSAL_RULE: CorrelationRule = {
  id: 'always-causal',
  name: 'Always causal',
  description: 'Test rule that promotes any pair within 1h to a causal candidate.',
  domains: [],
  timeWindowMs: 60 * 60 * 1000,
  edgeType: 'causal-candidate',
  matchFn: () => true,
  baseConfidence: 0.9,
};

function freshStore(rule: CorrelationRule = ALWAYS_RULE, now = NOW): SituationStoreV2 {
  __storage.clear();
  const engine = new CorrelateEngine();
  engine.registerRule(rule);
  return new SituationStoreV2({ engine, clock: () => now });
}

function quietStore(now = NOW): SituationStoreV2 {
  // No rules — observations never correlate. Useful for severity / status
  // tests where we want predictable singletons.
  __storage.clear();
  const engine = new CorrelateEngine();
  return new SituationStoreV2({ engine, clock: () => now });
}

// ── Ingest basics ─────────────────────────────────────────────────────

test('ingest([]) produces no situations', () => {
  const store = freshStore();
  store.ingest([]);
  assert.equal(store.list().length, 0);
});

test('single observation → 1 situation with status=watching', () => {
  const store = quietStore();
  store.ingest([makeEvent({ id: 'a' })]);
  const all = store.list();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.status, 'watching');
  assert.equal(all[0]!.observations.length, 1);
  assert.equal(all[0]!.edges.length, 0);
});

test('two correlated observations → 1 merged situation with edges', () => {
  const store = freshStore();
  store.ingest([
    makeEvent({ id: 'a', timestamp: NOW }),
    makeEvent({ id: 'b', timestamp: NOW + 5_000 }),
  ]);
  const all = store.list();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.observations.length, 2);
  assert.equal(all[0]!.edges.length, 1);
  assert.equal(all[0]!.edges[0]!.type, 'co-located');
});

test('correlation rule with causal-candidate edge maps to caused_by', () => {
  const store = freshStore(CAUSAL_RULE);
  store.ingest([
    makeEvent({ id: 'a', timestamp: NOW }),
    makeEvent({ id: 'b', timestamp: NOW + 1000 }),
  ]);
  const sit = store.list()[0]!;
  assert.equal(sit.edges[0]!.type, 'caused_by');
  assert.equal(sit.edges[0]!.ruleId, 'always-causal');
});

test('two distant unrelated observations → 2 separate situations', () => {
  const store = quietStore();
  store.ingest([
    makeEvent({ id: 'a', domain: 'weather', location: { lat: 40, lon: -74, radiusKm: 1 } }),
    makeEvent({ id: 'b', domain: 'cyber', location: { lat: -33, lon: 151, radiusKm: 1 } }),
  ]);
  assert.equal(store.list().length, 2);
});

test('incremental correlation publishes pairs without situation or persistence fan-out', () => {
  __storage.clear();
  const engine = new CorrelateEngine();
  engine.registerRule({
    id: 'learned:weather->infra',
    name: 'fixture learned rule',
    description: 'fixture',
    domains: ['weather', 'infra'],
    timeWindowMs: 60_000,
    edgeType: 'causal-candidate',
    matchFn: (a, b) => a.domain === 'weather' && b.domain === 'infra',
  });
  let persistenceSchedules = 0;
  const store = new SituationStoreV2({
    engine,
    clock: () => NOW,
    persistenceScheduler: () => {
      persistenceSchedules += 1;
      return () => {};
    },
  });
  const weather = makeEvent({ id: 'incremental-weather', domain: 'weather', timestamp: NOW - 1 });
  const infra = makeEvent({ id: 'incremental-infra', domain: 'infra', timestamp: NOW });
  store.ingest([weather]);
  store.ingest([infra]);
  const before = store.list();
  const schedulesBefore = persistenceSchedules;
  let mutationCalls = 0;
  let situationCalls = 0;
  let pairCalls = 0;
  store.subscribeMutations(() => { mutationCalls += 1; });
  store.subscribe(() => { situationCalls += 1; });
  store.addPairListener((pairs) => { pairCalls += pairs.length; });

  const result = store.publishIncrementalCorrelation(infra, [weather]);

  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0]!.ruleId, 'learned:weather->infra');
  assert.equal(pairCalls, 1);
  assert.equal(mutationCalls, 0);
  assert.equal(situationCalls, 0);
  assert.equal(persistenceSchedules, schedulesBefore);
  assert.deepEqual(store.list(), before);
});

// ── Severity rollup ──────────────────────────────────────────────────

test('severity = critical when any observation is CRITICAL', () => {
  const store = freshStore();
  store.ingest([
    makeEvent({ id: 'a', severity: 'CRITICAL' }),
    makeEvent({ id: 'b', severity: 'LOW' }),
  ]);
  assert.equal(store.list()[0]!.severity, 'critical');
});

test('severity = high when max observation is HIGH', () => {
  const store = freshStore();
  store.ingest([
    makeEvent({ id: 'a', severity: 'HIGH' }),
    makeEvent({ id: 'b', severity: 'INFO' }),
  ]);
  assert.equal(store.list()[0]!.severity, 'high');
});

test('severity = medium when only MEDIUM or several lower-severity', () => {
  const store = quietStore();
  store.ingest([makeEvent({ id: 'a', severity: 'MEDIUM' })]);
  assert.equal(store.list()[0]!.severity, 'medium');
});

test('severity = low when single LOW observation', () => {
  const store = quietStore();
  store.ingest([makeEvent({ id: 'a', severity: 'LOW' })]);
  assert.equal(store.list()[0]!.severity, 'low');
});

// ── Status transitions ──────────────────────────────────────────────

test('status = active when at least one edge is present', () => {
  const store = freshStore();
  store.ingest([makeEvent({ id: 'a' }), makeEvent({ id: 'b' })]);
  assert.equal(store.list()[0]!.status, 'active');
});

test('status = watching for lone uncorrelated observation', () => {
  const store = quietStore();
  store.ingest([makeEvent({ id: 'a' })]);
  assert.equal(store.list()[0]!.status, 'watching');
});

test('stale observations (>48h old) auto-resolve on next ingest', () => {
  const past = NOW - 50 * 60 * 60 * 1000;
  const store = quietStore();
  store.ingest([makeEvent({ id: 'a', timestamp: past })]);
  // Force another ingest with no new observations to trigger the
  // stale-sweep. autoResolveStale runs against the configured clock.
  store.ingest([]);
  const sit = store.list()[0]!;
  assert.equal(sit.status, 'resolved');
  assert.ok(sit.resolvedAt, 'expected resolvedAt to be set');
});

// ── Merging ─────────────────────────────────────────────────────────

test('re-ingesting a known observation merges into the existing situation', () => {
  const store = quietStore();
  const a = makeEvent({ id: 'a' });
  store.ingest([a]);
  store.ingest([a]);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0]!.observations.length, 1);
});

test('shared observation across correlated batches keeps one situation', () => {
  // Ingest 1: a + b correlated → situation S with [a,b]. Ingest 2: a + c
  // correlated. Pair (a,c) shares observation a with S → c joins S.
  const store = freshStore();
  store.ingest([
    makeEvent({ id: 'a', timestamp: NOW }),
    makeEvent({ id: 'b', timestamp: NOW + 1000 }),
  ]);
  store.ingest([
    makeEvent({ id: 'a', timestamp: NOW }),
    makeEvent({ id: 'c', timestamp: NOW + 2000 }),
  ]);
  const all = store.list();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.observations.length, 3);
});

test('events within 500km + 6h merge across ingests by proximity', () => {
  const store = quietStore();
  store.ingest([makeEvent({
    id: 'a', location: { lat: 40, lon: -74, radiusKm: 1 }, timestamp: NOW,
  })]);
  store.ingest([makeEvent({
    id: 'b', location: { lat: 40.5, lon: -74.5, radiusKm: 1 }, timestamp: NOW + 60_000,
  })]);
  assert.equal(store.list().length, 1);
});

test('events outside 500km + 6h window stay separate', () => {
  const store = quietStore();
  store.ingest([makeEvent({
    id: 'a', location: { lat: 40, lon: -74, radiusKm: 1 }, timestamp: NOW,
  })]);
  store.ingest([makeEvent({
    id: 'b', location: { lat: 10, lon: -10, radiusKm: 1 }, timestamp: NOW + 60_000,
  })]);
  assert.equal(store.list().length, 2);
});

test('events outside 6h time window stay separate even when close in space', () => {
  const store = quietStore();
  store.ingest([makeEvent({
    id: 'a', location: { lat: 40, lon: -74, radiusKm: 1 }, timestamp: NOW,
  })]);
  store.ingest([makeEvent({
    id: 'b', location: { lat: 40, lon: -74, radiusKm: 1 }, timestamp: NOW + 7 * 60 * 60 * 1000,
  })]);
  assert.equal(store.list().length, 2);
});

test('union-find: a-b correlated + b-c correlated → single situation with a,b,c', () => {
  const ruleAB: CorrelationRule = {
    id: 'pair-ab', name: 'a↔b', description: 't', domains: [],
    timeWindowMs: 60 * 60 * 1000, edgeType: 'co-located',
    matchFn: (x, y) => (x.id === 'a' && y.id === 'b') || (x.id === 'b' && y.id === 'a'),
  };
  const ruleBC: CorrelationRule = {
    id: 'pair-bc', name: 'b↔c', description: 't', domains: [],
    timeWindowMs: 60 * 60 * 1000, edgeType: 'co-located',
    matchFn: (x, y) => (x.id === 'b' && y.id === 'c') || (x.id === 'c' && y.id === 'b'),
  };
  const engine = new CorrelateEngine();
  engine.registerRule(ruleAB);
  engine.registerRule(ruleBC);
  __storage.clear();
  const store = new SituationStoreV2({ engine, clock: () => NOW });
  store.ingest([
    makeEvent({ id: 'a' }), makeEvent({ id: 'b' }), makeEvent({ id: 'c' }),
  ]);
  const all = store.list();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.observations.length, 3);
  assert.equal(all[0]!.edges.length, 2);
});

// ── Confidence ──────────────────────────────────────────────────────

test('lone observation gets baseline 0.5 confidence', () => {
  const store = quietStore();
  store.ingest([makeEvent({ id: 'a' })]);
  assert.equal(store.list()[0]!.confidence, 0.5);
});

test('correlated pair confidence is bounded by [average + bonus, 0.99]', () => {
  const store = freshStore(CAUSAL_RULE);
  store.ingest([makeEvent({ id: 'a', timestamp: NOW }), makeEvent({ id: 'b', timestamp: NOW + 1000 })]);
  const c = store.list()[0]!.confidence;
  assert.ok(c >= 0.9 && c <= 0.99, `confidence ${c} not within [0.9, 0.99]`);
});

// ── Name + summary ─────────────────────────────────────────────────

test('name includes primary domain and region', () => {
  const store = quietStore();
  store.ingest([makeEvent({
    id: 'a', domain: 'seismic', location: { lat: 35.5, lon: 139.5, radiusKm: 10 },
  })]);
  const name = store.list()[0]!.name;
  assert.match(name, /seismic/);
  assert.match(name, /35\.5/);
});

test('name lists multi-domain combos when related domains exist', () => {
  const store = freshStore();
  store.ingest([
    makeEvent({ id: 'a', domain: 'seismic', severity: 'CRITICAL' }),
    makeEvent({ id: 'b', domain: 'weather' }),
  ]);
  const name = store.list()[0]!.name;
  assert.match(name, /\+/);
});

test('summary mentions the lead observation title and edge count', () => {
  const store = freshStore();
  store.ingest([
    makeEvent({ id: 'a', title: 'M7.0 quake near Tokyo', severity: 'CRITICAL' }),
    makeEvent({ id: 'b', title: 'Tsunami warning' }),
  ]);
  const summary = store.list()[0]!.summary;
  assert.match(summary, /Tokyo/);
  assert.match(summary, /evidence edge/);
});

// ── Filtering ──────────────────────────────────────────────────────

test('getSituations filters by status', () => {
  const store = quietStore();
  store.ingest([makeEvent({ id: 'a' })]);
  store.ingest([makeEvent({ id: 'b', timestamp: NOW - 100 * 60 * 60 * 1000 })]);
  store.ingest([]);  // sweep
  const watching = store.getSituations({ status: 'watching' });
  const resolved = store.getSituations({ status: 'resolved' });
  assert.equal(watching.length, 1);
  assert.equal(resolved.length, 1);
});

test('getSituations filters by domain', () => {
  const store = quietStore();
  store.ingest([makeEvent({ id: 'a', domain: 'cyber' })]);
  store.ingest([makeEvent({ id: 'b', domain: 'weather', location: { lat: 0, lon: 0 } })]);
  const cyber = store.getSituations({ domain: 'cyber' });
  assert.equal(cyber.length, 1);
  assert.equal(cyber[0]!.domain, 'cyber');
});

test('getSituations filters by minSeverity', () => {
  const store = quietStore();
  store.ingest([makeEvent({ id: 'a', severity: 'LOW' })]);
  store.ingest([makeEvent({ id: 'b', severity: 'HIGH', location: { lat: 50, lon: 50 } })]);
  const highOrAbove = store.getSituations({ minSeverity: 'high' });
  assert.equal(highOrAbove.length, 1);
  assert.equal(highOrAbove[0]!.severity, 'high');
});

test('getSituations filters by sinceMs', () => {
  const store = quietStore();
  store.ingest([makeEvent({ id: 'a' })]);
  const before = store.getSituations({ sinceMs: NOW + 10_000 });
  const after = store.getSituations({ sinceMs: NOW - 10_000 });
  assert.equal(before.length, 0);
  assert.equal(after.length, 1);
});

test('getActive() is an alias for status=active', () => {
  const store = freshStore();
  store.ingest([makeEvent({ id: 'a' }), makeEvent({ id: 'b' })]);
  assert.equal(store.getActive().length, 1);
});

// ── Subscribe + notification ───────────────────────────────────────

test('subscribe fires the listener on every ingest', () => {
  const store = quietStore();
  let calls = 0;
  store.subscribe(() => { calls += 1; });
  store.ingest([makeEvent({ id: 'a' })]);
  store.ingest([makeEvent({ id: 'b', location: { lat: -40, lon: 100 } })]);
  assert.equal(calls, 2);
});

test('subscribe returns an unsubscribe function', () => {
  const store = quietStore();
  let calls = 0;
  const unsubscribe = store.subscribe(() => { calls += 1; });
  store.ingest([makeEvent({ id: 'a' })]);
  unsubscribe();
  store.ingest([makeEvent({ id: 'b', location: { lat: -40, lon: 100 } })]);
  assert.equal(calls, 1);
});

test('listener crashes do not break subsequent listeners', () => {
  const store = quietStore();
  let secondCalled = false;
  store.subscribe(() => { throw new Error('boom'); });
  store.subscribe(() => { secondCalled = true; });
  store.ingest([makeEvent({ id: 'a' })]);
  assert.equal(secondCalled, true);
});

test('exact duplicate ingest is unchanged and does not persist or notify', () => {
  __storage.clear();
  const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
  let writes = 0;
  const nativeSet = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key: string, value: string): void => {
    writes += 1;
    nativeSet(key, value);
  };
  try {
    const store = new SituationStoreV2({
      engine: new CorrelateEngine(),
      clock: () => NOW,
      persistenceScheduler: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return () => {};
      },
    });
    let mutationCalls = 0;
    let viewSchedules = 0;
    store.subscribeMutations(() => { mutationCalls += 1; });
    store.subscribeView(() => {}, (callback) => {
      viewSchedules += 1;
      return callback;
    });

    const event = makeEvent({ id: 'duplicate', title: 'Stable event' });
    const first = store.ingest([event]);
    const updatedAt = store.list()[0]!.updatedAt.getTime();
    const duplicate = store.ingest([event]);

    assert.equal(first.status, 'changed');
    assert.equal('observations' in first.mutations[0]!.situation, false);
    assert.equal('edges' in first.mutations[0]!.situation, false);
    assert.equal(first.mutations[0]!.situation.observationCount, 1);
    assert.equal(duplicate.status, 'unchanged');
    assert.deepEqual(duplicate.mutations, []);
    assert.equal(store.list()[0]!.updatedAt.getTime(), updatedAt);
    assert.equal(mutationCalls, 1);
    assert.equal(viewSchedules, 1);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0]!.delayMs, 1_000);
    assert.equal(writes, 0);
    scheduled[0]!.callback();
    assert.equal(writes, 1);
  } finally {
    localStorage.setItem = nativeSet;
  }
});

test('mixed replay batches correlate only novel observations', () => {
  const store = freshStore();
  const known = makeEvent({ id: 'known' });
  store.ingest([known]);
  let emittedPairs = 0;
  store.setPairListener((pairs) => { emittedPairs += pairs.length; });

  const result = store.ingest([known, makeEvent({ id: 'novel' })]);

  assert.equal(result.status, 'changed');
  assert.deepEqual(result.mutations[0]!.observationIds, ['novel']);
  assert.equal(result.mutations[0]!.situation.edgeCount, 0);
  assert.equal(emittedPairs, 0);
});

test('a replayed observation cannot force an unrelated novel event into its situation', () => {
  const store = freshStore();
  const known = makeEvent({
    id: 'known-replay',
    domain: 'security',
    location: { lat: 10, lon: 10 },
  });
  store.ingest([known]);

  store.ingest([known, makeEvent({
    id: 'unrelated-novel',
    domain: 'finance',
    location: { lat: -40, lon: 100 },
  })]);

  const situations = store.list();
  assert.equal(situations.length, 2);
  assert.deepEqual(
    situations.map((situation) => situation.observations.map((observation) => observation.id)),
    [['known-replay'], ['unrelated-novel']],
  );
});

test('live store flushes pending persistence before unload', () => {
  __storage.clear();
  const listeners = new Map<string, () => void>();
  const runtime = globalThis as typeof globalThis & {
    addEventListener?: (type: string, listener: () => void) => void;
    removeEventListener?: (type: string, listener: () => void) => void;
  };
  const savedAdd = runtime.addEventListener;
  const savedRemove = runtime.removeEventListener;
  const nativeSet = localStorage.setItem.bind(localStorage);
  let writes = 0;
  runtime.addEventListener = (type, listener) => { listeners.set(type, listener); };
  runtime.removeEventListener = (type) => { listeners.delete(type); };
  localStorage.setItem = (key: string, value: string): void => {
    writes += 1;
    nativeSet(key, value);
  };
  try {
    const store = new SituationStoreV2({
      engine: new CorrelateEngine(),
      clock: () => NOW,
      diagnosticsMode: 'live',
      persistenceScheduler: () => () => {},
    });
    store.ingest([makeEvent({ id: 'pending-before-unload' })]);
    assert.equal(writes, 0);
    listeners.get('beforeunload')!();
    assert.equal(writes, 1);
    store.resetForTesting();
  } finally {
    localStorage.setItem = nativeSet;
    runtime.addEventListener = savedAdd;
    runtime.removeEventListener = savedRemove;
  }
});

test('mutation receipts are synchronous while view fanout coalesces a burst', () => {
  __storage.clear();
  const viewQueue: Array<() => void> = [];
  const store = new SituationStoreV2({
    engine: new CorrelateEngine(),
    clock: () => NOW,
    persistenceScheduler: () => () => {},
  });
  const mutationIds: string[] = [];
  const viewCounts: number[] = [];
  store.subscribeMutations((result) => {
    mutationIds.push(...result.mutations.map((mutation) => mutation.situationId));
  });
  store.subscribeView(
    (situations) => { viewCounts.push(situations.length); },
    (callback) => {
      viewQueue.push(callback);
      return callback;
    },
  );

  store.ingest([makeEvent({ id: 'one', location: { lat: 10, lon: 10 } })]);
  store.ingest([makeEvent({ id: 'two', location: { lat: -40, lon: 100 } })]);

  assert.equal(mutationIds.length, 2);
  assert.equal(viewQueue.length, 1);
  assert.deepEqual(viewCounts, []);
  viewQueue.shift()!();
  assert.deepEqual(viewCounts, [2]);
});

// ── Stats ──────────────────────────────────────────────────────────

test('stats() counts total, active, watching, resolved + per-domain', () => {
  const store = quietStore();
  store.ingest([makeEvent({ id: 'a', domain: 'weather' })]);
  store.ingest([makeEvent({ id: 'b', domain: 'cyber', location: { lat: 30, lon: 30 } })]);
  const stats = store.stats();
  assert.equal(stats.total, 2);
  assert.equal(stats.watching, 2);
  assert.equal(stats.active, 0);
  assert.equal(stats.resolved, 0);
  assert.equal(stats.byDomain.weather, 1);
  assert.equal(stats.byDomain.cyber, 1);
});

// ── Persistence ────────────────────────────────────────────────────

test('situations persist across instances via localStorage', async () => {
  __storage.clear();
  const engine = new CorrelateEngine();
  const a = new SituationStoreV2({ engine, clock: () => NOW });
  a.ingest([makeEvent({ id: 'a', title: 'Persisted observation' })]);
  await a.flushPersistence();
  // New instance with the same clock sees the persisted blob.
  const b = new SituationStoreV2({ engine, clock: () => NOW });
  assert.equal(b.list().length, 1);
  assert.equal(b.list()[0]!.observations[0]!.title, 'Persisted observation');
});

test('corrupt persisted JSON is ignored without throwing', () => {
  __storage.clear();
  __storage.set('wm-situation-store-v2', 'not-json');
  const store = new SituationStoreV2({ engine: new CorrelateEngine(), clock: () => NOW });
  assert.equal(store.list().length, 0);
});

// ── Entity resolution ─────────────────────────────────────────────

test('entityIds rolled up from observations are deduped on the situation', () => {
  const store = quietStore();
  store.ingest([
    makeEvent({ id: 'a', entityIds: ['ship-1', 'country-jp'] }),
  ]);
  store.ingest([
    makeEvent({ id: 'b', entityIds: ['ship-1', 'callsign-x'], location: { lat: 0, lon: 0 } }),
  ]);
  const ids = store.list().flatMap((s) => s.entityIds).sort();
  // Two situations (no merge — distant), each has its own entity set.
  assert.deepEqual(ids, ['callsign-x', 'country-jp', 'ship-1', 'ship-1']);
});

// ── Singleton + reset hooks ─────────────────────────────────────────

test('getSituationStoreV2 returns a stable singleton', () => {
  __resetSituationStoreV2Singleton();
  const a = getSituationStoreV2();
  const b = getSituationStoreV2();
  assert.equal(a, b);
});

test('resetForTesting empties the store and the persisted blob', () => {
  const store = quietStore();
  store.ingest([makeEvent({ id: 'a' })]);
  store.resetForTesting();
  assert.equal(store.list().length, 0);
  assert.equal(__storage.has('wm-situation-store-v2'), false);
});

// ── Internal helpers ─────────────────────────────────────────────

test('groupPairsByConnectivity puts lone observations in their own buckets', () => {
  const drafts = __internals.groupPairsByConnectivity(
    [makeEvent({ id: 'a' }), makeEvent({ id: 'b' })],
    [],
  );
  assert.equal(drafts.length, 2);
});

test('locationFromObservations returns a centroid + extent', () => {
  const loc = __internals.locationFromObservations([
    makeEvent({ id: 'a', location: { lat: 0, lon: 0, radiusKm: 0 } }),
    makeEvent({ id: 'b', location: { lat: 10, lon: 10, radiusKm: 0 } }),
  ]);
  assert.ok(loc);
  assert.equal(loc!.lat, 5);
  assert.equal(loc!.lon, 5);
  assert.ok(loc!.radiusKm > 0);
});

test('statusFromContext marks an observation older than 48h as resolved', () => {
  const now = NOW;
  const events = [makeEvent({ id: 'a', timestamp: now - 50 * 60 * 60 * 1000 })];
  const status = __internals.statusFromContext(events, [], now);
  assert.equal(status, 'resolved');
});

test('severityFromObservations promotes to medium when multiple lower-severity observations cluster', () => {
  const events = [
    makeEvent({ id: 'a', severity: 'LOW' as ObservationSeverity }),
    makeEvent({ id: 'b', severity: 'LOW' as ObservationSeverity }),
  ];
  assert.equal(__internals.severityFromObservations(events), 'medium');
});

// ── Defensive copy ─────────────────────────────────────────────────

test('list() returns defensive copies — mutating callsite does not corrupt the store', () => {
  const store = quietStore();
  store.ingest([makeEvent({ id: 'a' })]);
  const first = store.list();
  first[0]!.observations.push(makeEvent({ id: 'injected' }));
  assert.equal(store.list()[0]!.observations.length, 1);
});

// ── Sanity: cleanup the singleton after the file finishes ───────────
test('teardown', () => {
  __resetSituationStoreV2Singleton();
  __storage.clear();
  // ensure the assertion library produced at least one expectation
  assert.ok(true);

  // Reference the imported Situation type so an unused-import warning
  // doesn't sneak in on strict tsconfigs.
  const _s: Situation | undefined = undefined;
  void _s;
});
