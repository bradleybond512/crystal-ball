/**
 * Forecast smoke field — the map's predictive "where will the smoke be"
 * layer. A square grid of sample points around the primary place, each with
 * an hourly US-AQI forecast, rendered by the Air & Smoke overlay's time
 * scrubber.
 *
 * Backbone is Open-Meteo's air-quality API (keyless, CAMS-based — assimilates
 * wildfire emissions), sampled as a point grid. A true gridded smoke model
 * (e.g. NOAA HRRR-Smoke MASSDEN decoded sidecar-side from NOMADS GRIB2) can
 * replace the sampler behind assembleForecastField without touching the map.
 *
 * Times are epoch milliseconds (fetched with timeformat=unixtime) so cells
 * align on absolute time — the grid can straddle timezone boundaries.
 * Pure module — no @/ imports, no fetch; fixture-tests under tsx.
 */

export interface ForecastFieldCell {
  lat: number;
  lon: number;
  /** Aligned to SmokeForecastField.hoursMs by index. */
  aqiByHour: (number | null)[];
}

export interface SmokeForecastField {
  /** Epoch ms per forecast hour, ascending, starting at/just before "now". */
  hoursMs: number[];
  cells: ForecastFieldCell[];
  generatedAt: number;
}

/** One grid point's parsed hourly forecast (absolute time). */
export interface GridPointAq {
  timesMs: number[];
  usAqi: (number | null)[];
}

const MI_PER_DEG_LAT = 69.09;
const HOUR_MS = 3_600_000;

/** Row-major size×size grid centered on (lat, lon), equirectangular offsets
 *  (same approximation as the cleaner-air compass — fine at ≤300 mi scale). */
export function forecastGridPoints(
  lat: number,
  lon: number,
  size = 7,
  spacingMi = 45,
): { lat: number; lon: number }[] {
  const out: { lat: number; lon: number }[] = [];
  const half = (size - 1) / 2;
  const latRad = (lat * Math.PI) / 180;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const dLat = ((half - row) * spacingMi) / MI_PER_DEG_LAT;
      const dLon = ((col - half) * spacingMi) / (MI_PER_DEG_LAT * Math.cos(latRad));
      out.push({ lat: lat + dLat, lon: lon + dLon });
    }
  }
  return out;
}

/**
 * Join grid points with their fetched forecasts into a render-ready field.
 * Leading hours before "now − 1 h" are trimmed so scrubber index 0 ≈ now.
 * Returns null when no cell carries any AQI value (fail-closed — an empty
 * field must not render as a uniformly "good" map).
 */
export function assembleForecastField(
  points: { lat: number; lon: number }[],
  parsed: (GridPointAq | null)[],
  now: number,
  horizonHours = 48,
): SmokeForecastField | null {
  const reference = parsed.find((p) => p !== null && p.timesMs.length > 0);
  if (!reference) return null;

  const start = reference.timesMs.findIndex((t) => t >= now - HOUR_MS);
  // Every hour is in the past ⇒ fail closed. Stamping the last historical hour
  // as "now" would render stale model output as a fresh forecast.
  if (start === -1) return null;
  const hoursMs = reference.timesMs.slice(start, start + horizonHours);
  if (hoursMs.length === 0) return null;

  let hasData = false;
  const cells: ForecastFieldCell[] = points.map((pt, i) => {
    const p = parsed[i];
    const aqiByHour = hoursMs.map((ms) => {
      if (!p) return null;
      // Cells share one request (identical params) so times align by index,
      // but look up by absolute time anyway — never trust array offsets.
      const idx = p.timesMs.indexOf(ms);
      const v = idx === -1 ? null : p.usAqi[idx] ?? null;
      if (v !== null) hasData = true;
      return v;
    });
    return { lat: pt.lat, lon: pt.lon, aqiByHour };
  });

  return hasData ? { hoursMs, cells, generatedAt: now } : null;
}
