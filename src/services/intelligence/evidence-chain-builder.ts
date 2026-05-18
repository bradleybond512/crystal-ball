/**
 * Evidence Chain Builder — constructs ordered chains of evidence that
 * lead from raw observations to intelligence conclusions. Each chain
 * is a DAG whose nodes describe stages in the reasoning path
 * (observation → correlation → situation → assessment) and whose
 * edges describe how each stage was derived from the prior one.
 *
 * Two derived metrics are surfaced on every chain:
 *   - depth — longest path (in edges) from the root observation node.
 *   - overallConfidence — product of edge weights along the critical
 *     path, defined as the longest edge-path from root to any
 *     `assessment` node. When no assessment is reachable, the longest
 *     overall path is used instead.
 *
 * Cycles are forbidden: `build` validates with a 3-state DFS and
 * throws on any back-edge.
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists
 * chains to `wm-evidence-chains` (LIFO ring buffer, max 200).
 */

// ── Public types ──────────────────────────────────────────────────────

export type ChainNodeType =
  | 'observation' | 'correlation' | 'situation' | 'assessment'
  | 'assumption' | 'counterfactual';

export type EdgeRelationshipType =
  | 'derived-from' | 'corroborates' | 'contradicts' | 'assumes' | 'challenges';

export interface ChainNode {
  id: string;
  type: ChainNodeType;
  label: string;
  confidence: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ChainEdge {
  fromId: string;
  toId: string;
  relationshipType: EdgeRelationshipType;
  /** 0-1 — how much weight this edge contributes to the chain. */
  weight: number;
}

export interface EvidenceChain {
  id: string;
  rootObservationId: string;
  situationId: string;
  nodes: ChainNode[];
  edges: ChainEdge[];
  /** Product of edge weights along the critical path. */
  overallConfidence: number;
  /** Longest path length (in edges) from the root node. */
  depth: number;
  createdAt: number;
}

export interface BuildParams {
  rootObservationId: string;
  situationId: string;
  nodes: ChainNode[];
  edges: ChainEdge[];
}

export type ChainListener = (chain: EvidenceChain) => void;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface EvidenceChainBuilderOptions {
  storage?: StorageLike | null;
  clock?: () => number;
}

// ── Constants ─────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-evidence-chains';
export const MAX_CHAINS = 200;

// ── Errors ────────────────────────────────────────────────────────────

export class EvidenceChainCycleError extends Error {
  constructor(public readonly cycleAtNodeId: string) {
    super(`Cycle detected in evidence chain at node "${cycleAtNodeId}"`);
    this.name = 'EvidenceChainCycleError';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function safeStorage(injected?: StorageLike | null): StorageLike | null {
  if (injected !== undefined) return injected;
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function cloneChain(c: EvidenceChain): EvidenceChain {
  return {
    ...c,
    nodes: c.nodes.map((n) => ({ ...n, metadata: n.metadata ? { ...n.metadata } : undefined })),
    edges: c.edges.map((e) => ({ ...e })),
  };
}

function buildAdjacency(edges: readonly ChainEdge[]): Map<string, ChainEdge[]> {
  const adj = new Map<string, ChainEdge[]>();
  for (const e of edges) {
    const bucket = adj.get(e.fromId);
    if (bucket) bucket.push(e);
    else adj.set(e.fromId, [e]);
  }
  return adj;
}

/** 3-state DFS cycle detector. Throws EvidenceChainCycleError on the
 *  first back-edge encountered. */
function assertAcyclic(nodes: readonly ChainNode[], edges: readonly ChainEdge[]): void {
  const adj = buildAdjacency(edges);
  // 0 = unvisited, 1 = on stack, 2 = done
  const state = new Map<string, 0 | 1 | 2>();
  for (const n of nodes) state.set(n.id, 0);
  for (const n of nodes) if (state.get(n.id) === 0) visit(n.id, adj, state);
}

function visit(id: string, adj: Map<string, ChainEdge[]>, state: Map<string, 0 | 1 | 2>): void {
  state.set(id, 1);
  for (const edge of adj.get(id) ?? []) {
    const nextState = state.get(edge.toId);
    if (nextState === undefined) continue; // edge to unknown node — ignore
    if (nextState === 1) throw new EvidenceChainCycleError(edge.toId);
    if (nextState === 0) visit(edge.toId, adj, state);
  }
  state.set(id, 2);
}

interface DerivedMetrics {
  depth: number;
  overallConfidence: number;
}

interface PathTables {
  longestPath: Map<string, number>;
  weightProduct: Map<string, number>;
}

/** BFS-style relaxation over an already-acyclic graph. Computes the
 *  longest path (in edges) and the product of edge weights along that
 *  path for every reachable node. O(V*E). */
function relaxLongestPaths(rootId: string, nodeIds: ReadonlySet<string>, adj: Map<string, ChainEdge[]>): PathTables {
  const longestPath = new Map<string, number>([[rootId, 0]]);
  const weightProduct = new Map<string, number>([[rootId, 1]]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [from, outs] of adj) {
      const fromPath = longestPath.get(from);
      if (fromPath === undefined) continue;
      const fromWeight = weightProduct.get(from) ?? 1;
      for (const edge of outs) {
        if (relaxEdge(edge, fromPath, fromWeight, nodeIds, longestPath, weightProduct)) changed = true;
      }
    }
  }
  return { longestPath, weightProduct };
}

function relaxEdge(
  edge: ChainEdge,
  fromPath: number,
  fromWeight: number,
  nodeIds: ReadonlySet<string>,
  longestPath: Map<string, number>,
  weightProduct: Map<string, number>,
): boolean {
  if (!nodeIds.has(edge.toId)) return false;
  const candPath = fromPath + 1;
  const currentPath = longestPath.get(edge.toId) ?? -1;
  if (candPath <= currentPath) return false;
  longestPath.set(edge.toId, candPath);
  weightProduct.set(edge.toId, fromWeight * edge.weight);
  return true;
}

function pickCriticalConfidence(tables: PathTables, nodeById: Map<string, ChainNode>): number {
  let bestAssessmentPath = -1;
  let bestAssessmentWeight = 1;
  let bestOverallPath = -1;
  let bestOverallWeight = 1;
  for (const [id, path] of tables.longestPath) {
    const w = tables.weightProduct.get(id) ?? 1;
    if (path > bestOverallPath) { bestOverallPath = path; bestOverallWeight = w; }
    if (nodeById.get(id)?.type === 'assessment' && path > bestAssessmentPath) {
      bestAssessmentPath = path; bestAssessmentWeight = w;
    }
  }
  if (bestAssessmentPath > 0) return bestAssessmentWeight;
  if (bestOverallPath > 0) return bestOverallWeight;
  return 1;
}

/** For a DAG, compute depth (longest reachable path from root) and
 *  overallConfidence (product of edge weights along the critical
 *  path, preferring a path ending at an assessment node). */
function computeDerived(rootId: string, nodes: readonly ChainNode[], edges: readonly ChainEdge[]): DerivedMetrics {
  const nodeById = new Map<string, ChainNode>();
  for (const n of nodes) nodeById.set(n.id, n);
  if (!nodeById.has(rootId)) return { depth: 0, overallConfidence: 1 };
  const tables = relaxLongestPaths(rootId, new Set(nodeById.keys()), buildAdjacency(edges));
  let depth = 0;
  for (const path of tables.longestPath.values()) if (path > depth) depth = path;
  const overallConfidence = pickCriticalConfidence(tables, nodeById);
  return { depth, overallConfidence: Number(overallConfidence.toFixed(6)) };
}

// ── Service ───────────────────────────────────────────────────────────

interface InternalState {
  /** Newest-first ordered chain ids. */
  order: string[];
  chains: Map<string, EvidenceChain>;
  /** situationId → most recent chainId. */
  bySituation: Map<string, string>;
}

export class EvidenceChainBuilderService {
  private state: InternalState = { order: [], chains: new Map(), bySituation: new Map() };
  private listeners = new Set<ChainListener>();
  private storage: StorageLike | null;
  private clock: () => number;
  private hydrated = false;
  private idSeq = 0;

  constructor(options: EvidenceChainBuilderOptions = {}) {
    this.storage = safeStorage(options.storage);
    this.clock = options.clock ?? (() => Date.now());
  }

  // ── Build ──────────────────────────────────────────────────────────

  build(params: BuildParams): EvidenceChain {
    this.ensureHydrated();
    assertAcyclic(params.nodes, params.edges);
    const now = this.clock();
    this.idSeq += 1;
    const id = `ech-${now.toString(36)}-${this.idSeq}`;
    const chain: EvidenceChain = {
      id,
      rootObservationId: params.rootObservationId,
      situationId: params.situationId,
      nodes: params.nodes.map((n) => ({ ...n })),
      edges: params.edges.map((e) => ({ ...e })),
      overallConfidence: 1,
      depth: 0,
      createdAt: now,
    };
    const derived = computeDerived(params.rootObservationId, chain.nodes, chain.edges);
    chain.depth = derived.depth;
    chain.overallConfidence = derived.overallConfidence;
    this.recordChain(chain);
    return cloneChain(chain);
  }

  addNode(chainId: string, node: ChainNode, edge: ChainEdge): EvidenceChain | undefined {
    this.ensureHydrated();
    const existing = this.state.chains.get(chainId);
    if (!existing) return undefined;
    const nextNodes = [...existing.nodes, { ...node }];
    const nextEdges = [...existing.edges, { ...edge }];
    assertAcyclic(nextNodes, nextEdges);
    const derived = computeDerived(existing.rootObservationId, nextNodes, nextEdges);
    const updated: EvidenceChain = {
      ...existing,
      nodes: nextNodes, edges: nextEdges,
      depth: derived.depth, overallConfidence: derived.overallConfidence,
    };
    this.state.chains.set(chainId, updated);
    this.bumpOrder(chainId);
    this.state.bySituation.set(updated.situationId, chainId);
    this.persist();
    this.notify(updated);
    return cloneChain(updated);
  }

  // ── Reads ──────────────────────────────────────────────────────────

  getChain(chainId: string): EvidenceChain | null {
    this.ensureHydrated();
    const c = this.state.chains.get(chainId);
    return c ? cloneChain(c) : null;
  }

  getChainForSituation(situationId: string): EvidenceChain | null {
    this.ensureHydrated();
    const cid = this.state.bySituation.get(situationId);
    if (!cid) return null;
    const c = this.state.chains.get(cid);
    return c ? cloneChain(c) : null;
  }

  getAll(limit?: number): EvidenceChain[] {
    this.ensureHydrated();
    const list = this.state.order
      .map((id) => this.state.chains.get(id))
      .filter((c): c is EvidenceChain => c !== undefined);
    const capped = typeof limit === 'number' ? list.slice(0, Math.max(0, limit)) : list;
    return capped.map((c) => cloneChain(c));
  }

  subscribe(listener: ChainListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  unsubscribe(listener: ChainListener): void {
    this.listeners.delete(listener);
  }

  /** Test seam — clears state and persisted blob. */
  resetForTesting(): void {
    this.state = { order: [], chains: new Map(), bySituation: new Map() };
    this.listeners.clear();
    this.idSeq = 0;
    this.hydrated = true;
    if (this.storage?.removeItem) {
      try { this.storage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internal ───────────────────────────────────────────────────────

  private recordChain(chain: EvidenceChain): void {
    this.state.chains.set(chain.id, chain);
    this.state.order.unshift(chain.id);
    this.state.bySituation.set(chain.situationId, chain.id);
    this.enforceCapacity();
    this.persist();
    this.notify(chain);
  }

  private bumpOrder(chainId: string): void {
    const idx = this.state.order.indexOf(chainId);
    if (idx <= 0) return;
    this.state.order.splice(idx, 1);
    this.state.order.unshift(chainId);
  }

  private enforceCapacity(): void {
    if (this.state.order.length <= MAX_CHAINS) return;
    const dropped = this.state.order.splice(MAX_CHAINS);
    for (const id of dropped) {
      const c = this.state.chains.get(id);
      this.state.chains.delete(id);
      if (c && this.state.bySituation.get(c.situationId) === id) {
        this.state.bySituation.delete(c.situationId);
      }
    }
  }

  private notify(chain: EvidenceChain): void {
    const snapshot = cloneChain(chain);
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* isolate */ }
    }
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    let parsed: EvidenceChain[] | null;
    try { parsed = JSON.parse(raw) as EvidenceChain[] | null; }
    catch { return; }
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (!entry || typeof entry.id !== 'string') continue;
      this.state.chains.set(entry.id, cloneChain(entry));
      this.state.order.push(entry.id);
      this.state.bySituation.set(entry.situationId, entry.id);
    }
  }

  private persist(): void {
    if (!this.storage) return;
    const payload = this.state.order
      .map((id) => this.state.chains.get(id))
      .filter((c): c is EvidenceChain => c !== undefined);
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch { /* best effort */ }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: EvidenceChainBuilderService | null = null;

export function getEvidenceChainBuilderService(): EvidenceChainBuilderService {
  _singleton ??= new EvidenceChainBuilderService();
  return _singleton;
}

export function __resetEvidenceChainBuilderServiceSingleton(): void {
  _singleton = null;
}

export const __internals = {
  assertAcyclic,
  computeDerived,
  buildAdjacency,
  MAX_CHAINS,
};
