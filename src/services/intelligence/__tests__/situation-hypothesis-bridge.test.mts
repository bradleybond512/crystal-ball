import assert from 'node:assert/strict';
import test from 'node:test';

import {
  startSituationHypothesisBridge,
  classifyAlignment,
  __internals,
  type AlignmentContext,
  type BridgeOptions,
  type RefutedHypothesisEvent,
} from '../situation-hypothesis-bridge.ts';
import { SituationStoreV2 } from '../situation-store-v2.ts';
import {
  CompetitiveHypothesisEngine,
} from '../competitive-hypothesis.ts';
import type { ObservationEvent } from '@/types/intelligence';
import type { RecordEvaluationInput } from '../../algorithms/record-evaluation.ts';
import type { AlgorithmDomain, EvaluationRecord } from '../../algorithms/algorithm-evaluation-ledger.ts';
import { syncLearnedRules } from '../../correlation/learned-rules.ts';
import {
  __resetCorrelationLivenessForTests,
  getCorrelationLivenessDiagnostics,
} from '../../correlation/correlation-liveness.ts';
import { CorrelateEngine, type CorrelationRule } from '../correlate-engine.ts';

// ── Helpers ───────────────────────────────────────────────────────────────

const BASE_TIME = Date.parse('2026-06-12T12:00:00Z');

function makeEvent(over: Partial<ObservationEvent> & Pick<ObservationEvent, 'id'>): ObservationEvent {
  return {
    sourceId: over.sourceId ?? 'usgs-primary',
    domain: over.domain ?? 'earthquake',
    timestamp: over.timestamp ?? BASE_TIME,
    severity: over.severity ?? 'HIGH',
    title: over.title ?? 'M6.2 earthquake',
    raw: {},
    entityIds: over.entityIds ?? ['JP'],
    tags: over.tags ?? ['earthquake'],
    location: over.location ?? { lat: 35.0, lon: 138.0, radiusKm: 50 },
    ...over,
  };
}

const nullStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

interface RecorderCall {
  algorithmId: string;
  input: RecordEvaluationInput;
}

function stubRecord(algorithmId: string, input: RecordEvaluationInput): EvaluationRecord {
  return {
    id: `stub-${algorithmId}`,
    algorithmId,
    domain: 'reasoning_hypothesis' as AlgorithmDomain,
    version: '1.0.0',
    at: BASE_TIME,
    durationMs: input.durationMs,
    score: input.score,
    label: input.label,
    detail: input.detail,
  };
}

function makeDeps(clockInput: number | (() => number) = BASE_TIME) {
  const clock = typeof clockInput === 'function' ? clockInput : () => clockInput;
  const store = new SituationStoreV2({ clock });
  const engine = new CompetitiveHypothesisEngine({ storage: nullStorage, clock });

  const recorderCalls: RecorderCall[] = [];
  const recorder = (algorithmId: string, input: RecordEvaluationInput): EvaluationRecord => {
    recorderCalls.push({ algorithmId, input });
    return stubRecord(algorithmId, input);
  };

  let busListener: ((e: ObservationEvent) => void) | null = null;
  const observationBus = (listener: (e: ObservationEvent) => void): (() => void) => {
    busListener = listener;
    return () => { busListener = null; };
  };
  const fireEvent = (event: ObservationEvent): void => {
    assert.ok(busListener !== null, 'bridge not started');
    busListener(event);
  };

  const opts: BridgeOptions = { store, engine, clock, recorder, observationBus };
  return { store, engine, clock, recorder, observationBus, fireEvent, recorderCalls, opts };
}

// ── Pipeline: new situation + hypothesis set ──────────────────────────────

test('first HIGH event creates situation and 3-hypothesis set summing to 1.0', () => {
  __internals.reset();
  const { store, engine, opts, fireEvent } = makeDeps();
  startSituationHypothesisBridge(opts);

  fireEvent(makeEvent({ id: 'eq-1', severity: 'HIGH', sourceId: 'usgs-primary' }));

  const situations = store.list();
  assert.ok(situations.length >= 1, 'at least one situation should be created');

  const set = engine.getSet(situations[0]!.id);
  assert.ok(set !== null, 'hypothesis set should exist');
  assert.equal(set!.hypotheses.length, 3, 'should have exactly 3 hypotheses');

  const total = set!.hypotheses.reduce((sum, h) => sum + h.confidence, 0);
  assert.ok(Math.abs(total - 1.0) < 0.001, `confidences must sum to ~1.0, got ${total}`);
});

