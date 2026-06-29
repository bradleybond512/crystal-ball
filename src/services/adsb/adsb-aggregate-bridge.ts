/* eslint-disable unicorn/numeric-separators-style, unicorn/no-negated-condition -- unit-conversion constants + `!= null` null guards read clearer as-is */
// Bridges the sidecar's multi-provider /api/adsb-aggregate response into the
// renderer's confidence-aware aggregator (mergeAdsbProviders) and back into the
// AdsbSnapshot shape the AirTrafficPanel + map already consume. Pure transforms
// so they're unit-testable without a live fetch.

import {
  mergeAdsbProviders,
  type AdsbProviderSnapshot,
  type AdsbAircraftReport,
  type AdsbAggregate,
} from './adsb-aggregate';
import type { AdsbFlight, AdsbSnapshot } from '../adsb';

/** Provider ids the sidecar /api/adsb-aggregate queries — must match its `sources` keys. */
export const ADSB_PROVIDER_IDS = ['opensky', 'airplanesLive', 'adsbFi', 'adsbLol'] as const;

const FT_PER_M = 3.28084;
const KT_PER_MS = 1.94384;
const FTMIN_PER_MS = 196.85;

/** One merged aircraft from /api/adsb-aggregate (units: alt ft, speed kt, vsi ft/min). */
export interface AggregateAircraft {
  icao: string;
  callsign: string | null;
  country?: string | null;
  lat: number;
  lon: number;
  alt: number | null;
  speed: number | null;
  track: number | null;
  vsi: number | null;
  squawk: string | null;
  type: string | null;
  military: boolean | null;
  ts: number;
  sources: string[];
}

export interface AggregateResponse {
  aircraft: AggregateAircraft[];
  sources: Record<string, { ok: boolean; count: number; ms: number; error?: string }>;
  fetchedAt: number;
}

/** Rebuild per-provider snapshots from the sidecar's merged aircraft + their `sources`
 *  list, so mergeAdsbProviders can score per-aircraft confidence by provider count. */
export function reconstructProviderSnapshots(resp: AggregateResponse): AdsbProviderSnapshot[] {
  const snapshots: AdsbProviderSnapshot[] = [];
  for (const providerId of ADSB_PROVIDER_IDS) {
    const health = resp.sources?.[providerId];
    if (!health) continue; // provider wasn't queried (e.g. global query → opensky only)
    const aircraft: AdsbAircraftReport[] = [];
    for (const a of resp.aircraft) {
      if (!a.sources?.includes(providerId)) continue;
      aircraft.push({
        hex: a.icao,
        lat: a.lat,
        lng: a.lon,
        altitudeM: a.alt != null ? a.alt / FT_PER_M : undefined,
        groundSpeedMs: a.speed != null ? a.speed / KT_PER_MS : undefined,
        headingDeg: a.track ?? undefined,
        callsign: a.callsign ?? undefined,
        observedAt: a.ts,
      });
    }
    snapshots.push({ providerId, fetchedAt: resp.fetchedAt, aircraft, degraded: !health.ok });
  }
  return snapshots;
}

/** Build an AdsbSnapshot from the aggregate response + the merged confidence model.
 *  Flights keep their full fields (squawk/country) from the sidecar; each is annotated
 *  with the mergeAdsbProviders confidence + the providers that observed it. */
export function aggregateToSnapshot(resp: AggregateResponse, agg: AdsbAggregate): AdsbSnapshot {
  const trackByHex = new Map(agg.tracks.map((t) => [t.hex, t]));
  const flights: AdsbFlight[] = resp.aircraft.map((a) => {
    const track = trackByHex.get(a.icao);
    return {
      icao24: a.icao,
      callsign: a.callsign,
      originCountry: a.country ?? 'Unknown',
      lon: a.lon,
      lat: a.lat,
      altitude: a.alt != null ? a.alt / FT_PER_M : null, // ft → m (AdsbFlight contract)
      onGround: false,
      velocity: a.speed != null ? a.speed / KT_PER_MS : null, // kt → m/s
      heading: a.track ?? null,
      verticalRate: a.vsi != null ? a.vsi / FTMIN_PER_MS : null, // ft/min → m/s
      squawk: a.squawk,
      confidence: track?.confidence,
      providers: track?.providers ?? a.sources,
    };
  });
  return {
    flights,
    fetchedAt: resp.fetchedAt,
    totalCount: resp.aircraft.length,
    rateLimited: false,
    aggregate: {
      status: agg.status,
      reason: agg.reason,
      providerFreshness: agg.providerFreshness,
      tracks: agg.tracks,
    },
  };
}

/** Full transform: aggregate response → confidence-scored AdsbSnapshot. */
export function snapshotFromAggregateResponse(resp: AggregateResponse, generatedAt: number): AdsbSnapshot {
  const snapshots = reconstructProviderSnapshots(resp);
  const agg = mergeAdsbProviders(snapshots, { generatedAt });
  return aggregateToSnapshot(resp, agg);
}
