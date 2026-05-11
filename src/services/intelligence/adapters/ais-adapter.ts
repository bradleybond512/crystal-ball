import type { AisDisruptionEvent } from '@/types/index';
import type { AdsbTrack } from '@/services/adsb/adsb-aggregate';
import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

const AIS_SEVERITY_MAP: Record<AisDisruptionEvent['severity'], ObservationSeverity> = {
  high: 'HIGH',
  elevated: 'MEDIUM',
  low: 'LOW',
};

function trackSeverity(confidence: number): ObservationSeverity {
  if (confidence < 0.4) return 'HIGH';
  if (confidence < 0.6) return 'MEDIUM';
  return 'LOW';
}

export function aisDisruptionToObservation(event: AisDisruptionEvent): ObservationEvent {
  return {
    id: `ais-disruption-${event.id}`,
    sourceId: 'ais-relay',
    domain: 'maritime',
    timestamp: Date.now(),
    location: { lat: event.lat, lon: event.lon, radiusKm: 50 },
    severity: AIS_SEVERITY_MAP[event.severity],
    title: `AIS disruption — ${event.name} (${event.type.replace(/_/g, ' ')})`,
    raw: event,
    entityIds: event.region ? [event.region] : [],
    tags: [
      'ais',
      event.type,
      ...(event.darkShips != null && event.darkShips > 0 ? ['dark-ships'] : []),
    ],
  };
}

export function aisDisruptionsToObservations(events: AisDisruptionEvent[]): ObservationEvent[] {
  return events.map((e) => aisDisruptionToObservation(e));
}

/** Convert a merged ADS-B track to an observation.
 *  Only tracks with low confidence or degraded status are worth surfacing
 *  as intelligence events — healthy tracks are map data, not alerts. */
export function adsbTrackToObservation(track: AdsbTrack, now = Date.now()): ObservationEvent | null {
  if (track.confidence >= 0.8 && track.ageMs < 60_000) return null;

  const label = track.callsign ?? track.hex;
  return {
    id: `adsb-track-${track.hex}-${Math.floor(now / 60_000)}`,
    sourceId: 'adsb-aggregate',
    domain: 'aviation',
    timestamp: track.observedAt,
    location: { lat: track.lat, lon: track.lng },
    severity: trackSeverity(track.confidence),
    title: `Low-confidence ADS-B track: ${label} (conf ${(track.confidence * 100).toFixed(0)}%)`,
    raw: track,
    entityIds: track.callsign ? [track.callsign] : [track.hex],
    tags: ['adsb', 'track-uncertainty', ...(track.ageMs > 120_000 ? ['stale-track'] : [])],
  };
}

export function adsbTracksToObservations(tracks: AdsbTrack[], now = Date.now()): ObservationEvent[] {
  return tracks.flatMap((t) => {
    const obs = adsbTrackToObservation(t, now);
    return obs ? [obs] : [];
  });
}
