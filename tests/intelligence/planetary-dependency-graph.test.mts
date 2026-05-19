/**
 * PlanetaryDependencyGraph — deterministic unit tests.
 *
 * Covers: addNode/addEdge, getDependencies/getDependents,
 * getCascadeRisk BFS, getMostCritical, storage persist/rehydrate,
 * capacity caps, singleton lifecycle, and seed data integrity.
 *
 * No DOM, no live localStorage — injectable storage throughout.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import {
  PlanetaryDependencyGraph,
  getPlanetaryDependencyGraph,
  __internals,
  STORAGE_KEY,
  MAX_NODES,
  MAX_EDGES,
} from '../../src/services/intelligence/planetary-dependency-graph.ts';
import type {
  DependencyNode,
  DependencyEdge,
  StorageLike,
} from '../../src/services/intelligence/planetary-dependency-graph.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeStorage(initial: Record<string, string> = {}): StorageLike & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, value); },
    removeItem(key: string) { store.delete(key); },
  };
}

/** Fresh graph with no seed — clean slate for most tests. */
function makeGraph(storage: StorageLike | null = null): PlanetaryDependencyGraph {
  return new PlanetaryDependencyGraph({ storage, seed: false });
}

function node(overrides: Partial<DependencyNode> & Pick<DependencyNode, 'id'>): DependencyNode {
  return {
    name: overrides.id,
    type: 'country',
    domain: 'geopolitical',
    criticalityScore: 0.5,
    ...overrides,
  };
}

function edge(
  id: string,
  fromId: string,
  toId: string,
  overrides: Partial<DependencyEdge> = {},
): DependencyEdge {
  return {
    id,
    fromId,
    toId,
    relationshipType: 'depends-on',
    strength: 0.8,
    bidirectional: false,
    ...overrides,
  };
}

// ── Constants ─────────────────────────────────────────────────────────────

describe('constants', () => {
  it('STORAGE_KEY is wm-planetary-deps', () => {
    assert.equal(STORAGE_KEY, 'wm-planetary-deps');
  });

  it('MAX_NODES is 1000', () => {
    assert.equal(MAX_NODES, 1000);
  });

  it('MAX_EDGES is 5000', () => {
    assert.equal(MAX_EDGES, 5000);
  });
});

// ── addNode ───────────────────────────────────────────────────────────────

describe('addNode', () => {
  it('stores a node and increments count', () => {
    const g = makeGraph();
    g.addNode(node({ id: 'us' }));
    assert.equal(g.getNodeCount(), 1);
  });

  it('getNode returns a copy of the stored node', () => {
    const g = makeGraph();
    g.addNode(node({ id: 'us', criticalityScore: 0.9 }));
    const n = g.getNode('us');
    assert.equal(n?.id, 'us');
    assert.equal(n?.criticalityScore, 0.9);
  });

  it('getNode returns undefined for unknown id', () => {
    const g = makeGraph();
    assert.equal(g.getNode('xyz'), undefined);
  });

  it('overwriting a node id replaces it', () => {
    const g = makeGraph();
    g.addNode(node({ id: 'us', criticalityScore: 0.5 }));
    g.addNode(node({ id: 'us', criticalityScore: 0.9 }));
    assert.equal(g.getNodeCount(), 1);
    assert.equal(g.getNode('us')?.criticalityScore, 0.9);
  });

  it('accepts all NodeType values', () => {
    const g = makeGraph();
    const types = ['country', 'infrastructure', 'supply-chain', 'institution', 'commodity'] as const;
    for (const type of types) {
      g.addNode(node({ id: type, type }));
    }
    assert.equal(g.getNodeCount(), 5);
  });
});

// ── addEdge ───────────────────────────────────────────────────────────────

describe('addEdge', () => {
  it('stores an edge and increments count', () => {
    const g = makeGraph();
    g.addEdge(edge('e1', 'a', 'b'));
    assert.equal(g.getEdgeCount(), 1);
  });

  it('accepts all RelationshipType values', () => {
    const g = makeGraph();
    const types = ['depends-on', 'supplies', 'controls', 'competes-with', 'allies-with'] as const;
    for (const [i, rt] of types.entries()) {
      g.addEdge(edge(`e${i}`, 'a', 'b', { relationshipType: rt }));
    }
    assert.equal(g.getEdgeCount(), 5);
  });
});

