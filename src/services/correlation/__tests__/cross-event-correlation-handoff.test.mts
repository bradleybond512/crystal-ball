import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CrossEventCorrelationHandoff,
  CROSS_EVENT_HISTORY_LIMIT,
  CROSS_EVENT_HISTORY_WINDOW_MS,
} from '../cross-event-correlation-handoff.ts';
import {
  CorrelateEngine,
  type CorrelationRule,
} from '../../intelligence/correlate-engine.ts';
import type { ObservationEvent } from '../../../types/intelligence.ts';

const NOW = Date.parse('2026-08-24T12:00:00Z');

function event(
  id: string,
  domain: string,
  timestamp: number = NOW,
): ObservationEvent {
  return {
    id,
    sourceId: `source-${id}`,
    domain,
    timestamp,
    severity: 'LOW',
    title: id,
    raw: {},
    entityIds: [],
    tags: [],
  };
}

function scheduler() {
  const callbacks: Array<() => void> = [];
  return {
    callbacks,
    schedule(callback: () => void): () => void {
      let cancelled = false;
      callbacks.push(() => {
        if (!cancelled) callback();
      });
      return () => { cancelled = true; };
    },
    runNext(): void {
      callbacks.shift()?.();
    },
    runAll(): void {
      while (callbacks.length > 0) callbacks.shift()?.();
    },
  };
}

const learnedRule: CorrelationRule = {
  id: 'learned:weather->infra',
  name: 'fixture learned rule',
  description: 'fixture',
  domains: ['weather', 'infra'],
  timeWindowMs: CROSS_EVENT_HISTORY_WINDOW_MS,
  edgeType: 'causal-candidate',
  matchFn: (a, b) => (
    a.domain === 'weather'
    && b.domain === 'infra'
    && b.timestamp > a.timestamp
  ),
};

test('separate offers produce one learned pair without inline correlation work', () => {
  const scheduled = scheduler();
  const engine = new CorrelateEngine();
  engine.registerRule(learnedRule);
  const emitted: string[] = [];
  const handoff = new CrossEventCorrelationHandoff({
    schedule: scheduled.schedule,
    correlate: (current, history) => {
      const result = engine.correlateIncremental(current, history, new Date(NOW));
      emitted.push(...result.pairs.map((pair) => pair.ruleId));
    },
  });

  handoff.offer(event('weather-1', 'weather', NOW - 1_000));
  handoff.offer(event('infra-1', 'infra', NOW));

  assert.deepEqual(emitted, []);
  assert.deepEqual(handoff.stats(), { history: 0, pending: 2 });

  handoff.resume();
  scheduled.runAll();

  assert.deepEqual(emitted, ['learned:weather->infra']);
  assert.deepEqual(handoff.stats(), { history: 2, pending: 0 });
});

test('out-of-order arrival still evaluates the directional event-time pair', () => {
  const scheduled = scheduler();
  const engine = new CorrelateEngine();
  engine.registerRule(learnedRule);
  let learnedPairs = 0;
  const handoff = new CrossEventCorrelationHandoff({
    schedule: scheduled.schedule,
    correlate: (current, history) => {
      learnedPairs += engine.correlateIncremental(current, history, new Date(NOW))
        .pairs.filter((pair) => pair.ruleId === learnedRule.id).length;
    },
  });

  handoff.offer(event('infra-first', 'infra', NOW));
  handoff.offer(event('weather-late', 'weather', NOW - 1_000));
  handoff.resume();
  scheduled.runAll();

  assert.equal(learnedPairs, 1);
});

