/**
 * Alert Explainer (v2) — answers "why this alert?" for any UnifiedAlert.
 *
 * Distinct from `explainer.ts` which operates on the internal
 * ObservationEvent shape used by the situation-detector. This module
 * runs on the operator-facing `UnifiedAlert` shape so the panel layer
 * can render an explanation for anything that has already landed in
 * the alert store.
 *
 * Pure — no DOM, no fetch, no globals. Inputs: the alert + context
 * snapshot (situations, recent events, saved places). Output: a fully-
 * populated AlertExplanation suitable for the panel + sidecar mirror.
 */

import type { UnifiedAlert, AlertSource } from '@/services/unified-alerts';
import type { Situation } from '@/types/intelligence';
import type { SavedPlace } from '@/services/saved-places';
import { computeDistanceKm } from '@/services/unified-alerts';

// ── Types ────────────────────────────────────────────────────────────────

export type ExplainConfidence = 'low' | 'medium' | 'high';

/** Source descriptor surfaced in the explanation. */
export interface ExplainSource {
  title: string;
  domain: string;
  timestamp: number;
}

/** Operator-facing alert explanation. */
export interface AlertExplanation {
  alertId: string;
  headline: string;
  /** Why this matters to the operator right now — proximity / watchlist / interest. */
  whyItMatters: string;
  /** What the underlying signal actually says. */
  whatHappened: string;
  confidence: ExplainConfidence;
  /** Human-readable reason the confidence is what it is. */
  confidenceReason: string;
  /** 2-3 follow-on signals the operator should monitor next. */
  whatToWatch: string[];
  sources: ExplainSource[];
  /** IDs of related alerts pulled from situation membership / correlation pairs. */
  relatedAlerts: string[];
}

/** Context snapshot — caller passes the freshest data, the explainer
 *  pulls only what it needs. */
export interface ExplainContext {
  situations: readonly Situation[];
  events: readonly UnifiedAlert[];
  savedPlaces: readonly SavedPlace[];
  /** Watchlist tickers / countries / callsigns the user is tracking. Optional. */
  watchlist?: readonly string[];
  /** Domain interests the user has opted into. Optional. */
  interestDomains?: readonly string[];
}

// ── Constants ────────────────────────────────────────────────────────────

/** Anything within this radius of a saved place is treated as "near". */
export const SAVED_PLACE_NEAR_KM = 500;

/** Per-domain follow-on signals the operator should monitor next. */
const WHAT_TO_WATCH: Record<string, string[]> = {
  earthquake: [
    'Tsunami advisory from PTWC / NTWC',
    'Aftershock sequence (M5+ within 24h)',
    'Infrastructure impact reports from USGS DYFI',
  ],
  weather: [
    'Storm strengthening / weakening over next 6h',
    'Adjacent counties added to the warning polygon',
    'Power outage reports from local utility feeds',
  ],
  aviation: [
    'Subsequent transponder code changes',
    'ATC frequency activity on the sector',
    'Diversion or emergency landing reports',
  ],
  maritime: [
    'AIS gap duration past the 30-min anomaly threshold',
    'Port state control inspection records',
    'Sanctions list cross-reference for the vessel / owner',
  ],
  wildfire: [
    'Containment % updates from NIFC',
    'Wind-shift forecast from the local NWS WFO',
    'Evacuation orders from county emergency management',
  ],
  'space-weather': [
    'NOAA SWPC G-scale escalation',
    'HF radio + GPS degradation reports',
    'Auroral oval expansion past your latitude',
  ],
  cyber: [
    'CISA KEV / vendor advisory follow-up',
    'Honeypot scan activity for the same TTP',
    'Sector ISAC bulletins',
  ],
  sanctions: [
    'OFAC SDN list change confirmation',
    'Counterparty cross-reference for the affected entity',
    'Bank / clearing-house communication on settlement risk',
  ],
};

const GENERIC_WATCH = [
  'Follow-up reporting from primary sources',
  'Correlated signals from adjacent domains',
];

// ── Domain mapping ───────────────────────────────────────────────────────

