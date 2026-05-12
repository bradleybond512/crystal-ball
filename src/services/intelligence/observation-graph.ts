/**
 * Observation Graph — directed graph of ObservationEvent relationships.
 *
 * Distinct from the NormalizedFact-based evidence-graph.ts; this module
 * operates on raw ObservationEvents from the observation store and
 * auto-derives structural edges (proximity, entity overlap, temporal
 * adjacency, correlation).
 *
 * Pure: no DOM, no fetch, no globals. Max 5000 edges with LRU eviction.
 */

import type { ObservationEvent } from '@/types/intelligence';
import { haversineKm } from '@/services/proximity-filter';

// ── Types ────────────────────────────────────────────────────────────────

export type EdgeType =
  | 'caused_by'
  | 'co_located'
  | 'temporally_adjacent'
  | 'entity_shared'
  | 'correlated';

export interface ObsEvidenceEdge {
  from: string;
  to: string;
  type: EdgeType;
  confidence: number;
  created: number;
}

export interface ObservationGraph {
  addEdge(from: string, to: string, type: EdgeType, confidence: number): void;
  getEdges(eventId: string): ObsEvidenceEdge[];
  getNeighbors(eventId: string): string[];
  findPath(from: string, to: string): string[] | null;
  /** Ingest a batch of events, auto-populating structural edges. */
  populate(events: ObservationEvent[], opts?: PopulateOptions): void;
  edgeCount(): number;
  _reset(): void;
}

export interface PopulateOptions {
  /** Clock override for tests. */
  now?: () => number;
  /** Proximity threshold for co_located edges (km, default 100). */
  coLocatedKm?: number;
  /** Temporal window for temporally_adjacent edges (ms, default 30 min). */
  temporalWindowMs?: number;
}

const MAX_EDGES = 5000;

// ── Factory ──────────────────────────────────────────────────────────────

export function createObservationGraph(): ObservationGraph {
  // Edges stored in insertion order — the LRU eviction simply removes the
  // oldest entry (index 0) when we exceed MAX_EDGES.
  const edges: ObsEvidenceEdge[] = [];

  function addEdge(from: string, to: string, type: EdgeType, confidence: number): void {
    // De-duplicate: keep the higher-confidence edge for the same (from,to,type).
    const existing = edges.find((e) => e.from === from && e.to === to && e.type === type);
    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence);
      existing.created = Date.now();
      return;
    }
    if (edges.length >= MAX_EDGES) {
      edges.shift(); // LRU eviction — remove oldest
    }
    edges.push({ from, to, type, confidence, created: Date.now() });
  }

  function getEdges(eventId: string): ObsEvidenceEdge[] {
    return edges.filter((e) => e.from === eventId || e.to === eventId);
  }

  function getNeighbors(eventId: string): string[] {
    const seen = new Set<string>();
    for (const e of edges) {
      if (e.from === eventId) seen.add(e.to);
      if (e.to === eventId) seen.add(e.from);
    }
    seen.delete(eventId);
    return [...seen];
  }

  function findPath(from: string, to: string): string[] | null {
    if (from === to) return [from];
    const visited = new Set<string>([from]);
    const queue: string[][] = [[from]];
    while (queue.length > 0) {
      const path = queue.shift()!;
      const current = path[path.length - 1]!;
      for (const neighbor of getNeighbors(current)) {
        if (neighbor === to) return [...path, neighbor];
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([...path, neighbor]);
        }
      }
    }
    return null;
  }

  function tryEntityShared(a: ObservationEvent, b: ObservationEvent): void {
    const shared = a.entityIds.find((id) => b.entityIds.includes(id));
    if (!shared) return;
    addEdge(a.id, b.id, 'entity_shared', 0.8);
    addEdge(b.id, a.id, 'entity_shared', 0.8);
  }

  function tryCoLocated(a: ObservationEvent, b: ObservationEvent, limitKm: number): void {
    if (!a.location || !b.location) return;
    const dist = haversineKm(a.location.lat, a.location.lon, b.location.lat, b.location.lon);
    if (dist > limitKm) return;
    const conf = Number(Math.max(0.4, 1 - dist / limitKm).toFixed(3));
    addEdge(a.id, b.id, 'co_located', conf);
    addEdge(b.id, a.id, 'co_located', conf);
  }

  function tryTemporallyAdjacent(a: ObservationEvent, b: ObservationEvent, windowMs: number): void {
    const diff = Math.abs(a.timestamp - b.timestamp);
    if (diff > windowMs) return;
    const conf = Number((1 - (diff / windowMs) * 0.5).toFixed(3));
    addEdge(a.id, b.id, 'temporally_adjacent', conf);
    addEdge(b.id, a.id, 'temporally_adjacent', conf);
  }

  function tryCorrelated(a: ObservationEvent, b: ObservationEvent): void {
    if (a.domain !== b.domain) return;
    if (!a.tags.some((t) => b.tags.includes(t))) return;
    addEdge(a.id, b.id, 'correlated', 0.6);
    addEdge(b.id, a.id, 'correlated', 0.6);
  }

  function populate(events: ObservationEvent[], opts: PopulateOptions = {}): void {
    const coLocatedKm = opts.coLocatedKm ?? 100;
    const temporalWindowMs = opts.temporalWindowMs ?? 30 * 60_000;

    for (let i = 0; i < events.length; i++) {
      const a = events[i]!;
      for (let j = i + 1; j < events.length; j++) {
        const b = events[j]!;
        tryEntityShared(a, b);
        tryCoLocated(a, b, coLocatedKm);
        tryTemporallyAdjacent(a, b, temporalWindowMs);
        tryCorrelated(a, b);
      }
    }
  }

  function edgeCount(): number {
    return edges.length;
  }

  function _reset(): void {
    edges.length = 0;
  }

  return { addEdge, getEdges, getNeighbors, findPath, populate, edgeCount, _reset };
}

// ── Module-level singleton for the data-loader / panel layer ─────────────

const _singleton = createObservationGraph();
export const observationGraph: ObservationGraph = _singleton;