test('second observation in same situation produces evidence rows', () => {
  __internals.reset();
  const { store, engine, opts, fireEvent } = makeDeps();
  startSituationHypothesisBridge(opts);

  fireEvent(makeEvent({ id: 'eq-1', severity: 'HIGH', sourceId: 'usgs-primary' }));
  const sitId = store.list()[0]!.id;

  const evidenceBefore = engine.getSet(sitId)!.hypotheses.reduce(
    (sum, h) => sum + h.evidence.length, 0,
  );

  fireEvent(makeEvent({
    id: 'eq-2',
    severity: 'HIGH',
    sourceId: 'emsc-secondary',
    timestamp: BASE_TIME + 60_000,
  }));

  const evidenceAfter = engine.getSet(sitId)!.hypotheses.reduce(
    (sum, h) => sum + h.evidence.length, 0,
  );
  assert.ok(evidenceAfter > evidenceBefore, 'evidence should grow after second observation');
});

test('routes hypotheses from ingest receipts without full-store list scans', () => {
  __internals.reset();
  const { store, engine, opts, fireEvent } = makeDeps();
  const originalList = store.list.bind(store);
  let listCalls = 0;
  store.list = () => {
    listCalls += 1;
    return originalList();
  };
  startSituationHypothesisBridge(opts);

  fireEvent(makeEvent({ id: 'receipt-1', severity: 'HIGH', sourceId: 'src-A' }));
  fireEvent(makeEvent({
    id: 'receipt-2',
    severity: 'HIGH',
    sourceId: 'src-B',
    timestamp: BASE_TIME + 60_000,
  }));

  assert.equal(listCalls, 0);
  const sets = engine.getAllSets();
  assert.equal(sets.length, 1);
  assert.ok(sets[0]!.hypotheses.some((hypothesis) => hypothesis.evidence.length > 0));
});

// ── Corroboration + consensus ─────────────────────────────────────────────

test('corroborating second source raises primary confidence', () => {
  __internals.reset();
  const { store, engine, opts, fireEvent } = makeDeps();
  startSituationHypothesisBridge(opts);

  fireEvent(makeEvent({ id: 'eq-1', severity: 'HIGH', sourceId: 'src-A' }));
  const sitId = store.list()[0]!.id;
  const confidenceBefore = engine.getSet(sitId)!.hypotheses
    .find((h) => h.type === 'primary')!.confidence;

  fireEvent(makeEvent({ id: 'eq-2', severity: 'HIGH', sourceId: 'src-B', timestamp: BASE_TIME + 60_000 }));

  const confidenceAfter = engine.getSet(sitId)!.hypotheses
    .find((h) => h.type === 'primary')!.confidence;

  assert.ok(
    confidenceAfter > confidenceBefore,
    `primary confidence should increase; was ${confidenceBefore}, now ${confidenceAfter}`,
  );
});

test('consensus flips statuses and emits exactly one recordAlgorithmEvaluation', () => {
  __internals.reset();
  const { store, engine, opts, fireEvent, recorderCalls } = makeDeps();
  startSituationHypothesisBridge(opts);

  // Seed
  fireEvent(makeEvent({ id: 'eq-1', severity: 'HIGH', sourceId: 'src-1' }));
  const sitId = store.list()[0]!.id;

  // Add many corroborating sources until consensus (primary > 0.7, others < 0.4)
  let consensusReached = false;
  for (let i = 2; i <= 20; i++) {
    const set = engine.getSet(sitId);
    if (set?.consensusReached) { consensusReached = true; break; }
    fireEvent(makeEvent({
      id: `eq-${i}`,
      severity: 'HIGH',
      sourceId: `src-corroborate-${i}`,
      timestamp: BASE_TIME + i * 60_000,
    }));
  }

  assert.ok(
    consensusReached || engine.getSet(sitId)?.consensusReached,
    'consensus should be reached within 20 corroborating events',
  );

  const evalCalls = recorderCalls.filter((c) => c.algorithmId === 'competitive-hypothesis');
  assert.equal(evalCalls.length, 1, `expected exactly 1 evaluation, got ${evalCalls.length}`);

  // Leader should be 'supported', others 'refuted'
  const finalSet = engine.getSet(sitId)!;
  const leaderId = finalSet.leadingHypothesis!.id;
  for (const h of finalSet.hypotheses) {
    const expected = h.id === leaderId ? 'supported' : 'refuted';
    assert.equal(h.status, expected, `${h.type} should be ${expected}`);
  }

  // Further events must not emit a second evaluation
  fireEvent(makeEvent({ id: 'eq-late', severity: 'HIGH', sourceId: 'src-late', timestamp: BASE_TIME + 30 * 60_000 }));
  assert.equal(
    recorderCalls.filter((c) => c.algorithmId === 'competitive-hypothesis').length,
    1,
    'should not emit a second evaluation after consensus',
  );
});

