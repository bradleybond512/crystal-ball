import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  CausalChainBuilder,
  resetForTests,
  type CausalChain,
} from '../../src/services/intelligence/causal-chain.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-adapters.ts';
import type { CorrelatedPair } from '../../src/services/intelligence/correlate-engine.ts';
import type { Situation } from '../../src/services/intelligence/situation-store-v2.ts';

const NOW = 1_745_000_000_000;
const HOUR = 60 * 60_000;

function makeEvent(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'ev-' + Math.random().toString(36).slice(2, 8),
    sourceId: 'test',
    domain: 'earthquake',
    timestamp: NOW,
    severity: 'HIGH',
    title: 'Test event',
    raw: null,
    entityIds: [],
    tags: [],
    location: { lat: 35.0, lon: 139.0 },
    ...overrides,
  };
}

function makePair(eventA: ObservationEvent, eventB: ObservationEvent, overrides: Partial<CorrelatedPair> = {}): CorrelatedPair {
  return {
    ruleId: 'test-rule',
    edgeType: 'causal-candidate',
    eventA,
    eventB,
    confidence: 0.8,
    detectedAt: new Date(NOW),
    ...overrides,
  };
}

function makeSituation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 'sit-' + Math.random().toString(36).slice(2, 8),
    name: 'Test Situation',
    domain: 'earthquake',
    relatedDomains: [],
    severity: 'high',
    status: 'active',
    summary: '',
    observations: [],
    edges: [],
    entityIds: [],
    confidence: 0.7,
    startedAt: new Date(NOW),
    updatedAt: new Date(NOW),
    tags: [],
    ...overrides,
  };
}

// ── Empty / trivial chain ────────────────────────────────────────────

describe('CausalChainBuilder.buildChain — trivial', () => {
  beforeEach(() => { resetForTests(); });

  it('root with no correlations → chain with 0 links and root as sole leaf', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const root = makeEvent({ id: 'root', domain: 'earthquake' });
    const chain = b.buildChain(root, [root], []);
    assert.equal(chain.links.length, 0);
    assert.equal(chain.leafEffects.length, 1);
    assert.equal(chain.leafEffects[0]?.id, 'root');
    assert.equal(chain.longestPath, 0);
    assert.equal(chain.rootCause.id, 'root');
  });

  it('every chain carries id + situationId + builtAt + overallConfidence', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const root = makeEvent({ id: 'a' });
    const chain = b.buildChain(root, [root], []);
    assert.ok(chain.id.length > 0);
    assert.equal(chain.situationId, null);
    assert.equal(chain.builtAt, NOW);
    assert.ok(chain.overallConfidence >= 0 && chain.overallConfidence <= 1);
  });
});

// ── Simple A → B chain ──────────────────────────────────────────────

describe('CausalChainBuilder.buildChain — direct causal link', () => {
  beforeEach(() => { resetForTests(); });

  function setup(): { root: ObservationEvent; effect: ObservationEvent; pair: CorrelatedPair } {
    const root = makeEvent({ id: 'quake', domain: 'earthquake', timestamp: NOW });
    const effect = makeEvent({
      id: 'infra', domain: 'infrastructure',
      timestamp: NOW + 2 * HOUR,
      location: { lat: 35.1, lon: 139.1 },
    });
    return { root, effect, pair: makePair(root, effect) };
  }

  it('builds a single-link chain when cause-then-effect within 500km and correlated', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const { root, effect, pair } = setup();
    const chain = b.buildChain(root, [root, effect], [pair]);
    assert.equal(chain.links.length, 1);
    assert.equal(chain.links[0]?.causeId, 'quake');
    assert.equal(chain.links[0]?.effectId, 'infra');
    assert.equal(chain.longestPath, 1);
    assert.equal(chain.leafEffects.length, 1);
    assert.equal(chain.leafEffects[0]?.id, 'infra');
  });

  it('link confidence = correlation confidence × domain coupling strength', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const { root, effect } = setup();
    const pair = makePair(root, effect, { confidence: 0.8 });
    const chain = b.buildChain(root, [root, effect], [pair]);
    // earthquake → infrastructure strength = 0.7 (from BUILT_IN_DEPENDENCIES)
    // expected = 0.8 × 0.7 = 0.56
    const link = chain.links[0]!;
    assert.ok(Math.abs(link.confidence - 0.56) < 1e-4, `expected 0.56, got ${link.confidence}`);
  });

  it('link mechanism comes from the dependency description', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const { root, effect, pair } = setup();
    const chain = b.buildChain(root, [root, effect], [pair]);
    assert.match(chain.links[0]?.mechanism ?? '', /shaking|infrastructure|grid/i);
  });

  it('link delayHours comes from the dependency avgDelayHours', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const { root, effect, pair } = setup();
    const chain = b.buildChain(root, [root, effect], [pair]);
    // earthquake → infrastructure avgDelayHours = 2
    assert.equal(chain.links[0]?.delayHours, 2);
  });

  it('overallConfidence equals the link confidence for a single-link chain', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const { root, effect, pair } = setup();
    const chain = b.buildChain(root, [root, effect], [pair]);
    assert.ok(Math.abs(chain.overallConfidence - chain.links[0]!.confidence) < 1e-4);
  });
});

