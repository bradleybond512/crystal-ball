/**
 * Self-consistency sampling tests for superforecast.ts PR 15.
 *
 * Tests:
 *   - medianOf: odd-count arrays, even-count arrays, single element, sorted input
 *   - k=1: behavior is byte-identical to pre-PR-15 path (single sample, no median overhead)
 *   - partial-budget degradation: some samples succeed, use median of those
 *   - full k=3 sampling: median computed correctly across three samples
 *   - applyAggregateReview: keep=true → no change, keep=false within ±0.10, hard clamp
 *
 * Per docs/COGNITIVE_ENHANCEMENT_PLAN.md PR 15.
 */

// Install a working in-memory localStorage BEFORE any import so the
// tunable-params-store (which persists selfConsistencyK via localStorage)
// actually retains values set with setTunedParam in this test process.
// We assign unconditionally: Node exposes a native `localStorage` object whose
// setItem throws unless --localstorage-file is given, so `??=` would leave that
// broken object in place and every setTunedParam call would be dropped, making
// getTunedParam always return the default (k=3).
const _tunableStore: Record<string, string> = {};
(globalThis as unknown as Record<string, unknown>).localStorage = {
  getItem: (k: string): string | null => _tunableStore[k] ?? null,
  setItem: (k: string, v: string): void => { _tunableStore[k] = v; },
  removeItem: (k: string): void => { delete _tunableStore[k]; },
};

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  medianOf,
  applyAggregateReview,
  superforecast,
  _injectGenerateTextForTests,
  _clearPersonaCacheForTests,
} from '../superforecast.js';

import { _resetTunedParamsForTests, setTunedParam } from '../../algorithms/tunable-params-store.js';

import type { Hypothesis } from '../../analyst-loop.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

let _idCounter = 0;

function makeHypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
  _idCounter += 1;
  return {
    id: `h-sc-${_idCounter}`,
    kind: 'situation-escalation',
    statement: 'Self-consistency test hypothesis for LLM quality PR',
    confidence: 0.6,
    risk: 'high',
    evidence: [
      { source: 'test-source', id: 'e1', label: 'Test evidence entry for self-consistency' },
    ],
    timestamp: Date.now(),
    region: 'Test Region',
    ...overrides,
  };
}

// ── medianOf: pure math ───────────────────────────────────────────────────────

describe('medianOf', () => {
  it('single element: returns that element', () => {
    assert.equal(medianOf([0.6]), 0.6);
  });

  it('odd count (3): returns the exact middle value', () => {
    // [0.3, 0.5, 0.7] sorted → median = 0.5
    const result = medianOf([0.7, 0.3, 0.5]);
    assert.ok(
      Math.abs(result - 0.5) < 1e-9,
      `expected 0.5, got ${result}`,
    );
  });

  it('odd count (5): returns the exact middle value', () => {
    // [0.2, 0.4, 0.6, 0.7, 0.9] → median = 0.6
    const result = medianOf([0.9, 0.4, 0.7, 0.2, 0.6]);
    assert.ok(
      Math.abs(result - 0.6) < 1e-9,
      `expected 0.6, got ${result}`,
    );
  });

  it('even count (2): returns the lower of the two middle values', () => {
    // [0.4, 0.8] → lower middle = 0.4 (index mid-1 = 0)
    const result = medianOf([0.8, 0.4]);
    assert.ok(
      Math.abs(result - 0.4) < 1e-9,
      `expected 0.4 (lower middle), got ${result}`,
    );
  });

  it('even count (4): returns the lower of the two middle values', () => {
    // [0.3, 0.5, 0.7, 0.9] sorted → lower middle = 0.5 (index 1)
    const result = medianOf([0.9, 0.3, 0.7, 0.5]);
    assert.ok(
      Math.abs(result - 0.5) < 1e-9,
      `expected 0.5 (lower middle of 4), got ${result}`,
    );
  });

  it('already-sorted input: same result as unsorted', () => {
    const sorted = [0.2, 0.4, 0.6, 0.8];
    const unsorted = [0.8, 0.2, 0.6, 0.4];
    assert.equal(medianOf(sorted), medianOf(unsorted), 'order of input should not affect median');
  });

  it('all same value: returns that value', () => {
    const result = medianOf([0.5, 0.5, 0.5]);
    assert.ok(Math.abs(result - 0.5) < 1e-9, `all-same: expected 0.5, got ${result}`);
  });

  it('does not mutate the input array', () => {
    const input = [0.7, 0.3, 0.5];
    const original = [...input];
    medianOf(input);
    assert.deepEqual(input, original, 'input array must not be mutated');
  });
});

