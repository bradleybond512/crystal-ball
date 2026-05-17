/**
 * Domain Dependency Graph — Phase 4 cross-domain cascade risk.
 *
 * Static directed graph encoding how events in one domain propagate
 * into others (cascade / amplification / inhibition / correlation).
 * `findCascadePaths` walks the graph via BFS from a source domain and
 * enumerates all paths up to a maximum depth; `computeCascadeRisk`
 * scales the resulting propagation strengths by the source severity so
 * the panel can show "an M7 quake will likely hit infrastructure +
 * maritime + geopolitical in the next 12 h".
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists
 * the most-recent 50 computed cascade risks under `wm-domain-dependency`.
 */

// ── Public types ──────────────────────────────────────────────────────

export type DependencyType = 'cascade' | 'amplification' | 'inhibition' | 'correlation';

export interface DomainDependency {
  fromDomain: string;
  toDomain: string;
  dependencyType: DependencyType;
  /** [0, 1] base coupling strength. Multiplied by the source severity
   *  when computing live cascade risk. */
  strength: number;
  /** Approximate propagation delay from source to target, in hours. */
  avgDelayHours: number;
  /** Number of documented historical instances supporting this edge.
   *  Used only for transparency in the panel — does not affect the
   *  propagation math. */
  historicalInstances: number;
  description: string;
}

export interface DependencyPath {
  nodes: string[];
  edges: DomainDependency[];
  /** Product of edge strengths along the path. */
  totalStrength: number;
  /** Sum of edge delays along the path. */
  estimatedPropagationHours: number;
}

export interface CascadeRisk {
  sourceDomain: string;
  affectedDomains: string[];
  propagationPaths: DependencyPath[];
  totalExposedDomains: number;
  estimatedPeakHours: number;
  /** ms-epoch when this cascade risk was computed. */
  computedAt: number;
}

export type DependencyListener = (state: { risks: CascadeRisk[] }) => void;

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-domain-dependency';
const MAX_RISKS = 50;
const DEFAULT_MAX_DEPTH = 3;

/** Static built-in edge list. 26 edges across 11 domains. Edges are
 *  one-directional — bidirectional couplings appear twice with
 *  different delays + strengths to reflect asymmetric coupling. */
