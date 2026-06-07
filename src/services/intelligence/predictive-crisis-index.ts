/**
 * Predictive Crisis Index — aggregates crisis signature matches into a
 * single composite index (0–100) with domain breakdown, trend, and
 * lead-time-aware threat ranking.
 *
 * Builds directly on CrisisSignatureLibrary.matchSignatures(). Each
 * SignatureMatch contributes (matchScore × signatureConfidence) to the
 * index, weighted so that high-confidence signatures carry more signal
 * than noisy low-confidence ones.
 *
 * Pure module — no DOM, no fetch, no globals at import time.
 */

import type { SignatureMatch } from './crisis-signature-library';
import type { UnifiedAlert } from '@/services/unified-alerts';

// ── Public types ──────────────────────────────────────────────────────

export type PCILevel = 'low' | 'moderate' | 'elevated' | 'high' | 'critical';
export type PCITrend = 'rising' | 'stable' | 'falling';

export interface PCIDomainScore {
  domain: string;
  /** 0–100 contribution from this domain's matches. */
  score: number;
  matchCount: number;
}

export interface PCIThreat {
  signatureId: string;
  signatureName: string;
  domain: string;
  /** Raw signature match score, 0–1. */
  matchScore: number;
  /** Prior confidence of the signature, 0–1. */
  confidence: number;
  /** Estimated hours before full crisis onset. */
  leadTimeHours: number;
  /** Composite risk contribution: matchScore × confidence × 100. */
  risk: number;
}

export interface PCIScore {
  /** Composite index 0–100. */
  index: number;
  level: PCILevel;
  trend: PCITrend;
  /** Absolute change in index since previous computation (+/–). */
  trendDelta: number;
  /** Per-domain breakdown sorted by score descending. */
  domainBreakdown: PCIDomainScore[];
  /** Top threats sorted by risk descending. */
  topThreats: PCIThreat[];
  /** Timestamp of this computation. */
  computedAt: number;
  /** Observation window used (ms). Informational. */
  windowMs: number;
}

// ── Constants ─────────────────────────────────────────────────────────

export const PCI_WINDOW_MS = 6 * 60 * 60 * 1000; // 6-hour observation window
export const PCI_TOP_THREATS = 5;
export const PCI_TREND_THRESHOLD = 5; // index delta needed to flip trend

// Alert thresholds — only fire when crossing into elevated or above
export const PCI_ALERT_MIN_LEVEL: PCILevel = 'elevated';

const ALERT_COOLDOWN_MS = 30 * 60 * 1000;
const _lastAlertTs = new Map<PCILevel, number>();

// ── Level classification ──────────────────────────────────────────────

export function pciLevelFor(index: number): PCILevel {
  if (index >= 85) return 'critical';
  if (index >= 70) return 'high';
  if (index >= 50) return 'elevated';
  if (index >= 25) return 'moderate';
  return 'low';
}

// ── Core computation ──────────────────────────────────────────────────

/**
 * Compute a PCIScore from a list of active SignatureMatches.
 *
 * @param matches   Output of CrisisSignatureLibrary.matchSignatures().
 * @param prevIndex Index from the previous computation, used for trend.
 * @param now       Clock injection (ms epoch). Defaults to Date.now().
 */
export function computePCI(
  matches: readonly SignatureMatch[],
  prevIndex?: number,
  now = Date.now(),
): PCIScore {
  if (matches.length === 0) {
    return _emptyPCI(prevIndex, now);
  }

  // Build threat list
  const threats: PCIThreat[] = matches.map((m) => ({
    signatureId: m.signature.id,
    signatureName: m.signature.name,
    domain: m.signature.domain,
    matchScore: m.score,
    confidence: m.signature.confidence,
    leadTimeHours: m.leadTimeEstimateHours,
    risk: Number((m.score * m.signature.confidence * 100).toFixed(1)),
  }));
  threats.sort((a, b) => b.risk - a.risk);

  // Composite index: weighted mean of risk values, normalised to 0-100.
  // The weight for each match is the signature confidence so that
  // high-confidence signals dominate over noisy low-confidence ones.
  let weightedSum = 0;
  let totalWeight = 0;
  for (const t of threats) {
    weightedSum += t.risk * t.confidence;
    totalWeight += t.confidence;
  }
  const raw = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const index = Math.min(100, Math.round(raw));

  // Domain breakdown
  const domainMap = new Map<string, { sum: number; count: number }>();
  for (const t of threats) {
    const entry = domainMap.get(t.domain) ?? { sum: 0, count: 0 };
    entry.sum += t.risk;
    entry.count += 1;
    domainMap.set(t.domain, entry);
  }
  const domainBreakdown: PCIDomainScore[] = [...domainMap.entries()]
    .map(([domain, { sum, count }]) => ({
      domain,
      score: Math.min(100, Math.round(sum)),
      matchCount: count,
    }))
    .sort((a, b) => b.score - a.score);

  // Trend
  let trend: PCITrend = 'stable';
  let trendDelta = 0;
  if (prevIndex !== undefined) {
    trendDelta = index - prevIndex;
    if (trendDelta >= PCI_TREND_THRESHOLD) trend = 'rising';
    else if (trendDelta <= -PCI_TREND_THRESHOLD) trend = 'falling';
  }

  return {
    index,
    level: pciLevelFor(index),
    trend,
    trendDelta,
    domainBreakdown,
    topThreats: threats.slice(0, PCI_TOP_THREATS),
    computedAt: now,
    windowMs: PCI_WINDOW_MS,
  };
}

