/**
 * Command Center summary — pure-deterministic.
 *
 * Composes the 5-question answer that Command Center renders on first
 * load:
 *
 *   1. What matters right now?      → top-3 active Situations
 *   2. Why does it matter to me?    → saved-place proximity + matching
 *                                     alert rules per top situation
 *   3. What changed since last look? → top-5 WhatChanged items with
 *                                     polarity + age
 *   4. How confident is Crystal Ball? → aggregate feed health score
 *                                     (FRESH / STALE / DEGRADED)
 *   5. What should I do next?       → first 2 automated playbook steps
 *                                     for the top situation, or top
 *                                     alert-rule suggestions as
 *                                     fallback
 *
 * No DOM, no fetch. The sidecar route is a thin proxy that the
 * renderer + tests both consume via this builder.
 */

import type { Situation, SituationSeverity, Playbook, PlaybookStep, AlertRule } from '@/types/intelligence';
import type { WhatChangedReport } from './what-changed';

// ─── Public types ─────────────────────────────────────────────────────

export type FreshnessLabel = 'FRESH' | 'STALE' | 'DEGRADED';

export type ChangePolarity = 'up' | 'down' | 'flat';

export interface SavedPlaceLite {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface SituationSummary {
  id: string;
  name: string;
  severity: SituationSeverity;
  domain: string;
  summary: string;
  observationCount: number;
  correlationCount: number;
  startedAt: number;
  updatedAt: number;
  /** Saved place that is nearest to the situation footprint, if any. */
  nearestPlace: { id: string; name: string; distanceKm: number } | null;
  /** Alert-rule names that match this situation's domain / tags / severity. */
  matchingRules: string[];
  /** Per-domain icon glyph the renderer can use without re-deriving. */
  domainIcon: string;
}

export interface WhatChangedItem {
  /** Stable id derived from the underlying change so consumers can
   *  dedupe across renders. */
  id: string;
  /** Short human-readable summary. */
  label: string;
  /** Domain that produced the change, if applicable. */
  domain: string | null;
  polarity: ChangePolarity;
  /** ms-epoch of the change. */
  occurredAt: number;
  /** Weight 0-100; the bigger the more meaningful. */
  weight: number;
}

export interface FeedHealth {
  /** Number of feeds reporting healthy. */
  healthy: number;
  /** Total feeds inspected. */
  total: number;
  /** Ratio rounded to two decimals. */
  ratio: number;
  /** ms-epoch of the most recent feed observation. */
  lastUpdated: number | null;
  freshness: FreshnessLabel;
  /** One-line headline that the panel can render verbatim. */
  headline: string;
}

export interface SuggestedAction {
  /** "playbook" when sourced from an active playbook step;
   *  "rule" when sourced from a user alert rule. */
  source: 'playbook' | 'rule';
  /** Display label (action text). */
  label: string;
  /** Stable id (playbook step number or rule id). */
  refId: string;
  /** True when the step can run without user interaction. */
  automated: boolean;
}

export interface CommandCenterSummary {
  generatedAt: number;
  topSituations: SituationSummary[];
  whatChanged: WhatChangedItem[];
  feedHealth: FeedHealth;
  suggestedActions: SuggestedAction[];
}

// ─── Inputs ──────────────────────────────────────────────────────────

export interface BuildSummaryInput {
  /** Active situations from situation-store.getActive(). */
  situations: Situation[];
  whatChangedReport: WhatChangedReport | null;
  savedPlaces: SavedPlaceLite[];
  /** All persisted alert rules (rules-engine getRules()). */
  alertRules: AlertRule[];
  /** Playbook for the top situation. The orchestrator (sidecar) pre-
   *  resolves the playbook for the top situation's representative
   *  event; the renderer-side builder consumes it as-is. */
  topSituationPlaybook?: Playbook | null;
  /** Feed sentinels keyed by feedId, value = ms-epoch of last
   *  successful observation. Pass {} when none available. */
  feedLastSeen: Record<string, number>;
  /** Subset of `feedLastSeen` that the system regards as healthy.
   *  Used to compute the headline "X/Y feeds healthy". */
  healthyFeedIds: readonly string[];
  now: number;
}

// ─── Severity ordering ────────────────────────────────────────────────

const SEVERITY_ORDER: Record<SituationSeverity, number> = {
  critical: 4, high: 3, moderate: 2, low: 1, info: 0,
};

// ─── Domain icons ─────────────────────────────────────────────────────

const DOMAIN_ICONS: Record<string, string> = {
  earthquake: '🌍',
  weather: '🌪',
  conflict: '⚔️',
  cyber: '🔐',
  maritime: '🚢',
  aviation: '✈️',
  health: '🏥',
  power: '⚡',
  fire: '🔥',
  volcano: '🌋',
  flood: '🌊',
  default: '🛰',
};

function domainIcon(domain: string): string {
  return DOMAIN_ICONS[domain] ?? DOMAIN_ICONS.default ?? '🛰';
}

// ─── Geographic helper ───────────────────────────────────────────────

const EARTH_KM = 6371;
const DEG2RAD = Math.PI / 180;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Builders ─────────────────────────────────────────────────────────

/** Sort active situations: severity desc, then updatedAt desc. */
export function rankSituations(situations: readonly Situation[]): Situation[] {
  return [...situations].sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity];
    const sb = SEVERITY_ORDER[b.severity];
    if (sa !== sb) return sb - sa;
    return b.updatedAt - a.updatedAt;
  });
}

