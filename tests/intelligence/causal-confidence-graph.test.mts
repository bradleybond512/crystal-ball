import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAUSAL_GRAPH_KEY,
  CausalConfidenceGraph,
  MAX_EDGES,
  makeEdgeId,
  strengthFromConfidence,
  type CausalNode,
} from '@/services/intelligence/causal-confidence-graph';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
  raw(): Map<string, string> { return this.map; }
}

const BOSPHORUS: CausalNode = { id: 'bosphorus-closure', domain: 'maritime' };
const WHEAT: CausalNode = { id: 'wheat-spike', domain: 'commodity' };
const DIESEL: CausalNode = { id: 'diesel-shortage', domain: 'energy' };
const POWER: CausalNode = { id: 'rolling-blackouts', domain: 'infrastructure' };

const T0 = 1_750_000_000_000;

function fresh(storage: MemoryStorage = new MemoryStorage()): CausalConfidenceGraph {
  return CausalConfidenceGraph.resetForTests(storage);
}

// ── strengthFromConfidence ───────────────────────────────────────────────

test('strengthFromConfidence: 0 → weak', () => {
  assert.equal(strengthFromConfidence(0), 'weak');
});

test('strengthFromConfidence: 0.39 → weak', () => {
  assert.equal(strengthFromConfidence(0.39), 'weak');
});

test('strengthFromConfidence: 0.4 boundary → moderate', () => {
  assert.equal(strengthFromConfidence(0.4), 'moderate');
});

test('strengthFromConfidence: 0.55 → moderate', () => {
  assert.equal(strengthFromConfidence(0.55), 'moderate');
});

test('strengthFromConfidence: 0.7 boundary → moderate', () => {
  assert.equal(strengthFromConfidence(0.7), 'moderate');
});

test('strengthFromConfidence: 0.71 → strong', () => {
  assert.equal(strengthFromConfidence(0.71), 'strong');
});

test('strengthFromConfidence: 1 → strong', () => {
  assert.equal(strengthFromConfidence(1), 'strong');
});

// ── addEdge: insert ──────────────────────────────────────────────────────

test('addEdge: new edge gets evidenceCount 1, strength from confidence', () => {
  const g = fresh();
  const edge = g.addEdge(BOSPHORUS, WHEAT, 0.82, T0);
  assert.equal(edge.evidenceCount, 1);
  assert.equal(edge.confidence, 0.82);
  assert.equal(edge.strength, 'strong');
  assert.equal(edge.lastUpdated, T0);
});

test('addEdge: id format encodes cause and effect', () => {
  const g = fresh();
  const edge = g.addEdge(BOSPHORUS, WHEAT, 0.6, T0);
  assert.equal(edge.id, makeEdgeId('bosphorus-closure', 'wheat-spike'));
});

test('addEdge: stores cause and effect domains', () => {
  const g = fresh();
  const edge = g.addEdge(BOSPHORUS, WHEAT, 0.5, T0);
  assert.equal(edge.causeDomain, 'maritime');
  assert.equal(edge.effectDomain, 'commodity');
});

test('addEdge: out-of-range confidence is clamped to [0,1]', () => {
  const g = fresh();
  const high = g.addEdge(BOSPHORUS, WHEAT, 1.7, T0);
  const low = g.addEdge(DIESEL, POWER, -0.4, T0);
  assert.equal(high.confidence, 1);
  assert.equal(high.strength, 'strong');
  assert.equal(low.confidence, 0);
  assert.equal(low.strength, 'weak');
});

test('addEdge: non-finite confidence becomes 0', () => {
  const g = fresh();
  const edge = g.addEdge(BOSPHORUS, WHEAT, Number.NaN, T0);
  assert.equal(edge.confidence, 0);
});

// ── addEdge: rolling mean on existing edge ───────────────────────────────

test('addEdge: second observation updates confidence as proper rolling mean', () => {
  const g = fresh();
  g.addEdge(BOSPHORUS, WHEAT, 0.4, T0);
  const second = g.addEdge(BOSPHORUS, WHEAT, 0.8, T0 + 1000);
  // (0.4*1 + 0.8) / 2 = 0.6
  assert.equal(Math.round(second.confidence * 1000) / 1000, 0.6);
  assert.equal(second.evidenceCount, 2);
});

test('addEdge: third observation continues rolling mean', () => {
  const g = fresh();
  g.addEdge(BOSPHORUS, WHEAT, 0.4, T0);
  g.addEdge(BOSPHORUS, WHEAT, 0.8, T0 + 1000);
  const third = g.addEdge(BOSPHORUS, WHEAT, 0.9, T0 + 2000);
  // After step 2: confidence=0.6, count=2. Step 3: (0.6*2 + 0.9)/3 = 0.7
  assert.equal(Math.round(third.confidence * 1000) / 1000, 0.7);
  assert.equal(third.evidenceCount, 3);
});

