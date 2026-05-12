/**
 * Evidence Graph UX — assemble a per-situation evidence report for the
 * EvidenceGraphPanel.
 *
 * Pure, deterministic, no DOM, no fetch. Input: one Situation + the
 * ObservationEvents the caller wants to grade against it. Output:
 *
 *   - confirming   — events in the situation footprint that support it
 *   - contradicting — events whose tags semantically oppose the situation
 *   - missing      — expected follow-on signals not yet observed
 *   - stale        — confirming inputs older than the domain refresh budget
 *   - confidenceBreakdown — spatial / temporal / entity / domain (0..25
 *     each, total 0..100)
 *   - lastVerified — timestamp of the most recent confirming signal
 *
 * Domain refresh budgets and missing-signal expectations live in static
 * tables below so the renderer + sidecar share the same answers.
 */

import type { ObservationEvent, Situation } from '@/types/intelligence';

// ── Public types ───────────────────────────────────────────────────────────

export interface EvidenceSource {
  sourceId: string;
  domain: string;
  title: string;
  timestamp: number;
  confidence: number;
}

export interface ContradictingEvidence {
  sourceId: string;
  domain: string;
  title: string;
  timestamp: number;
  reason: string;
}

export interface MissingSignal {
  domain: string;
  expectedSignal: string;
}

export interface StaleInput {
  sourceId: string;
  domain: string;
  title: string;
  ageMs: number;
}

export interface ConfidenceBreakdown {
  spatial: number;
  temporal: number;
  entity: number;
  domain: number;
  total: number;
}

export interface EvidenceReport {
  situationId: string;
  confirming: EvidenceSource[];
  contradicting: ContradictingEvidence[];
  missing: MissingSignal[];
  stale: StaleInput[];
  confidenceBreakdown: ConfidenceBreakdown;
  lastVerified: number;
}

export interface AssembleEvidenceInput {
  situation: Situation;
  events: readonly ObservationEvent[];
  /** Override the clock — defaults to Date.now(). */
  now?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const EARTH_KM = 6371;
const DEG2RAD = Math.PI / 180;
const DEFAULT_SITUATION_RADIUS_KM = 500;
const TEMPORAL_CONFIDENCE_WINDOW_MS = 60 * 60 * 1000;
const TEMPORAL_LOOKBACK_MS = 6 * 60 * 60 * 1000;

const SEVERITY_CONFIDENCE: Record<string, number> = {
  CRITICAL: 0.95, HIGH: 0.85, MEDIUM: 0.7, LOW: 0.55, INFO: 0.4,
};

const REFRESH_BUDGET_MS: Record<string, number> = {
  weather: 10 * 60 * 1000,
  earthquake: 5 * 60 * 1000,
  seismic: 5 * 60 * 1000,
  cyber: 30 * 60 * 1000,
  maritime: 15 * 60 * 1000,
  aviation: 15 * 60 * 1000,
  conflict: 60 * 60 * 1000,
  wildfire: 15 * 60 * 1000,
  space: 30 * 60 * 1000,
  health: 60 * 60 * 1000,
  economic: 60 * 60 * 1000,
};
const DEFAULT_REFRESH_BUDGET_MS = 30 * 60 * 1000;

const EXPECTED_SIGNALS: Record<string, readonly { sourceId: string; label: string }[]> = {
  earthquake: [
    { sourceId: 'usgs-shakemap', label: 'USGS ShakeMap report' },
    { sourceId: 'noaa-tsunami', label: 'NOAA tsunami advisory' },
  ],
  seismic: [
    { sourceId: 'usgs-shakemap', label: 'USGS ShakeMap report' },
    { sourceId: 'noaa-tsunami', label: 'NOAA tsunami advisory' },
  ],
  weather: [
    { sourceId: 'nws-alert', label: 'NWS polygon alert' },
    { sourceId: 'nws-radar', label: 'NEXRAD radar update' },
  ],
  cyber: [
    { sourceId: 'cisa-kev', label: 'CISA KEV / advisory' },
    { sourceId: 'cert', label: 'CERT bulletin' },
  ],
  maritime: [
    { sourceId: 'ais', label: 'AIS position update' },
    { sourceId: 'imo-incident', label: 'IMO incident report' },
  ],
  aviation: [
    { sourceId: 'adsb', label: 'ADS-B track' },
    { sourceId: 'notam', label: 'FAA NOTAM' },
  ],
  conflict: [
    { sourceId: 'acled', label: 'ACLED event' },
    { sourceId: 'unhcr-displacement', label: 'UNHCR displacement update' },
  ],
  wildfire: [
    { sourceId: 'firms', label: 'NASA FIRMS hotspot' },
    { sourceId: 'airnow', label: 'AirNow AQI update' },
  ],
  space: [
    { sourceId: 'noaa-swpc-kp', label: 'NOAA SWPC Kp index' },
    { sourceId: 'noaa-aurora', label: 'NOAA aurora forecast' },
  ],
};

/** Pairs of (left, right) tag fragments where one event tagged with the
 *  left fragment contradicts a situation/event tagged with the right one.
 *  Matching is case-insensitive substring on the full tag, so
 *  'tsunami-warning-canceled' contradicts 'tsunami-warning-issued'. */
const CONTRADICTION_PAIRS: readonly (readonly [string, string])[] = [
  ['canceled', 'issued'],
  ['cancelled', 'issued'],
  ['retracted', 'confirmed'],
  ['all-clear', 'warning'],
  ['lifted', 'ordered'],
  ['reopened', 'closed'],
  ['false-alarm', 'positive'],
  ['downgraded', 'upgraded'],
  ['resolved', 'active'],
];

// ── Helpers ────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function refreshBudgetFor(domain: string): number {
  return REFRESH_BUDGET_MS[domain] ?? DEFAULT_REFRESH_BUDGET_MS;
}

