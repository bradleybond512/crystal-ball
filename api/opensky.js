import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

function getRelayBaseUrl() {
  const relayUrl = process.env.WS_RELAY_URL;
  if (!relayUrl) return null;
  return relayUrl.replace('wss://', 'https://').replace('ws://', 'http://').replace(/\/$/, '');
}

function getRelayHeaders(baseHeaders = {}) {
  const headers = { ...baseHeaders };
  const relaySecret = process.env.RELAY_SHARED_SECRET || '';
  if (relaySecret) {
 const relayHeader = (process.env.RELAY_AUTH_HEADER || 'x-relay-key').toLowerCase();
 headers[relayHeader] = relaySecret;
 headers.Authorization = `Bearer ${relaySecret}`;
  }
  return headers;
}

async function fetchWithTimeout(url, options, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
 return await fetch(url, { ...options, signal: controller.signal });
  } finally {
 clearTimeout(timeout);
  }
}

// Free, no-key ADS-B aggregators that publish full /v2/mil snapshots in
// the same shape. Used as a fallback when the OpenSky relay is degraded.
const ADSB_FALLBACK_URLS = [
  'https://api.adsb.lol/v2/mil',
  'https://api.airplanes.live/v2/mil',
  'https://opendata.adsb.fi/api/v2/mil',
];

function adsbToOpenSkyState(a) {
  const lon = typeof a?.lon === 'number' ? a.lon : null;
  const lat = typeof a?.lat === 'number' ? a.lat : null;
  if (lon === null || lat === null) return null;
  const baroAltM = typeof a?.alt_baro === 'number' ? a.alt_baro * 0.3048 : null;
  const geomAltM = typeof a?.alt_geom === 'number' ? a.alt_geom * 0.3048 : null;
  const velMs = typeof a?.gs === 'number' ? a.gs * 0.514_444 : null;
  const vertRate = typeof a?.baro_rate === 'number' ? a.baro_rate * 0.005_08 : null;
  return [
 String(a?.hex ?? '').toLowerCase(),       // 0  icao24
 (a?.flight ?? '').trim(),                 // 1  callsign
 a?.r || '',                               // 2  origin_country (registration prefix)
 typeof a?.seen_pos === 'number' ? Math.floor(Date.now() / 1000 - a.seen_pos) : null, // 3 time_position
 Math.floor(Date.now() / 1000),            // 4  last_contact
 lon,                                      // 5  longitude
 lat,                                      // 6  latitude
 baroAltM,                                 // 7  baro_altitude (m)
 Boolean(a?.alt_baro === 'ground'),        // 8  on_ground
 velMs,                                    // 9  velocity (m/s)
 typeof a?.track === 'number' ? a.track : null, // 10 true_track
 vertRate,                                 // 11 vertical_rate (m/s)
 null,                                     // 12 sensors
 geomAltM,                                 // 13 geo_altitude
 a?.squawk || null,                        // 14 squawk
 false,                                    // 15 spi
 0,                                        // 16 position_source
  ];
}

function inBbox(state, params) {
  const lat = state[6];
  const lon = state[5];
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  const lamin = params.lamin === undefined ? -90 : Number(params.lamin);
  const lamax = params.lamax === undefined ? 90 : Number(params.lamax);
  const lomin = params.lomin === undefined ? -180 : Number(params.lomin);
  const lomax = params.lomax === undefined ? 180 : Number(params.lomax);
  return lat >= lamin && lat <= lamax && lon >= lomin && lon <= lomax;
}

async function fetchAdsbFallback(safeParams) {
  const params = Object.fromEntries(safeParams.entries());
  for (const url of ADSB_FALLBACK_URLS) {
 try {
 const res = await fetchWithTimeout(url, {
 headers: { 'User-Agent': 'CrystalBall/2.10 (+https://github.com/bradleybond512/crystal-ball)' },
 }, 10_000);
 if (!res.ok) continue;
 const payload = await res.json();
 if (!Array.isArray(payload?.ac)) continue;
 const states = payload.ac
 .map((a) => adsbToOpenSkyState(a))
 .filter((s) => s !== null && inBbox(s, params));
 return { time: Math.floor(Date.now() / 1000), states, source: new URL(url).hostname };
 } catch {
 // try next provider
 }
  }
  return null;
}

function parseSafeParams(requestUrl) {
  const safeParams = new URLSearchParams();
  const bounds = [['lamin', -90, 90], ['lamax', -90, 90], ['lomin', -180, 180], ['lomax', -180, 180]];
  for (const [key, min, max] of bounds) {
 const val = requestUrl.searchParams.get(key);
 const num = val === null ? Number.NaN : Number(val);
 if (Number.isFinite(num) && num >= min && num <= max) safeParams.set(key, String(num));
  }
  return safeParams;
}

async function tryAdsbFallback(safeParams, corsHeaders) {
  const fb = await fetchAdsbFallback(safeParams);
  if (!fb) return null;
  return Response.json(fb, {
 status: 200,
 headers: {
 'Content-Type': 'application/json',
 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
 'X-OpenSky-Fallback': fb.source,
 ...corsHeaders,
 },
  });
}

function rejectMethod(req, corsHeaders) {
  if (isDisallowedOrigin(req)) {
 return Response.json({ error: 'Origin not allowed' }, {
 status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders },
 });
  }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'GET') {
 return Response.json({ error: 'Method not allowed' }, {
 status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders },
 });
  }
  return null;
}

async function fetchFromRelay(relayBaseUrl, safeParams, corsHeaders) {
  const safeSearch = safeParams.toString() ? `?${safeParams.toString()}` : '';
  const relayUrl = `${relayBaseUrl}/opensky${safeSearch}`;
  const response = await fetchWithTimeout(relayUrl, {
 headers: getRelayHeaders({ Accept: 'application/json' }),
  });
  if (response.status >= 500 || response.status === 429) {
 const fb = await tryAdsbFallback(safeParams, corsHeaders);
 if (fb) return fb;
  }
  const body = await response.text();
  const headers = {
 'Content-Type': response.headers.get('content-type') || 'application/json',
 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=60',
 ...corsHeaders,
  };
  const xCache = response.headers.get('x-cache');
  if (xCache) headers['X-Cache'] = xCache;
  return new Response(body, { status: response.status, headers });
}

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');
  const rejected = rejectMethod(req, corsHeaders);
  if (rejected) return rejected;

  const safeParams = parseSafeParams(new URL(req.url));
  const relayBaseUrl = getRelayBaseUrl();

  if (!relayBaseUrl) {
 const fb = await tryAdsbFallback(safeParams, corsHeaders);
 if (fb) return fb;
 return Response.json({ error: 'WS_RELAY_URL is not configured and no ADS-B fallback succeeded' }, {
 status: 503, headers: { 'Content-Type': 'application/json', ...corsHeaders },
 });
  }

  try {
 return await fetchFromRelay(relayBaseUrl, safeParams, corsHeaders);
  } catch (error) {
 const fb = await tryAdsbFallback(safeParams, corsHeaders);
 if (fb) return fb;
 const isTimeout = error?.name === 'AbortError';
 return Response.json({
 error: isTimeout ? 'Relay timeout' : 'Relay request failed',
 details: error?.message || String(error),
 }, {
 status: isTimeout ? 504 : 502,
 headers: { 'Content-Type': 'application/json', ...corsHeaders },
 });
  }
}