test('addEdge: rolling mean bumps lastUpdated on every observation', () => {
  const g = fresh();
  g.addEdge(BOSPHORUS, WHEAT, 0.4, T0);
  const second = g.addEdge(BOSPHORUS, WHEAT, 0.8, T0 + 5_000);
  assert.equal(second.lastUpdated, T0 + 5_000);
});

test('addEdge: strength label flips when rolling mean crosses threshold', () => {
  const g = fresh();
  const first = g.addEdge(BOSPHORUS, WHEAT, 0.2, T0);
  assert.equal(first.strength, 'weak');
  const second = g.addEdge(BOSPHORUS, WHEAT, 0.8, T0 + 1);
  // (0.2 + 0.8)/2 = 0.5 → moderate
  assert.equal(second.strength, 'moderate');
});

test('addEdge: returns the persisted edge instance', () => {
  const g = fresh();
  const returned = g.addEdge(BOSPHORUS, WHEAT, 0.6, T0);
  const stored = g.getEdge('bosphorus-closure', 'wheat-spike');
  assert.deepEqual(stored, returned);
});

// ── getCauses ────────────────────────────────────────────────────────────

test('getCauses: returns only edges pointing to the effect', () => {
  const g = fresh();
  g.addEdge(BOSPHORUS, WHEAT, 0.6, T0);
  g.addEdge(DIESEL, WHEAT, 0.3, T0); // irrelevant cause for a different chain
  g.addEdge({ id: 'opec-cut', domain: 'policy' }, WHEAT, 0.4, T0);
  const causes = g.getCauses('wheat-spike');
  assert.equal(causes.length, 3);
  for (const e of causes) assert.equal(e.effectId, 'wheat-spike');
});

test('getCauses: sorted by confidence desc', () => {
  const g = fresh();
  g.addEdge({ id: 'a', domain: 'x' }, WHEAT, 0.4, T0);
  g.addEdge({ id: 'b', domain: 'x' }, WHEAT, 0.9, T0);
  g.addEdge({ id: 'c', domain: 'x' }, WHEAT, 0.6, T0);
  const causes = g.getCauses('wheat-spike');
  assert.deepEqual(causes.map((e) => e.causeId), ['b', 'c', 'a']);
});

test('getCauses: returns [] when nothing points at the effect', () => {
  const g = fresh();
  g.addEdge(BOSPHORUS, WHEAT, 0.6, T0);
  assert.deepEqual(g.getCauses('totally-unrelated'), []);
});

// ── getEffects ───────────────────────────────────────────────────────────

test('getEffects: returns only edges from the cause', () => {
  const g = fresh();
  g.addEdge(BOSPHORUS, WHEAT, 0.6, T0);
  g.addEdge(BOSPHORUS, DIESEL, 0.5, T0);
  g.addEdge({ id: 'opec-cut', domain: 'policy' }, DIESEL, 0.7, T0);
  const effects = g.getEffects('bosphorus-closure');
  assert.equal(effects.length, 2);
  for (const e of effects) assert.equal(e.causeId, 'bosphorus-closure');
});

test('getEffects: sorted by confidence desc', () => {
  const g = fresh();
  g.addEdge(BOSPHORUS, { id: 'a', domain: 'x' }, 0.4, T0);
  g.addEdge(BOSPHORUS, { id: 'b', domain: 'x' }, 0.9, T0);
  g.addEdge(BOSPHORUS, { id: 'c', domain: 'x' }, 0.6, T0);
  const effects = g.getEffects('bosphorus-closure');
  assert.deepEqual(effects.map((e) => e.effectId), ['b', 'c', 'a']);
});

test('getEffects: returns [] when the node has no outgoing edges', () => {
  const g = fresh();
  g.addEdge(BOSPHORUS, WHEAT, 0.6, T0);
  assert.deepEqual(g.getEffects('wheat-spike'), []);
});

// ── getChain ─────────────────────────────────────────────────────────────

test('getChain: one-hop chain returns single-edge paths', () => {
  const g = fresh();
  g.addEdge(BOSPHORUS, WHEAT, 0.6, T0);
  g.addEdge(BOSPHORUS, DIESEL, 0.5, T0);
  const chains = g.getChain('bosphorus-closure');
  assert.equal(chains.length, 2);
  for (const path of chains) {
    assert.equal(path.length, 1);
    assert.equal(path[0]?.causeId, 'bosphorus-closure');
  }
});

