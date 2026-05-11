/**
 * VAAC volcanic ash advisory proxy.
 *
 * Upstream: https://aviationweather.gov/cgi-bin/json/VolcanoJSON.php
 * Free, no key. The endpoint sometimes returns an empty array even
 * when active advisories exist — that's authoritative.
 */

import {
  envelope,
  extractItems,
  fetchUpstream,
  jsonResponse,
  parseTimestamp,
  pickFinite,
  pickString,
  preflight,
  withCache,
} from './_aviation-helpers.js';

export const config = { runtime: 'edge' };

const SOURCE = 'aviationweather.gov/volcano';
const CACHE_KEY = 'aviation:volcanic-ash';

function parseLonLatPairs(arr) {
  const out = [];
  for (const pt of arr) {
    if (Array.isArray(pt) && pt.length >= 2) {
      const lon = Number(pt[0]);
      const lat = Number(pt[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) out.push({ lat, lon });
    }
  }
  return out;
}

function extractPolygon(geometry) {
  if (geometry && geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    const ring = geometry.coordinates[0];
    if (Array.isArray(ring)) return parseLonLatPairs(ring);
  }
  return [];
}

function normalizeAdvisory(item, idx) {
  if (!item || typeof item !== 'object') return null;
  const props = item.properties ?? item;
  const polygon = extractPolygon(item.geometry);
  if (polygon.length < 3) return null;
  return {
    id: pickString(props.id, props.advisoryId) ?? `vaac-${idx}`,
    volcano: pickString(props.volcano, props.name) ?? 'unknown',
    polygon,
    altitudeFt: {
      min: pickFinite(props.altitudeLow, props.minAlt) ?? 0,
      max: pickFinite(props.altitudeHi, props.maxAlt) ?? 0,
    },
    validFrom: parseTimestamp(props.validFrom, props.startTime) ?? Date.now(),
    validTo: parseTimestamp(props.validTo, props.endTime) ?? Date.now() + 6 * 3_600_000,
    source: 'NOAA',
    text: pickString(props.text, props.advisoryText, props.rawText) ?? '',
  };
}

async function fetchVolcanicAsh() {
  const response = await fetchUpstream(
    'https://aviationweather.gov/cgi-bin/json/VolcanoJSON.php',
  );
  if (!response.ok) {
    throw new Error(`Volcano upstream HTTP ${response.status}`);
  }
  const payload = await response.json();
  const items = extractItems(payload, ['data', 'features', 'volcanoes', 'advisories']);
  const out = [];
  for (const [idx, item] of items.entries()) {
    const norm = normalizeAdvisory(item, idx);
    if (norm) out.push(norm);
  }
  return envelope(out, SOURCE);
}

export default async function handler(req) {
  const { cors, response } = preflight(req, 'GET, OPTIONS');
  if (response) return response;
  const result = await withCache(CACHE_KEY, SOURCE, fetchVolcanicAsh);
  return jsonResponse(result, 200, cors);
}