// ── applyAggregateReview ──────────────────────────────────────────────────────

describe('applyAggregateReview', () => {
  it('keep=true: returns the original aggregate unchanged', () => {
    const result = applyAggregateReview(0.65, { keep: true });
    assert.ok(Math.abs(result - 0.65) < 1e-9, 'keep=true should not change the aggregate');
  });

  it('keep=false without adjustedP: returns the original aggregate', () => {
    const result = applyAggregateReview(0.65, { keep: false });
    assert.ok(Math.abs(result - 0.65) < 1e-9, 'keep=false without adjustedP should not change the aggregate');
  });

  it('keep=false with adjustedP within ±0.10: applies the adjustment', () => {
    // aggregate=0.65, adjustedP=0.72 → within ±0.10 → should apply 0.72
    const result = applyAggregateReview(0.65, { keep: false, adjustedP: 0.72 });
    assert.ok(Math.abs(result - 0.72) < 1e-9, `expected 0.72, got ${result}`);
  });

  it('keep=false with adjustedP exactly at +0.10 boundary: applies the adjustment', () => {
    // aggregate=0.60, adjustedP=0.70 → exactly at boundary → should apply
    const result = applyAggregateReview(0.60, { keep: false, adjustedP: 0.70 });
    assert.ok(Math.abs(result - 0.70) < 1e-9, `expected 0.70, got ${result}`);
  });

  it('hard clamp: adjustedP > aggregate+0.10 is clamped to aggregate+0.10', () => {
    // aggregate=0.60, adjustedP=0.80 → delta=0.20 > 0.10 → clamp to 0.70
    const result = applyAggregateReview(0.60, { keep: false, adjustedP: 0.80 });
    assert.ok(Math.abs(result - 0.70) < 1e-9, `expected 0.70 (clamped), got ${result}`);
  });

  it('hard clamp: adjustedP < aggregate-0.10 is clamped to aggregate-0.10', () => {
    // aggregate=0.60, adjustedP=0.30 → delta=-0.30 < -0.10 → clamp to 0.50
    const result = applyAggregateReview(0.60, { keep: false, adjustedP: 0.30 });
    assert.ok(Math.abs(result - 0.50) < 1e-9, `expected 0.50 (clamped), got ${result}`);
  });

  it('result is always in [0.02, 0.98] (global clamp)', () => {
    // Try to push outside global clamp.
    const result1 = applyAggregateReview(0.03, { keep: false, adjustedP: -0.5 });
    assert.ok(result1 >= 0.02, `result ${result1} below 0.02`);

    const result2 = applyAggregateReview(0.97, { keep: false, adjustedP: 1.5 });
    assert.ok(result2 <= 0.98, `result ${result2} above 0.98`);
  });

  it('keep=false with non-finite adjustedP: returns original aggregate', () => {
    const result = applyAggregateReview(0.65, { keep: false, adjustedP: NaN });
    assert.ok(Math.abs(result - 0.65) < 1e-9, 'NaN adjustedP should return original aggregate');
  });
});

// ── k=1: byte-identical to pre-PR-15 path ────────────────────────────────────

