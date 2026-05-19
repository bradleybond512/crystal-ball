/**
 * PlanetaryDependencyGraph — maps infrastructure, supply-chain, and
 * geopolitical dependencies between regions and domains.
 *
 * Nodes represent countries, choke-points, institutions, or commodities.
 * Edges encode typed relationships with strength (0–1) and optionality of
 * bidirectionality.
 *
 * `getCascadeRisk()` runs a bounded BFS along `depends-on` edges and
 * returns per-node cascade scores (product of edge strengths along path).
 *
 * Seeded at construction with 12 nodes and 15 edges covering the most
 * globally critical chokepoints and dependencies.
 *
 * Pure deterministic — no DOM, no fetch.
 * Storage key: `wm-planetary-deps`. Caps at 1000 nodes + 5000 edges.
 */

// ── Public types ──────────────────────────────────────────────────────

export type NodeType =
  | 'country'
  | 'infrastructure'
  | 'supply-chain'
  | 'institution'
  | 'commodity';

export type RelationshipType =
  | 'depends-on'
  | 'supplies'
  | 'controls'
  | 'competes-with'
  | 'allies-with';

export interface DependencyNode {
  id: string;
  name: string;
  type: NodeType;
  domain: string;
  criticalityScore: number;
}

export interface DependencyEdge {
  id: string;
  fromId: string;
  toId: string;
  relationshipType: RelationshipType;
  strength: number;
  bidirectional: boolean;
}

