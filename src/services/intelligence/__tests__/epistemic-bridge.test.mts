import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── localStorage shim ────────────────────────────────────────────────────────
const mem = new Map<string, string>();
(globalThis as unknown as Record<string, unknown>).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
};

import {
  startEpistemicBridge,
  stopEpistemicBridge,
  __internals,
} from '../epistemic-bridge.js';
import type { EpistemicBridgeOptions } from '../epistemic-bridge.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSituation(overrides: Partial<{
  id: string;
  domain: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'active' | 'watching' | 'resolved';
  confidence: number;
  summary: string;
  updatedAt: Date;
  observations: unknown[];
}> = {}) {
  return {
    id: 'sit-1',
    domain: 'weather',
    severity: 'moderate' as 'low' | 'medium' | 'high' | 'critical',
    status: 'active' as const,
    confidence: 0.75,
    summary: 'A test situation',
    updatedAt: new Date(1000),
    observations: [],
    ...overrides,
  };
}

function makeObs(overrides: Partial<{
  id: string;
  domain: string;
  severity: string;
  timestamp: number;
  sourceId: string;
  tags: string[];
}> = {}) {
  return {
    id: 'obs-1',
    domain: 'weather',
    severity: 'HIGH',
    timestamp: 1000,
    sourceId: 'src-1',
    tags: [],
    ...overrides,
  };
}

interface RecordedCall { id: string; data: Record<string, unknown> }

