/**
 * Economic stress bundle — FRED commodity/FX/vol series + OFR FSI.
 *
 * GET /api/economic/stress
 *   → { indicators: StressIndicator[], updatedAt, source, degraded? }
 *
 * Indicators bundled:
 *   - Brent crude oil      (FRED: DCOILBRENTEU)
 *   - Gold spot            (FRED: GOLDAMGBD228NLBM)         [historical series]
 *   - USD/EUR exchange     (FRED: DEXUSEU)
 *   - VIX equity volatility (FRED: VIXCLS)
 *   - OFR Financial Stress Index (data.financialresearch.gov: OFRFSI)
 *
 * Each indicator carries the latest observation plus a rolling 90-day
 * window so consumers can plot a sparkline / compute deltas without a
 * second roundtrip.
 *
 * Cache: 1 h. FRED daily series rarely move within an hour and the OFR
 * FSI publishes daily, so an hourly cadence is the minimum useful TTL.
 *
 * Why bundled rather than per-series client orchestration: stress
 * indicators are correlated — a consumer asking "is the macro under
 * stress?" wants all of them at once, not 5 round-trips. The caller
 * still gets per-indicator degraded flags so a single broken upstream
 * doesn't poison the whole response.
 */

import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;

const WINDOW_DAYS = 90;

const FRED_SERIES = Object.freeze([
  { id: 'DCOILBRENTEU',      label: 'Brent crude oil ($/bbl)',     category: 'commodity' },
  { id: 'GOLDAMGBD228NLBM',  label: 'Gold London PM fix ($/oz)',   category: 'commodity' },
  { id: 'DEXUSEU',           label: 'USD/EUR exchange',            category: 'fx' },
  { id: 'VIXCLS',            label: 'VIX equity volatility',       category: 'volatility' },
]);

const OFR_FSI_URL = 'https://data.financialresearch.gov/v1/series/timeseries?mnemonic=OFRFSI';
//  ^ The spec wrote `?mnemonic=OFR_FSI&endpoint=get`; the published mnemonic
//    is `OFRFSI` (no underscore) and the timeseries endpoint returns
//    [[ms, value], ...] which is what we want for the 90-day window.

let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);

  const fredKey = process.env.FRED_API_KEY;
  const sinceIso = isoDay(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Per-series fetches run in parallel; each handles its own failure so
  // a single broken upstream degrades only itself, not the whole bundle.
  const indicators = await Promise.all([
    ...FRED_SERIES.map((meta) => fetchFredSeries(meta, fredKey, sinceIso)),
    fetchOfrFsi(sinceIso),
  ]);

  const result = {
    indicators,
    updatedAt: Date.now(),
    source: 'fred+ofr',
    window: { sinceIso, days: WINDOW_DAYS },
    degraded: indicators.every((i) => i.degraded === true),
  };
  _cache = { at: Date.now(), payload: result };
  return j(result, 200, cors);
}

async function fetchFredSeries(meta, apiKey, sinceIso) {
  const baseShape = { id: meta.id, label: meta.label, category: meta.category, source: 'fred' };
  if (!apiKey) {
    return { ...baseShape, degraded: true, reason: 'FRED_API_KEY not set', latest: null, history: [] };
  }
  const params = new URLSearchParams({
    series_id: meta.id, api_key: apiKey, file_type: 'json',
    sort_order: 'asc', observation_start: sinceIso,
  });
  const url = `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) {
      return { ...baseShape, degraded: true, reason: `FRED HTTP ${r.status}`, latest: null, history: [] };
    }
    const payload = await r.json();
    const observations = Array.isArray(payload?.observations) ? payload.observations : [];
    const history = observations
      .map((o) => ({ date: o?.date ?? '', value: o?.value === '.' ? null : Number.parseFloat(o?.value) }))
      .filter((o) => o.date && Number.isFinite(o.value));
    const latest = history.length ? history[history.length - 1] : null;
    return { ...baseShape, latest, history };
  } catch (error) {
    return { ...baseShape, degraded: true, reason: `FRED fetch failed: ${error?.message ?? error}`, latest: null, history: [] };
  }
}

async function fetchOfrFsi(sinceIso) {
  const baseShape = {
    id: 'OFRFSI', label: 'OFR Financial Stress Index',
    category: 'composite', source: 'ofr',
  };
  try {
    const r = await fetch(OFR_FSI_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall (ofr-fsi)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!r.ok) {
      return { ...baseShape, degraded: true, reason: `OFR HTTP ${r.status}`, latest: null, history: [] };
    }
    const payload = await r.json();
    const history = parseOfrTimeseries(payload, sinceIso);
    const latest = history.length ? history[history.length - 1] : null;
    return { ...baseShape, latest, history };
  } catch (error) {
    return { ...baseShape, degraded: true, reason: `OFR fetch failed: ${error?.message ?? error}`, latest: null, history: [] };
  }
}

/** OFR returns either `[[ms, value], ...]` (timeseries endpoint) or
 *  `{ data: [[ms, value], ...] }`. Normalize and filter to the window.
 *  Exported for unit testing. */
export function parseOfrTimeseries(payload, sinceIso) {
  let rows = [];
  if (Array.isArray(payload)) rows = payload;
  else if (Array.isArray(payload?.data)) rows = payload.data;
  const sinceMs = Date.parse(sinceIso) || 0;
  const out = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const [tsRaw, valRaw] = row;
    const ts = typeof tsRaw === 'number' ? tsRaw : Date.parse(String(tsRaw));
    const value = typeof valRaw === 'number' ? valRaw : Number.parseFloat(valRaw);
    if (!Number.isFinite(ts) || !Number.isFinite(value)) continue;
    if (ts < sinceMs) continue;
    out.push({ date: new Date(ts).toISOString().slice(0, 10), value });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

function isoDay(ms) { return new Date(ms).toISOString().slice(0, 10); }

export function __resetCacheForTests() { _cache = null; }
