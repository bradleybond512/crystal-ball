import type { Earthquake } from '@/generated/client/crystalball/seismology/v1/service_client';
import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

function magnitudeToSeverity(mag: number): ObservationSeverity {
  if (mag >= 7) return 'CRITICAL';
  if (mag >= 6) return 'HIGH';
  if (mag >= 5) return 'MEDIUM';
  if (mag >= 4) return 'LOW';
  return 'INFO';
}

function magnitudeTags(mag: number): string[] {
  const tags = ['earthquake'];
  if (mag >= 7) tags.push('major-earthquake', 'tsunami-risk');
  else if (mag >= 6) tags.push('strong-earthquake');
  else if (mag >= 5) tags.push('moderate-earthquake');
  return tags;
}

export function earthquakeToObservation(eq: Earthquake): ObservationEvent {
  const lat = eq.location?.latitude;
  const lon = eq.location?.longitude;
  return {
    id: `usgs-eq-${eq.id}`,
    sourceId: 'usgs-earthquake',
    domain: 'weather',
    timestamp: eq.occurredAt,
    location:
      lat != null && lon != null
        ? { lat, lon, radiusKm: Math.max(5, eq.depthKm) }
        : undefined,
    severity: magnitudeToSeverity(eq.magnitude),
    title: `M${eq.magnitude.toFixed(1)} earthquake ${eq.place}`,
    raw: eq,
    entityIds: [],
    tags: magnitudeTags(eq.magnitude),
  };
}

export function earthquakesToObservations(earthquakes: Earthquake[]): ObservationEvent[] {
  return earthquakes.map((eq) => earthquakeToObservation(eq));
}
