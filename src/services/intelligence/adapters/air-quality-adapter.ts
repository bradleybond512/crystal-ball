import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

/**
 * Air-quality observation sample (from the AirNow forecast / EnviroFlash feed,
 * reduced to what the correlate stage needs). An adapter turns each into an
 * `ObservationEvent` so it can join spatial/temporal correlation — notably
 * "Unhealthy air near an active FIRMS fire = visual smoke confirmation".
 */
export interface AirQualitySample {
  /** Stable id (e.g. reportingArea+date or saved-place id). */
  id: string;
  lat: number;
  lon: number;
  /** Peak forecast/observed AQI, or null when not available. */
  aqi: number | null;
  /** Agency-declared Air Quality Action Day (the AirNow-unique signal). */
  actionDay: boolean;
  reportingArea: string;
  /** Dominant pollutant, e.g. "PM2.5" / "O3". */
  parameter?: string;
  /** Epoch ms the forecast/observation applies to. */
  at: number;
  source: 'airnow' | 'enviroflash-cap';
}

/** AQI → EPA category boundaries (Good/Moderate/USG/Unhealthy/VeryUnhealthy/Hazardous). */
function aqiSeverity(aqi: number | null, actionDay: boolean): ObservationSeverity {
  let sev: ObservationSeverity = 'INFO';
  if (aqi != null) {
    if (aqi >= 301) sev = 'CRITICAL';       // Hazardous
    else if (aqi >= 201) sev = 'CRITICAL';  // Very Unhealthy
    else if (aqi >= 151) sev = 'HIGH';      // Unhealthy
    else if (aqi >= 101) sev = 'MEDIUM';    // Unhealthy for Sensitive Groups
    else if (aqi >= 51) sev = 'LOW';        // Moderate
  }
  // An Action Day is an agency call that conditions warrant public action —
  // never rank it below HIGH even if the peak AQI is only forecast to USG.
  if (actionDay && (sev === 'INFO' || sev === 'LOW' || sev === 'MEDIUM')) sev = 'HIGH';
  return sev;
}

function aqiTags(sample: AirQualitySample): string[] {
  const tags = ['air-quality'];
  if (sample.actionDay) tags.push('action-day');
  const aqi = sample.aqi;
  if (aqi != null) {
    if (aqi >= 201) tags.push('aqi-very-unhealthy', 'aqi-unhealthy');
    else if (aqi >= 151) tags.push('aqi-unhealthy');
    else if (aqi >= 101) tags.push('aqi-usg');
  }
  // Smoke-relevance hint for the AirNow↔FIRMS correlation rule.
  if ((aqi != null && aqi >= 101) || sample.actionDay) tags.push('smoke-relevant');
  return tags;
}

function aqiTitle(sample: AirQualitySample): string {
  const where = sample.reportingArea || 'saved area';
  const aqiPart = sample.aqi == null ? '' : ` (AQI ${sample.aqi})`;
  if (sample.actionDay) return `Air Quality Action Day — ${where}${aqiPart}`;
  if (sample.aqi != null && sample.aqi >= 151) return `Unhealthy air quality — ${where}${aqiPart}`;
  if (sample.aqi != null && sample.aqi >= 101) return `Air quality unhealthy for sensitive groups — ${where}${aqiPart}`;
  return `Air quality — ${where}${aqiPart}`;
}

/** Map an AirQualitySample → ObservationEvent. Returns undefined when the sample
 *  has no usable coordinates (correlation is spatial) or is neither elevated nor
 *  an action day (INFO-level clean air is not worth correlating). */
export function airQualityToObservation(sample: AirQualitySample): ObservationEvent | undefined {
  if (!Number.isFinite(sample.lat) || !Number.isFinite(sample.lon)) return undefined;
  const severity = aqiSeverity(sample.aqi, sample.actionDay);
  // Only USG-or-worse (AQI ≥ 101) or an Action Day is worth correlating with
  // fires — Good/Moderate air is not "smoke confirmation".
  if (severity === 'INFO' || severity === 'LOW') return undefined;
  return {
    id: `airnow-aq-${sample.id}`,
    sourceId: 'airnow',
    domain: 'weather',
    timestamp: sample.at,
    location: { lat: sample.lat, lon: sample.lon, radiusKm: 40 },
    severity,
    title: aqiTitle(sample),
    raw: sample,
    entityIds: [],
    tags: aqiTags(sample),
  };
}

export function airQualityToObservations(samples: readonly AirQualitySample[]): ObservationEvent[] {
  return samples.map((s) => airQualityToObservation(s)).filter((o): o is ObservationEvent => o !== undefined);
}
