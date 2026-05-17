/**
 * CausalChainBuilder — construct directed cause→effect chains from
 * correlated observations. Causality is inferred from three signals:
 *   1. Temporal order: cause precedes effect
 *   2. Spatial proximity: cause and effect within MAX_DISTANCE_KM
 *   3. Documented dependency: domain-pair appears in
 *      DomainDependencyGraph as a cascade / amplification / inhibition
 *      / correlation edge.
 *
 * Pure deterministic; no DOM, no fetch.
 */

import { haversineKm } from '../proximity-filter';
import type { ObservationEvent } from './observation-adapters';
import type { CorrelatedPair } from './correlate-engine';
import type { Situation } from './situation-store-v2';
import type { DomainDependency, DomainDependencyGraph } from './domain-dependency';
import { getDomainDependencyGraph } from './domain-dependency';

// ── Public types ─────────────────────────────────────────────────────

export interface CausalLink {
  causeId: string;
  effectId: string;
  mechanism: string;
  confidence: number;
  delayHours: number;
  evidenceObservationIds: string[];
}

export interface CausalChain {
  id: string;
  rootCause: ObservationEvent;
  links: CausalLink[];
  leafEffects: ObservationEvent[];
  overallConfidence: number;
  longestPath: number;
  situationId: string | null;
  builtAt: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CausalChainBuilderOptions {
  capacity?: number;
  storage?: StorageLike | null;
  now?: () => number;
  dependencies?: DomainDependencyGraph;
}

const DEFAULT_CAPACITY = 100;
const MAX_DISTANCE_KM = 500;
export const STORAGE_KEY = 'wm-causal-chains';

// ── Engine ──────────────────────────────────────────────────────────

interface PersistedState {
  chains: CausalChain[];
}

export class CausalChainBuilder {
  private readonly capacity: number;
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly dependencies: DomainDependencyGraph;
  private readonly byId = new Map<string, CausalChain>();
  private readonly order: string[] = [];
  private readonly subscribers = new Set<(chain: CausalChain) => void>();
  private idCounter = 0;

  constructor(opts: CausalChainBuilderOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.dependencies = opts.dependencies ?? getDomainDependencyGraph();
    this.hydrate();
  }

  buildChain(
    rootObs: ObservationEvent,
    allObs: readonly ObservationEvent[],
    correlations: readonly CorrelatedPair[],
  ): CausalChain {
    const builtAt = this.clock();
    const links = rootObs.location
      ? collectLinks(rootObs, allObs, correlations, this.dependencies)
      : [];
    const leafEffects = computeLeaves(rootObs, allObs, links);
    const longestPath = computeLongestPath(rootObs.id, links);
    const overallConfidence = computeOverallConfidence(links);
    const chain: CausalChain = {
      id: this.nextId(),
      rootCause: rootObs,
      links,
      leafEffects,
      overallConfidence,
      longestPath,
      situationId: null,
      builtAt,
    };
    this.commit(chain);
    return chain;
  }

  buildChainForSituation(
    situation: Situation,
    observations: readonly ObservationEvent[],
  ): CausalChain | null {
    const pool = situation.observations.length > 0 ? situation.observations : observations;
    if (pool.length === 0) return null;
    const root = [...pool].sort((a, b) => a.timestamp - b.timestamp)[0]!;
    const chain = this.buildChain(root, observations, []);
    const updated: CausalChain = { ...chain, situationId: situation.id };
    this.byId.set(chain.id, updated);
    this.persist();
    return updated;
  }

  getChains(): CausalChain[] {
    return [...this.byId.values()];
  }

  getChain(id: string): CausalChain | undefined {
    return this.byId.get(id);
  }

