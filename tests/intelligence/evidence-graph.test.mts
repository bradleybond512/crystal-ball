/**
 * Tests for EvidenceGraphV2 + the assembleSituationEvidence bridge.
 *
 * The graph is a pure data structure — no localStorage / DOM stubs
 * required. Each test builds its own graph + Situation, so order
 * doesn't matter.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EvidenceGraphV2,
  __internals,
  __resetEvidenceGraphSingleton,
  getEvidenceGraph,
  type GraphNode,
} from '../../src/services/intelligence/evidence-graph-v2.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-adapters.ts';
import type {
  EvidenceEdge,
  EvidenceEdgeType,
  Situation,
} from '../../src/services/intelligence/situation-store-v2.ts';
import { assembleSituationEvidence } from '../../src/services/intelligence/evidence-graph-bridge.ts';

// ── Helpers ───────────────────────────────────────────────────────────

const NOW = 1_745_000_000_000;

function makeObservation(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'obs',
    sourceId: 'src',
    domain: 'weather',
    timestamp: NOW,
    severity: 'MEDIUM',
    title: 'Test observation',
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function makeEdge(
  source: string,
  target: string,
  overrides: Partial<EvidenceEdge> = {},
): EvidenceEdge {
  return {
    type: 'co-located',
    sourceEventId: source,
    targetEventId: target,
    confidence: 0.8,
    ...overrides,
  };
}

function makeSituation(
  observations: ObservationEvent[],
  edges: EvidenceEdge[],
  overrides: Partial<Situation> = {},
): Situation {
  return {
    id: 'sit-1',
    name: 'Test situation',
    domain: 'weather',
    relatedDomains: [],
    severity: 'medium',
    status: 'active',
    summary: 'Test',
    observations,
    edges,
    entityIds: [],
    confidence: 0.7,
    startedAt: new Date(NOW),
    updatedAt: new Date(NOW),
    tags: [],
    ...overrides,
  };
}

// ── buildFromSituation ────────────────────────────────────────────────

test('buildFromSituation indexes all observations as nodes', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    [makeObservation({ id: 'a' }), makeObservation({ id: 'b' })],
    [],
  ));
  assert.equal(graph.stats().nodeCount, 2);
});

test('buildFromSituation indexes edges on both endpoints', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    [makeObservation({ id: 'a' }), makeObservation({ id: 'b' })],
    [makeEdge('a', 'b')],
  ));
  const a = graph.getNode('a')!;
  const b = graph.getNode('b')!;
  assert.equal(a.outgoingEdges.length, 1);
  assert.equal(b.incomingEdges.length, 1);
});

test('buildFromSituation is idempotent on re-add', () => {
  const graph = new EvidenceGraphV2();
  const sit = makeSituation(
    [makeObservation({ id: 'a' }), makeObservation({ id: 'b' })],
    [makeEdge('a', 'b')],
  );
  graph.buildFromSituation(sit);
  graph.buildFromSituation(sit);
  assert.equal(graph.stats().edgeCount, 1);
});

test('buildFromSituations merges across multiple Situations', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituations([
    makeSituation([makeObservation({ id: 'a' })], [], { id: 's1' }),
    makeSituation([makeObservation({ id: 'a' }), makeObservation({ id: 'b' })], [makeEdge('a', 'b')], { id: 's2' }),
  ]);
  const a = graph.getNode('a')!;
  assert.deepEqual(a.situationIds.sort(), ['s1', 's2']);
  assert.equal(graph.stats().nodeCount, 2);
  assert.equal(graph.stats().edgeCount, 1);
});

// ── getNode / getNeighbors ───────────────────────────────────────────

test('getNode returns undefined for unknown ids', () => {
  const graph = new EvidenceGraphV2();
  assert.equal(graph.getNode('nope'), undefined);
});

test('getNeighbors returns adjacent nodes in both directions', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    [makeObservation({ id: 'a' }), makeObservation({ id: 'b' }), makeObservation({ id: 'c' })],
    [makeEdge('a', 'b'), makeEdge('c', 'a')],
  ));
  const neighbors = graph.getNeighbors('a').map((n) => n.id).sort();
  assert.deepEqual(neighbors, ['b', 'c']);
});

test('getNeighbors filters by edgeType', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    [makeObservation({ id: 'a' }), makeObservation({ id: 'b' }), makeObservation({ id: 'c' })],
    [
      makeEdge('a', 'b', { type: 'caused_by' }),
      makeEdge('a', 'c', { type: 'contradicts' }),
    ],
  ));
  const causal = graph.getNeighbors('a', ['caused_by']).map((n) => n.id);
  assert.deepEqual(causal, ['b']);
});

test('getNeighbors returns empty when node not in graph', () => {
  const graph = new EvidenceGraphV2();
  assert.deepEqual(graph.getNeighbors('missing'), []);
});

// ── bfs / dfs ─────────────────────────────────────────────────────────

test('bfs visits all reachable nodes in breadth-first order', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    ['a', 'b', 'c', 'd'].map((id) => makeObservation({ id })),
    [makeEdge('a', 'b'), makeEdge('a', 'c'), makeEdge('b', 'd')],
  ));
  const order = graph.bfs('a').map((n) => n.id);
  assert.equal(order[0], 'a');
  // d (depth 2) must come after b and c (depth 1).
  assert.ok(order.indexOf('d') > order.indexOf('b'));
  assert.ok(order.indexOf('d') > order.indexOf('c'));
});

test('bfs respects maxDepth', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    ['a', 'b', 'c'].map((id) => makeObservation({ id })),
    [makeEdge('a', 'b'), makeEdge('b', 'c')],
  ));
  const ids = graph.bfs('a', 1).map((n) => n.id).sort();
  assert.deepEqual(ids, ['a', 'b']);
});

test('dfs visits all reachable nodes', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    ['a', 'b', 'c'].map((id) => makeObservation({ id })),
    [makeEdge('a', 'b'), makeEdge('b', 'c')],
  ));
  const ids = graph.dfs('a').map((n) => n.id).sort();
  assert.deepEqual(ids, ['a', 'b', 'c']);
});

test('dfs respects maxDepth=0 (only the start node)', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    ['a', 'b'].map((id) => makeObservation({ id })),
    [makeEdge('a', 'b')],
  ));
  const ids = graph.dfs('a', 0).map((n) => n.id);
  assert.deepEqual(ids, ['a']);
});

test('bfs / dfs return [] for unknown start ids', () => {
  const graph = new EvidenceGraphV2();
  assert.deepEqual(graph.bfs('nope'), []);
  assert.deepEqual(graph.dfs('nope'), []);
});

// ── shortestPath ─────────────────────────────────────────────────────

test('shortestPath finds a single-edge path', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    [makeObservation({ id: 'a' }), makeObservation({ id: 'b' })],
    [makeEdge('a', 'b', { confidence: 0.9 })],
  ));
  const path = graph.shortestPath('a', 'b')!;
  assert.equal(path.nodes.length, 2);
  assert.equal(path.edges.length, 1);
  assert.equal(path.totalConfidence, 0.9);
});

test('shortestPath prefers higher-confidence routes', () => {
  const graph = new EvidenceGraphV2();
  // Direct path a→c confidence 0.4 (weight 0.6); two-hop a→b→c
  // confidence 0.95*0.95=0.9025 (weight 0.05+0.05=0.10) — prefer
  // the two-hop because it has lower aggregate weight.
  graph.buildFromSituation(makeSituation(
    [makeObservation({ id: 'a' }), makeObservation({ id: 'b' }), makeObservation({ id: 'c' })],
    [
      makeEdge('a', 'c', { confidence: 0.4 }),
      makeEdge('a', 'b', { confidence: 0.95 }),
      makeEdge('b', 'c', { confidence: 0.95 }),
    ],
  ));
  const path = graph.shortestPath('a', 'c')!;
  assert.equal(path.nodes.length, 3);
  assert.equal(path.edges.length, 2);
});

test('shortestPath returns single-node path when from === to', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation([makeObservation({ id: 'a' })], []));
  const path = graph.shortestPath('a', 'a')!;
  assert.equal(path.nodes.length, 1);
  assert.equal(path.edges.length, 0);
  assert.equal(path.totalConfidence, 1);
});

test('shortestPath returns null for disconnected nodes', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    [makeObservation({ id: 'a' }), makeObservation({ id: 'b' })],
    [],
  ));
  assert.equal(graph.shortestPath('a', 'b'), null);
});

test('shortestPath returns null when either endpoint is missing', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation([makeObservation({ id: 'a' })], []));
  assert.equal(graph.shortestPath('a', 'missing'), null);
  assert.equal(graph.shortestPath('missing', 'a'), null);
});

test('shortestPath dominantEdgeType is the most frequent type along the path', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    ['a', 'b', 'c', 'd'].map((id) => makeObservation({ id })),
    [
      makeEdge('a', 'b', { type: 'confirms' }),
      makeEdge('b', 'c', { type: 'confirms' }),
      makeEdge('c', 'd', { type: 'caused_by' }),
    ],
  ));
  const path = graph.shortestPath('a', 'd')!;
  assert.equal(path.dominantEdgeType, 'confirms');
});

// ── Edge-type / strong / contradiction lookups ───────────────────────

test('getByEdgeType returns only edges of that type', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    [makeObservation({ id: 'a' }), makeObservation({ id: 'b' }), makeObservation({ id: 'c' })],
    [
      makeEdge('a', 'b', { type: 'confirms' }),
      makeEdge('a', 'c', { type: 'caused_by' }),
    ],
  ));
  const confirms = graph.getByEdgeType('confirms');
  assert.equal(confirms.length, 1);
  assert.equal(confirms[0]!.targetEventId, 'b');
});

test('getStrongEdges filters by confidence threshold (default 0.7)', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    [makeObservation({ id: 'a' }), makeObservation({ id: 'b' }), makeObservation({ id: 'c' })],
    [makeEdge('a', 'b', { confidence: 0.9 }), makeEdge('a', 'c', { confidence: 0.5 })],
  ));
  assert.equal(graph.getStrongEdges().length, 1);
  assert.equal(graph.getStrongEdges(0.4).length, 2);
});

test('getContradictions returns only contradicts edges', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    [makeObservation({ id: 'a' }), makeObservation({ id: 'b' }), makeObservation({ id: 'c' })],
    [
      makeEdge('a', 'b', { type: 'contradicts', confidence: 0.85 }),
      makeEdge('a', 'c', { type: 'co-located' }),
    ],
  ));
  const contradictions = graph.getContradictions();
  assert.equal(contradictions.length, 1);
  assert.equal(contradictions[0]!.type, 'contradicts');
});

// ── propagateConfidence ─────────────────────────────────────────────

test('propagateConfidence anchors the start node at 1.0', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation([makeObservation({ id: 'a' })], []));
  const map = graph.propagateConfidence('a');
  assert.equal(map.get('a'), 1);
});

test('propagateConfidence multiplies along a chain', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    ['a', 'b', 'c'].map((id) => makeObservation({ id })),
    [makeEdge('a', 'b', { confidence: 0.8 }), makeEdge('b', 'c', { confidence: 0.5 })],
  ));
  const map = graph.propagateConfidence('a');
  assert.equal(map.get('b'), 0.8);
  // 1.0 * 0.8 * 0.5 = 0.4
  assert.equal(map.get('c'), 0.4);
});

test('propagateConfidence picks the best route when alternatives exist', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    ['a', 'b', 'c'].map((id) => makeObservation({ id })),
    [
      makeEdge('a', 'b', { confidence: 0.9 }),
      makeEdge('b', 'c', { confidence: 0.9 }),
      makeEdge('a', 'c', { confidence: 0.5 }),
    ],
  ));
  const map = graph.propagateConfidence('a');
  // 0.9 * 0.9 = 0.81 vs direct 0.5; expect 0.81
  assert.ok(map.get('c')! >= 0.8);
});

test('propagateConfidence returns empty map for unknown start ids', () => {
  const graph = new EvidenceGraphV2();
  const map = graph.propagateConfidence('nope');
  assert.equal(map.size, 0);
});

// ── stats ───────────────────────────────────────────────────────────

test('stats counts nodes, edges, and edge types accurately', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    ['a', 'b', 'c'].map((id) => makeObservation({ id })),
    [
      makeEdge('a', 'b', { type: 'confirms', confidence: 0.9 }),
      makeEdge('a', 'c', { type: 'contradicts', confidence: 0.7 }),
    ],
  ));
  const s = graph.stats();
  assert.equal(s.nodeCount, 3);
  assert.equal(s.edgeCount, 2);
  assert.equal(s.byEdgeType.confirms, 1);
  assert.equal(s.byEdgeType.contradicts, 1);
  assert.equal(s.byEdgeType.caused_by, 0);
  // (0.9 + 0.7) / 2 = 0.8
  assert.equal(s.averageConfidence, 0.8);
});

test('stats identifies the most-connected node', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    ['hub', 'a', 'b'].map((id) => makeObservation({ id })),
    [makeEdge('hub', 'a'), makeEdge('hub', 'b')],
  ));
  assert.equal(graph.stats().mostConnectedNodeId, 'hub');
});

test('stats counts isolated nodes', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    [makeObservation({ id: 'a' }), makeObservation({ id: 'lonely' })],
    [],
  ));
  assert.equal(graph.stats().isolatedNodeCount, 2);
});

test('stats on empty graph returns zeroes + nulls', () => {
  const s = new EvidenceGraphV2().stats();
  assert.equal(s.nodeCount, 0);
  assert.equal(s.edgeCount, 0);
  assert.equal(s.mostConnectedNodeId, null);
});

// ── clear / aggregateConfidence / singleton ─────────────────────────

test('clear() resets the graph to empty', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation([makeObservation({ id: 'a' })], []));
  graph.clear();
  assert.equal(graph.stats().nodeCount, 0);
});

test('aggregateConfidence on a node is the mean of its touching edges', () => {
  const graph = new EvidenceGraphV2();
  graph.buildFromSituation(makeSituation(
    ['a', 'b', 'c'].map((id) => makeObservation({ id })),
    [makeEdge('a', 'b', { confidence: 0.6 }), makeEdge('c', 'a', { confidence: 0.8 })],
  ));
  const a = graph.getNode('a')!;
  // mean of (0.6, 0.8) = 0.7
  assert.equal(a.aggregateConfidence, 0.7);
});

test('getEvidenceGraph returns a stable singleton', () => {
  __resetEvidenceGraphSingleton();
  const a = getEvidenceGraph();
  const b = getEvidenceGraph();
  assert.equal(a, b);
});

// ── Bridge: assembleSituationEvidence ───────────────────────────────

test('assembleSituationEvidence populates confirming from strong confirms+co-located edges', () => {
  const a = makeObservation({ id: 'a', sourceId: 'src-a' });
  const b = makeObservation({ id: 'b', sourceId: 'src-b' });
  const sit = makeSituation([a, b], [makeEdge('a', 'b', { type: 'confirms', confidence: 0.9 })]);
  const out = assembleSituationEvidence(sit, { now: NOW });
  assert.equal(out.situationId, 'sit-1');
  assert.equal(out.confirming.length, 2);
});

test('assembleSituationEvidence populates contradicting from contradicts edges', () => {
  const a = makeObservation({ id: 'a' });
  const b = makeObservation({ id: 'b' });
  const sit = makeSituation([a, b], [
    makeEdge('a', 'b', { type: 'contradicts', confidence: 0.8, ruleId: 'opposing' }),
  ]);
  const out = assembleSituationEvidence(sit, { now: NOW });
  assert.equal(out.contradicting.length, 1);
  assert.match(out.contradicting[0]!.reason, /opposing/);
});

test('assembleSituationEvidence flags stale observations beyond their refresh budget', () => {
  // weather budget is 10 min; observation is 30 min old
  const oldObs = makeObservation({ id: 'a', domain: 'weather', timestamp: NOW - 30 * 60_000 });
  const sit = makeSituation([oldObs], [], { domain: 'weather' });
  const out = assembleSituationEvidence(sit, { now: NOW });
  assert.equal(out.stale.length, 1);
  assert.equal(out.stale[0]!.sourceId, oldObs.sourceId);
});

test('assembleSituationEvidence confidenceBreakdown is normalized to sum 1', () => {
  const sit = makeSituation(
    ['a', 'b', 'c'].map((id) => makeObservation({ id })),
    [
      makeEdge('a', 'b', { type: 'confirms', confidence: 0.9 }),
      makeEdge('a', 'c', { type: 'caused_by', confidence: 0.8 }),
    ],
  );
  const out = assembleSituationEvidence(sit, { now: NOW });
  const sum = Object.values(out.confidenceBreakdown).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-3, `expected sum ~1, got ${sum}`);
});

test('assembleSituationEvidence detects missing expected signals per domain', () => {
  // earthquake situation with no shakemap / tsunami evidence
  const obs = makeObservation({ id: 'a', sourceId: 'usgs-earthquake', domain: 'earthquake' });
  const sit = makeSituation([obs], [], { domain: 'earthquake' });
  const out = assembleSituationEvidence(sit, { now: NOW });
  const labels = out.missing.map((m) => m.expectedSignal);
  assert.ok(labels.some((l) => l.includes('ShakeMap')));
  assert.ok(labels.some((l) => l.includes('tsunami')));
});

test('assembleSituationEvidence lastVerified picks newest confirming source or fallback', () => {
  const a = makeObservation({ id: 'a', timestamp: NOW - 1000 });
  const b = makeObservation({ id: 'b', timestamp: NOW - 500 });
  const sit = makeSituation([a, b], [makeEdge('a', 'b', { type: 'confirms', confidence: 0.9 })]);
  const out = assembleSituationEvidence(sit, { now: NOW });
  assert.equal(out.lastVerified, NOW - 500);
});

// ── Internals ──────────────────────────────────────────────────────

test('__internals.edgeKey collapses (a→b) and (b→a) of the same type/rule', () => {
  const k1 = __internals.edgeKey({ type: 'confirms', sourceEventId: 'a', targetEventId: 'b', confidence: 1 });
  const k2 = __internals.edgeKey({ type: 'confirms', sourceEventId: 'b', targetEventId: 'a', confidence: 1 });
  assert.equal(k1, k2);
});

test('__internals.dominantEdgeType falls back to confirms on empty input', () => {
  assert.equal(__internals.dominantEdgeType([]), 'confirms');
});

// reference the unused imports so strict tsconfigs don't complain
test('teardown — references types', () => {
  __resetEvidenceGraphSingleton();
  const _n: GraphNode | undefined = undefined;
  const _t: EvidenceEdgeType = 'confirms';
  void _n; void _t;
  assert.ok(true);
});
