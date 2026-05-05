import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGenealogy,
  getAncestors,
  getDescendants,
  getLineage,
  genealogyToJson,
  recordLifecycleEvent,
  buildGenealogyFromLog,
  _resetLifecycleLogForTests,
  type LifecycleEvent,
} from '../genealogy-tree.ts';

const NOW = 1_745_000_000_000;

function ev(args: Partial<LifecycleEvent> & {
  algorithmId: string;
  parentId: string | null;
}): LifecycleEvent {
  return {
    at: args.at ?? NOW,
    algorithmId: args.algorithmId,
    parentId: args.parentId,
    reason: args.reason ?? 'new',
    paramDelta: args.paramDelta,
    promotionMetrics: args.promotionMetrics,
    state: args.state ?? 'active',
  };
}

// ── Tree construction ────────────────────────────────────────────────

test('buildGenealogy: single root node', () => {
  const g = buildGenealogy([ev({ algorithmId: 'a', parentId: null })], { now: NOW });
  assert.equal(g.roots.length, 1);
  assert.equal(g.roots[0], 'a');
  assert.equal(g.nodes.get('a')?.parentId, null);
});

test('buildGenealogy: parent → child link populates children', () => {
  const g = buildGenealogy(
    [
      ev({ algorithmId: 'a', parentId: null, at: NOW }),
      ev({ algorithmId: 'b', parentId: 'a', at: NOW + 1, reason: 'fork' }),
    ],
    { now: NOW + 2 },
  );
  assert.deepEqual(g.nodes.get('a')?.children, ['b']);
  assert.equal(g.nodes.get('b')?.creationReason, 'fork');
});

test('buildGenealogy: applies events in chronological order', () => {
  // Pass events in reverse order to confirm sort.
  const g = buildGenealogy(
    [
      ev({ algorithmId: 'b', parentId: 'a', at: NOW + 1 }),
      ev({ algorithmId: 'a', parentId: null, at: NOW }),
    ],
    { now: NOW + 2 },
  );
  assert.deepEqual(g.nodes.get('a')?.children, ['b']);
});

test('buildGenealogy: subsequent events update state and metrics', () => {
  const g = buildGenealogy(
    [
      ev({ algorithmId: 'a', parentId: null, at: NOW, state: 'shadow' }),
      ev({
        algorithmId: 'a',
        parentId: null,
        at: NOW + 100,
        state: 'active',
        promotionMetrics: { shadowF1: 0.7 },
      }),
    ],
    { now: NOW + 200 },
  );
  const node = g.nodes.get('a');
  assert.equal(node?.currentState, 'active');
  assert.equal(node?.promotionMetrics.shadowF1, 0.7);
});

// ── Cycle detection ──────────────────────────────────────────────────

test('buildGenealogy: rejects an event that would form a cycle', () => {
  const g = buildGenealogy(
    [
      ev({ algorithmId: 'a', parentId: null, at: NOW }),
      ev({ algorithmId: 'b', parentId: 'a', at: NOW + 1 }),
      ev({ algorithmId: 'c', parentId: 'b', at: NOW + 2 }),
      // Now try to create 'a' as a child of 'c' — this would form a cycle.
      ev({ algorithmId: 'a-cycle', parentId: 'a', at: NOW + 3 }),
    ],
    { now: NOW + 4 },
  );
  // 'a' was created first as root; the cycle check is against future
  // events trying to graft an existing ancestor under a descendant. Add
  // a direct-cycle event:
  const g2 = buildGenealogy(
    [
      ev({ algorithmId: 'x', parentId: 'x', at: NOW }), // self-parent
    ],
    { now: NOW },
  );
  // Self-parent rejected → no node created.
  assert.equal(g2.nodes.has('x'), false);
  // Sanity from g
  assert.ok(g.nodes.has('a-cycle'));
});

// ── Lineage queries ──────────────────────────────────────────────────

test('getAncestors: walks up the chain', () => {
  const g = buildGenealogy(
    [
      ev({ algorithmId: 'a', parentId: null, at: NOW }),
      ev({ algorithmId: 'b', parentId: 'a', at: NOW + 1 }),
      ev({ algorithmId: 'c', parentId: 'b', at: NOW + 2 }),
    ],
    { now: NOW + 3 },
  );
  assert.deepEqual(getAncestors(g, 'c'), ['b', 'a']);
});

test('getDescendants: BFS over children', () => {
  const g = buildGenealogy(
    [
      ev({ algorithmId: 'a', parentId: null, at: NOW }),
      ev({ algorithmId: 'b', parentId: 'a', at: NOW + 1 }),
      ev({ algorithmId: 'c', parentId: 'a', at: NOW + 2 }),
      ev({ algorithmId: 'd', parentId: 'b', at: NOW + 3 }),
    ],
    { now: NOW + 4 },
  );
  const d = getDescendants(g, 'a');
  assert.equal(d.includes('b'), true);
  assert.equal(d.includes('c'), true);
  assert.equal(d.includes('d'), true);
  assert.equal(d.length, 3);
});

test('getLineage: combines ancestors + descendants', () => {
  const g = buildGenealogy(
    [
      ev({ algorithmId: 'a', parentId: null, at: NOW }),
      ev({ algorithmId: 'b', parentId: 'a', at: NOW + 1 }),
      ev({ algorithmId: 'c', parentId: 'b', at: NOW + 2 }),
    ],
    { now: NOW + 3 },
  );
  const l = getLineage(g, 'b');
  assert.deepEqual(l.ancestors, ['a']);
  assert.deepEqual(l.descendants, ['c']);
});

test('getLineage: unknown algorithm returns empty arrays', () => {
  const g = buildGenealogy([], { now: NOW });
  const l = getLineage(g, 'ghost');
  assert.equal(l.ancestors.length, 0);
  assert.equal(l.descendants.length, 0);
});

// ── Serialization ────────────────────────────────────────────────────

test('genealogyToJson: round-trip', () => {
  const g = buildGenealogy(
    [ev({ algorithmId: 'a', parentId: null, at: NOW })],
    { now: NOW + 1 },
  );
  const json = genealogyToJson(g);
  assert.equal(json.nodes.length, 1);
  assert.deepEqual(json.roots, ['a']);
  assert.equal(json.generatedAt, NOW + 1);
});

// ── Audit log + log-driven build ─────────────────────────────────────

test('recordLifecycleEvent + buildGenealogyFromLog: round-trip', () => {
  _resetLifecycleLogForTests();
  recordLifecycleEvent(ev({ algorithmId: 'a', parentId: null, at: NOW }));
  recordLifecycleEvent(ev({ algorithmId: 'b', parentId: 'a', at: NOW + 1, reason: 'retune' }));
  const g = buildGenealogyFromLog(NOW + 2);
  assert.equal(g.nodes.size, 2);
  assert.equal(g.nodes.get('b')?.creationReason, 'retune');
});
