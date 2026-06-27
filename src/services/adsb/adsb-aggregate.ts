/**
 * ADS-B aggregator — gap #10 from
 * docs/ELITE_REMAINING_GAPS_FOR_CLAUDE.md.
 *
 * Pure deterministic merger over multiple ADS-B providers (OpenSky,
 * ADSBExchange, Wingbits, …). Produces a unified per-aircraft track
 * with provider attribution, freshness, and confidence — replacing
 * the "frontend logs to backend" gap.
 *
 * No fetch, no DOM. The host calls `mergeAdsbProviders(snapshots)`
 * with the latest snapshot from each provider and gets a single
 * `AdsbAggregate` ready for the map overlay.
 *
 * Plan invariants:
 *   - Position favors the freshest source for each aircraft
 *   - Confidence drops when only one provider sees an aircraft
 *   - Stale providers (>60s) contribute but are flagged
 *   - Output is JSON-serializable for the diagnostics export bundle
 */

// ── Public API ──────────────────────────────────────────────────────────

export interface AdsbAircraftReport {
  /** ICAO 24-bit hex address. Lower-case canonicalized. */
  hex: string;
  /** Latitude in decimal degrees. */
  lat: number;
  /** Longitude in decimal degrees. */
  lng: number;
  /** Altitude in meters. */
  altitudeM?: number;
  /** Ground speed in m/s. */
  groundSpeedMs?: number;
  /** Heading in degrees from true north. */
  headingDeg?: number;
  /** Optional callsign. */
  callsign?: string;
  /** ms timestamp of the most-recent observation. */
  observedAt: number;
}

export interface AdsbProviderSnapshot {
  providerId: string;
  /** ms timestamp the snapshot was taken. */
  fetchedAt: number;
  /** Aircraft this provider reports. */
  aircraft: readonly AdsbAircraftReport[];
  /** Optional weight 0..1 — high-trust providers (Wingbits) can be
   *  bumped above community ones (OpenSky). Default 1. */
  weight?: number;
  /** Whether this provider is degraded. Aircraft from a degraded
   *  provider still merge but their confidence is capped. */
  degraded?: boolean;
}

export interface AdsbTrack {
  hex: string;
  lat: number;
  lng: number;
  altitudeM?: number;
  groundSpeedMs?: number;
  headingDeg?: number;
  callsign?: string;
  /** Most-recent observedAt across the merged providers. */
  observedAt: number;
  /** 0..1 confidence the position is correct. */
  confidence: number;
  /** Provider ids that contributed to this track, in descending
   *  weight order. */
  providers: readonly string[];
  /** ms age at the time of aggregation. */
  ageMs: number;
}

export interface AdsbAggregate {
  generatedAt: number;
  tracks: readonly AdsbTrack[];
  /** Per-provider freshness summary the UI can render. */
  providerFreshness: readonly {
    providerId: string;
    fetchedAt: number;
    ageMs: number;
    aircraftCount: number;
    degraded: boolean;
  }[];
  /** Plain-English status: "healthy", "degraded — primary down",
   *  "all silent", etc. */
  status: 'healthy' | 'degraded' | 'silent';
  /** Free-text reason the UI can show in the degraded banner. */
  reason: string;
}

export interface MergeOptions {
  generatedAt?: number;
  /** ms past which a snapshot is considered stale. Default 60_000. */
  staleAfterMs?: number;
  /** ms past which a snapshot is considered silent. Default 300_000. */
  silentAfterMs?: number;
}

const DEFAULT_STALE_MS = 60_000;
const DEFAULT_SILENT_MS = 300_000;

// ── Engine ──────────────────────────────────────────────────────────────

export function mergeAdsbProviders(
  snapshots: readonly AdsbProviderSnapshot[],
  options: MergeOptions = {},
): AdsbAggregate {
  const generatedAt = options.generatedAt ?? Date.now();
  const staleMs = options.staleAfterMs ?? DEFAULT_STALE_MS;
  const silentMs = options.silentAfterMs ?? DEFAULT_SILENT_MS;

  const tracks = mergeTracks(snapshots, generatedAt);
  const providerFreshness = snapshots.map((s) => ({
    providerId: s.providerId,
    fetchedAt: s.fetchedAt,
    ageMs: generatedAt - s.fetchedAt,
    aircraftCount: s.aircraft.length,
    degraded: !!s.degraded || generatedAt - s.fetchedAt >= staleMs,
  }));
  const status = decideStatus(providerFreshness, generatedAt, silentMs);
  const reason = describeReason(providerFreshness, status, generatedAt, staleMs);

  return {
    generatedAt,
    tracks,
    providerFreshness,
    status,
    reason,
  };
}