/** Map a UnifiedAlert source to the WHAT_TO_WATCH key. */
function explainDomain(source: AlertSource): string {
  switch (source) {
    case 'earthquake': { return 'earthquake'; }
    case 'tsunami': { return 'earthquake'; }
    case 'volcano': { return 'earthquake'; }
    case 'nws': { return 'weather'; }
    case 'spc': { return 'weather'; }
    case 'cyclone': { return 'weather'; }
    case 'gdacs': { return 'weather'; }
    case 'oref': { return 'aviation'; }
    case 'maritime': { return 'maritime'; }
    case 'fire': { return 'wildfire'; }
    case 'hazard': { return 'wildfire'; }
    case 'space-weather': { return 'space-weather'; }
    case 'cyber': { return 'cyber'; }
    case 'local-ids': { return 'cyber'; }
    case 'correlation': { return 'cyber'; }
    case 'power-grid': { return 'cyber'; }
    case 'comms-health': { return 'cyber'; }
    case 'breaking-news': { return 'generic'; }
    case 'resource': { return 'generic'; }
    case 'disease': { return 'generic'; }
    default: { return 'generic'; }
  }
}

// ── Confidence ───────────────────────────────────────────────────────────

function severityScore(s: UnifiedAlert['severity']): number {
  switch (s) {
    case 'critical': { return 4; }
    case 'high': { return 3; }
    case 'medium': { return 2; }
    case 'low': { return 1; }
    default: { return 0; }
  }
}

function computeConfidence(
  alert: UnifiedAlert,
  related: readonly UnifiedAlert[],
): { confidence: ExplainConfidence; reason: string } {
  const sev = severityScore(alert.severity);
  const corrCount = related.length;
  const trustedSource = alert.source !== 'breaking-news' && alert.source !== 'correlation';

  if (sev >= 3 && corrCount >= 1 && trustedSource) {
    return {
      confidence: 'high',
      reason: `${alert.severity} severity from a primary provider (${alert.source}) with ${corrCount} corroborating signal${corrCount === 1 ? '' : 's'}.`,
    };
  }
  if (sev >= 3 && trustedSource) {
    return {
      confidence: 'medium',
      reason: `${alert.severity} severity from ${alert.source}, but no corroborating signals yet — single-source.`,
    };
  }
  if (sev >= 2) {
    return {
      confidence: 'medium',
      reason: `${alert.severity} severity from ${alert.source}; await follow-up before escalating.`,
    };
  }
  return {
    confidence: 'low',
    reason: `${alert.severity} severity from ${alert.source} — treat as informational until corroborated.`,
  };
}

// ── Why-it-matters logic ─────────────────────────────────────────────────

function nearestSavedPlaceKm(alert: UnifiedAlert, places: readonly SavedPlace[]): { km: number; place: SavedPlace } | null {
  if (!alert.location || places.length === 0) return null;
  let best: { km: number; place: SavedPlace } | null = null;
  for (const place of places) {
    const km = computeDistanceKm(alert.location.lat, alert.location.lon, place.lat, place.lon);
    if (!best || km < best.km) best = { km, place };
  }
  return best;
}

function watchlistHit(alert: UnifiedAlert, watchlist: readonly string[]): string | null {
  const haystack = `${alert.title} ${alert.body}`.toLowerCase();
  for (const term of watchlist) {
    if (!term) continue;
    if (haystack.includes(term.toLowerCase())) return term;
  }
  return null;
}

function whyItMatters(
  alert: UnifiedAlert,
  context: ExplainContext,
): string {
  const nearest = nearestSavedPlaceKm(alert, context.savedPlaces);
  if (nearest && nearest.km <= SAVED_PLACE_NEAR_KM) {
    return `${Math.round(nearest.km)}km from "${nearest.place.name}" — within your ${SAVED_PLACE_NEAR_KM}km saved-place radius.`;
  }
  const watch = context.watchlist ? watchlistHit(alert, context.watchlist) : null;
  if (watch) {
    return `Mentions "${watch}" from your watchlist.`;
  }
  const domain = explainDomain(alert.source);
  if (context.interestDomains?.includes(domain)) {
    return `Falls in the "${domain}" domain you flagged as an interest.`;
  }
  if (alert.severity === 'critical' || alert.severity === 'high') {
    return `${alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1)}-severity signal — flagged for awareness even without a direct match.`;
  }
  return 'Background context only — no direct match to your saved places, watchlist, or interests.';
}

