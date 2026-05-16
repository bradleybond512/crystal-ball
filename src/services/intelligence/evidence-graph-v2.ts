/**
 * Evidence Graph v2 — typed-edge graph traversal over SituationStoreV2.
 *
 * Sits on top of `Situation.observations` + `Situation.edges` from
 * `situation-store-v2.ts` and exposes the queries the panels + briefings
 * actually want:
 *
 *   - getNode / getNeighbors — single-hop indexing
 *   - bfs / dfs — full traversal with depth caps
 *   - shortestPath — Dijkstra weighted by (1 - edge.confidence)
 *   - propagateConfidence — BFS that multiplies confidences along paths
 *   - getStrongEdges / getContradictions — bucket queries
 *   - stats — graph-level rollup for diagnostics surfaces
 *
 * Pure module: no DOM, no fetch, no globals at import time. The
 * singleton getter (`getEvidenceGraph()`) lazily instantiates a single
 * graph for the renderer to share; tests construct their own.
 *
 * Naming: this file is `evidence-graph-v2.ts` rather than overwriting
 * the existing `evidence-graph.ts` (PR #422, NormalizedFact-based truth
 * scoring) because the two layers have incompatible node/edge shapes
 * and several downstream services still depend on the v1 graph.
 */

import type { ObservationEvent } from './observation-adapters';
import type { EvidenceEdge, EvidenceEdgeType, Situation } from './situation-store-v2';

// ── Public types ──────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  observation: ObservationEvent;
  situationIds: string[];
  incomingEdges: EvidenceEdge[];
  outgoingEdges: EvidenceEdge[];
  /** Mean confidence across every edge touching the node. 0 when isolated. */
  aggregateConfidence: number;
}

export interface GraphPath {
  nodes: GraphNode[];
  edges: EvidenceEdge[];
  /** Product of edge confidences along the path. */
  totalConfidence: number;
  /** Edge type that appears most often along the path. Ties broken by
   *  insertion order — first dominant wins. */
  dominantEdgeType: EvidenceEdgeType;
}

export type EdgeTypeCounts = Record<EvidenceEdgeType, number>;

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  byEdgeType: EdgeTypeCounts;
  averageConfidence: number;
  mostConnectedNodeId: string | null;
  isolatedNodeCount: number;
}

// ── Constants ─────────────────────────────────────────────────────────

const DEFAULT_STRONG_CONFIDENCE = 0.7;
const DEFAULT_MAX_DEPTH = 16;

const EDGE_TYPES: readonly EvidenceEdgeType[] = [
  'caused_by',
  'co-located',
  'temporally-adjacent',
  'contradicts',
  'confirms',
];

function emptyEdgeCounts(): EdgeTypeCounts {
  return {
    caused_by: 0,
    'co-located': 0,
    'temporally-adjacent': 0,
    contradicts: 0,
    confirms: 0,
  };
}

// ── Graph ─────────────────────────────────────────────────────────────

interface MutableNode {
  id: string;
  observation: ObservationEvent;
  situationIds: Set<string>;
  incomingEdges: EvidenceEdge[];
  outgoingEdges: EvidenceEdge[];
}

export class EvidenceGraphV2 {
  private readonly nodes = new Map<string, MutableNode>();
  /** Edge dedupe key — same source/target/type/ruleId collapses. */
  private readonly seenEdges = new Set<string>();

  // ── Build ───────────────────────────────────────────────────────────

  /** Index one Situation's observations + edges. Idempotent on re-add. */
  buildFromSituation(situation: Situation): void {
    for (const observation of situation.observations) {
      this.upsertNode(observation, situation.id);
    }
    for (const edge of situation.edges) {
      this.addEdge(edge);
    }
  }

  buildFromSituations(situations: readonly Situation[]): void {
    for (const s of situations) this.buildFromSituation(s);
  }

  private upsertNode(observation: ObservationEvent, situationId: string): MutableNode {
    let node = this.nodes.get(observation.id);
    if (!node) {
      node = {
        id: observation.id,
        observation,
        situationIds: new Set([situationId]),
        incomingEdges: [],
        outgoingEdges: [],
      };
      this.nodes.set(observation.id, node);
      return node;
    }
    node.situationIds.add(situationId);
    return node;
  }

