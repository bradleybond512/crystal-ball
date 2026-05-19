/**
 * Intelligence feed — driver-scored ObservationEvents from USGS + NWS,
 * enriched with observation-graph edge counts.
 *
 * GET /api/intelligence/feed?limit=50&type=observation&domain=seismic
 *
 * Response: { items: FeedItem[], total: number, generated: number }
 *
 * FeedItem.data carries { driverScore, edgeCount } for downstream use.
 * Items are sorted by driverScore descending so the most-critical events
 * appear first regardless of when they occurred.
 */

import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 30_000;
export const cache = new Map();

const j = (payload, status, cors) =>
  Response.json(payload, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
  });

// ── Haversine ─────────────────────────────────────────────────────────────────

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

// ── Edge count helpers (mirrors observation-graph.ts populate logic) ──────────

function countEntityEdge(a, b, inc) {
  if ((a.tags ?? []).some((t) => (b.tags ?? []).includes(t))) {
    inc(a.id);
    inc(b.id);
  }
}

function countCoLocatedEdge(a, b, inc) {
  if (!a.location || !b.location) return;
  const dist = haversineKm(a.location.lat, a.location.lon, b.location.lat, b.location.lon);
  if (dist <= 100) {
    inc(a.id);
    inc(b.id);
  }
}

function countTemporalEdge(a, b, inc) {
  if (Math.abs(a.timestamp - b.timestamp) <= 30 * 60_000) {
    inc(a.id);
    inc(b.id);
  }
}

function countCorrelatedEdge(a, b, inc) {
  if (a.domain === b.domain) {
    inc(a.id);
    inc(b.id);
  }
}

function buildEdgeCountMap(events) {
  const countMap = new Map();
  const inc = (id) => countMap.set(id, (countMap.get(id) ?? 0) + 1);

  for (let i = 0; i < events.length; i++) {
    const a = events[i];
    for (let j = i + 1; j < events.length; j++) {
      const b = events[j];
      countEntityEdge(a, b, inc);
      countCoLocatedEdge(a, b, inc);
      countTemporalEdge(a, b, inc);
      countCorrelatedEdge(a, b, inc);
    }
  }

  return countMap;
}

// ── Driver scoring (inline of driver-scorer.ts logic) ──────────────────────

const SEV_BASE = { CRITICAL: 1, HIGH: 0.75, MEDIUM: 0.5, LOW: 0.25, INFO: 0.05 };

function recencyValue(timestampMs, nowMs) {
  const ageMs = nowMs - timestampMs;
  if (ageMs <= 5 * 60_000) return 1;
  if (ageMs <= 30 * 60_000) return 0.8;
  if (ageMs <= 2 * 60 * 60_000) return 0.5;
  if (ageMs <= 24 * 60 * 60_000) return 0.2;
  return 0.05;
}

function scoreEarthquake(event) {
  const mag = event.mag ?? 0;
  const depth = event.depth ?? 30;
  const aftershockValue = (event.tags ?? []).includes('aftershock') ? 0.5 : 0;
  const magValue = Math.min(1, Math.max(0, (mag - 2) / 7));
  const depthValue = depth < 10 ? 1 : Math.max(0, 1 - (depth - 10) / 200);
  const popValue = SEV_BASE[event.severity] ?? 0.5;
  const raw = 0.4 * magValue + 0.2 * depthValue + 0.25 * popValue - 0.15 * aftershockValue;
  const topDriver = magValue >= depthValue ? `magnitude=${(magValue * 100).toFixed(0)}%` : `depth=${(depthValue * 100).toFixed(0)}%`;
  return {
    driverScore: Math.min(100, Math.max(0, Math.round(raw * 100))),
    scoreReason: `earthquake: ${topDriver}, pop=${(popValue * 100).toFixed(0)}%`,
  };
}

function scoreGeneric(event, evidenceValue, nowMs) {
  const sevValue = SEV_BASE[event.severity] ?? 0.1;
  const recValue = recencyValue(event.timestamp, nowMs);
  const raw = 0.6 * sevValue + 0.2 * recValue + 0.2 * evidenceValue;
  return {
    driverScore: Math.min(100, Math.max(0, Math.round(raw * 100))),
    scoreReason: `${event.domain}: severity=${(sevValue * 100).toFixed(0)}%, recency=${(recValue * 100).toFixed(0)}%`,
  };
}