test('consensus records processing latency separately from time to consensus', () => {
  __internals.reset();
  let wallClock = BASE_TIME;
  let runtimeClock = 0;
  const { store, engine, opts, fireEvent, recorderCalls } = makeDeps(() => wallClock);
  startSituationHypothesisBridge({
    ...opts,
    runtimeClock: () => {
      runtimeClock += 2;
      return runtimeClock;
    },
  } as BridgeOptions);

  fireEvent(makeEvent({ id: 'eq-1', severity: 'HIGH', sourceId: 'src-1' }));
  const sitId = store.list()[0]!.id;

  for (let i = 2; i <= 20; i++) {
    if (engine.getSet(sitId)?.consensusReached) break;
    wallClock += 60_000;
    fireEvent(makeEvent({
      id: `eq-${i}`,
      severity: 'HIGH',
      sourceId: `src-corroborate-${i}`,
      timestamp: wallClock,
    }));
  }

  const evaluation = recorderCalls.find((call) => call.algorithmId === 'competitive-hypothesis');
  assert.ok(evaluation);
  assert.equal(evaluation.input.durationMs, 2);
  assert.equal(evaluation.input.detail?.timeToConsensusMs, wallClock - BASE_TIME);
});

// ── onHypothesisRefuted hook (PR 14 memory hygiene) ───────────────────────

test('onHypothesisRefuted fires once per refuted (non-leading) hypothesis on consensus', () => {
  __internals.reset();
  const { store, engine, opts, fireEvent } = makeDeps();
  const refutedEvents: RefutedHypothesisEvent[] = [];
  startSituationHypothesisBridge({
    ...opts,
    onHypothesisRefuted: (event) => { refutedEvents.push(event); },
  });

  fireEvent(makeEvent({ id: 'eq-1', severity: 'HIGH', sourceId: 'src-1' }));
  const sitId = store.list()[0]!.id;

  for (let i = 2; i <= 20; i++) {
    if (engine.getSet(sitId)?.consensusReached) break;
    fireEvent(makeEvent({
      id: `eq-${i}`, severity: 'HIGH', sourceId: `src-corroborate-${i}`,
      timestamp: BASE_TIME + i * 60_000,
    }));
  }

  const finalSet = engine.getSet(sitId)!;
  assert.ok(finalSet.consensusReached, 'consensus should be reached');

  // Exactly the non-leader hypotheses (2 of the 3) should have fired the hook.
  assert.equal(refutedEvents.length, 2, `expected 2 refuted events, got ${refutedEvents.length}`);
  for (const event of refutedEvents) {
    assert.equal(event.situationId, sitId);
    assert.equal(event.domain, 'earthquake');
    assert.deepEqual(event.entityIds, ['JP']);
    assert.ok(typeof event.claim === 'string' && event.claim.length > 0);
    assert.notEqual(event.hypothesisType, finalSet.leadingHypothesis!.type);
  }

  // Further events must not fire the hook again (single evaluation per set).
  fireEvent(makeEvent({ id: 'eq-late', severity: 'HIGH', sourceId: 'src-late', timestamp: BASE_TIME + 30 * 60_000 }));
  assert.equal(refutedEvents.length, 2, 'no additional refutation events after consensus');
});

