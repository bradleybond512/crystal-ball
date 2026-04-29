/* eslint-disable unicorn/no-nested-ternary, sonarjs/no-nested-conditional, sonarjs/cognitive-complexity */
/**
 * Cyber → Situation adapter.
 *
 * Phase 1 of docs/CLAUDE_HIGH_IMPACT_EVENT_INTELLIGENCE_VISION_2026-04-29.md.
 *
 * Pure deterministic. Implements the Exploit-To-Impact pipeline shape
 * (CVE → exploit → KEV → ransomware → sector → user-exposure) so any
 * input that walks through those phases produces a Situation.
 * Phase 4 will wire CISA KEV + ransomware feeds + user OS detection.
 */

import {
  severityFromScore,
  type Situation,
  type SituationSeverity,
} from './situation-types';
import { scoreCyberExposure, type ExposureGraph } from './exposure-graph';

// ── Public API ──────────────────────────────────────────────────────────

export type CyberLifecycleStage =
  | 'cve_published'
  | 'exploit_observed'
  | 'kev_listed'
  | 'ransomware_in_use'
  | 'sector_targeted'
  | 'user_exposed';

export type CyberSector =
  | 'power_grid'
  | 'water'
  | 'finance'
  | 'telecom'
  | 'hospitals'
  | 'airports'
  | 'gps_satellite'
  | 'gov_services'
  | 'cloud_provider'
  | 'consumer_software'
  | 'unknown';

export interface CyberThreatInput {
  /** Stable id (e.g. CVE-2026-12345). */
  threatId: string;
  /** Display title. */
  title: string;
  /** Cumulative lifecycle stages reached (most-recent last). */
  stagesReached: readonly CyberLifecycleStage[];
  /** Affected sectors when known. */
  affectedSectors: readonly CyberSector[];
  /** Affected vendors / OS labels (e.g. 'Apple macOS', 'Microsoft Windows'). */
  affectedVendors: readonly string[];
  /** Source-attributed evidence rows (CISA KEV, vendor advisories, news). */
  evidence: readonly {
    id: string;
    source: string;
    claim: string;
    observedAt: number;
    weight: number;
    url?: string;
  }[];
  /** Sources that agree this is a real, exploited threat. */
  agreeingSources: readonly string[];
  /** Sources that contradict (disputed advisory, retracted KEV entry). */
  disagreeingSources: readonly string[];
  /** Optional ms timestamp; defaults to now(). */
  observedAt?: number;
}

export interface CyberAdapterUserContext {
  /** Vendors / OS labels the user runs (matched against affectedVendors). */
  userVendors?: readonly string[];
  /** Sectors the user has watchlisted (e.g. 'finance' if they have
   *  a watched bank). */
  watchedSectors?: readonly CyberSector[];
}

export interface CyberAdapterInput {
  threats: readonly CyberThreatInput[];
  /** Phase 2: full exposure graph. When present, drives userExposure
   *  via scoreCyberExposure(). */
  exposureGraph?: ExposureGraph;
  /** Phase 1 fallback for callers that haven't migrated. */
  user?: CyberAdapterUserContext;
  now?: () => number;
}

export function cyberThreatsToSituations(input: CyberAdapterInput): Situation[] {
  const now = input.now ?? Date.now;
  // Synthesize a graph from the legacy `user` input when no explicit
  // graph is supplied — preserves Phase 1 behavior.
  const graph: ExposureGraph = input.exposureGraph ?? {
    savedPlaces: [],
    watchlist: {
      countries: [],
      sectors: input.user?.watchedSectors ?? [],
      tickers: [],
      vendors: input.user?.userVendors ?? [],
      cves: [],
    },
    device: {
      osLabels: input.user?.userVendors ?? [],
      versions: [],
    },
  };
  return (input.threats ?? []).map((t) => threatToSituation(t, graph, now()));
}

// ── Internals ───────────────────────────────────────────────────────────

const STAGE_SCORE: Record<CyberLifecycleStage, number> = {
  cve_published: 0.15,
  exploit_observed: 0.45,
  kev_listed: 0.6,
  ransomware_in_use: 0.7,
  sector_targeted: 0.75,
  user_exposed: 0.95,
};

const CRITICAL_INFRA_SECTORS: ReadonlySet<CyberSector> = new Set([
  'power_grid',
  'water',
  'finance',
  'telecom',
  'hospitals',
  'airports',
  'gps_satellite',
  'gov_services',
]);

