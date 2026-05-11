#!/usr/bin/env node
/**
 * Alert Explainer — intelligence Explain stage (sidecar JS port).
 *
 * JS port of src/services/intelligence/explainer.ts for use in the Node.js
 * sidecar. The TypeScript original is the canonical source; this file must
 * stay in sync with it.
 *
 * Exported for direct unit testing.
 */

// ── Helpers ───────────────────────────────────────────────────────────────

function scoreSeverity(s) {
  return ({ info: 0, low: 1, moderate: 2, high: 3, critical: 4 })[s] ?? 0;
}

function computeConfidence(event) {
  const sev = scoreSeverity(event.severity);
  const srcs = (event.sources ?? []).length;
  if (sev >= 3 && srcs >= 2) return 'high';
  if (sev >= 2 || (sev >= 3 && srcs === 1)) return 'medium';
  return 'low';
}

const SQUAWK_MEANINGS = {
  '7500': 'hijacking',
  '7600': 'radio failure',
  '7700': 'general emergency',
};

function squawkMeaning(code) {
  if (!code) return 'transponder code';
  return SQUAWK_MEANINGS[code] ?? 'transponder code';
}

function shakingDescription(mag) {
  if (mag === undefined || mag === null) return 'Shaking intensity unknown.';
  if (mag < 4) return 'Minor shaking expected; felt but little damage likely.';
  if (mag < 5) return 'Moderate shaking; minor damage to poorly built structures possible.';
  if (mag < 6) return 'Strong shaking; structural damage possible near the epicenter.';
  if (mag < 7) return 'Major shaking; serious damage over a wide area likely.';
  return 'Great shaking; catastrophic damage possible.';
}

function formatExpiry(ms) {
  if (!ms) return 'an unspecified time';
  return new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}

function cap(s, max) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ── Domain templates ──────────────────────────────────────────────────────

function explainEarthquake(e) {
  const mag = e.magnitude === undefined ? 'Unknown-magnitude' : `M${Number(e.magnitude).toFixed(1)}`;
  const loc = e.location ?? 'an unknown location';
  const depthStr = e.depth === undefined ? '' : ` at ${e.depth}km depth`;
  const distSuffix = e.nearestCityDistKm === undefined ? '' : ` (${Math.round(e.nearestCityDistKm)}km away)`;
  const cityStr = e.nearestCity
    ? ` Nearest population center: ${e.nearestCity}${distSuffix}.`
    : '';
  return {
    why: `${mag} earthquake struck ${loc}${depthStr}. ${shakingDescription(e.magnitude)}${cityStr}`,
    context: 'Seismic events of this magnitude can trigger secondary hazards including tsunamis (for offshore events), aftershock sequences, and infrastructure disruption. Monitor official seismological agencies for updates.',
  };
}

function explainWildfire(e) {
  const name = e.fireName ?? e.title;
  const acresStr = e.acres === undefined ? 'unknown acreage' : `${Number(e.acres).toLocaleString('en-US')} acres`;
  const containStr = e.containmentPct === undefined ? 'containment unknown' : `${e.containmentPct}% contained`;
  const behaviorStr = e.fireBehavior ? `${e.fireBehavior} spread` : 'active spread';
  const windStr = e.windSpeedMph === undefined ? '' : ` under ${e.windSpeedMph}mph winds`;
  return {
    why: `${name} fire is ${acresStr}, ${containStr}, with ${behaviorStr}${windStr}.`,
    context: 'Fire behavior can change rapidly with wind shifts and humidity drops. Low containment with active spread indicates increased risk to nearby communities and infrastructure.',
  };
}

function explainAviation(e) {
  const callsign = e.callsign ?? 'Unknown';
  const typeStr = e.aircraftType ? ` (${e.aircraftType})` : '';
  const code = e.squawkCode ?? 'unknown';
  const meaning = squawkMeaning(e.squawkCode);
  const loc = e.location ? ` over ${e.location}` : '';
  return {
    why: `Aircraft ${callsign}${typeStr} squawking ${code} (${meaning})${loc}.`,
    context: 'Squawk codes signal aircraft status to air traffic control. Emergency codes (7500/7600/7700) indicate situations requiring immediate ATC attention and possible airspace coordination.',
  };
}

function explainWeather(e) {
  const sev = e.severity ? e.severity.charAt(0).toUpperCase() + e.severity.slice(1) : 'Unknown';
  const evtType = e.eventType ?? 'Weather';
  const area = e.area ?? e.location ?? 'the affected area';
  const expires = formatExpiry(e.expiresAt);
  const cond = e.conditions ? ` Expected: ${e.conditions}.` : '';
  return {
    why: `${sev} ${evtType} warning for ${area} until ${expires}.${cond}`,
    context: 'Official warnings indicate conditions have met thresholds for significant hazard. Follow local emergency management guidance and monitor National Weather Service updates.',
  };
}

function explainMaritime(e) {
  const name = e.vesselName ?? 'Unknown vessel';
  const typeStr = e.vesselType ? ` (${e.vesselType}` : '';
  const flagSep = e.vesselType ? ', ' : ' (';
  const noFlagClose = e.vesselType ? ')' : '';
  const flagStr = e.flag ? `${flagSep}${e.flag})` : noFlagClose;
  const behaviorStr = e.behavior ?? 'exhibiting anomalous behavior';
  const loc = e.location ? ` near ${e.location}` : '';
  const ctx = e.maritimeContext ? ` ${e.maritimeContext}` : '';
  return {
    why: `Vessel ${name}${typeStr}${flagStr} ${behaviorStr}${loc}.${ctx}`,
    context: 'AIS tracking anomalies — including dark gaps, unexpected course changes, and spoofed positions — can indicate illicit activity, distress, or sanctions evasion. Cross-reference with port state control databases.',
  };
}

function explainGeneric(e) {
  const sev = e.severity ? e.severity.charAt(0).toUpperCase() + e.severity.slice(1) : 'Unknown';
  const loc = e.location ? ` in ${e.location}` : '';
  return {
    why: `${sev}-severity ${e.domain} event: ${e.title}${loc}.`,
    context: 'Monitor primary data sources for updates. Cross-reference with related domain feeds for a fuller situational picture.',
  };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Generate a structured human-readable explanation for an observed event.
 * @param {object} event  ObservationEvent
 * @param {Array}  correlations  Optional related events
 * @returns {object}  AlertExplanation
 */
export function explain(event, correlations = []) {
  let parts;
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

  const relatedEvents = [...correlations]
    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
    .map((c) => c.title);

  return {
    headline: cap(event.title, 120),
    why: parts.why,
    context: parts.context,
    relatedEvents,
    confidence: computeConfidence(event),
    sources: [...new Set(event.sources)],
  };
}
