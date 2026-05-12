/**
 * Alert Explainer — intelligence Explain stage.
 *
 * Converts an ObservationEvent + optional correlations into a structured
 * AlertExplanation with human-readable headline, why-this-matters text,
 * context, related events, confidence tier, and source attribution.
 *
 * Domain templates follow the plan spec:
 *   earthquake, wildfire, aviation, weather, maritime (AIS), generic
 *
 * Pure deterministic — no DOM, no fetch, no runtime config. Every output
 * can be reproduced from static fixtures for testing.
 */

// ── Types ─────────────────────────────────────────────────────────────────

/** Domain hint that selects the right explanation template. */
export type ExplainDomain =
  | 'earthquake'
  | 'wildfire'
  | 'aviation'
  | 'weather'
  | 'maritime'
  | 'generic';

/**
 * Domain-specific observation event fed to the explainer.
 * All domain-specific fields are optional; the template falls back gracefully
 * to the generic template when the relevant fields are missing.
 */
export interface ObservationEvent {
  id: string;
  domain: ExplainDomain;
  title: string;
  severity: 'info' | 'low' | 'moderate' | 'high' | 'critical';
  /** Display names of the data providers that observed this event. */
  sources: string[];
  occurredAt?: number;
  location?: string;
  lat?: number;
  lon?: number;

  // ── Earthquake ──────────────────────────────────────────────────────────
  magnitude?: number;
  depth?: number;
  nearestCity?: string;
  nearestCityDistKm?: number;

  // ── Wildfire ────────────────────────────────────────────────────────────
  fireName?: string;
  acres?: number;
  containmentPct?: number;
  fireBehavior?: string;
  windSpeedMph?: number;

  // ── Aviation ────────────────────────────────────────────────────────────
  callsign?: string;
  aircraftType?: string;
  squawkCode?: string;

  // ── Weather ─────────────────────────────────────────────────────────────
  eventType?: string;
  area?: string;
  expiresAt?: number;
  conditions?: string;

  // ── Maritime (AIS) ──────────────────────────────────────────────────────
  vesselName?: string;
  vesselType?: string;
  flag?: string;
  behavior?: string;
  maritimeContext?: string;
}

/**
 * A correlated event that adds context to the primary observation.
 * Typically the output of the situation clustering / evidence graph stages.
 */
export interface Correlation {
  id: string;
  title: string;
  domain: string;
  relevanceScore?: number;
}