function _emptyPCI(prevIndex: number | undefined, now: number): PCIScore {
  const trendDelta = prevIndex === undefined ? 0 : 0 - prevIndex;
  let trend: PCITrend = 'stable';
  if (trendDelta <= -PCI_TREND_THRESHOLD) trend = 'falling';
  return {
    index: 0,
    level: 'low',
    trend,
    trendDelta,
    domainBreakdown: [],
    topThreats: [],
    computedAt: now,
    windowMs: PCI_WINDOW_MS,
  };
}

// ── Alert integration ─────────────────────────────────────────────────

const LEVEL_SEVERITY: Partial<Record<PCILevel, 'medium' | 'high' | 'critical'>> = {
  elevated: 'medium',
  high: 'high',
  critical: 'critical',
};

const ORDERED_LEVELS: PCILevel[] = ['low', 'moderate', 'elevated', 'high', 'critical'];

function levelGte(a: PCILevel, b: PCILevel): boolean {
  return ORDERED_LEVELS.indexOf(a) >= ORDERED_LEVELS.indexOf(b);
}

/**
 * Create a UnifiedAlert when the PCI crosses into elevated or above.
 * Fires only on the current level, respects a 30-min per-level cooldown.
 */
export function pciToAlert(score: PCIScore, now = Date.now()): UnifiedAlert | null {
  if (!levelGte(score.level, PCI_ALERT_MIN_LEVEL)) return null;
  const severity = LEVEL_SEVERITY[score.level];
  if (!severity) return null;

  const last = _lastAlertTs.get(score.level) ?? 0;
  if (now - last < ALERT_COOLDOWN_MS) return null;
  _lastAlertTs.set(score.level, now);

  const topThreat = score.topThreats[0];
  const leadLine = topThreat
    ? ` Lead threat: ${topThreat.signatureName} (~${topThreat.leadTimeHours}h lead).`
    : '';
  const domains = score.domainBreakdown
    .slice(0, 3)
    .map((d) => d.domain)
    .join(', ');

  return {
    id: `pci-${score.level}-${now}`,
    source: 'correlation',
    severity,
    title: `Predictive Crisis Index: ${score.level.toUpperCase()} (${score.index}/100)`,
    body: `PCI crossed ${score.level} threshold. Active domains: ${domains || 'unknown'}.${leadLine}`,
    timestamp: now,
    relevanceScore: score.index / 100,
    acknowledged: false,
    pinned: false,
  };
}

/** Reset cooldown state — for tests only. */
export function resetPCICooldowns(): void {
  _lastAlertTs.clear();
}

// ── Runtime wiring ────────────────────────────────────────────────────

import type { AnalystSnapshot, Hypothesis } from '@/services/analyst-loop';
import { unifiedAlertStore } from '@/services/unified-alerts';

const EVENT_PCI_UPDATED = 'cb:pci-updated';
let _latestPCI: PCIScore | null = null;
let _pciStarted = false;

export function getLatestPCI(): PCIScore | null {
  return _latestPCI;
}

const RISK_CONF: Record<string, number> = {
  critical: 0.95, high: 0.8, moderate: 0.6, low: 0.35,
};
const KIND_DOMAIN: Record<string, string> = {
  'cross-domain-cluster': 'multi', 'anomaly-convergence': 'anomaly',
  'alert-burst': 'alerts', 'situation-escalation': 'situation',
  'watchlist-convergence': 'watchlist', 'social-velocity-spike': 'social',
};
function leadHours(risk: string): number {
  if (risk === 'critical') return 6;
  if (risk === 'high') return 24;
  return 72;
}

function hypothesesToMatches(hypotheses: Hypothesis[]): SignatureMatch[] {
  return hypotheses.map((h): SignatureMatch => ({
    signature: {
      id: h.id,
      name: h.statement.slice(0, 60),
      domain: KIND_DOMAIN[h.kind] ?? h.kind,
      fingerprint: [],
      historicalExamples: [],
      avgLeadTimeHours: leadHours(h.risk),
      confidence: RISK_CONF[h.risk] ?? 0.5,
    },
    score: h.confidence,
    matchedFeatures: [],
    leadTimeEstimateHours: leadHours(h.risk),
  }));
}

export function startPredictiveCrisisIndex(): void {
  if (_pciStarted) return;
  _pciStarted = true;

  document.addEventListener('cb:analyst-hypotheses', (e: Event) => {
    const ce = e as CustomEvent<AnalystSnapshot>;
    const matches = hypothesesToMatches(ce.detail.hypotheses);
    const prev = _latestPCI?.index;
    _latestPCI = computePCI(matches, prev);
    document.dispatchEvent(new CustomEvent<PCIScore>(EVENT_PCI_UPDATED, { detail: _latestPCI }));
    const alert = pciToAlert(_latestPCI);
    if (alert) unifiedAlertStore.ingest([alert]);
  });
}