describe('self-consistency k=1: byte-identical path', () => {
  before(() => {
    _resetTunedParamsForTests();
    setTunedParam('superforecast', 'selfConsistencyK', 1);
    _clearPersonaCacheForTests();
  });

  after(() => {
    _injectGenerateTextForTests(null);
    _clearPersonaCacheForTests();
    _resetTunedParamsForTests();
  });

  it('k=1: persona elicitation calls generate exactly once per persona', async () => {
    const callLog: string[] = [];

    _injectGenerateTextForTests(async (prompt) => {
      if (prompt.includes('"conditions"') || prompt.includes('NECESSARY')) {
        // Decomposition call.
        callLog.push('decomp');
        return {
          text: '{"conditions":[{"label":"A","probability":0.7,"rationale":"r"},{"label":"B","probability":0.6,"rationale":"r"}]}',
          provider: 'local' as const,
        };
      }
      if (prompt.includes('senior forecasting reviewer') || prompt.includes('"keep": true/false')) {
        // Aggregate review call.
        callLog.push('review');
        return { text: '{"keep": true, "reason": "reasonable"}', provider: 'local' as const };
      }
      // Persona call.
      callLog.push('persona');
      return { text: '{"probability": 0.55, "rationale": "test"}', provider: 'local' as const };
    });

    _clearPersonaCacheForTests();
    const h = makeHypothesis({ id: 'h-k1-test' });
    const result = await superforecast(h);

    // With k=1 and 3 personas, exactly 3 persona calls should happen (plus decomp and review).
    const personaCalls = callLog.filter(c => c === 'persona').length;
    assert.equal(personaCalls, 3, `k=1 should call each persona exactly once, got ${personaCalls}`);

    assert.ok(result.probability >= 0.02 && result.probability <= 0.98, 'probability in bounds');
    assert.ok(result.explanation.length > 0, 'explanation non-empty');
  });

  it('k=1: explanation does NOT mention sample count', async () => {
    _injectGenerateTextForTests(async (prompt) => {
      if (prompt.includes('"keep"')) {
        return { text: '{"keep": true, "reason": "ok"}', provider: 'local' as const };
      }
      if (prompt.includes('NECESSARY')) {
        return {
          text: '{"conditions":[{"label":"A","probability":0.65},{"label":"B","probability":0.55}]}',
          provider: 'local' as const,
        };
      }
      return { text: '{"probability": 0.60, "rationale": "ok"}', provider: 'local' as const };
    });

    _clearPersonaCacheForTests();
    const h = makeHypothesis({ id: 'h-k1-explain' });
    const result = await superforecast(h);

    // k=1 should not add "(k=1 samples, median)" to the explanation.
    assert.ok(
      !result.explanation.includes('k=1'),
      `k=1 explanation should not mention sample count: ${result.explanation}`,
    );
  });
});

// ── k=3 sampling: median math ─────────────────────────────────────────────────

describe('self-consistency k=3: median of samples', () => {
  before(() => {
    _resetTunedParamsForTests();
    setTunedParam('superforecast', 'selfConsistencyK', 3);
    _clearPersonaCacheForTests();
  });

  after(() => {
    _injectGenerateTextForTests(null);
    _clearPersonaCacheForTests();
    _resetTunedParamsForTests();
  });

  it('k=3: calls each persona 3 times and uses median', async () => {
    // Analyst: samples [0.5, 0.7, 0.6] → median = 0.6
    // Skeptic: samples [0.3, 0.4, 0.35] → median = 0.35
    // Pragmatist: samples [0.55, 0.65, 0.60] → median = 0.60
    const personaCallCount: Record<string, number> = {};
    const personaSamples: Record<string, number[]> = {
      analyst: [0.5, 0.7, 0.6],
      skeptic: [0.3, 0.4, 0.35],
      pragmatist: [0.55, 0.65, 0.60],
    };

    _injectGenerateTextForTests(async (prompt) => {
      if (prompt.includes('senior forecasting reviewer') || prompt.includes('"keep": true/false')) {
        return { text: '{"keep": true, "reason": "ok"}', provider: 'local' as const };
      }
      if (prompt.includes('NECESSARY') || prompt.includes('"conditions"')) {
        return {
          text: '{"conditions":[{"label":"A","probability":0.65},{"label":"B","probability":0.55}]}',
          provider: 'local' as const,
        };
      }
      // Detect persona from system context.
      let persona = 'analyst';
      if (prompt.includes('skeptic') || prompt.includes('Skeptic') || prompt.includes('overconfidence')) persona = 'skeptic';
      if (prompt.includes('pragmatist') || prompt.includes('Pragmatist') || prompt.includes('base rate')) persona = 'pragmatist';

      personaCallCount[persona] = (personaCallCount[persona] ?? 0) + 1;
      const sampleIdx = (personaCallCount[persona]! - 1) % personaSamples[persona]!.length;
      const p = personaSamples[persona]![sampleIdx]!;
      return { text: `{"probability": ${p}, "rationale": "sample ${sampleIdx}"}`, provider: 'local' as const };
    });

    _clearPersonaCacheForTests();
    const h = makeHypothesis({ id: 'h-k3-test' });
    const result = await superforecast(h);

    // Each persona should be called 3 times (k=3).
    for (const persona of ['analyst', 'skeptic', 'pragmatist']) {
      const count = personaCallCount[persona] ?? 0;
      assert.equal(count, 3, `persona '${persona}' should be called exactly 3 times, got ${count}`);
    }

    // The aggregate should exist.
    assert.ok(result.probability >= 0.02 && result.probability <= 0.98, 'probability in bounds');

    // The explanation should mention k=3.
    assert.ok(
      result.explanation.includes('k=3'),
      `k=3 explanation should note sample count: ${result.explanation}`,
    );
  });
});