  private addEdge(edge: EvidenceEdge): void {
    const key = edgeKey(edge);
    if (this.seenEdges.has(key)) return;
    this.seenEdges.add(key);
    const source = this.nodes.get(edge.sourceEventId);
    const target = this.nodes.get(edge.targetEventId);
    if (source) source.outgoingEdges.push(edge);
    if (target) target.incomingEdges.push(edge);
  }

  // ── Single-hop queries ─────────────────────────────────────────────

  getNode(observationId: string): GraphNode | undefined {
    const node = this.nodes.get(observationId);
    return node ? toGraphNode(node) : undefined;
  }

  /** All nodes reachable in one hop from `observationId`, in either
   *  direction. Optional edgeTypes filter narrows by type. */
  getNeighbors(observationId: string, edgeTypes?: readonly EvidenceEdgeType[]): GraphNode[] {
    const node = this.nodes.get(observationId);
    if (!node) return [];
    const typeFilter = edgeTypes && edgeTypes.length > 0 ? new Set(edgeTypes) : null;
    const seen = new Set<string>();
    const out: GraphNode[] = [];
    const consider = (edge: EvidenceEdge, otherId: string): void => {
      if (typeFilter && !typeFilter.has(edge.type)) return;
      if (otherId === observationId || seen.has(otherId)) return;
      const other = this.nodes.get(otherId);
      if (!other) return;
      seen.add(otherId);
      out.push(toGraphNode(other));
    };
    for (const edge of node.outgoingEdges) consider(edge, edge.targetEventId);
    for (const edge of node.incomingEdges) consider(edge, edge.sourceEventId);
    return out;
  }

  // ── Traversals ─────────────────────────────────────────────────────

  bfs(startId: string, maxDepth: number = DEFAULT_MAX_DEPTH): GraphNode[] {
    return this.traverse(startId, maxDepth, 'bfs');
  }

  dfs(startId: string, maxDepth: number = DEFAULT_MAX_DEPTH): GraphNode[] {
    return this.traverse(startId, maxDepth, 'dfs');
  }

  private traverse(startId: string, maxDepth: number, mode: 'bfs' | 'dfs'): GraphNode[] {
    if (!this.nodes.has(startId) || maxDepth < 0) return [];
    const visited = new Set<string>([startId]);
    const out: GraphNode[] = [toGraphNode(this.nodes.get(startId)!)];
    const frontier: { id: string; depth: number }[] = [{ id: startId, depth: 0 }];
    while (frontier.length > 0) {
      const next = mode === 'bfs' ? frontier.shift()! : frontier.pop()!;
      if (next.depth >= maxDepth) continue;
      const neighborsRaw = this.collectNeighborIds(next.id);
      for (const neighborId of neighborsRaw) {
        if (visited.has(neighborId)) continue;
        const neighbor = this.nodes.get(neighborId);
        if (!neighbor) continue;
        visited.add(neighborId);
        out.push(toGraphNode(neighbor));
        frontier.push({ id: neighborId, depth: next.depth + 1 });
      }
    }
    return out;
  }

