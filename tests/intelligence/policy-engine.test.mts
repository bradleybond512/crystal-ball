import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  PolicyEngine,
  STORAGE_KEY,
  _builtInPolicies,
} from '../../src/services/intelligence/policy-engine.ts';
import type {
  Policy,
  PolicyAction,
  PolicyCondition,
  StorageLike,
} from '../../src/services/intelligence/policy-engine.ts';

const NOW = 1_748_000_000_000;

function makeStorage(initial: Record<string, string> = {}): StorageLike {
  const store = { ...initial };
  return {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = v; },
  };
}

function makeEngine(opts: { now?: () => number; storage?: StorageLike | null; seed?: boolean; capacity?: number } = {}): PolicyEngine {
  return new PolicyEngine({
    now: opts.now ?? (() => NOW),
    storage: opts.storage === undefined ? null : opts.storage,
    seedBuiltIns: opts.seed ?? false,
    capacity: opts.capacity,
  });
}

function makePolicy(o: Partial<Policy> = {}): Policy {
  return {
    id: o.id ?? 'test.policy',
    name: o.name ?? 'Test policy',
    description: o.description ?? '',
    condition: o.condition ?? { type: 'metric-threshold', params: { metric: 'x', operator: '>=', threshold: 1 } },
    action: o.action ?? { type: 'mute-domain', params: { domain: 'weather' } },
    priority: o.priority ?? 50,
    status: o.status ?? 'active',
    appliedCount: o.appliedCount ?? 0,
    lastAppliedAt: o.lastAppliedAt,
    expiresAt: o.expiresAt,
  };
}

// ── Singleton ────────────────────────────────────────────────────────

describe('PolicyEngine — singleton', () => {
  beforeEach(() => { PolicyEngine.resetForTests(); });

  it('getInstance returns same reference', () => {
    const a = PolicyEngine.getInstance();
    const b = PolicyEngine.getInstance();
    assert.strictEqual(a, b);
  });

  it('resetForTests produces a new instance', () => {
    const a = PolicyEngine.getInstance();
    PolicyEngine.resetForTests();
    const b = PolicyEngine.getInstance();
    assert.notStrictEqual(a, b);
  });
});

// ── Construction + seeding ──────────────────────────────────────────

describe('PolicyEngine — built-in seed', () => {
  it('seeds 5 built-in policies on fresh instance when seedBuiltIns is true', () => {
    const engine = new PolicyEngine({ storage: null, seedBuiltIns: true });
    assert.equal(engine.getAll().length, 5);
  });

  it('skips seeding when seedBuiltIns is false', () => {
    const engine = makeEngine({ seed: false });
    assert.equal(engine.getAll().length, 0);
  });

  it('does not double-seed when restoring from storage', () => {
    const storage = makeStorage();
    const first = new PolicyEngine({ storage, seedBuiltIns: true });
    const seeded = first.getAll().length;
    const second = new PolicyEngine({ storage, seedBuiltIns: true });
    assert.equal(second.getAll().length, seeded);
  });

  it('every built-in has a unique id', () => {
    const ids = new Set(_builtInPolicies().map((p) => p.id));
    assert.equal(ids.size, _builtInPolicies().length);
  });

  it('built-in ids include the five expected policies', () => {
    const ids = _builtInPolicies().map((p) => p.id);
    for (const expected of [
      'builtin.flood-of-alerts',
      'builtin.critical-domain-escalator',
      'builtin.stale-feed-muter',
      'builtin.night-quiet-hours',
      'builtin.cascade-amplifier',
    ]) {
      assert.ok(ids.includes(expected), `missing built-in policy: ${expected}`);
    }
  });

  it('built-in priorities sit between 0 and 100', () => {
    for (const p of _builtInPolicies()) {
      assert.ok(p.priority >= 0 && p.priority <= 100, `bad priority: ${p.id}=${p.priority}`);
    }
  });
});

// ── addPolicy / pause / resume / remove ──────────────────────────────

