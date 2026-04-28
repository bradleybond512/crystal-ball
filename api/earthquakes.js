/**
 * USGS earthquake feed proxy. No API key. Significant + M2.5+ last day.
 * https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const UPSTREAMS = {
  significant: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson',
  m45: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson',
  m25: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
  all: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
};
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ events: [], degraded: true, reason, source: 'usgs.gov', generatedAt: new Date().toISOString() });

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const url = new URL(req.url);
  const feed = url.searchParams.get('feed') || 'm25';
  const upstream = UPSTREAMS[feed] || UPSTREAMS.m25;

  const cached = cache.get(feed);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  try {
    const r = await fetch(upstream, {
      headers: { 'User-Agent': 'CrystalBall/2.10.21 (earthquakes)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return j(degraded(`USGS returned HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const result = {
      events: features,
      count: features.length,
      feed,
      metadata: payload?.metadata,
      source: 'usgs.gov',
      generatedAt: new Date().toISOString(),
    };
    cache.set(feed, { at: Date.now(), payload: result });
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`USGS fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
