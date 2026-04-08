/**
 * Network Topology Tracking — in-memory graph model
 *
 * Tracks nodes (assets, services) and edges (connections) for a logical
 * network graph. Supports status updates, alert ingestion, neighbor queries,
 * and dashboard rollup. Auto-prunes alerts older than 72 hours.
 *
 * Fully offline, no network calls, no external dependencies.
 * Integration: call addNode/addEdge/updateNodeStatus from cyber or infrastructure
 * data-loader integrations after each topology data refresh.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type TopoNodeType =
  | 'server'
  | 'workstation'
  | 'router'
  | 'firewall'
  | 'switch'
  | 'ics_device'
  | 'cloud_service'
  | 'external'
  | 'unknown';

export interface TopoNode {
  id: string;
  label: string;
  type: TopoNodeType;
  ip?: string;
  hostname?: string;
  location?: string;
  status: 'healthy' | 'degraded' | 'down' | 'compromised';
  lastSeen: number;
  metadata: Record<string, string>;
}

export interface TopoEdge {
  id: string;
  sourceId: string;
  targetId: string;
  protocol?: string;
  port?: number;
  bandwidth?: string;
  status: 'active' | 'inactive' | 'suspicious';
  lastSeen: number;
}

export interface TopoAlert {
  id: string;
  nodeId?: string;
  edgeId?: string;
  alertType:
 | 'new_connection'
 | 'node_down'
 | 'suspicious_traffic'
 | 'port_scan'
 | 'lateral_movement'
 | 'data_exfiltration';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  timestamp: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALERT_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours
const DEFAULT_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_RECENT_ALERTS = 10;

// ── State ──────────────────────────────────────────────────────────────────────

const _nodes = new Map<string, TopoNode>();
const _edges = new Map<string, TopoEdge>();
let _alerts: TopoAlert[] = [];
let _edgeCounter = 0;

// ── ID generation ─────────────────────────────────────────────────────────────

let _alertCounter = 0;

/** Generate a sequential alert ID. */
function generateAlertId(): string {
  _alertCounter++;
  return `alert-${Date.now()}-${_alertCounter}`;
}

/** Generate a sequential edge ID. */
function generateEdgeId(): string {
  _edgeCounter++;
  return `edge-${_edgeCounter}`;
}

// ── Pruning ────────────────────────────────────────────────────────────────────

/** Remove alerts older than 72 hours. Called on each ingest. */
function pruneAlerts(): void {
  const cutoff = Date.now() - ALERT_TTL_MS;
  _alerts = _alerts.filter(a => a.timestamp >= cutoff);
}

// ── Node management ───────────────────────────────────────────────────────────

/**
 * Add or update a node in the topology graph.
 * If a node with the given id already exists, its fields are merged/updated.
 */
export function addNode(
  id: string,
  label: string,
  type: TopoNodeType,
  opts?: {
 ip?: string;
 hostname?: string;
 location?: string;
 metadata?: Record<string, string>;
  },
): void {
  const existing = _nodes.get(id);
  const node: TopoNode = {
 id,
 label,
 type,
 ip: opts?.ip ?? existing?.ip,
 hostname: opts?.hostname ?? existing?.hostname,
 location: opts?.location ?? existing?.location,
 status: existing?.status ?? 'healthy',
 lastSeen: Date.now(),
 metadata: { ...(existing?.metadata ?? {}), ...(opts?.metadata ?? {}) },
  };
  _nodes.set(id, node);
}

/**
 * Remove a node and all edges that reference it (as source or target).
 */
export function removeNode(id: string): void {
  _nodes.delete(id);
  for (const [edgeId, edge] of _edges.entries()) {
 if (edge.sourceId === id || edge.targetId === id) {
 _edges.delete(edgeId);
 }
  }
}

/**
 * Update the status of a node.
 * No-ops if the node does not exist.
 */
export function updateNodeStatus(id: string, status: TopoNode['status']): void {
  const node = _nodes.get(id);
  if (!node) return;
  _nodes.set(id, { ...node, status, lastSeen: Date.now() });
}

// ── Edge management ───────────────────────────────────────────────────────────

/**
 * Add a directed edge between two nodes.
 * Returns the generated edge id.
 */
