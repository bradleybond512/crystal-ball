/**
 * Cascade Simulator Service — pure TypeScript, fully offline
 *
 * Models "what if X goes down" failure scenarios across a user-managed
 * infrastructure node graph. Complements infrastructure-cascade.ts (which
 * builds a live dependency graph from cables/pipelines/ports/chokepoints)
 * by offering a lightweight, BFS-based what-if simulator over a simpler
 * node registry that callers can extend with arbitrary global infrastructure.
 *
 * Pre-registered default nodes cover major global systems: US/EU power grids,
 * transatlantic and Pacific submarine cables, Suez / Panama / Hormuz chokepoints,
 * SWIFT, GPS, and key internet exchange points.
 *
 * No external imports, no network calls.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type CascadeNodeType =
  | 'power_grid'
  | 'internet'
  | 'submarine_cable'
  | 'water'
  | 'telecom'
  | 'transport'
  | 'fuel'
  | 'financial_system';

export interface CascadeNode {
  /** Unique stable identifier */
  id: string;
  /** Human-readable display name */
  name: string;
  type: CascadeNodeType;
  /** Geographic or political region (e.g. "North America", "Europe") */
  region: string;
  /**
 * How critical is this node to global/regional stability? 0 = trivial, 100 = essential.
 * Drives failure delay and recovery time estimates in simulation output.
 */
  criticality: number;
  /**
 * IDs of other CascadeNodes that depend on this one.
 * When this node fails, its dependents may cascade.
 */
  dependencies: string[];
  status: 'operational' | 'degraded' | 'failed';
}

export interface CascadeEffect {
  nodeId: string;
  nodeName: string;
  nodeType: CascadeNodeType;
  /** Estimated minutes before this node feels the failure */
  failureDelay: number;
  /** 0–100 probability that this node actually fails */
  probability: number;
  impact: 'minor' | 'moderate' | 'severe' | 'catastrophic';
  description: string;
}

export interface CascadeSimResult {
  triggerId: string;
  triggerName: string;
  effects: CascadeEffect[];
  totalAffected: number;
  maxCascadeDepth: number;
  /** Rough estimate of full-system recovery */
  estimatedRecoveryHours: number;
  /** 0–100 composite risk score */
  riskScore: number;
}

// ── State ──────────────────────────────────────────────────────────────────

/** Registry of all known infrastructure nodes */
const nodeRegistry = new Map<string, CascadeNode>();

/** Last simulation result */
let lastSimulation: CascadeSimResult | null = null;

// ── Node management ────────────────────────────────────────────────────────

/**
 * Register (or overwrite) an infrastructure node.
 * Calling with the same id replaces the existing entry.
 */
export function registerInfraNode(
  id: string,
  name: string,
  type: CascadeNodeType,
  region: string,
  criticality: number,
  dependencies: string[] = [],
): void {
  nodeRegistry.set(id, {
 id,
 name,
 type,
 region,
 criticality: Math.max(0, Math.min(100, criticality)),
 dependencies,
 status: 'operational',
  });
}

/**
 * Remove an infrastructure node by id.
 * Also scrubs the id from any other node's dependency list.
 */
export function removeInfraNode(id: string): void {
  nodeRegistry.delete(id);
  for (const node of nodeRegistry.values()) {
 node.dependencies = node.dependencies.filter(d => d !== id);
  }
}

/** Return all registered nodes as an array. */
export function getInfraNodes(): CascadeNode[] {
  return [...nodeRegistry.values()];
}

// ── Simulation logic ───────────────────────────────────────────────────────

/**
 * Build a reverse dependency map: for each node id, which nodes depend on it?
 * (i.e. if X fails, which nodes list X in their dependencies?)
 */
function buildDependentMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const node of nodeRegistry.values()) {
 for (const depId of node.dependencies) {
 if (!map.has(depId)) map.set(depId, []);
 map.get(depId)!.push(node.id);
 }
  }
  return map;
}

function impactLevel(probability: number): CascadeEffect['impact'] {
  if (probability >= 80) return 'catastrophic';
  if (probability >= 55) return 'severe';
  if (probability >= 30) return 'moderate';
  return 'minor';
}

function effectDescription(node: CascadeNode, depth: number, probability: number): string {
  const depthAdj = depth === 1 ? 'direct' : `depth-${depth}`;
  const impactAdj = probability >= 80 ? 'near-certain' : probability >= 55 ? 'likely' : probability >= 30 ? 'possible' : 'low-probability';
  const typeLabel: Record<CascadeNodeType, string> = {
 power_grid: 'power distribution',
 internet: 'internet connectivity',
 submarine_cable: 'submarine cable bandwidth',
 water: 'water supply infrastructure',
 telecom: 'telecommunications',
 transport: 'transport logistics',
 fuel: 'fuel supply chains',
 financial_system: 'financial system operations',
  };
  return `${impactAdj} ${depthAdj} failure of ${typeLabel[node.type]} in ${node.region}`;
}