test('deduplicates retained IDs and evaluates only current-to-history pairs', () => {
  const scheduled = scheduler();
  const calls: Array<{ current: string; history: string[] }> = [];
  const handoff = new CrossEventCorrelationHandoff({
    schedule: scheduled.schedule,
    correlate: (current, history) => {
      calls.push({ current: current.id, history: history.map((item) => item.id) });
    },
  });

  handoff.offer(event('a', 'weather', NOW - 2));
  handoff.offer(event('a', 'weather', NOW - 2));
  handoff.offer(event('b', 'infra', NOW - 1));
  handoff.offer(event('c', 'cyber', NOW));
  handoff.resume();
  scheduled.runAll();

  assert.deepEqual(calls, [
    { current: 'a', history: [] },
    { current: 'b', history: ['a'] },
    { current: 'c', history: ['a', 'b'] },
  ]);
  assert.deepEqual(handoff.stats(), { history: 3, pending: 0 });
});

test('expires old events and bounds retained plus pending events', () => {
  const scheduled = scheduler();
  const seenHistory: string[][] = [];
  const handoff = new CrossEventCorrelationHandoff({
    schedule: scheduled.schedule,
    correlate: (_current, history) => {
      seenHistory.push(history.map((item) => item.id));
    },
  });

  handoff.offer(event('expired', 'weather', NOW - CROSS_EVENT_HISTORY_WINDOW_MS - 1));
  for (let index = 0; index < CROSS_EVENT_HISTORY_LIMIT + 3; index += 1) {
    handoff.offer(event(`bounded-${index}`, 'weather', NOW + index));
  }

  assert.equal(handoff.stats().history + handoff.stats().pending, CROSS_EVENT_HISTORY_LIMIT);
  handoff.resume();
  scheduled.runAll();

  assert.equal(handoff.stats().history, CROSS_EVENT_HISTORY_LIMIT);
  assert.ok(seenHistory.every((ids) => !ids.includes('expired')));
  assert.ok(seenHistory.at(-1)?.includes('bounded-3'));
  assert.ok(!seenHistory.at(-1)?.includes('bounded-0'));
});

test('expiry removes a queued event before correlation work runs', () => {
  const scheduled = scheduler();
  const correlated: string[] = [];
  const handoff = new CrossEventCorrelationHandoff({
    schedule: scheduled.schedule,
    maxEvents: 10,
    correlate: (current) => { correlated.push(current.id); },
  });

  handoff.offer(event('too-old', 'weather', NOW - CROSS_EVENT_HISTORY_WINDOW_MS - 1));
  handoff.offer(event('current', 'infra', NOW));
  handoff.resume();
  scheduled.runAll();

  assert.deepEqual(correlated, ['current']);
  assert.deepEqual(handoff.stats(), { history: 1, pending: 0 });
});

test('rejects non-finite timestamps and stop cancels queued work', () => {
  const scheduled = scheduler();
  let calls = 0;
  const handoff = new CrossEventCorrelationHandoff({
    schedule: scheduled.schedule,
    correlate: () => { calls += 1; },
  });

  handoff.offer(event('invalid', 'weather', Number.NaN));
  handoff.offer(event('valid', 'weather'));
  handoff.resume();
  handoff.stop();
  scheduled.runAll();

  assert.equal(calls, 0);
  assert.deepEqual(handoff.stats(), { history: 0, pending: 0 });
});

test('incremental engine work is bounded to current-versus-history candidates', () => {
  let matcherCalls = 0;
  const engine = new CorrelateEngine();
  engine.registerRule({
    ...learnedRule,
    domains: [],
    matchFn: () => {
      matcherCalls += 1;
      return false;
    },
  });
  const history = Array.from({ length: CROSS_EVENT_HISTORY_LIMIT }, (_, index) => (
    event(`history-${index}`, 'weather', NOW - index)
  ));

  const result = engine.correlateIncremental(
    event('current', 'infra', NOW),
    history,
    new Date(NOW),
  );

  assert.equal(result.pairs.length, 0);
  assert.equal(result.observationsConsidered, CROSS_EVENT_HISTORY_LIMIT + 1);
  assert.equal(matcherCalls, CROSS_EVENT_HISTORY_LIMIT * 2);
});
