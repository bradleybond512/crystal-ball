/**
 * Algorithm Genealogy Tree — PR 18.
 *
 * Track the lineage of every algorithm: parent, creation reason,
 * parameter delta, shadow-vs-promotion metrics, current state. Build
 * a complete tree from a stream of lifecycle events (the foundation
 * audit trail from PR 8).
 *
 * Pure deterministic. Cycle-resistant: a creation event whose parent
 * chain reaches back to the new algorithm itself is rejected.
 */

// ── Public types ──────────────────────────────────────────────────────

export type CreationReason = 'new' | 'fork' | 'retune' | 'emergency';

export type AlgorithmState = 'active' | 'shadow' | 'retired' | 'emergency_disabled';

export interface PromotionMetrics {
  /** F1 the version achieved during shadow before promotion. */
  shadowF1?: number;
  /** Number of grades collected during shadow. */
  shadowGrades?: number;
  /** F1 of the predecessor at the time of promotion. */
  predecessorF1?: number;
}

export interface LifecycleEvent {
  /** ms timestamp. */
  at: number;
  algorithmId: string;
  parentId: string | null;
  reason: CreationReason;
  paramDelta?: Record<string, number>;
  promotionMetrics?: PromotionMetrics;
  /** State after the event. */
  state: AlgorithmState;
}

export interface GenealogyNode {
  algorithmId: string;
  parentId: string | null;
  createdAt: number;
  creationReason: CreationReason;
  paramDelta: Record<string, number>;
  promotionMetrics: PromotionMetrics;
  currentState: AlgorithmState;
  children: readonly string[];
}

export interface Genealogy {
  nodes: ReadonlyMap<string, GenealogyNode>;
  /** All root nodes (parentId = null). */
  roots: readonly string[];
  generatedAt: number;
}

// ── Construction ──────────────────────────────────────────────────────

/** Build a genealogy from a stream of lifecycle events. Events are
 *  applied in chronological order; later events for the same id update
 *  state and metrics but cannot change the parentId once set. */
export function buildGenealogy(
  events: readonly LifecycleEvent[],
  options: { now?: number } = {},
): Genealogy {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const nodes = new Map<string, GenealogyNode>();
  const childrenOf = new Map<string, string[]>();

  for (const lifecycleEvent of sorted) {
    applyLifecycleEvent(lifecycleEvent, nodes, childrenOf);
  }

  // Wire up children arrays.
  for (const [parentId, children] of childrenOf) {
    const parent = nodes.get(parentId);
    if (!parent) continue;
    nodes.set(parentId, { ...parent, children: [...children] });
  }

  const roots: string[] = [];
  for (const [id, node] of nodes) {
    if (node.parentId === null) roots.push(id);
  }
  roots.sort((a, b) => a.localeCompare(b));

  return {
    nodes,
    roots,
    generatedAt: options.now ?? Date.now(),
  };
}

function applyLifecycleEvent(
  ev: LifecycleEvent,
  nodes: Map<string, GenealogyNode>,
  childrenOf: Map<string, string[]>,
): void {
  const existing = nodes.get(ev.algorithmId);
  if (existing) {
    nodes.set(ev.algorithmId, {
      ...existing,
      currentState: ev.state,
      promotionMetrics: ev.promotionMetrics
        ? { ...existing.promotionMetrics, ...ev.promotionMetrics }
        : existing.promotionMetrics,
      paramDelta: ev.paramDelta
        ? { ...existing.paramDelta, ...ev.paramDelta }
        : existing.paramDelta,
    });
    return;
  }
  if (ev.parentId && wouldFormCycle(nodes, ev.parentId, ev.algorithmId)) return;
  const node: GenealogyNode = {
    algorithmId: ev.algorithmId,
    parentId: ev.parentId,
    createdAt: ev.at,
    creationReason: ev.reason,
    paramDelta: ev.paramDelta ? { ...ev.paramDelta } : {},
    promotionMetrics: ev.promotionMetrics ? { ...ev.promotionMetrics } : {},
    currentState: ev.state,
    children: [],
  };
  nodes.set(ev.algorithmId, node);
  if (ev.parentId) {
    const list = childrenOf.get(ev.parentId) ?? [];
    list.push(ev.algorithmId);
    childrenOf.set(ev.parentId, list);
  }
}

function wouldFormCycle(
  nodes: ReadonlyMap<string, GenealogyNode>,
  parentId: string,
  newId: string,
): boolean {
  let current: string | null = parentId;
  const seen = new Set<string>();
  while (current) {
    if (current === newId) return true;
    if (seen.has(current)) return true; // existing cycle in the data
    seen.add(current);
    const node = nodes.get(current);
    current = node?.parentId ?? null;
  }
  return false;
}

// ── Lineage queries ──────────────────────────────────────────────────

export interface Lineage {
  algorithmId: string;
  ancestors: readonly string[];
  descendants: readonly string[];
}

/** Walk parent links from a node back to the root. Excludes the
 *  node itself. */
export function getAncestors(genealogy: Genealogy, algorithmId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let current: string | null = genealogy.nodes.get(algorithmId)?.parentId ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    out.push(current);
    current = genealogy.nodes.get(current)?.parentId ?? null;
  }
  return out;
}

/** BFS over children pointers from a node. Excludes the node itself. */
export function getDescendants(genealogy: Genealogy, algorithmId: string): string[] {
  const out: string[] = [];
  const queue: string[] = [...(genealogy.nodes.get(algorithmId)?.children ?? [])];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    const node = genealogy.nodes.get(id);
    if (node) queue.push(...node.children);
  }
  return out;
}

export function getLineage(genealogy: Genealogy, algorithmId: string): Lineage {
  return {
    algorithmId,
    ancestors: getAncestors(genealogy, algorithmId),
    descendants: getDescendants(genealogy, algorithmId),
  };
}

// ── Serialization for sidecar mirror ─────────────────────────────────

export interface GenealogyJson {
  nodes: GenealogyNode[];
  roots: readonly string[];
  generatedAt: number;
}

export function genealogyToJson(g: Genealogy): GenealogyJson {
  return {
    nodes: [...g.nodes.values()],
    roots: g.roots,
    generatedAt: g.generatedAt,
  };
}

// ── Audit log + cache ────────────────────────────────────────────────

const lifecycleLog: LifecycleEvent[] = [];

export function recordLifecycleEvent(event: LifecycleEvent): void {
  lifecycleLog.push({ ...event });
  while (lifecycleLog.length > 5000) lifecycleLog.shift();
}

export function getLifecycleLog(): LifecycleEvent[] {
  return [...lifecycleLog];
}

export function buildGenealogyFromLog(now?: number): Genealogy {
  return buildGenealogy(lifecycleLog, { now });
}

export function _resetLifecycleLogForTests(): void {
  lifecycleLog.length = 0;
}