function mergeTracks(
  snapshots: readonly AdsbProviderSnapshot[],
  generatedAt: number,
): AdsbTrack[] {
  // Group reports by hex, ordered by descending observedAt × weight
  // so the freshest, highest-trust report wins on position.
  const byHex = new Map<string, { snap: AdsbProviderSnapshot; report: AdsbAircraftReport }[]>();
  for (const snap of snapshots) {
    for (const report of snap.aircraft) {
      const key = canonicalHex(report.hex);
      const list = byHex.get(key) ?? [];
      list.push({ snap, report });
      byHex.set(key, list);
    }
  }

  const tracks: AdsbTrack[] = [];
  for (const [hex, contributions] of byHex) {
    contributions.sort((a, b) => {
      const aw = a.snap.weight ?? 1;
      const bw = b.snap.weight ?? 1;
      const aScore = a.report.observedAt * aw;
      const bScore = b.report.observedAt * bw;
      return bScore - aScore;
    });
    const top = contributions[0]!;
    const observedAt = Math.max(...contributions.map((c) => c.report.observedAt));
    const ageMs = Math.max(0, generatedAt - observedAt);
    tracks.push({
      hex,
      lat: top.report.lat,
      lng: top.report.lng,
      altitudeM: top.report.altitudeM,
      groundSpeedMs: top.report.groundSpeedMs,
      headingDeg: top.report.headingDeg,
      callsign: top.report.callsign ?? pickCallsign(contributions),
      observedAt,
      ageMs,
      confidence: confidenceFor(contributions, ageMs),
      providers: dedupeProviders(contributions),
    });
  }
  tracks.sort((a, b) => a.hex.localeCompare(b.hex));
  return tracks;
}

function pickCallsign(
  contributions: readonly { report: AdsbAircraftReport }[],
): string | undefined {
  for (const c of contributions) {
    if (c.report.callsign) return c.report.callsign;
  }
  return undefined;
}

function dedupeProviders(
  contributions: readonly { snap: AdsbProviderSnapshot }[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of contributions) {
    if (seen.has(c.snap.providerId)) continue;
    seen.add(c.snap.providerId);
    out.push(c.snap.providerId);
  }
  return out;
}

function confidenceFor(
  contributions: readonly { snap: AdsbProviderSnapshot }[],
  ageMs: number,
): number {
  const distinctProviders = new Set(contributions.map((c) => c.snap.providerId)).size;
  // Base confidence on provider count (1 → 0.55, 2 → 0.85, 3+ → 0.95).
  let confidence = baseConfidenceFor(distinctProviders);
  // Cap at 0.6 if every contributing provider is degraded.
  const allDegraded = contributions.every((c) => !!c.snap.degraded);
  if (allDegraded) confidence = Math.min(confidence, 0.6);
  // Linearly decay confidence after 60 s — fully gone (→0) by 5 min, honoring the
  // "stale data reduces confidence" invariant. (The previous 0.5 coefficient
  // floored a 5-min-plus-stale track at 50% of base forever, so a long-gone
  // aircraft kept a meaningful-looking confidence indefinitely.)
  if (ageMs > 60_000) {
    const decayWindow = 4 * 60_000; // 4 min after the 60 s grace period
    const t = Math.min(1, (ageMs - 60_000) / decayWindow);
    confidence *= 1 - t;
  }
  return Math.max(0, Math.min(1, confidence));
}

function baseConfidenceFor(distinctProviders: number): number {
  if (distinctProviders === 1) return 0.55;
  if (distinctProviders === 2) return 0.85;
  return 0.95;
}

function decideStatus(
  freshness: AdsbAggregate['providerFreshness'],
  generatedAt: number,
  silentMs: number,
): AdsbAggregate['status'] {
  if (freshness.length === 0) return 'silent';
  const allSilent = freshness.every((f) => generatedAt - f.fetchedAt >= silentMs);
  if (allSilent) return 'silent';
  const anyDegraded = freshness.some((f) => f.degraded);
  return anyDegraded ? 'degraded' : 'healthy';
}

function describeReason(
  freshness: AdsbAggregate['providerFreshness'],
  status: AdsbAggregate['status'],
  generatedAt: number,
  staleMs: number,
): string {
  if (status === 'silent') return 'No ADS-B providers reporting in the last window.';
  if (freshness.length === 0) return 'No providers configured.';
  const stale = freshness.filter((f) => generatedAt - f.fetchedAt >= staleMs);
  if (status === 'degraded') {
    if (stale.length > 0) {
      const ids = stale.map((f) => f.providerId).join(', ');
      return `Stale: ${ids}. Aggregate falling back to remaining providers.`;
    }
    const degradedIds = freshness.filter((f) => f.degraded).map((f) => f.providerId).join(', ');
    return `Degraded providers: ${degradedIds}.`;
  }
  return `${freshness.length} provider${freshness.length === 1 ? '' : 's'} healthy.`;
}

function canonicalHex(hex: string): string {
  return hex.trim().toLowerCase();
}
