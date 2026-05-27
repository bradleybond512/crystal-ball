/**
 * Critical Infrastructure Attack Helpers — pure logic, no DOM, no fetch.
 *
 * Covers confirmed physical/cyber attacks on power grids, water systems,
 * communications, and transport infrastructure.
 */

export type InfrastructureSector = 'power_grid' | 'water_system' | 'communications' | 'transport';
export type AttackVector = 'physical' | 'cyber' | 'combined';
export type AttackSeverity = 'critical' | 'high' | 'medium' | 'low';
export type RecoveryStatus = 'contained' | 'recovering' | 'ongoing' | 'unknown';
export type AttributionConfidence = 'confirmed' | 'high' | 'medium' | 'low' | 'unknown';

export interface InfraAttackEvent {
  id: string;
  sector: InfrastructureSector;
  vector: AttackVector;
  severity: AttackSeverity;
  recoveryStatus: RecoveryStatus;
  attribution: string | null;
  attributionConfidence: AttributionConfidence;
  location: string;
  affectedPopulation?: number;
  timestamp: number; // epoch ms
  description: string;
  sourceUrls: string[];
}

export interface InfraAttackSummary {
  totalAttacks: number;
  criticalCount: number;
  ongoingCount: number;
  bySector: Record<InfrastructureSector, number>;
  byVector: Record<AttackVector, number>;
  topThreats: InfraAttackEvent[];
  riskScore: number; // 0–100
  riskLabel: 'Severe' | 'High' | 'Elevated' | 'Guarded' | 'Low';
}

const SEVERITY_ORDER: Record<AttackSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Returns the base weight for a severity tier. */
export function getSeverityWeight(severity: AttackSeverity): number {
  const weights: Record<AttackSeverity, number> = {
    critical: 40,
    high: 25,
    medium: 10,
    low: 5,
  };
  return weights[severity];
}

/** Returns the multiplier for an attack vector. */
export function getVectorMultiplier(vector: AttackVector): number {
  const multipliers: Record<AttackVector, number> = {
    combined: 1.5,
    cyber: 1.2,
    physical: 1.0,
  };
  return multipliers[vector];
}

/** Returns true when the attack is still ongoing. */
export function isOngoingAttack(event: InfraAttackEvent): boolean {
  return event.recoveryStatus === 'ongoing';
}

/** Computes a recency decay multiplier for a single event. */
function recencyMultiplier(timestamp: number): number {
  const ageMs = Date.now() - timestamp;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1_000;
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1_000;
  if (ageMs > thirtyDaysMs) return 0.1;
  if (ageMs > sevenDaysMs) return 0.5;
  return 1.0;
}

/** Computes the event's weighted contribution to the risk score. */
function eventContribution(event: InfraAttackEvent): number {
  return (
    getSeverityWeight(event.severity) *
    getVectorMultiplier(event.vector) *
    recencyMultiplier(event.timestamp)
  );
}

/**
 * Computes an aggregate risk score (0–100) from an array of attack events.
 * Weights: critical=40, high=25, medium=10, low=5.
 * Vector multipliers: combined=1.5, cyber=1.2, physical=1.0.
 * Recency decay: >7 days → 0.5, >30 days → 0.1.
 */
export function computeAttackRiskScore(events: InfraAttackEvent[]): number {
  if (events.length === 0) return 0;
  const raw = events.reduce((sum, ev) => sum + eventContribution(ev), 0);
  return Math.min(100, raw);
}

/** Maps a numeric risk score to a human-readable label. */
export function classifyRiskLabel(score: number): InfraAttackSummary['riskLabel'] {
  if (score >= 80) return 'Severe';
  if (score >= 60) return 'High';
  if (score >= 40) return 'Elevated';
  if (score >= 20) return 'Guarded';
  return 'Low';
}

/** Groups events by infrastructure sector. */
export function groupBySector(
  events: InfraAttackEvent[],
): Map<InfrastructureSector, InfraAttackEvent[]> {
  const map = new Map<InfrastructureSector, InfraAttackEvent[]>();
  for (const ev of events) {
    const bucket = map.get(ev.sector) ?? [];
    bucket.push(ev);
    map.set(ev.sector, bucket);
  }
  return map;
}

/** Returns the top N threats sorted by severity then timestamp (newest first). */
export function getTopThreats(events: InfraAttackEvent[], limit: number): InfraAttackEvent[] {
  return sortAttacksBySeverity(events).slice(0, limit);
}

/** Builds the full summary for a set of attack events. */
export function buildAttackSummary(events: InfraAttackEvent[]): InfraAttackSummary {
  const bySector: Record<InfrastructureSector, number> = {
    power_grid: 0,
    water_system: 0,
    communications: 0,
    transport: 0,
  };
  const byVector: Record<AttackVector, number> = {
    physical: 0,
    cyber: 0,
    combined: 0,
  };

  let criticalCount = 0;
  let ongoingCount = 0;

  for (const ev of events) {
    bySector[ev.sector] += 1;
    byVector[ev.vector] += 1;
    if (ev.severity === 'critical') criticalCount += 1;
    if (isOngoingAttack(ev)) ongoingCount += 1;
  }

  const riskScore = computeAttackRiskScore(events);

  return {
    totalAttacks: events.length,
    criticalCount,
    ongoingCount,
    bySector,
    byVector,
    topThreats: getTopThreats(events, 5),
    riskScore,
    riskLabel: classifyRiskLabel(riskScore),
  };
}

