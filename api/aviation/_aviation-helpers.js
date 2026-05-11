/**
 * Shared helpers for the /api/aviation/* sidecar routes.
 *
 * The renderer-side normalizers live in TS at
 * src/services/aviation/aviation-intel-normalize.ts. The sidecar can't
 * import those directly (no build step on Node-side .mjs), so the
 * normalizers are mirrored here in plain JS. Pure functions; no I/O.
 *
 * Keep the two implementations in sync. The TS unit tests are the
 * source of truth for shape; this JS variant trades type safety for
 * the ability to run inside the sidecar process.
 */

import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';

const FETCH_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map();

export function jsonResponse(payload, status, cors) {
  return Response.json(payload, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
  });
}

export function preflight(req, allowMethods) {
  const cors = getCorsHeaders(req, allowMethods);
  if (isDisallowedOrigin(req)) {
    return { cors, response: jsonResponse({ error: 'Origin not allowed' }, 403, cors) };
  }
  if (req.method === 'OPTIONS') {
    return { cors, response: new Response(null, { status: 204, headers: cors }) };
  }
  if (req.method !== 'GET') {
    return { cors, response: jsonResponse({ error: 'Method not allowed' }, 405, cors) };
  }
  return { cors, response: null };
}

export function degraded(reason, source) {
  return {
    data: [],
    fetchedAt: Date.now(),
    degraded: true,
    reason,
    source,
  };
}

export function envelope(data, source) {
  return {
    data,
    fetchedAt: Date.now(),
    degraded: false,
    source,
  };
}

export async function fetchUpstream(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers = {
      'User-Agent': 'CrystalBall/aviation-intel (https://crystalball.app)',
      Accept: 'application/json',
      ...init.headers,
    };
    const response = await fetch(url, { ...init, headers, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export async function withCache(key, source, build) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload;
  try {
    const payload = await build();
    cache.set(key, { at: Date.now(), payload });
    return payload;
  } catch (error) {
    return degraded(error?.message ?? String(error), source);
  }
}

// Normalizers

export function pickString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export function pickFinite(...values) {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim()) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export function parseTimestamp(...values) {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      return v < 10_000_000_000 ? v * 1000 : v;
    }
    if (typeof v === 'string' && v.trim()) {
      const t = Date.parse(v);
      if (Number.isFinite(t)) return t;
    }
  }
  return null;
}

export function extractItems(payload, keys) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const key of keys) {
      const v = payload[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

export function classifyMilitaryType(callsign, acTypeRaw) {
  const prefixes = {
    RCH: 'transport', REACH: 'transport',
    CNV: 'tanker', PAT: 'tanker', GOLD: 'tanker', SHELL: 'tanker',
    TEAL: 'recon', HOMER: 'recon', MAGIC: 'recon', SENTRY: 'recon', RIVET: 'recon',
    PYTHON: 'fighter', RAGE: 'fighter', VIPER: 'fighter', EAGLE: 'fighter',
    RAIDER: 'bomber', DOOM: 'bomber', BISON: 'bomber',
    ARMY: 'helo', PEDRO: 'helo', DUSTOFF: 'helo',
  };
  if (callsign) {
    const upper = callsign.replace(/\d{1,8}$/, '').toUpperCase();
    for (const [prefix, type] of Object.entries(prefixes)) {
      if (upper.startsWith(prefix)) return type;
    }
  }
  const t = typeof acTypeRaw === 'string' ? acTypeRaw.toUpperCase() : '';
  if (/^C-?(5|17|130)|^KC-?\d|KC-?135|KC-?46/.test(t)) return 'tanker';
  if (/^F-?(15|16|18|22|35)/.test(t)) return 'fighter';
  if (/^B-?(1|2|52)/.test(t)) return 'bomber';
  if (/AWACS|RC-?135|U-?2|RQ-?4/.test(t)) return 'recon';
  if (/^(UH|HH|CH|MH)-?\d/.test(t)) return 'helo';
  return 'unknown';
}

export function normalizeMilitary(payload) {
  let items;
  if (Array.isArray(payload)) items = payload;
  else if (Array.isArray(payload?.ac)) items = payload.ac;
  else if (Array.isArray(payload?.aircraft)) items = payload.aircraft;
  else if (Array.isArray(payload?.states)) {
    items = payload.states.map((row) => {
      if (!Array.isArray(row)) return null;
      return {
        icao24: row[0],
        callsign: row[1],
        origin_country: row[2],
        last_contact: typeof row[4] === 'number' ? row[4] * 1000 : null,
        lon: row[5],
        lat: row[6],
        baro_altitude: row[7],
        velocity: row[9],
        track: row[10],
        squawk: row[14],
      };
    });
  } else items = [];
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const callsign = (pickString(item.flight, item.r, item.callsign) ?? '').trim() || null;
    const icao24 = (pickString(item.hex, item.icao24, item.icao) ?? '').toLowerCase().trim();
    if (!icao24) continue;
    const altMeters = pickFinite(item.alt_baro, item.geom_alt, item.baro_altitude);
    out.push({
      icao24,
      callsign,
      type: classifyMilitaryType(callsign, item.t),
      country: pickString(item.r_country, item.origin_country, item.country) ?? null,
      lat: pickFinite(item.lat, item.latitude),
      lon: pickFinite(item.lon, item.longitude),
      altitudeFt: altMeters === null ? pickFinite(item.alt_geom) : Math.round(altMeters * 3.280_84),
      velocityKts: pickFinite(item.gs, item.velocity),
      heading: pickFinite(item.track, item.heading),
      squawk: pickString(item.squawk),
      lastSeen: parseTimestamp(item.seen, item.last_contact) ?? Date.now(),
      emergency: ['7500', '7600', '7700'].includes(String(item.squawk ?? '')),
    });
  }
  return out;
}