test('onHypothesisRefuted: a throwing callback does not break the bridge or the ledger recorder', () => {
  __internals.reset();
  const { store, engine, opts, fireEvent, recorderCalls } = makeDeps();
  startSituationHypothesisBridge({
    ...opts,
    onHypothesisRefuted: () => { throw new Error('boom'); },
  });

  fireEvent(makeEvent({ id: 'eq-1', severity: 'HIGH', sourceId: 'src-1' }));
  const sitId = store.list()[0]!.id;

  for (let i = 2; i <= 20; i++) {
    if (engine.getSet(sitId)?.consensusReached) break;
    fireEvent(makeEvent({
      id: `eq-${i}`, severity: 'HIGH', sourceId: `src-corroborate-${i}`,
      timestamp: BASE_TIME + i * 60_000,
    }));
  }

  assert.ok(engine.getSet(sitId)!.consensusReached, 'consensus should still be reached');
  const evalCalls = recorderCalls.filter((c) => c.algorithmId === 'competitive-hypothesis');
  assert.equal(evalCalls.length, 1, 'ledger evaluation should still fire despite the throwing hook');
});

test('bridge with no onHypothesisRefuted option works exactly as before', () => {
  __internals.reset();
  const { store, engine, opts, fireEvent } = makeDeps();
  startSituationHypothesisBridge(opts); // no onHypothesisRefuted

  fireEvent(makeEvent({ id: 'eq-1', severity: 'HIGH', sourceId: 'src-1' }));
  const situations = store.list();
  assert.ok(situations.length >= 1);
  assert.equal(engine.getSet(situations[0]!.id)!.hypotheses.length, 3);
});

// ── classifyAlignment — table-driven ─────────────────────────────────────

function ctx(over: Partial<AlignmentContext> = {}): AlignmentContext {
  return {
    seenSourceIds: new Set(['source-A']),
    prevObsCount: 1,
    prevSeverity: 'HIGH',
    situationDomain: 'earthquake',
    situationEntityIds: ['JP'],
    ...over,
  };
}

function obs(over: Partial<ObservationEvent> = {}): ObservationEvent {
  return makeEvent({ id: 'obs-test', ...over });
}

test('rule 1: new source same domain → supporting 0.6 for primary', () => {
  const r = classifyAlignment(obs({ sourceId: 'src-B', domain: 'earthquake' }), 'primary', ctx());
  assert.equal(r.alignment, 'supporting');
  assert.equal(r.weight, 0.6);
});

test('rule 1: new source same domain → neutral for alternative', () => {
  const r = classifyAlignment(obs({ sourceId: 'src-B', domain: 'earthquake' }), 'alternative', ctx());
  assert.equal(r.alignment, 'neutral');
  assert.equal(r.weight, 0.0);
});

test('rule 1: new source same domain → neutral for devil-advocate', () => {
  const r = classifyAlignment(obs({ sourceId: 'src-B', domain: 'earthquake' }), 'devil-advocate', ctx());
  assert.equal(r.alignment, 'neutral');
  assert.equal(r.weight, 0.0);
});

test('rule 2: severity decreasing → supporting 0.4 for devil-advocate', () => {
  const r = classifyAlignment(
    obs({ sourceId: 'source-A', domain: 'earthquake', severity: 'LOW' }),
    'devil-advocate',
    ctx({ prevObsCount: 3, prevSeverity: 'HIGH' }),
  );
  assert.equal(r.alignment, 'supporting');
  assert.equal(r.weight, 0.4);
});

test('rule 2: severity decreasing → contradicting 0.3 for primary', () => {
  const r = classifyAlignment(
    obs({ sourceId: 'source-A', domain: 'earthquake', severity: 'LOW' }),
    'primary',
    ctx({ prevObsCount: 3, prevSeverity: 'HIGH' }),
  );
  assert.equal(r.alignment, 'contradicting');
  assert.equal(r.weight, 0.3);
});

test('rule 2: non-decreasing severity does not trigger', () => {
  const r = classifyAlignment(
    obs({ sourceId: 'source-A', domain: 'earthquake', severity: 'CRITICAL' }),
    'primary',
    ctx({ prevObsCount: 3, prevSeverity: 'HIGH' }),
  );
  // Rule 1 also doesn't fire (known source). Should be neutral via default.
  assert.equal(r.alignment, 'neutral');
});

test('rule 3: single-source after 3+ updates → supporting 0.3 for devil-advocate', () => {
  const r = classifyAlignment(
    obs({ sourceId: 'source-A', domain: 'earthquake', severity: 'HIGH' }),
    'devil-advocate',
    ctx({ seenSourceIds: new Set(['source-A']), prevObsCount: 4, prevSeverity: 'HIGH' }),
  );
  assert.equal(r.alignment, 'supporting');
  assert.equal(r.weight, 0.3);
});

