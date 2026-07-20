/**
 * Tests for src/services/cognition/superforecast-state.ts — on-demand
 * superforecast entry point (PR 6 slice + PR 13 activation).
 *
 * Coverage:
 *   1. Fresh run → result cached; getCachedSuperforecast returns it.
 *   2. Cache TTL — entries older than 15 min are not returned.
 *   3. In-flight dedupe — concurrent requests share one pipeline run.
 *   4. Shadow pair orientation — live = liveForecast(), shadow = pipeline
 *      probability, recorded under RUN_IDS.SUPERFORECAST.
 *   5. liveForecast undefined → no pair pushed (no NaN pollution).
 *   6. Pipeline errors propagate but don't poison the cache.
 *
 * Design: injectable run + liveForecast; injectable shadow service via
 * configureShadowRolloutForTests. No DOM, no real IDB/localStorage.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ShadowModeAlgorithmService } from '../../intelligence/shadow-mode.js';
import {
  initShadowRollout,
  resetShadowRolloutForTests,
  configureShadowRolloutForTests,
  RUN_IDS,
} from '../shadow-rollout.js';
import type { StorageLike } from '../shadow-rollout.js';
import {
  requestSuperforecast,
  getCachedSuperforecast,
  _resetSuperforecastStateForTests,
} from '../superforecast-state.js';
import type { SuperForecast } from '../superforecast.js';
import type { Hypothesis } from '../../analyst-loop.js';

let _idCounter = 0;

function makeHypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
  _idCounter += 1;
  return {
    id: `h-${_idCounter}`,
    kind: 'situation-escalation',
    statement: `Convoy movements near border crossing ${_idCounter}`,
    confidence: 0.65,
    risk: 'high',
    evidence: [
      { source: 'situation-engine', id: `sit-${_idCounter}`, label: `Signal ${_idCounter}` },
    ],
    timestamp: 1_750_000_000_000,
    region: 'Eastern Europe',
    ...overrides,
  };
}

function makeForecast(probability: number, hypothesisId: string): SuperForecast {
  return {
    hypothesisId,
    probability,
    estimates: [{ source: 'base-rate', p: probability, weight: 1 }],
    spread: 0,
    explanation: '[outside] test fixture',
    llmTier: 'deterministic-only',
  };
}

function makeStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
  };
}

function setupShadow(): ShadowModeAlgorithmService {
  resetShadowRolloutForTests();
  const svc = new ShadowModeAlgorithmService();
  configureShadowRolloutForTests({
    shadowService: svc,
    storage: makeStorage(),
    putMemoryFn: () => Promise.resolve(),
    clock: () => 1_750_000_000_000,
  });
  initShadowRollout();
  return svc;
}

describe('superforecast-state', () => {
  beforeEach(() => {
    _resetSuperforecastStateForTests();
    setupShadow();
  });

  it('caches a fresh run and serves it via getCachedSuperforecast', async () => {
    const h = makeHypothesis();
    let runs = 0;
    const result = await requestSuperforecast(h, {
      run: (hyp) => { runs += 1; return Promise.resolve(makeForecast(0.42, hyp.id)); },
      liveForecast: () => 0.3,
    });
    assert.equal(result.probability, 0.42);
    assert.equal(runs, 1);
    assert.equal(getCachedSuperforecast(h)?.probability, 0.42);

    // Second request within TTL reuses the cache — no second pipeline run.
    const again = await requestSuperforecast(h, {
      run: () => { runs += 1; return Promise.resolve(makeForecast(0.99, h.id)); },
      liveForecast: () => 0.3,
    });
    assert.equal(again.probability, 0.42);
    assert.equal(runs, 1);
  });

  it('expires cached entries after the 15-min TTL', async () => {
    const h = makeHypothesis();
    let t = 1_750_000_000_000;
    const now = () => t;
    await requestSuperforecast(h, {
      run: (hyp) => Promise.resolve(makeForecast(0.42, hyp.id)),
      liveForecast: () => undefined,
      now,
    });
    assert.ok(getCachedSuperforecast(h, now));
    t += 15 * 60 * 1000 + 1;
    assert.equal(getCachedSuperforecast(h, now), null);
  });

  it('dedupes concurrent in-flight requests for the same signature', async () => {
    const h = makeHypothesis();
    let runs = 0;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => { release = r; });
    const deps = {
      run: async (hyp: Hypothesis) => {
        runs += 1;
        await gate;
        return makeForecast(0.5, hyp.id);
      },
      liveForecast: () => 0.4,
    };
    const p1 = requestSuperforecast(h, deps);
    const p2 = requestSuperforecast(h, deps);
    release!();
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(runs, 1);
    assert.equal(r1.probability, 0.5);
    assert.equal(r2.probability, 0.5);
  });

  it('pushes a shadow pair with live=liveForecast and shadow=pipeline probability', async () => {
    const svc = setupShadow();
    const h = makeHypothesis();
    await requestSuperforecast(h, {
      run: (hyp) => Promise.resolve(makeForecast(0.72, hyp.id)),
      liveForecast: () => 0.31,
    });
    const pairs = svc.getComparisons(RUN_IDS.SUPERFORECAST);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0]!.liveOutput, 0.31);
    assert.equal(pairs[0]!.shadowOutput, 0.72);
  });

  it('pushes no pair when the live forecast is unavailable', async () => {
    const svc = setupShadow();
    const h = makeHypothesis();
    await requestSuperforecast(h, {
      run: (hyp) => Promise.resolve(makeForecast(0.72, hyp.id)),
      liveForecast: () => undefined,
    });
    assert.equal(svc.getComparisons(RUN_IDS.SUPERFORECAST).length, 0);
  });

  it('propagates pipeline errors without poisoning the cache', async () => {
    const h = makeHypothesis();
    await assert.rejects(
      requestSuperforecast(h, {
        run: () => Promise.reject(new Error('pipeline down')),
        liveForecast: () => 0.5,
      }),
      /pipeline down/,
    );
    assert.equal(getCachedSuperforecast(h), null);
    // A retry after the failure runs the pipeline again.
    const retry = await requestSuperforecast(h, {
      run: (hyp) => Promise.resolve(makeForecast(0.6, hyp.id)),
      liveForecast: () => 0.5,
    });
    assert.equal(retry.probability, 0.6);
  });
});
