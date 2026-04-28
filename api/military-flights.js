/**
 * Military aircraft tracker — proxies through OpenSky relay if
 * configured, else returns degraded payload. Filters to known
 * military hex prefixes (US/UK/JP/etc.) when raw OpenSky data is
 * available.
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ flights: [], degraded: true, reason, source: 'opensky', generatedAt: new Date().toISOString() });

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

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const url = new URL(req.url);
  const region = url.searchParams.get('region') || 'ALL';
  const cached = cache.get(region);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  const port = process.env.LOCAL_API_PORT || '46123';
  const token = process.env.LOCAL_API_TOKEN || '';

  try {
    const openskyUrl = new URL(`http://127.0.0.1:${port}/api/opensky`);
    const box = regionBox(region);
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
    if (!r.ok) return j(degraded(`OpenSky relay returned HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    const states = Array.isArray(payload?.states) ? payload.states : [];
    const flights = states
      .filter((s) => isMilitary(s?.[0] ?? ''))
      .map((s) => ({
        icao24: s[0], callsign: (s[1] ?? '').trim(),
        country: s[2], lng: s[5], lat: s[6], altitudeM: s[7],
        groundSpeedMs: s[9], headingDeg: s[10],
      }));
    const result = { flights, region, count: flights.length, source: 'opensky', generatedAt: new Date().toISOString() };
    cache.set(region, { at: Date.now(), payload: result });
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`Military flights fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