function makeOptions(
  situations: ReturnType<typeof makeSituation>[],
  clockMs = 10_000,
): {
  opts: EpistemicBridgeOptions;
  estimateCalls: unknown[];
  generateCalls: unknown[];
  scanSituationCalls: unknown[];
  scanObsCalls: unknown[];
  recorded: RecordedCall[];
  storeListener: ((situations: unknown[]) => void) | null;
  busListener: ((event: unknown) => void) | null;
  tick: (newSituations?: ReturnType<typeof makeSituation>[], nowMs?: number) => void;
  fire: (event: unknown) => void;
  advanceClock: (ms: number) => void;
} {
  let clockVal = clockMs;
  let storedListener: ((situations: unknown[]) => void) | null = null;
  let busListener: ((e: unknown) => void) | null = null;
  const estimateCalls: unknown[] = [];
  const generateCalls: unknown[] = [];
  const scanSituationCalls: unknown[] = [];
  const scanObsCalls: unknown[] = [];
  const recorded: RecordedCall[] = [];

  const fakeStore = {
    subscribeView: (l: (situations: unknown[]) => void) => {
      storedListener = l;
      return () => { storedListener = null; };
    },
    list: () => situations,
  };

  const fakeMeta = {
    estimate: (input: unknown) => {
      estimateCalls.push(input);
      return {
        targetId: (input as { targetId: string }).targetId,
        metaConfidence: 0.8,
        reliability: 'high' as const,
        sampleSize: 3,
      };
    },
  };

  const fakeCounterfactuals = {
    generate: (...args: unknown[]) => {
      generateCalls.push(args);
      return { counterfactuals: [1, 2, 3], openCount: 3, highPlausibilityCount: 2 };
    },
  };

  const fakeBias = {
    scanSituation: (...args: unknown[]) => {
      scanSituationCalls.push(args);
      return [];
    },
    scanObservation: (e: unknown) => {
      scanObsCalls.push(e);
      return [];
    },
  };

  const opts: EpistemicBridgeOptions = {
    store: fakeStore as unknown as import('../epistemic-bridge.js').EpistemicBridgeOptions['store'],
    meta: fakeMeta as unknown as import('../epistemic-bridge.js').EpistemicBridgeOptions['meta'],
    counterfactuals: fakeCounterfactuals as unknown as import('../epistemic-bridge.js').EpistemicBridgeOptions['counterfactuals'],
    bias: fakeBias as unknown as import('../epistemic-bridge.js').EpistemicBridgeOptions['bias'],
    observationBus: (l) => {
      busListener = l;
      return () => { busListener = null; };
    },
    clock: () => clockVal,
    recorder: ((algId: string, data: Record<string, unknown>) => {
      recorded.push({ id: algId, data });
    }) as unknown as EpistemicBridgeOptions['recorder'],
  };

  return {
    opts,
    estimateCalls,
    generateCalls,
    scanSituationCalls,
    scanObsCalls,
    recorded,
    get storeListener() { return storedListener; },
    get busListener() { return busListener; },
    tick: (newSits = situations, nowMs = clockVal) => {
      clockVal = nowMs;
      storedListener?.(newSits);
    },
    fire: (e: unknown) => { busListener?.(e); },
    advanceClock: (ms: number) => { clockVal += ms; },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('epistemic-bridge', () => {
  beforeEach(() => {
    stopEpistemicBridge();
    mem.clear();
  });

  it('first-seen situation triggers estimate() with correct targetId and reportedConfidence', () => {
    const sit = makeSituation({ id: 'sit-x', confidence: 0.65 });
    const ctx = makeOptions([sit]);
    startEpistemicBridge(ctx.opts);
    ctx.tick();
    assert.equal(ctx.estimateCalls.length, 1);
    const call = ctx.estimateCalls[0] as { targetId: string; reportedConfidence: number; targetType: string };
    assert.equal(call.targetId, 'sit-x');
    assert.equal(call.reportedConfidence, 0.65);
    assert.equal(call.targetType, 'situation');
  });

  it('high-severity situation triggers generate(); moderate/medium does not', () => {
    const highSit = makeSituation({ id: 'high-1', severity: 'high', summary: 'High storm' });
    const modSit = makeSituation({ id: 'mod-1', severity: 'medium' as 'low' | 'medium' | 'high' | 'critical' });
    const ctx = makeOptions([highSit, modSit]);
    startEpistemicBridge(ctx.opts);
    ctx.tick();
    assert.equal(ctx.generateCalls.length, 1);
    const args = ctx.generateCalls[0] as string[];
    assert.equal(args[0], 'high-1');
  });

  it('critical-severity situation triggers generate()', () => {
    const sit = makeSituation({ id: 'crit-1', severity: 'critical' });
    const ctx = makeOptions([sit]);
    startEpistemicBridge(ctx.opts);
    ctx.tick();
    assert.equal(ctx.generateCalls.length, 1);
  });

  it('first-seen situation triggers scanSituation()', () => {
    const sit = makeSituation({ id: 'sit-1', domain: 'cyber' });
    const ctx = makeOptions([sit]);
    startEpistemicBridge(ctx.opts);
    ctx.tick();
    assert.equal(ctx.scanSituationCalls.length, 1);
  });

  it('repeat update without escalation does NOT call scanSituation() again', () => {
    const sit = makeSituation({ id: 'sit-1', severity: 'medium' as 'low' | 'medium' | 'high' | 'critical', updatedAt: new Date(1000) });
    const ctx = makeOptions([sit]);
    startEpistemicBridge(ctx.opts);
    ctx.tick([sit], 10_000);
    assert.equal(ctx.scanSituationCalls.length, 1);
    // Second tick — updatedAt unchanged, no escalation → no second scan
    ctx.tick([sit], 10_001);
    assert.equal(ctx.scanSituationCalls.length, 1);
  });

  it('severity escalation inside throttle window forces re-process with scanSituation', () => {
    const low = makeSituation({ id: 'sit-1', severity: 'low', updatedAt: new Date(1000) });
    const high = makeSituation({ id: 'sit-1', severity: 'high', updatedAt: new Date(1001) });
    const ctx = makeOptions([low]);
    startEpistemicBridge(ctx.opts);
    ctx.tick([low], 10_000); // first-seen
    assert.equal(ctx.scanSituationCalls.length, 1);
    // escalate before REPROCESS_MIN_MS
    ctx.tick([high], 10_500);
    assert.equal(ctx.scanSituationCalls.length, 2);
  });

  it('update within REPROCESS_MIN_MS does not trigger second estimate()', () => {
    const sit = makeSituation({ id: 'sit-1', updatedAt: new Date(1000) });
    const ctx = makeOptions([sit], 10_000);
    startEpistemicBridge(ctx.opts);
    ctx.tick([sit], 10_000); // first-seen → 1 estimate
    const sit2 = { ...sit, updatedAt: new Date(2000) };
    ctx.tick([sit2 as ReturnType<typeof makeSituation>], 10_000 + __internals.REPROCESS_MIN_MS - 1);
    assert.equal(ctx.estimateCalls.length, 1);
  });

  it('update after REPROCESS_MIN_MS triggers second estimate() with priorEstimates', () => {
    const sit = makeSituation({ id: 'sit-1', confidence: 0.7, updatedAt: new Date(1000) });
    const ctx = makeOptions([sit], 10_000);
    startEpistemicBridge(ctx.opts);
    ctx.tick([sit], 10_000); // first-seen
    const sit2 = { ...sit, confidence: 0.8, updatedAt: new Date(5000) };
    ctx.tick([sit2 as ReturnType<typeof makeSituation>], 10_000 + __internals.REPROCESS_MIN_MS + 1);
    assert.equal(ctx.estimateCalls.length, 2);
    const second = ctx.estimateCalls[1] as { priorEstimates: number[] };
    assert.ok(second.priorEstimates.includes(0.7));
  });

  it('CRITICAL observation on the bus triggers scanObservation()', () => {
    const ctx = makeOptions([]);
    startEpistemicBridge(ctx.opts);
    ctx.fire(makeObs({ severity: 'CRITICAL' }));
    assert.equal(ctx.scanObsCalls.length, 1);
  });

  it('non-CRITICAL observation does NOT trigger scanObservation()', () => {
    const ctx = makeOptions([]);
    startEpistemicBridge(ctx.opts);
    ctx.fire(makeObs({ severity: 'HIGH' }));
    ctx.fire(makeObs({ severity: 'MEDIUM' }));
    ctx.fire(makeObs({ severity: 'LOW' }));
    assert.equal(ctx.scanObsCalls.length, 0);
  });

  it('recorder receives meta-confidence, counterfactual-reasoning, cognitive-bias-detector evaluations', () => {
    const sit = makeSituation({ id: 'sit-1', severity: 'high' });
    const ctx = makeOptions([sit]);
    startEpistemicBridge(ctx.opts);
    ctx.tick();
    const ids = ctx.recorded.map((r) => r.id);
    assert.ok(ids.includes('meta-confidence'), 'meta-confidence not recorded');
    assert.ok(ids.includes('counterfactual-reasoning'), 'counterfactual-reasoning not recorded');
    assert.ok(ids.includes('cognitive-bias-detector'), 'cognitive-bias-detector not recorded');
  });

  it('each recorder call has durationMs and score populated', () => {
    const sit = makeSituation({ id: 'sit-1', severity: 'critical' });
    const ctx = makeOptions([sit]);
    startEpistemicBridge(ctx.opts);
    ctx.tick();
    for (const r of ctx.recorded) {
      assert.ok(typeof r.data.durationMs === 'number', `durationMs missing for ${r.id}`);
      assert.ok(typeof r.data.score === 'number', `score missing for ${r.id}`);
    }
  });

  it('a throwing meta service does not prevent bias scan from running', () => {
    const sit = makeSituation({ id: 'sit-1' });
    const ctx = makeOptions([sit]);
    (ctx.opts.meta as unknown as { estimate: () => never }).estimate = () => { throw new Error('meta failed'); };
    startEpistemicBridge(ctx.opts);
    ctx.tick();
    assert.equal(ctx.scanSituationCalls.length, 1);
  });

  it('a throwing counterfactual service does not prevent bias scan from running', () => {
    const sit = makeSituation({ id: 'sit-1', severity: 'high' });
    const ctx = makeOptions([sit]);
    (ctx.opts.counterfactuals as unknown as { generate: () => never }).generate = () => { throw new Error('cf failed'); };
    startEpistemicBridge(ctx.opts);
    ctx.tick();
    assert.equal(ctx.scanSituationCalls.length, 1);
  });

  it('a throwing bias service does not prevent meta estimate from running', () => {
    const sit = makeSituation({ id: 'sit-1' });
    const ctx = makeOptions([sit]);
    (ctx.opts.bias as unknown as { scanSituation: () => never }).scanSituation = () => { throw new Error('bias failed'); };
    startEpistemicBridge(ctx.opts);
    ctx.tick();
    assert.equal(ctx.estimateCalls.length, 1);
  });

  it('double startEpistemicBridge() returns same stop function and subscribes only once', () => {
    const sit = makeSituation();
    const ctx = makeOptions([sit]);
    const stop1 = startEpistemicBridge(ctx.opts);
    const stop2 = startEpistemicBridge(ctx.opts);
    assert.strictEqual(stop1, stop2);
    ctx.tick();
    // Only one subscription → each service called once, not twice
    assert.equal(ctx.estimateCalls.length, 1);
  });

  it('stopEpistemicBridge() prevents further calls after stop', () => {
    const sit = makeSituation();
    const ctx = makeOptions([sit]);
    startEpistemicBridge(ctx.opts);
    ctx.tick();
    assert.equal(ctx.estimateCalls.length, 1);
    stopEpistemicBridge();
    ctx.tick();
    assert.equal(ctx.estimateCalls.length, 1);
  });

  it('observations from situation are passed to estimate()', () => {
    const obs = makeObs({ id: 'obs-a', domain: 'finance' });
    const sit = makeSituation({ id: 'sit-1', observations: [obs] });
    const ctx = makeOptions([sit as ReturnType<typeof makeSituation>]);
    startEpistemicBridge(ctx.opts);
    ctx.tick();
    const input = ctx.estimateCalls[0] as { observations: unknown[] };
    assert.equal(input.observations.length, 1);
    assert.equal((input.observations[0] as { id: string }).id, 'obs-a');
  });

  it('corroboratingDomainCount in scanSituation context counts distinct non-situation domains from observations', () => {
    const obs1 = makeObs({ id: 'o1', domain: 'finance' });
    const obs2 = makeObs({ id: 'o2', domain: 'finance' }); // same domain, should not double-count
    const obs3 = makeObs({ id: 'o3', domain: 'cyber' });
    const obs4 = makeObs({ id: 'o4', domain: 'weather' }); // same as situation domain → excluded
    const sit = makeSituation({ id: 'sit-1', domain: 'weather', observations: [obs1, obs2, obs3, obs4] });
    const ctx = makeOptions([sit as ReturnType<typeof makeSituation>]);
    startEpistemicBridge(ctx.opts);
    ctx.tick();
    const [, ctxArg] = ctx.scanSituationCalls[0] as [unknown, { corroboratingDomainCount: number }];
    assert.equal(ctxArg.corroboratingDomainCount, 2); // finance + cyber (not weather)
  });
});