describe('PolicyEngine — CRUD', () => {
  it('addPolicy returns the persisted policy', () => {
    const engine = makeEngine();
    const out = engine.addPolicy(makePolicy({ id: 'a' }));
    assert.equal(out.id, 'a');
    assert.equal(out.appliedCount, 0);
  });

  it('addPolicy replaces an existing id rather than duplicating', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({ id: 'x', name: 'orig' }));
    engine.addPolicy(makePolicy({ id: 'x', name: 'updated' }));
    assert.equal(engine.getAll().length, 1);
    assert.equal(engine.getById('x')?.name, 'updated');
  });

  it('pausePolicy flips status and returns true', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({ id: 'a' }));
    assert.equal(engine.pausePolicy('a'), true);
    assert.equal(engine.getById('a')?.status, 'paused');
  });

  it('pausePolicy on unknown id returns false', () => {
    assert.equal(makeEngine().pausePolicy('nope'), false);
  });

  it('resumePolicy returns paused policy to active', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({ id: 'a', status: 'paused' }));
    assert.equal(engine.resumePolicy('a'), true);
    assert.equal(engine.getById('a')?.status, 'active');
  });

  it('resume does not revive expired policies', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({ id: 'a', status: 'expired' }));
    assert.equal(engine.resumePolicy('a'), false);
    assert.equal(engine.getById('a')?.status, 'expired');
  });

  it('pausePolicy does not change expired policies', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({ id: 'a', status: 'expired' }));
    assert.equal(engine.pausePolicy('a'), false);
    assert.equal(engine.getById('a')?.status, 'expired');
  });

  it('removePolicy drops the entry', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({ id: 'a' }));
    assert.equal(engine.removePolicy('a'), true);
    assert.equal(engine.getById('a'), undefined);
  });
});

// ── getActive() ──────────────────────────────────────────────────────

describe('PolicyEngine — getActive', () => {
  it('returns only active policies', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({ id: 'a', status: 'active' }));
    engine.addPolicy(makePolicy({ id: 'b', status: 'paused' }));
    engine.addPolicy(makePolicy({ id: 'c', status: 'expired' }));
    const ids = engine.getActive().map((p) => p.id).sort();
    assert.deepEqual(ids, ['a']);
  });

  it('expires policies whose expiresAt has passed', () => {
    const engine = makeEngine({ now: () => NOW });
    engine.addPolicy(makePolicy({ id: 'a', expiresAt: NOW - 1 }));
    engine.addPolicy(makePolicy({ id: 'b', expiresAt: NOW + 60_000 }));
    const active = engine.getActive();
    assert.deepEqual(active.map((p) => p.id), ['b']);
    assert.equal(engine.getById('a')?.status, 'expired');
  });
});

// ── evaluate — condition types ───────────────────────────────────────

describe('PolicyEngine.evaluate — metric-threshold', () => {
  it('matches when value crosses >= threshold', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({
      condition: { type: 'metric-threshold', params: { metric: 'alertsPerMinute', operator: '>=', threshold: 30 } },
    }));
    const actions = engine.evaluate({ alertsPerMinute: 30 });
    assert.equal(actions.length, 1);
  });

  it('does not match below threshold', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({
      condition: { type: 'metric-threshold', params: { metric: 'alertsPerMinute', operator: '>=', threshold: 30 } },
    }));
    assert.equal(engine.evaluate({ alertsPerMinute: 29 }).length, 0);
  });

  it('supports dot-notation paths', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({
      condition: { type: 'metric-threshold', params: { metric: 'metrics.cpu', operator: '>', threshold: 0.8 } },
    }));
    const actions = engine.evaluate({ metrics: { cpu: 0.95 } });
    assert.equal(actions.length, 1);
  });

  it('supports < and <=', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({
      id: 'lt',
      condition: { type: 'metric-threshold', params: { metric: 'rate', operator: '<', threshold: 5 } },
    }));
    assert.equal(engine.evaluate({ rate: 4 }).length, 1);
    assert.equal(engine.evaluate({ rate: 5 }).length, 0);
  });

  it('returns no match when metric is missing', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({
      condition: { type: 'metric-threshold', params: { metric: 'missing', operator: '>=', threshold: 1 } },
    }));
    assert.equal(engine.evaluate({}).length, 0);
  });
});

describe('PolicyEngine.evaluate — domain-severity', () => {
  it('matches when domain severity meets threshold', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({
      condition: { type: 'domain-severity', params: { domain: 'weather', minSeverity: 0.85 } },
    }));
    const actions = engine.evaluate({ domainSeverities: { weather: 0.9 } });
    assert.equal(actions.length, 1);
  });

  it('does not match below severity', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({
      condition: { type: 'domain-severity', params: { domain: 'weather', minSeverity: 0.85 } },
    }));
    assert.equal(engine.evaluate({ domainSeverities: { weather: 0.5 } }).length, 0);
  });

  it('returns no match when domainSeverities is absent', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({
      condition: { type: 'domain-severity', params: { domain: 'weather', minSeverity: 0.5 } },
    }));
    assert.equal(engine.evaluate({}).length, 0);
  });
});

