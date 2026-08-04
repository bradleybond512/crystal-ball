import type { InhibitoryLeadLagEdge } from './lead-lag';

export const INHIBITION_REFRESH_INTERVAL_MS = 60 * 60_000;
export const INHIBITION_TTL_MS = 2 * INHIBITION_REFRESH_INTERVAL_MS;
export const MAX_INHIBITORY_EVIDENCE = 12;
export const INHIBITION_SETTING_KEY = 'wm-correlation-inhibition-enabled';

const MAX_DAMPENING = 0.15;
const FACTOR_FLOOR = 0.85;

export interface InhibitoryEvidence extends InhibitoryLeadLagEdge {
  criticalAbsZ: number;
}

export interface InhibitorySnapshot {
  readonly evidence: readonly Readonly<InhibitoryEvidence>[];
  readonly publishedAt: number;
  readonly expiresAt: number;
}

export interface InhibitionProvenance {
  kind: 'learned-inhibition';
  fromDomain: string;
  toDomain: string;
  zScore: number;
  criticalAbsZ: number;
  evidenceStrength: number;
  factor: number;
  explanation: string;
  publishedAt: number;
}

export interface InhibitionAdjustment {
  score: number;
  provenance?: InhibitionProvenance;
}

let activeSnapshot: InhibitorySnapshot | null = null;

export function replaceInhibitorySnapshot(
  edges: readonly InhibitoryLeadLagEdge[],
  criticalAbsZ: number,
  publishedAt: number = Date.now(),
): InhibitorySnapshot {
  const evidence = validEvidence(edges, criticalAbsZ)
    .sort(compareEvidence)
    .slice(0, MAX_INHIBITORY_EVIDENCE)
    .map((item) => Object.freeze(item));
  const snapshot = Object.freeze({
    evidence: Object.freeze(evidence),
    publishedAt,
    expiresAt: publishedAt + INHIBITION_TTL_MS,
  });
  activeSnapshot = snapshot;
  return snapshot;
}

export function clearInhibitorySnapshot(): void {
  activeSnapshot = null;
}

export function getInhibitorySnapshot(
  now: number = Date.now(),
  enabled: boolean = readInhibitionEnabled(),
): InhibitorySnapshot | null {
  if (!enabled) {
    clearInhibitorySnapshot();
    return null;
  }
  if (!activeSnapshot || !Number.isFinite(now) || now > activeSnapshot.expiresAt) return null;
  return activeSnapshot;
}

export function readInhibitionEnabled(
  storage: Pick<Storage, 'getItem'> | null = safeStorage(),
): boolean {
  try {
    return storage?.getItem(INHIBITION_SETTING_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function inhibitionAdjustmentFor(
  undampenedScore: number,
  rawDomains: readonly string[],
  snapshot: InhibitorySnapshot | null,
): InhibitionAdjustment {
  if (!snapshot || !Number.isFinite(undampenedScore)) return { score: undampenedScore };
  const domains = new Set(rawDomains.filter((domain) => validDomain(domain)));
  let strongest: { evidence: Readonly<InhibitoryEvidence>; strength: number } | null = null;
  for (const evidence of snapshot.evidence) {
    if (!validPublishedEvidence(evidence)) continue;
    if (!domains.has(evidence.from) || !domains.has(evidence.to)) continue;
    const strength = clamp01(Math.abs(evidence.zScore) / (2 * evidence.criticalAbsZ));
    if (!strongest || strength > strongest.strength) strongest = { evidence, strength };
  }
  if (!strongest) return { score: undampenedScore };

  const factor = Math.max(FACTOR_FLOOR, 1 - MAX_DAMPENING * strongest.strength);
  return {
    score: Math.round(undampenedScore * factor),
    provenance: {
      kind: 'learned-inhibition',
      fromDomain: strongest.evidence.from,
      toDomain: strongest.evidence.to,
      zScore: strongest.evidence.zScore,
      criticalAbsZ: strongest.evidence.criticalAbsZ,
      evidenceStrength: strongest.strength,
      factor,
      explanation: strongest.evidence.explanation,
      publishedAt: snapshot.publishedAt,
    },
  };
}

function validEvidence(
  edges: readonly InhibitoryLeadLagEdge[],
  criticalAbsZ: number,
): InhibitoryEvidence[] {
  if (!Number.isFinite(criticalAbsZ) || criticalAbsZ <= 0) return [];
  const deduped = new Map<string, InhibitoryEvidence>();
  for (const edge of edges) {
    if (!validEdge(edge)) continue;
    const item = { ...edge, criticalAbsZ };
    const key = `${edge.from}\u0000${edge.to}`;
    const existing = deduped.get(key);
    if (!existing || compareEvidence(item, existing) < 0) deduped.set(key, item);
  }
  return [...deduped.values()];
}

function validEdge(edge: InhibitoryLeadLagEdge): boolean {
  return edge?.effect === 'inhibitory'
    && validDomain(edge.from)
    && validDomain(edge.to)
    && edge.from !== edge.to
    && Number.isFinite(edge.windowMs)
    && edge.windowMs > 0
    && Number.isInteger(edge.support)
    && edge.support >= 0
    && Number.isInteger(edge.antecedents)
    && edge.antecedents > 0
    && edge.support <= edge.antecedents
    && finiteUnit(edge.followRate)
    && finiteUnit(edge.expectedRate)
    && Number.isFinite(edge.lift)
    && edge.lift >= 0
    && Number.isFinite(edge.zScore)
    && edge.zScore < 0
    && finiteUnit(edge.strength)
    && typeof edge.explanation === 'string'
    && edge.explanation.length > 0;
}

function validPublishedEvidence(evidence: Readonly<InhibitoryEvidence>): boolean {
  return validEdge(evidence)
    && Number.isFinite(evidence.criticalAbsZ)
    && evidence.criticalAbsZ > 0;
}

function validDomain(domain: string): boolean {
  return typeof domain === 'string' && domain.length > 0;
}

function compareEvidence(a: InhibitoryEvidence, b: InhibitoryEvidence): number {
  return Math.abs(b.zScore) - Math.abs(a.zScore)
    || a.from.localeCompare(b.from)
    || a.to.localeCompare(b.to)
    || a.windowMs - b.windowMs;
}

function safeStorage(): Pick<Storage, 'getItem'> | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function finiteUnit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