function nearestPlaceFor(
  situation: Situation,
  places: readonly SavedPlaceLite[],
): { id: string; name: string; distanceKm: number } | null {
  if (!situation.location || places.length === 0) return null;
  let best: { place: SavedPlaceLite; distKm: number } | null = null;
  for (const p of places) {
    const dist = haversineKm(situation.location.lat, situation.location.lon, p.lat, p.lon);
    if (!best || dist < best.distKm) best = { place: p, distKm: dist };
  }
  if (!best) return null;
  return { id: best.place.id, name: best.place.name, distanceKm: Math.round(best.distKm) };
}

/** Match alert rules to a situation by domain + tag intersection.
 *  Conservative: requires either a domain-equals rule or a keyword
 *  rule whose value appears in the situation tags / domain / name. */
export function matchingRulesFor(
  situation: Situation,
  rules: readonly AlertRule[],
): string[] {
  const out: string[] = [];
  const haystack = `${situation.name} ${situation.domain} ${situation.tags.join(' ')}`.toLowerCase();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.conditions.some((c) => ruleConditionMatchesSituation(c, situation, haystack))) {
      out.push(rule.name);
    }
  }
  return out;
}

function ruleConditionMatchesSituation(
  c: AlertRule['conditions'][number],
  situation: Situation,
  haystack: string,
): boolean {
  const value = String(c.value).toLowerCase();
  if (c.field === 'domain' && c.operator === 'equals') return value === situation.domain.toLowerCase();
  if (c.field === 'keyword' && c.operator === 'contains') return haystack.includes(value);
  if (c.field === 'severity' && c.operator === 'equals') return value === situation.severity;
  return false;
}

export function buildSituationSummary(
  s: Situation,
  places: readonly SavedPlaceLite[],
  rules: readonly AlertRule[],
): SituationSummary {
  return {
    id: s.id,
    name: s.name,
    severity: s.severity,
    domain: s.domain,
    summary: s.summary,
    observationCount: s.observationIds.length,
    correlationCount: s.correlationIds.length,
    startedAt: s.startedAt,
    updatedAt: s.updatedAt,
    nearestPlace: nearestPlaceFor(s, places),
    matchingRules: matchingRulesFor(s, rules),
    domainIcon: domainIcon(s.domain),
  };
}

// ─── What-changed projection ─────────────────────────────────────────

export function projectWhatChanged(report: WhatChangedReport | null, now: number, limit = 5): WhatChangedItem[] {
  if (!report) return [];
  const items: WhatChangedItem[] = [];

  for (const escalation of report.severityEscalations) {
    items.push({
      id: `escalation-${escalation.domain}-${escalation.to}-${report.until}`,
      label: `${escalation.domain} severity ↑ ${escalation.from} → ${escalation.to}`,
      domain: escalation.domain,
      polarity: 'up',
      occurredAt: report.until,
      weight: 70 + (escalation.to - escalation.from) * 5,
    });
  }

  for (const [domain, ids] of Object.entries(report.newEventsByDomain)) {
    if (ids.length === 0) continue;
    items.push({
      id: `new-${domain}-${report.until}`,
      label: `${ids.length} new ${domain} event${ids.length === 1 ? '' : 's'}`,
      domain,
      polarity: 'up',
      occurredAt: report.until,
      weight: Math.min(60, 20 + ids.length * 5),
    });
  }

  if (report.totalResolved > 0) {
    items.push({
      id: `resolved-${report.until}`,
      label: `${report.totalResolved} event${report.totalResolved === 1 ? '' : 's'} resolved`,
      domain: null,
      polarity: 'down',
      occurredAt: report.until,
      weight: 30,
    });
  }

  if (report.newCorrelationIds.length > 0) {
    items.push({
      id: `correlations-${report.until}`,
      label: `${report.newCorrelationIds.length} new cross-domain correlation${report.newCorrelationIds.length === 1 ? '' : 's'}`,
      domain: null,
      polarity: 'up',
      occurredAt: report.until,
      weight: 50,
    });
  }

  if (items.length === 0 && now > 0) {
    items.push({
      id: `quiet-${report.until || now}`,
      label: 'No new events since last refresh',
      domain: null,
      polarity: 'flat',
      occurredAt: report.until || now,
      weight: 0,
    });
  }

  items.sort((a, b) => b.weight - a.weight || b.occurredAt - a.occurredAt);
  return items.slice(0, limit);
}

