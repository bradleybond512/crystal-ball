/**
 * AirNow forecast service — per-saved-place Action Day monitoring.
 *
 * Fetches /api/airnow/forecast (keyed AirNow primary, keyless EnviroFlash CAP
 * fallback — see the sidecar route) for each saved place, then:
 *   - feeds the Action-Day callout bridge (per-place native notifications), and
 *   - ingests an air-quality ObservationEvent into the correlate store so the
 *     AirNow↔FIRMS "visual smoke confirmation" rule can fire.
 */
import { getApiBaseUrl } from '@/services/runtime';
import { getSavedPlaces, type SavedPlace } from '@/services/saved-places';
import { ingest } from '@/services/intelligence/observation-store';
import { airQualityToObservations } from '@/services/intelligence/adapters/air-quality-adapter';
import type { AirQualitySample } from '@/services/intelligence/adapters/air-quality-adapter';
import { processActionDayInputs, type ActionDayInput } from './air-quality-callout-bridge';

interface AirnowForecastResponse {
  actionDay?: boolean;
  peakAqi?: number | null;
  reportingArea?: string;
  discussion?: string;
  source?: string;
}

const REFRESH_MS = 60 * 60 * 1000; // hourly — AirNow forecasts issue ~daily

/** Fetch one place's Action-Day status. Returns null on any failure (fail-soft). */
export async function fetchActionDayForPlace(place: SavedPlace): Promise<ActionDayInput | null> {
  try {
    const url = new URL(`${getApiBaseUrl()}/api/airnow/forecast`);
    url.searchParams.set('lat', String(place.lat));
    url.searchParams.set('lon', String(place.lon));
    const resp = await fetch(url.toString());
    if (!resp.ok) return null;
    const data = (await resp.json()) as AirnowForecastResponse;
    return {
      placeId: place.id,
      placeName: place.name,
      lat: place.lat,
      lon: place.lon,
      actionDay: data.actionDay === true,
      peakAqi: typeof data.peakAqi === 'number' ? data.peakAqi : null,
      headline: typeof data.discussion === 'string' && data.discussion.length > 0 ? data.discussion : undefined,
      reportingArea: typeof data.reportingArea === 'string' ? data.reportingArea : undefined,
      source: data.source === 'enviroflash-cap' ? 'enviroflash-cap' : 'airnow',
      at: Date.now(),
    };
  } catch {
    return null;
  }
}

/** An ActionDayInput is the same shape the observation adapter needs. */
function toSample(input: ActionDayInput): AirQualitySample {
  return {
    id: input.placeId,
    lat: input.lat,
    lon: input.lon,
    aqi: input.peakAqi,
    actionDay: input.actionDay,
    reportingArea: input.reportingArea ?? input.placeName,
    at: input.at,
    source: input.source,
  };
}

/** Refresh Action-Day status across every saved place, feed notifications +
 *  the correlate store. Safe to call repeatedly. */
export async function refreshAirQualityActionDays(): Promise<void> {
  const places = getSavedPlaces();
  if (places.length === 0) return;
  const results = await Promise.all(places.map((p) => fetchActionDayForPlace(p)));
  const inputs = results.filter((i): i is ActionDayInput => i !== null);
  if (inputs.length === 0) return;
  processActionDayInputs(inputs);
  ingest(airQualityToObservations(inputs.map((i) => toSample(i))));
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Boot wiring — refresh once, then hourly. */
export function startAirQualityActionDayMonitor(): void {
  if (timer) return;
  void refreshAirQualityActionDays();
  timer = setInterval(() => { void refreshAirQualityActionDays(); }, REFRESH_MS);
  if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref?: () => void }).unref?.();
  }
}

export function stopAirQualityActionDayMonitor(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
