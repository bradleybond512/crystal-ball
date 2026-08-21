import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { readBoundedJson } from './_bounded-json.js';

export const config = { runtime: 'edge' };

const USGS_API_ROOT = 'https://api.waterdata.usgs.gov/ogcapi/v0/collections';
const PARAMETER_CODES = new Set(['00010', '00300', '00400', '00095', '00665', '00631']);
const MAX_FEATURES = 200;
const MAX_USGS_LOCATIONS_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_USGS_LATEST_RESPONSE_BYTES = 2 * 1024 * 1024;

function parseBbox(raw) {
  if (typeof raw !== 'string') return null;
  const parts = raw.split(',');
  if (parts.length !== 4 || parts.some((part) => !/^-?(?:\d+\.?\d*|\.\d+)$/.test(part))) return null;
  const [west, south, east, north] = parts.map(Number);
  if (![west, south, east, north].every(Number.isFinite)
    || west < -180 || east > 180 || south < -90 || north > 90
    || west >= east || south >= north || east - west > 1 || north - south > 1) return null;
  return [west, south, east, north].map((value) => value.toFixed(6)).join(',');
}

function boundedString(value, max = 80) {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : undefined;
}

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isValidRfc3339CivilTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[7] ?? 0);
  const offsetMinute = Number(match[8] ?? 0);
  if (!year || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= (monthDays[month - 1] ?? 0);
}

function recentSourceTime(value, retrievedAtMs) {
  if (typeof value !== 'string' || !isValidRfc3339CivilTime(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= retrievedAtMs - 24 * 60 * 60 * 1000
    && parsed <= retrievedAtMs + 5 * 60 * 1000 ? new Date(parsed).toISOString() : undefined;
}

function isTruncated(raw) {
  return raw?.features?.length >= MAX_FEATURES
    || (Array.isArray(raw?.links) && raw.links.some((link) => link?.rel === 'next'));
}

function normalizeMonitoringLocations(raw, bbox) {
  if (!raw || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features) || isTruncated(raw)) return null;
  const [west, south, east, north] = bbox.split(',').map(Number);
  const locations = new Map();
  for (const feature of raw.features) {
    const properties = feature?.properties;
    const coordinates = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
    const id = boundedString(properties?.id ?? feature?.id, 48);
    const name = boundedString(properties?.monitoring_location_name, 160);
    const lon = finiteNumber(coordinates?.[0]);
    const lat = finiteNumber(coordinates?.[1]);
    if (!id || !id.startsWith('USGS-') || properties?.agency_code !== 'USGS' || properties?.site_type_code !== 'ST'
      || lon === undefined || lat === undefined || lon < west || lon > east || lat < south || lat > north) continue;
    locations.set(id, { name: name ?? id, lat, lon });
  }
  if (raw.features.length > 0 && locations.size === 0) return null;
  return locations;
}

export function normalizeUsgsLatestContinuous(raw, bbox, allowedLocations, retrievedAtMs = Date.now()) {
  if (!raw || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) return null;
  if (isTruncated(raw)) return null;
  const [west, south, east, north] = bbox.split(',').map(Number);
  const features = raw.features.flatMap((feature) => {
    const properties = feature?.properties;
    const coordinates = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
    const parameterCode = boundedString(properties?.parameter_code, 16);
    const siteCode = boundedString(properties?.monitoring_location_id, 48);
    const location = siteCode && allowedLocations ? allowedLocations.get(siteCode) : undefined;
    const value = finiteNumber(properties?.value);
    const sourceTime = recentSourceTime(properties?.time, retrievedAtMs);
    const lon = finiteNumber(coordinates?.[0]);
    const lat = finiteNumber(coordinates?.[1]);
    if (!parameterCode || !PARAMETER_CODES.has(parameterCode) || !siteCode || value === undefined || !sourceTime
      || (allowedLocations && !location)
      || lon === undefined || lat === undefined || lon < west || lon > east || lat < south || lat > north) return [];
    return [{
      type: 'Feature',
      id: boundedString(feature.id, 100),
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        monitoring_location_id: siteCode,
        ...(location ? { monitoring_location_name: location.name } : {}),
        parameter_code: parameterCode,
        value,
        time: sourceTime,
        ...(boundedString(properties.unit_of_measure, 40) ? { unit_of_measure: boundedString(properties.unit_of_measure, 40) } : {}),
      },
    }];
  });
  if (raw.features.length > 0 && features.length === 0) return null;
  return { type: 'FeatureCollection', features, numberReturned: features.length };
}

