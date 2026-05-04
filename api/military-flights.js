/**
 * Military aircraft tracker — primary source is the OpenSky relay,
 * with three free, no-key ADS-B fallbacks (adsb.lol, airplanes.live,
 * adsb.fi) tried in order when OpenSky fails or returns no results.
 * Filters to known military hex prefixes when consuming raw OpenSky
 * states; the /v2/mil endpoints are pre-filtered upstream.
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ flights: [], degraded: true, reason, source: 'opensky', generatedAt: new Date().toISOString() });

const ADSB_FALLBACKS = [
  { source: 'adsb.lol',       url: 'https://api.adsb.lol/v2/mil' },
  { source: 'airplanes.live', url: 'https://api.airplanes.live/v2/mil' },
  { source: 'adsb.fi',        url: 'https://opendata.adsb.fi/api/v2/mil' },
];

function inBox(box, lat, lon) {
  if (!box) return true;
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  return lat >= box[0] && lat <= box[2] && lon >= box[1] && lon <= box[3];
}

async function fetchAdsbFallback({ source, url }, box) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'CrystalBall/2.10 (+https://github.com/bradleybond512/crystal-ball)' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`${source} HTTP ${r.status}`);
  const payload = await r.json();
  const list = Array.isArray(payload?.ac) ? payload.ac : [];
  const flights = list
    .filter((a) => inBox(box, a?.lat, a?.lon))
    .map((a) => ({
      icao24: (a?.hex ?? '').toLowerCase(),
      callsign: (a?.flight ?? '').trim(),
      country: '',
      lng: a?.lon,
      lat: a?.lat,
      altitudeM: typeof a?.alt_baro === 'number' ? Math.round(a.alt_baro * 0.3048) : null,
      groundSpeedMs: typeof a?.gs === 'number' ? Math.round(a.gs * 0.514_444) : null,
      headingDeg: typeof a?.track === 'number' ? a.track : null,
    }))
    .filter((f) => f.icao24 && typeof f.lat === 'number' && typeof f.lng === 'number');
  return { flights, source };
}

// Known military ICAO24 hex prefixes by country. Conservative set; the
// real list lives in the data file but a top-level filter is enough
// for the panel to pick up "any military" without exhaustive coverage.
const MILITARY_PREFIXES = ['adfd', 'adfe', 'aeff', 'aef0', '4061', '40e6', '7c1b', '8a0', '7c0', '7cf'];

function isMilitary(hex) {
  if (!hex) return false;
  const lower = hex.toLowerCase();
  return MILITARY_PREFIXES.some((p) => lower.startsWith(p));
}

function regionBox(region) {
  switch (region) {
    case 'PACIFIC': { return [0, -180, 60, -100];
    }
    case 'WESTERN': { return [10, -130, 60, -60];
    }
    case 'ATLANTIC': { return [10, -60, 60, 0];
    }
    case 'EUROPE': { return [35, -10, 70, 40];
    }
    case 'MIDDLE_EAST': { return [10, 30, 45, 65];
    }
    default: { return null;
    }
  }
}

async function fetchOpenSky(box) {
  const port = process.env.LOCAL_API_PORT || '46123';
  const token = process.env.LOCAL_API_TOKEN || '';
  const openskyUrl = new URL(`http://127.0.0.1:${port}/api/opensky`);
  if (box) {
    openskyUrl.searchParams.set('lamin', String(box[0]));
    openskyUrl.searchParams.set('lomin', String(box[1]));
    openskyUrl.searchParams.set('lamax', String(box[2]));
    openskyUrl.searchParams.set('lomax', String(box[3]));
  }
  const r = await fetch(openskyUrl.toString(), {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const payload = await r.json();
  const states = Array.isArray(payload?.states) ? payload.states : [];
  return states
    .filter((s) => isMilitary(s?.[0] ?? ''))
    .map((s) => ({
      icao24: s[0], callsign: (s[1] ?? '').trim(),
      country: s[2], lng: s[5], lat: s[6], altitudeM: s[7],
      groundSpeedMs: s[9], headingDeg: s[10],
    }));
}

async function tryProvider(name, fn, failures) {
  try {
    const flights = await fn();
    if (flights.length === 0) { failures.push(`${name} empty`); return null; }
    return flights;
  } catch (error) {
    failures.push(`${name} ${error?.message ?? error}`);
    return null;
  }
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const url = new URL(req.url);
  const region = url.searchParams.get('region') || 'ALL';
  const cached = cache.get(region);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  const box = regionBox(region);
  const failures = [];

  const openskyFlights = await tryProvider('opensky', () => fetchOpenSky(box), failures);
  if (openskyFlights) {
    const result = { flights: openskyFlights, region, count: openskyFlights.length, source: 'opensky', generatedAt: new Date().toISOString() };
    cache.set(region, { at: Date.now(), payload: result });
    return j(result, 200, cors);
  }

  for (const provider of ADSB_FALLBACKS) {
    const flights = await tryProvider(provider.source, async () => {
      const result = await fetchAdsbFallback(provider, box);
      return result.flights;
    }, failures);
    if (flights) {
      const result = { flights, region, count: flights.length, source: provider.source, fallback: true, generatedAt: new Date().toISOString() };
      cache.set(region, { at: Date.now(), payload: result });
      return j(result, 200, cors);
    }
  }

  return j(degraded(`All providers failed: ${failures.join('; ')}`), 200, cors);
}
