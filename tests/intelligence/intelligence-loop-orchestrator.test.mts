/**
 * Tests for IntelligenceLoopOrchestratorService.
 *
 * Run with: npx tsx --test tests/intelligence/intelligence-loop-orchestrator.test.mts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IntelligenceLoopOrchestratorService,
  MAX_RUNS,
  PIPELINE_STAGES,
  STORAGE_KEY,
  __internals,
  __resetIntelligenceLoopOrchestratorSingleton,
  getIntelligenceLoopOrchestrator,
  type OrchestratorStorage,
  type PipelineRunners,
} from '../../src/services/intelligence/intelligence-loop-orchestrator.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-types.ts';

const NOW = 1_745_000_000_000;

function makeStorage(): { storage: OrchestratorStorage; map: Map<string, string> } {
  const map = new Map<string, string>();
  const storage: OrchestratorStorage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
  return { storage, map };
}

function obs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'obs-1',
    domain: 'cyber',
    eventType: 'CVE-mass-exploit',
    title: 'CVE under active mass exploitation',
    severity: 7,
    occurredAt: NOW,
    entities: ['CVE-2026-1234'],
    sourceIds: ['nvd'],
    active: true,
    ...overrides,
  };
}

function tickingClock(): () => number {
  let t = NOW;
  return () => {
    t += 1;
    return t;
  };
}

function freshService(runners: PipelineRunners = {}, clock = () => NOW): IntelligenceLoopOrchestratorService {
  const { storage } = makeStorage();
  return new IntelligenceLoopOrchestratorService(storage, clock, runners);
}

function allRunners(): { runners: PipelineRunners; calls: Record<string, number> } {
  const calls: Record<string, number> = {
    normalize: 0, correlate: 0, explain: 0, prioritize: 0, act: 0, learn: 0,
  };
  const runners: PipelineRunners = {
    normalize: (o) => { calls.normalize! += 1; return o; },
    correlate: () => { calls.correlate! += 1; },
    explain: () => { calls.explain! += 1; },
    prioritize: () => { calls.prioritize! += 1; },
    act: () => { calls.act! += 1; },
    learn: () => { calls.learn! += 1; },
  };
  return { runners, calls };
}

// ── run() basics ─────────────────────────────────────────────────────

test('run executes every stage in PIPELINE_STAGES order', () => {
  const order: string[] = [];
  const runners: PipelineRunners = {
    normalize: (o) => { order.push('normalize'); return o; },
    correlate: () => { order.push('correlate'); },
    explain: () => { order.push('explain'); },
    prioritize: () => { order.push('prioritize'); },
    act: () => { order.push('act'); },
    learn: () => { order.push('learn'); },
  };
  freshService(runners).run(obs());
  assert.deepEqual(order, [...PIPELINE_STAGES]);
});

test('run produces a PipelineRun with one StageResult per stage', () => {
  const { runners } = allRunners();
  const run = freshService(runners).run(obs());
  assert.equal(run.stages.length, PIPELINE_STAGES.length);
  assert.deepEqual(run.stages.map((s) => s.stage), [...PIPELINE_STAGES]);
});

test('run with no runners wired marks every stage as skipped + overallSuccess=false', () => {
  const run = freshService({}).run(obs());
  assert.ok(run.stages.every((s) => s.outputSummary === 'skipped'));
  assert.equal(run.overallSuccess, false);
});

test('run populates observationId, startedAt, completedAt, totalDurationMs', () => {
  const clock = tickingClock();
  const { runners } = allRunners();
  const { storage } = makeStorage();
  const svc = new IntelligenceLoopOrchestratorService(storage, clock, runners);
  const run = svc.run(obs({ id: 'obs-42' }));
  assert.equal(run.observationId, 'obs-42');
  assert.ok(run.startedAt > 0);
  assert.ok(run.completedAt >= run.startedAt);
});

test('run totalDurationMs equals sum of per-stage durations', () => {
  const clock = tickingClock();
  const { runners } = allRunners();
  const { storage } = makeStorage();
  const svc = new IntelligenceLoopOrchestratorService(storage, clock, runners);
  const run = svc.run(obs());
  const stageSum = run.stages.reduce((sum, s) => sum + s.durationMs, 0);
  assert.equal(run.totalDurationMs, stageSum);
});

test('run id is stable per (observationId, startedAt) combination', () => {
  const { storage } = makeStorage();
  const svc = new IntelligenceLoopOrchestratorService(storage, () => 1234, allRunners().runners);
  const run = svc.run(obs({ id: 'obs-X' }));
  assert.equal(run.id, 'run-1234-obs-X');
});

// ── Error handling ───────────────────────────────────────────────────

test('a throwing stage is caught — marked failed, but pipeline continues', () => {
  let learnCalled = false;
  const runners: PipelineRunners = {
    normalize: (o) => o,
    correlate: () => { throw new Error('correlate boom'); },
    explain: () => {},
    prioritize: () => {},
    act: () => {},
    learn: () => { learnCalled = true; },
  };
  const run = freshService(runners).run(obs());
  const correlate = run.stages.find((s) => s.stage === 'correlate')!;
  assert.equal(correlate.success, false);
  assert.equal(correlate.error, 'correlate boom');
  assert.ok(correlate.outputSummary.includes('failed'));
  assert.equal(learnCalled, true);
});

test('overallSuccess=false when any executed stage fails', () => {
  const runners: PipelineRunners = {
    normalize: (o) => o,
    correlate: () => {},
    explain: () => { throw new Error('explain boom'); },
    prioritize: () => {},
    act: () => {},
    learn: () => {},
  };
  const run = freshService(runners).run(obs());
  assert.equal(run.overallSuccess, false);
});

test('overallSuccess=true when every executed stage succeeds', () => {
  const { runners } = allRunners();
  const run = freshService(runners).run(obs());
  assert.equal(run.overallSuccess, true);
});

test('non-Error thrown values still produce a recorded failure', () => {
  const runners: PipelineRunners = {
    normalize: (o) => o,
    correlate: () => {

      throw 'string-error';
    },
    explain: () => {},
    prioritize: () => {},
    act: () => {},
    learn: () => {},
  };
  const run = freshService(runners).run(obs());
  const correlate = run.stages.find((s) => s.stage === 'correlate')!;
  assert.equal(correlate.success, false);
  assert.equal(correlate.error, 'string-error');
});

// ── normalize stage swaps event into downstream ──────────────────────

test('normalize can rewrite the observation; downstream stages see the rewritten event', () => {
  const seen: ObservationEvent[] = [];
  const runners: PipelineRunners = {
    normalize: (o) => ({ ...o, domain: 'rewritten', severity: 9 }),
    correlate: (o) => { seen.push(o); },
    explain: (o) => { seen.push(o); },
    prioritize: () => {},
    act: () => {},
    learn: () => {},
  };
  freshService(runners).run(obs({ domain: 'cyber', severity: 5 }));
  assert.ok(seen.length >= 1);
  assert.equal(seen[0]!.domain, 'rewritten');
  assert.equal(seen[0]!.severity, 9);
});

// ── normalize outputSummary uses normalized event shape ──────────────

test('normalize stage outputSummary reflects normalized event', () => {
  const runners: PipelineRunners = {
    normalize: (o) => ({ ...o, domain: 'after-norm' }),
  };
  const run = freshService(runners).run(obs());
  const normalize = run.stages.find((s) => s.stage === 'normalize')!;
  assert.ok(normalize.outputSummary.includes('after-norm'));
});

// ── getHistory() ─────────────────────────────────────────────────────

test('getHistory returns runs in LIFO order', () => {
  let t = NOW;
  const { storage } = makeStorage();
  const svc = new IntelligenceLoopOrchestratorService(storage, () => t, allRunners().runners);
  for (let i = 0; i < 3; i++) {
    svc.run(obs({ id: `obs-${i}` }));
    t += 1000;
  }
  const history = svc.getHistory();
  assert.equal(history.length, 3);
  // LIFO — newest first.
  assert.equal(history[0]!.observationId, 'obs-2');
  assert.equal(history[2]!.observationId, 'obs-0');
});

test('getHistory limit caps the result count', () => {
  let t = NOW;
  const { storage } = makeStorage();
  const svc = new IntelligenceLoopOrchestratorService(storage, () => t, allRunners().runners);
  for (let i = 0; i < 5; i++) {
    svc.run(obs({ id: `obs-${i}` }));
    t += 1;
  }
  assert.equal(svc.getHistory(2).length, 2);
});

test('getHistory returns defensive copies — mutating result does not affect store', () => {
  const { runners } = allRunners();
  const svc = freshService(runners);
  svc.run(obs());
  const history = svc.getHistory();
  history[0]!.overallSuccess = false;
  history[0]!.stages[0]!.success = false;
  const again = svc.getHistory();
  assert.equal(again[0]!.overallSuccess, true);
  assert.equal(again[0]!.stages[0]!.success, true);
});

// ── getStats() ───────────────────────────────────────────────────────

test('getStats returns zero stats on an empty history', () => {
  const svc = freshService();
  const stats = svc.getStats();
  assert.equal(stats.totalRuns, 0);
  assert.equal(stats.successRate, 0);
  assert.equal(stats.avgDurationMs, 0);
  for (const stage of PIPELINE_STAGES) assert.equal(stats.stageSuccessRates[stage], 0);
});

test('getStats successRate = successes / total', () => {
  const goodRunners = allRunners().runners;
  const badRunners: PipelineRunners = {
    normalize: (o) => o,
    correlate: () => { throw new Error('x'); },
    explain: () => {},
    prioritize: () => {},
    act: () => {},
    learn: () => {},
  };
  const { storage } = makeStorage();
  const svc = new IntelligenceLoopOrchestratorService(storage, () => NOW, goodRunners);
  svc.run(obs({ id: '1' }));
  svc.run(obs({ id: '2' }));
  svc.setRunners(badRunners);
  svc.run(obs({ id: '3' }));
  const stats = svc.getStats();
  assert.equal(stats.totalRuns, 3);
  assert.ok(Math.abs(stats.successRate - 2 / 3) < 1e-9);
});

test('getStats stageSuccessRates: per-stage successes / executed', () => {
  // 3 runs; correlate fails in 1 of them, others always succeed.
  const callCount = { correlate: 0 };
  const runners: PipelineRunners = {
    normalize: (o) => o,
    correlate: () => {
      callCount.correlate += 1;
      if (callCount.correlate === 2) throw new Error('boom');
    },
    explain: () => {},
    prioritize: () => {},
    act: () => {},
    learn: () => {},
  };
  const svc = freshService(runners);
  svc.run(obs({ id: '1' }));
  svc.run(obs({ id: '2' }));
  svc.run(obs({ id: '3' }));
  const stats = svc.getStats();
  // correlate: 2 of 3 succeeded
  assert.ok(Math.abs(stats.stageSuccessRates.correlate - 2 / 3) < 1e-9);
  // explain, act, learn: 3 of 3 succeeded
  assert.equal(stats.stageSuccessRates.explain, 1);
});

test('getStats skips "skipped" stages from per-stage rates (denominator = executed only)', () => {
  // Only normalize is wired — others should report rate=0 (zero
  // executed, so we cannot claim any success rate).
  const runners: PipelineRunners = { normalize: (o) => o };
  const svc = freshService(runners);
  svc.run(obs());
  const stats = svc.getStats();
  assert.equal(stats.stageSuccessRates.normalize, 1);
  assert.equal(stats.stageSuccessRates.correlate, 0);
  assert.equal(stats.stageSuccessRates.explain, 0);
});

test('getStats avgDurationMs is the mean across runs', () => {
  let t = NOW;
  const { storage } = makeStorage();
  const svc = new IntelligenceLoopOrchestratorService(storage, () => t++, allRunners().runners);
  for (let i = 0; i < 3; i++) svc.run(obs({ id: `obs-${i}` }));
  const stats = svc.getStats();
  // Each run runs 6 stages with ticking clock; each stage has a fixed
  // (start, end) tick pair so duration is deterministic-ish.
  assert.ok(stats.avgDurationMs > 0);
});

// ── Ring buffer ──────────────────────────────────────────────────────

test('ring buffer caps history at MAX_RUNS', () => {
  let t = NOW;
  const { storage } = makeStorage();
  const svc = new IntelligenceLoopOrchestratorService(storage, () => t, allRunners().runners);
  for (let i = 0; i < MAX_RUNS + 10; i++) {
    svc.run(obs({ id: `obs-${i}` }));
    t += 1;
  }
  assert.equal(svc.getHistory().length, MAX_RUNS);
});

// ── subscribe() ──────────────────────────────────────────────────────

test('subscribe fires after each completed run', () => {
  const svc = freshService(allRunners().runners);
  let fires = 0;
  svc.subscribe(() => { fires += 1; });
  svc.run(obs({ id: '1' }));
  svc.run(obs({ id: '2' }));
  assert.equal(fires, 2);
});

test('subscribe unsubscribe stops further fires', () => {
  const svc = freshService(allRunners().runners);
  let fires = 0;
  const off = svc.subscribe(() => { fires += 1; });
  svc.run(obs());
  off();
  svc.run(obs());
  assert.equal(fires, 1);
});

test('subscribe listener exception is isolated', () => {
  const svc = freshService(allRunners().runners);
  let goodFires = 0;
  svc.subscribe(() => { throw new Error('boom'); });
  svc.subscribe(() => { goodFires += 1; });
  svc.run(obs());
  assert.equal(goodFires, 1);
});

// ── Persistence ──────────────────────────────────────────────────────

test('history survives across instances via storage', () => {
  const { storage } = makeStorage();
  const a = new IntelligenceLoopOrchestratorService(storage, () => NOW, allRunners().runners);
  a.run(obs({ id: '1' }));
  a.run(obs({ id: '2' }));
  const b = new IntelligenceLoopOrchestratorService(storage, () => NOW, allRunners().runners);
  assert.equal(b.getHistory().length, 2);
});

test('persistence key is wm-pipeline-runs', () => {
  const { storage, map } = makeStorage();
  const svc = new IntelligenceLoopOrchestratorService(storage, () => NOW, allRunners().runners);
  svc.run(obs());
  assert.ok(map.has(STORAGE_KEY));
  assert.equal(STORAGE_KEY, 'wm-pipeline-runs');
});

test('corrupt persisted blob does not crash hydrate', () => {
  const { storage } = makeStorage();
  storage.setItem(STORAGE_KEY, 'not-json');
  const svc = new IntelligenceLoopOrchestratorService(storage, () => NOW, allRunners().runners);
  assert.equal(svc.getHistory().length, 0);
});

test('non-array persisted blob is ignored without crash', () => {
  const { storage } = makeStorage();
  storage.setItem(STORAGE_KEY, '{"weird":"shape"}');
  const svc = new IntelligenceLoopOrchestratorService(storage, () => NOW, allRunners().runners);
  assert.equal(svc.getHistory().length, 0);
});

// ── setRunners() ─────────────────────────────────────────────────────

test('setRunners swaps the runner set for subsequent runs', () => {
  const svc = freshService({});
  let r1 = svc.run(obs());
  assert.ok(r1.stages.every((s) => s.outputSummary === 'skipped'));
  svc.setRunners(allRunners().runners);
  let r2 = svc.run(obs({ id: '2' }));
  assert.ok(r2.stages.every((s) => s.outputSummary !== 'skipped'));
});

// ── Singleton ────────────────────────────────────────────────────────

test('getIntelligenceLoopOrchestrator returns a stable singleton', () => {
  __resetIntelligenceLoopOrchestratorSingleton();
  const a = getIntelligenceLoopOrchestrator();
  const b = getIntelligenceLoopOrchestrator();
  assert.equal(a, b);
  __resetIntelligenceLoopOrchestratorSingleton();
});

// ── Internals ────────────────────────────────────────────────────────

test('internals.summarizeEvent emits domain/eventType + severity', () => {
  const s = __internals.summarizeEvent(obs({ domain: 'maritime', eventType: 'choke-block', severity: 8 }));
  assert.ok(s.includes('maritime'));
  assert.ok(s.includes('choke-block'));
  assert.ok(s.includes('sev=8'));
});

test('internals.makeRunId combines startedAt and observationId', () => {
  assert.equal(__internals.makeRunId('obs-X', 1234), 'run-1234-obs-X');
});