/**
 * Filters events to those whose timestamp falls within `windowMs` of now.
 */
export function filterActiveAttacks(
  events: InfraAttackEvent[],
  windowMs: number,
): InfraAttackEvent[] {
  const cutoff = Date.now() - windowMs;
  return events.filter((ev) => ev.timestamp >= cutoff);
}

/** Sorts events critical-first; within the same severity, newest first. */
export function sortAttacksBySeverity(events: InfraAttackEvent[]): InfraAttackEvent[] {
  return [...events].sort((a, b) => {
    const severityDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return b.timestamp - a.timestamp;
  });
}

export function formatSector(sector: InfrastructureSector): string {
  const labels: Record<InfrastructureSector, string> = {
    power_grid: 'Power Grid',
    water_system: 'Water System',
    communications: 'Communications',
    transport: 'Transport',
  };
  return labels[sector];
}

export function formatVector(vector: AttackVector): string {
  const labels: Record<AttackVector, string> = {
    physical: 'Physical',
    cyber: 'Cyber',
    combined: 'Combined',
  };
  return labels[vector];
}

export function formatRecoveryStatus(status: RecoveryStatus): string {
  const labels: Record<RecoveryStatus, string> = {
    contained: 'Contained',
    recovering: 'Recovering',
    ongoing: 'Ongoing',
    unknown: 'Unknown',
  };
  return labels[status];
}

export function formatAttributionConfidence(conf: AttributionConfidence): string {
  const labels: Record<AttributionConfidence, string> = {
    confirmed: 'Confirmed',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    unknown: 'Unknown',
  };
  return labels[conf];
}

/** Returns 6 hardcoded realistic sample events for demo/testing. */
export function sampleInfraAttackEvents(): InfraAttackEvent[] {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1_000;
  return [
    {
      id: 'sample-001',
      sector: 'power_grid',
      vector: 'cyber',
      severity: 'critical',
      recoveryStatus: 'ongoing',
      attribution: 'APT28',
      attributionConfidence: 'high',
      location: 'Ukraine — Eastern Grid',
      affectedPopulation: 2_400_000,
      timestamp: now - 2 * day,
      description: 'Coordinated malware targeting SCADA systems caused widespread outages.',
      sourceUrls: ['https://example.com/source1'],
    },
    {
      id: 'sample-002',
      sector: 'water_system',
      vector: 'cyber',
      severity: 'high',
      recoveryStatus: 'recovering',
      attribution: 'Unknown',
      attributionConfidence: 'low',
      location: 'Oldsmar, FL, USA',
      affectedPopulation: 15_000,
      timestamp: now - 5 * day,
      description: 'Remote access intrusion attempted to raise sodium hydroxide levels.',
      sourceUrls: ['https://example.com/source2'],
    },
    {
      id: 'sample-003',
      sector: 'communications',
      vector: 'combined',
      severity: 'high',
      recoveryStatus: 'contained',
      attribution: 'Lazarus Group',
      attributionConfidence: 'medium',
      location: 'South Korea — Telecom Backbone',
      affectedPopulation: 500_000,
      timestamp: now - 10 * day,
      description: 'Fiber cuts combined with DDoS disabled regional telecoms for 6 hours.',
      sourceUrls: ['https://example.com/source3'],
    },
    {
      id: 'sample-004',
      sector: 'transport',
      vector: 'physical',
      severity: 'medium',
      recoveryStatus: 'recovered',
      attribution: null,
      attributionConfidence: 'unknown',
      location: 'Germany — Rail Network',
      affectedPopulation: 80_000,
      timestamp: now - 20 * day,
      description: 'Sabotage of signal cables disrupted Deutsche Bahn regional services.',
      sourceUrls: ['https://example.com/source4'],
    },
    {
      id: 'sample-005',
      sector: 'power_grid',
      vector: 'physical',
      severity: 'medium',
      recoveryStatus: 'recovering',
      attribution: 'Domestic extremists',
      attributionConfidence: 'confirmed',
      location: 'North Carolina, USA',
      affectedPopulation: 40_000,
      timestamp: now - 15 * day,
      description: 'Gunfire at substations caused multi-day outage in Moore County.',
      sourceUrls: ['https://example.com/source5'],
    },
    {
      id: 'sample-006',
      sector: 'communications',
      vector: 'physical',
      severity: 'low',
      recoveryStatus: 'contained',
      attribution: null,
      attributionConfidence: 'unknown',
      location: 'France — Undersea Cable',
      affectedPopulation: 3_000,
      timestamp: now - 35 * day,
      description: 'Anchor drag severed a regional subsea cable; services rerouted.',
      sourceUrls: ['https://example.com/source6'],
    },
  ];
}