/** Structured human-readable explanation for a single alert. */
export interface AlertExplanation {
  /** One-line summary suitable for notification titles. */
  headline: string;
  /** 1-3 sentence explanation of why this alert matters right now. */
  why: string;
  /** Background context: what domain, what patterns, what history. */
  context: string;
  /** Titles of correlated or related events (may be empty). */
  relatedEvents: string[];
  /** Aggregate confidence tier derived from severity + source count. */
  confidence: 'high' | 'medium' | 'low';
  /** Data provider display names. */
  sources: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────

function scoreSeverity(s: ObservationEvent['severity']): number {
  return { info: 0, low: 1, moderate: 2, high: 3, critical: 4 }[s] ?? 0;
}

function computeConfidence(event: ObservationEvent): AlertExplanation['confidence'] {
  const sev = scoreSeverity(event.severity);
  const srcs = event.sources.length;
  if (sev >= 3 && srcs >= 2) return 'high';
  if (sev >= 2 || (sev >= 3 && srcs === 1)) return 'medium';
  return 'low';
}

const SQUAWK_MEANINGS: Record<string, string> = {
  '7500': 'hijacking',
  '7600': 'radio failure',
  '7700': 'general emergency',
};

function squawkMeaning(code?: string): string {
  if (!code) return 'transponder code';
  return SQUAWK_MEANINGS[code] ?? 'transponder code';
}

function shakingDescription(mag?: number): string {
  if (mag === undefined) return 'Shaking intensity unknown.';
  if (mag < 4) return 'Minor shaking expected; felt but little damage likely.';
  if (mag < 5) return 'Moderate shaking; minor damage to poorly built structures possible.';
  if (mag < 6) return 'Strong shaking; structural damage possible near the epicenter.';
  if (mag < 7) return 'Major shaking; serious damage over a wide area likely.';
  return 'Great shaking; catastrophic damage possible.';
}

function formatExpiry(ms?: number): string {
  if (!ms) return 'an unspecified time';
  return new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}

function cap(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ── Domain templates ──────────────────────────────────────────────────────

function explainEarthquake(e: ObservationEvent): Pick<AlertExplanation, 'why' | 'context'> {
  const mag = e.magnitude === undefined ? 'Unknown-magnitude' : `M${e.magnitude.toFixed(1)}`;
  const loc = e.location ?? 'an unknown location';
  const depthStr = e.depth === undefined ? '' : ` at ${e.depth}km depth`;
  const distSuffix = e.nearestCityDistKm === undefined ? '' : ` (${Math.round(e.nearestCityDistKm)}km away)`;
  const cityStr = e.nearestCity
    ? ` Nearest population center: ${e.nearestCity}${distSuffix}.`
    : '';

  const why = `${mag} earthquake struck ${loc}${depthStr}. ${shakingDescription(e.magnitude)}${cityStr}`;
  const context = `Seismic events of this magnitude can trigger secondary hazards including tsunamis (for offshore events), aftershock sequences, and infrastructure disruption. Monitor official seismological agencies for updates.`;
  return { why, context };
}

function explainWildfire(e: ObservationEvent): Pick<AlertExplanation, 'why' | 'context'> {
  const name = e.fireName ?? e.title;
  const acresStr = e.acres === undefined ? 'unknown acreage' : `${e.acres.toLocaleString()} acres`;
  const containStr = e.containmentPct === undefined ? 'containment unknown' : `${e.containmentPct}% contained`;
  const behaviorStr = e.fireBehavior ? `${e.fireBehavior} spread` : 'active spread';
  const windStr = e.windSpeedMph === undefined ? '' : ` under ${e.windSpeedMph}mph winds`;

  const why = `${name} fire is ${acresStr}, ${containStr}, with ${behaviorStr}${windStr}.`;
  const context = `Fire behavior can change rapidly with wind shifts and humidity drops. Low containment with active spread indicates increased risk to nearby communities and infrastructure.`;
  return { why, context };
}

function explainAviation(e: ObservationEvent): Pick<AlertExplanation, 'why' | 'context'> {
  const callsign = e.callsign ?? 'Unknown';
  const typeStr = e.aircraftType ? ` (${e.aircraftType})` : '';
  const code = e.squawkCode ?? 'unknown';
  const meaning = squawkMeaning(e.squawkCode);
  const loc = e.location ? ` over ${e.location}` : '';

  const why = `Aircraft ${callsign}${typeStr} squawking ${code} (${meaning})${loc}.`;
  const context = `Squawk codes signal aircraft status to air traffic control. Emergency codes (7500/7600/7700) indicate situations requiring immediate ATC attention and possible airspace coordination.`;
  return { why, context };
}

function explainWeather(e: ObservationEvent): Pick<AlertExplanation, 'why' | 'context'> {
  const sev = e.severity.charAt(0).toUpperCase() + e.severity.slice(1);
  const evtType = e.eventType ?? 'Weather';
  const area = e.area ?? e.location ?? 'the affected area';
  const expires = formatExpiry(e.expiresAt);
  const cond = e.conditions ? ` Expected: ${e.conditions}.` : '';

  const why = `${sev} ${evtType} warning for ${area} until ${expires}.${cond}`;
  const context = `Official warnings indicate conditions have met thresholds for significant hazard. Follow local emergency management guidance and monitor National Weather Service updates.`;
  return { why, context };
}

function explainMaritime(e: ObservationEvent): Pick<AlertExplanation, 'why' | 'context'> {
  const name = e.vesselName ?? 'Unknown vessel';
  const typeStr = e.vesselType ? ` (${e.vesselType}` : '';
  const flagSep = e.vesselType ? ', ' : ' (';
  const noFlagClose = e.vesselType ? ')' : '';
  const flagStr = e.flag ? `${flagSep}${e.flag})` : noFlagClose;
  const behaviorStr = e.behavior ?? 'exhibiting anomalous behavior';
  const loc = e.location ? ` near ${e.location}` : '';
  const ctx = e.maritimeContext ? ` ${e.maritimeContext}` : '';

  const why = `Vessel ${name}${typeStr}${flagStr} ${behaviorStr}${loc}.${ctx}`;
  const context = `AIS tracking anomalies — including dark gaps, unexpected course changes, and spoofed positions — can indicate illicit activity, distress, or sanctions evasion. Cross-reference with port state control databases.`;
  return { why, context };
}

function explainGeneric(e: ObservationEvent): Pick<AlertExplanation, 'why' | 'context'> {
  const sev = e.severity.charAt(0).toUpperCase() + e.severity.slice(1);
  const loc = e.location ? ` in ${e.location}` : '';
  const why = `${sev}-severity ${e.domain} event: ${e.title}${loc}.`;
  const context = `Monitor primary data sources for updates. Cross-reference with related domain feeds for a fuller situational picture.`;
  return { why, context };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Generate a structured human-readable explanation for an observed event.
 *
 * @param event  The normalized observation event.
 * @param correlations  Optional related events discovered by the clustering
 *   or evidence-graph stages. Each appends to `relatedEvents`.
 */
export function explain(
  event: ObservationEvent,
  correlations: Correlation[] = [],
): AlertExplanation {
  let parts: Pick<AlertExplanation, 'why' | 'context'>;

  switch (event.domain) {
    case 'earthquake': { parts = explainEarthquake(event); break;
    }
    case 'wildfire': {   parts = explainWildfire(event);   break;
    }
    case 'aviation': {   parts = explainAviation(event);   break;
    }
    case 'weather': {    parts = explainWeather(event);    break;
    }
    case 'maritime': {   parts = explainMaritime(event);   break;
    }
    default: {           parts = explainGeneric(event);    break;
    }
  }

  const sortedCorrelations = [...correlations].sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
  const relatedEvents = sortedCorrelations.map((c) => c.title);

  return {
    headline: cap(event.title, 120),
    why: parts.why,
    context: parts.context,
    relatedEvents,
    confidence: computeConfidence(event),
    sources: [...new Set(event.sources)],
  };
}