test('getChain: multi-hop chain follows downstream effects', () => {
  const g = fresh();
  g.addEdge(BOSPHORUS, WHEAT, 0.7, T0);
  g.addEdge(WHEAT, { id: 'food-inflation', domain: 'macro' }, 0.6, T0);
  const chains = g.getChain('bosphorus-closure');
  const long = chains.find((p) => p.length === 2);
  assert.ok(long, 'expected a 2-hop chain');
  assert.equal(long?.[0]?.effectId, 'wheat-spike');
  assert.equal(long?.[1]?.effectId, 'food-inflation');
});

test('getChain: respects maxDepth', () => {
  const g = fresh();
  g.addEdge({ id: 'n0', domain: 'x' }, { id: 'n1', domain: 'x' }, 0.6, T0);
  g.addEdge({ id: 'n1', domain: 'x' }, { id: 'n2', domain: 'x' }, 0.6, T0);
  g.addEdge({ id: 'n2', domain: 'x' }, { id: 'n3', domain: 'x' }, 0.6, T0);
  g.addEdge({ id: 'n3', domain: 'x' }, { id: 'n4', domain: 'x' }, 0.6, T0);
  const chains = g.getChain('n0', 2);
  for (const path of chains) assert.ok(path.length <= 2, `path too long: ${path.length}`);
});

test('getChain: maxDepth=0 returns []', () => {
  const g = fresh();
  g.addEdge(BOSPHORUS, WHEAT, 0.6, T0);
  assert.deepEqual(g.getChain('bosphorus-closure', 0), []);
});

test('getChain: handles cycles without infinite recursion', () => {
  const g = fresh();
  g.addEdge({ id: 'a', domain: 'x' }, { id: 'b', domain: 'x' }, 0.6, T0);
  g.addEdge({ id: 'b', domain: 'x' }, { id: 'c', domain: 'x' }, 0.6, T0);
  g.addEdge({ id: 'c', domain: 'x' }, { id: 'a', domain: 'x' }, 0.6, T0);
  const chains = g.getChain('a', 6);
  assert.ok(chains.length > 0);
  for (const path of chains) assert.ok(path.length <= 6);
});

test('getChain: node with no outgoing edges returns []', () => {
  const g = fresh();
  g.addEdge(BOSPHORUS, WHEAT, 0.6, T0);
  // wheat-spike has no outgoing edges
  assert.deepEqual(g.getChain('wheat-spike'), []);
});

test('getChain: branches enumerate independently', () => {
  const g = fresh();
  g.addEdge(BOSPHORUS, WHEAT, 0.6, T0);
  g.addEdge(BOSPHORUS, DIESEL, 0.6, T0);
  g.addEdge(WHEAT, { id: 'food-inflation', domain: 'macro' }, 0.6, T0);
  g.addEdge(DIESEL, POWER, 0.6, T0);
  const chains = g.getChain('bosphorus-closure');
  const endpoints = chains.map((p) => p.at(-1)?.effectId).sort();
  assert.deepEqual(endpoints, ['food-inflation', 'rolling-blackouts']);
});

// ── getGraphStats ────────────────────────────────────────────────────────

test('getGraphStats: nodeCount counts unique cause+effect ids', () => {
  const g = fresh();
  g.addEdge(BOSPHORUS, WHEAT, 0.6, T0);
  g.addEdge(BOSPHORUS, DIESEL, 0.5, T0);
  g.addEdge(WHEAT, DIESEL, 0.4, T0);
  // Unique nodes: bosphorus-closure, wheat-spike, diesel-shortage = 3
  assert.equal(g.getGraphStats().nodeCount, 3);
});

test('getGraphStats: edgeCount matches stored edges', () => {
  const g = fresh();
  g.addEdge(BOSPHORUS, WHEAT, 0.6, T0);
  g.addEdge(BOSPHORUS, DIESEL, 0.5, T0);
  assert.equal(g.getGraphStats().edgeCount, 2);
});

test('getGraphStats: avgConfidence is the mean over all edges', () => {
  const g = fresh();
  g.addEdge(BOSPHORUS, WHEAT, 0.2, T0);
  g.addEdge(BOSPHORUS, DIESEL, 0.6, T0);
  g.addEdge(DIESEL, POWER, 1.0, T0);
  const stats = g.getGraphStats();
  assert.equal(Math.round(stats.avgConfidence * 1000) / 1000, 0.6);
});

test('getGraphStats: strongEdgeCount counts only strong-strength edges', () => {
  const g = fresh();
  g.addEdge(BOSPHORUS, WHEAT, 0.2, T0); // weak
  g.addEdge(BOSPHORUS, DIESEL, 0.6, T0); // moderate
  g.addEdge(DIESEL, POWER, 0.85, T0); // strong
  g.addEdge(WHEAT, { id: 'food-inflation', domain: 'macro' }, 0.91, T0); // strong
  assert.equal(g.getGraphStats().strongEdgeCount, 2);
});

