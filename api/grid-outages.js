import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { readBoundedJson } from './_bounded-json.js';

export const config = { runtime: 'edge' };

const ODIN_ENDPOINT = 'https://openenergyhub.ornl.gov/api/explore/v2.1/catalog/datasets/odin-real-time-outages-county/records';
const TTL_MS = 15 * 60 * 1000;
const EXPIRY_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 128;
const MAX_IN_FLIGHT = 64;
const MAX_ODIN_RESPONSE_BYTES = 512 * 1024;
const cache = new Map();
const inFlight = new Map();

function getCachedResult(key, nowMs) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (nowMs - entry.cachedAt >= TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Refresh insertion order so the fixed-size map behaves as an LRU.
  cache.delete(key);
  cache.set(key, entry);
  return entry.result;
}

function cacheResult(key, result, nowMs) {
  for (const [cachedKey, entry] of cache) {
    if (nowMs - entry.cachedAt >= TTL_MS) cache.delete(cachedKey);
  }
  cache.delete(key);
  while (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { cachedAt: nowMs, result });
}

function boundedString(value, max = 160) {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : undefined;
}

function optionalNonNegativeInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function parseOdinOutagesV1(raw, { fips, nowMs = Date.now() } = {}) {
  if (!raw || !Array.isArray(raw.results)) return { wellFormed: false, outages: [], acceptedRows: 0, droppedRows: 0 };
  const retrievedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + EXPIRY_MS).toISOString();
  const outages = [];
  let droppedRows = 0;
  for (const row of raw.results) {
    const rowFips = typeof row?.communitydescriptor === 'string' && /^\d{5}$/.test(row.communitydescriptor)
      ? row.communitydescriptor : null;
    const customersOut = optionalNonNegativeInteger(row?.metersaffected);
    const county = boundedString(row?.county);
    const state = boundedString(row?.state);
    if (!rowFips || customersOut === undefined || !county || !state || (fips && rowFips !== fips)) {
      droppedRows += 1;
      continue;
    }
    const customersRestored = optionalNonNegativeInteger(row.customersrestored);
    const utilityName = boundedString(row.name);
    const utilityId = boundedString(row.utility_id, 80);
    outages.push({
      fips: rowFips,
      county,
      state,
      customersOut,
      ...(customersRestored === undefined ? {} : { customersRestored }),
      ...(utilityName ? { utilityName } : {}),
      ...(utilityId ? { utilityId } : {}),
      observedAt: retrievedAt,
      retrievedAt,
      expiresAt,
    });
  }
  return { wellFormed: true, outages, acceptedRows: outages.length, droppedRows };
}

function validQuery(searchParams) {
  const keys = [...searchParams.keys()];
  if (keys.some((key) => !['fips', 'limit'].includes(key))) return null;
  if (searchParams.getAll('fips').length > 1 || searchParams.getAll('limit').length > 1) return null;
  const fips = searchParams.get('fips');
  if (fips === null || !/^\d{5}$/.test(fips)) return null;
  const rawLimit = searchParams.get('limit');
  if (rawLimit !== null && !/^[1-9]\d*$/.test(rawLimit)) return null;
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return null;
  return { fips, limit };
}

export function odinPageIsComplete(raw, requestedLimit) {
  if (!raw || !Array.isArray(raw.results) || !Number.isSafeInteger(requestedLimit) || requestedLimit < 1) return false;
  if (raw.results.length > requestedLimit) return false;
  const totalCount = raw.total_count;
  if (totalCount !== undefined && (!Number.isSafeInteger(totalCount) || totalCount < 0)) return false;
  if (Number.isSafeInteger(totalCount) && totalCount > raw.results.length) return false;
  return raw.results.length < requestedLimit || Number.isSafeInteger(totalCount);
}