describe('PolicyEngine.evaluate — time-window', () => {
  it('matches within a same-day window', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({
      condition: { type: 'time-window', params: { startHour: 9, endHour: 17 } },
    }));
    assert.equal(engine.evaluate({ hourOfDay: 12 }).length, 1);
    assert.equal(engine.evaluate({ hourOfDay: 17 }).length, 0);
    assert.equal(engine.evaluate({ hourOfDay: 8 }).length, 0);
  });

  it('matches within an overnight window (22..6)', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({
      condition: { type: 'time-window', params: { startHour: 22, endHour: 6 } },
    }));
    assert.equal(engine.evaluate({ hourOfDay: 23 }).length, 1);
    assert.equal(engine.evaluate({ hourOfDay: 2 }).length, 1);
    assert.equal(engine.evaluate({ hourOfDay: 10 }).length, 0);
  });
});

describe('PolicyEngine.evaluate — feed-health', () => {
  it('matches when feed ageMs exceeds maxStaleMs', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({
      condition: { type: 'feed-health', params: { feed: 'nws-alerts', maxStaleMs: 60_000 } },
    }));
    const actions = engine.evaluate({ feedHealth: { 'nws-alerts': { ageMs: 90_000 } } });
    assert.equal(actions.length, 1);
  });

  it('does not match when feed is fresh', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({
      condition: { type: 'feed-health', params: { feed: 'nws-alerts', maxStaleMs: 60_000 } },
    }));
    assert.equal(engine.evaluate({ feedHealth: { 'nws-alerts': { ageMs: 10_000 } } }).length, 0);
  });
});

// ── evaluate — ordering + side-effects ───────────────────────────────

describe('PolicyEngine.evaluate — priority + side-effects', () => {
  it('returns actions sorted by priority desc', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({
      id: 'lo', priority: 10,
      condition: { type: 'metric-threshold', params: { metric: 'v', operator: '>=', threshold: 1 } },
      action: { type: 'mute-domain', params: { domain: 'lo' } },
    }));
    engine.addPolicy(makePolicy({
      id: 'hi', priority: 90,
      condition: { type: 'metric-threshold', params: { metric: 'v', operator: '>=', threshold: 1 } },
      action: { type: 'escalate-alerts', params: { domain: 'hi' } },
    }));
    const actions = engine.evaluate({ v: 5 });
    assert.equal(actions[0]?.params.domain, 'hi');
    assert.equal(actions[1]?.params.domain, 'lo');
  });

  it('breaks priority ties deterministically by id', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({
      id: 'z', priority: 50,
      condition: { type: 'metric-threshold', params: { metric: 'v', operator: '>=', threshold: 1 } },
      action: { type: 'mute-domain', params: { tag: 'z' } },
    }));
    engine.addPolicy(makePolicy({
      id: 'a', priority: 50,
      condition: { type: 'metric-threshold', params: { metric: 'v', operator: '>=', threshold: 1 } },
      action: { type: 'mute-domain', params: { tag: 'a' } },
    }));
    const actions = engine.evaluate({ v: 5 });
    assert.equal(actions[0]?.params.tag, 'a');
    assert.equal(actions[1]?.params.tag, 'z');
  });

  it('skips paused policies', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({
      id: 'p', status: 'paused',
      condition: { type: 'metric-threshold', params: { metric: 'v', operator: '>=', threshold: 1 } },
    }));
    assert.equal(engine.evaluate({ v: 5 }).length, 0);
  });

  it('increments appliedCount when a policy matches', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({ id: 'a' }));
    engine.evaluate({ x: 5 });
    engine.evaluate({ x: 5 });
    engine.evaluate({ x: 5 });
    assert.equal(engine.getById('a')?.appliedCount, 3);
  });

  it('stamps lastAppliedAt to the clock value', () => {
    const engine = makeEngine({ now: () => 12345 });
    engine.addPolicy(makePolicy({ id: 'a' }));
    engine.evaluate({ x: 5 });
    assert.equal(engine.getById('a')?.lastAppliedAt, 12345);
  });

  it('does not increment appliedCount for non-matching policies', () => {
    const engine = makeEngine();
    engine.addPolicy(makePolicy({
      id: 'a',
      condition: { type: 'metric-threshold', params: { metric: 'x', operator: '>=', threshold: 100 } },
    }));
    engine.evaluate({ x: 1 });
    assert.equal(engine.getById('a')?.appliedCount, 0);
  });
});

// ── Built-in policy behavior ─────────────────────────────────────────

