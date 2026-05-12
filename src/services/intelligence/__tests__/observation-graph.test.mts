import assert from 'node:assert/strict';
import test from 'node:test';

import { createObservationGraph } from '../observation-graph.ts';
import type { ObservationEvent } from '@/types/intelligence';

// ── Helpers ────────────────────────────────────────────────────────────────

const NOW = 1_745_000_000_000;

function makeEvent(overrides: Partial<ObservationEvent> & { id: string }): ObservationEvent {
  return {
    sourceId: 'test',
    domain: 'seismic',
    timestamp: NOW,
    severity: 'MEDIUM',
    title: overrides.id,
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

// ── addEdge / getEdges ──────────────────────────────────────────────────────

test('addEdge stores edge retrievable by getEdges', () => {
  const g = createObservationGraph();
  g.addEdge('a', 'b', 'correlated', 0.7);
  const edges = g.getEdges('a');
  assert.equal(edges.length, 1);
  assert.equal(edges[0]!.from, 'a');
  assert.equal(edges[0]!.to, 'b');
  assert.equal(edges[0]!.type, 'correlated');
  assert.equal(edges[0]!.confidence, 0.7);
});

test('getEdges returns edges where event is either from or to', () => {
  const g = createObservationGraph();
  g.addEdge('a', 'b', 'correlated', 0.5);
  g.addEdge('c', 'a', 'co_located', 0.8);
  const edges = g.getEdges('a');
  assert.equal(edges.length, 2);
});

test('addEdge deduplicates same (from,to,type) keeping higher confidence', () => {
  const g = createObservationGraph();
  g.addEdge('a', 'b', 'correlated', 0.5);
  g.addEdge('a', 'b', 'correlated', 0.9);
  const edges = g.getEdges('a').filter((e) => e.from === 'a' && e.to === 'b');
  assert.equal(edges.length, 1);
  assert.equal(edges[0]!.confidence, 0.9);
});

test('addEdge dedup does not merge different types', () => {
  const g = createObservationGraph();
  g.addEdge('a', 'b', 'correlated', 0.5);
  g.addEdge('a', 'b', 'co_located', 0.8);
  const edges = g.getEdges('a').filter((e) => e.from === 'a');
  assert.equal(edges.length, 2);
});

test('edgeCount returns correct count', () => {
  const g = createObservationGraph();
  g.addEdge('a', 'b', 'correlated', 0.5);
  g.addEdge('b', 'c', 'entity_shared', 0.8);
  assert.equal(g.edgeCount(), 2);
});

// ── getNeighbors ────────────────────────────────────────────────────────────

test('getNeighbors returns connected node IDs in both directions', () => {
  const g = createObservationGraph();
  g.addEdge('a', 'b', 'correlated', 0.5);
  g.addEdge('c', 'a', 'co_located', 0.8);
  const neighbors = g.getNeighbors('a');
  assert.ok(neighbors.includes('b'));
  assert.ok(neighbors.includes('c'));
  assert.ok(!neighbors.includes('a'));
});

test('getNeighbors returns empty for unknown event', () => {
  const g = createObservationGraph();
  assert.deepEqual(g.getNeighbors('unknown'), []);
});

test('getNeighbors deduplicates IDs across multiple edges', () => {
  const g = createObservationGraph();
  g.addEdge('a', 'b', 'correlated', 0.5);
  g.addEdge('a', 'b', 'co_located', 0.9);
  const neighbors = g.getNeighbors('a');
  assert.equal(neighbors.filter((n) => n === 'b').length, 1);
});

// ── findPath BFS ────────────────────────────────────────────────────────────

test('findPath returns direct path when directly connected', () => {
  const g = createObservationGraph();
  g.addEdge('a', 'b', 'correlated', 0.5);
  const path = g.findPath('a', 'b');
  assert.deepEqual(path, ['a', 'b']);
});

test('findPath finds multi-hop path via BFS', () => {
  const g = createObservationGraph();
  g.addEdge('a', 'b', 'correlated', 0.5);
  g.addEdge('b', 'c', 'entity_shared', 0.8);
  const path = g.findPath('a', 'c');
  assert.ok(path !== null);
  assert.equal(path![0], 'a');
  assert.equal(path![path!.length - 1], 'c');
});

test('findPath returns null when no path exists', () => {
  const g = createObservationGraph();
  g.addEdge('a', 'b', 'correlated', 0.5);
  g.addEdge('x', 'y', 'correlated', 0.5);
  assert.equal(g.findPath('a', 'x'), null);
});

test('findPath returns single-element path when from === to', () => {
  const g = createObservationGraph();
  assert.deepEqual(g.findPath('a', 'a'), ['a']);
});

// ── LRU eviction ────────────────────────────────────────────────────────────

test('LRU eviction: oldest edge removed when MAX_EDGES (5000) exceeded', () => {
  const g = createObservationGraph();
  // Add 5001 unique edges
  for (let i = 0; i < 5001; i++) {
    g.addEdge(`src-${i}`, `dst-${i}`, 'correlated', 0.5);
  }
  assert.equal(g.edgeCount(), 5000);
  // Oldest edge (src-0 → dst-0) should be evicted
  const oldest = g.getEdges('src-0').filter((e) => e.from === 'src-0' && e.to === 'dst-0');
  assert.equal(oldest.length, 0);
  // Newest should still be present
  const newest = g.getEdges('src-5000').filter((e) => e.from === 'src-5000');
  assert.equal(newest.length, 1);
});

// ── populate auto-edges ─────────────────────────────────────────────────────

test('populate creates entity_shared edges for events with common entityIds', () => {
  const g = createObservationGraph();
  const events = [
    makeEvent({ id: 'e1', entityIds: ['USAF-123', 'NATO'] }),
    makeEvent({ id: 'e2', entityIds: ['USAF-123', 'EU'] }),
  ];
  g.populate(events);
  const edges = g.getEdges('e1').filter((e) => e.type === 'entity_shared');
  assert.ok(edges.length >= 1);
});

test('populate creates co_located edges for events within 100 km', () => {
  const g = createObservationGraph();
  const events = [
    makeEvent({ id: 'near-a', location: { lat: 41.85, lon: -87.65 } }),
    makeEvent({ id: 'near-b', location: { lat: 41.90, lon: -87.70 } }), // ~7 km
  ];
  g.populate(events);
  const edges = g.getEdges('near-a').filter((e) => e.type === 'co_located');
  assert.ok(edges.length >= 1);
});

test('populate does NOT create co_located edges for events >100 km apart', () => {
  const g = createObservationGraph();
  const events = [
    makeEvent({ id: 'chicago', location: { lat: 41.85, lon: -87.65 } }),
    makeEvent({ id: 'miami',   location: { lat: 25.80, lon: -80.20 } }), // ~2100 km
  ];
  g.populate(events);
  const edges = g.getEdges('chicago').filter((e) => e.type === 'co_located');
  assert.equal(edges.length, 0);
});

test('populate creates temporally_adjacent edges for events within 30 min', () => {
  const g = createObservationGraph();
  const events = [
    makeEvent({ id: 't1', timestamp: NOW }),
    makeEvent({ id: 't2', timestamp: NOW + 10 * 60_000 }), // 10 min later
  ];
  g.populate(events);
  const edges = g.getEdges('t1').filter((e) => e.type === 'temporally_adjacent');
  assert.ok(edges.length >= 1);
});

test('populate does NOT create temporally_adjacent edges for events >30 min apart', () => {
  const g = createObservationGraph();
  const events = [
    makeEvent({ id: 'old', timestamp: NOW - 60 * 60_000 }),
    makeEvent({ id: 'new', timestamp: NOW }),
  ];
  g.populate(events);
  const edges = g.getEdges('old').filter((e) => e.type === 'temporally_adjacent');
  assert.equal(edges.length, 0);
});

test('populate creates correlated edges for events with same domain and shared tag', () => {
  const g = createObservationGraph();
  const events = [
    makeEvent({ id: 'eq1', domain: 'seismic', tags: ['earthquake', 'shallow'] }),
    makeEvent({ id: 'eq2', domain: 'seismic', tags: ['earthquake', 'tsunami-risk'] }),
  ];
  g.populate(events);
  const edges = g.getEdges('eq1').filter((e) => e.type === 'correlated');
  assert.ok(edges.length >= 1);
});

test('_reset clears all edges', () => {
  const g = createObservationGraph();
  g.addEdge('a', 'b', 'correlated', 0.5);
  g._reset();
  assert.equal(g.edgeCount(), 0);
});
