/**
 * Flood Gauge Observation Adapter (NOAA CO-OPS)
 *
 * Converts NOAA CO-OPS water level readings (from /api/flood-gauges/noaa-coops)
 * into ObservationEvent items for the intelligence layer. This gives the
 * algorithms a REDUNDANT flood source alongside USGS stream gauges:
 *
 *   USGS stream gauges → sourceId: 'usgs-water'  (inland rivers/streams)
 *   NOAA CO-OPS tides  → sourceId: 'noaa-coops'  (coastal/tidal stations)
 *
 * When both USGS and NOAA CO-OPS flag elevated water in the same area,
 * the intelligence layer gets multi-source corroboration — the truth-score
 * corroboration bonus lifts the combined signal from 0.3 to 0.75.
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

export interface NOAACoopsGauge {
  stationId: string;
  stationName: string;
  distanceKm: number;
  lat: number;
  lon: number;
  waterLevelFt: number | null;
  timestamp: string | null;
  flags: string | null;
}

export interface NOAACoopsResponse {
  gauges: NOAACoopsGauge[];
  fetchedAt?: number;
  source?: string;
}

// Action stage thresholds used by NWS (National Weather Service).
// These are approximate — NOAA issues stage levels per station, but for
// cross-source intelligence flagging we use conservative general thresholds.
// Positive values = above NAVD datum (already above mean sea level).
const FLOOD_THRESHOLDS_FT = {
  MODERATE: 5,  // ~1.5 m above NAVD — general moderate flood signal
  MINOR:    3,  // ~0.9 m above NAVD — worth monitoring
};

function floodSeverity(ft: number): ObservationSeverity | null {
  if (ft >= FLOOD_THRESHOLDS_FT.MODERATE) return 'HIGH';
  if (ft >= FLOOD_THRESHOLDS_FT.MINOR)    return 'MEDIUM';
  if (ft >= 1)                             return 'LOW'; // elevated but not yet concerning
  return null; // below threshold / negative values (normal tidal range)
}

/**
 * Convert NOAA CO-OPS gauge readings to intelligence observations.
 * Only generates observations when water levels are elevated (positive NAVD
 * levels above thresholds) — avoids noise from normal tidal cycles.
 */
export function floodGaugesToObservations(
  response: NOAACoopsResponse,
  placeLabel: string,
): ObservationEvent[] {
  const observations: ObservationEvent[] = [];
  const fetchedAt = response.fetchedAt ?? Date.now();

  for (const gauge of response.gauges) {
    if (gauge.waterLevelFt === null) continue;

    const sev = floodSeverity(gauge.waterLevelFt);
    if (!sev) continue;

    const timestamp = gauge.timestamp
      ? new Date(gauge.timestamp).getTime()
      : fetchedAt;

    observations.push({
      id: `noaa-coops-${gauge.stationId}-${Math.floor(fetchedAt / (30 * 60 * 1000))}`,
      sourceId: 'noaa-coops',
      domain: 'weather',
      timestamp: Number.isFinite(timestamp) ? timestamp : fetchedAt,
      location: { lat: gauge.lat, lon: gauge.lon, radiusKm: gauge.distanceKm },
      severity: sev,
      title: `Water level ${gauge.waterLevelFt.toFixed(1)} ft NAVD at ${gauge.stationName} (${gauge.distanceKm} km from ${placeLabel})`,
      raw: gauge,
      entityIds: [],
      tags: ['flood', 'water-level', 'noaa-coops'],
    });
  }

  return observations;
}