/**
 * Simulate a cascade failure starting from nodeId.
 * Uses BFS over the dependent graph (nodes that rely on the trigger).
 * Probability decays with depth and is boosted by node criticality.
 */
export function simulateCascade(nodeId: string): CascadeSimResult {
  const trigger = nodeRegistry.get(nodeId);
  if (!trigger) {
 throw new Error(`cascade-simulator: unknown node "${nodeId}"`);
  }

  const dependentMap = buildDependentMap();
  const effects: CascadeEffect[] = [];
  const visited = new Set<string>([nodeId]);

  // BFS queue: { nodeId, depth, probability, accumulatedDelay }
  const queue: Array<{ id: string; depth: number; prob: number; delay: number }> = [];

  // Seed: direct dependents of the trigger
  for (const depId of dependentMap.get(nodeId) ?? []) {
 if (!visited.has(depId)) {
 queue.push({ id: depId, depth: 1, prob: 85, delay: 15 });
 visited.add(depId);
 }
  }

  let maxDepth = 0;

  while (queue.length > 0) {
 const { id, depth, prob, delay } = queue.shift()!;
 if (depth > 5) continue; // cap BFS at depth 5

 const node = nodeRegistry.get(id);
 if (!node) continue;

 // Criticality amplifies the probability (high-criticality nodes more susceptible)
 const critBonus = (node.criticality - 50) * 0.1; // ±5 at extremes
 const adjustedProb = Math.min(99, Math.max(5, prob + critBonus));

 effects.push({
 nodeId: id,
 nodeName: node.name,
 nodeType: node.type,
 failureDelay: delay,
 probability: Math.round(adjustedProb),
 impact: impactLevel(adjustedProb),
 description: effectDescription(node, depth, adjustedProb),
 });

 if (depth > maxDepth) maxDepth = depth;

 // Propagate to next layer with attenuated probability and longer delay
 for (const nextId of dependentMap.get(id) ?? []) {
 if (!visited.has(nextId)) {
 visited.add(nextId);
 queue.push({
 id: nextId,
 depth: depth + 1,
 // Probability decays: each hop loses ~25 percentage points
 prob: adjustedProb * 0.70,
 delay: delay + 30 * depth,
 });
 }
 }
  }

  // Sort effects: catastrophic first, then by failureDelay
  effects.sort((a, b) => {
 const order = { catastrophic: 0, severe: 1, moderate: 2, minor: 3 };
 return (order[a.impact] - order[b.impact]) || (a.failureDelay - b.failureDelay);
  });

  // Risk score: weighted by criticality of trigger and breadth of cascade
  const triggerWeight = trigger.criticality / 100;
  const breadthWeight = Math.min(1, effects.length / 20);
  const catastrophicCount = effects.filter(e => e.impact === 'catastrophic').length;
  const severeCount = effects.filter(e => e.impact === 'severe').length;
  const riskScore = Math.round(
 (triggerWeight * 40)
 + (breadthWeight * 30)
 + (catastrophicCount * 5)
 + (severeCount * 2),
  );

  // Recovery time: based on trigger criticality and cascade depth
  const estimatedRecoveryHours = Math.round(
 (trigger.criticality / 10) * (1 + maxDepth * 0.5),
  );

  const result: CascadeSimResult = {
 triggerId: nodeId,
 triggerName: trigger.name,
 effects,
 totalAffected: effects.length,
 maxCascadeDepth: maxDepth,
 estimatedRecoveryHours,
 riskScore: Math.min(100, riskScore),
  };

  lastSimulation = result;
  return result;
}

/** Return the result of the most recent simulateCascade() call, or null. */
export function getLastSimulation(): CascadeSimResult | null {
  return lastSimulation;
}

// ── Prebuilt scenarios ─────────────────────────────────────────────────────

export interface PrebuiltScenario {
  id: string;
  name: string;
  description: string;
  triggerNodeId: string;
}