async function fetchOdin({ fips, limit }, nowMs) {
  const params = new URLSearchParams({ limit: String(limit) });
  params.set('where', `communitydescriptor="${fips}"`);
  let response;
  try {
    response = await fetch(`${ODIN_ENDPOINT}?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
      // Ignored by standards-compliant edge fetch. The desktop sidecar's
      // IPv4 fetch shim consumes this hint to cap bytes before prebuffering.
      maxResponseBytes: MAX_ODIN_RESPONSE_BYTES,
    });
  } catch {
    return { ok: false, reasonCode: 'upstream_unavailable', parsed: null };
  }
  if (!response.ok) return { ok: false, reasonCode: 'upstream_http_error', parsed: null };
  const raw = await readBoundedJson(response, MAX_ODIN_RESPONSE_BYTES).catch(() => null);
  const parsed = parseOdinOutagesV1(raw, { fips, nowMs });
  if (!parsed.wellFormed) return { ok: false, reasonCode: 'malformed_envelope', parsed };
  if (!odinPageIsComplete(raw, limit)) return { ok: false, reasonCode: 'truncated_page', parsed };
  if (raw.results.length > 0 && parsed.acceptedRows === 0) return { ok: false, reasonCode: 'unusable_rows', parsed };
  return { ok: true, parsed };
}

function buildResult(fetchResult, nowMs) {
  const fetchedAt = new Date(nowMs).toISOString();
  if (!fetchResult.ok) {
    const droppedRows = fetchResult.parsed?.droppedRows ?? 0;
    return {
      status: 502,
      body: {
        schemaVersion: 1,
        coverage: 'unknown',
        outages: [],
        provider: { id: 'ornl-odin', state: 'error', acceptedRows: 0, droppedRows, observedAt: fetchedAt, retrievedAt: fetchedAt, reasonCode: fetchResult.reasonCode },
        fetchedAt,
        retrievedAt: fetchedAt,
        degraded: true,
      },
    };
  }
  const { outages, acceptedRows, droppedRows } = fetchResult.parsed;
  let providerState = 'ok';
  if (droppedRows > 0) providerState = 'partial';
  else if (acceptedRows === 0) providerState = 'empty';
  return {
    status: 200,
    body: {
      schemaVersion: 1,
      coverage: acceptedRows > 0 ? 'reported' : 'unknown',
      outages,
      provider: {
        id: 'ornl-odin',
        state: providerState,
        acceptedRows,
        droppedRows,
        observedAt: fetchedAt,
        retrievedAt: fetchedAt,
        ...(droppedRows > 0 ? { reasonCode: 'rows_dropped' } : {}),
      },
      fetchedAt,
      retrievedAt: fetchedAt,
      degraded: droppedRows > 0,
    },
  };
}

function capacityResult(nowMs) {
  const fetchedAt = new Date(nowMs).toISOString();
  return {
    status: 503,
    body: {
      schemaVersion: 1,
      coverage: 'unknown',
      outages: [],
      provider: { id: 'ornl-odin', state: 'error', acceptedRows: 0, droppedRows: 0, observedAt: fetchedAt, retrievedAt: fetchedAt, reasonCode: 'capacity_exceeded' },
      fetchedAt,
      retrievedAt: fetchedAt,
      degraded: true,
    },
  };
}

export async function getGridOutagesForFips(fips, limit = 100, nowMs = Date.now()) {
  if (typeof fips !== 'string' || !/^\d{5}$/.test(fips)
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return null;
  }
  const key = `${fips}:${limit}`;
  const cached = getCachedResult(key, nowMs);
  if (cached) return cached;
  let pending = inFlight.get(key);
  if (!pending) {
    if (inFlight.size >= MAX_IN_FLIGHT) return capacityResult(nowMs);
    pending = fetchOdin({ fips, limit }, nowMs)
      .then((fetchResult) => buildResult(fetchResult, nowMs))
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  const result = await pending;
  if (result.status === 200) cacheResult(key, result, nowMs);
  return result;
}

function json(body, status, cors, extra = {}) {
  return Response.json(body, { status, headers: { 'Content-Type': 'application/json', ...extra, ...cors } });
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405, cors, { Allow: 'GET, OPTIONS' });
  if (isDisallowedOrigin(req)) return json({ error: 'Origin not allowed' }, 403, cors);
  const parsedQuery = validQuery(new URL(req.url).searchParams);
  if (!parsedQuery) return json({ error: 'Invalid grid outage query' }, 400, cors);

  const nowMs = Date.now();
  const result = await getGridOutagesForFips(parsedQuery.fips, parsedQuery.limit, nowMs);
  if (!result) return json({ error: 'Invalid grid outage query' }, 400, cors);
  return json(result.body, result.status, cors, {
    'Cache-Control': result.status === 200 ? 'public, max-age=900' : 'no-store',
    ...(result.status === 503 ? { 'Retry-After': '1' } : {}),
  });
}
