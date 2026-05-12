/**
 * Evidence graph query endpoint — returns ObsEvidenceEdges for a given
 * observation event ID, sourced from recent USGS + NWS events with
 * auto-derived structural edges (proximity, entity, temporal, correlation).
 *
 * GET /api/intelligence/evidence-graph?eventId=<id>
 *   Returns all edges where `from` or `to` === eventId, plus the
 *   neighbor event IDs for graph traversal.
 *
 * Without eventId: returns a summary of the full graph (edge count,
 * most-connected nodes, edge type breakdown).
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

// ── Haversine ────────────────────────────────────────────────────────────────

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

// ── Auto-edge derivation ────────────────────────────────────────────────────

function makePair(a, b, type, confidence, now) {
  return [
    { from: a.id, to: b.id, type, confidence, created: now },
    { from: b.id, to: a.id, type, confidence, created: now },
  ];
}

function entitySharedEdges(a, b, now) {
  const overlap = (a.tags ?? []).some((t) => (b.tags ?? []).includes(t));
  return overlap ? makePair(a, b, 'entity_shared', 0.8, now) : [];
}

function coLocatedEdges(a, b, now) {
  if (!a.location || !b.location) return [];
  const dist = haversineKm(a.location.lat, a.location.lon, b.location.lat, b.location.lon);
  if (dist > 100) return [];
  const conf = +Math.max(0.4, 1 - dist / 100).toFixed(3);
  return makePair(a, b, 'co_located', conf, now);
}

function temporalEdges(a, b, now) {
  const WINDOW = 30 * 60_000;
  const diff = Math.abs(a.timestamp - b.timestamp);
  if (diff > WINDOW) return [];
  const conf = +(1 - (diff / WINDOW) * 0.5).toFixed(3);
  return makePair(a, b, 'temporally_adjacent', conf, now);
}

function correlatedEdges(a, b, now) {
  return a.domain === b.domain ? makePair(a, b, 'correlated', 0.6, now) : [];
}

function buildEdges(events) {
  const edges = [];
  const now = Date.now();

  for (let i = 0; i < events.length; i++) {
    const a = events[i];
    for (let j = i + 1; j < events.length; j++) {
      const b = events[j];
      edges.push(
        ...entitySharedEdges(a, b, now),
        ...coLocatedEdges(a, b, now),
        ...temporalEdges(a, b, now),
        ...correlatedEdges(a, b, now),
      );
    }
  }

  return edges;
}

// ── Upstream fetch (shared with prioritized.js) ──────────────────────────────

async function fetchEarthquakes() {
  const r = await fetch(
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
    { signal: AbortSignal.timeout(8000) },
  );
  if (!r.ok) return [];
  const data = await r.json();
  return (data?.features ?? []).map((f) => {
    const [lon, lat] = f.geometry?.coordinates ?? [null, null];
    return {
      id: f.id,
      sourceId: 'usgs-earthquake',
      domain: 'seismic',
      timestamp: f.properties?.time ?? Date.now(),
      location: lat != null && lon != null ? { lat, lon } : undefined,
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
    const coords = f.geometry?.coordinates?.[0]?.[0];
    const location = Array.isArray(coords) ? { lat: coords[1], lon: coords[0] } : undefined;
    return {
      id: p.id ?? f.id,
      sourceId: 'nws-alerts',
      domain: 'weather',
      timestamp: new Date(p.sent ?? p.effective ?? Date.now()).getTime(),
      location,
      tags: ['weather'],
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
  const eventId = url.searchParams.get('eventId') ?? '';

  const cacheKey = `evidence-graph:${eventId}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  const [quakes, alerts] = await Promise.allSettled([fetchEarthquakes(), fetchNwsAlerts()]);
  const allEvents = [
    ...(quakes.status === 'fulfilled' ? quakes.value : []),
    ...(alerts.status === 'fulfilled' ? alerts.value : []),
  ];

  const edges = buildEdges(allEvents);

  let payload;
  if (eventId) {
    const eventEdges = edges.filter((e) => e.from === eventId || e.to === eventId);
    const neighborIds = [...new Set(
      eventEdges.map((e) => (e.from === eventId ? e.to : e.from)),
    )];
    payload = {
      eventId,
      edges: eventEdges,
      neighborIds,
      edgeCount: eventEdges.length,
      generatedAt: new Date().toISOString(),
    };
  } else {
    const typeCounts = {};
    for (const e of edges) typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
    const connectivity = {};
    for (const e of edges) {
      connectivity[e.from] = (connectivity[e.from] ?? 0) + 1;
    }
    const topNodes = Object.entries(connectivity)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([id, count]) => ({ id, outDegree: count }));
    payload = {
      totalEdges: edges.length,
      totalEvents: allEvents.length,
      edgesByType: typeCounts,
      topNodes,
      generatedAt: new Date().toISOString(),
    };
  }

  cache.set(cacheKey, { at: Date.now(), payload });
  return j(payload, 200, cors);
}
