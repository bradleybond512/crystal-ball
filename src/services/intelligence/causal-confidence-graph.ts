/**
 * CausalConfidenceGraph — directed cause→effect graph with confidence
 * weights across domains.
 *
 * Each edge captures how strongly an upstream cause (e.g. "Bosphorus
 * closure", "OPEC quota cut") is believed to drive a downstream effect
 * (e.g. "wheat price spike", "diesel shortage in Rotterdam"). Confidence
 * is the rolling mean across all recorded observations for the edge, so
 * repeated reinforcement converges on a stable belief; one-off
 * coincidences stay weak.
 *
 * Pure, no DOM, no fetch. Storage is optional — when localStorage is
 * available, the graph hydrates on construction and persists on every
 * mutation. Tests can call `resetForTests()` to drop the singleton.
 */

export type CausalStrength = 'weak' | 'moderate' | 'strong';

export interface CausalEdge {
  id: string;
  causeId: string;
  causeDomain: string;
  effectId: string;
  effectDomain: string;
  confidence: number;
  strength: CausalStrength;
  evidenceCount: number;
  lastUpdated: number;
}

export interface CausalNode {
  id: string;
  domain: string;
}

export interface CausalGraphStats {
  nodeCount: number;
  edgeCount: number;
  avgConfidence: number;
  strongEdgeCount: number;
}

export const CAUSAL_GRAPH_KEY = 'wm-causal-confidence-graph';
export const MAX_EDGES = 1000;
const DEFAULT_MAX_DEPTH = 4;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    const g = globalThis as { localStorage?: StorageLike };
    return g.localStorage ?? null;
  } catch {
    return null;
  }
}

export function strengthFromConfidence(confidence: number): CausalStrength {
  if (confidence < 0.4) return 'weak';
  if (confidence > 0.7) return 'strong';
  return 'moderate';
}

export function makeEdgeId(causeId: string, effectId: string): string {
  return `${causeId}->${effectId}`;
}

function clampConfidence(c: number): number {
  if (!Number.isFinite(c)) return 0;
  if (c < 0) return 0;
  if (c > 1) return 1;
  return c;
}

function isCausalStrength(value: unknown): value is CausalStrength {
  return value === 'weak' || value === 'moderate' || value === 'strong';
}

function coerceEdge(raw: unknown): CausalEdge | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string'
    || typeof r.causeId !== 'string'
    || typeof r.causeDomain !== 'string'
    || typeof r.effectId !== 'string'
    || typeof r.effectDomain !== 'string'
    || typeof r.confidence !== 'number'
    || !isCausalStrength(r.strength)
    || typeof r.evidenceCount !== 'number'
    || typeof r.lastUpdated !== 'number'
  ) {
    return null;
  }
  if (!Number.isFinite(r.evidenceCount) || r.evidenceCount < 1) return null;
  return {
    id: r.id,
    causeId: r.causeId,
    causeDomain: r.causeDomain,
    effectId: r.effectId,
    effectDomain: r.effectDomain,
    confidence: clampConfidence(r.confidence),
    strength: r.strength,
    evidenceCount: Math.floor(r.evidenceCount),
    lastUpdated: r.lastUpdated,
  };
}

export class CausalConfidenceGraph {
  private static instance: CausalConfidenceGraph | null = null;
  private edges = new Map<string, CausalEdge>();
  private storage: StorageLike | null;

  private constructor(storage: StorageLike | null) {
    this.storage = storage;
    this.load();
  }

  static getInstance(): CausalConfidenceGraph {
    CausalConfidenceGraph.instance ??= new CausalConfidenceGraph(defaultStorage());
    return CausalConfidenceGraph.instance;
  }

  /** Test helper — drops the singleton so the next `getInstance()` reloads from storage. */
  static resetForTests(storage: StorageLike | null = null): CausalConfidenceGraph {
    CausalConfidenceGraph.instance = new CausalConfidenceGraph(storage);
    return CausalConfidenceGraph.instance;
  }

  /**
   * Upsert an edge. First observation seeds confidence directly; each
   * subsequent observation updates the stored confidence as a rolling
   * mean across all observations so far — `(prev * n + new) / (n + 1)`.
   * Evicts the oldest edges (by lastUpdated) when MAX_EDGES is exceeded.
   */
  addEdge(cause: CausalNode, effect: CausalNode, confidence: number, now: number = Date.now()): CausalEdge {
    const safeConfidence = clampConfidence(confidence);
    const id = makeEdgeId(cause.id, effect.id);
    const existing = this.edges.get(id);
    const edge = existing
      ? mergeEdge(existing, cause, effect, safeConfidence, now)
      : freshEdge(id, cause, effect, safeConfidence, now);
    this.edges.set(id, edge);
    this.evictIfNeeded();
    this.persist();
    return edge;
  }