function eventInSituationFootprint(event: ObservationEvent, situation: Situation): boolean {
  if (!event.location || !situation.location) return true;
  const dist = haversineKm(
    event.location.lat, event.location.lon,
    situation.location.lat, situation.location.lon,
  );
  return dist <= (situation.location.radiusKm ?? DEFAULT_SITUATION_RADIUS_KM);
}

function severityToConfidence(severity: string): number {
  return SEVERITY_CONFIDENCE[severity] ?? 0.5;
}

function lowerSet(arr: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const t of arr) out.add(t.toLowerCase());
  return out;
}

function tagSetContains(set: Set<string>, fragment: string): boolean {
  for (const tag of set) {
    if (tag.includes(fragment)) return true;
  }
  return false;
}

function contradictionReason(eventTags: Set<string>, situationTags: Set<string>): string | null {
  for (const [left, right] of CONTRADICTION_PAIRS) {
    if (tagSetContains(eventTags, left) && tagSetContains(situationTags, right)) {
      return `event tagged "${left}" while situation is "${right}"`;
    }
    if (tagSetContains(eventTags, right) && tagSetContains(situationTags, left)) {
      return `event tagged "${right}" while situation is "${left}"`;
    }
  }
  return null;
}

// ── Confirming / contradicting partition ───────────────────────────────────

interface PartitionResult {
  confirming: ObservationEvent[];
  contradicting: { event: ObservationEvent; reason: string }[];
}

function partitionEvents(
  situation: Situation,
  events: readonly ObservationEvent[],
  now: number,
): PartitionResult {
  const obsIds = new Set(situation.observationIds);
  const situationTags = lowerSet(situation.tags);
  const confirming: ObservationEvent[] = [];
  const contradicting: { event: ObservationEvent; reason: string }[] = [];

  for (const event of events) {
    const eventTags = lowerSet(event.tags);
    const isLinked = obsIds.has(event.id);
    if (!isLinked) {
      if (event.domain !== situation.domain) {
        const reason = contradictionReason(eventTags, situationTags);
        if (reason) contradicting.push({ event, reason });
        continue;
      }
      if (now - event.timestamp > TEMPORAL_LOOKBACK_MS) continue;
      if (!eventInSituationFootprint(event, situation)) continue;
    }

    const reason = contradictionReason(eventTags, situationTags);
    if (reason) {
      contradicting.push({ event, reason });
      continue;
    }
    confirming.push(event);
  }

  return { confirming, contradicting };
}

// ── Missing / stale ────────────────────────────────────────────────────────

function detectMissing(
  situation: Situation,
  confirming: readonly ObservationEvent[],
): MissingSignal[] {
  const expected = EXPECTED_SIGNALS[situation.domain] ?? [];
  if (expected.length === 0) return [];

  const seenSourceIds = new Set<string>();
  const seenTagFragments = new Set<string>();
  for (const e of confirming) {
    seenSourceIds.add(e.sourceId);
    for (const t of e.tags) seenTagFragments.add(t.toLowerCase());
  }

  const out: MissingSignal[] = [];
  for (const sig of expected) {
    const seen = seenSourceIds.has(sig.sourceId)
      || tagSetContains(seenTagFragments, sig.sourceId);
    if (!seen) out.push({ domain: situation.domain, expectedSignal: sig.label });
  }
  return out;
}