// ─── Feed health ─────────────────────────────────────────────────────

const FRESH_MAX_AGE_MS = 5 * 60 * 1000;
const STALE_MAX_AGE_MS = 30 * 60 * 1000;

export function computeFeedHealth(input: {
  feedLastSeen: Record<string, number>;
  healthyFeedIds: readonly string[];
  now: number;
}): FeedHealth {
  const total = Object.keys(input.feedLastSeen).length;
  const healthySet = new Set(input.healthyFeedIds);
  const healthy = total === 0 ? 0 : Object.keys(input.feedLastSeen).filter((id) => healthySet.has(id)).length;
  const ratio = total > 0 ? Math.round((healthy / total) * 100) / 100 : 0;
  let lastUpdated: number | null = null;
  for (const ts of Object.values(input.feedLastSeen)) {
    if (!lastUpdated || ts > lastUpdated) lastUpdated = ts;
  }
  let freshness: FreshnessLabel;
  if (total === 0 || lastUpdated === null) {
    freshness = 'DEGRADED';
  } else {
    const age = input.now - lastUpdated;
    if (age > STALE_MAX_AGE_MS || ratio < 0.5) freshness = 'DEGRADED';
    else if (age > FRESH_MAX_AGE_MS || ratio < 0.85) freshness = 'STALE';
    else freshness = 'FRESH';
  }
  const headline = total === 0
    ? 'No feed sentinels reported yet'
    : `${healthy}/${total} feeds healthy · ${freshness}`;
  return { healthy, total, ratio, lastUpdated, freshness, headline };
}

// ─── Suggested actions ───────────────────────────────────────────────

export function suggestedActions(
  playbook: Playbook | null | undefined,
  topSituation: SituationSummary | null,
  rules: readonly AlertRule[],
  limit = 2,
): SuggestedAction[] {
  if (playbook && playbook.steps.length > 0) {
    const automated = playbook.steps.filter((s) => s.automated);
    const steps = automated.length > 0 ? automated : playbook.steps;
    return steps.slice(0, limit).map((step): SuggestedAction => ({
      source: 'playbook',
      label: step.action,
      refId: `step-${step.order}`,
      automated: step.automated,
    }));
  }
  // Fallback: top matching rules for the top situation, or any
  // enabled rule when none match.
  const candidatePool = topSituation
    ? rules.filter((r) => r.enabled && topSituation.matchingRules.includes(r.name))
    : rules.filter((r) => r.enabled);
  const pool = candidatePool.length > 0 ? candidatePool : rules.filter((r) => r.enabled);
  return pool.slice(0, limit).map((r): SuggestedAction => ({
    source: 'rule',
    label: r.name,
    refId: r.id,
    automated: false,
  }));
}

// ─── Top-level builder ───────────────────────────────────────────────

export function buildCommandCenterSummary(input: BuildSummaryInput): CommandCenterSummary {
  const ranked = rankSituations(input.situations);
  const topSituations = ranked.slice(0, 3).map((s) => buildSituationSummary(s, input.savedPlaces, input.alertRules));
  const whatChanged = projectWhatChanged(input.whatChangedReport, input.now);
  const feedHealth = computeFeedHealth(input);
  const actions = suggestedActions(input.topSituationPlaybook ?? null, topSituations[0] ?? null, input.alertRules);
  return {
    generatedAt: input.now,
    topSituations,
    whatChanged,
    feedHealth,
    suggestedActions: actions,
  };
}

// Re-export for use in the panel.
export { domainIcon as _domainIcon };

// Helper for the panel to map a top situation back to its playbook step list.
export function describePlaybookStep(step: PlaybookStep): string {
  const tag = step.automated ? 'auto' : 'manual';
  return `[${tag}] ${step.action}`;
}
