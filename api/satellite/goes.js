/**
 * NOAA GOES satellite imagery metadata proxy.
 * Validates and returns GOES-East and GOES-West latest GeoColor image URLs.
 * Uses NESDIS CDN — no API key required.
 *
 * GOES-East = GOES-16, CONUS sector
 * GOES-West = GOES-18, CONUS sector
 */

import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 5 * 60 * 1000;

const GOES_EAST_BASE = 'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/CONUS/GEOCOLOR';
const GOES_WEST_BASE = 'https://cdn.star.nesdis.noaa.gov/GOES18/ABI/CONUS/GEOCOLOR';

export const cache = new Map();

const j = (payload, status, cors) =>
  Response.json(payload, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
  });

async function probeLatest(base) {
  const url = `${base}/latest.jpg`;
  try {
    const r = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'CrystalBall/2 (goes-satellite)' },
      signal: AbortSignal.timeout(8000),
    });
    return {
      url,
      available: r.ok,
      lastModified: r.headers.get('last-modified') ?? null,
      contentLength: r.headers.get('content-length') ? Number(r.headers.get('content-length')) : null,
    };
  } catch {
    return { url, available: false, lastModified: null, contentLength: null };
  }
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const cached = cache.get('latest');
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  const [east, west] = await Promise.all([
    probeLatest(GOES_EAST_BASE),
    probeLatest(GOES_WEST_BASE),
  ]);

  const payload = {
    goesEast: {
      label: 'GOES-East (GOES-16)',
      region: 'CONUS',
      product: 'GeoColor',
      ...east,
    },
    goesWest: {
      label: 'GOES-West (GOES-18)',
      region: 'CONUS',
      product: 'GeoColor',
      ...west,
    },
    generatedAt: new Date().toISOString(),
    cacheTtlSeconds: CACHE_TTL_MS / 1000,
  };

  cache.set('latest', { at: Date.now(), payload });
  return j(payload, 200, cors);
}