  subscribe(cb: (chain: CausalChain) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  unsubscribe(cb: (chain: CausalChain) => void): void {
    this.subscribers.delete(cb);
  }

  clear(): void {
    this.byId.clear();
    this.order.length = 0;
    this.persist();
  }

  // ── Internals ─────────────────────────────────────────────────────

  private commit(chain: CausalChain): void {
    this.byId.set(chain.id, chain);
    this.order.push(chain.id);
    while (this.order.length > this.capacity) {
      const evict = this.order.shift();
      if (evict !== undefined) this.byId.delete(evict);
    }
    this.persist();
    for (const cb of this.subscribers) cb(chain);
  }

  private nextId(): string {
    this.idCounter++;
    return `chain-${this.clock()}-${this.idCounter}`;
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedState;
      if (!parsed || !Array.isArray(parsed.chains)) return;
      for (const chain of parsed.chains) {
        if (!this.byId.has(chain.id)) this.order.push(chain.id);
        this.byId.set(chain.id, chain);
      }
    } catch {
      this.byId.clear();
      this.order.length = 0;
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const serial: PersistedState = { chains: [...this.byId.values()] };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // Storage failures are non-fatal.
    }
  }
}

// ── Lazy singleton ──────────────────────────────────────────────────

let singleton: CausalChainBuilder | undefined;

export function getCausalChainBuilder(): CausalChainBuilder {
  singleton ??= new CausalChainBuilder();
  return singleton;
}

export function resetForTests(): void {
  singleton = undefined;
}

// ── Graph construction ──────────────────────────────────────────────

function collectLinks(
  root: ObservationEvent,
  allObs: readonly ObservationEvent[],
  correlations: readonly CorrelatedPair[],
  graph: DomainDependencyGraph,
): CausalLink[] {
  const links: CausalLink[] = [];
  const correlationByPair = buildCorrelationLookup(correlations);
  const visited = new Set<string>([root.id]);
  const queue: ObservationEvent[] = [root];
  while (queue.length > 0) {
    const cause = queue.shift()!;
    if (!cause.location) continue;
    for (const candidate of allObs) {
      const link = tryLink(cause, candidate, visited, correlationByPair, graph);
      if (!link) continue;
      links.push(link);
      visited.add(candidate.id);
      queue.push(candidate);
    }
  }
  return links;
}

function buildCorrelationLookup(correlations: readonly CorrelatedPair[]): Map<string, CorrelatedPair> {
  const out = new Map<string, CorrelatedPair>();
  for (const pair of correlations) {
    out.set(unorderedKey(pair.eventA.id, pair.eventB.id), pair);
  }
  return out;
}

function tryLink(
  cause: ObservationEvent,
  candidate: ObservationEvent,
  visited: ReadonlySet<string>,
  correlationByPair: ReadonlyMap<string, CorrelatedPair>,
  graph: DomainDependencyGraph,
): CausalLink | undefined {
  if (visited.has(candidate.id)) return undefined;
  if (candidate.id === cause.id) return undefined;
  if (!candidate.location || !cause.location) return undefined;
  if (candidate.timestamp <= cause.timestamp) return undefined;
  const distance = haversineKm(
    cause.location.lat, cause.location.lon,
    candidate.location.lat, candidate.location.lon,
  );
  if (distance > MAX_DISTANCE_KM) return undefined;
  const pair = correlationByPair.get(unorderedKey(cause.id, candidate.id));
  if (!pair) return undefined;
  const dep = pickDependency(graph.getDependencies(cause.domain), candidate.domain);
  if (!dep) return undefined;
  const linkConfidence = clamp01(pair.confidence * dep.strength);
  return {
    causeId: cause.id,
    effectId: candidate.id,
    mechanism: dep.description,
    confidence: Number(linkConfidence.toFixed(4)),
    delayHours: dep.avgDelayHours,
    evidenceObservationIds: [cause.id, candidate.id],
  };
}

function pickDependency(deps: readonly DomainDependency[], toDomain: string): DomainDependency | undefined {
  return deps.find((d) => d.toDomain === toDomain);
}

function computeLeaves(
  root: ObservationEvent,
  allObs: readonly ObservationEvent[],
  links: readonly CausalLink[],
): ObservationEvent[] {
  if (links.length === 0) return [root];
  const causes = new Set(links.map((l) => l.causeId));
  const effects = new Set(links.map((l) => l.effectId));
  const obsById = new Map<string, ObservationEvent>();
  for (const obs of allObs) obsById.set(obs.id, obs);
  const leaves: ObservationEvent[] = [];
  for (const effectId of effects) {
    if (causes.has(effectId)) continue;
    const obs = obsById.get(effectId);
    if (obs) leaves.push(obs);
  }
  return leaves;
}

function computeLongestPath(rootId: string, links: readonly CausalLink[]): number {
  if (links.length === 0) return 0;
  const adjacency = new Map<string, string[]>();
  for (const link of links) {
    const list = adjacency.get(link.causeId);
    if (list) list.push(link.effectId);
    else adjacency.set(link.causeId, [link.effectId]);
  }
  return dfsLongest(rootId, adjacency, new Set());
}

function dfsLongest(node: string, adjacency: ReadonlyMap<string, readonly string[]>, visiting: Set<string>): number {
  if (visiting.has(node)) return 0;
  visiting.add(node);
  let best = 0;
  for (const next of adjacency.get(node) ?? []) {
    const depth = 1 + dfsLongest(next, adjacency, visiting);
    if (depth > best) best = depth;
  }
  visiting.delete(node);
  return best;
}

function computeOverallConfidence(links: readonly CausalLink[]): number {
  if (links.length === 0) return 1;
  let product = 1;
  for (const link of links) product *= link.confidence;
  return Number(product.toFixed(4));
}

function unorderedKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function clamp01(n: number): number {
  if (Number.isNaN(n) || n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}
