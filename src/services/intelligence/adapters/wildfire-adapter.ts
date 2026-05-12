import type { IncidentReport } from '@/services/inciweb';
import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

const SEVERITY_MAP: Record<IncidentReport['severity'], ObservationSeverity> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

function incidentTags(inc: IncidentReport): string[] {
  const tags = ['wildfire'];
  if (inc.evacuationOrders) tags.push('evacuation-order');
  if (inc.evacuationWarnings) tags.push('evacuation-warning');
  if (inc.incidentType === 'Complex') tags.push('fire-complex');
  if (inc.percentContained !== null && inc.percentContained < 10) tags.push('rapidly-spreading');
  return tags;
}

export function wildfireToObservation(inc: IncidentReport): ObservationEvent | null {
  if (inc.lat === null || inc.lon === null) return null;

  const acres = inc.acresBurned == null ? '' : ` — ${inc.acresBurned.toLocaleString()} acres`;
  const contained = inc.percentContained == null ? '' : `, ${inc.percentContained}% contained`;

  return {
    id: `inciweb-${inc.id}`,
    sourceId: 'inciweb',
    domain: 'weather',
    timestamp: inc.discoveryDate?.getTime() ?? inc.updatedAt.getTime(),
    location: { lat: inc.lat, lon: inc.lon, radiusKm: 10 },
    severity: SEVERITY_MAP[inc.severity],
    title: `${inc.name} Wildfire, ${inc.state}${acres}${contained}`,
    raw: inc,
    entityIds: [inc.state],
    tags: incidentTags(inc),
  };
}

export function wildifiresToObservations(incidents: IncidentReport[]): ObservationEvent[] {
  return incidents.flatMap((inc) => {
    const obs = wildfireToObservation(inc);
    return obs ? [obs] : [];
  });
}
