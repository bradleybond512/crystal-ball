/**
 * Evidence Graph — typed nodes/edges connecting facts, sources,
 * locations, entities, and forecasts.
 *
 * Per the plan doc's "Evidence Graph Engine" (lines 22-59):
 *   Build a graph where alerts, events, sources, providers, locations,
 *   entities, forecasts, and user watchlist items are connected. Use it
 *   to produce evidence score, confidence score, explanation path,
 *   weakest evidence link, missing confirmation source, and a list of
 *   source agreements/disagreements.
 *
 * This module is intentionally pure: no fetch, no DOM, no globals. It
 * gives consumers (PR 2 situation clustering, PR 3 negative evidence,
 * the eventual UI) a deterministic structure to walk, query, and
 * explain.
 */

import type {
  EvidenceNode,
  EvidenceEdge,
  EvidenceEdgeKind,
  NormalizedFact,
  SourceAttestation,
} from './types';

// ── Public surface ────────────────────────────────────────────────────────

/** A live, queryable evidence graph. Construct with `createEvidenceGraph`,
 *  populate with `addFact`, then walk with the helper methods. */
export interface EvidenceGraph {
  /** All nodes in insertion order. Stable iteration for deterministic
   *  test snapshots. */
  readonly nodes: ReadonlyMap<string, EvidenceNode>;
  /** Adjacency keyed by source node id; values are arrays of outbound
   *  edges. Undirected relations (same_location, same_entity,
   *  same_time_window) are stored as two directed edges so the walker
   *  doesn't have to special-case them. */
  readonly adjacency: ReadonlyMap<string, readonly EvidenceEdge[]>;
  /** Add or merge a node. Re-adding an id keeps the first label/domain
   *  but merges meta. Returns the canonical node. */
  upsertNode: (node: EvidenceNode) => EvidenceNode;
  /** Add an edge. No-op if a same-kind edge already exists between the
   *  same endpoints; weight is taken as the max of existing/new. */
  addEdge: (edge: EvidenceEdge) => void;
  /** Add a fact and all its provenance edges (sources, location,
   *  entities, contradictions). Returns the fact node id. */
  addFact: (fact: NormalizedFact) => string;
  /** Get the outbound edges from a node, optionally filtered by kind. */
  edgesFrom: (nodeId: string, kind?: EvidenceEdgeKind) => readonly EvidenceEdge[];
  /** Get the inbound edges to a node, optionally filtered by kind.
   *  O(N) over edges; fine for the small graphs this layer produces. */
  edgesTo: (nodeId: string, kind?: EvidenceEdgeKind) => readonly EvidenceEdge[];
  /** All nodes connected to `nodeId` by edges of any of the given kinds.
   *  Walks both inbound and outbound. */
  neighbors: (nodeId: string, kinds?: readonly EvidenceEdgeKind[]) => EvidenceNode[];
  /** Source attestations (provider nodes) that attest to a fact node. */
  sourcesFor: (factId: string) => EvidenceNode[];
  /** Other facts that contradict the given fact. */
  contradictionsFor: (factId: string) => EvidenceNode[];
  /** Other facts that share the given fact's location node. */
  sameLocationFacts: (factId: string) => EvidenceNode[];
  /** Other facts that share at least one entity with the given fact. */
  sameEntityFacts: (factId: string) => EvidenceNode[];
}