export function addEdge(
  sourceId: string,
  targetId: string,
  opts?: {
 protocol?: string;
 port?: number;
 bandwidth?: string;
  },
): string {
  const id = generateEdgeId();
  const edge: TopoEdge = {
 id,
 sourceId,
 targetId,
 protocol: opts?.protocol,
 port: opts?.port,
 bandwidth: opts?.bandwidth,
 status: 'active',
 lastSeen: Date.now(),
  };
  _edges.set(id, edge);
  return id;
}

/**
 * Remove an edge by id.
 * No-ops if the edge does not exist.
 */
export function removeEdge(id: string): void {
  _edges.delete(id);
}

/**
 * Update the status of an edge.
 * No-ops if the edge does not exist.
 */
export function updateEdgeStatus(id: string, status: TopoEdge['status']): void {
  const edge = _edges.get(id);
  if (!edge) return;
  _edges.set(id, { ...edge, status, lastSeen: Date.now() });
}

// ── Alert ingestion ───────────────────────────────────────────────────────────

/**
 * Log a topology alert. Auto-prunes alerts older than 72 hours after ingestion.
 */
export function ingestTopoAlert(
  alertType: TopoAlert['alertType'],
  severity: TopoAlert['severity'],
  description: string,
  nodeId?: string,
  edgeId?: string,
): void {
  const alert: TopoAlert = {
 id: generateAlertId(),
 alertType,
 severity,
 description,
 timestamp: Date.now(),
 ...(nodeId !== undefined ? { nodeId } : {}),
 ...(edgeId !== undefined ? { edgeId } : {}),
  };
  _alerts.push(alert);
  pruneAlerts();
}

// ── Read APIs ─────────────────────────────────────────────────────────────────

/** Return all nodes as an array. */
export function getNodes(): TopoNode[] {
  return Array.from(_nodes.values());
}

/** Return all edges as an array. */
export function getEdges(): TopoEdge[] {
  return Array.from(_edges.values());
}

/**
 * Return alerts since the given timestamp (default: last 24 hours).
 * Results are sorted newest first.
 */
export function getTopoAlerts(since?: number): TopoAlert[] {
  const cutoff = since ?? Date.now() - DEFAULT_ALERT_WINDOW_MS;
  return _alerts
 .filter(a => a.timestamp >= cutoff)
 .sort((a, b) => b.timestamp - a.timestamp);
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export interface TopoDashboard {
  nodeCount: number;
  edgeCount: number;
  healthyNodes: number;
  compromisedNodes: number;
  downNodes: number;
  activeAlerts: number;
  recentAlerts: TopoAlert[];
}

/**
 * Return a rollup of key topology metrics.
 * recentAlerts contains the most recent 10 alerts (within the last 24 hours).
 */
export function getTopoDashboard(): TopoDashboard {
  const nodes = Array.from(_nodes.values());
  const recent = getTopoAlerts();

  return {
 nodeCount: nodes.length,
 edgeCount: _edges.size,
 healthyNodes: nodes.filter(n => n.status === 'healthy').length,
 compromisedNodes: nodes.filter(n => n.status === 'compromised').length,
 downNodes: nodes.filter(n => n.status === 'down').length,
 activeAlerts: recent.length,
 recentAlerts: recent.slice(0, MAX_RECENT_ALERTS),
  };
}

// ── Neighbor query ────────────────────────────────────────────────────────────

/**
 * Return all nodes and edges directly connected to the given node.
 * Includes both inbound and outbound edges.
 */
export function getNeighbors(nodeId: string): { nodes: TopoNode[]; edges: TopoEdge[] } {
  const connectedEdges = Array.from(_edges.values()).filter(
 e => e.sourceId === nodeId || e.targetId === nodeId,
  );

  const neighborIds = new Set<string>();
  for (const edge of connectedEdges) {
 if (edge.sourceId !== nodeId) neighborIds.add(edge.sourceId);
 if (edge.targetId !== nodeId) neighborIds.add(edge.targetId);
  }

  const neighborNodes = Array.from(neighborIds)
 .map(id => _nodes.get(id))
 .filter((n): n is TopoNode => n !== undefined);

  return { nodes: neighborNodes, edges: connectedEdges };
}
