/**
 * Tests for EvidenceChainBuilderService — DAG construction with
 * cycle validation, depth + critical-path metrics, and persistence.
 *
 * The service is built with injectable storage + clock so the tests
 * never touch real localStorage or Date.now.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EvidenceChainBuilderService,
  EvidenceChainCycleError,
  MAX_CHAINS,
  STORAGE_KEY,
  __internals,
  __resetEvidenceChainBuilderServiceSingleton,
  getEvidenceChainBuilderService,
  type BuildParams,
  type ChainEdge,
  type ChainNode,
  type EvidenceChain,
  type StorageLike,
} from '../../src/services/intelligence/evidence-chain-builder.ts';

// ── Fakes ─────────────────────────────────────────────────────────────

function makeFakeStorage(seed: Record<string, string> = {}): StorageLike & {
  raw: Map<string, string>;
} {
  const raw = new Map<string, string>(Object.entries(seed));
  return {
    raw,
    getItem(key: string): string | null { return raw.get(key) ?? null; },
    setItem(key: string, value: string): void { raw.set(key, value); },
    removeItem(key: string): void { raw.delete(key); },
  };
}

function fixedClock(t: number): () => number { return () => t; }
function tickingClock(start: number, step = 1): () => number {
  let t = start;
  return () => { t += step; return t; };
}

const NOW = 1_745_000_000_000;
const APPROX = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

// ── Fixtures ─────────────────────────────────────────────────────────

function node(id: string, type: ChainNode['type'], label = id, confidence = 0.8, ts = NOW): ChainNode {
  return { id, type, label, confidence, timestamp: ts };
}

function edge(fromId: string, toId: string, weight = 0.9): ChainEdge {
  return { fromId, toId, relationshipType: 'derived-from', weight };
}

/** Linear chain: obs → corr → sit → assess. */
function linearParams(rootObsId = 'obs-1', situationId = 'sit-1'): BuildParams {
  return {
    rootObservationId: rootObsId,
    situationId,
    nodes: [
      node(rootObsId, 'observation'),
      node('corr-1', 'correlation'),
      node('sit-1', 'situation'),
      node('assess-1', 'assessment'),
    ],
    edges: [edge(rootObsId, 'corr-1'), edge('corr-1', 'sit-1'), edge('sit-1', 'assess-1')],
  };
}

// ── build ────────────────────────────────────────────────────────────

test('build accepts a valid linear chain and computes depth + confidence', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const chain = svc.build(linearParams());
  assert.equal(chain.depth, 3, 'three edges from obs to assess');
  // 0.9^3 = 0.729
  assert.ok(APPROX(chain.overallConfidence, 0.729));
});

test('build sets rootObservationId, situationId, and a unique id', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const a = svc.build(linearParams('obs-A', 'sit-A'));
  const b = svc.build(linearParams('obs-B', 'sit-B'));
  assert.equal(a.rootObservationId, 'obs-A');
  assert.equal(b.situationId, 'sit-B');
  assert.notEqual(a.id, b.id);
});

test('build throws EvidenceChainCycleError when edges form a cycle', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const params: BuildParams = {
    rootObservationId: 'obs-1', situationId: 'sit-1',
    nodes: [node('obs-1', 'observation'), node('a', 'correlation'), node('b', 'correlation')],
    edges: [edge('obs-1', 'a'), edge('a', 'b'), edge('b', 'a')],
  };
  assert.throws(() => svc.build(params), EvidenceChainCycleError);
});

test('build allows multiple disjoint subgraphs', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const params: BuildParams = {
    rootObservationId: 'obs-1', situationId: 'sit-1',
    nodes: [
      node('obs-1', 'observation'), node('a', 'situation'),
      node('isolated-1', 'observation'), node('isolated-2', 'assessment'),
    ],
    edges: [edge('obs-1', 'a'), edge('isolated-1', 'isolated-2')],
  };
  const chain = svc.build(params);
  // Depth from root traverses only obs-1 → a (depth 1).
  assert.equal(chain.depth, 1);
});

test('build with no edges yields depth 0 and confidence 1', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const chain = svc.build({
    rootObservationId: 'obs-1', situationId: 'sit-1',
    nodes: [node('obs-1', 'observation')], edges: [],
  });
  assert.equal(chain.depth, 0);
  assert.equal(chain.overallConfidence, 1);
});

test('build returns a defensive copy', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const chain = svc.build(linearParams());
  chain.nodes[0]!.label = 'mutated';
  const stored = svc.getChain(chain.id)!;
  assert.notEqual(stored.nodes[0]!.label, 'mutated');
});

