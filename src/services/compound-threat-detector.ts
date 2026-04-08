/**
 * Compound Threat Detector — Multi-domain convergence scoring
 *
 * Detects when multiple threat TYPES (cyber, military, financial, etc.) elevate
 * simultaneously across the globe, indicating a cascading or compound crisis.
 * This is complementary to compound-threat.ts, which clusters geo-proximate
 * hazards. This service operates at the strategic/domain level, not geo-grid level.
 *
 * Examples of dangerous compound-domain scenarios:
 *  - Cyber + Military elevation → possible state-sponsored hybrid operation
 *  - Financial + Social Unrest → economic-driven instability spiral
 *  - Nuclear + Military → existential escalation risk
 *  - Infrastructure + Cyber → coordinated critical-systems attack
 *
 * Algorithm:
 *  1. Callers push domain-level threat levels (0-100) as signals arrive
 *  2. detectCompoundThreats() identifies domains above threshold (>40)
 *  3. Score = weighted average of elevated domain levels
 *  4. Escalation tier = function of how many domains are elevated and how high
 *  5. History ring-buffer (288 entries = 24h at 5-min intervals) for trend charts
 *
 * Pure TypeScript, no external imports, in-memory state only.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ThreatDomain =
  | 'cyber'
  | 'military'
  | 'infrastructure'
  | 'natural_disaster'
  | 'financial'
  | 'health'
  | 'social_unrest'
  | 'nuclear'
  | 'sigint';

export interface DomainThreatLevel {
  domain: ThreatDomain;
  /** 0–100 threat level for this domain */
  level: number;
  /** Number of active indicators contributing to this level */
  activeIndicators: number;
  lastUpdated: number;
  /** Short labels for the most significant active events */
  keyEvents: string[];
}

export interface CompoundThreatAlert {
  id: string;
  domains: ThreatDomain[];
  /** Weighted compound score 0–100 */
  overallScore: number;
  escalationRisk: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  affectedRegions: string[];
  detectedAt: number;
  recommendations: string[];
}