export const BUILT_IN_DEPENDENCIES: readonly DomainDependency[] = [
  // Earthquake — primary geophysical trigger.
  {
    fromDomain: 'earthquake', toDomain: 'tsunami',
    dependencyType: 'cascade', strength: 0.9, avgDelayHours: 0.5,
    historicalInstances: 47,
    description: 'Subduction-zone quakes ≥ M7 displace water and trigger tsunami warnings within minutes.',
  },
  {
    fromDomain: 'earthquake', toDomain: 'infrastructure',
    dependencyType: 'cascade', strength: 0.7, avgDelayHours: 2,
    historicalInstances: 120,
    description: 'Strong shaking damages power grid, water mains, and bridges; outages cascade for hours.',
  },
  {
    fromDomain: 'earthquake', toDomain: 'aviation',
    dependencyType: 'inhibition', strength: 0.5, avgDelayHours: 1,
    historicalInstances: 35,
    description: 'Runway damage + ATC outage near epicenters suspends regional aviation for ~1 day.',
  },
  {
    fromDomain: 'earthquake', toDomain: 'humanitarian',
    dependencyType: 'cascade', strength: 0.8, avgDelayHours: 6,
    historicalInstances: 80,
    description: 'Major quakes drive displacement + medical surge within hours.',
  },
  // Tsunami — secondary cascade from quake.
  {
    fromDomain: 'tsunami', toDomain: 'maritime',
    dependencyType: 'cascade', strength: 0.8, avgDelayHours: 1,
    historicalInstances: 22,
    description: 'Tsunami waves halt port operations and AIS traffic along affected coasts.',
  },
  {
    fromDomain: 'tsunami', toDomain: 'infrastructure',
    dependencyType: 'cascade', strength: 0.6, avgDelayHours: 2,
    historicalInstances: 18,
    description: 'Inundation damages coastal infrastructure: water, power, road.',
  },
  // Weather — major driver into wildfire, aviation, infrastructure.
  {
    fromDomain: 'weather', toDomain: 'wildfire',
    dependencyType: 'cascade', strength: 0.6, avgDelayHours: 6,
    historicalInstances: 95,
    description: 'High wind + low humidity following dry weather elevates wildfire ignition risk.',
  },
  {
    fromDomain: 'weather', toDomain: 'aviation',
    dependencyType: 'inhibition', strength: 0.7, avgDelayHours: 0.5,
    historicalInstances: 200,
    description: 'Severe convective weather grounds flights and forces ATC reroutes within the hour.',
  },
  {
    fromDomain: 'weather', toDomain: 'infrastructure',
    dependencyType: 'cascade', strength: 0.5, avgDelayHours: 3,
    historicalInstances: 78,
    description: 'High winds + ice take down power lines; flooding submerges substations.',
  },
  {
    fromDomain: 'weather', toDomain: 'maritime',
    dependencyType: 'inhibition', strength: 0.6, avgDelayHours: 2,
    historicalInstances: 64,
    description: 'Storm surge + heavy seas halt port ops and force shipping reroutes.',
  },
  // Wildfire — feeds air quality + infrastructure.
  {
    fromDomain: 'wildfire', toDomain: 'infrastructure',
    dependencyType: 'cascade', strength: 0.5, avgDelayHours: 4,
    historicalInstances: 42,
    description: 'Fires take down transmission lines and force preemptive grid de-energisation.',
  },
  {
    fromDomain: 'wildfire', toDomain: 'aviation',
    dependencyType: 'inhibition', strength: 0.4, avgDelayHours: 6,
    historicalInstances: 33,
    description: 'Smoke plumes reduce visibility, closing regional airports for hours.',
  },
  // Biosurveillance — disease outbreaks affect aviation + geopolitics.
  {
    fromDomain: 'biosurveillance', toDomain: 'aviation',
    dependencyType: 'inhibition', strength: 0.5, avgDelayHours: 48,
    historicalInstances: 12,
    description: 'Outbreak alerts → travel restrictions + airport screening within ~2 days.',
  },
  {
    fromDomain: 'biosurveillance', toDomain: 'humanitarian',
    dependencyType: 'cascade', strength: 0.7, avgDelayHours: 24,
    historicalInstances: 24,
    description: 'Outbreaks drive medical surge + supply-chain demand spikes within a day.',
  },
  {
    fromDomain: 'biosurveillance', toDomain: 'geopolitical',
    dependencyType: 'amplification', strength: 0.4, avgDelayHours: 72,
    historicalInstances: 8,
    description: 'Persistent outbreaks fuel border-closure rhetoric and diplomatic strain.',
  },
  // Maritime — chokepoints + AIS.
  {
    fromDomain: 'maritime', toDomain: 'geopolitical',
    dependencyType: 'amplification', strength: 0.4, avgDelayHours: 24,
    historicalInstances: 18,
    description: 'AIS gaps + chokepoint incidents raise diplomatic temperature within a day.',
  },
  {
    fromDomain: 'maritime', toDomain: 'infrastructure',
    dependencyType: 'cascade', strength: 0.3, avgDelayHours: 36,
    historicalInstances: 14,
    description: 'Port disruption cascades into supply-chain stress on regional infrastructure.',
  },
  // Geopolitical — back into maritime + cyber + space.
  {
    fromDomain: 'geopolitical', toDomain: 'maritime',
    dependencyType: 'cascade', strength: 0.6, avgDelayHours: 12,
    historicalInstances: 27,
    description: 'Sanctions + naval posture changes show up in maritime AIS within ~12 h.',
  },
  {
    fromDomain: 'geopolitical', toDomain: 'cyber',
    dependencyType: 'amplification', strength: 0.5, avgDelayHours: 24,
    historicalInstances: 31,
    description: 'Heightened state tensions correlate with cyber-attack surface expansion.',
  },
  {
    fromDomain: 'geopolitical', toDomain: 'aviation',
    dependencyType: 'inhibition', strength: 0.4, avgDelayHours: 8,
    historicalInstances: 16,
    description: 'No-fly zones + flag-state restrictions clamp regional aviation within hours.',
  },
  // Space weather — short propagation into infrastructure + aviation.
  {
    fromDomain: 'space-weather', toDomain: 'infrastructure',
    dependencyType: 'cascade', strength: 0.5, avgDelayHours: 1,
    historicalInstances: 21,
    description: 'GIC events from CMEs disturb high-voltage transformers within an hour.',
  },
  {
    fromDomain: 'space-weather', toDomain: 'aviation',
    dependencyType: 'inhibition', strength: 0.4, avgDelayHours: 0.5,
    historicalInstances: 28,
    description: 'HF radio + polar route degradation forces reroutes during X-class events.',
  },
  // Infrastructure — back into geopolitics + humanitarian.
  {
    fromDomain: 'infrastructure', toDomain: 'geopolitical',
    dependencyType: 'amplification', strength: 0.3, avgDelayHours: 96,
    historicalInstances: 10,
    description: 'Prolonged power / water outages erode institutional legitimacy.',
  },
  {
    fromDomain: 'infrastructure', toDomain: 'humanitarian',
    dependencyType: 'cascade', strength: 0.6, avgDelayHours: 12,
    historicalInstances: 38,
    description: 'Power + water loss escalates medical + shelter demand within half a day.',
  },
  // Cyber — into infrastructure + aviation.
  {
    fromDomain: 'cyber', toDomain: 'infrastructure',
    dependencyType: 'cascade', strength: 0.6, avgDelayHours: 4,
    historicalInstances: 26,
    description: 'Successful intrusions on ICS / SCADA degrade physical infrastructure within hours.',
  },
  {
    fromDomain: 'cyber', toDomain: 'aviation',
    dependencyType: 'inhibition', strength: 0.4, avgDelayHours: 6,
    historicalInstances: 11,
    description: 'Airline / ATC ransomware grounds operations for half a day or more.',
  },
];

