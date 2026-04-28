/**
 * NASA FIRMS satellite fire detection proxy. Requires NASA_FIRMS_API_KEY.
 * Returns {fires: [{lat, lon, brightness, frp, confidence, region, acq_date,
 * daynight}]} matching the wildfires service SidecarFire shape.
 *
 * FIRMS Area API:
 *   https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/{SOURCE}/{AREA}/{DAY_RANGE}
 *   SOURCE: VIIRS_SNPP_NRT (default) | MODIS_NRT | VIIRS_NOAA20_NRT
 *   AREA:   "world" or "<lonW>,<latS>,<lonE>,<latN>"
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map();

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ fires: [], degraded: true, reason, source: 'firms.modaps.eosdis.nasa.gov', generatedAt: new Date().toISOString() });

// Coarse continent bucket for region tagging.
function regionFor(lat, lon) {
  if (lat >= 15 && lon >= -170 && lon <= -50) return 'North America';
  if (lat < 15 && lat >= -60 && lon >= -90 && lon <= -30) return 'South America';
  if (lat >= 35 && lon >= -15 && lon <= 60) return 'Europe';
  if (lat < 35 && lat >= -40 && lon >= -20 && lon <= 55) return 'Africa';
  if (lat >= 5 && lon >= 60 && lon <= 150) return 'Asia';
  if (lat < 5 && lat >= -45 && lon >= 110 && lon <= 180) return 'Oceania';
  return 'Other';
}

function confidenceLabel(raw) {
  // VIIRS uses "n/l/h" or 0-100; MODIS uses 0-100.
  const s = String(raw ?? '').toLowerCase();
  if (s === 'h' || s === 'high') return 'high';
  if (s === 'n' || s === 'nominal') return 'nominal';
  if (s === 'l' || s === 'low') return 'low';
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return 'nominal';
  if (n >= 80) return 'high';
  if (n >= 30) return 'nominal';
  return 'low';
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const iLat = idx('latitude');
  const iLon = idx('longitude');
  const iBright = idx('bright_ti4') >= 0 ? idx('bright_ti4') : idx('brightness');
  const iFrp = idx('frp');
  const iConf = idx('confidence');
  const iDate = idx('acq_date');
  const iDayNight = idx('daynight');
  const fires = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const lat = Number.parseFloat(cells[iLat]);
    const lon = Number.parseFloat(cells[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const brightness = Number.parseFloat(cells[iBright]) || 0;
    const frp = Number.parseFloat(cells[iFrp]) || 0;
    const confidence = confidenceLabel(cells[iConf]);
    const acq_date = cells[iDate] ?? '';
    const daynight = (cells[iDayNight] ?? 'D').toUpperCase() === 'N' ? 'N' : 'D';
    fires.push({ lat, lon, brightness, frp, confidence, region: regionFor(lat, lon), acq_date, daynight });
  }
  return fires;
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const key = process.env.NASA_FIRMS_API_KEY;
  if (!key) return j(degraded('NASA_FIRMS_API_KEY not set'), 200, cors);

  const url = new URL(req.url);
  const source = url.searchParams.get('source') || 'VIIRS_SNPP_NRT';
  const area = url.searchParams.get('area') || 'world';
  const days = Math.min(10, Math.max(1, Number.parseInt(url.searchParams.get('days') || '1', 10) || 1));
  const cacheKey = `${source}|${area}|${days}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  try {
    const upstream = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${encodeURIComponent(source)}/${encodeURIComponent(area)}/${days}`;
    const r = await fetch(upstream, {
      headers: { 'User-Agent': 'CrystalBall/2.10.21 (firms)', Accept: 'text/csv' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return j(degraded(`FIRMS returned HTTP ${r.status}`), 200, cors);
    const text = await r.text();
    if (text.startsWith('Invalid') || text.includes('No fire data')) {
      return j({ fires: [], note: text.trim().slice(0, 200), source: 'firms.modaps.eosdis.nasa.gov', generatedAt: new Date().toISOString() }, 200, cors);
    }
    const fires = parseCsv(text);
    const result = {
      fires,
      source: 'firms.modaps.eosdis.nasa.gov',
      sat: source,
      area,
      days,
      count: fires.length,
      generatedAt: new Date().toISOString(),
    };
    cache.set(cacheKey, { at: Date.now(), payload: result });
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`FIRMS fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
