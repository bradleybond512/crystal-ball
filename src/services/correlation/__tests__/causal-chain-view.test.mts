import { test } from 'node:test';
import assert from 'node:assert/strict';
import { causalChainToPanelChain, chainsForPanel } from '../causal-chain-view';
import type { CausalChain } from '../../intelligence/causal-chain';
import type { ObservationEvent } from '../../../types/intelligence';

const T0 = Date.UTC(2026, 6, 1, 12, 0, 0);
const HOUR = 3_600_000;

function obs(id: string, overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id, sourceId: 'src', domain: 'weather', timestamp: T0, severity: 'HIGH',
    title: `event ${id}`, raw: null, entityIds: [], tags: [], ...overrides,
  };
}

function chain(overrides: Partial<CausalChain> = {}): CausalChain {
  return {
    id: 'ch-1',
    rootCause: obs('root', { title: 'M6.8 earthquake', severity: 'CRITICAL' }),
    links: [
      { causeId: 'root', effectId: 'e1', mechanism: 'shaking', confidence: 0.7, delayHours: 1, evidenceObservationIds: [] },
    ],
    leafEffects: [obs('e1', { domain: 'infra', timestamp: T0 + HOUR, severity: 'MEDIUM' })],
    overallConfidence: 0.63,
    longestPath: 1,
    situationId: 'sit-1',
    builtAt: T0 + 2 * HOUR,
    ...overrides,
  };
}

test('maps id, causal chainType, root title, confidence and builtAt', () => {
  const p = causalChainToPanelChain(chain());
  assert.equal(p.id, 'ch-1');
  assert.equal(p.chainType, 'causal');
  assert.equal(p.title, 'M6.8 earthquake');
  assert.equal(p.confidence, 0.63);
  assert.equal(p.detectedAt, T0 + 2 * HOUR);
});

test('events: root first, then leaves time-ordered, severities numeric', () => {
  const p = causalChainToPanelChain(chain({
    links: [],
    leafEffects: [
      obs('late', { timestamp: T0 + 3 * HOUR, severity: 'LOW' }),
      obs('early', { timestamp: T0 + HOUR, severity: 'HIGH' }),
    ],
  }));
  assert.deepEqual(p.events.map((e) => e.id), ['root', 'early', 'late']);
  assert.equal(p.events[0]!.severity, 92);
  assert.equal(p.events[1]!.severity, 75);
  assert.equal(p.events[2]!.severity, 30);
  assert.equal(p.events[0]!.domain, 'weather');
});

test('a leaf duplicating the root id is not emitted twice', () => {
  const p = causalChainToPanelChain(chain({ links: [], leafEffects: [obs('root')] }));
  assert.equal(p.events.length, 1);
});

test('root-only chain (no links, no leaves) renders one event', () => {
  const p = causalChainToPanelChain(chain({ links: [], leafEffects: [] }));
  assert.equal(p.events.length, 1);
  assert.equal(p.events[0]!.id, 'root');
});

test('chainsForPanel sorts newest-first, confidence tiebreak', () => {
  const out = chainsForPanel([
    chain({ id: 'old', builtAt: T0 }),
    chain({ id: 'new-lo', builtAt: T0 + HOUR, overallConfidence: 0.3 }),
    chain({ id: 'new-hi', builtAt: T0 + HOUR, overallConfidence: 0.9 }),
  ]);
  assert.deepEqual(out.map((c) => c.id), ['new-hi', 'new-lo', 'old']);
});

test('empty input yields an empty list', () => {
  assert.deepEqual(chainsForPanel([]), []);
});

test('deterministic mapping', () => {
  assert.deepEqual(causalChainToPanelChain(chain()), causalChainToPanelChain(chain()));
});

function multiHop(): CausalChain {
  return chain({
    links: [
      { causeId: 'root', effectId: 'mid', mechanism: 'shaking', confidence: 0.7, delayHours: 1, evidenceObservationIds: [] },
      { causeId: 'mid', effectId: 'leaf', mechanism: 'outage', confidence: 0.6, delayHours: 2, evidenceObservationIds: [] },
    ],
    leafEffects: [obs('leaf', { domain: 'cyber', timestamp: T0 + 3 * HOUR })],
  });
}

test('REGRESSION: multi-hop chains render every hop, resolved from the observation lookup', () => {
  const midObs = obs('mid', { domain: 'infra', timestamp: T0 + HOUR, severity: 'MEDIUM' });
  const p = causalChainToPanelChain(multiHop(), (id) => (id === 'mid' ? midObs : undefined));
  assert.deepEqual(p.events.map((e) => e.id), ['root', 'mid', 'leaf']);
  assert.equal(p.events[1]!.domain, 'infra');
  assert.equal(p.events[1]!.severity, 55);
});

test('REGRESSION: an aged-out intermediate degrades to a mechanism placeholder, not omission', () => {
  const p = causalChainToPanelChain(multiHop());
  assert.deepEqual(p.events.map((e) => e.id), ['root', 'mid', 'leaf']);
  const mid = p.events[1]!;
  assert.equal(mid.domain, 'unknown');
  assert.match(mid.title, /via shaking/);
});
