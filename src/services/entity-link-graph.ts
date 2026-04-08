/**
 * Entity Link Graph — visual entity relationship graph data model
 *
 * Builds on entity-extraction.ts by adding explicit directed-edge tracking
 * for visualization and path-finding. Nodes represent real-world entities
 * (persons, orgs, locations, events, IOCs, vessels, units, infrastructure);
 * edges represent named relationships between them with supporting evidence.
 *
 * Limits: max 2000 nodes, 5000 edges. When either limit is hit the oldest
 * entries (by lastSeen / timestamp) are LRU-pruned to make room.
 *
 * No external dependencies, no network calls. All state is in-memory.
 */

// ── Types ──────────────────────────────────────────────────────────────────

/** Vocabulary of entity categories */
export type GraphNodeType =
  | 'person'
  | 'organization'
  | 'location'
  | 'event'
  | 'ioc'
  | 'vessel'
  | 'unit'
  | 'infrastructure';

/** A single entity node in the graph */
export interface GraphNode {
  /** Stable unique identifier, caller-supplied */
  id: string;
  /** Human-readable display name */
  label: string;
  /** Entity category */
  type: GraphNodeType;
  /** Prominence score — incremented each time the node is re-added */
  weight: number;
  /** Unix ms — when this node was first recorded */
  firstSeen: number;
  /** Unix ms — most recent add or update */
  lastSeen: number;
  /** Arbitrary key/value annotations (e.g. country, alias, confidence) */
  metadata: Record<string, string>;
}

/** A directed relationship between two nodes */
export interface GraphEdge {
  /** Auto-generated stable identifier */
  id: string;
  /** Source node id */
  sourceId: string;
  /** Target node id */
  targetId: string;
  /** Relationship label, e.g. "commands", "located_in", "linked_to" */
  relationship: string;
  /** Prominence score — incremented each time this edge is re-added */
  weight: number;
  /** Supporting evidence strings (article titles, report refs, etc.) */
  evidence: string[];
  /** Unix ms — when this edge was first or most recently observed */
  timestamp: number;
}

/** Aggregated statistics for dashboard display */
export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  /** Per-type node counts */
  byType: Record<GraphNodeType, number>;
  /** Top-5 nodes by weight */
  topNodes: GraphNode[];
  /** Number of connected components (clusters) */
  clusters: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_NODES = 2000;
const MAX_EDGES = 5000;
/** Maximum evidence strings retained per edge */
const MAX_EDGE_EVIDENCE = 20;

// ── State ──────────────────────────────────────────────────────────────────

const _nodes = new Map<string, GraphNode>();
const _edges = new Map<string, GraphEdge>();

/** Dedup index for edges: `${sourceId}::${targetId}::${relationship}` → edgeId */
const _edgeIndex = new Map<string, string>();

/** Adjacency sets — forward and reverse, for O(1) neighbor lookup */
const _outEdges = new Map<string, Set<string>>(); // nodeId → Set<edgeId>
const _inEdges = new Map<string, Set<string>>();  // nodeId → Set<edgeId>

let _edgeCounter = 0;

// ── Helpers ────────────────────────────────────────────────────────────────

function edgeDedupKey(sourceId: string, targetId: string, relationship: string): string {
  return `${sourceId}::${targetId}::${relationship}`;
}

function generateEdgeId(): string {
  _edgeCounter += 1;
  return `eg-${Date.now()}-${_edgeCounter}`;
}

/** Prune the N oldest nodes (by lastSeen) to bring count under MAX_NODES */
function pruneNodesIfNeeded(): void {
  if (_nodes.size < MAX_NODES) return;
  const sorted = Array.from(_nodes.values()).sort((a, b) => a.lastSeen - b.lastSeen);
  const toRemove = sorted.slice(0, Math.ceil(MAX_NODES * 0.1)); // evict 10 %
  for (const node of toRemove) {
 removeGraphNode(node.id);
  }
}