// ── Helpers ──────────────────────────────────────────────────────────

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function pathStrength(edges: readonly DomainDependency[]): number {
  if (edges.length === 0) return 1;
  let product = 1;
  for (const e of edges) product *= e.strength;
  return product;
}

function pathDelay(edges: readonly DomainDependency[]): number {
  let total = 0;
  for (const e of edges) total += e.avgDelayHours;
  return total;
}

function dependencyIndex(deps: readonly DomainDependency[]): Map<string, DomainDependency[]> {
  const out = new Map<string, DomainDependency[]>();
  for (const d of deps) {
    const list = out.get(d.fromDomain);
    if (list) list.push(d);
    else out.set(d.fromDomain, [d]);
  }
  return out;
}

function incomingIndex(deps: readonly DomainDependency[]): Map<string, DomainDependency[]> {
  const out = new Map<string, DomainDependency[]>();
  for (const d of deps) {
    const list = out.get(d.toDomain);
    if (list) list.push(d);
    else out.set(d.toDomain, [d]);
  }
  return out;
}

// ── BFS path enumeration ─────────────────────────────────────────────

function buildPath(nodes: readonly string[], edges: readonly DomainDependency[]): DependencyPath {
  return {
    nodes: [...nodes],
    edges: [...edges],
    totalStrength: pathStrength(edges),
    estimatedPropagationHours: pathDelay(edges),
  };
}

function enumeratePaths(
  fromDomain: string,
  outgoing: Map<string, DomainDependency[]>,
  maxDepth: number,
): DependencyPath[] {
  const results: DependencyPath[] = [];
  // BFS frontier of (currentNode, pathNodes, pathEdges).
  interface Frontier {
    node: string;
    nodes: string[];
    edges: DomainDependency[];
  }
  const frontier: Frontier[] = [{ node: fromDomain, nodes: [fromDomain], edges: [] }];
  while (frontier.length > 0) {
    const current = frontier.shift()!;
    if (current.edges.length >= maxDepth) continue;
    const out = outgoing.get(current.node) ?? [];
    for (const edge of out) {
      // Skip already-visited nodes — keeps the path simple (no cycles).
      if (current.nodes.includes(edge.toDomain)) continue;
      const nextNodes = [...current.nodes, edge.toDomain];
      const nextEdges = [...current.edges, edge];
      results.push(buildPath(nextNodes, nextEdges));
      frontier.push({ node: edge.toDomain, nodes: nextNodes, edges: nextEdges });
    }
  }
  return results;
}

