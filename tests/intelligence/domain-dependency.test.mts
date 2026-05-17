/**
 * Tests for DomainDependencyGraph — Phase 4 cross-domain cascade risk.
 *
 * Run with: npx tsx --test tests/intelligence/domain-dependency.test.mts
 *
 * Pure-service tests against a localStorage stub + injectable clock.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const __storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => __storage.get(k) ?? null,
  setItem: (k: string, v: string) => { __storage.set(k, v); },
  removeItem: (k: string) => { __storage.delete(k); },
  clear: () => { __storage.clear(); },
  get length() { return __storage.size; },
  key: (i: number) => [...__storage.keys()][i] ?? null,
} as Storage;

import {
  BUILT_IN_DEPENDENCIES,
  DomainDependencyGraph,
  __internals as graphInternals,
  __resetDomainDependencyGraphSingleton,
  getDomainDependencyGraph,
  type DomainDependency,
} from '../../src/services/intelligence/domain-dependency.ts';

const NOW = 1_745_000_000_000;

// ── Fixtures ─────────────────────────────────────────────────────────

function dep(overrides: Partial<DomainDependency> = {}): DomainDependency {
  return {
    fromDomain: 'a',
    toDomain: 'b',
    dependencyType: 'cascade',
    strength: 0.5,
    avgDelayHours: 1,
    historicalInstances: 10,
    description: 'test edge',
    ...overrides,
  };
}

function freshGraph(edges?: readonly DomainDependency[]): DomainDependencyGraph {
  __storage.clear();
  __resetDomainDependencyGraphSingleton();
  return new DomainDependencyGraph({ clock: () => NOW, edges });
}

// ── Built-in graph integrity ─────────────────────────────────────────

test('BUILT_IN_DEPENDENCIES has at least 20 edges across at least 10 domains', () => {
  assert.ok(BUILT_IN_DEPENDENCIES.length >= 20);
  const domains = new Set<string>();
  for (const e of BUILT_IN_DEPENDENCIES) {
    domains.add(e.fromDomain);
    domains.add(e.toDomain);
  }
  assert.ok(domains.size >= 10);
});

test('every built-in edge has strength in [0, 1] and non-negative delay', () => {
  for (const e of BUILT_IN_DEPENDENCIES) {
    assert.ok(e.strength >= 0 && e.strength <= 1, `${e.fromDomain}→${e.toDomain} bad strength`);
    assert.ok(e.avgDelayHours >= 0, `${e.fromDomain}→${e.toDomain} negative delay`);
    assert.ok(e.description.length > 0);
  }
});

test('built-in graph contains the spec-required edges', () => {
  const required: Array<[string, string]> = [
    ['earthquake', 'tsunami'],
    ['earthquake', 'infrastructure'],
    ['weather', 'wildfire'],
    ['biosurveillance', 'aviation'],
    ['maritime', 'geopolitical'],
    ['geopolitical', 'maritime'],
    ['space-weather', 'infrastructure'],
    ['infrastructure', 'geopolitical'],
  ];
  for (const [from, to] of required) {
    const found = BUILT_IN_DEPENDENCIES.some((e) => e.fromDomain === from && e.toDomain === to);
    assert.ok(found, `missing edge ${from}→${to}`);
  }
});

test('built-in earthquake→tsunami carries cascade type + strength ~0.9 + delay ~0.5h', () => {
  const e = BUILT_IN_DEPENDENCIES.find((d) => d.fromDomain === 'earthquake' && d.toDomain === 'tsunami')!;
  assert.ok(e);
  assert.equal(e.dependencyType, 'cascade');
  assert.ok(Math.abs(e.strength - 0.9) < 1e-6);
  assert.ok(Math.abs(e.avgDelayHours - 0.5) < 1e-6);
});

test('built-in graph encodes all four dependency types', () => {
  const types = new Set(BUILT_IN_DEPENDENCIES.map((e) => e.dependencyType));
  for (const expected of ['cascade', 'amplification', 'inhibition'] as const) {
    assert.ok(types.has(expected), `missing ${expected} edges`);
  }
});

// ── getAllDomains / outgoing / incoming ──────────────────────────────

test('getAllDomains returns sorted unique domains across all edges', () => {
  const eng = freshGraph();
  const domains = eng.getAllDomains();
  assert.ok(domains.length >= 10);
  // Sorted alphabetically.
  for (let i = 1; i < domains.length; i++) {
    assert.ok(domains[i - 1]!.localeCompare(domains[i]!) <= 0);
  }
  // Includes a sample of expected domains.
  for (const expected of ['earthquake', 'weather', 'maritime', 'infrastructure', 'geopolitical']) {
    assert.ok(domains.includes(expected));
  }
});

test('getDependencies returns outgoing edges from a domain', () => {
  const eng = freshGraph();
  const out = eng.getDependencies('earthquake');
  assert.ok(out.length >= 3);
  for (const e of out) assert.equal(e.fromDomain, 'earthquake');
});

test('getDependencies returns empty array for unknown domain', () => {
  const eng = freshGraph();
  assert.deepEqual(eng.getDependencies('does-not-exist'), []);
});

test('getDependencies returns defensive copies', () => {
  const eng = freshGraph();
  const a = eng.getDependencies('earthquake');
  a[0]!.strength = 99;
  const b = eng.getDependencies('earthquake');
  assert.notEqual(b[0]!.strength, 99);
});

test('getIncomingDependencies returns incoming edges into a domain', () => {
  const eng = freshGraph();
  const into = eng.getIncomingDependencies('infrastructure');
  assert.ok(into.length >= 4);
  for (const e of into) assert.equal(e.toDomain, 'infrastructure');
});

test('getIncomingDependencies returns empty array for unknown domain', () => {
  const eng = freshGraph();
  assert.deepEqual(eng.getIncomingDependencies('does-not-exist'), []);
});

// ── findCascadePaths ─────────────────────────────────────────────────

test('findCascadePaths from earthquake at depth 1 returns direct outgoing edges only', () => {
  const eng = freshGraph();
  const paths = eng.findCascadePaths('earthquake', 1);
  // Each path has exactly 2 nodes (source + 1 target) and 1 edge.
  for (const p of paths) {
    assert.equal(p.nodes.length, 2);
    assert.equal(p.edges.length, 1);
    assert.equal(p.nodes[0], 'earthquake');
  }
  assert.ok(paths.length >= 3);
});

test('findCascadePaths respects maxDepth — depth 2 produces 1- and 2-hop paths', () => {
  const eng = freshGraph();
  const paths = eng.findCascadePaths('earthquake', 2);
  const depths = new Set(paths.map((p) => p.edges.length));
  assert.ok(depths.has(1));
  assert.ok(depths.has(2));
  assert.ok(!depths.has(3));
});

test('findCascadePaths default depth is 3', () => {
  const eng = freshGraph();
  const paths = eng.findCascadePaths('earthquake');
  const maxDepth = Math.max(...paths.map((p) => p.edges.length));
  assert.equal(maxDepth, 3);
});

test('findCascadePaths excludes cycles — no node appears twice on a single path', () => {
  const eng = freshGraph();
  const paths = eng.findCascadePaths('geopolitical', 3);
  for (const p of paths) {
    const unique = new Set(p.nodes);
    assert.equal(unique.size, p.nodes.length, `cycle on path ${p.nodes.join('→')}`);
  }
});

test('findCascadePaths totalStrength is the product of edge strengths', () => {
  const eng = freshGraph([
    dep({ fromDomain: 'a', toDomain: 'b', strength: 0.5 }),
    dep({ fromDomain: 'b', toDomain: 'c', strength: 0.4 }),
  ]);
  const paths = eng.findCascadePaths('a', 3);
  const ab = paths.find((p) => p.nodes.join('→') === 'a→b')!;
  const abc = paths.find((p) => p.nodes.join('→') === 'a→b→c')!;
  assert.ok(Math.abs(ab.totalStrength - 0.5) < 1e-9);
  assert.ok(Math.abs(abc.totalStrength - 0.2) < 1e-9);
});

test('findCascadePaths estimatedPropagationHours is the sum of edge delays', () => {
  const eng = freshGraph([
    dep({ fromDomain: 'a', toDomain: 'b', avgDelayHours: 2 }),
    dep({ fromDomain: 'b', toDomain: 'c', avgDelayHours: 4 }),
  ]);
  const paths = eng.findCascadePaths('a', 3);
  const abc = paths.find((p) => p.nodes.join('→') === 'a→b→c')!;
  assert.equal(abc.estimatedPropagationHours, 6);
});

test('findCascadePaths from unknown domain returns empty array', () => {
  const eng = freshGraph();
  assert.deepEqual(eng.findCascadePaths('does-not-exist'), []);
});

test('findCascadePaths with maxDepth=0 returns empty array', () => {
  const eng = freshGraph();
  assert.deepEqual(eng.findCascadePaths('earthquake', 0), []);
});

test('findCascadePaths negative maxDepth clamps to 0 (empty)', () => {
  const eng = freshGraph();
  assert.deepEqual(eng.findCascadePaths('earthquake', -5), []);
});

// ── computeCascadeRisk ───────────────────────────────────────────────

test('computeCascadeRisk produces a CascadeRisk with required fields', () => {
  const eng = freshGraph();
  const risk = eng.computeCascadeRisk('earthquake', 1);
  assert.equal(risk.sourceDomain, 'earthquake');
  assert.ok(risk.affectedDomains.length > 0);
  assert.ok(risk.propagationPaths.length > 0);
  assert.equal(risk.totalExposedDomains, risk.affectedDomains.length);
  assert.ok(risk.estimatedPeakHours > 0);
});

test('computeCascadeRisk affectedDomains excludes the source domain itself', () => {
  const eng = freshGraph();
  const risk = eng.computeCascadeRisk('earthquake', 1);
  assert.ok(!risk.affectedDomains.includes('earthquake'));
});

test('computeCascadeRisk affectedDomains is alphabetically sorted', () => {
  const eng = freshGraph();
  const risk = eng.computeCascadeRisk('earthquake', 1);
  for (let i = 1; i < risk.affectedDomains.length; i++) {
    assert.ok(risk.affectedDomains[i - 1]!.localeCompare(risk.affectedDomains[i]!) <= 0);
  }
});

test('computeCascadeRisk scales strength by source severity', () => {
  const eng = freshGraph();
  const full = eng.computeCascadeRisk('earthquake', 1);
  const half = eng.computeCascadeRisk('earthquake', 0.5);
  // For matching paths, halved severity → halved totalStrength.
  const fullByKey = new Map(full.propagationPaths.map((p) => [p.nodes.join('→'), p.totalStrength]));
  const halfByKey = new Map(half.propagationPaths.map((p) => [p.nodes.join('→'), p.totalStrength]));
  for (const [key, h] of halfByKey) {
    const f = fullByKey.get(key)!;
    assert.ok(Math.abs(h - f / 2) < 1e-3, `${key}: ${h} vs ${f}/2`);
  }
});

test('computeCascadeRisk clamps severity input to [0, 1]', () => {
  const eng = freshGraph();
  const negRisk = eng.computeCascadeRisk('earthquake', -1);
  // Negative severity clamps to 0 → totalStrength = 0 across all paths.
  for (const p of negRisk.propagationPaths) {
    assert.equal(p.totalStrength, 0);
  }
  const huge = eng.computeCascadeRisk('earthquake', 99);
  // > 1 clamps to 1 → strengths match the underlying product unchanged.
  const ref = eng.computeCascadeRisk('earthquake', 1);
  const hugeByKey = new Map(huge.propagationPaths.map((p) => [p.nodes.join('→'), p.totalStrength]));
  for (const p of ref.propagationPaths) {
    assert.ok(Math.abs((hugeByKey.get(p.nodes.join('→')) ?? -1) - p.totalStrength) < 1e-9);
  }
});

test('computeCascadeRisk estimatedPeakHours is the maximum path delay', () => {
  const eng = freshGraph([
    dep({ fromDomain: 'a', toDomain: 'b', avgDelayHours: 1 }),
    dep({ fromDomain: 'b', toDomain: 'c', avgDelayHours: 3 }),
    dep({ fromDomain: 'a', toDomain: 'd', avgDelayHours: 10 }),
  ]);
  const risk = eng.computeCascadeRisk('a', 1);
  assert.equal(risk.estimatedPeakHours, 10);
});

test('computeCascadeRisk on unknown source returns empty paths + zero peak', () => {
  const eng = freshGraph();
  const risk = eng.computeCascadeRisk('does-not-exist', 1);
  assert.equal(risk.propagationPaths.length, 0);
  assert.equal(risk.totalExposedDomains, 0);
  assert.equal(risk.estimatedPeakHours, 0);
});

test('computeCascadeRisk replaces an existing risk for the same source', () => {
  const eng = freshGraph();
  eng.computeCascadeRisk('earthquake', 0.5);
  eng.computeCascadeRisk('earthquake', 1);
  const risks = eng.getActiveRisks();
  const forSource = risks.filter((r) => r.sourceDomain === 'earthquake');
  assert.equal(forSource.length, 1);
});

// ── Active risk storage ──────────────────────────────────────────────

test('getActiveRisks returns recorded risks (defensive copies)', () => {
  const eng = freshGraph();
  eng.computeCascadeRisk('earthquake', 1);
  const a = eng.getActiveRisks();
  a[0]!.affectedDomains.push('mutated');
  const b = eng.getActiveRisks();
  assert.ok(!b[0]!.affectedDomains.includes('mutated'));
});

test('getRisk returns the latest risk for a given source', () => {
  const eng = freshGraph();
  eng.computeCascadeRisk('earthquake', 0.5);
  eng.computeCascadeRisk('weather', 1);
  assert.equal(eng.getRisk('earthquake')?.sourceDomain, 'earthquake');
  assert.equal(eng.getRisk('does-not-exist'), undefined);
});

test('ring buffer at MAX_RISKS + 1 evicts oldest', () => {
  // Synthesise distinct sources so each computeCascadeRisk lands on its
  // own row rather than replacing the previous one.
  const fakeEdges: DomainDependency[] = [];
  const sources: string[] = [];
  const max = graphInternals.MAX_RISKS;
  for (let i = 0; i < max + 3; i++) {
    sources.push(`src-${i}`);
    fakeEdges.push(dep({ fromDomain: `src-${i}`, toDomain: 'target', strength: 0.5, avgDelayHours: 1 }));
  }
  const eng = freshGraph(fakeEdges);
  for (const s of sources) eng.computeCascadeRisk(s, 1);
  assert.equal(eng.getActiveRisks().length, max);
  // Oldest 3 evicted.
  assert.equal(eng.getRisk('src-0'), undefined);
  assert.equal(eng.getRisk('src-2'), undefined);
  assert.ok(eng.getRisk(`src-${max + 2}`));
});

test('risks persist across instances via localStorage', () => {
  const a = freshGraph();
  a.computeCascadeRisk('earthquake', 1);
  const b = new DomainDependencyGraph({ clock: () => NOW });
  assert.ok(b.getRisk('earthquake'));
});

test('corrupt persisted blob does not crash hydrate', () => {
  __storage.clear();
  __resetDomainDependencyGraphSingleton();
  __storage.set(graphInternals.STORAGE_KEY, '{not valid');
  const eng = new DomainDependencyGraph({ clock: () => NOW });
  assert.deepEqual(eng.getActiveRisks(), []);
});

// ── Subscribe / singleton ────────────────────────────────────────────

test('subscribe fires on each computeCascadeRisk call', () => {
  const eng = freshGraph();
  let calls = 0;
  eng.subscribe(() => { calls += 1; });
  eng.computeCascadeRisk('earthquake', 1);
  eng.computeCascadeRisk('weather', 1);
  assert.equal(calls, 2);
});

test('subscribe listener exception is isolated', () => {
  const eng = freshGraph();
  eng.subscribe(() => { throw new Error('boom'); });
  let secondCalled = false;
  eng.subscribe(() => { secondCalled = true; });
  eng.computeCascadeRisk('earthquake', 1);
  assert.equal(secondCalled, true);
});

test('getDomainDependencyGraph() returns a stable singleton', () => {
  __storage.clear();
  __resetDomainDependencyGraphSingleton();
  const a = getDomainDependencyGraph();
  const b = getDomainDependencyGraph();
  assert.strictEqual(a, b);
});

// ── pathStrength / pathDelay helpers ────────────────────────────────

test('pathStrength on empty edge list returns 1 (multiplicative identity)', () => {
  assert.equal(graphInternals.pathStrength([]), 1);
});

test('pathDelay on empty edge list returns 0 (additive identity)', () => {
  assert.equal(graphInternals.pathDelay([]), 0);
});
