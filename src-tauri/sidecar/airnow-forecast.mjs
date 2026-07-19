/**
 * AirNow forecast normalizer.
 *
 * The AirNow `aq/forecast/*` endpoints return an array of per-day, per-pollutant
 * forecast rows. This maps that raw shape into the compact contract the renderer
 * consumes, and — crucially — surfaces the `ActionDay` flag (the agency-declared
 * Air Quality Action Day) which is the non-overlapping signal AirNow provides
 * over measured-AQI feeds like Open-Meteo. Pure + deterministic.
 *
 * @typedef {Object} AirnowForecastRow
 * @property {string} dateForecast    "YYYY-MM-DD".
 * @property {string} parameter       e.g. "PM2.5", "O3".
 * @property {number|null} aqi        Forecast AQI (null when AirNow returns -1 / absent).
 * @property {number|null} categoryNumber  1–6 (Good…Hazardous).
 * @property {string} categoryName
 * @property {boolean} actionDay
 * @property {string} reportingArea
 * @property {string} stateCode
 */

/** Map a single raw AirNow forecast row → AirnowForecastRow (or null if unusable). */
export function normalizeForecastRow(row) {
  if (!row || typeof row !== 'object') return null;
  const dateForecast = typeof row.DateForecast === 'string' ? row.DateForecast.trim() : '';
  const parameter = typeof row.ParameterName === 'string' ? row.ParameterName : '';
  // AirNow uses AQI = -1 when a pollutant isn't forecast for that day.
  const rawAqi = Number(row.AQI);
  const aqi = Number.isFinite(rawAqi) && rawAqi >= 0 ? rawAqi : null;
  const cat = row.Category && typeof row.Category === 'object' ? row.Category : {};
  const categoryNumber = Number.isFinite(Number(cat.Number)) && Number(cat.Number) > 0 ? Number(cat.Number) : null;
  if (!dateForecast && !parameter && aqi === null) return null;
  return {
    dateForecast,
    parameter,
    aqi,
    categoryNumber,
    categoryName: typeof cat.Name === 'string' ? cat.Name : '',
    actionDay: row.ActionDay === true,
    reportingArea: typeof row.ReportingArea === 'string' ? row.ReportingArea : '',
    stateCode: typeof row.StateCode === 'string' ? row.StateCode : '',
  };
}

/**
 * Normalize a full AirNow forecast response.
 * @param {unknown} raw  The parsed JSON array from AirNow.
 * @returns {{ forecasts: AirnowForecastRow[], actionDay: boolean, reportingArea: string, discussion: string }}
 */
export function normalizeAirnowForecast(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  const forecasts = rows.map((r) => normalizeForecastRow(r)).filter(Boolean);
  const actionDay = forecasts.some((f) => f.actionDay);
  const reportingArea = forecasts.find((f) => f.reportingArea)?.reportingArea ?? '';
  // Discussion is repeated per row; take the first non-empty one.
  const discussion = rows.map((r) => (typeof r?.Discussion === 'string' ? r.Discussion : ''))
    .find((d) => d.length > 0) ?? '';
  return { forecasts, actionDay, reportingArea, discussion };
}

/** Peak (worst) forecast AQI across all rows, or null if none have a value. */
export function peakForecastAqi(forecasts) {
  const vals = forecasts.map((f) => f.aqi).filter((v) => typeof v === 'number');
  return vals.length > 0 ? Math.max(...vals) : null;
}
