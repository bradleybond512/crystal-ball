import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  StrategicSimulationService,
  type DomainCondition,
  type SimEvent,
} from '../../src/services/intelligence/strategic-simulation.ts';

// ── localStorage mock ───────────────────────────────────────────────

const lsStore = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => lsStore.get(k) ?? null,
    setItem: (k: string, v: string) => { lsStore.set(k, v); },
    removeItem: (k: string) => { lsStore.delete(k); },
    clear: () => { lsStore.clear(); },
  },
  writable: true,
  configurable: true,
});

// ── Helpers ──────────────────────────────────────────────────────────

function fresh(randomFn?: () => number): StrategicSimulationService {
  StrategicSimulationService.reset();
  lsStore.clear();
  return StrategicSimulationService.getInstance({ randomFn });
}

/** random() always returns 0 → every event fires (0 < any probability > 0) */
const alwaysFire = (): number => 0;
/** random() always returns 1 → no event fires (1 is never < probability ≤ 1) */
const neverFire = (): number => 1;

function makeCond(domain: string, severity = 5, trend: DomainCondition['trend'] = 'stable'): DomainCondition {
  return { domain, severity, trend };
}

function makeEvent(overrides: Partial<SimEvent> = {}): SimEvent {
  return {
    order: 1,
    domain: 'seismic',
    deltaSeverity: 2,
    description: 'Test event',
    probability: 0.8,
    ...overrides,
  };
}

// ── Singleton ────────────────────────────────────────────────────────

describe('StrategicSimulationService — singleton', () => {
  beforeEach(() => { StrategicSimulationService.reset(); lsStore.clear(); });

  it('getInstance returns the same instance on repeated calls', () => {
    const a = StrategicSimulationService.getInstance();
    const b = StrategicSimulationService.getInstance();
    assert.strictEqual(a, b);
  });

  it('reset allows a fresh instance to be created', () => {
    const a = StrategicSimulationService.getInstance();
    StrategicSimulationService.reset();
    const b = StrategicSimulationService.getInstance();
    assert.notStrictEqual(a, b);
  });

  it('getInstance accepts optional randomFn for testing', () => {
    StrategicSimulationService.reset();
    const svc = StrategicSimulationService.getInstance({ randomFn: alwaysFire });
    assert.ok(svc instanceof StrategicSimulationService);
  });
});

// ── createScenario ───────────────────────────────────────────────────

describe('createScenario', () => {
  beforeEach(() => { StrategicSimulationService.reset(); lsStore.clear(); });

  it('returns a scenario with correct name and description', () => {
    const svc = fresh();
    const s = svc.createScenario('Trade War', 'US-China tariff escalation', []);
    assert.equal(s.name, 'Trade War');
    assert.equal(s.description, 'US-China tariff escalation');
  });

  it('id starts with ss-', () => {
    const svc = fresh();
    const s = svc.createScenario('Test', '', []);
    assert.ok(s.id.startsWith('ss-'));
  });

  it('status is draft', () => {
    const svc = fresh();
    const s = svc.createScenario('Test', '', []);
    assert.equal(s.status, 'draft');
  });

  it('eventChain is empty', () => {
    const svc = fresh();
    const s = svc.createScenario('Test', '', []);
    assert.equal(s.eventChain.length, 0);
  });

  it('projectedOutcomes is empty', () => {
    const svc = fresh();
    const s = svc.createScenario('Test', '', []);
    assert.equal(s.projectedOutcomes.length, 0);
  });

  it('initialConditions are copied into scenario', () => {
    const svc = fresh();
    const conds = [makeCond('seismic', 4)];
    const s = svc.createScenario('Test', '', conds);
    assert.equal(s.initialConditions.length, 1);
    assert.equal(s.initialConditions[0]?.domain, 'seismic');
  });

  it('createdAt is a recent timestamp', () => {
    const before = Date.now();
    const svc = fresh();
    const s = svc.createScenario('Test', '', []);
    const after = Date.now();
    assert.ok(s.createdAt >= before && s.createdAt <= after);
  });

  it('completedAt is undefined on creation', () => {
    const svc = fresh();
    const s = svc.createScenario('Test', '', []);
    assert.equal(s.completedAt, undefined);
  });

  it('multiple scenarios have unique ids', () => {
    const svc = fresh();
    const a = svc.createScenario('A', '', []);
    const b = svc.createScenario('B', '', []);
    assert.notEqual(a.id, b.id);
  });
});