test('getGraphStats: empty graph yields zeros', () => {
  const g = fresh();
  assert.deepEqual(g.getGraphStats(), {
    nodeCount: 0,
    edgeCount: 0,
    avgConfidence: 0,
    strongEdgeCount: 0,
  });
});

// ── singleton + reset ────────────────────────────────────────────────────

test('getInstance: returns the same reference on repeat calls', () => {
  CausalConfidenceGraph.resetForTests(null);
  const a = CausalConfidenceGraph.getInstance();
  const b = CausalConfidenceGraph.getInstance();
  assert.equal(a, b);
});

test('resetForTests: replaces the active singleton', () => {
  const a = CausalConfidenceGraph.resetForTests(null);
  const b = CausalConfidenceGraph.resetForTests(null);
  assert.notEqual(a, b);
});

test('clear: drops all edges and writes empty storage', () => {
  const storage = new MemoryStorage();
  const g = fresh(storage);
  g.addEdge(BOSPHORUS, WHEAT, 0.6, T0);
  g.clear();
  assert.deepEqual(g.getAllEdges(), []);
  const persisted = storage.raw().get(CAUSAL_GRAPH_KEY);
  assert.equal(persisted, '[]');
});

// ── persistence ──────────────────────────────────────────────────────────

test('persistence: writes to localStorage on every addEdge', () => {
  const storage = new MemoryStorage();
  const g = fresh(storage);
  g.addEdge(BOSPHORUS, WHEAT, 0.6, T0);
  const raw = storage.raw().get(CAUSAL_GRAPH_KEY);
  assert.ok(raw, 'expected storage write after addEdge');
  const parsed = JSON.parse(raw ?? '[]');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, makeEdgeId('bosphorus-closure', 'wheat-spike'));
});

test('persistence: hydrates from prior localStorage on construction', () => {
  const storage = new MemoryStorage();
  const first = fresh(storage);
  first.addEdge(BOSPHORUS, WHEAT, 0.65, T0);
  const second = CausalConfidenceGraph.resetForTests(storage);
  assert.equal(second.getAllEdges().length, 1);
  assert.equal(second.getEdge('bosphorus-closure', 'wheat-spike')?.confidence, 0.65);
});

test('persistence: tolerates malformed JSON without throwing', () => {
  const storage = new MemoryStorage();
  storage.setItem(CAUSAL_GRAPH_KEY, '{not-json');
  const g = CausalConfidenceGraph.resetForTests(storage);
  assert.deepEqual(g.getAllEdges(), []);
});

test('persistence: drops edges with missing fields during hydration', () => {
  const storage = new MemoryStorage();
  storage.setItem(CAUSAL_GRAPH_KEY, JSON.stringify([
    { id: 'good', causeId: 'a', causeDomain: 'x', effectId: 'b', effectDomain: 'y',
      confidence: 0.5, strength: 'moderate', evidenceCount: 1, lastUpdated: T0 },
    { id: 'bad-no-strength', causeId: 'a', causeDomain: 'x', effectId: 'c',
      effectDomain: 'y', confidence: 0.5, evidenceCount: 1, lastUpdated: T0 },
    { id: 'bad-types', causeId: 'a', causeDomain: 'x', effectId: 'd',
      effectDomain: 'y', confidence: '0.5', strength: 'moderate', evidenceCount: 1, lastUpdated: T0 },
  ]));
  const g = CausalConfidenceGraph.resetForTests(storage);
  assert.equal(g.getAllEdges().length, 1);
  assert.equal(g.getAllEdges()[0]?.id, 'good');
});

test('persistence: graceful when localStorage is null', () => {
  const g = CausalConfidenceGraph.resetForTests(null);
  g.addEdge(BOSPHORUS, WHEAT, 0.6, T0);
  // Should not have thrown; in-memory edge still present
  assert.equal(g.getAllEdges().length, 1);
});

test('eviction: enforces MAX_EDGES cap by dropping oldest lastUpdated', () => {
  const g = fresh();
  // Add MAX_EDGES + 5 edges; the first 5 should be evicted in lastUpdated order.
  for (let i = 0; i < MAX_EDGES + 5; i++) {
    g.addEdge({ id: `cause-${i}`, domain: 'd' }, { id: `effect-${i}`, domain: 'd' }, 0.5, T0 + i);
  }
  assert.equal(g.getAllEdges().length, MAX_EDGES);
  // The 5 oldest edges (i = 0..4) must be gone
  for (let i = 0; i < 5; i++) {
    assert.equal(g.getEdge(`cause-${i}`, `effect-${i}`), undefined, `expected cause-${i} evicted`);
  }
  // The newest one survives
  assert.ok(g.getEdge(`cause-${MAX_EDGES + 4}`, `effect-${MAX_EDGES + 4}`));
});
