/**
 * MITRE ATT&CK Kill Chain Tracker — pure TypeScript, fully offline
 *
 * Tracks observed attack phases across the full MITRE ATT&CK enterprise
 * kill chain (14 tactics). Events from the same source within a 6-hour
 * window are grouped into a single AttackChain. Chains older than 72 hours
 * are automatically pruned on each ingestion.
 *
 * Integration: call ingestAttackPhase() whenever a threat intelligence feed
 * (ThreatFox, CISA KEV, cyber-extra, etc.) reports a technique observation.
 * Use getActiveChains() and getPhaseDistribution() to drive panel rendering.
 *
 * No external dependencies, no network calls.
 */

// ── Types ──────────────────────────────────────────────────────────────────

/** All 14 MITRE ATT&CK enterprise tactic phases, in kill-chain order. */
export type KillChainPhase =
  | 'Reconnaissance'
  | 'Resource Development'
  | 'Initial Access'
  | 'Execution'
  | 'Persistence'
  | 'Privilege Escalation'
  | 'Defense Evasion'
  | 'Credential Access'
  | 'Discovery'
  | 'Lateral Movement'
  | 'Collection'
  | 'C2'
  | 'Exfiltration'
  | 'Impact';

/** Ordered list of all phases — used for completeness calculation. */
const ALL_PHASES: KillChainPhase[] = [
  'Reconnaissance',
  'Resource Development',
  'Initial Access',
  'Execution',
  'Persistence',
  'Privilege Escalation',
  'Defense Evasion',
  'Credential Access',
  'Discovery',
  'Lateral Movement',
  'Collection',
  'C2',
  'Exfiltration',
  'Impact',
];

/** A single observed technique mapped to a kill-chain phase. */
export interface AttackChainEntry {
  /** Unique entry identifier (UUID-style, generated on ingest). */
  id: string;
  /** Origin source (e.g. feed name, sensor, analyst handle). */
  source: string;
  /** ATT&CK tactic phase this technique belongs to. */
  phase: KillChainPhase;
  /** Technique name or ATT&CK ID (e.g. "T1059 - Command Scripting"). */
  technique: string;
  /** Human-readable description of the observed behaviour. */
  description: string;
  /** Unix timestamp (ms) when the observation was recorded. */
  timestamp: number;
  /** Analyst or automated confidence score (0–100). */
  confidence: number;
  /** Associated IOC strings (IPs, hashes, domains, etc.). */
  relatedIocs: string[];
}

/**
 * A grouped attack chain: all entries observed from the same source
 * within a 6-hour window form one chain.
 */