// ── getDependencies ───────────────────────────────────────────────────────

describe('getDependencies', () => {
  it('returns edges where nodeId is fromId', () => {
    const g = makeGraph();
    g.addEdge(edge('e1', 'us', 'swift'));
    g.addEdge(edge('e2', 'eu', 'swift'));
    const deps = g.getDependencies('us');
    assert.equal(deps.length, 1);
    assert.equal(deps[0]!.id, 'e1');
  });

  it('returns empty for node with no outgoing edges', () => {
    const g = makeGraph();
    g.addEdge(edge('e1', 'a', 'b'));
    assert.deepEqual(g.getDependencies('b'), []);
  });

  it('includes bidirectional edges where nodeId is toId', () => {
    const g = makeGraph();
    g.addEdge(edge('e1', 'us', 'cn', { bidirectional: true }));
    const deps = g.getDependencies('cn');
    assert.equal(deps.length, 1);
    assert.equal(deps[0]!.id, 'e1');
  });

  it('does not include non-bidirectional edge when nodeId is toId', () => {
    const g = makeGraph();
    g.addEdge(edge('e1', 'us', 'cn', { bidirectional: false }));
    assert.deepEqual(g.getDependencies('cn'), []);
  });

  it('returns copies, not references', () => {
    const g = makeGraph();
    g.addEdge(edge('e1', 'us', 'cn'));
    const deps = g.getDependencies('us');
    deps[0]!.strength = 0;
    assert.equal(g.getDependencies('us')[0]!.strength, 0.8);
  });
});

// ── getDependents ─────────────────────────────────────────────────────────

describe('getDependents', () => {
  it('returns edges where nodeId is toId', () => {
    const g = makeGraph();
    g.addEdge(edge('e1', 'eu', 'swift'));
    g.addEdge(edge('e2', 'us', 'swift'));
    const deps = g.getDependents('swift');
    assert.equal(deps.length, 2);
  });

  it('returns empty when no incoming edges', () => {
    const g = makeGraph();
    g.addEdge(edge('e1', 'us', 'swift'));
    assert.deepEqual(g.getDependents('us'), []);
  });

  it('includes bidirectional edges where nodeId is fromId', () => {
    const g = makeGraph();
    g.addEdge(edge('e1', 'us', 'cn', { bidirectional: true }));
    const deps = g.getDependents('us');
    assert.equal(deps.length, 1);
  });
});

// ── getCascadeRisk ────────────────────────────────────────────────────────