export function createEvidenceGraph(): EvidenceGraph {
  const nodes = new Map<string, EvidenceNode>();
  const adjacency = new Map<string, EvidenceEdge[]>();

  function upsertNode(node: EvidenceNode): EvidenceNode {
    const existing = nodes.get(node.id);
    if (!existing) {
      nodes.set(node.id, { ...node });
      return nodes.get(node.id)!;
    }
    // Merge meta but preserve original kind/label/domain (first writer wins
    // on identity-shaping fields so a later re-add with looser data can't
    // demote a stronger node).
    const merged: EvidenceNode = {
      ...existing,
      meta: { ...existing.meta, ...node.meta },
    };
    nodes.set(node.id, merged);
    return merged;
  }

  function addEdge(edge: EvidenceEdge): void {
    const list = adjacency.get(edge.from) ?? [];
    const existing = list.find((e) => e.to === edge.to && e.kind === edge.kind);
    if (existing) {
      // Promote to the higher weight; merge meta.
      existing.weight = Math.max(existing.weight, edge.weight);
      existing.meta = { ...existing.meta, ...edge.meta };
      return;
    }
    list.push({ ...edge });
    adjacency.set(edge.from, list);
  }

  function addUndirectedEdge(a: string, b: string, kind: EvidenceEdgeKind, weight: number, meta?: Record<string, unknown>): void {
    addEdge({ from: a, to: b, kind, weight, meta });
    addEdge({ from: b, to: a, kind, weight, meta });
  }

  function addFact(fact: NormalizedFact): string {
    const factId = factNodeId(fact.id);
    upsertNode({
      id: factId,
      kind: 'fact',
      label: fact.claim,
      domain: fact.domain,
      meta: {
        eventType: fact.eventType,
        severity: fact.severity,
        occurredAt: fact.occurredAt,
        locationPrecision: fact.locationPrecision,
      },
    });

    // Source attestations.
    for (const src of fact.sources) {
      const sourceId = sourceNodeId(src.providerId);
      upsertNode({
        id: sourceId,
        kind: 'source',
        label: src.providerId,
        meta: { url: src.url },
      });
      addEdge({
        from: sourceId,
        to: factId,
        kind: 'attests',
        weight: 1,
        meta: { observedAt: src.observedAt, derivedFrom: src.derivedFrom },
      });
      // Reverse direction so a fact can ask "who attested to me?" without
      // an inbound scan. We use the same edge kind both ways; consumers
      // distinguish by direction (edgesFrom vs edgesTo).
    }

    // Location.
    if (fact.lat !== undefined && fact.lon !== undefined) {
      const locId = locationNodeId(fact.lat, fact.lon, fact.locationPrecision);
      upsertNode({
        id: locId,
        kind: 'location',
        label: `${fact.lat.toFixed(2)},${fact.lon.toFixed(2)} (${fact.locationPrecision})`,
        meta: { lat: fact.lat, lon: fact.lon, precision: fact.locationPrecision },
      });
      addUndirectedEdge(factId, locId, 'same_location', 1);
    }

    // Entities.
    for (const entityKey of fact.entities) {
      const entId = entityNodeId(entityKey);
      upsertNode({ id: entId, kind: 'entity', label: entityKey });
      addUndirectedEdge(factId, entId, 'same_entity', 1);
    }

    // Contradictions — record both directions so either side can ask
    // "what disputes me?". Caller is responsible for ensuring the
    // contradicted fact has also been added (we don't fabricate stub
    // nodes here because that would silently swallow typos).
    for (const otherFactId of fact.contradictedBy ?? []) {
      addEdge({
        from: factId,
        to: factNodeId(otherFactId),
        kind: 'contradicts',
        weight: 1,
      });
    }

    return factId;
  }

  function edgesFrom(nodeId: string, kind?: EvidenceEdgeKind): readonly EvidenceEdge[] {
    const list = adjacency.get(nodeId) ?? [];
    return kind ? list.filter((e) => e.kind === kind) : list;
  }

  function edgesTo(nodeId: string, kind?: EvidenceEdgeKind): readonly EvidenceEdge[] {
    const matches: EvidenceEdge[] = [];
    for (const list of adjacency.values()) {
      for (const edge of list) {
        if (edge.to === nodeId && (!kind || edge.kind === kind)) {
          matches.push(edge);
        }
      }
    }
    return matches;
  }

  function neighbors(nodeId: string, kinds?: readonly EvidenceEdgeKind[]): EvidenceNode[] {
    const ids = new Set<string>();
    const allow = kinds ? new Set(kinds) : null;
    for (const e of edgesFrom(nodeId)) {
      if (!allow || allow.has(e.kind)) ids.add(e.to);
    }
    for (const e of edgesTo(nodeId)) {
      if (!allow || allow.has(e.kind)) ids.add(e.from);
    }
    ids.delete(nodeId);
    const out: EvidenceNode[] = [];
    for (const id of ids) {
      const node = nodes.get(id);
      if (node) out.push(node);
    }
    return out;
  }

  function sourcesFor(factId: string): EvidenceNode[] {
    return edgesTo(factNodeId(factId), 'attests')
      .map((e) => nodes.get(e.from))
      .filter((n): n is EvidenceNode => n?.kind === 'source');
  }

  function contradictionsFor(factId: string): EvidenceNode[] {
    const fid = factNodeId(factId);
    const out = new Map<string, EvidenceNode>();
    for (const e of edgesFrom(fid, 'contradicts')) {
      const n = nodes.get(e.to);
      if (n?.kind === 'fact') out.set(n.id, n);
    }
    for (const e of edgesTo(fid, 'contradicts')) {
      const n = nodes.get(e.from);
      if (n?.kind === 'fact') out.set(n.id, n);
    }
    return [...out.values()];
  }

  function sameLocationFacts(factId: string): EvidenceNode[] {
    const fid = factNodeId(factId);
    const locNeighbors = neighbors(fid, ['same_location']).filter((n) => n.kind === 'location');
    const out = new Map<string, EvidenceNode>();
    for (const loc of locNeighbors) {
      for (const n of neighbors(loc.id, ['same_location'])) {
        if (n.kind === 'fact' && n.id !== fid) out.set(n.id, n);
      }
    }
    return [...out.values()];
  }

  function sameEntityFacts(factId: string): EvidenceNode[] {
    const fid = factNodeId(factId);
    const entNeighbors = neighbors(fid, ['same_entity']).filter((n) => n.kind === 'entity');
    const out = new Map<string, EvidenceNode>();
    for (const ent of entNeighbors) {
      for (const n of neighbors(ent.id, ['same_entity'])) {
        if (n.kind === 'fact' && n.id !== fid) out.set(n.id, n);
      }
    }
    return [...out.values()];
  }

  return {
    nodes,
    adjacency,
    upsertNode,
    addEdge,
    addFact,
    edgesFrom,
    edgesTo,
    neighbors,
    sourcesFor,
    contradictionsFor,
    sameLocationFacts,
    sameEntityFacts,
  };
}