  /** All edges whose effect matches `effectId`, sorted by confidence desc. */
  getCauses(effectId: string): CausalEdge[] {
    return [...this.edges.values()]
      .filter((e) => e.effectId === effectId)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /** All edges whose cause matches `causeId`, sorted by confidence desc. */
  getEffects(causeId: string): CausalEdge[] {
    return [...this.edges.values()]
      .filter((e) => e.causeId === causeId)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * BFS-style enumeration of all root-anchored cause→effect chains
   * reachable from `startId`. Each returned path is an ordered list of
   * edges. Cycles are closed (the cycling edge is appended and the
   * branch stops) so the function always terminates. `maxDepth` caps
   * the number of edges per path.
   */
  getChain(startId: string, maxDepth: number = DEFAULT_MAX_DEPTH): CausalEdge[][] {
    if (maxDepth <= 0) return [];
    const paths: CausalEdge[][] = [];
    const expand = (
      currentId: string,
      pathSoFar: CausalEdge[],
      visited: ReadonlySet<string>,
    ): void => {
      if (pathSoFar.length >= maxDepth) {
        paths.push([...pathSoFar]);
        return;
      }
      const nextEdges = this.getEffects(currentId);
      if (nextEdges.length === 0) {
        if (pathSoFar.length > 0) paths.push([...pathSoFar]);
        return;
      }
      for (const edge of nextEdges) {
        if (visited.has(edge.effectId)) {
          paths.push([...pathSoFar, edge]);
          continue;
        }
        const nextVisited = new Set(visited);
        nextVisited.add(edge.effectId);
        expand(edge.effectId, [...pathSoFar, edge], nextVisited);
      }
    };
    expand(startId, [], new Set([startId]));
    return paths;
  }

  getGraphStats(): CausalGraphStats {
    const edges = [...this.edges.values()];
    const nodes = new Set<string>();
    let totalConfidence = 0;
    let strongCount = 0;
    for (const e of edges) {
      nodes.add(e.causeId);
      nodes.add(e.effectId);
      totalConfidence += e.confidence;
      if (e.strength === 'strong') strongCount += 1;
    }
    return {
      nodeCount: nodes.size,
      edgeCount: edges.length,
      avgConfidence: edges.length === 0 ? 0 : totalConfidence / edges.length,
      strongEdgeCount: strongCount,
    };
  }

  getEdge(causeId: string, effectId: string): CausalEdge | undefined {
    return this.edges.get(makeEdgeId(causeId, effectId));
  }

  getAllEdges(): CausalEdge[] {
    return [...this.edges.values()];
  }

  clear(): void {
    this.edges.clear();
    this.persist();
  }

  private evictIfNeeded(): void {
    if (this.edges.size <= MAX_EDGES) return;
    const sorted = [...this.edges.entries()]
      .sort((a, b) => a[1].lastUpdated - b[1].lastUpdated);
    const toEvict = this.edges.size - MAX_EDGES;
    for (let i = 0; i < toEvict; i++) {
      const entry = sorted[i];
      if (entry) this.edges.delete(entry[0]);
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(CAUSAL_GRAPH_KEY, JSON.stringify([...this.edges.values()]));
    } catch {
      // Quota errors and the like — drop the write rather than crash a render.
    }
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(CAUSAL_GRAPH_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        const edge = coerceEdge(entry);
        if (edge) this.edges.set(edge.id, edge);
      }
    } catch {
      // Treat malformed storage as empty — the alternative is leaving the
      // user stuck with no graph and no clear recovery path.
    }
  }
}

function freshEdge(
  id: string,
  cause: CausalNode,
  effect: CausalNode,
  confidence: number,
  now: number,
): CausalEdge {
  return {
    id,
    causeId: cause.id,
    causeDomain: cause.domain,
    effectId: effect.id,
    effectDomain: effect.domain,
    confidence,
    strength: strengthFromConfidence(confidence),
    evidenceCount: 1,
    lastUpdated: now,
  };
}

function mergeEdge(
  existing: CausalEdge,
  cause: CausalNode,
  effect: CausalNode,
  newObservation: number,
  now: number,
): CausalEdge {
  const newCount = existing.evidenceCount + 1;
  const blended = (existing.confidence * existing.evidenceCount + newObservation) / newCount;
  return {
    ...existing,
    causeDomain: cause.domain,
    effectDomain: effect.domain,
    confidence: blended,
    strength: strengthFromConfidence(blended),
    evidenceCount: newCount,
    lastUpdated: now,
  };
}