describe('getCascadeRisk', () => {
  it('returns empty array for node with no depends-on edges', () => {
    const g = makeGraph();
    g.addNode(node({ id: 'island' }));
    assert.deepEqual(g.getCascadeRisk('island'), []);
  });

  it('direct depends-on neighbor gets strength as cascadeScore', () => {
    const g = makeGraph();
    g.addEdge(edge('e1', 'eu', 'hormuz', { strength: 0.75 }));
    const results = g.getCascadeRisk('eu');
    const h = results.find((r) => r.nodeId === 'hormuz');
    assert.ok(h, 'hormuz should appear');
    assert.equal(h!.cascadeScore, 0.75);
  });

  it('two-hop path score = product of edge strengths', () => {
    const g = makeGraph();
    g.addEdge(edge('e1', 'a', 'b', { strength: 0.8 }));
    g.addEdge(edge('e2', 'b', 'c', { strength: 0.5 }));
    const results = g.getCascadeRisk('a', 3);
    const c = results.find((r) => r.nodeId === 'c');
    assert.ok(c, 'c should appear');
    assert.ok(Math.abs(c!.cascadeScore - 0.4) < 0.0001);
  });

  it('respects depth limit — nodes beyond depth are excluded', () => {
    const g = makeGraph();
    g.addEdge(edge('e1', 'a', 'b', { strength: 0.9 }));
    g.addEdge(edge('e2', 'b', 'c', { strength: 0.9 }));
    g.addEdge(edge('e3', 'c', 'd', { strength: 0.9 }));
    g.addEdge(edge('e4', 'd', 'e', { strength: 0.9 }));
    const results = g.getCascadeRisk('a', 2);
    assert.ok(results.find((r) => r.nodeId === 'b'));
    assert.ok(results.find((r) => r.nodeId === 'c'));
    assert.equal(results.find((r) => r.nodeId === 'd'), undefined);
    assert.equal(results.find((r) => r.nodeId === 'e'), undefined);
  });

  it('default depth is 3', () => {
    const g = makeGraph();
    g.addEdge(edge('e1', 'a', 'b', { strength: 0.9 }));
    g.addEdge(edge('e2', 'b', 'c', { strength: 0.9 }));
    g.addEdge(edge('e3', 'c', 'd', { strength: 0.9 }));
    g.addEdge(edge('e4', 'd', 'e', { strength: 0.9 }));
    const results = g.getCascadeRisk('a');
    assert.ok(results.find((r) => r.nodeId === 'd'));
    assert.equal(results.find((r) => r.nodeId === 'e'), undefined);
  });

  it('source node is not included in results', () => {
    const g = makeGraph();
    g.addEdge(edge('e1', 'a', 'b'));
    const results = g.getCascadeRisk('a');
    assert.equal(results.find((r) => r.nodeId === 'a'), undefined);
  });

  it('does not follow non-depends-on edges', () => {
    const g = makeGraph();
    g.addEdge(edge('e1', 'us', 'cn', { relationshipType: 'competes-with', strength: 0.8 }));
    g.addEdge(edge('e2', 'us', 'swift', { relationshipType: 'controls', strength: 0.8 }));
    const results = g.getCascadeRisk('us');
    assert.deepEqual(results, []);
  });

  it('handles cycles without infinite loop', () => {
    const g = makeGraph();
    g.addEdge(edge('e1', 'a', 'b', { bidirectional: true }));
    g.addEdge(edge('e2', 'b', 'a', { bidirectional: false }));
    const results = g.getCascadeRisk('a', 5);
    assert.ok(results.length <= 2);
  });

  it('results are sorted by cascadeScore descending', () => {
    const g = makeGraph();
    g.addEdge(edge('e1', 'root', 'low', { strength: 0.3 }));
    g.addEdge(edge('e2', 'root', 'high', { strength: 0.9 }));
    g.addEdge(edge('e3', 'root', 'mid', { strength: 0.6 }));
    const results = g.getCascadeRisk('root');
    assert.equal(results[0]!.nodeId, 'high');
    assert.equal(results[1]!.nodeId, 'mid');
    assert.equal(results[2]!.nodeId, 'low');
  });
});

// ── getMostCritical ───────────────────────────────────────────────────────

describe('getMostCritical', () => {
  it('returns nodes sorted by criticalityScore descending', () => {
    const g = makeGraph();
    g.addNode(node({ id: 'a', criticalityScore: 0.3 }));
    g.addNode(node({ id: 'b', criticalityScore: 0.9 }));
    g.addNode(node({ id: 'c', criticalityScore: 0.6 }));
    const top = g.getMostCritical(3);
    assert.equal(top[0]!.id, 'b');
    assert.equal(top[1]!.id, 'c');
    assert.equal(top[2]!.id, 'a');
  });

  it('respects limit parameter', () => {
    const g = makeGraph();
    for (let i = 0; i < 20; i++) {
      g.addNode(node({ id: `n${i}`, criticalityScore: i / 20 }));
    }
    assert.equal(g.getMostCritical(5).length, 5);
  });

  it('default limit is 10', () => {
    const g = makeGraph();
    for (let i = 0; i < 15; i++) {
      g.addNode(node({ id: `n${i}` }));
    }
    assert.equal(g.getMostCritical().length, 10);
  });

  it('returns copies, not references', () => {
    const g = makeGraph();
    g.addNode(node({ id: 'a', criticalityScore: 0.8 }));
    const top = g.getMostCritical();
    top[0]!.criticalityScore = 0;
    assert.equal(g.getMostCritical()[0]!.criticalityScore, 0.8);
  });

  it('returns all nodes when count < limit', () => {
    const g = makeGraph();
    g.addNode(node({ id: 'a' }));
    g.addNode(node({ id: 'b' }));
    assert.equal(g.getMostCritical(10).length, 2);
  });
});