test('build prefers assessment-terminating path for confidence over a deeper non-assessment path', () => {
  // obs → A → B (no assessment, depth 2, w 0.5*0.5=0.25)
  // obs → assess-1 (depth 1, w 0.9)
  // critical path = the assessment one → confidence 0.9
  // depth = 2 (longest overall)
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const chain = svc.build({
    rootObservationId: 'obs-1', situationId: 'sit-1',
    nodes: [
      node('obs-1', 'observation'),
      node('A', 'correlation'), node('B', 'correlation'),
      node('assess-1', 'assessment'),
    ],
    edges: [
      { fromId: 'obs-1', toId: 'A', relationshipType: 'derived-from', weight: 0.5 },
      { fromId: 'A', toId: 'B', relationshipType: 'derived-from', weight: 0.5 },
      { fromId: 'obs-1', toId: 'assess-1', relationshipType: 'derived-from', weight: 0.9 },
    ],
  });
  assert.equal(chain.depth, 2);
  assert.ok(APPROX(chain.overallConfidence, 0.9), `expected 0.9, got ${chain.overallConfidence}`);
});

test('build uses longest overall path when no assessment node is reachable', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const chain = svc.build({
    rootObservationId: 'obs-1', situationId: 'sit-1',
    nodes: [
      node('obs-1', 'observation'),
      node('A', 'correlation'), node('B', 'correlation'),
    ],
    edges: [
      { fromId: 'obs-1', toId: 'A', relationshipType: 'derived-from', weight: 0.5 },
      { fromId: 'A', toId: 'B', relationshipType: 'derived-from', weight: 0.5 },
    ],
  });
  assert.equal(chain.depth, 2);
  assert.ok(APPROX(chain.overallConfidence, 0.25));
});

test('build supports branching with the deepest branch winning depth', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const chain = svc.build({
    rootObservationId: 'obs-1', situationId: 'sit-1',
    nodes: [
      node('obs-1', 'observation'),
      node('shallow', 'correlation'),
      node('deep-1', 'correlation'), node('deep-2', 'situation'), node('deep-3', 'assessment'),
    ],
    edges: [
      edge('obs-1', 'shallow'),
      edge('obs-1', 'deep-1'), edge('deep-1', 'deep-2'), edge('deep-2', 'deep-3'),
    ],
  });
  assert.equal(chain.depth, 3);
});

test('build self-loop is rejected as a cycle', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  assert.throws(() => svc.build({
    rootObservationId: 'obs-1', situationId: 'sit-1',
    nodes: [node('obs-1', 'observation')],
    edges: [edge('obs-1', 'obs-1')],
  }), EvidenceChainCycleError);
});

test('build with edge pointing to a non-existent node is tolerated', () => {
  // Dangling edges shouldn't crash; they just don't contribute to depth.
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const chain = svc.build({
    rootObservationId: 'obs-1', situationId: 'sit-1',
    nodes: [node('obs-1', 'observation')],
    edges: [edge('obs-1', 'ghost')],
  });
  assert.equal(chain.depth, 0);
});

// ── addNode ───────────────────────────────────────────────────────────

test('addNode appends node + edge and recomputes derived metrics', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const chain = svc.build(linearParams());
  const updated = svc.addNode(chain.id, node('add-1', 'assessment'), edge('assess-1', 'add-1', 0.8))!;
  assert.equal(updated.nodes.length, 5);
  assert.equal(updated.edges.length, 4);
  assert.equal(updated.depth, 4);
  // 0.9 * 0.9 * 0.9 * 0.8 = 0.5832
  assert.ok(APPROX(updated.overallConfidence, 0.5832), `got ${updated.overallConfidence}`);
});

test('addNode that would form a cycle throws and leaves chain unchanged', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const chain = svc.build(linearParams());
  const before = svc.getChain(chain.id)!;
  assert.throws(() => svc.addNode(chain.id, node('cycle-back', 'correlation'),
    edge('assess-1', 'obs-1', 0.5)), EvidenceChainCycleError);
  const after = svc.getChain(chain.id)!;
  assert.equal(after.nodes.length, before.nodes.length);
  assert.equal(after.edges.length, before.edges.length);
});

test('addNode returns undefined for an unknown chain id', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  assert.equal(svc.addNode('ech-nope', node('x', 'situation'), edge('x', 'y')), undefined);
});

test('addNode bumps the chain to the front of getAll()', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const first = svc.build(linearParams('obs-1', 'sit-1'));
  svc.build(linearParams('obs-2', 'sit-2'));
  svc.build(linearParams('obs-3', 'sit-3'));
  svc.addNode(first.id, node('extra', 'counterfactual'),
    edge('assess-1', 'extra', 0.9));
  assert.equal(svc.getAll()[0]!.id, first.id);
});

// ── Reads ─────────────────────────────────────────────────────────────

test('getChain returns null for unknown id', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  assert.equal(svc.getChain('ech-nope'), null);
});

test('getChainForSituation returns the most recent chain for the situation', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.build(linearParams('obs-A', 'sit-shared'));
  const second = svc.build(linearParams('obs-B', 'sit-shared'));
  const fetched = svc.getChainForSituation('sit-shared')!;
  assert.equal(fetched.id, second.id);
});