// ── Causal direction + filtering ────────────────────────────────────

describe('CausalChainBuilder — direction + filters', () => {
  beforeEach(() => { resetForTests(); });

  it('event before root is NOT treated as effect (causality is forward)', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const root = makeEvent({ id: 'root', timestamp: NOW });
    const earlier = makeEvent({
      id: 'earlier', domain: 'infrastructure',
      timestamp: NOW - 2 * HOUR,
      location: { lat: 35.1, lon: 139.1 },
    });
    const chain = b.buildChain(root, [root, earlier], [makePair(root, earlier)]);
    assert.equal(chain.links.length, 0);
  });

  it('event >500km from root is excluded even if correlated', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const root = makeEvent({ id: 'root', location: { lat: 35.0, lon: 139.0 } });
    const farEffect = makeEvent({
      id: 'far', domain: 'infrastructure',
      timestamp: NOW + HOUR,
      location: { lat: 50.0, lon: 10.0 }, // ~8000km away
    });
    const chain = b.buildChain(root, [root, farEffect], [makePair(root, farEffect)]);
    assert.equal(chain.links.length, 0);
  });

  it('event without a correlation to root is excluded', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const root = makeEvent({ id: 'root' });
    const orphan = makeEvent({
      id: 'orphan', domain: 'infrastructure',
      timestamp: NOW + HOUR,
      location: { lat: 35.1, lon: 139.1 },
    });
    const chain = b.buildChain(root, [root, orphan], []);
    assert.equal(chain.links.length, 0);
  });

  it('domain pair without a documented dependency is excluded', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const root = makeEvent({ id: 'root', domain: 'earthquake' });
    const oddPair = makeEvent({
      id: 'odd', domain: 'mystery-domain',
      timestamp: NOW + HOUR,
      location: { lat: 35.1, lon: 139.1 },
    });
    const chain = b.buildChain(root, [root, oddPair], [makePair(root, oddPair)]);
    assert.equal(chain.links.length, 0);
  });

  it('observation missing location is excluded from effects', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const root = makeEvent({ id: 'root' });
    const noLoc = makeEvent({
      id: 'noLoc', domain: 'infrastructure',
      timestamp: NOW + HOUR,
      location: undefined,
    });
    const chain = b.buildChain(root, [root, noLoc], [makePair(root, noLoc)]);
    assert.equal(chain.links.length, 0);
  });

  it('root missing location → no links produced (anchor unknown)', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const root = makeEvent({ id: 'root', location: undefined });
    const effect = makeEvent({
      id: 'e', domain: 'infrastructure',
      timestamp: NOW + HOUR,
      location: { lat: 35.1, lon: 139.1 },
    });
    const chain = b.buildChain(root, [root, effect], [makePair(root, effect)]);
    assert.equal(chain.links.length, 0);
  });
});

// ── Multi-link chains ───────────────────────────────────────────────