// ── Capacity caps ─────────────────────────────────────────────────────────

describe('capacity caps', () => {
  it('addNode silently ignores when at MAX_NODES', () => {
    const g = makeGraph();
    for (let i = 0; i < MAX_NODES; i++) {
      g.addNode(node({ id: `n${i}` }));
    }
    assert.equal(g.getNodeCount(), MAX_NODES);
    g.addNode(node({ id: 'overflow' }));
    assert.equal(g.getNodeCount(), MAX_NODES);
    assert.equal(g.getNode('overflow'), undefined);
  });

  it('addEdge silently ignores when at MAX_EDGES', () => {
    const g = makeGraph();
    for (let i = 0; i < MAX_EDGES; i++) {
      g.addEdge(edge(`e${i}`, 'a', 'b'));
    }
    assert.equal(g.getEdgeCount(), MAX_EDGES);
    g.addEdge(edge('overflow', 'a', 'b'));
    assert.equal(g.getEdgeCount(), MAX_EDGES);
  });
});

// ── Storage persist + rehydrate ───────────────────────────────────────────

describe('storage', () => {
  it('persists nodes on addNode', () => {
    const storage = makeStorage();
    const g = new PlanetaryDependencyGraph({ storage, seed: false });
    g.addNode(node({ id: 'us' }));
    assert.ok(storage.store.has(STORAGE_KEY));
    const data = JSON.parse(storage.store.get(STORAGE_KEY)!);
    assert.equal(data.nodes.length, 1);
    assert.equal(data.nodes[0].id, 'us');
  });

  it('persists edges on addEdge', () => {
    const storage = makeStorage();
    const g = new PlanetaryDependencyGraph({ storage, seed: false });
    g.addEdge(edge('e1', 'a', 'b'));
    const data = JSON.parse(storage.store.get(STORAGE_KEY)!);
    assert.equal(data.edges.length, 1);
  });

  it('rehydrates nodes from storage', () => {
    const storage = makeStorage();
    const g1 = new PlanetaryDependencyGraph({ storage, seed: false });
    g1.addNode(node({ id: 'us', criticalityScore: 0.95 }));
    const g2 = new PlanetaryDependencyGraph({ storage, seed: false });
    assert.equal(g2.getNodeCount(), 1);
    assert.equal(g2.getNode('us')?.criticalityScore, 0.95);
  });

  it('rehydrates edges from storage', () => {
    const storage = makeStorage();
    const g1 = new PlanetaryDependencyGraph({ storage, seed: false });
    g1.addEdge(edge('e1', 'us', 'cn', { strength: 0.7 }));
    const g2 = new PlanetaryDependencyGraph({ storage, seed: false });
    assert.equal(g2.getEdgeCount(), 1);
    assert.equal(g2.getDependencies('us')[0]!.strength, 0.7);
  });

  it('ignores corrupt storage gracefully', () => {
    const storage = makeStorage({ [STORAGE_KEY]: 'not-json' });
    assert.doesNotThrow(() => new PlanetaryDependencyGraph({ storage, seed: false }));
  });

  it('ignores storage with wrong shape', () => {
    const storage = makeStorage({ [STORAGE_KEY]: JSON.stringify({ nodes: 'bad', edges: [] }) });
    const g = new PlanetaryDependencyGraph({ storage, seed: false });
    assert.equal(g.getNodeCount(), 0);
  });

  it('null storage option disables persistence', () => {
    const g = new PlanetaryDependencyGraph({ storage: null, seed: false });
    g.addNode(node({ id: 'us' }));
    assert.equal(g.getNodeCount(), 1);
  });

  it('resetForTesting clears storage', () => {
    const storage = makeStorage();
    const g = new PlanetaryDependencyGraph({ storage, seed: false });
    g.addNode(node({ id: 'us' }));
    g.resetForTesting();
    assert.equal(g.getNodeCount(), 0);
    assert.equal(storage.store.has(STORAGE_KEY), false);
  });
});

