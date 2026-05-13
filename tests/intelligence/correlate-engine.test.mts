import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  CorrelateEngine,
  type CorrelationRule,
  type CorrelatedPair,
} from '../../src/services/intelligence/correlate-engine.ts';
import {
  builtInCorrelationRules,
  earthquakeTsunamiRule,
  earthquakeInfrastructureRule,
  weatherWildfireRule,
  spaceWeatherInfrastructureRule,
  conflictDisplacementRule,
} from '../../src/services/intelligence/built-in-correlation-rules.ts';
import {
  CorrelationStore,
  resetForTests as resetStore,
} from '../../src/services/intelligence/correlation-store.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-adapters.ts';

const NOW = 1_745_000_000_000;

function makeEvent(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'ev',
    sourceId: 'test',
    domain: 'weather',
    timestamp: NOW,
    severity: 'MEDIUM',
    title: 'Test event',
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

// ── CorrelateEngine ──────────────────────────────────────────────────

describe('CorrelateEngine', () => {
  it('correlate([]) returns 0 pairs and metadata', () => {
    const engine = new CorrelateEngine();
    const result = engine.correlate([]);
    assert.equal(result.pairs.length, 0);
    assert.equal(result.observationsConsidered, 0);
    assert.ok(result.processingMs >= 0);
  });

  it('single matching pair within window produces 1 correlation', () => {
    const engine = new CorrelateEngine();
    const rule: CorrelationRule = {
      id: 'test-rule',
      name: 'test',
      description: '',
      domains: ['weather', 'infra'],
      timeWindowMs: 60_000,
      matchFn: (a, b) => a.domain === 'weather' && b.domain === 'infra',
      edgeType: 'co-located',
    };
    engine.registerRule(rule);
    const result = engine.correlate([
      makeEvent({ id: 'a', domain: 'weather' }),
      makeEvent({ id: 'b', domain: 'infra', timestamp: NOW + 30_000 }),
    ]);
    assert.equal(result.pairs.length, 1);
    assert.equal(result.pairs[0]?.ruleId, 'test-rule');
    assert.equal(result.pairs[0]?.edgeType, 'co-located');
  });

  it('same pair outside time window does NOT correlate', () => {
    const engine = new CorrelateEngine();
    engine.registerRule({
      id: 'narrow',
      name: 'narrow',
      description: '',
      domains: ['weather', 'infra'],
      timeWindowMs: 60_000,
      matchFn: () => true,
      edgeType: 'co-located',
    });
    const result = engine.correlate([
      makeEvent({ id: 'a', domain: 'weather' }),
      makeEvent({ id: 'b', domain: 'infra', timestamp: NOW + 10 * 60_000 }), // 10min gap
    ]);
    assert.equal(result.pairs.length, 0);
  });

  it('dedups (a,b) vs (b,a) — only one pair per unordered match', () => {
    const engine = new CorrelateEngine();
    engine.registerRule({
      id: 'symmetric',
      name: 'symmetric',
      description: '',
      domains: ['weather'],
      timeWindowMs: 60_000,
      matchFn: () => true,
      edgeType: 'co-located',
    });
    const result = engine.correlate([
      makeEvent({ id: 'a', domain: 'weather' }),
      makeEvent({ id: 'b', domain: 'weather', timestamp: NOW + 10 }),
    ]);
    // Only 1 pair, not 2.
    assert.equal(result.pairs.length, 1);
  });

  it('self-pair (a,a) is excluded', () => {
    const engine = new CorrelateEngine();
    engine.registerRule({
      id: 'always',
      name: 'always',
      description: '',
      domains: ['weather'],
      timeWindowMs: 60_000,
      matchFn: () => true,
      edgeType: 'co-located',
    });
    const a = makeEvent({ id: 'a', domain: 'weather' });
    const result = engine.correlate([a]);
    assert.equal(result.pairs.length, 0);
  });

  it('rule with no domain overlap is skipped — no false positive', () => {
    const engine = new CorrelateEngine();
    engine.registerRule({
      id: 'narrow-domain',
      name: 'n',
      description: '',
      domains: ['cyber'],
      timeWindowMs: 60_000,
      matchFn: () => true,
      edgeType: 'co-located',
    });
    const result = engine.correlate([
      makeEvent({ id: 'a', domain: 'weather' }),
      makeEvent({ id: 'b', domain: 'maritime' }),
    ]);
    assert.equal(result.pairs.length, 0);
  });

  it('registerRule + unregisterRule round-trip', () => {
    const engine = new CorrelateEngine();
    const rule: CorrelationRule = {
      id: 'rt',
      name: 'rt',
      description: '',
      domains: ['weather'],
      timeWindowMs: 60_000,
      matchFn: () => true,
      edgeType: 'co-located',
    };
    assert.equal(engine.getRules().length, 0);
    engine.registerRule(rule);
    assert.equal(engine.getRules().length, 1);
    assert.equal(engine.getRules()[0]?.id, 'rt');
    engine.unregisterRule('rt');
    assert.equal(engine.getRules().length, 0);
  });

  it('registerRule replaces a rule with the same id (no duplicates)', () => {
    const engine = new CorrelateEngine();
    const base: CorrelationRule = {
      id: 'r1', name: 'v1', description: '',
      domains: ['weather'], timeWindowMs: 60_000,
      matchFn: () => true, edgeType: 'co-located',
    };
    engine.registerRule(base);
    engine.registerRule({ ...base, name: 'v2' });
    assert.equal(engine.getRules().length, 1);
    assert.equal(engine.getRules()[0]?.name, 'v2');
  });

  it('rule with confidence override produces that confidence', () => {
    const engine = new CorrelateEngine();
    engine.registerRule({
      id: 'fixed',
      name: 'fixed',
      description: '',
      domains: ['weather'],
      timeWindowMs: 60_000,
      matchFn: () => true,
      edgeType: 'co-located',
      baseConfidence: 0.42,
    });
    const result = engine.correlate([
      makeEvent({ id: 'a', domain: 'weather' }),
      makeEvent({ id: 'b', domain: 'weather', timestamp: NOW + 100 }),
    ]);
    assert.equal(result.pairs[0]?.confidence, 0.42);
  });

  it('confidence decays with temporal gap when no override given', () => {
    const engine = new CorrelateEngine();
    engine.registerRule({
      id: 'temporal',
      name: 't',
      description: '',
      domains: ['weather'],
      timeWindowMs: 60_000,
      matchFn: () => true,
      edgeType: 'temporally-adjacent',
    });
    const close = engine.correlate([
      makeEvent({ id: 'a', domain: 'weather' }),
      makeEvent({ id: 'b', domain: 'weather', timestamp: NOW + 1000 }),
    ]);
    const far = engine.correlate([
      makeEvent({ id: 'c', domain: 'weather' }),
      makeEvent({ id: 'd', domain: 'weather', timestamp: NOW + 55_000 }),
    ]);
    assert.ok((close.pairs[0]?.confidence ?? 0) > (far.pairs[0]?.confidence ?? 0));
  });

  it('correlate result includes processing metadata', () => {
    const engine = new CorrelateEngine();
    engine.registerRule({
      id: 'r', name: 'r', description: '',
      domains: ['weather'], timeWindowMs: 60_000,
      matchFn: () => true, edgeType: 'co-located',
    });
    const out = engine.correlate([
      makeEvent({ id: 'a', domain: 'weather' }),
      makeEvent({ id: 'b', domain: 'weather', timestamp: NOW + 100 }),
    ]);
    assert.equal(out.rulesApplied, 1);
    assert.equal(out.observationsConsidered, 2);
  });

  it('detectedAt is a Date', () => {
    const engine = new CorrelateEngine();
    engine.registerRule({
      id: 'r', name: 'r', description: '',
      domains: ['weather'], timeWindowMs: 60_000,
      matchFn: () => true, edgeType: 'co-located',
    });
    const result = engine.correlate([
      makeEvent({ id: 'a', domain: 'weather' }),
      makeEvent({ id: 'b', domain: 'weather', timestamp: NOW + 100 }),
    ]);
    assert.ok(result.pairs[0]?.detectedAt instanceof Date);
  });
});

// ── Built-in rules ──────────────────────────────────────────────────

describe('built-in rules', () => {
  it('exports 8 rules', () => {
    assert.equal(builtInCorrelationRules.length, 8);
  });

  it('every built-in rule has a unique id', () => {
    const ids = new Set(builtInCorrelationRules.map((r) => r.id));
    assert.equal(ids.size, builtInCorrelationRules.length);
  });

  it('earthquake-tsunami: fires on M≥6.5 + GDACS ocean event within window', () => {
    const engine = new CorrelateEngine();
    engine.registerRule(earthquakeTsunamiRule);
    const result = engine.correlate([
      makeEvent({
        id: 'eq', domain: 'weather', sourceId: 'usgs-earthquake',
        timestamp: NOW, severity: 'CRITICAL',
        location: { lat: 38, lon: 142 }, // off Tohoku coast
        tags: ['earthquake', 'major-earthquake'],
        title: 'M7.8 earthquake offshore Japan',
      }),
      makeEvent({
        id: 'gdacs', domain: 'humanitarian', sourceId: 'gdacs-alerts',
        timestamp: NOW + 20 * 60_000, severity: 'CRITICAL',
        location: { lat: 38.2, lon: 142.5 },
        tags: ['gdacs', 'tropical-cyclone'],
        title: 'GDACS Red TC — JP',
      }),
    ]);
    assert.equal(result.pairs.length, 1);
    assert.equal(result.pairs[0]?.edgeType, 'causal-candidate');
  });

  it('earthquake-tsunami: does NOT fire on M<6.5', () => {
    const engine = new CorrelateEngine();
    engine.registerRule(earthquakeTsunamiRule);
    const result = engine.correlate([
      makeEvent({
        id: 'eq', domain: 'weather', sourceId: 'usgs-earthquake',
        timestamp: NOW, severity: 'MEDIUM',
        location: { lat: 38, lon: 142 },
        tags: ['earthquake'],
        title: 'M5.0 earthquake offshore Japan',
      }),
      makeEvent({
        id: 'gdacs', domain: 'humanitarian', sourceId: 'gdacs-alerts',
        timestamp: NOW + 20 * 60_000,
        location: { lat: 38.2, lon: 142.5 },
        tags: ['gdacs'],
        title: 'GDACS event',
      }),
    ]);
    assert.equal(result.pairs.length, 0);
  });

  it('earthquake-infrastructure: fires on M≥5 + CISA infra within 4h, 500km', () => {
    const engine = new CorrelateEngine();
    engine.registerRule(earthquakeInfrastructureRule);
    const result = engine.correlate([
      makeEvent({
        id: 'eq', domain: 'weather', sourceId: 'usgs-earthquake',
        timestamp: NOW, severity: 'HIGH',
        location: { lat: 37.7, lon: -122.4 }, // SF
        tags: ['earthquake'],
        title: 'M6.2 earthquake near SF',
      }),
      makeEvent({
        id: 'infra', domain: 'infra', sourceId: 'cisa-infrastructure',
        timestamp: NOW + 60 * 60_000, // 1h later
        location: { lat: 37.5, lon: -121.9 },
        title: 'Power grid disturbance',
      }),
    ]);
    assert.equal(result.pairs.length, 1);
    assert.equal(result.pairs[0]?.edgeType, 'co-located');
  });

  it('weather-wildfire: fires when red-flag and fire share country/state tag', () => {
    const engine = new CorrelateEngine();
    engine.registerRule(weatherWildfireRule);
    const result = engine.correlate([
      makeEvent({
        id: 'wx', domain: 'weather', sourceId: 'nws-alerts',
        timestamp: NOW,
        tags: ['weather-alert', 'red-flag-warning'],
        entityIds: ['CA'],
        title: 'Red Flag Warning — CA',
      }),
      makeEvent({
        id: 'fire', domain: 'weather', sourceId: 'inciweb-wildfire',
        timestamp: NOW + 6 * 60 * 60_000,
        tags: ['wildfire'],
        entityIds: ['CA'],
        title: 'Wildfire — Sequoia NP, CA',
      }),
    ]);
    assert.equal(result.pairs.length, 1);
    assert.equal(result.pairs[0]?.edgeType, 'causal-candidate');
  });

  it('space-weather-infrastructure: fires on G4+ + infra anomaly within 2h', () => {
    const engine = new CorrelateEngine();
    engine.registerRule(spaceWeatherInfrastructureRule);
    const result = engine.correlate([
      makeEvent({
        id: 'sw', domain: 'space', sourceId: 'swpc-space-weather',
        timestamp: NOW, severity: 'CRITICAL',
        tags: ['space-weather', 'geomagnetic-storm', 'scale-g5'],
        title: 'G5 geomagnetic storm',
      }),
      makeEvent({
        id: 'bgp', domain: 'infra', sourceId: 'cisa-infrastructure',
        timestamp: NOW + 60 * 60_000, severity: 'HIGH',
        title: 'BGP anomaly',
      }),
    ]);
    assert.equal(result.pairs.length, 1);
    assert.equal(result.pairs[0]?.edgeType, 'causal-candidate');
  });

  it('conflict-displacement: same country code → temporally-adjacent', () => {
    const engine = new CorrelateEngine();
    engine.registerRule(conflictDisplacementRule);
    const result = engine.correlate([
      makeEvent({
        id: 'acled', domain: 'conflict', sourceId: 'acled-events',
        timestamp: NOW, entityIds: ['SD'],
        title: 'Conflict event — Sudan',
      }),
      makeEvent({
        id: 'gdacs-disp', domain: 'humanitarian', sourceId: 'gdacs-alerts',
        timestamp: NOW + 24 * 60 * 60_000, entityIds: ['SD'],
        tags: ['displacement'],
        title: 'GDACS displacement — Sudan',
      }),
    ]);
    assert.equal(result.pairs.length, 1);
    assert.equal(result.pairs[0]?.edgeType, 'temporally-adjacent');
  });
});

// ── CorrelationStore ──────────────────────────────────────────────────

describe('CorrelationStore', () => {
  beforeEach(() => { resetStore(); });

  function makePair(overrides: Partial<CorrelatedPair> = {}): CorrelatedPair {
    return {
      ruleId: 'rule-1',
      edgeType: 'co-located',
      eventA: makeEvent({ id: 'a' }),
      eventB: makeEvent({ id: 'b' }),
      confidence: 0.7,
      detectedAt: new Date(NOW),
      ...overrides,
    };
  }

  it('add and getRecent returns the most recent pair', () => {
    const store = new CorrelationStore();
    store.add(makePair());
    assert.equal(store.getRecent().length, 1);
  });

  it('add is idempotent on (ruleId + eventA.id + eventB.id)', () => {
    const store = new CorrelationStore();
    store.add(makePair());
    store.add(makePair());
    assert.equal(store.getRecent().length, 1);
  });

  it('getRecent(limitMs) honors a window relative to now', () => {
    const store = new CorrelationStore();
    store.add(makePair({ detectedAt: new Date(NOW - 10 * 60_000) }));
    store.add(makePair({
      ruleId: 'rule-2', detectedAt: new Date(NOW - 60_000),
    }));
    const recent = store.getRecent(5 * 60_000, NOW);
    assert.equal(recent.length, 1);
    assert.equal(recent[0]?.ruleId, 'rule-2');
  });

  it('getByDomains filters by either side of the pair', () => {
    const store = new CorrelationStore();
    store.add(makePair({
      eventA: makeEvent({ id: 'a', domain: 'weather' }),
      eventB: makeEvent({ id: 'b', domain: 'infra' }),
    }));
    store.add(makePair({
      ruleId: 'rule-2',
      eventA: makeEvent({ id: 'c', domain: 'maritime' }),
      eventB: makeEvent({ id: 'd', domain: 'aviation' }),
    }));
    assert.equal(store.getByDomains(['infra']).length, 1);
    assert.equal(store.getByDomains(['aviation']).length, 1);
    assert.equal(store.getByDomains(['humanitarian']).length, 0);
  });

  it('getByEdgeType filters', () => {
    const store = new CorrelationStore();
    store.add(makePair({ edgeType: 'co-located' }));
    store.add(makePair({ ruleId: 'rule-2', edgeType: 'causal-candidate' }));
    assert.equal(store.getByEdgeType('co-located').length, 1);
    assert.equal(store.getByEdgeType('causal-candidate').length, 1);
    assert.equal(store.getByEdgeType('contradicts').length, 0);
  });

  it('stats returns counts per ruleId and per edgeType', () => {
    const store = new CorrelationStore();
    store.add(makePair({ ruleId: 'r-a', edgeType: 'co-located' }));
    store.add(makePair({
      ruleId: 'r-a', edgeType: 'co-located',
      eventA: makeEvent({ id: 'a2' }), eventB: makeEvent({ id: 'b2' }),
    }));
    store.add(makePair({
      ruleId: 'r-b', edgeType: 'causal-candidate',
      eventA: makeEvent({ id: 'c' }), eventB: makeEvent({ id: 'd' }),
    }));
    const s = store.stats();
    assert.equal(s.total, 3);
    assert.equal(s.byRule['r-a'], 2);
    assert.equal(s.byRule['r-b'], 1);
    assert.equal(s.byEdgeType['co-located'], 2);
    assert.equal(s.byEdgeType['causal-candidate'], 1);
  });

  it('respects the 500-entry cap (ring buffer)', () => {
    const store = new CorrelationStore({ capacity: 4 });
    for (let i = 0; i < 6; i++) {
      store.add(makePair({
        ruleId: `r-${i}`,
        eventA: makeEvent({ id: `a-${i}` }),
        eventB: makeEvent({ id: `b-${i}` }),
      }));
    }
    assert.equal(store.stats().total, 4);
  });

  it('persists to and restores from a storage seam', () => {
    const fakeStorage: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => fakeStorage[k] ?? null,
      setItem: (k: string, v: string) => { fakeStorage[k] = v; },
    };
    const a = new CorrelationStore({ storage });
    a.add(makePair());
    const b = new CorrelationStore({ storage });
    assert.equal(b.getRecent().length, 1);
  });

  it('corrupted storage falls back to empty without throwing', () => {
    const storage = {
      getItem: () => '{not json',
      setItem: () => {},
    };
    const store = new CorrelationStore({ storage });
    assert.equal(store.getRecent().length, 0);
  });
});
