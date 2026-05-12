/**
 * Prioritized intelligence feed — aggregates recent events from key sidecar
 * sources and ranks them by proximity to the caller's saved places, severity,
 * and recency.
 *
 * GET /api/intelligence/prioritized
 *   ?limit=50               (max events to return, default 50)
 *   &savedPlaces=<json>     (JSON array of {lat,lon} objects, optional)
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

// ── Haversine distance (km) ──────────────────────────────────────────────────

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

// ── Scoring ──────────────────────────────────────────────────────────────────

const SEVERITY_SCORES = { CRITICAL: 30, HIGH: 20, MEDIUM: 10, LOW: 5, INFO: 0 };

function proximityBonus(lat, lon, savedPlaces) {
  if (!savedPlaces.length) return 0;
  let best = Infinity;
  for (const p of savedPlaces) best = Math.min(best, haversineKm(lat, lon, p.lat, p.lon));
  if (best <= 100) return 40;
  if (best <= 500) return 25;
  return 0;
}

function recencyBonus(timestampMs) {
  const age = Date.now() - timestampMs;
  if (age <= 5 * 60_000) return 10;
  if (age <= 30 * 60_000) return 5;
  if (age <= 2 * 60 * 60_000) return 2;
  return 0;
}

function score(event, savedPlaces) {
  const prox =
    event.location ? proximityBonus(event.location.lat, event.location.lon, savedPlaces) : 0;
  const sev = SEVERITY_SCORES[event.severity] ?? 0;
  const rec = recencyBonus(event.timestamp);
  return { score: Math.min(100, prox + sev + rec), prox, sev, rec };
}

// ── Upstream fetch ───────────────────────────────────────────────────────────

async function fetchEarthquakes() {
  const url =
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
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
  const url = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert';
  const r = await fetch(url, {
    headers: { Accept: 'application/geo+json', 'User-Agent': 'CrystalBall/2.10.21' },
    signal: AbortSignal.timeout(8000),
  });
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
      tags: ['weather', p.event?.toLowerCase().replace(/\s+/g, '-') ?? 'alert'].filter(Boolean),
    };
  });
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const url = new URL(req.url);
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

  const cacheKey = `prioritized:${limit}:${JSON.stringify(savedPlaces)}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  const [quakes, alerts] = await Promise.allSettled([fetchEarthquakes(), fetchNwsAlerts()]);
  const allEvents = [
    ...(quakes.status === 'fulfilled' ? quakes.value : []),
    ...(alerts.status === 'fulfilled' ? alerts.value : []),
  ];

  const scored = allEvents
    .map((ev) => {
      const s = score(ev, savedPlaces);
      return { ...ev, relevanceScore: s.score, relevanceReason: `prox+${s.prox} sev+${s.sev} rec+${s.rec}` };
    })
    .sort((a, b) =>
      b.relevanceScore === a.relevanceScore
        ? b.timestamp - a.timestamp
        : b.relevanceScore - a.relevanceScore,
    )
    .slice(0, limit);

  const payload = {
    events: scored,
    total: scored.length,
    savedPlaces: savedPlaces.length,
    generatedAt: new Date().toISOString(),
  };
  cache.set(cacheKey, { at: Date.now(), payload });
  return j(payload, 200, cors);
}