const PREBUILT_SCENARIOS: PrebuiltScenario[] = [
  {
 id: 'suez_blockage',
 name: 'Suez Canal Blockage',
 description: 'A major vessel runs aground blocking the Suez Canal, halting ~12% of world trade.',
 triggerNodeId: 'transport_suez_canal',
  },
  {
 id: 'transatlantic_cable_cut',
 name: 'Transatlantic Cable Cut',
 description: 'Simultaneous severing of the primary transatlantic submarine cable clusters disrupts US-EU internet traffic.',
 triggerNodeId: 'cable_transatlantic',
  },
  {
 id: 'eu_power_grid_failure',
 name: 'EU Power Grid Failure',
 description: 'A cascading overload in the continental European high-voltage transmission network triggers regional blackouts.',
 triggerNodeId: 'power_eu',
  },
  {
 id: 'swift_outage',
 name: 'SWIFT Network Outage',
 description: 'A cyberattack or technical failure takes down SWIFT interbank messaging, freezing international transfers.',
 triggerNodeId: 'finance_swift',
  },
  {
 id: 'hormuz_closure',
 name: 'Strait of Hormuz Closure',
 description: 'Military conflict closes the Strait of Hormuz, cutting ~20% of global oil supply.',
 triggerNodeId: 'transport_hormuz',
  },
  {
 id: 'gps_constellation_disruption',
 name: 'GPS Constellation Disruption',
 description: 'A coordinated jamming/spoofing campaign or solar storm degrades GPS accuracy globally.',
 triggerNodeId: 'telecom_gps',
  },
];

/** Return all prebuilt scenarios. */
export function getPrebuiltScenarios(): PrebuiltScenario[] {
  return [...PREBUILT_SCENARIOS];
}

/**
 * Run a prebuilt scenario by id.
 * Throws if the scenario id is unknown or the trigger node has not been registered.
 */
export function runScenario(scenarioId: string): CascadeSimResult {
  const scenario = PREBUILT_SCENARIOS.find(s => s.id === scenarioId);
  if (!scenario) throw new Error(`cascade-simulator: unknown scenario "${scenarioId}"`);
  return simulateCascade(scenario.triggerNodeId);
}

// ── Default node registration ──────────────────────────────────────────────

/**
 * Pre-populate the registry with ~15 default global infrastructure nodes
 * and realistic dependency chains. Called immediately on module load.
 */
function registerDefaultNodes(): void {
  // ── Power grids ────────────────────────────────────────────────────────
  registerInfraNode('power_us', 'US Power Grid (Eastern Interconnect)', 'power_grid', 'North America', 90, []);
  registerInfraNode('power_eu', 'EU Continental Power Grid', 'power_grid', 'Europe', 88, []);
  registerInfraNode('power_apac', 'East Asia Power Grid (China/Korea/Japan)', 'power_grid', 'Asia-Pacific', 82, []);

  // ── Internet & cables ──────────────────────────────────────────────────
  registerInfraNode('cable_transatlantic', 'Transatlantic Submarine Cable Cluster', 'submarine_cable', 'Atlantic', 85, []);
  registerInfraNode('cable_pacific', 'Trans-Pacific Submarine Cable Cluster', 'submarine_cable', 'Pacific', 83, []);
  registerInfraNode('internet_us_backbone', 'US Internet Backbone (Tier-1 IXPs)', 'internet', 'North America', 88, ['power_us', 'cable_transatlantic']);
  registerInfraNode('internet_eu_backbone', 'EU Internet Backbone (DE-CIX / AMS-IX)', 'internet', 'Europe', 85, ['power_eu', 'cable_transatlantic']);
  registerInfraNode('internet_apac_backbone', 'APAC Internet Backbone', 'internet', 'Asia-Pacific', 80, ['power_apac', 'cable_pacific']);

  // ── Transport chokepoints ──────────────────────────────────────────────
  registerInfraNode('transport_suez_canal', 'Suez Canal', 'transport', 'Middle East / North Africa', 92, []);
  registerInfraNode('transport_panama_canal', 'Panama Canal', 'transport', 'Central America', 85, []);
  registerInfraNode('transport_hormuz', 'Strait of Hormuz', 'transport', 'Middle East', 94, []);

  // ── Fuel supply ────────────────────────────────────────────────────────
  registerInfraNode('fuel_gulf_production', 'Persian Gulf Oil Production Complex', 'fuel', 'Middle East', 90, ['transport_hormuz']);
  registerInfraNode('fuel_us_strategic_reserve', 'US Strategic Petroleum Reserve', 'fuel', 'North America', 72, ['power_us']);

  // ── Financial system ───────────────────────────────────────────────────
  registerInfraNode('finance_swift', 'SWIFT Interbank Messaging Network', 'financial_system', 'Global', 93, ['internet_us_backbone', 'internet_eu_backbone']);
  registerInfraNode('finance_fedwire', 'Fedwire / CHIPS (US Settlement)', 'financial_system', 'North America', 88, ['power_us', 'internet_us_backbone']);

  // ── Telecom ────────────────────────────────────────────────────────────
  registerInfraNode('telecom_gps', 'GPS Constellation', 'telecom', 'Global (Orbital)', 91, []);
  registerInfraNode('telecom_global_dns', 'Global DNS Root Infrastructure', 'telecom', 'Global', 87, ['internet_us_backbone', 'internet_eu_backbone']);
}

registerDefaultNodes();