// ── addEvent ─────────────────────────────────────────────────────────

describe('addEvent', () => {
  beforeEach(() => { StrategicSimulationService.reset(); lsStore.clear(); });

  it('adds event to scenario eventChain', () => {
    const svc = fresh();
    const s = svc.createScenario('Test', '', [makeCond('seismic')]);
    svc.addEvent(s.id, makeEvent());
    const updated = svc.getScenarios().find((x) => x.id === s.id);
    assert.equal(updated?.eventChain.length, 1);
  });

  it('is a no-op for unknown scenarioId', () => {
    const svc = fresh();
    svc.addEvent('nonexistent', makeEvent());
    assert.equal(svc.getScenarios().length, 0);
  });

  it('is a no-op if scenario is already completed', () => {
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic')]);
    svc.run(s.id);
    svc.addEvent(s.id, makeEvent({ order: 2 }));
    const updated = svc.getScenarios().find((x) => x.id === s.id);
    assert.equal(updated?.eventChain.length, 0);
  });

  it('is a no-op if scenario is running', () => {
    // Can't easily test running state directly; verify completed guard covers non-draft
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic')]);
    svc.run(s.id);
    const before = svc.getScenarios().find((x) => x.id === s.id)?.eventChain.length ?? 0;
    svc.addEvent(s.id, makeEvent());
    const after = svc.getScenarios().find((x) => x.id === s.id)?.eventChain.length ?? 0;
    assert.equal(before, after);
  });

  it('multiple events can be added to a draft scenario', () => {
    const svc = fresh();
    const s = svc.createScenario('Test', '', [makeCond('seismic')]);
    svc.addEvent(s.id, makeEvent({ order: 1 }));
    svc.addEvent(s.id, makeEvent({ order: 2 }));
    svc.addEvent(s.id, makeEvent({ order: 3 }));
    const updated = svc.getScenarios().find((x) => x.id === s.id);
    assert.equal(updated?.eventChain.length, 3);
  });
});

// ── run — basic ──────────────────────────────────────────────────────

describe('run — basic', () => {
  beforeEach(() => { StrategicSimulationService.reset(); lsStore.clear(); });

  it('returns [] for unknown scenarioId', () => {
    const svc = fresh();
    assert.deepEqual(svc.run('unknown'), []);
  });

  it('marks scenario as completed', () => {
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic')]);
    svc.run(s.id);
    const updated = svc.getScenarios().find((x) => x.id === s.id);
    assert.equal(updated?.status, 'completed');
  });

  it('sets completedAt timestamp', () => {
    const before = Date.now();
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic')]);
    svc.run(s.id);
    const after = Date.now();
    const updated = svc.getScenarios().find((x) => x.id === s.id);
    assert.ok((updated?.completedAt ?? 0) >= before);
    assert.ok((updated?.completedAt ?? 0) <= after);
  });

  it('returns one outcome per initial condition domain', () => {
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic'), makeCond('weather')]);
    const outcomes = svc.run(s.id);
    const domains = outcomes.map((o) => o.domain);
    assert.ok(domains.includes('seismic'));
    assert.ok(domains.includes('weather'));
  });

  it('no events → outcomes preserve initial severities', () => {
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic', 4)]);
    const outcomes = svc.run(s.id);
    const seismic = outcomes.find((o) => o.domain === 'seismic');
    assert.equal(seismic?.projectedSeverity, 4);
  });

  it('no events → confidence is 1', () => {
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic')]);
    const outcomes = svc.run(s.id);
    assert.equal(outcomes[0]?.confidence, 1);
  });

  it('no events → timeframeHours is 0', () => {
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic')]);
    const outcomes = svc.run(s.id);
    assert.equal(outcomes[0]?.timeframeHours, 0);
  });
});

// ── run — probabilistic firing ────────────────────────────────────────