function threatToSituation(
  t: CyberThreatInput,
  graph: ExposureGraph,
  ts: number,
): Situation {
  // Take the highest stage reached as the primary score driver.
  const lastStage = t.stagesReached[t.stagesReached.length - 1] ?? 'cve_published';
  let score = STAGE_SCORE[lastStage] ?? 0.15;

  // Critical-infrastructure sectors bump the score by +0.1 (capped at 1.0).
  const hitsCriticalInfra = t.affectedSectors.some((s) => CRITICAL_INFRA_SECTORS.has(s));
  if (hitsCriticalInfra) score = Math.min(1, score + 0.1);

  // Phase 2: scoreCyberExposure walks the exposure graph (device OS,
  // vendor watchlist, sector watchlist, explicit CVE flags) and
  // returns a (score, reasons, contributions) breakdown.
  const exposure = scoreCyberExposure(
    {
      affectedVendors: t.affectedVendors,
      affectedSectors: t.affectedSectors,
      cveId: t.threatId,
    },
    graph,
  );
  const userExposure = exposure.score;
  const exposureReasons = [...exposure.reasons];
  const userVendorMatch = exposure.contributions['vendor-match'] !== undefined;
  const userSectorMatch = exposure.contributions['sector-match'] !== undefined;
  // Vendor match also bumps the severity score (a CVE you actually
  // run is more impactful than a CVE you don't).
  if (userVendorMatch) score = Math.min(1, score + 0.1);

  const severity: SituationSeverity = severityFromScore(score);

  // Urgency rises with KEV / ransomware / user-exposure.
  const urgency = lastStage === 'user_exposed'
    ? 0.95
    : lastStage === 'ransomware_in_use' || lastStage === 'sector_targeted'
    ? 0.8
    : lastStage === 'kev_listed'
    ? 0.6
    : lastStage === 'exploit_observed'
    ? 0.4
    : 0.2;

  const independentSources = new Set(t.agreeingSources).size;
  const confidence = Math.min(0.95, 0.55 + 0.1 * independentSources);

  const recommendedActions: Situation['recommendedActions'] = userVendorMatch
    ? [
        {
          id: `${t.threatId}:patch`,
          text: `Patch ${t.affectedVendors.join(' / ')} today; this CVE is actively exploited.`,
          urgency: 'immediate',
        },
        {
          id: `${t.threatId}:monitor`,
          text: 'Watch your accounts and devices for suspicious activity.',
          urgency: 'soon',
        },
      ]
    : severity === 'critical' || severity === 'emergency'
    ? [
        {
          id: `${t.threatId}:watch`,
          text: `Critical sector under threat — monitor for service disruption.`,
          urgency: 'soon',
        },
      ]
    : [
        {
          id: `${t.threatId}:fyi`,
          text: 'Tracking for escalation; no user action required yet.',
          urgency: 'fyi',
        },
      ];

  return {
    id: `cyber:${t.threatId}`,
    domain: 'cyber',
    title: t.title,
    summary: `${prettyStage(lastStage)} — ${t.affectedVendors.join(', ') || t.affectedSectors.join(', ') || 'multiple targets'}.`,
    severity,
    confidence,
    urgency,
    userExposure,
    personalImpact: {
      summary: userVendorMatch
        ? `Your ${t.affectedVendors.join(' / ')} system is affected.`
        : userSectorMatch
        ? `A sector you watch is targeted.`
        : 'No direct exposure detected.',
      level: userVendorMatch ? 'high' : userSectorMatch ? 'medium' : 'low',
      reasons: exposureReasons,
    },
    evidence: t.evidence,
    sourceAgreement: {
      agreeing: t.agreeingSources,
      disagreeing: t.disagreeingSources,
      independentSourceCount: independentSources,
    },
    whatChanged: [
      { ts, text: `Lifecycle stage: ${prettyStage(lastStage)}`, source: t.evidence[0]?.source ?? 'cyber-feed' },
    ],
    expectedNextSignals: [
      { id: `${t.threatId}:patch-released`, description: 'Vendor patch / mitigation released' },
      { id: `${t.threatId}:cisa-advisory`, description: 'CISA advisory or KEV addition' },
      { id: `${t.threatId}:ransomware-association`, description: 'Ransomware group associated with the CVE' },
    ],
    invalidationSignals: [
      { id: `${t.threatId}:retracted`, description: 'Advisory retracted or downgraded' },
      { id: `${t.threatId}:no-exploitation`, description: '30-day window without observed exploitation' },
    ],
    recommendedActions,
    timeline: t.stagesReached.map((stage, i) => ({
      ts: t.evidence[i]?.observedAt ?? ts,
      text: prettyStage(stage),
      source: t.evidence[i]?.source ?? 'cyber-feed',
    })),
    diagnosticsTrace: {
      createdReason: `Cyber threat ${t.threatId} reached stage '${lastStage}'`,
      severityRationale: `Stage '${lastStage}' base ${STAGE_SCORE[lastStage]}, infra-bump ${
        hitsCriticalInfra ? '+0.1' : '+0'
      }, user-bump ${userVendorMatch ? '+0.1' : '+0'} → score ${score.toFixed(2)} → tier '${severity}'`,
      confidenceRationale: `${independentSources} independent source(s) → confidence ${confidence.toFixed(2)}`,
      exposureRationale: exposureReasons.length > 0
        ? exposureReasons.join('; ')
        : 'No vendor or sector match against user context',
      sourceContributions: Object.fromEntries(
        t.agreeingSources.map((s) => [s, 1 / Math.max(1, t.agreeingSources.length)]),
      ),
      thresholdsCrossed: [
        `stage:${lastStage}`,
        `severity:${severity}`,
        ...(hitsCriticalInfra ? ['critical_infra'] : []),
        ...(userVendorMatch ? ['user_vendor_match'] : []),
        ...(userSectorMatch ? ['user_sector_match'] : []),
      ],
    },
    predictionOutcome: {},
    phase: lastStage === 'user_exposed' ? 'active' : lastStage === 'cve_published' ? 'emerging' : 'developing',
    firstSeen: t.observedAt ?? ts,
    lastUpdated: ts,
  };
}

function prettyStage(s: CyberLifecycleStage): string {
  return s.replace(/_/g, ' ');
}