describe('CausalChainBuilder — multi-link chains', () => {
  beforeEach(() => { resetForTests(); });

  it('builds a 2-link chain: earthquake → infrastructure → ...', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const quake = makeEvent({ id: 'q', domain: 'earthquake', timestamp: NOW });
    const infra = makeEvent({
      id: 'i', domain: 'infrastructure',
      timestamp: NOW + 2 * HOUR,
      location: { lat: 35.1, lon: 139.1 },
    });
    const humanitarian = makeEvent({
      id: 'h', domain: 'humanitarian',
      timestamp: NOW + 6 * HOUR,
      location: { lat: 35.2, lon: 139.2 },
    });
    const chain = b.buildChain(
      quake,
      [quake, infra, humanitarian],
      [makePair(quake, infra), makePair(infra, humanitarian)],
    );
    assert.ok(chain.links.length >= 2, `expected 2+ links, got ${chain.links.length}`);
    assert.ok(chain.longestPath >= 2);
  });

  it('overallConfidence = product of link confidences', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const quake = makeEvent({ id: 'q', domain: 'earthquake', timestamp: NOW });
    const infra = makeEvent({
      id: 'i', domain: 'infrastructure',
      timestamp: NOW + 2 * HOUR,
      location: { lat: 35.1, lon: 139.1 },
    });
    const chain = b.buildChain(
      quake,
      [quake, infra],
      [makePair(quake, infra, { confidence: 0.8 })],
    );
    // Single link of 0.56 — product is 0.56.
    assert.ok(Math.abs(chain.overallConfidence - 0.56) < 1e-4);
  });

  it('leafEffects identifies observations with no outgoing causal links', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const quake = makeEvent({ id: 'q', domain: 'earthquake', timestamp: NOW });
    const infra = makeEvent({
      id: 'i', domain: 'infrastructure',
      timestamp: NOW + 2 * HOUR,
      location: { lat: 35.1, lon: 139.1 },
    });
    const humanitarian = makeEvent({
      id: 'h', domain: 'humanitarian',
      timestamp: NOW + 6 * HOUR,
      location: { lat: 35.2, lon: 139.2 },
    });
    const chain = b.buildChain(
      quake,
      [quake, infra, humanitarian],
      [makePair(quake, infra), makePair(infra, humanitarian)],
    );
    // infra has outgoing → humanitarian. humanitarian is a leaf.
    const leafIds = chain.leafEffects.map((e) => e.id);
    assert.ok(leafIds.includes('h'), `expected humanitarian leaf, got ${leafIds.join(',')}`);
    assert.ok(!leafIds.includes('i'), `infra should not be a leaf when it has outgoing links`);
  });

  it('longestPath counts the deepest path in links, not just link count', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const quake = makeEvent({ id: 'q', domain: 'earthquake', timestamp: NOW });
    const branchA = makeEvent({
      id: 'a', domain: 'infrastructure',
      timestamp: NOW + 2 * HOUR,
      location: { lat: 35.1, lon: 139.1 },
    });
    const branchB = makeEvent({
      id: 'b', domain: 'tsunami',
      timestamp: NOW + HOUR,
      location: { lat: 35.05, lon: 139.05 },
    });
    const chain = b.buildChain(
      quake,
      [quake, branchA, branchB],
      [makePair(quake, branchA), makePair(quake, branchB)],
    );
    // Two parallel single-link branches — longestPath = 1, not 2.
    assert.equal(chain.longestPath, 1);
    assert.ok(chain.links.length === 2);
  });

  it('evidenceObservationIds on a link includes the correlated pair endpoints', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const quake = makeEvent({ id: 'q', domain: 'earthquake', timestamp: NOW });
    const infra = makeEvent({
      id: 'i', domain: 'infrastructure',
      timestamp: NOW + 2 * HOUR,
      location: { lat: 35.1, lon: 139.1 },
    });
    const chain = b.buildChain(quake, [quake, infra], [makePair(quake, infra)]);
    const link = chain.links[0]!;
    assert.ok(link.evidenceObservationIds.includes('q'));
    assert.ok(link.evidenceObservationIds.includes('i'));
  });
});

// ── buildChainForSituation ──────────────────────────────────────────