describe('run — event firing', () => {
  beforeEach(() => { StrategicSimulationService.reset(); lsStore.clear(); });

  it('event fires when random() < probability (alwaysFire)', () => {
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic', 3)]);
    svc.addEvent(s.id, makeEvent({ deltaSeverity: 2, probability: 0.8 }));
    const outcomes = svc.run(s.id);
    const seismic = outcomes.find((o) => o.domain === 'seismic');
    assert.equal(seismic?.projectedSeverity, 5); // 3 + 2
  });

  it('event does not fire when random() >= probability (neverFire)', () => {
    const svc = fresh(neverFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic', 3)]);
    svc.addEvent(s.id, makeEvent({ deltaSeverity: 2, probability: 0.8 }));
    const outcomes = svc.run(s.id);
    const seismic = outcomes.find((o) => o.domain === 'seismic');
    assert.equal(seismic?.projectedSeverity, 3); // unchanged
  });

  it('negative deltaSeverity reduces severity when event fires', () => {
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic', 7)]);
    svc.addEvent(s.id, makeEvent({ deltaSeverity: -3, probability: 1 }));
    const outcomes = svc.run(s.id);
    const seismic = outcomes.find((o) => o.domain === 'seismic');
    assert.equal(seismic?.projectedSeverity, 4); // 7 - 3
  });

  it('severity is clamped to maximum 10', () => {
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic', 9)]);
    svc.addEvent(s.id, makeEvent({ deltaSeverity: 5, probability: 1 }));
    const outcomes = svc.run(s.id);
    const seismic = outcomes.find((o) => o.domain === 'seismic');
    assert.equal(seismic?.projectedSeverity, 10);
  });

  it('severity is clamped to minimum 0', () => {
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic', 2)]);
    svc.addEvent(s.id, makeEvent({ deltaSeverity: -10, probability: 1 }));
    const outcomes = svc.run(s.id);
    const seismic = outcomes.find((o) => o.domain === 'seismic');
    assert.equal(seismic?.projectedSeverity, 0);
  });

  it('multiple events on same domain stack their deltas', () => {
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic', 3)]);
    svc.addEvent(s.id, makeEvent({ order: 1, deltaSeverity: 2, probability: 1 }));
    svc.addEvent(s.id, makeEvent({ order: 2, deltaSeverity: 1, probability: 1 }));
    const outcomes = svc.run(s.id);
    const seismic = outcomes.find((o) => o.domain === 'seismic');
    assert.equal(seismic?.projectedSeverity, 6); // 3 + 2 + 1
  });

  it('events are applied in ascending order', () => {
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic', 5)]);
    // Added out of order; should still apply order=1 then order=2
    svc.addEvent(s.id, makeEvent({ order: 2, deltaSeverity: -5, probability: 1 }));
    svc.addEvent(s.id, makeEvent({ order: 1, deltaSeverity: 3, probability: 1 }));
    const outcomes = svc.run(s.id);
    const seismic = outcomes.find((o) => o.domain === 'seismic');
    // Order: 5+3=8, then 8-5=3
    assert.equal(seismic?.projectedSeverity, 3);
  });
});

// ── run — confidence ─────────────────────────────────────────────────

describe('run — confidence calculation', () => {
  beforeEach(() => { StrategicSimulationService.reset(); lsStore.clear(); });

  it('single event: confidence = event.probability', () => {
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic')]);
    svc.addEvent(s.id, makeEvent({ probability: 0.7 }));
    const outcomes = svc.run(s.id);
    assert.equal(outcomes[0]?.confidence, 0.7);
  });

  it('two events: confidence = product of probabilities', () => {
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic')]);
    svc.addEvent(s.id, makeEvent({ order: 1, probability: 0.8 }));
    svc.addEvent(s.id, makeEvent({ order: 2, probability: 0.5 }));
    const outcomes = svc.run(s.id);
    // 0.8 * 0.5 = 0.4
    assert.equal(outcomes[0]?.confidence, 0.4);
  });

  it('confidence product is applied regardless of whether events fired', () => {
    const svc = fresh(neverFire); // no events fire
    const s = svc.createScenario('Test', '', [makeCond('seismic')]);
    svc.addEvent(s.id, makeEvent({ order: 1, probability: 0.5 }));
    svc.addEvent(s.id, makeEvent({ order: 2, probability: 0.5 }));
    const outcomes = svc.run(s.id);
    // Confidence is still the product
    assert.equal(outcomes[0]?.confidence, 0.25);
  });

  it('all outcomes in a run share the same confidence', () => {
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic'), makeCond('weather')]);
    svc.addEvent(s.id, makeEvent({ probability: 0.6 }));
    const outcomes = svc.run(s.id);
    assert.ok(outcomes.length >= 2);
    const confidences = new Set(outcomes.map((o) => o.confidence));
    assert.equal(confidences.size, 1);
  });
});

// ── run — timeframeHours ─────────────────────────────────────────────

describe('run — timeframeHours', () => {
  beforeEach(() => { StrategicSimulationService.reset(); lsStore.clear(); });

  it('timeframeHours = maxOrder * 24', () => {
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic')]);
    svc.addEvent(s.id, makeEvent({ order: 3, probability: 1 }));
    const outcomes = svc.run(s.id);
    assert.equal(outcomes[0]?.timeframeHours, 72); // 3 * 24
  });

  it('timeframeHours reflects max order when events are out of insertion order', () => {
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic')]);
    svc.addEvent(s.id, makeEvent({ order: 5, probability: 1 }));
    svc.addEvent(s.id, makeEvent({ order: 2, probability: 1 }));
    const outcomes = svc.run(s.id);
    assert.equal(outcomes[0]?.timeframeHours, 120); // max(5,2) * 24
  });
});

// ── run — multi-domain ────────────────────────────────────────────────

describe('run — multiple domains', () => {
  beforeEach(() => { StrategicSimulationService.reset(); lsStore.clear(); });

  it('events on different domains update independently', () => {
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic', 3), makeCond('weather', 6)]);
    svc.addEvent(s.id, makeEvent({ domain: 'seismic', deltaSeverity: 2, order: 1, probability: 1 }));
    svc.addEvent(s.id, makeEvent({ domain: 'weather', deltaSeverity: -1, order: 2, probability: 1 }));
    const outcomes = svc.run(s.id);
    const seismic = outcomes.find((o) => o.domain === 'seismic');
    const weather = outcomes.find((o) => o.domain === 'weather');
    assert.equal(seismic?.projectedSeverity, 5);
    assert.equal(weather?.projectedSeverity, 5);
  });

  it('event on domain not in initialConditions adds new outcome domain', () => {
    const svc = fresh(alwaysFire);
    const s = svc.createScenario('Test', '', [makeCond('seismic', 3)]);
    svc.addEvent(s.id, makeEvent({ domain: 'finance', deltaSeverity: 4, probability: 1 }));
    const outcomes = svc.run(s.id);
    const finance = outcomes.find((o) => o.domain === 'finance');
    assert.ok(finance !== undefined, 'finance domain should appear in outcomes');
    assert.equal(finance?.projectedSeverity, 4); // 0 + 4
  });
});

// ── getScenarios ─────────────────────────────────────────────────────

describe('getScenarios', () => {
  beforeEach(() => { StrategicSimulationService.reset(); lsStore.clear(); });

  it('returns empty array initially', () => {
    const svc = fresh();
    assert.equal(svc.getScenarios().length, 0);
  });

  it('returns all created scenarios', () => {
    const svc = fresh();
    svc.createScenario('A', '', []);
    svc.createScenario('B', '', []);
    assert.equal(svc.getScenarios().length, 2);
  });

  it('returns a copy — pushing to result does not affect internal state', () => {
    const svc = fresh();
    svc.createScenario('A', '', []);
    const copy = svc.getScenarios();
    (copy as unknown[]).push({ id: 'fake' });
    assert.equal(svc.getScenarios().length, 1);
  });
});

// ── Persistence ───────────────────────────────────────────────────────

describe('localStorage persistence', () => {
  beforeEach(() => { StrategicSimulationService.reset(); lsStore.clear(); });

  it('saves scenarios to localStorage after createScenario', () => {
    const svc = fresh();
    svc.createScenario('Test', '', []);
    const stored = lsStore.get('wm-strategic-sim');
    assert.ok(stored !== undefined && stored !== null);
    const parsed = JSON.parse(stored) as unknown[];
    assert.equal(parsed.length, 1);
  });

  it('new instance loads saved scenarios from localStorage', () => {
    const svc = fresh();
    svc.createScenario('Loaded', '', [makeCond('seismic')]);
    StrategicSimulationService.reset();
    const svc2 = StrategicSimulationService.getInstance();
    assert.equal(svc2.getScenarios().length, 1);
    assert.equal(svc2.getScenarios()[0]?.name, 'Loaded');
  });

  it('ring buffer trims to 50 scenarios on persist', () => {
    const svc = fresh();
    for (let i = 0; i < 52; i++) svc.createScenario(`s-${i}`, '', []);
    const stored = lsStore.get('wm-strategic-sim');
    const parsed = JSON.parse(stored!) as unknown[];
    assert.ok(parsed.length <= 50);
  });
});