export interface CascadeResult {
  nodeId: string;
  cascadeScore: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface PlanetaryDependencyGraphOptions {
  storage?: StorageLike | null;
  /** Set false to skip the initial seed (useful for tests). */
  seed?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-planetary-deps';
export const MAX_NODES = 1000;
export const MAX_EDGES = 5000;

// ── Seed data ─────────────────────────────────────────────────────────

const SEED_NODES: readonly DependencyNode[] = [
  { id: 'us',        name: 'United States',           type: 'country',        domain: 'geopolitical', criticalityScore: 0.95 },
  { id: 'cn',        name: 'China',                   type: 'country',        domain: 'geopolitical', criticalityScore: 0.92 },
  { id: 'eu',        name: 'European Union',          type: 'country',        domain: 'geopolitical', criticalityScore: 0.88 },
  { id: 'sa',        name: 'Saudi Arabia',            type: 'country',        domain: 'energy',       criticalityScore: 0.82 },
  { id: 'hormuz',    name: 'Strait of Hormuz',        type: 'infrastructure', domain: 'maritime',     criticalityScore: 0.91 },
  { id: 'panama',    name: 'Panama Canal',            type: 'infrastructure', domain: 'maritime',     criticalityScore: 0.85 },
  { id: 'swift',     name: 'SWIFT',                   type: 'institution',    domain: 'financial',    criticalityScore: 0.9 },
  { id: 'tsmc',      name: 'Taiwan Semiconductor',    type: 'supply-chain',   domain: 'technology',   criticalityScore: 0.93 },
  { id: 'shipping',  name: 'Global Shipping',         type: 'supply-chain',   domain: 'maritime',     criticalityScore: 0.87 },
  { id: 'ixp',       name: 'Internet Exchange Points',type: 'infrastructure', domain: 'cyber',        criticalityScore: 0.83 },
  { id: 'imf',       name: 'IMF',                     type: 'institution',    domain: 'financial',    criticalityScore: 0.8 },
  { id: 'unsc',      name: 'UN Security Council',     type: 'institution',    domain: 'geopolitical', criticalityScore: 0.78 },
];

const SEED_EDGES: readonly DependencyEdge[] = [
  { id: 'e01', fromId: 'eu',       toId: 'hormuz',   relationshipType: 'depends-on',    strength: 0.75, bidirectional: false },
  { id: 'e02', fromId: 'cn',       toId: 'hormuz',   relationshipType: 'depends-on',    strength: 0.8,  bidirectional: false },
  { id: 'e03', fromId: 'sa',       toId: 'hormuz',   relationshipType: 'controls',      strength: 0.7,  bidirectional: false },
  { id: 'e04', fromId: 'shipping', toId: 'panama',   relationshipType: 'depends-on',    strength: 0.65, bidirectional: false },
  { id: 'e05', fromId: 'us',       toId: 'swift',    relationshipType: 'controls',      strength: 0.85, bidirectional: false },
  { id: 'e06', fromId: 'eu',       toId: 'swift',    relationshipType: 'depends-on',    strength: 0.8,  bidirectional: false },
  { id: 'e07', fromId: 'us',       toId: 'tsmc',     relationshipType: 'depends-on',    strength: 0.9,  bidirectional: false },
  { id: 'e08', fromId: 'cn',       toId: 'tsmc',     relationshipType: 'competes-with', strength: 0.7,  bidirectional: false },
  { id: 'e09', fromId: 'eu',       toId: 'shipping', relationshipType: 'depends-on',    strength: 0.72, bidirectional: false },
  { id: 'e10', fromId: 'us',       toId: 'ixp',      relationshipType: 'controls',      strength: 0.6,  bidirectional: false },
  { id: 'e11', fromId: 'cn',       toId: 'ixp',      relationshipType: 'depends-on',    strength: 0.55, bidirectional: false },
  { id: 'e12', fromId: 'us',       toId: 'imf',      relationshipType: 'controls',      strength: 0.75, bidirectional: false },
  { id: 'e13', fromId: 'us',       toId: 'unsc',     relationshipType: 'controls',      strength: 0.65, bidirectional: false },
  { id: 'e14', fromId: 'us',       toId: 'cn',       relationshipType: 'competes-with', strength: 0.8,  bidirectional: true  },
  { id: 'e15', fromId: 'sa',       toId: 'eu',       relationshipType: 'supplies',      strength: 0.68, bidirectional: false },
];

// ── Storage helper ─────────────────────────────────────────────────────

function resolveStorage(injected?: StorageLike | null): StorageLike | null {
  if (injected !== undefined) return injected;
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

// ── Serialized shape ──────────────────────────────────────────────────

interface PersistedGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

// ── Service ───────────────────────────────────────────────────────────

export class PlanetaryDependencyGraph {
  private static _singleton: PlanetaryDependencyGraph | null = null;

  private nodes = new Map<string, DependencyNode>();
  private edges = new Map<string, DependencyEdge>();
  private readonly storage: StorageLike | null;

  constructor(options: PlanetaryDependencyGraphOptions = {}) {
    this.storage = resolveStorage(options.storage);
    this.hydrate();
    if ((options.seed ?? true) && this.nodes.size === 0) {
      this.runInitialSeed();
    }
  }

  static getInstance(): PlanetaryDependencyGraph {
    PlanetaryDependencyGraph._singleton ??= new PlanetaryDependencyGraph();
    return PlanetaryDependencyGraph._singleton;
  }

  static _resetForTests(): void {
    PlanetaryDependencyGraph._singleton = null;
  }

  // ── Public API ────────────────────────────────────────────────────

  addNode(node: DependencyNode): void {
    if (this.nodes.size >= MAX_NODES) return;
    this.nodes.set(node.id, { ...node });
    this.persist();
  }

  addEdge(edge: DependencyEdge): void {
    if (this.edges.size >= MAX_EDGES) return;
    this.edges.set(edge.id, { ...edge });
    this.persist();
  }

  getNode(id: string): DependencyNode | undefined {
    const n = this.nodes.get(id);
    return n ? { ...n } : undefined;
  }

  /** Edges where nodeId is fromId. */
  getDependencies(nodeId: string): DependencyEdge[] {
    return this.collectEdges((e) => e.fromId === nodeId || (e.bidirectional && e.toId === nodeId));
  }

  /** Edges where nodeId is toId. */
  getDependents(nodeId: string): DependencyEdge[] {
    return this.collectEdges((e) => e.toId === nodeId || (e.bidirectional && e.fromId === nodeId));
  }

  /**
   * BFS along depends-on edges up to `depth` hops. Returns each
   * reachable node with cascadeScore = product of edge strengths along
   * the shortest (highest-score) path.
   */
  getCascadeRisk(nodeId: string, depth = 3): CascadeResult[] {
    const results = new Map<string, number>();

    interface QueueEntry { id: string; score: number; hops: number }
    const queue: QueueEntry[] = [{ id: nodeId, score: 1, hops: 0 }];
    const visited = new Set<string>([nodeId]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.hops >= depth) continue;

      for (const e of this.edges.values()) {
        if (e.relationshipType !== 'depends-on') continue;
        const neighbor = this.resolveNeighbor(e, current.id);
        if (neighbor === null || visited.has(neighbor)) continue;
        visited.add(neighbor);
        const score = current.score * e.strength;
        results.set(neighbor, score);
        queue.push({ id: neighbor, score, hops: current.hops + 1 });
      }
    }

    return [...results.entries()]
      .map(([nId, cascadeScore]) => ({ nodeId: nId, cascadeScore }))
      .sort((a, b) => b.cascadeScore - a.cascadeScore);
  }

  /** All nodes sorted by criticalityScore descending. */
  getMostCritical(limit = 10): DependencyNode[] {
    return [...this.nodes.values()]
      .sort((a, b) => b.criticalityScore - a.criticalityScore)
      .slice(0, limit)
      .map((n) => ({ ...n }));
  }

  getNodeCount(): number { return this.nodes.size; }
  getEdgeCount(): number { return this.edges.size; }

  /** Clear all data and storage (test seam). */
  resetForTesting(): void {
    this.nodes.clear();
    this.edges.clear();
    if (this.storage?.removeItem) {
      try { this.storage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internal ──────────────────────────────────────────────────────

  private collectEdges(predicate: (e: DependencyEdge) => boolean): DependencyEdge[] {
    const out: DependencyEdge[] = [];
    for (const e of this.edges.values()) {
      if (predicate(e)) out.push({ ...e });
    }
    return out;
  }

  private resolveNeighbor(e: DependencyEdge, currentId: string): string | null {
    if (e.fromId === currentId) return e.toId;
    if (e.bidirectional && e.toId === currentId) return e.fromId;
    return null;
  }

  private runInitialSeed(): void {
    for (const n of SEED_NODES) this.nodes.set(n.id, { ...n });
    for (const e of SEED_EDGES) this.edges.set(e.id, { ...e });
    this.persist();
  }

  private hydrate(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    let parsed: PersistedGraph | null;
    try { parsed = JSON.parse(raw) as PersistedGraph | null; } catch { return; }
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return;
    for (const n of parsed.nodes) {
      if (n && typeof n.id === 'string') this.nodes.set(n.id, { ...n });
    }
    for (const e of parsed.edges) {
      if (e && typeof e.id === 'string') this.edges.set(e.id, { ...e });
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const data: PersistedGraph = {
        nodes: [...this.nodes.values()],
        edges: [...this.edges.values()],
      };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch { /* best effort */ }
  }
}

// ── Convenience accessor ──────────────────────────────────────────────

export function getPlanetaryDependencyGraph(): PlanetaryDependencyGraph {
  return PlanetaryDependencyGraph.getInstance();
}

export const __internals = {
  STORAGE_KEY,
  MAX_NODES,
  MAX_EDGES,
  SEED_NODES,
  SEED_EDGES,
};