// ── Initial seed ──────────────────────────────────────────────────────────

describe('initial seed', () => {
  it('seed:true populates 12 nodes', () => {
    const g = new PlanetaryDependencyGraph({ storage: null, seed: true });
    assert.equal(g.getNodeCount(), 12);
  });

  it('seed:true populates 15 edges', () => {
    const g = new PlanetaryDependencyGraph({ storage: null, seed: true });
    assert.equal(g.getEdgeCount(), 15);
  });

  it('US node has criticalityScore 0.95', () => {
    const g = new PlanetaryDependencyGraph({ storage: null, seed: true });
    assert.equal(g.getNode('us')?.criticalityScore, 0.95);
  });

  it('TSMC node has criticalityScore 0.93', () => {
    const g = new PlanetaryDependencyGraph({ storage: null, seed: true });
    assert.equal(g.getNode('tsmc')?.criticalityScore, 0.93);
  });

  it('seed is skipped when storage already has nodes', () => {
    const storage = makeStorage();
    const g1 = new PlanetaryDependencyGraph({ storage, seed: false });
    g1.addNode(node({ id: 'existing' }));
    const g2 = new PlanetaryDependencyGraph({ storage, seed: true });
    assert.equal(g2.getNodeCount(), 1);
  });

  it('all 12 canonical nodes are present', () => {
    const g = new PlanetaryDependencyGraph({ storage: null, seed: true });
    const ids = ['us', 'cn', 'eu', 'sa', 'hormuz', 'panama', 'swift', 'tsmc', 'shipping', 'ixp', 'imf', 'unsc'];
    for (const id of ids) {
      assert.ok(g.getNode(id), `missing node: ${id}`);
    }
  });

  it('getMostCritical with seed returns TSMC or US at top', () => {
    const g = new PlanetaryDependencyGraph({ storage: null, seed: true });
    const top = g.getMostCritical(1);
    assert.ok(['us', 'tsmc'].includes(top[0]!.id));
  });

  it('getCascadeRisk from EU reaches hormuz via depends-on edge', () => {
    const g = new PlanetaryDependencyGraph({ storage: null, seed: true });
    const risk = g.getCascadeRisk('eu');
    assert.ok(risk.find((r) => r.nodeId === 'hormuz'));
  });
});

// ── Singleton ─────────────────────────────────────────────────────────────

describe('singleton', () => {
  beforeEach(() => {
    PlanetaryDependencyGraph._resetForTests();
  });

  it('getInstance returns the same instance', () => {
    const a = PlanetaryDependencyGraph.getInstance();
    const b = PlanetaryDependencyGraph.getInstance();
    assert.strictEqual(a, b);
  });

  it('getPlanetaryDependencyGraph returns the singleton', () => {
    const a = PlanetaryDependencyGraph.getInstance();
    const b = getPlanetaryDependencyGraph();
    assert.strictEqual(a, b);
  });

  it('_resetForTests creates a new instance on next call', () => {
    const a = PlanetaryDependencyGraph.getInstance();
    PlanetaryDependencyGraph._resetForTests();
    const b = PlanetaryDependencyGraph.getInstance();
    assert.notStrictEqual(a, b);
  });
});

// ── __internals ───────────────────────────────────────────────────────────

describe('__internals', () => {
  it('exports SEED_NODES with 12 entries', () => {
    assert.equal(__internals.SEED_NODES.length, 12);
  });

  it('exports SEED_EDGES with 15 entries', () => {
    assert.equal(__internals.SEED_EDGES.length, 15);
  });

  it('all SEED_NODES have criticalityScore between 0 and 1', () => {
    for (const n of __internals.SEED_NODES) {
      assert.ok(n.criticalityScore >= 0 && n.criticalityScore <= 1, `${n.id} out of range`);
    }
  });

  it('all SEED_EDGES have strength between 0 and 1', () => {
    for (const e of __internals.SEED_EDGES) {
      assert.ok(e.strength >= 0 && e.strength <= 1, `${e.id} out of range`);
    }
  });
});