/** Prune the N oldest edges (by timestamp) to bring count under MAX_EDGES */
function pruneEdgesIfNeeded(): void {
  if (_edges.size < MAX_EDGES) return;
  const sorted = Array.from(_edges.values()).sort((a, b) => a.timestamp - b.timestamp);
  const toRemove = sorted.slice(0, Math.ceil(MAX_EDGES * 0.1)); // evict 10 %
  for (const edge of toRemove) {
 _edges.delete(edge.id);
 _edgeIndex.delete(edgeDedupKey(edge.sourceId, edge.targetId, edge.relationship));
 _outEdges.get(edge.sourceId)?.delete(edge.id);
 _inEdges.get(edge.targetId)?.delete(edge.id);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Add a new node or update an existing one. Re-adding an existing id bumps
 * weight by 1 and refreshes lastSeen / metadata. Returns the node id.
 */
export function addGraphNode(
  id: string,
  label: string,
  type: GraphNodeType,
  metadata: Record<string, string> = {},
): string {
  const now = Date.now();
  const existing = _nodes.get(id);
  if (existing) {
 existing.weight += 1;
 existing.lastSeen = now;
 existing.label = label;
 Object.assign(existing.metadata, metadata);
 return id;
  }

  pruneNodesIfNeeded();

  const node: GraphNode = {
 id,
 label,
 type,
 weight: 1,
 firstSeen: now,
 lastSeen: now,
 metadata: { ...metadata },
  };
  _nodes.set(id, node);
  return id;
}

/**
 * Add a new directed edge or update an existing one (matched by
 * sourceId + targetId + relationship). Re-adding bumps weight and appends
 * evidence. Both endpoint nodes must exist; if either is absent this is a
 * no-op and returns an empty string.
 *
 * Returns the edge id.
 */
export function addGraphEdge(
  sourceId: string,
  targetId: string,
  relationship: string,
  evidence: string[] = [],
): string {
  if (!_nodes.has(sourceId) || !_nodes.has(targetId)) return '';

  const key = edgeDedupKey(sourceId, targetId, relationship);
  const existingId = _edgeIndex.get(key);

  if (existingId) {
 const existing = _edges.get(existingId)!;
 existing.weight += 1;
 existing.timestamp = Date.now();
 for (const ev of evidence) {
 if (!existing.evidence.includes(ev)) {
 existing.evidence.push(ev);
 }
 }
 if (existing.evidence.length > MAX_EDGE_EVIDENCE) {
 existing.evidence = existing.evidence.slice(-MAX_EDGE_EVIDENCE);
 }
 return existingId;
  }

  pruneEdgesIfNeeded();

  const id = generateEdgeId();
  const edge: GraphEdge = {
 id,
 sourceId,
 targetId,
 relationship,
 weight: 1,
 evidence: evidence.slice(0, MAX_EDGE_EVIDENCE),
 timestamp: Date.now(),
  };

  _edges.set(id, edge);
  _edgeIndex.set(key, id);

  if (!_outEdges.has(sourceId)) _outEdges.set(sourceId, new Set());
  if (!_inEdges.has(targetId)) _inEdges.set(targetId, new Set());
  _outEdges.get(sourceId)!.add(id);
  _inEdges.get(targetId)!.add(id);

  return id;
}

/**
 * Remove a node and all edges that connect to it. No-op if id is absent.
 */
export function removeGraphNode(id: string): void {
  if (!_nodes.has(id)) return;

  // Collect all connected edge ids
  const connectedEdgeIds = new Set<string>([
 ...(_outEdges.get(id) ?? []),
 ...(_inEdges.get(id) ?? []),
  ]);

  for (const edgeId of connectedEdgeIds) {
 const edge = _edges.get(edgeId);
 if (!edge) continue;
 _edges.delete(edgeId);
 _edgeIndex.delete(edgeDedupKey(edge.sourceId, edge.targetId, edge.relationship));
 _outEdges.get(edge.sourceId)?.delete(edgeId);
 _inEdges.get(edge.targetId)?.delete(edgeId);
  }

  _outEdges.delete(id);
  _inEdges.delete(id);
  _nodes.delete(id);
}

/** Options for filtered node retrieval */
export interface GetGraphNodesOptions {
  type?: GraphNodeType;
  minWeight?: number;
  limit?: number;
}

/**
 * Return nodes sorted by weight descending, with optional type / minWeight
 * filter and a result limit.
 */
export function getGraphNodes(opts: GetGraphNodesOptions = {}): GraphNode[] {
  let results = Array.from(_nodes.values());

  if (opts.type !== undefined) {
 results = results.filter(n => n.type === opts.type);
  }
  if (opts.minWeight !== undefined) {
 results = results.filter(n => n.weight >= opts.minWeight!);
  }

  results.sort((a, b) => b.weight - a.weight);

  if (opts.limit !== undefined && opts.limit > 0) {
 results = results.slice(0, opts.limit);
  }

  return results;
}

/** Options for filtered edge retrieval */
export interface GetGraphEdgesOptions {
  /** Filter to edges where sourceId or targetId equals this value */
  nodeId?: string;
  relationship?: string;
  limit?: number;
}

/**
 * Return edges sorted by weight descending, with optional nodeId /
 * relationship filter and a result limit.
 */
export function getGraphEdges(opts: GetGraphEdgesOptions = {}): GraphEdge[] {
  let results = Array.from(_edges.values());

  if (opts.nodeId !== undefined) {
 const nid = opts.nodeId;
 results = results.filter(e => e.sourceId === nid || e.targetId === nid);
  }
  if (opts.relationship !== undefined) {
 results = results.filter(e => e.relationship === opts.relationship);
  }

  results.sort((a, b) => b.weight - a.weight);

  if (opts.limit !== undefined && opts.limit > 0) {
 results = results.slice(0, opts.limit);
  }

  return results;
}

/**
 * Return all nodes and edges directly connected to nodeId (one hop).
 * Returns empty collections if the node does not exist.
 */
export function getNodeNeighbors(nodeId: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!_nodes.has(nodeId)) return { nodes: [], edges: [] };

  const edgeIds = new Set<string>([
 ...(_outEdges.get(nodeId) ?? []),
 ...(_inEdges.get(nodeId) ?? []),
  ]);

  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  for (const edgeId of edgeIds) {
 const edge = _edges.get(edgeId);
 if (!edge) continue;
 edges.push(edge);
 nodeIds.add(edge.sourceId);
 nodeIds.add(edge.targetId);
  }
  nodeIds.delete(nodeId);

  const nodes = Array.from(nodeIds)
 .map(id => _nodes.get(id))
 .filter((n): n is GraphNode => n !== undefined);

  return { nodes, edges };
}

/** Aggregated graph statistics for dashboard display */
export function getGraphStats(): GraphStats {
  const byType: Record<GraphNodeType, number> = {
 person: 0,
 organization: 0,
 location: 0,
 event: 0,
 ioc: 0,
 vessel: 0,
 unit: 0,
 infrastructure: 0,
  };

  for (const node of _nodes.values()) {
 byType[node.type] += 1;
  }

  const topNodes = Array.from(_nodes.values())
 .sort((a, b) => b.weight - a.weight)
 .slice(0, 5);

  return {
 nodeCount: _nodes.size,
 edgeCount: _edges.size,
 byType,
 topNodes,
 clusters: getGraphClusters().length,
  };
}

/**
 * BFS shortest path from fromId to toId. Returns the node sequence including
 * both endpoints, or an empty array if no path exists within maxDepth hops.
 * Default maxDepth is 4.
 */
export function findPaths(fromId: string, toId: string, maxDepth = 4): GraphNode[] {
  if (!_nodes.has(fromId) || !_nodes.has(toId)) return [];
  if (fromId === toId) {
 const n = _nodes.get(fromId);
 return n ? [n] : [];
  }

  // BFS over undirected adjacency (follow both out- and in-edges)
  const queue: Array<{ nodeId: string; path: string[] }> = [
 { nodeId: fromId, path: [fromId] },
  ];
  const visited = new Set<string>([fromId]);

  while (queue.length > 0) {
 const { nodeId, path } = queue.shift()!;
 if (path.length > maxDepth + 1) break;

 const neighborIds = new Set<string>();
 for (const edgeId of _outEdges.get(nodeId) ?? []) {
 const e = _edges.get(edgeId);
 if (e) neighborIds.add(e.targetId);
 }
 for (const edgeId of _inEdges.get(nodeId) ?? []) {
 const e = _edges.get(edgeId);
 if (e) neighborIds.add(e.sourceId);
 }

 for (const neighborId of neighborIds) {
 if (visited.has(neighborId)) continue;
 const newPath = [...path, neighborId];
 if (neighborId === toId) {
 return newPath
 .map(id => _nodes.get(id))
 .filter((n): n is GraphNode => n !== undefined);
 }
 visited.add(neighborId);
 queue.push({ nodeId: neighborId, path: newPath });
 }
  }

  return [];
}

/**
 * Compute connected components using iterative union-find over the undirected
 * adjacency. Returns an array of node-id arrays, one per component, sorted by
 * component size descending.
 */
export function getGraphClusters(): string[][] {
  const parent = new Map<string, string>();

  function find(x: string): string {
 let root = x;
 while (parent.get(root) !== root) {
 root = parent.get(root)!;
 }
 // Path compression
 let cur = x;
 while (cur !== root) {
 const next = parent.get(cur)!;
 parent.set(cur, root);
 cur = next;
 }
 return root;
  }

  function union(a: string, b: string): void {
 const ra = find(a);
 const rb = find(b);
 if (ra !== rb) parent.set(ra, rb);
  }

  // Initialise every node as its own root
  for (const nodeId of _nodes.keys()) {
 parent.set(nodeId, nodeId);
  }

  // Union connected nodes
  for (const edge of _edges.values()) {
 if (_nodes.has(edge.sourceId) && _nodes.has(edge.targetId)) {
 union(edge.sourceId, edge.targetId);
 }
  }

  // Group by root
  const componentMap = new Map<string, string[]>();
  for (const nodeId of _nodes.keys()) {
 const root = find(nodeId);
 if (!componentMap.has(root)) componentMap.set(root, []);
 componentMap.get(root)!.push(nodeId);
  }

  return Array.from(componentMap.values()).sort((a, b) => b.length - a.length);
}

/** Clear all graph state. */
export function resetGraph(): void {
  _nodes.clear();
  _edges.clear();
  _edgeIndex.clear();
  _outEdges.clear();
  _inEdges.clear();
  _edgeCounter = 0;
}