test('getChainForSituation returns null for an unknown situation', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  assert.equal(svc.getChainForSituation('sit-nope'), null);
});

test('getAll is newest-first with optional limit', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const a = svc.build(linearParams('obs-1', 'sit-1'));
  const b = svc.build(linearParams('obs-2', 'sit-2'));
  const c = svc.build(linearParams('obs-3', 'sit-3'));
  assert.deepEqual(svc.getAll().map((x) => x.id), [c.id, b.id, a.id]);
  assert.equal(svc.getAll(2).length, 2);
});

test('getAll returns defensive copies', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.build(linearParams());
  const all = svc.getAll();
  all[0]!.nodes[0]!.label = 'mutated';
  const fresh = svc.getAll();
  assert.notEqual(fresh[0]!.nodes[0]!.label, 'mutated');
});

// ── Ring buffer ──────────────────────────────────────────────────────

test('ring buffer evicts oldest past MAX_CHAINS', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  for (let i = 0; i < MAX_CHAINS + 10; i += 1) {
    svc.build(linearParams(`obs-${i}`, `sit-${i}`));
  }
  assert.equal(svc.getAll().length, MAX_CHAINS);
  // Oldest situation should be evicted.
  assert.equal(svc.getChainForSituation('sit-0'), null);
});

// ── Subscribe ─────────────────────────────────────────────────────────

test('subscribe fires on build and addNode', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const seen: EvidenceChain[] = [];
  svc.subscribe((c) => seen.push(c));
  const chain = svc.build(linearParams());
  svc.addNode(chain.id, node('extra', 'counterfactual'), edge('assess-1', 'extra', 0.5));
  assert.equal(seen.length, 2);
});

test('listener that throws does not stop other listeners', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  let good = 0;
  svc.subscribe(() => { throw new Error('bad'); });
  svc.subscribe(() => { good += 1; });
  svc.build(linearParams());
  assert.equal(good, 1);
});

test('unsubscribe stops further notifications', () => {
  const svc = new EvidenceChainBuilderService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  let count = 0;
  const cb = (): void => { count += 1; };
  svc.subscribe(cb);
  svc.unsubscribe(cb);
  svc.build(linearParams());
  assert.equal(count, 0);
});

// ── Persistence ───────────────────────────────────────────────────────

test('chains survive a fresh service instance', () => {
  const storage = makeFakeStorage();
  const svc1 = new EvidenceChainBuilderService({ storage, clock: tickingClock(NOW) });
  svc1.build(linearParams('obs-A', 'sit-A'));
  svc1.build(linearParams('obs-B', 'sit-B'));
  const svc2 = new EvidenceChainBuilderService({ storage, clock: tickingClock(NOW) });
  assert.equal(svc2.getAll().length, 2);
  assert.ok(svc2.getChainForSituation('sit-A'));
});

test('corrupt persistence blob is ignored', () => {
  const storage = makeFakeStorage({ [STORAGE_KEY]: 'not-json' });
  const svc = new EvidenceChainBuilderService({ storage, clock: fixedClock(NOW) });
  assert.deepEqual(svc.getAll(), []);
});

test('null storage works (no-op persistence)', () => {
  const svc = new EvidenceChainBuilderService({ storage: null, clock: tickingClock(NOW) });
  const chain = svc.build(linearParams());
  assert.equal(chain.nodes.length, 4);
});

test('resetForTesting clears state + persisted blob', () => {
  const storage = makeFakeStorage();
  const svc = new EvidenceChainBuilderService({ storage, clock: tickingClock(NOW) });
  svc.build(linearParams());
  svc.resetForTesting();
  assert.equal(svc.getAll().length, 0);
  assert.equal(storage.raw.has(STORAGE_KEY), false);
});

// ── Internals ────────────────────────────────────────────────────────

test('__internals.assertAcyclic accepts a simple DAG', () => {
  assert.doesNotThrow(() => __internals.assertAcyclic(
    [node('a', 'observation'), node('b', 'situation')],
    [edge('a', 'b')],
  ));
});

test('__internals.computeDerived returns depth 0 when root is missing', () => {
  const d = __internals.computeDerived('ghost', [node('a', 'observation')], []);
  assert.equal(d.depth, 0);
  assert.equal(d.overallConfidence, 1);
});

// ── Singleton ─────────────────────────────────────────────────────────

test('getEvidenceChainBuilderService returns a stable singleton', () => {
  __resetEvidenceChainBuilderServiceSingleton();
  const a = getEvidenceChainBuilderService();
  const b = getEvidenceChainBuilderService();
  assert.equal(a, b);
  __resetEvidenceChainBuilderServiceSingleton();
});

test('singleton reset returns a fresh instance', () => {
  const a = getEvidenceChainBuilderService();
  __resetEvidenceChainBuilderServiceSingleton();
  const b = getEvidenceChainBuilderService();
  assert.notEqual(a, b);
  __resetEvidenceChainBuilderServiceSingleton();
});