describe('CausalChainBuilder.buildChainForSituation', () => {
  beforeEach(() => { resetForTests(); });

  it('returns null when the situation has no observations', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const chain = b.buildChainForSituation(makeSituation(), []);
    assert.equal(chain, null);
  });

  it('uses the situation as the root cause anchor (earliest observation)', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const quake = makeEvent({ id: 'q', domain: 'earthquake', timestamp: NOW });
    const infra = makeEvent({
      id: 'i', domain: 'infrastructure',
      timestamp: NOW + 2 * HOUR,
      location: { lat: 35.1, lon: 139.1 },
    });
    const situation = makeSituation({ id: 'sit-x', observations: [infra, quake] });
    const chain = b.buildChainForSituation(situation, [quake, infra]);
    assert.ok(chain);
    assert.equal(chain.situationId, 'sit-x');
    assert.equal(chain.rootCause.id, 'q');
  });
});

// ── Accessors ───────────────────────────────────────────────────────

describe('CausalChainBuilder — accessors', () => {
  beforeEach(() => { resetForTests(); });

  it('getChains returns every built chain', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    b.buildChain(makeEvent({ id: 'a' }), [makeEvent({ id: 'a' })], []);
    b.buildChain(makeEvent({ id: 'b' }), [makeEvent({ id: 'b' })], []);
    assert.equal(b.getChains().length, 2);
  });

  it('getChain returns a chain by id', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    const chain = b.buildChain(makeEvent({ id: 'a' }), [makeEvent({ id: 'a' })], []);
    assert.equal(b.getChain(chain.id)?.id, chain.id);
  });

  it('getChain returns undefined for unknown id', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    assert.equal(b.getChain('nope'), undefined);
  });
});

// ── Subscribe ───────────────────────────────────────────────────────

describe('CausalChainBuilder — subscribe', () => {
  beforeEach(() => { resetForTests(); });

  it('subscribe fires on buildChain with the constructed chain', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    let calls = 0;
    let last: CausalChain | null = null;
    b.subscribe((chain) => { calls++; last = chain; });
    const c = b.buildChain(makeEvent({ id: 'a' }), [makeEvent({ id: 'a' })], []);
    assert.equal(calls, 1);
    assert.equal(last?.id, c.id);
  });

  it('unsubscribe stops further callbacks', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    let calls = 0;
    const cb = () => { calls++; };
    b.subscribe(cb);
    b.buildChain(makeEvent({ id: 'a' }), [makeEvent({ id: 'a' })], []);
    b.unsubscribe(cb);
    b.buildChain(makeEvent({ id: 'b' }), [makeEvent({ id: 'b' })], []);
    assert.equal(calls, 1);
  });

  it('subscribe disposer also unsubscribes', () => {
    const b = new CausalChainBuilder({ now: () => NOW });
    let calls = 0;
    const off = b.subscribe(() => { calls++; });
    b.buildChain(makeEvent({ id: 'a' }), [makeEvent({ id: 'a' })], []);
    off();
    b.buildChain(makeEvent({ id: 'b' }), [makeEvent({ id: 'b' })], []);
    assert.equal(calls, 1);
  });
});

// ── Persistence ─────────────────────────────────────────────────────

describe('CausalChainBuilder — persistence', () => {
  beforeEach(() => { resetForTests(); });

  it('persists to and restores from a storage seam', () => {
    const fakeStorage: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => fakeStorage[k] ?? null,
      setItem: (k: string, v: string) => { fakeStorage[k] = v; },
    };
    const a = new CausalChainBuilder({ now: () => NOW, storage });
    a.buildChain(makeEvent({ id: 'a' }), [makeEvent({ id: 'a' })], []);
    const b = new CausalChainBuilder({ now: () => NOW, storage });
    assert.equal(b.getChains().length, 1);
  });

  it('ring buffer caps chains at supplied capacity', () => {
    const b = new CausalChainBuilder({ now: () => NOW, capacity: 3 });
    for (let i = 0; i < 5; i++) {
      b.buildChain(makeEvent({ id: `r-${i}` }), [makeEvent({ id: `r-${i}` })], []);
    }
    assert.ok(b.getChains().length <= 3);
  });

  it('corrupted storage falls back to empty', () => {
    const storage = { getItem: () => '{not-json', setItem: () => {} };
    const b = new CausalChainBuilder({ now: () => NOW, storage });
    assert.equal(b.getChains().length, 0);
  });
});