// ── ID helpers (exported so callers can build edges to nodes that this
//    graph already created, without re-deriving the id format). ──────────

export function factNodeId(rawId: string): string { return `fact:${rawId}`; }
export function sourceNodeId(providerId: string): string { return `source:${providerId}`; }
export function entityNodeId(key: string): string { return `entity:${key}`; }
export function locationNodeId(lat: number, lon: number, precision: string): string {
  // Round to 2 decimals so two facts within ~1km share a location node
  // without spurious near-misses. Precision is part of the id so a 'point'
  // and a 'regional' claim at the same rounded coords don't collapse.
  return `loc:${precision}:${lat.toFixed(2)},${lon.toFixed(2)}`;
}

// ── Convenience: build a graph from a batch of facts in one pass. ────────

export function buildGraphFromFacts(facts: readonly NormalizedFact[]): EvidenceGraph {
  const g = createEvidenceGraph();
  for (const f of facts) g.addFact(f);
  return g;
}

// ── Inference: derive corroborates/contradicts edges between facts that
//    weren't explicitly linked. Two facts corroborate if they share an
//    eventType + (location OR entity) and occur within `timeWindowMs`
//    of each other. They contradict if they share location/entity but
//    have semantically opposed eventType pairs (issued vs canceled,
//    confirmed vs retracted) — the caller supplies the opposition map
//    since it's domain-specific. ──────────────────────────────────────

export interface InferenceOptions {
  timeWindowMs?: number;
  /** Pairs of eventType strings that are direct contradictions, e.g.
   *  [['tsunami-warning-issued', 'tsunami-warning-canceled']]. */
  contradictoryPairs?: readonly (readonly [string, string])[];
}

export function inferFactRelations(
  graph: EvidenceGraph,
  facts: readonly NormalizedFact[],
  options: InferenceOptions = {},
): void {
  const window = options.timeWindowMs ?? 60 * 60 * 1000; // 1h
  const oppositionMap = buildOppositionMap(options.contradictoryPairs ?? []);

  for (let i = 0; i < facts.length; i += 1) {
    for (let j = i + 1; j < facts.length; j += 1) {
      relatePair(graph, facts[i]!, facts[j]!, window, oppositionMap);
    }
  }
}

function buildOppositionMap(pairs: readonly (readonly [string, string])[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [a, b] of pairs) {
    if (!map.has(a)) map.set(a, new Set());
    if (!map.has(b)) map.set(b, new Set());
    map.get(a)!.add(b);
    map.get(b)!.add(a);
  }
  return map;
}

function relatePair(
  graph: EvidenceGraph,
  a: NormalizedFact,
  b: NormalizedFact,
  windowMs: number,
  oppositionMap: Map<string, Set<string>>,
): void {
  if (Math.abs(a.occurredAt - b.occurredAt) > windowMs) return;
  if (!sharesLocationOrEntity(a, b)) return;

  const opposed = oppositionMap.get(a.eventType)?.has(b.eventType) ?? false;
  if (opposed) {
    addUndirectedRelation(graph, a.id, b.id, 'contradicts', 1);
  } else if (a.eventType === b.eventType) {
    addUndirectedRelation(graph, a.id, b.id, 'corroborates', 0.8);
  }
}

function sharesLocationOrEntity(a: NormalizedFact, b: NormalizedFact): boolean {
  const sharesLocation = a.lat !== undefined && b.lat !== undefined &&
    a.lon !== undefined && b.lon !== undefined &&
    Math.abs(a.lat - b.lat) < 0.5 && Math.abs(a.lon - b.lon) < 0.5;
  const sharesEntity = a.entities.some((e) => b.entities.includes(e));
  return sharesLocation || sharesEntity;
}

function addUndirectedRelation(graph: EvidenceGraph, idA: string, idB: string, kind: EvidenceEdgeKind, weight: number): void {
  graph.addEdge({ from: factNodeId(idA), to: factNodeId(idB), kind, weight });
  graph.addEdge({ from: factNodeId(idB), to: factNodeId(idA), kind, weight });
}

// ── Independent-source counter — used by truth-score's diversity logic
//    callers and by negative-evidence in PR 3. A "root" source is one
//    that doesn't follow another via derivedFrom. ────────────────────────

export function countIndependentRoots(sources: readonly SourceAttestation[]): number {
  if (sources.length === 0) return 0;
  const byId = new Map(sources.map((s) => [s.providerId, s]));
  const roots = new Set<string>();
  for (const s of sources) {
    let cursor = s;
    let hops = 0;
    while (cursor.derivedFrom && hops < 5) {
      const parent = byId.get(cursor.derivedFrom);
      if (!parent) break;
      cursor = parent;
      hops += 1;
    }
    roots.add(cursor.providerId);
  }
  return roots.size;
}