export interface AttackChain {
  /** Unique chain identifier. */
  id: string;
  /** Human-readable name derived from source + first phase seen. */
  name: string;
  /** Attributed adversary / threat actor, if known. */
  adversary: string | null;
  /** Timestamp of the earliest entry in this chain. */
  firstSeen: number;
  /** Timestamp of the most recent entry in this chain. */
  lastSeen: number;
  /** All observed entries belonging to this chain. */
  entries: AttackChainEntry[];
  /**
 * Percentage of the 14 ATT&CK phases covered by at least one entry
 * in this chain (0–100, rounded to nearest integer).
 */
  completeness: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Events from the same source within this window are grouped together (ms). */
const GROUP_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Chains whose lastSeen is older than this are pruned on ingestion (ms). */
const PRUNE_AFTER_MS = 72 * 60 * 60 * 1000; // 72 hours

/** Chains with lastSeen within this window are considered "active" (ms). */
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── In-memory state ────────────────────────────────────────────────────────

/** All known attack chains, keyed by chain ID. */
const chains = new Map<string, AttackChain>();

/** Monotonically incrementing counter for simple unique IDs. */
let idCounter = 0;

// ── Helpers ────────────────────────────────────────────────────────────────

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

/** Recompute completeness for a chain based on its current entries. */
function computeCompleteness(entries: AttackChainEntry[]): number {
  const observedPhases = new Set(entries.map((e) => e.phase));
  return Math.round((observedPhases.size / ALL_PHASES.length) * 100);
}

/** Remove chains whose lastSeen is older than PRUNE_AFTER_MS. */
function pruneOldChains(): void {
  const cutoff = Date.now() - PRUNE_AFTER_MS;
  for (const [id, chain] of chains.entries()) {
 if (chain.lastSeen < cutoff) {
 chains.delete(id);
 }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Ingest a new attack-phase observation.
 *
 * Attempts to append the observation to the most recent open chain from the
 * same source (if its lastSeen is within GROUP_WINDOW_MS). Otherwise creates
 * a new chain. Returns the updated or newly created AttackChain.
 *
 * @param source - Origin feed or sensor name.
 * @param phase - ATT&CK tactic phase being observed.
 * @param technique  - Technique name or ATT&CK ID.
 * @param description - Free-text description of the observation.
 * @param confidence - Score 0–100; values are clamped to this range.
 * @param relatedIocs - Optional list of associated IOC strings.
 */
export function ingestAttackPhase(
  source: string,
  phase: KillChainPhase,
  technique: string,
  description: string,
  confidence: number,
  relatedIocs: string[] = [],
): AttackChain {
  pruneOldChains();

  const now = Date.now();
  const clampedConfidence = Math.min(100, Math.max(0, Math.round(confidence)));

  const entry: AttackChainEntry = {
 id: nextId('entry'),
 source,
 phase,
 technique,
 description,
 timestamp: now,
 confidence: clampedConfidence,
 relatedIocs: [...relatedIocs],
  };

  // Find most recent open chain from the same source
  let targetChain: AttackChain | undefined;
  let latestSeen = 0;
  for (const chain of chains.values()) {
 if (
 chain.entries.length > 0 &&
 chain.entries[0]!.source === source &&
 chain.lastSeen >= now - GROUP_WINDOW_MS &&
 chain.lastSeen > latestSeen
 ) {
 targetChain = chain;
 latestSeen = chain.lastSeen;
 }
  }

  if (targetChain) {
 // Append to existing chain
 targetChain.entries.push(entry);
 targetChain.lastSeen = now;
 targetChain.completeness = computeCompleteness(targetChain.entries);
 return targetChain;
  }

  // Create a new chain
  const newChain: AttackChain = {
 id: nextId('chain'),
 name: `${source} — ${phase}`,
 adversary: null,
 firstSeen: now,
 lastSeen: now,
 entries: [entry],
 completeness: computeCompleteness([entry]),
  };
  chains.set(newChain.id, newChain);
  return newChain;
}

/**
 * Return all attack chains whose lastSeen timestamp falls within the
 * last 24 hours, sorted by lastSeen descending (most recent first).
 */
export function getActiveChains(): AttackChain[] {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  return Array.from(chains.values())
 .filter((c) => c.lastSeen >= cutoff)
 .sort((a, b) => b.lastSeen - a.lastSeen);
}

/**
 * Return the completeness percentage (0–100) of a specific chain by ID.
 * Returns -1 if the chain is not found.
 */
export function getChainCompleteness(chainId: string): number {
  return chains.get(chainId)?.completeness ?? -1;
}

/**
 * Return a Map counting the total number of AttackChainEntry records
 * observed per KillChainPhase across all known (non-pruned) chains.
 */
export function getPhaseDistribution(): Map<KillChainPhase, number> {
  const dist = new Map<KillChainPhase, number>(
 ALL_PHASES.map((p) => [p, 0]),
  );
  for (const chain of chains.values()) {
 for (const entry of chain.entries) {
 dist.set(entry.phase, (dist.get(entry.phase) ?? 0) + 1);
 }
  }
  return dist;
}

/**
 * Clear all in-memory chain state. Useful for testing or session reset.
 */
export function resetChains(): void {
  chains.clear();
  idCounter = 0;
}