describe('PolicyEngine — built-in policy behavior', () => {
  function builtInOnly(id: string): PolicyEngine {
    const engine = new PolicyEngine({ storage: null, seedBuiltIns: true, now: () => NOW });
    for (const p of engine.getAll()) {
      if (p.id !== id) engine.removePolicy(p.id);
    }
    return engine;
  }

  it('flood-of-alerts fires at 30+ alerts/min', () => {
    const engine = builtInOnly('builtin.flood-of-alerts');
    assert.equal(engine.evaluate({ alertsPerMinute: 30 }).length, 1);
    assert.equal(engine.evaluate({ alertsPerMinute: 10 }).length, 0);
  });

  it('critical-domain escalator fires at weather severity ≥ 0.85', () => {
    const engine = builtInOnly('builtin.critical-domain-escalator');
    const matches = engine.evaluate({ domainSeverities: { weather: 0.9 } });
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.type, 'escalate-alerts');
  });

  it('stale-feed muter fires when nws-alerts is older than 15 min', () => {
    const engine = builtInOnly('builtin.stale-feed-muter');
    const matches = engine.evaluate({ feedHealth: { 'nws-alerts': { ageMs: 16 * 60 * 1000 } } });
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.type, 'disable-feature');
  });

  it('night-quiet-hours fires between 22 and 6', () => {
    const engine = builtInOnly('builtin.night-quiet-hours');
    assert.equal(engine.evaluate({ hourOfDay: 23 }).length, 1);
    assert.equal(engine.evaluate({ hourOfDay: 5 }).length, 1);
    assert.equal(engine.evaluate({ hourOfDay: 12 }).length, 0);
  });

  it('cascade-amplifier fires at cascadeDepth ≥ 3', () => {
    const engine = builtInOnly('builtin.cascade-amplifier');
    assert.equal(engine.evaluate({ cascadeDepth: 3 }).length, 1);
    assert.equal(engine.evaluate({ cascadeDepth: 2 }).length, 0);
  });
});

// ── Persistence ──────────────────────────────────────────────────────

describe('PolicyEngine — persistence', () => {
  it('persists policies after addPolicy', () => {
    const storage = makeStorage();
    const engine = makeEngine({ storage });
    engine.addPolicy(makePolicy({ id: 'persist-me' }));
    const raw = storage.getItem(STORAGE_KEY);
    assert.ok(raw && raw.includes('persist-me'));
  });

  it('hydrates policies from storage', () => {
    const storage = makeStorage();
    const first = makeEngine({ storage });
    first.addPolicy(makePolicy({ id: 'a', priority: 77 }));
    const second = makeEngine({ storage });
    assert.equal(second.getById('a')?.priority, 77);
  });

  it('survives corrupt storage by starting empty', () => {
    const storage = makeStorage({ [STORAGE_KEY]: 'not json' });
    const engine = makeEngine({ storage });
    assert.equal(engine.getAll().length, 0);
  });

  it('drops persisted policies that fail the shape guard', () => {
    const storage = makeStorage({
      [STORAGE_KEY]: JSON.stringify({ policies: [{ id: '', name: 'bad' }, makePolicy({ id: 'ok' })] }),
    });
    const engine = makeEngine({ storage });
    assert.equal(engine.getAll().length, 1);
    assert.equal(engine.getAll()[0]?.id, 'ok');
  });
});

// ── Capacity ─────────────────────────────────────────────────────────

describe('PolicyEngine — capacity cap', () => {
  it('enforces capacity by dropping the lowest-priority policy', () => {
    const engine = makeEngine({ capacity: 2 });
    engine.addPolicy(makePolicy({ id: 'a', priority: 10 }));
    engine.addPolicy(makePolicy({ id: 'b', priority: 90 }));
    engine.addPolicy(makePolicy({ id: 'c', priority: 50 }));
    const ids = engine.getAll().map((p) => p.id).sort();
    assert.deepEqual(ids, ['b', 'c']);
  });
});

// ── Action type coverage ─────────────────────────────────────────────

describe('PolicyEngine — action types', () => {
  const allTypes: PolicyAction['type'][] = [
    'adjust-threshold',
    'mute-domain',
    'escalate-alerts',
    'enable-feature',
    'disable-feature',
  ];

  for (const t of allTypes) {
    it(`returns an action of type "${t}" when configured`, () => {
      const engine = makeEngine();
      const cond: PolicyCondition = { type: 'metric-threshold', params: { metric: 'v', operator: '>=', threshold: 0 } };
      engine.addPolicy(makePolicy({ id: t, condition: cond, action: { type: t, params: { hint: t } } }));
      const actions = engine.evaluate({ v: 1 });
      assert.equal(actions[0]?.type, t);
    });
  }
});