export interface CompoundHistoryEntry {
  timestamp: number;
  score: number;
  activeDomains: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum level for a domain to be considered "elevated" */
const ELEVATION_THRESHOLD = 40;

/** Maximum alert history entries (288 = 24h at 5-min intervals) */
const MAX_HISTORY = 288;

/**
 * Relative weights for each domain when computing compound scores.
 * Nuclear and military carry higher multipliers due to irreversibility.
 */
const DOMAIN_WEIGHTS: Record<ThreatDomain, number> = {
  nuclear: 2.0,
  military: 1.8,
  cyber: 1.5,
  infrastructure: 1.4,
  sigint: 1.3,
  financial: 1.2,
  health: 1.1,
  social_unrest: 1.0,
  natural_disaster: 0.9,
};

/**
 * Known dangerous domain pairings with recommended response text.
 * Checked in order; first match wins for the recommendation.
 */
const COMPOUND_PLAYBOOKS: {
  domains: ThreatDomain[];
  title: string;
  description: string;
  recommendations: string[];
}[] = [
  {
 domains: ['cyber', 'military'],
 title: 'Hybrid Warfare Detected',
 description: 'Simultaneous cyber and military escalation — possible state-sponsored hybrid operation.',
 recommendations: [
 'Possible state-sponsored operation detected — monitor attribution indicators.',
 'Review critical infrastructure exposure to offensive cyber tooling.',
 'Assess military posture for signs of coordinated kinetic-cyber timing.',
 ],
  },
  {
 domains: ['nuclear', 'military'],
 title: 'Nuclear-Military Escalation',
 description: 'Military escalation coinciding with nuclear domain activity — existential risk tier.',
 recommendations: [
 'Escalation to nuclear posture change possible — monitor command-and-control signals.',
 'Track deployment of dual-capable delivery systems.',
 'Review DEFCON/LERTCON equivalents for involved states.',
 ],
  },
  {
 domains: ['infrastructure', 'cyber'],
 title: 'Critical Infrastructure Under Attack',
 description: 'Cyber indicators converging with infrastructure stress — coordinated attack possible.',
 recommendations: [
 'Isolate SCADA/ICS networks from internet-facing systems immediately.',
 'Initiate OT/IT network monitoring for lateral movement.',
 'Verify backup power and manual override readiness at key facilities.',
 ],
  },
  {
 domains: ['financial', 'social_unrest'],
 title: 'Economic-Stability Crisis',
 description: 'Financial stress driving or correlating with social unrest — instability spiral risk.',
 recommendations: [
 'Monitor currency and sovereign debt markets for contagion.',
 'Assess protest locations against critical supply-chain nodes.',
 'Prepare for potential capital controls or exchange closures.',
 ],
  },
  {
 domains: ['sigint', 'military'],
 title: 'Electronic Warfare Convergence',
 description: 'SIGINT anomalies co-occurring with military elevation — electronic warfare posture likely.',
 recommendations: [
 'GPS interference may indicate pre-strike suppression activity.',
 'Cross-reference BGP/cable anomalies for communications blackout preparation.',
 'Assess civilian aviation exposure to GPS spoofing zones.',
 ],
  },
  {
 domains: ['health', 'social_unrest'],
 title: 'Health-Social Compound Crisis',
 description: 'Active health emergency coinciding with civil unrest — healthcare system stress compounding.',
 recommendations: [
 'Monitor hospital capacity and supply-chain integrity in affected regions.',
 'Assess protest impact on emergency service access.',
 'Track government response legitimacy — trust erosion accelerates both crises.',
 ],
  },
  {
 domains: ['natural_disaster', 'infrastructure'],
 title: 'Cascading Infrastructure Failure',
 description: 'Natural disaster stressing infrastructure — cascading failure risk elevated.',
 recommendations: [
 'Assess grid, water, and transport network resilience in disaster zone.',
 'Pre-position emergency repair assets ahead of infrastructure failure.',
 'Identify population centers dependent on at-risk single-point infrastructure.',
 ],
  },
  {
 domains: ['financial', 'health'],
 title: 'Pandemic-Market Correlation',
 description: 'Health emergency concurrent with financial stress — pandemic-triggered economic shock possible.',
 recommendations: [
 'Model supply-chain disruption from health-driven workforce reduction.',
 'Monitor insurance and pharmaceutical sector volatility.',
 'Track fiscal stimulus announcements for market stabilization signals.',
 ],
  },
];

// ── Module state ──────────────────────────────────────────────────────────────

const domainLevels = new Map<ThreatDomain, DomainThreatLevel>();
let cachedAlerts: CompoundThreatAlert[] = [];
const compoundHistory: CompoundHistoryEntry[] = [];
let alertIdCounter = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function escalationRisk(
  elevatedDomains: DomainThreatLevel[],
): CompoundThreatAlert['escalationRisk'] {
  const count = elevatedDomains.length;
  const hasCriticalPair = elevatedDomains.some(a =>
 elevatedDomains.some(b => a !== b && a.level > 70 && b.level > 70),
  );
  if (hasCriticalPair) return 'critical';
  if (count >= 3) return 'high';
  if (count === 2) return 'medium';
  return 'low';
}

function findPlaybook(domains: ThreatDomain[]): (typeof COMPOUND_PLAYBOOKS)[number] | null {
  const domSet = new Set(domains);
  for (const pb of COMPOUND_PLAYBOOKS) {
 if (pb.domains.every(d => domSet.has(d))) return pb;
  }
  return null;
}

function buildDefaultRecommendations(domains: ThreatDomain[]): string[] {
  const recs: string[] = [
 `Elevated threat across ${domains.length} domains — increase monitoring cadence.`,
 'Cross-reference domain-specific data sources for corroborating signals.',
 'Brief decision-makers on compound threat convergence and escalation trajectory.',
  ];
  return recs;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Update the threat level for a single domain.
 * Call this whenever a domain-owning panel receives fresh data.
 *
 * @param domain - Which threat domain is being updated
 * @param level - Current threat level 0–100
 * @param activeIndicators - Count of active signals driving this level
 * @param keyEvents - Optional short labels for the top active events
 */
export function updateDomainLevel(
  domain: ThreatDomain,
  level: number,
  activeIndicators: number,
  keyEvents: string[] = [],
): void {
  domainLevels.set(domain, {
 domain,
 level: clamp(Math.round(level), 0, 100),
 activeIndicators: Math.max(0, activeIndicators),
 lastUpdated: Date.now(),
 keyEvents: keyEvents.slice(0, 5),
  });
}

/**
 * Analyse all known domain levels and produce compound threat alerts.
 * A compound alert is raised whenever 2+ domains exceed the elevation threshold.
 * Automatically records a history entry after each call.
 *
 * @returns Array of CompoundThreatAlert sorted by overallScore descending
 */
export function detectCompoundThreats(): CompoundThreatAlert[] {
  const allDomains = [...domainLevels.values()];
  const elevated = allDomains.filter(d => d.level > ELEVATION_THRESHOLD);

  const alerts: CompoundThreatAlert[] = [];

  if (elevated.length >= 2) {
 const domainNames = elevated.map(d => d.domain);
 const risk = escalationRisk(elevated);

 // Weighted compound score
 const totalWeight = elevated.reduce((s, d) => s + DOMAIN_WEIGHTS[d.domain], 0);
 const weightedSum = elevated.reduce(
 (s, d) => s + d.level * DOMAIN_WEIGHTS[d.domain],
 0,
 );
 const overallScore = clamp(Math.round(weightedSum / totalWeight), 0, 100);

 // Find best-matching playbook
 const playbook = findPlaybook(domainNames);
 const title = playbook?.title ?? `Compound Threat: ${elevated.length} Domains Elevated`;
 const description =
 playbook?.description ??
 `${elevated.length} threat domains simultaneously above threshold: ${domainNames.join(', ')}.`;
 const recommendations = playbook?.recommendations ?? buildDefaultRecommendations(domainNames);

 alerts.push({
 id: `compound-${++alertIdCounter}-${Date.now()}`,
 domains: domainNames,
 overallScore,
 escalationRisk: risk,
 title,
 description,
 affectedRegions: [],
 detectedAt: Date.now(),
 recommendations,
 });
  }

  // Sort highest score first
  alerts.sort((a, b) => b.overallScore - a.overallScore);
  cachedAlerts = alerts;

  // Record history
  const activeDomains = elevated.length;
  const score = alerts.length > 0 ? alerts[0]!.overallScore : getCompoundScore();
  compoundHistory.push({ timestamp: Date.now(), score, activeDomains });
  if (compoundHistory.length > MAX_HISTORY) {
 compoundHistory.splice(0, compoundHistory.length - MAX_HISTORY);
  }

  return alerts;
}

/** Returns compound threat alerts from the last detectCompoundThreats() call. */
export function getCompoundAlerts(): CompoundThreatAlert[] {
  return [...cachedAlerts];
}

/** Returns current threat level records for all known domains. */
export function getDomainLevels(): DomainThreatLevel[] {
  return [...domainLevels.values()];
}

/** Returns the current threat level record for a single domain, or undefined. */
export function getDomainLevel(domain: ThreatDomain): DomainThreatLevel | undefined {
  return domainLevels.get(domain);
}

/**
 * Overall compound score: average of the top-3 domain levels (0–100).
 * Returns 0 when no domain data is present.
 */
export function getCompoundScore(): number {
  const levels = [...domainLevels.values()]
 .map(d => d.level)
 .sort((a, b) => b - a)
 .slice(0, 3);
  if (levels.length === 0) return 0;
  return clamp(Math.round(levels.reduce((s, v) => s + v, 0) / levels.length), 0, 100);
}

/**
 * Returns the last 24 history entries (or fewer if not yet accumulated).
 * Each entry records timestamp, compound score, and active-domain count.
 */
export function getCompoundHistory(): CompoundHistoryEntry[] {
  return compoundHistory.slice(-24);
}
