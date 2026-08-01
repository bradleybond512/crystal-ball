/**
 * Mission state probe — checks reachability of the five critical
 * upstream data feeds and computes an overall NOMINAL/DEGRADED/CRITICAL
 * posture from the sidecar's perspective.
 *
 * Rules (mirroring the frontend mission-state-service):
 *   - ≥3 critical feeds unreachable → CRITICAL
 *   - ≥2 critical feeds unreachable → DEGRADED
 *   - otherwise                     → NOMINAL
 *
 * No API key required. Results cached for 60 s.
 */

import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 60 * 1000;

const CRITICAL_FEEDS = [
  {
    id: 'usgs-earthquake',
    label: 'USGS Earthquakes',
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson',
  },
  {
    id: 'nws-weather',
    label: 'NWS Alerts',
    url: 'https://api.weather.gov/',
  },
  {
    id: 'nifc-wildfire',
    label: 'NASA FIRMS Wildfire',
    url: 'https://firms.modaps.eosdis.nasa.gov/',
  },
  {
    id: 'ais-stream',
    label: 'AIS Maritime',
    url: 'https://www.marinetraffic.com/',
  },
  {
    id: 'spaceweather-noaa',
    label: 'NOAA Space Weather',
    // solar-wind/mag-5-minute.json was retired upstream and 404s. Because the
    // probe below counted any sub-500 status as reachable, this feed reported
    // NOMINAL for as long as the URL has been dead.
    url: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
  },
];

export const cache = new Map();

const j = (payload, status, cors) =>
  Response.json(payload, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
  });

async function probeOne(feed) {
  try {
    const r = await fetch(feed.url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    // A missing resource is NOT a reachable feed — 404/410 is exactly how a
    // retired upstream product presents, and counting it as reachable is what
    // hid the dead solar-wind URL. Other 4xx (401/403/405/429) still count:
    // several of these hosts refuse HEAD or require a key while being healthy.
    const gone = r.status === 404 || r.status === 410;
    return { id: feed.id, label: feed.label, reachable: !gone && (r.ok || r.status < 500) };
  } catch {
    return { id: feed.id, label: feed.label, reachable: false };
  }
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const cached = cache.get('mission-state');
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  const results = await Promise.all(CRITICAL_FEEDS.map((f) => probeOne(f)));
  const downCount = results.filter((r) => !r.reachable).length;

  let state;
  if (downCount >= 3) {
    state = 'CRITICAL';
  } else if (downCount >= 2) {
    state = 'DEGRADED';
  } else {
    state = 'NOMINAL';
  }

  const payload = {
    state,
    downCount,
    feeds: results,
    generatedAt: new Date().toISOString(),
  };
  cache.set('mission-state', { at: Date.now(), payload });
  return j(payload, 200, cors);
}
