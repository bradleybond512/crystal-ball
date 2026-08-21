import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const OSRM_ROUTE_ENDPOINT = 'https://router.project-osrm.org/route/v1/driving';
const MAX_WAYPOINTS = 12;
const MAX_GEOMETRY_POINTS = 100_000;
const MAX_STEPS = 5000;
const MAX_DISTANCE_METERS = 50_000_000;
const MAX_DURATION_SECONDS = 31_536_000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function json(body, status, cors, extra = {}) {
  return Response.json(body, {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra, ...cors },
  });
}

function finiteInRange(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function nonNegativeFinite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function boundedDistance(value) {
  return nonNegativeFinite(value) && value <= MAX_DISTANCE_METERS;
}

function boundedDuration(value) {
  return nonNegativeFinite(value) && value <= MAX_DURATION_SECONDS;
}

function boundedText(value, maximum) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.slice(0, maximum);
}

async function readBoundedJson(response, signal) {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null
    && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) {
    throw new Error('routing response exceeded byte limit');
  }
  if (!response.body) throw new Error('routing response body missing');
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  const abortRead = () => reader.cancel(signal.reason);
  signal.addEventListener('abort', abortRead, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel('routing response exceeded byte limit');
        throw new Error('routing response exceeded byte limit');
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', abortRead);
    reader.releaseLock();
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
}

function parseCoordinates(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 600) return null;
  const points = raw.split(';');
  if (points.length < 2 || points.length > MAX_WAYPOINTS) return null;
  const parsed = [];
  for (const point of points) {
    const parts = point.split(',');
    if (parts.length !== 2 || !parts.every((part) => NUMBER_PATTERN.test(part))) return null;
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!finiteInRange(lon, -180, 180) || !finiteInRange(lat, -90, 90)) return null;
    parsed.push(`${lon},${lat}`);
  }
  return parsed.join(';');
}

function normalizeCoordinate(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const lon = value[0];
  const lat = value[1];
  return finiteInRange(lon, -180, 180) && finiteInRange(lat, -90, 90) ? [lon, lat] : null;
}

function normalizeStep(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!boundedDistance(value.distance) || !boundedDuration(value.duration)) return null;
  const maneuver = value.maneuver;
  if (!maneuver || typeof maneuver !== 'object' || Array.isArray(maneuver)) return null;
  const type = boundedText(maneuver.type, 60);
  if (!type) return null;
  const modifier = boundedText(maneuver.modifier, 60);
  return {
    maneuver: { type, ...(modifier ? { modifier } : {}) },
    name: boundedText(value.name, 200) ?? '',
    distance: value.distance,
    duration: value.duration,
  };
}

function normalizeLeg(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!boundedDistance(value.distance) || !boundedDuration(value.duration) || !Array.isArray(value.steps)) return null;
  if (value.steps.length > MAX_STEPS) return null;
  const steps = value.steps.map((step) => normalizeStep(step));
  if (steps.includes(null)) return null;
  return { distance: value.distance, duration: value.duration, steps };
}

function normalizeRoute(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!boundedDistance(value.distance) || !boundedDuration(value.duration)) return null;
  if (!value.geometry || value.geometry.type !== 'LineString' || !Array.isArray(value.geometry.coordinates)) return null;
  if (value.geometry.coordinates.length < 2 || value.geometry.coordinates.length > MAX_GEOMETRY_POINTS) return null;
  const coordinates = value.geometry.coordinates.map((coordinate) => normalizeCoordinate(coordinate));
  if (coordinates.includes(null)) return null;
  if (!Array.isArray(value.legs) || value.legs.length === 0 || value.legs.length > MAX_WAYPOINTS - 1) return null;
  const legs = value.legs.map((leg) => normalizeLeg(leg));
  if (legs.includes(null)) return null;
  if (legs.reduce((total, leg) => total + leg.steps.length, 0) > MAX_STEPS) return null;
  return {
    distance: value.distance,
    duration: value.duration,
    geometry: { type: 'LineString', coordinates },
    legs,
  };
}

function normalizeResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.code === 'NoRoute' || value.code === 'NoSegment') {
    if (value.routes !== undefined && (!Array.isArray(value.routes) || value.routes.length !== 0)) return null;
    return { code: value.code, routes: [] };
  }
  if (!Array.isArray(value.routes)) return null;
  if (value.code !== 'Ok' || value.routes.length === 0 || value.routes.length > 3) return null;
  const routes = value.routes.map((route) => normalizeRoute(route));
  return routes.includes(null) ? null : { code: 'Ok', routes };
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405, cors, { Allow: 'GET, OPTIONS' });
  if (isDisallowedOrigin(req)) return json({ error: 'Origin not allowed' }, 403, cors);

  const url = new URL(req.url);
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== 'coords' || url.searchParams.getAll('coords').length !== 1) {
    return json({ error: 'Invalid routing query' }, 400, cors);
  }
  const coordinates = parseCoordinates(url.searchParams.get('coords'));
  if (!coordinates) return json({ error: 'Invalid routing query' }, 400, cors);

  const upstreamUrl = `${OSRM_ROUTE_ENDPOINT}/${coordinates}?overview=full&geometries=geojson&steps=true`;
  try {
    const signal = AbortSignal.timeout(12_000);
    const response = await fetch(upstreamUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'Crystal-Ball/2' },
      signal,
      // The desktop sidecar consumes this before its IPv4 shim prebuffers.
      maxResponseBytes: MAX_RESPONSE_BYTES,
    });
    if (!response.ok) return json({ error: 'Routing provider unavailable' }, 502, cors);
    const normalized = normalizeResponse(await readBoundedJson(response, signal).catch(() => null));
    if (!normalized) return json({ error: 'Routing provider returned unusable data' }, 502, cors);
    return json(normalized, 200, cors);
  } catch {
    return json({ error: 'Routing provider unavailable' }, 502, cors);
  }
}