test('rule 3: single-source → neutral for primary', () => {
  const r = classifyAlignment(
    obs({ sourceId: 'source-A', domain: 'earthquake', severity: 'HIGH' }),
    'primary',
    ctx({ seenSourceIds: new Set(['source-A']), prevObsCount: 4, prevSeverity: 'HIGH' }),
  );
  assert.equal(r.alignment, 'neutral');
});

test('rule 4: cross-domain with entity match → supporting 0.4 for alternative', () => {
  const r = classifyAlignment(
    obs({ sourceId: 'src-X', domain: 'cyber', entityIds: ['JP'], severity: 'MEDIUM' }),
    'alternative',
    ctx({ seenSourceIds: new Set(['source-A']), situationDomain: 'earthquake', situationEntityIds: ['JP'] }),
  );
  assert.equal(r.alignment, 'supporting');
  assert.equal(r.weight, 0.4);
});

test('rule 4: cross-domain without entity match → neutral', () => {
  const r = classifyAlignment(
    obs({ sourceId: 'src-X', domain: 'cyber', entityIds: ['US'], severity: 'MEDIUM' }),
    'alternative',
    ctx({ seenSourceIds: new Set(['source-A']), situationDomain: 'earthquake', situationEntityIds: ['JP'] }),
  );
  assert.equal(r.alignment, 'neutral');
});

test('default: known source, same domain, stable severity → neutral for all types', () => {
  const o = obs({ sourceId: 'source-A', domain: 'earthquake', severity: 'HIGH' });
  const c = ctx({ prevObsCount: 1, prevSeverity: 'HIGH' });
  for (const type of ['primary', 'alternative', 'devil-advocate'] as const) {
    assert.equal(classifyAlignment(o, type, c).alignment, 'neutral', `${type} should be neutral`);
  }
});

// ── Unsubscribe ───────────────────────────────────────────────────────────

test('startSituationHypothesisBridge is idempotent — second call is a no-op', () => {
  __internals.reset();
  let callCount = 0;
  const observationBus = (listener: (e: ObservationEvent) => void): (() => void) => {
    callCount++;
    return () => {};
  };
  const store = new SituationStoreV2({ clock: () => BASE_TIME });
  const engine = new CompetitiveHypothesisEngine({ storage: nullStorage, clock: () => BASE_TIME });
  startSituationHypothesisBridge({ store, engine, observationBus });
  startSituationHypothesisBridge({ store, engine, observationBus });
  assert.equal(callCount, 1, 'bus should only be subscribed once');
  __internals.reset();
});

test('unsubscribe stops further processing', () => {
  __internals.reset();
  let busListener: ((e: ObservationEvent) => void) | null = null;
  const observationBus = (listener: (e: ObservationEvent) => void): (() => void) => {
    busListener = listener;
    return () => { busListener = null; };
  };
  const store = new SituationStoreV2({ clock: () => BASE_TIME });
  const engine = new CompetitiveHypothesisEngine({ storage: nullStorage, clock: () => BASE_TIME });
  const stop = startSituationHypothesisBridge({ store, engine, observationBus });

  assert.ok(busListener !== null, 'listener should be registered after start');
  busListener!(makeEvent({ id: 'eq-1', severity: 'HIGH' }));
  const countBefore = store.list().length;

  stop();

  // After unsubscribe, busListener is null — bridge no longer processes events.
  assert.equal(busListener, null, 'listener should be removed after stop');
  // Even if we could fire, store should remain unchanged.
  assert.equal(store.list().length, countBefore, 'no changes after unsubscribe');
});

// ── Yielding scheduler: a burst of observations must not be processed all
//    synchronously on the ingest fire path (the boot-storm root cause). With
//    an injected deferring scheduler, events queue and drain one at a time. ──

test('deferring scheduler processes queued events off the synchronous fire path', () => {
  __internals.reset();
  const { store, opts, fireEvent } = makeDeps();
  const scheduled: (() => void)[] = [];
  const schedule = (cb: () => void): void => { scheduled.push(cb); };
  startSituationHypothesisBridge({ ...opts, schedule });

  fireEvent(makeEvent({ id: 'eq-1', severity: 'HIGH', sourceId: 'usgs-primary' }));
  fireEvent(makeEvent({ id: 'eq-2', severity: 'HIGH', sourceId: 'emsc' }));

  // Neither event has been processed yet — both are queued behind the scheduler,
  // so the synchronous fire path (a feed's data-load) is never blocked by the
  // situation/hypothesis pipeline.
  assert.equal(store.list().length, 0, 'events must NOT be processed synchronously on fire');

  // Drain the scheduler; each drain step processes exactly one queued event.
  const runNext = (): void => { const cb = scheduled.shift(); if (cb) cb(); };
  runNext();
  assert.ok(store.list().length >= 1, 'first event processed after one drain step');

  let guard = 0;
  while (scheduled.length > 0 && guard++ < 50) runNext();
  assert.ok(store.list().length >= 1, 'all queued events processed after full drain');
});