function detectStale(
  confirming: readonly ObservationEvent[],
  now: number,
): StaleInput[] {
  const out: StaleInput[] = [];
  for (const e of confirming) {
    const ageMs = now - e.timestamp;
    if (ageMs > refreshBudgetFor(e.domain)) {
      out.push({
        sourceId: e.sourceId,
        domain: e.domain,
        title: e.title,
        ageMs,
      });
    }
  }
  return out;
}

// ── Confidence breakdown ───────────────────────────────────────────────────

function spatialScore(
  situation: Situation,
  confirming: readonly ObservationEvent[],
): number {
  if (confirming.length === 0 || !situation.location) return 0;
  const radius = situation.location.radiusKm > 0
    ? situation.location.radiusKm
    : DEFAULT_SITUATION_RADIUS_KM;
  let totalRatio = 0;
  let counted = 0;
  for (const e of confirming) {
    if (!e.location) continue;
    const dist = haversineKm(
      e.location.lat, e.location.lon,
      situation.location.lat, situation.location.lon,
    );
    totalRatio += Math.max(0, 1 - dist / radius);
    counted += 1;
  }
  if (counted === 0) return 0;
  return (totalRatio / counted) * 25;
}

function temporalScore(confirming: readonly ObservationEvent[], now: number): number {
  if (confirming.length === 0) return 0;
  let total = 0;
  for (const e of confirming) {
    const ageMs = Math.max(0, now - e.timestamp);
    total += Math.max(0, 1 - ageMs / TEMPORAL_CONFIDENCE_WINDOW_MS);
  }
  return (total / confirming.length) * 25;
}

function entityScore(confirming: readonly ObservationEvent[]): number {
  if (confirming.length < 2) return 0;
  const counts = new Map<string, number>();
  const universe = new Set<string>();
  for (const e of confirming) {
    for (const id of e.entityIds) {
      universe.add(id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  if (universe.size === 0) return 0;
  let shared = 0;
  for (const n of counts.values()) {
    if (n >= 2) shared += 1;
  }
  return (shared / universe.size) * 25;
}

function domainScore(confirming: readonly ObservationEvent[]): number {
  if (confirming.length === 0) return 0;
  const domains = new Set<string>();
  for (const e of confirming) domains.add(e.domain);
  const extra = Math.max(0, domains.size - 1);
  return Math.min(extra, 3) / 3 * 25;
}

function buildBreakdown(
  situation: Situation,
  confirming: readonly ObservationEvent[],
  now: number,
): ConfidenceBreakdown {
  const spatial = round2(spatialScore(situation, confirming));
  const temporal = round2(temporalScore(confirming, now));
  const entity = round2(entityScore(confirming));
  const domain = round2(domainScore(confirming));
  return { spatial, temporal, entity, domain, total: round2(spatial + temporal + entity + domain) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Entry point ────────────────────────────────────────────────────────────

export function assembleEvidence(input: AssembleEvidenceInput): EvidenceReport {
  const { situation, events } = input;
  const now = input.now ?? Date.now();
  const { confirming, contradicting } = partitionEvents(situation, events, now);

  const confirmingSorted = [...confirming].sort((a, b) => b.timestamp - a.timestamp);
  const lastVerified = confirmingSorted.length > 0
    ? confirmingSorted[0]!.timestamp
    : situation.startedAt;

  return {
    situationId: situation.id,
    confirming: confirmingSorted.map((e) => ({
      sourceId: e.sourceId,
      domain: e.domain,
      title: e.title,
      timestamp: e.timestamp,
      confidence: severityToConfidence(e.severity),
    })),
    contradicting: contradicting.map(({ event, reason }) => ({
      sourceId: event.sourceId,
      domain: event.domain,
      title: event.title,
      timestamp: event.timestamp,
      reason,
    })),
    missing: detectMissing(situation, confirming),
    stale: detectStale(confirming, now),
    confidenceBreakdown: buildBreakdown(situation, confirming, now),
    lastVerified,
  };
}

/** Static-table accessors exposed for the sidecar/panel so they can show
 *  the user what would have been expected even when the situation
 *  produced no missing rows (e.g. the domain has no expectations table). */
export function expectedSignalsForDomain(domain: string): readonly { sourceId: string; label: string }[] {
  return EXPECTED_SIGNALS[domain] ?? [];
}

export function refreshBudgetMsFor(domain: string): number {
  return refreshBudgetFor(domain);
}