function json(body, status, cors, extra = {}) {
  return Response.json(body, { status, headers: { 'Content-Type': 'application/json', ...extra, ...cors } });
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405, cors, { Allow: 'GET, OPTIONS' });
  if (isDisallowedOrigin(req)) return json({ error: 'Origin not allowed' }, 403, cors);
  const url = new URL(req.url);
  if ([...url.searchParams.keys()].some((key) => key !== 'bbox') || url.searchParams.getAll('bbox').length !== 1) {
    return json({ error: 'Invalid USGS water query' }, 400, cors);
  }
  const bbox = parseBbox(url.searchParams.get('bbox'));
  if (!bbox) return json({ error: 'Invalid USGS water query' }, 400, cors);
  try {
    const locationsUrl = new URL(`${USGS_API_ROOT}/monitoring-locations/items`);
    locationsUrl.search = new URLSearchParams({
      f: 'json', bbox, agency_code: 'USGS', site_type_code: 'ST', limit: String(MAX_FEATURES),
    }).toString();
    const locationsResponse = await fetch(locationsUrl, {
      headers: { Accept: 'application/geo+json, application/json' },
      signal: AbortSignal.timeout(12_000),
      maxResponseBytes: MAX_USGS_LOCATIONS_RESPONSE_BYTES,
    });
    if (!locationsResponse.ok) return json({ error: 'USGS water source unavailable' }, 502, cors, { 'Cache-Control': 'no-store' });
    const locationsRaw = await readBoundedJson(locationsResponse, MAX_USGS_LOCATIONS_RESPONSE_BYTES).catch(() => null);
    const locations = normalizeMonitoringLocations(locationsRaw, bbox);
    if (!locations) return json({ error: 'USGS monitoring locations response was incomplete or malformed' }, 502, cors, { 'Cache-Control': 'no-store' });
    if (locations.size === 0) {
      return json({ type: 'FeatureCollection', features: [], numberReturned: 0 }, 200, cors, { 'Cache-Control': 'no-store' });
    }
    const latestUrl = new URL(`${USGS_API_ROOT}/latest-continuous/items`);
    latestUrl.search = new URLSearchParams({
      f: 'json', monitoring_location_id: [...locations.keys()].join(','),
      parameter_code: [...PARAMETER_CODES].join(','), limit: String(MAX_FEATURES),
    }).toString();
    const latestResponse = await fetch(latestUrl, {
      headers: { Accept: 'application/geo+json, application/json' },
      signal: AbortSignal.timeout(12_000),
      maxResponseBytes: MAX_USGS_LATEST_RESPONSE_BYTES,
    });
    if (!latestResponse.ok) return json({ error: 'USGS water source unavailable' }, 502, cors, { 'Cache-Control': 'no-store' });
    const latestRaw = await readBoundedJson(latestResponse, MAX_USGS_LATEST_RESPONSE_BYTES).catch(() => null);
    const normalized = normalizeUsgsLatestContinuous(latestRaw, bbox, locations);
    if (!normalized) return json({ error: 'USGS water source returned an incomplete or malformed response' }, 502, cors, { 'Cache-Control': 'no-store' });
    return json(normalized, 200, cors, {
      'Cache-Control': normalized.features.length > 0 ? 'public, max-age=300' : 'no-store',
    });
  } catch {
    return json({ error: 'USGS water source unavailable' }, 502, cors, { 'Cache-Control': 'no-store' });
  }
}
