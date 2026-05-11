import type { AviationNotam, AviationSigmet } from '@/services/aviation/aviation-intel-types';
import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

const SIGMET_SEVERITY_MAP: Record<AviationSigmet['severity'], ObservationSeverity> = {
  extreme: 'CRITICAL',
  severe: 'HIGH',
  moderate: 'MEDIUM',
  light: 'LOW',
};

function sigmetCentroid(sigmet: AviationSigmet): { lat: number; lon: number } | undefined {
  if (sigmet.polygon.length === 0) return undefined;
  const lat = sigmet.polygon.reduce((s, p) => s + p.lat, 0) / sigmet.polygon.length;
  const lon = sigmet.polygon.reduce((s, p) => s + p.lon, 0) / sigmet.polygon.length;
  return { lat, lon };
}

function tfrSeverity(presidential: boolean): ObservationSeverity {
  return presidential ? 'HIGH' : 'MEDIUM';
}

function notamTitle(notam: AviationNotam): string {
  const suffix = notam.featureName ? ` — ${notam.featureName}` : '';
  return `NOTAM ${notam.notamNumber}${suffix}`;
}

function sigmetTitle(kind: string, hazard: string, severity: string): string {
  const hazardLabel = hazard.replace(/_/g, ' ');
  return `${kind} — ${hazardLabel} (${severity})`;
}

export function notamToObservation(notam: AviationNotam): ObservationEvent {
  const isTfr = notam.classification === 'TFR';
  return {
    id: `notam-${notam.id}`,
    sourceId: 'faa-notam',
    domain: 'aviation',
    timestamp: notam.effectiveStart ?? Date.now(),
    location: notam.center
      ? { lat: notam.center.lat, lon: notam.center.lon, radiusKm: notam.center.radiusNm * 1.852 }
      : undefined,
    severity: isTfr ? tfrSeverity(notam.presidential) : 'INFO',
    title: notamTitle(notam),
    raw: notam,
    entityIds: notam.icaoId ? [notam.icaoId] : [],
    tags: [
      'notam',
      notam.classification.toLowerCase(),
      ...(isTfr ? ['tfr'] : []),
      ...(notam.presidential ? ['presidential'] : []),
    ],
  };
}

export function sigmetToObservation(sigmet: AviationSigmet): ObservationEvent {
  const centroid = sigmetCentroid(sigmet);
  const kind = sigmet.isAirmet ? 'AIRMET' : 'SIGMET';
  return {
    id: `sigmet-${sigmet.id}`,
    sourceId: 'nws-aviation',
    domain: 'aviation',
    timestamp: sigmet.validFrom,
    location: centroid,
    severity: SIGMET_SEVERITY_MAP[sigmet.severity],
    title: sigmetTitle(kind, sigmet.hazard, sigmet.severity),
    raw: sigmet,
    entityIds: [],
    tags: ['aviation-hazard', sigmet.hazard, sigmet.isAirmet ? 'airmet' : 'sigmet'],
  };
}

export function notamsToObservations(notams: AviationNotam[]): ObservationEvent[] {
  return notams.map((n) => notamToObservation(n));
}

export function sigmetsToObservations(sigmets: AviationSigmet[]): ObservationEvent[] {
  return sigmets.map((s) => sigmetToObservation(s));
}