test('default (no scheduler) still processes synchronously — semantics preserved', () => {
  __internals.reset();
  const { store, opts, fireEvent } = makeDeps();
  startSituationHypothesisBridge(opts);

  fireEvent(makeEvent({ id: 'eq-1', severity: 'HIGH', sourceId: 'usgs-primary' }));
  // No scheduler injected → synchronous default → processed immediately.
  assert.ok(store.list().length >= 1, 'event processed synchronously with default scheduler');
});

test('priority ingest drains before bounded correlation and learned liveness recovers', () => {
  __internals.reset();
  __resetCorrelationLivenessForTests();
  const ingressCallbacks: Array<() => void> = [];
  const correlationCallbacks: Array<() => void> = [];
  const schedule = (callback: () => void): void => { ingressCallbacks.push(callback); };
  const correlationSchedule = (callback: () => void): (() => void) => {
    let cancelled = false;
    correlationCallbacks.push(() => {
      if (!cancelled) callback();
    });
    return () => { cancelled = true; };
  };
  const correlationEngine = new CorrelateEngine();
  const learnedRule: CorrelationRule = {
    id: 'learned:weather->infra',
    name: 'fixture learned rule',
    description: 'fixture',
    domains: ['weather', 'infra'],
    timeWindowMs: 60_000,
    edgeType: 'causal-candidate',
    matchFn: (a, b) => (
      a.domain === 'weather'
      && b.domain === 'infra'
      && b.timestamp > a.timestamp
    ),
  };
  const store = new SituationStoreV2({
    engine: correlationEngine,
    clock: () => BASE_TIME,
    diagnosticsMode: 'live',
  });
  syncLearnedRules(correlationEngine, [learnedRule]);
  const hypothesisEngine = new CompetitiveHypothesisEngine({
    storage: nullStorage,
    clock: () => BASE_TIME,
  });
  let busListener: ((event: ObservationEvent) => void) | null = null;
  let learnedPairs = 0;
  store.addPairListener((pairs) => {
    learnedPairs += pairs.filter((pair) => pair.ruleId === learnedRule.id).length;
  });
  const stop = startSituationHypothesisBridge({
    store,
    engine: hypothesisEngine,
    clock: () => BASE_TIME,
    observationBus: (listener) => {
      busListener = listener;
      return () => { busListener = null; };
    },
    schedule,
    correlationSchedule,
  });

  for (let index = 0; index < 3; index += 1) {
    busListener!(makeEvent({
      id: `weather-${index}`,
      domain: 'weather',
      timestamp: BASE_TIME - 10_000 + index,
    }));
  }
  busListener!(makeEvent({ id: 'infra', domain: 'infra', timestamp: BASE_TIME }));

  assert.equal(correlationCallbacks.length, 0);
  ingressCallbacks.shift()?.();
  assert.equal(correlationCallbacks.length, 0);
  while (ingressCallbacks.length > 0) ingressCallbacks.shift()?.();

  const situationsBeforeCorrelation = store.list();
  assert.equal(correlationCallbacks.length, 1);
  assert.equal(getCorrelationLivenessDiagnostics(BASE_TIME).status, 'degraded');
  assert.equal(learnedPairs, 0);

  while (correlationCallbacks.length > 0) correlationCallbacks.shift()?.();

  const recovered = getCorrelationLivenessDiagnostics(BASE_TIME);
  assert.equal(learnedPairs, 3);
  assert.equal(recovered.status, 'healthy');
  assert.equal(recovered.reason, 'learned_rules_active');
  assert.equal(recovered.live.batchCount, 5);
  assert.deepEqual(recovered.live.batchSizeDistribution, {
    singleton: 5,
    small: 0,
    medium: 0,
    large: 0,
  });
  assert.deepEqual(store.list(), situationsBeforeCorrelation);
  stop();
});