  private collectNeighborIds(nodeId: string): string[] {
    const node = this.nodes.get(nodeId);
    if (!node) return [];
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const edge of node.outgoingEdges) {
      if (!seen.has(edge.targetEventId) && edge.targetEventId !== nodeId) {
        seen.add(edge.targetEventId);
        ids.push(edge.targetEventId);
      }
    }
    for (const edge of node.incomingEdges) {
      if (!seen.has(edge.sourceEventId) && edge.sourceEventId !== nodeId) {
        seen.add(edge.sourceEventId);
        ids.push(edge.sourceEventId);
      }
    }
    return ids;
  }

  // ── Shortest path (Dijkstra; weight = 1 - confidence) ─────────────

  shortestPath(fromId: string, toId: string): GraphPath | null {
    if (!this.nodes.has(fromId) || !this.nodes.has(toId)) return null;
    if (fromId === toId) {
      const node = toGraphNode(this.nodes.get(fromId)!);
      return { nodes: [node], edges: [], totalConfidence: 1, dominantEdgeType: 'confirms' };
    }
    const result = runDijkstra(this.nodes, fromId, toId);
    if (!result) return null;
    return this.reconstructPath(result, fromId, toId);
  }

  private reconstructPath(
    result: DijkstraResult,
    fromId: string,
    toId: string,
  ): GraphPath {
    const nodeIds: string[] = [];
    const edges: EvidenceEdge[] = [];
    let cursor: string = toId;
    // Walk previous pointers backward until we reach the start.
    while (true) {
      nodeIds.unshift(cursor);
      if (cursor === fromId) break;
      const prev = result.previous.get(cursor);
      if (!prev) break;
      edges.unshift(prev.edge);
      cursor = prev.fromId;
    }
    const nodes = nodeIds
      .map((id) => this.nodes.get(id))
      .filter((n): n is MutableNode => n !== undefined)
      .map((n) => toGraphNode(n));
    return {
      nodes,
      edges,
      totalConfidence: edges.reduce((p, e) => p * e.confidence, 1),
      dominantEdgeType: dominantEdgeType(edges),
    };
  }

  // ── Filtered edge lookups ─────────────────────────────────────────

  getByEdgeType(type: EvidenceEdgeType): EvidenceEdge[] {
    const out: EvidenceEdge[] = [];
    for (const node of this.nodes.values()) {
      for (const edge of node.outgoingEdges) {
        if (edge.type === type) out.push(edge);
      }
    }
    return out;
  }

  getStrongEdges(minConfidence: number = DEFAULT_STRONG_CONFIDENCE): EvidenceEdge[] {
    const out: EvidenceEdge[] = [];
    for (const node of this.nodes.values()) {
      for (const edge of node.outgoingEdges) {
        if (edge.confidence >= minConfidence) out.push(edge);
      }
    }
    return out;
  }

  getContradictions(): EvidenceEdge[] {
    return this.getByEdgeType('contradicts');
  }

  // ── Confidence propagation ────────────────────────────────────────

  /** BFS from `startId` (confidence 1.0). Each step multiplies by the
   *  traversed edge's confidence. Returns the max confidence reachable
   *  to every node — useful for "given this is real, how strongly do
   *  we believe each neighbor"-style queries. */
  propagateConfidence(startId: string): Map<string, number> {
    const result = new Map<string, number>();
    if (!this.nodes.has(startId)) return result;
    result.set(startId, 1);
    const queue: { id: string; confidence: number }[] = [{ id: startId, confidence: 1 }];
    while (queue.length > 0) {
      const next = queue.shift()!;
      const node = this.nodes.get(next.id);
      if (!node) continue;
      for (const edge of node.outgoingEdges) {
        this.relaxConfidence(edge, edge.targetEventId, next.confidence, result, queue);
      }
      for (const edge of node.incomingEdges) {
        this.relaxConfidence(edge, edge.sourceEventId, next.confidence, result, queue);
      }
    }
    return result;
  }

  private relaxConfidence(
    edge: EvidenceEdge,
    otherId: string,
    parentConfidence: number,
    result: Map<string, number>,
    queue: { id: string; confidence: number }[],
  ): void {
    const candidate = parentConfidence * edge.confidence;
    const current = result.get(otherId) ?? 0;
    if (candidate <= current) return;
    result.set(otherId, candidate);
    queue.push({ id: otherId, confidence: candidate });
  }

  // ── Stats + lifecycle ─────────────────────────────────────────────

  stats(): GraphStats {
    const byEdgeType = emptyEdgeCounts();
    let edgeCount = 0;
    let confidenceSum = 0;
    let mostConnectedId: string | null = null;
    let mostConnectedDegree = -1;
    let isolatedCount = 0;
    for (const node of this.nodes.values()) {
      for (const edge of node.outgoingEdges) {
        byEdgeType[edge.type] += 1;
        edgeCount += 1;
        confidenceSum += edge.confidence;
      }
      const degree = node.outgoingEdges.length + node.incomingEdges.length;
      if (degree === 0) isolatedCount += 1;
      if (degree > mostConnectedDegree) {
        mostConnectedDegree = degree;
        mostConnectedId = node.id;
      }
    }
    return {
      nodeCount: this.nodes.size,
      edgeCount,
      byEdgeType,
      averageConfidence: edgeCount === 0 ? 0 : Number((confidenceSum / edgeCount).toFixed(4)),
      mostConnectedNodeId: this.nodes.size === 0 ? null : mostConnectedId,
      isolatedNodeCount: isolatedCount,
    };
  }

  clear(): void {
    this.nodes.clear();
    this.seenEdges.clear();
  }

  /** All known edge types — exposed for diagnostics + tests. */
  edgeTypes(): readonly EvidenceEdgeType[] {
    return EDGE_TYPES;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function edgeKey(edge: EvidenceEdge): string {
  const [a, b] = edge.sourceEventId < edge.targetEventId
    ? [edge.sourceEventId, edge.targetEventId]
    : [edge.targetEventId, edge.sourceEventId];
  return `${edge.type}|${a}|${b}|${edge.ruleId ?? ''}`;
}

function toGraphNode(node: MutableNode): GraphNode {
  const totalEdges = node.outgoingEdges.length + node.incomingEdges.length;
  const aggregate = totalEdges === 0
    ? 0
    : ([...node.outgoingEdges, ...node.incomingEdges]
        .reduce((acc, e) => acc + e.confidence, 0) / totalEdges);
  return {
    id: node.id,
    observation: node.observation,
    situationIds: [...node.situationIds],
    incomingEdges: [...node.incomingEdges],
    outgoingEdges: [...node.outgoingEdges],
    aggregateConfidence: Number(aggregate.toFixed(4)),
  };
}

function dominantEdgeType(edges: readonly EvidenceEdge[]): EvidenceEdgeType {
  if (edges.length === 0) return 'confirms';
  const counts = emptyEdgeCounts();
  let best: EvidenceEdgeType = edges[0]!.type;
  let bestCount = 0;
  for (const e of edges) {
    counts[e.type] += 1;
    if (counts[e.type] > bestCount) {
      best = e.type;
      bestCount = counts[e.type];
    }
  }
  return best;
}

// ── Dijkstra ─────────────────────────────────────────────────────────

interface DijkstraResult {
  previous: Map<string, { fromId: string; edge: EvidenceEdge }>;
}

interface DijkstraEdge {
  toId: string;
  edge: EvidenceEdge;
}

function buildAdjacency(nodes: ReadonlyMap<string, MutableNode>): Map<string, DijkstraEdge[]> {
  const adj = new Map<string, DijkstraEdge[]>();
  for (const node of nodes.values()) {
    const list: DijkstraEdge[] = [];
    for (const edge of node.outgoingEdges) {
      list.push({ toId: edge.targetEventId, edge });
    }
    for (const edge of node.incomingEdges) {
      list.push({ toId: edge.sourceEventId, edge });
    }
    adj.set(node.id, list);
  }
  return adj;
}

function runDijkstra(
  nodes: ReadonlyMap<string, MutableNode>,
  fromId: string,
  toId: string,
): DijkstraResult | null {
  const adjacency = buildAdjacency(nodes);
  const distances = new Map<string, number>();
  const previous = new Map<string, { fromId: string; edge: EvidenceEdge }>();
  const visited = new Set<string>();
  for (const id of nodes.keys()) distances.set(id, Infinity);
  distances.set(fromId, 0);
  while (visited.size < nodes.size) {
    const cursor = pickClosest(distances, visited);
    if (cursor === null) break;
    visited.add(cursor);
    if (cursor === toId) return { previous };
    const distHere = distances.get(cursor) ?? Infinity;
    for (const { toId: nextId, edge } of adjacency.get(cursor) ?? []) {
      if (visited.has(nextId)) continue;
      const weight = Math.max(0, 1 - edge.confidence);
      const candidate = distHere + weight;
      if (candidate < (distances.get(nextId) ?? Infinity)) {
        distances.set(nextId, candidate);
        previous.set(nextId, { fromId: cursor, edge });
      }
    }
  }
  return previous.has(toId) ? { previous } : null;
}

function pickClosest(distances: Map<string, number>, visited: Set<string>): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const [id, dist] of distances) {
    if (visited.has(id)) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = id;
    }
  }
  return best === null || bestDist === Infinity ? null : best;
}

// ── Singleton ────────────────────────────────────────────────────────

let _singleton: EvidenceGraphV2 | null = null;

export function getEvidenceGraph(): EvidenceGraphV2 {
  _singleton ??= new EvidenceGraphV2();
  return _singleton;
}

export function __resetEvidenceGraphSingleton(): void {
  _singleton = null;
}

// ── Internals exposed for tests + diagnostics ────────────────────────

export const __internals = {
  edgeKey,
  toGraphNode,
  dominantEdgeType,
  runDijkstra,
  DEFAULT_STRONG_CONFIDENCE,
  DEFAULT_MAX_DEPTH,
};