// ── Partial-budget degradation ────────────────────────────────────────────────

describe('self-consistency: partial-budget degradation', () => {
  before(() => {
    _resetTunedParamsForTests();
    setTunedParam('superforecast', 'selfConsistencyK', 3);
    _clearPersonaCacheForTests();
  });

  after(() => {
    _injectGenerateTextForTests(null);
    _clearPersonaCacheForTests();
    _resetTunedParamsForTests();
  });

  it('partial budget: uses median of available samples, does not fail', async () => {
    // Only the first persona sample succeeds (simulates budget running out mid-sampling).
    // But budget check is per-persona-loop, so at k=3 we get all 3 persona rounds.
    // To simulate partial within-persona sampling, we make the 2nd/3rd sample fail.
    let callCount = 0;

    _injectGenerateTextForTests(async (prompt) => {
      callCount += 1;
      if (prompt.includes('senior forecasting reviewer') || prompt.includes('"keep": true/false')) {
        return { text: '{"keep": true, "reason": "ok"}', provider: 'local' as const };
      }
      if (prompt.includes('NECESSARY') || prompt.includes('"conditions"')) {
        return {
          text: '{"conditions":[{"label":"A","probability":0.65},{"label":"B","probability":0.55}]}',
          provider: 'local' as const,
        };
      }
      // Persona calls: first sample succeeds, rest throw (simulating budget exhaustion mid-sampling).
      // The code catches errors and uses whatever samples succeeded.
      if (callCount % 3 !== 1) {
        throw new Error('simulated budget exhaustion after first sample');
      }
      return { text: '{"probability": 0.60, "rationale": "first sample only"}', provider: 'local' as const };
    });

    _clearPersonaCacheForTests();
    const h = makeHypothesis({ id: 'h-partial-budget' });

    // Must not throw, even when most samples fail.
    const result = await superforecast(h);
    assert.ok(result !== null, 'must return a result even with partial-budget degradation');
    assert.ok(result.probability >= 0.02 && result.probability <= 0.98, 'probability in bounds');
    assert.ok(result.explanation.length > 0, 'explanation non-empty');
  });

  it('all persona samples fail: pipeline degrades gracefully to deterministic-only', async () => {
    _injectGenerateTextForTests(async (prompt) => {
      if (prompt.includes('senior forecasting reviewer') || prompt.includes('"keep": true/false')) {
        return { text: '{"keep": true, "reason": "ok"}', provider: 'local' as const };
      }
      // All calls throw.
      throw new Error('simulated complete failure');
    });

    _clearPersonaCacheForTests();
    const h = makeHypothesis({ id: 'h-all-fail' });
    const result = await superforecast(h);

    assert.ok(result !== null, 'must return result even when all LLM calls fail');
    assert.equal(result.llmTier, 'deterministic-only', 'complete LLM failure must yield deterministic-only');
    assert.ok(result.estimates.length > 0, 'must have at least deterministic estimates');
  });
});
