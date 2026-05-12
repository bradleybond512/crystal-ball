/**
 * Nearby intelligence feed — returns recent events within a configurable
 * radius of the caller's saved places.
 *
 * GET /api/intelligence/nearby
 *   ?radiusKm=500       (filter radius, default 500)
 *   &savedPlaces=<json> (JSON array of {lat,lon} objects, required for filtering)
 *   &limit=50           (max events to return, default 50)
 */

import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 60 * 1000;
export const cache = new Map();

const j = (payload, status, cors) =>
  Response.json(payload, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
  });

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestKm(lat, lon, savedPlaces) {
  let best = Infinity;
  for (const p of savedPlaces) best = Math.min(best, haversineKm(lat, lon, p.lat, p.lon));
  return best;
}

async function fetchEarthquakes() {
  const r = await fetch(
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
    { signal: AbortSignal.timeout(8000) },
  );
  if (!r.ok) return [];
  const data = await r.json();
  return (data?.features ?? []).map((f) => {
    const mag = f.properties?.mag ?? 0;
    let severity = 'INFO';
    if (mag >= 7) severity = 'CRITICAL';
    else if (mag >= 6) severity = 'HIGH';
    else if (mag >= 5) severity = 'MEDIUM';
    else if (mag >= 3.5) severity = 'LOW';
    const [lon, lat] = f.geometry?.coordinates ?? [null, null];
    return {
      id: f.id,
      sourceId: 'usgs-earthquake',
      domain: 'seismic',
      timestamp: f.properties?.time ?? Date.now(),
      location: lat != null && lon != null ? { lat, lon } : undefined,
      severity,
      title: f.properties?.title ?? `M${mag} earthquake`,
      tags: ['earthquake'],
    };
  });
}

async function fetchNwsAlerts() {
  const r = await fetch(
    'https://api.weather.gov/alerts/active?status=actual&message_type=alert',
    {
      headers: { Accept: 'application/geo+json', 'User-Agent': 'CrystalBall/2.10.21' },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!r.ok) return [];
  const data = await r.json();
  return (data?.features ?? []).slice(0, 100).map((f) => {
    const p = f.properties ?? {};
    const sev = p.severity;
    let severity = 'INFO';
    if (sev === 'Extreme') severity = 'CRITICAL';
    else if (sev === 'Severe') severity = 'HIGH';
    else if (sev === 'Moderate') severity = 'MEDIUM';
    else if (sev === 'Minor') severity = 'LOW';
    const coords = f.geometry?.coordinates?.[0]?.[0];
    const location =
      Array.isArray(coords) ? { lat: coords[1], lon: coords[0] } : undefined;
    return {
      id: p.id ?? f.id,
      sourceId: 'nws-alerts',
      domain: 'weather',
      timestamp: new Date(p.sent ?? p.effective ?? Date.now()).getTime(),
      location,
      severity,
      title: p.headline ?? p.event ?? 'NWS alert',
      tags: ['weather'],
    };
  });
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const url = new URL(req.url);
  const radiusKm = Math.max(1, Number.parseFloat(url.searchParams.get('radiusKm') ?? '500') || 500);
  const limit = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50));

  let savedPlaces = [];
  const spParam = url.searchParams.get('savedPlaces');
  if (spParam) {
    try {
      const parsed = JSON.parse(spParam);
      if (Array.isArray(parsed)) {
        savedPlaces = parsed.filter(
          (p) => typeof p?.lat === 'number' && typeof p?.lon === 'number',
        );
      }
    } catch {
      // ignore malformed param
    }
  }

  const cacheKey = `nearby:${radiusKm}:${limit}:${JSON.stringify(savedPlaces)}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  const [quakes, alerts] = await Promise.allSettled([fetchEarthquakes(), fetchNwsAlerts()]);
  const allEvents = [
    ...(quakes.status === 'fulfilled' ? quakes.value : []),
    ...(alerts.status === 'fulfilled' ? alerts.value : []),
  ];

  const nearby =
    savedPlaces.length === 0
      ? allEvents
      : allEvents.filter(
          (ev) =>
            ev.location &&
            nearestKm(ev.location.lat, ev.location.lon, savedPlaces) <= radiusKm,
        );

  const sorted = nearby
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);

  const payload = {
    events: sorted,
    total: sorted.length,
    radiusKm,
    savedPlaces: savedPlaces.length,
    generatedAt: new Date().toISOString(),
  };
  cache.set(cacheKey, { at: Date.now(), payload });
  return j(payload, 200, cors);
}
