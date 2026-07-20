import { test } from 'node:test';
import assert from 'node:assert/strict';
import { causalChainToCorrelationSummary } from '../../diagnostics/frontend-export-composer';
import type { CausalChain } from '../../intelligence/causal-chain';
import type { ObservationEvent } from '../../../types/intelligence';

const T0 = Date.UTC(2026, 6, 1, 12, 0, 0);

function obs(id: string, title = `event ${id}`): ObservationEvent {
  return {
    id, sourceId: 'src', domain: 'weather', timestamp: T0, severity: 'HIGH',
    title, raw: null, entityIds: [], tags: [],
  };
}

function chain(overrides: Partial<CausalChain> = {}): CausalChain {
  return {
    id: 'chain-1',
    rootCause: obs('root', 'M6.8 earthquake'),
    links: [
      { causeId: 'root', effectId: 'e1', mechanism: 'shaking', confidence: 0.7, delayHours: 1, evidenceObservationIds: [] },
      { causeId: 'e1', effectId: 'e2', mechanism: 'outage', confidence: 0.6, delayHours: 2, evidenceObservationIds: [] },
    ],
    leafEffects: [obs('e2')],
    overallConfidence: 0.42,
    longestPath: 2,
    situationId: 'sit-1',
    builtAt: T0,
    ...overrides,
  };
}

test('summary carries id, causal chainType, confidence and builtAt', () => {
  const s = causalChainToCorrelationSummary(chain());
  assert.equal(s.id, 'chain-1');
  assert.equal(s.chainType, 'causal');
  assert.equal(s.confidence, 0.42);
  assert.equal(s.detectedAt, T0);
});

test('title names the root cause and counts downstream effects', () => {
  const s = causalChainToCorrelationSummary(chain());
  assert.equal(s.title, 'M6.8 earthquake → 1 downstream effect');
});

test('title pluralizes multiple leaf effects', () => {
  const s = causalChainToCorrelationSummary(chain({ leafEffects: [obs('e2'), obs('e3')] }));
  assert.match(s.title, /2 downstream effects$/);
});

test('eventIds are the deduplicated union of link endpoints', () => {
  const s = causalChainToCorrelationSummary(chain());
  assert.deepEqual([...s.eventIds].sort(), ['e1', 'e2', 'root']);
});

test('a linkless chain yields empty eventIds, not a crash', () => {
  const s = causalChainToCorrelationSummary(chain({ links: [], leafEffects: [] }));
  assert.deepEqual(s.eventIds, []);
  assert.match(s.title, /0 downstream effects$/);
});

test('deterministic mapping', () => {
  assert.deepEqual(
    causalChainToCorrelationSummary(chain()),
    causalChainToCorrelationSummary(chain()),
  );
});

test('retired modules are gone: importing them fails', async () => {
  await assert.rejects(import('../../intelligence/correlator' as string));
  await assert.rejects(import('../../intelligence/correlator-v2' as string));
});

test('the slim observation-types module survives (live orchestrator consumer)', async () => {
  const mod = await import('../../intelligence/observation-types');
  assert.ok(mod, 'observation-types is intentionally retained');
});

test('the live causal-chain module exports the builder the composer now uses', async () => {
  const mod = await import('../../intelligence/causal-chain');
  assert.equal(typeof mod.getCausalChainBuilder, 'function');
});

test('the live engine module is untouched by the retirement', async () => {
  const mod = await import('../../intelligence/correlate-engine');
  assert.equal(typeof mod.CorrelateEngine, 'function');
});
