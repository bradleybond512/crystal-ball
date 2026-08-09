/**
 * ECCC FireWork (RAQDPS-FW) — predictive wildfire-smoke surface PM2.5
 *
 * Source: MSC GeoMet WMS (https://geo.weather.gc.ca/geomet). Keyless, CORS *.
 * `RAQDPS.Sfc_PM2.5-WildfireSmokePlume` is the FireWork product: hourly
 * surface PM2.5 attributable to wildfire plumes, out to 72 h, North America
 * at 10 km, two model runs/day (00Z/12Z).
 *
 * GetMap is consumed as a MapLibre raster source via the {bbox-epsg-3857}
 * template (same pattern as the RainViewer/GIBS rasters in
 * syncWeatherRasterLayers). Available TIME steps come from a layer-filtered
 * GetCapabilities (~20 KB) whose <Dimension name="time"> is an ISO-8601
 * start/end/period interval.
 *
 * GeoMet answers HEAD requests with HTTP 500 — probe with GET only.
 */

import { dataFreshness } from '@/services/data-freshness';

export interface SmokeForecastState {
  /** Available hourly frames as epoch ms, ascending. */
  frames: number[];
  fetchedAt: number;
}

export const FIREWORK_WMS_BASE = 'https://geo.weather.gc.ca/geomet';
export const FIREWORK_LAYER = 'RAQDPS.Sfc_PM2.5-WildfireSmokePlume';

const CAPS_URL = `${FIREWORK_WMS_BASE}?lang=en&service=WMS&version=1.3.0&request=GetCapabilities&LAYER=${FIREWORK_LAYER}`;
const CACHE_TTL_MS = 30 * 60 * 1000;
const HOUR_MS = 3_600_000;

let cache: SmokeForecastState | null = null;

/** Raw time-dimension content from a GetCapabilities document, e.g.
 *  "2026-07-29T00:00:00Z/2026-08-01T00:00:00Z/PT1H". Matches name="time"
 *  exactly — name="reference_time" cannot false-match the pattern. */
export function extractTimeDimension(xml: string): string | null {
  const m = /<Dimension[^>]*name="time"[^>]*>([^<]+)<\/Dimension>/.exec(xml);
  return m?.[1]?.trim() ?? null;
}

/** Expand an ISO-8601 start/end/PTnH interval (or a bare timestamp) into
 *  epoch-ms frames. Malformed or non-hourly input yields []. Capped at 768
 *  frames (32 days hourly) so a bad range can't allocate unbounded. */
export function parseTimeDimension(dimension: string): number[] {
  const parts = dimension.split('/');
  if (parts.length === 1) {
    const t = Date.parse(parts[0]!);
    return Number.isFinite(t) ? [t] : [];
  }
  if (parts.length !== 3) return [];
  const start = Date.parse(parts[0]!);
  const end = Date.parse(parts[1]!);
  const period = /^PT(\d+)H$/.exec((parts[2]!));
  const stepMs = period ? Number(period[1]) * HOUR_MS : 0;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || stepMs <= 0) return [];
  const frames: number[] = [];
  for (let t = start; t <= end && frames.length < 768; t += stepMs) frames.push(t);
  return frames;
}

export async function fetchSmokeForecastFrames(): Promise<SmokeForecastState> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  try {
    const res = await fetch(CAPS_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`GeoMet HTTP ${String(res.status)}`);
    const dimension = extractTimeDimension(await res.text());
    const frames = dimension ? parseTimeDimension(dimension) : [];
    if (frames.length === 0) throw new Error('GeoMet capabilities missing time dimension');
    cache = { frames, fetchedAt: Date.now() };
    dataFreshness.recordUpdate('firework-smoke', frames.length);
    return cache;
  } catch (error) {
    dataFreshness.recordError('firework-smoke', String(error));
    throw error;
  }
}

/** Frames from the hour containing `nowMs` onward — the scrubber's hour 0
 *  must be "now", not the model-run start (which is up to 12 h in the past). */
export function smokeForecastHoursFromNow(state: SmokeForecastState, nowMs = Date.now()): number[] {
  const floorHour = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  return state.frames.filter((t) => t >= floorHour);
}

function isoHour(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * MapLibre raster-tile GetMap template. With a target time, TIME pins to the
 * nearest available frame; with no state/target, TIME is omitted and GeoMet
 * serves its default (nearest current hour) — the layer stays functional
 * when the capabilities fetch fails (fail-open display, freshness records
 * the error separately).
 */
export function getSmokeForecastTileUrl(state: SmokeForecastState | null, targetMs?: number): string {
  const base = `${FIREWORK_WMS_BASE}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap`
    + '&BBOX={bbox-epsg-3857}&CRS=EPSG:3857&WIDTH=256&HEIGHT=256'
    + `&LAYERS=${FIREWORK_LAYER}&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE`;
  if (!state || state.frames.length === 0 || targetMs === undefined) return base;
  let nearest = state.frames[0]!;
  for (const t of state.frames) {
    if (Math.abs(t - targetMs) < Math.abs(nearest - targetMs)) nearest = t;
  }
  return `${base}&TIME=${isoHour(nearest)}`;
}