function isEarthquakeDomain(event) {
  const d = (event.domain ?? '').toLowerCase();
  return d === 'seismic' || d === 'earthquake' || (event.tags ?? []).includes('earthquake');
}

function scoreEvent(event, edgeCount, nowMs) {
  const evidenceValue = Math.min(1, edgeCount / 10);
  return isEarthquakeDomain(event)
    ? scoreEarthquake(event)
    : scoreGeneric(event, evidenceValue, nowMs);
}

// ── Upstream fetchers ─────────────────────────────────────────────────────────

function magnitudeToSeverity(mag) {
  if (mag >= 7) return 'CRITICAL';
  if (mag >= 6) return 'HIGH';
  if (mag >= 5) return 'MEDIUM';
  if (mag >= 4) return 'LOW';
  return 'INFO';
}

async function fetchEarthquakes() {
  const r = await fetch(
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
    { signal: AbortSignal.timeout(8000) },
  );
  if (!r.ok) return [];
  const data = await r.json();
  return (data?.features ?? []).map((f) => {
    const [lon, lat, depthRaw] = f.geometry?.coordinates ?? [null, null, 30];
    const mag = f.properties?.mag ?? 0;
    return {
      id: f.id,
      sourceId: 'usgs-earthquake',
      domain: 'seismic',
      timestamp: f.properties?.time ?? Date.now(),
      location: lat != null && lon != null ? { lat, lon } : undefined,
      severity: magnitudeToSeverity(mag),
      title: f.properties?.place ? `M${mag.toFixed(1)} — ${f.properties.place}` : `M${mag.toFixed(1)} earthquake`,
      mag,
      depth: depthRaw ?? 30,
      tags: ['earthquake'],
    };
  });
}

const NWS_SEVERITY_MAP = { extreme: 'CRITICAL', severe: 'HIGH', moderate: 'MEDIUM', minor: 'LOW' };

function nwsSeverityToObsSeverity(severity) {
  return NWS_SEVERITY_MAP[(severity ?? '').toLowerCase()] ?? 'INFO';
}

async function fetchNwsAlerts() {
  const r = await fetch(
    'https://api.weather.gov/alerts/active?status=actual&message_type=alert',
    {
      headers: { Accept: 'application/geo+json', 'User-Agent': 'CrystalBall/2.15.0' },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!r.ok) return [];
  const data = await r.json();
  return (data?.features ?? []).slice(0, 150).map((f) => {
    const p = f.properties ?? {};
    const coords = f.geometry?.coordinates?.[0]?.[0];
    const location = Array.isArray(coords) ? { lat: coords[1], lon: coords[0] } : undefined;
    return {
      id: p.id ?? f.id,
      sourceId: 'nws-alerts',
      domain: 'weather',
      timestamp: new Date(p.sent ?? p.effective ?? Date.now()).getTime(),
      location,
      severity: nwsSeverityToObsSeverity(p.severity),
      title: p.headline ?? p.event ?? 'NWS Alert',
      tags: ['weather'],
    };
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
  const typeFilter = url.searchParams.get('type') ?? '';
  const domainFilter = url.searchParams.get('domain') ?? '';

  const cacheKey = `intelligence-feed:${limit}:${typeFilter}:${domainFilter}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  const [quakes, alerts] = await Promise.allSettled([fetchEarthquakes(), fetchNwsAlerts()]);
  const allEvents = [
    ...(quakes.status === 'fulfilled' ? quakes.value : []),
    ...(alerts.status === 'fulfilled' ? alerts.value : []),
  ];

  const now = Date.now();
  const edgeCountMap = buildEdgeCountMap(allEvents);

  let items = allEvents.map((ev) => {
    const edgeCount = edgeCountMap.get(ev.id) ?? 0;
    const { driverScore, scoreReason } = scoreEvent(ev, edgeCount, now);
    return {
      id: ev.id,
      type: 'observation',
      timestamp: ev.timestamp,
      domain: ev.domain,
      severity: ev.severity,
      title: ev.title,
      summary: scoreReason,
      data: { driverScore, edgeCount },
    };
  });

  // This route only serves observations; other types return empty
  if (typeFilter && typeFilter !== 'observation') items = [];
  if (domainFilter) items = items.filter((i) => i.domain === domainFilter);

  items.sort((a, b) => (b.data.driverScore ?? 0) - (a.data.driverScore ?? 0));

  const payload = { items: items.slice(0, limit), total: items.length, generated: now };
  cache.set(cacheKey, { at: now, payload });
  return j(payload, 200, cors);
}