// ── Domain templates ─────────────────────────────────────────────────────

function whatHappened(alert: UnifiedAlert): string {
  const domain = explainDomain(alert.source);
  let loc = '';
  if (alert.location?.label) {
    loc = ` near ${alert.location.label}`;
  } else if (alert.location) {
    loc = ` (${alert.location.lat.toFixed(2)}, ${alert.location.lon.toFixed(2)})`;
  }
  switch (domain) {
    case 'earthquake': {
      return `${alert.title}${loc}. ${alert.body || 'Seismic event recorded; tsunami / aftershock follow-up pending.'}`;
    }
    case 'weather': {
      return `${alert.title}${loc}. ${alert.body || 'Official warning issued; conditions met threshold for significant hazard.'}`;
    }
    case 'aviation': {
      return `${alert.title}${loc}. ${alert.body || 'Aircraft / airspace anomaly detected.'}`;
    }
    case 'maritime': {
      return `${alert.title}${loc}. ${alert.body || 'AIS or port-state anomaly detected.'}`;
    }
    case 'wildfire': {
      return `${alert.title}${loc}. ${alert.body || 'Active fire perimeter reported.'}`;
    }
    case 'space-weather': {
      return `${alert.title}${loc}. ${alert.body || 'Geomagnetic / solar activity at threshold for HF radio or GPS impact.'}`;
    }
    case 'cyber': {
      return `${alert.title}${loc}. ${alert.body || 'Cyber threat signal recorded.'}`;
    }
    case 'sanctions': {
      return `${alert.title}${loc}. ${alert.body || 'Sanctions / OFAC change recorded.'}`;
    }
    default: {
      return `${alert.title}${loc}. ${alert.body || 'No further detail available.'}`;
    }
  }
}

// ── Related alerts ───────────────────────────────────────────────────────

function relatedAlerts(alert: UnifiedAlert, context: ExplainContext): UnifiedAlert[] {
  // 1. Explicit correlation members
  const explicit = (alert.correlationMembers ?? [])
    .map((id) => context.events.find((e) => e.id === id))
    .filter((e): e is UnifiedAlert => Boolean(e));

  // 2. Situation co-membership
  const inSituation = context.situations.find((s) => s.observationIds.includes(alert.id));
  const cohort: UnifiedAlert[] = [];
  if (inSituation) {
    for (const otherId of inSituation.observationIds) {
      if (otherId === alert.id) continue;
      const e = context.events.find((evt) => evt.id === otherId);
      if (e) cohort.push(e);
    }
  }
  const seen = new Set<string>();
  return [...explicit, ...cohort].filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Build a human-readable explanation for one UnifiedAlert.
 *
 * Deterministic for fixed inputs — every domain template, confidence
 * tier, and saved-place-proximity check is pure computation over the
 * supplied context snapshot.
 */
export function explainAlert(
  alert: UnifiedAlert,
  context: ExplainContext,
): AlertExplanation {
  const related = relatedAlerts(alert, context);
  const { confidence, reason } = computeConfidence(alert, related);
  const domain = explainDomain(alert.source);
  const watchList = WHAT_TO_WATCH[domain] ?? GENERIC_WATCH;
  return {
    alertId: alert.id,
    headline: alert.title,
    whyItMatters: whyItMatters(alert, context),
    whatHappened: whatHappened(alert),
    confidence,
    confidenceReason: reason,
    whatToWatch: watchList.slice(0, 3),
    sources: [{
      title: alert.title,
      domain,
      timestamp: alert.timestamp,
    }],
    relatedAlerts: related.map((e) => e.id),
  };
}