// ── Service ───────────────────────────────────────────────────────────

export interface DomainDependencyOptions {
  clock?: () => number;
  /** Override the built-in graph — used by tests. */
  edges?: readonly DomainDependency[];
}

export class DomainDependencyGraph {
  private readonly edges: readonly DomainDependency[];
  private readonly outgoing: Map<string, DomainDependency[]>;
  private readonly incoming: Map<string, DomainDependency[]>;
  private readonly clock: () => number;
  private risks: CascadeRisk[] = [];
  private listeners = new Set<DependencyListener>();
  private hydrated = false;

  constructor(options: DomainDependencyOptions = {}) {
    this.edges = options.edges ?? BUILT_IN_DEPENDENCIES;
    this.outgoing = dependencyIndex(this.edges);
    this.incoming = incomingIndex(this.edges);
    this.clock = options.clock ?? (() => Date.now());
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const store = safeStorage();
    if (!store) return;
    let raw: string | null = null;
    try { raw = store.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      this.risks = deserializeRisks(parsed);
    } catch {
      // Corrupt blob — start clean.
    }
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(this.risks));
    } catch {
      // Quota or disabled — best-effort.
    }
  }

  private notify(): void {
    const snapshot = { risks: this.risks.map((r) => cloneRisk(r)) };
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  /** Enumerate all reachable paths from `fromDomain` up to `maxDepth`
   *  edges. Cycles are excluded — a node appears at most once per path. */
  findCascadePaths(fromDomain: string, maxDepth: number = DEFAULT_MAX_DEPTH): DependencyPath[] {
    const depth = Math.max(0, Math.floor(maxDepth));
    if (depth === 0) return [];
    return enumeratePaths(fromDomain, this.outgoing, depth);
  }

  /** Compose a CascadeRisk by walking the graph and scaling strengths
   *  by the source severity (0..1 input — divide by 4 if caller is
   *  passing the 0..4 severity-ladder index). Stores the result in the
   *  active-risk ring buffer. */
  computeCascadeRisk(fromDomain: string, currentSeverityNum: number): CascadeRisk {
    this.ensureHydrated();
    const normalisedSeverity = Math.max(0, Math.min(1, currentSeverityNum));
    const rawPaths = this.findCascadePaths(fromDomain, DEFAULT_MAX_DEPTH);
    // Scale the totalStrength of every path by the source severity.
    const scaledPaths: DependencyPath[] = rawPaths.map((p) => ({
      ...p,
      totalStrength: +(p.totalStrength * normalisedSeverity).toFixed(4),
      estimatedPropagationHours: +p.estimatedPropagationHours.toFixed(2),
    }));
    const affected = new Set<string>();
    for (const p of scaledPaths) {
      for (const n of p.nodes) {
        if (n !== fromDomain) affected.add(n);
      }
    }
    const estimatedPeakHours = scaledPaths.length === 0
      ? 0
      : Math.max(...scaledPaths.map((p) => p.estimatedPropagationHours));
    const affectedDomains = [...affected].sort((a, b) => a.localeCompare(b));
    const risk: CascadeRisk = {
      sourceDomain: fromDomain,
      affectedDomains,
      propagationPaths: scaledPaths,
      totalExposedDomains: affectedDomains.length,
      estimatedPeakHours: +estimatedPeakHours.toFixed(2),
      computedAt: this.clock(),
    };
    // Replace-on-source semantics so repeated computation for the same
    // source updates rather than appends.
    const existing = this.risks.findIndex((r) => r.sourceDomain === fromDomain);
    if (existing !== -1) this.risks.splice(existing, 1);
    this.risks.push(risk);
    this.enforceCapacity();
    this.persist();
    this.notify();
    return cloneRisk(risk);
  }

  private enforceCapacity(): void {
    if (this.risks.length <= MAX_RISKS) return;
    this.risks.splice(0, this.risks.length - MAX_RISKS);
  }

  /** Outgoing edges from the given domain. */
  getDependencies(domain: string): DomainDependency[] {
    return (this.outgoing.get(domain) ?? []).map((d) => ({ ...d }));
  }

  /** Incoming edges into the given domain. */
  getIncomingDependencies(domain: string): DomainDependency[] {
    return (this.incoming.get(domain) ?? []).map((d) => ({ ...d }));
  }

  /** Every domain mentioned anywhere in the graph (source or target). */
  getAllDomains(): string[] {
    const set = new Set<string>();
    for (const e of this.edges) {
      set.add(e.fromDomain);
      set.add(e.toDomain);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  /** Snapshot of recorded cascade risks (newest last). */
  getActiveRisks(): CascadeRisk[] {
    this.ensureHydrated();
    return this.risks.map((r) => cloneRisk(r));
  }

  /** Most-recent cascade risk for a given source, if one is on file. */
  getRisk(sourceDomain: string): CascadeRisk | undefined {
    this.ensureHydrated();
    const found = this.risks.find((r) => r.sourceDomain === sourceDomain);
    return found ? cloneRisk(found) : undefined;
  }

  subscribe(listener: DependencyListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test seam — empties the risk store and the persisted blob. */
  resetForTesting(): void {
    this.risks = [];
    this.listeners.clear();
    this.hydrated = true;
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* best effort */ }
    }
  }
}

// ── Persistence helpers ──────────────────────────────────────────────

function cloneDependency(d: DomainDependency): DomainDependency {
  return { ...d };
}

function clonePath(p: DependencyPath): DependencyPath {
  return {
    nodes: [...p.nodes],
    edges: p.edges.map((e) => cloneDependency(e)),
    totalStrength: p.totalStrength,
    estimatedPropagationHours: p.estimatedPropagationHours,
  };
}

function cloneRisk(r: CascadeRisk): CascadeRisk {
  return {
    sourceDomain: r.sourceDomain,
    affectedDomains: [...r.affectedDomains],
    propagationPaths: r.propagationPaths.map((p) => clonePath(p)),
    totalExposedDomains: r.totalExposedDomains,
    estimatedPeakHours: r.estimatedPeakHours,
    computedAt: r.computedAt,
  };
}

function asValidRisk(entry: unknown): CascadeRisk | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as CascadeRisk;
  if (typeof e.sourceDomain !== 'string') return undefined;
  if (!Array.isArray(e.affectedDomains) || !Array.isArray(e.propagationPaths)) return undefined;
  if (typeof e.totalExposedDomains !== 'number' || typeof e.estimatedPeakHours !== 'number') return undefined;
  // Tolerate older persisted blobs without computedAt — default to 0.
  if (typeof e.computedAt !== 'number') e.computedAt = 0;
  return cloneRisk(e);
}

function deserializeRisks(raw: unknown): CascadeRisk[] {
  if (!Array.isArray(raw)) return [];
  const out: CascadeRisk[] = [];
  for (const entry of raw) {
    const valid = asValidRisk(entry);
    if (valid) out.push(valid);
  }
  return out;
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: DomainDependencyGraph | null = null;

export function getDomainDependencyGraph(): DomainDependencyGraph {
  _singleton ??= new DomainDependencyGraph();
  return _singleton;
}

/** Test seam — replaces the singleton with a fresh instance. */
export function __resetDomainDependencyGraphSingleton(): void {
  _singleton = null;
}

export const __internals = {
  STORAGE_KEY,
  MAX_RISKS,
  DEFAULT_MAX_DEPTH,
  pathStrength,
  pathDelay,
  enumeratePaths,
  dependencyIndex,
  incomingIndex,
};
