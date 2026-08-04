import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeCascadeKeys,
  refreshLearnedCascades,
} from '../cascade-registration.ts';
import {
  clearInhibitorySnapshot,
  getInhibitorySnapshot,
  replaceInhibitorySnapshot,
} from '../../correlation/inhibition.ts';
import type {
  InhibitoryLeadLagEdge,
  LeadLagMiningResult,
  PromotingLeadLagEdge,
} from '../../correlation/lead-lag.ts';

const HOUR_MS = 3_600_000;

test('computeCascadeKeys yields the expected pair key for a lagged cause→effect history', () => {
  const base = 1_000_000_000;
  const history = Array.from({ length: 10 }, (_, index) => [
    { domain: 'weather', at: base + index * 30 * HOUR_MS },
    { domain: 'infra', at: base + (index * 30 + 2) * HOUR_MS },
  ]).flat();

  const keys = computeCascadeKeys(history);

  assert.ok(keys.includes('weather|infra'), `expected weather|infra in ${JSON.stringify(keys)}`);
});

test('computeCascadeKeys yields no pairs for sparse unrelated history', () => {
  const base = 1_000_000_000;
  const history = [
    { domain: 'markets', at: base },
    { domain: 'cyber', at: base + 500 * HOUR_MS },
  ];

  const keys = computeCascadeKeys(history);

  assert.deepEqual(keys, []);
});

function promoting(): PromotingLeadLagEdge {
  return {
    effect: 'promoting', from: 'weather', to: 'infra', windowMs: HOUR_MS,
    support: 5, antecedents: 5, followRate: 1, expectedRate: 0.2, lift: 5,
    zScore: 8, strength: 1, medianLagMs: HOUR_MS, lagP90Ms: HOUR_MS,
    explanation: 'promoting',
  };
}

function inhibitory(from = 'wildfire', to = 'infrastructure'): InhibitoryLeadLagEdge {
  return {
    effect: 'inhibitory', from, to, windowMs: 6 * HOUR_MS,
    support: 0, antecedents: 12, followRate: 0, expectedRate: 0.5, lift: 0,
    zScore: -8, strength: 0, explanation: 'inhibitory',
  };
}

function result(overrides: Partial<LeadLagMiningResult> = {}): LeadLagMiningResult {
  return {
    family: {
      alpha: 0.05, eligibleOrderedPairs: 2, windowCount: 1,
      pairWindowTests: 2, tails: 2, criticalAbsZ: 4,
      method: 'gaussian-union-bound',
    },
    candidates: [promoting()],
    promoting: [promoting()],
    inhibitory: [inhibitory()],
    ...overrides,
  };
}

function engine(options: { throwOnRegister?: boolean } = {}) {
  const rules: Array<{ id: string }> = [];
  return {
    rules,
    getRules: () => rules,
    unregisterRule: (id: string) => {
      const index = rules.findIndex((rule) => rule.id === id);
      if (index >= 0) rules.splice(index, 1);
    },
    registerRule: (rule: { id: string }) => {
      if (options.throwOnRegister) throw new Error('sync failed');
      rules.push(rule);
    },
  };
}

test('refresh routes only promoting edges into learned rules and publishes inhibitors after positive sync', () => {
  clearInhibitorySnapshot();
  const fakeEngine = engine();

  refreshLearnedCascades([], {
    now: 123,
    engine: fakeEngine,
    mine: () => result(),
    inhibitionEnabled: () => true,
  });

  assert.deepEqual(fakeEngine.rules.map((rule) => rule.id), ['learned:weather->infra']);
  assert.equal(getInhibitorySnapshot(123)?.evidence[0]?.from, 'wildfire');
});

test('disabled, empty, and mining-error refreshes clear inhibition immediately', () => {
  const fakeEngine = engine();
  const seed = (): void => { replaceInhibitorySnapshot([inhibitory()], 4, 1); };

  seed();
  let clearedBeforeMining = false;
  refreshLearnedCascades([], {
    now: 2,
    engine: fakeEngine,
    mine: () => {
      clearedBeforeMining = getInhibitorySnapshot(2) === null;
      return result();
    },
    inhibitionEnabled: () => false,
  });
  assert.equal(clearedBeforeMining, true, 'kill switch clears before mining starts');
  assert.equal(getInhibitorySnapshot(2), null);

  seed();
  refreshLearnedCascades([], {
    now: 2,
    engine: fakeEngine,
    mine: () => result({ family: null, candidates: [], promoting: [], inhibitory: [] }),
    inhibitionEnabled: () => true,
  });
  assert.equal(getInhibitorySnapshot(2), null);

  seed();
  refreshLearnedCascades([], {
    now: 2,
    engine: fakeEngine,
    mine: () => { throw new Error('mining failed'); },
    inhibitionEnabled: () => true,
  });
  assert.equal(getInhibitorySnapshot(2), null);
});

test('failed positive-rule sync clears instead of publishing a partial inhibitory snapshot', () => {
  replaceInhibitorySnapshot([inhibitory('old', 'edge')], 4, 1);

  refreshLearnedCascades([], {
    now: 2,
    engine: engine({ throwOnRegister: true }),
    mine: () => result(),
    inhibitionEnabled: () => true,
  });

  assert.equal(getInhibitorySnapshot(2), null);
});
