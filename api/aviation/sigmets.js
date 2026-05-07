/**
 * Aviation Weather Center SIGMET / AIRMET proxy.
 * Upstreams (free, no key):
 *   - SIGMETs:  https://aviationweather.gov/cgi-bin/json/SigmetJSON.php
 *   - AIRMETs:  https://aviationweather.gov/cgi-bin/json/AirmetJSON.php
 */

import {
  degraded,
  envelope,
  extractItems,
  fetchUpstream,
  jsonResponse,
  parseTimestamp,
  pickString,
  preflight,
  withCache,
} from './_aviation-helpers.js';

export const config = { runtime: 'edge' };

const SOURCE = 'aviationweather.gov';
const CACHE_KEY = 'aviation:sigmets';

function inferHazard(rawHazard, text) {
  const raw = (typeof rawHazard === 'string' ? rawHazard : '').toUpperCase();
  if (raw.includes('VA') || /VOLCANIC ASH|ASHTOPS/i.test(text)) return 'volcanic_ash';
  if (raw.includes('TURB') || /\bTURB|TURBULENCE\b/i.test(text)) return 'turbulence';
  if (raw.includes('ICE') || /\bICE|ICING\b/i.test(text)) return 'icing';
  if (raw.includes('TS') || /TS\b|THUNDERSTORM/i.test(text)) return 'thunderstorm';
  if (raw === 'MTN OBSCN' || /MTN OBSCN|MOUNTAIN OBSCURATION/i.test(text)) return 'mountain_obscuration';
  if (raw === 'IFR' || /\bIFR\b/i.test(text)) return 'ifr';
  return 'other';
}

function inferSeverity(rawSeverity, text) {
  const raw = (typeof rawSeverity === 'string' ? rawSeverity : '').toUpperCase();
  if (raw.includes('SEV') || /SEVERE/i.test(text)) return 'severe';
  if (raw.includes('EXTRM') || /EXTREME/i.test(text)) return 'extreme';
  if (raw.includes('MOD') || /MODERATE|MOD\b/i.test(text)) return 'moderate';
  return 'light';
}

function ddmToDecimal(deg, min, hemi) {
  const d = Number.parseInt(deg, 10);
  const m = Number.parseInt(min, 10);
  if (!Number.isFinite(d) || !Number.isFinite(m)) return null;
  return (d + m / 60) * (hemi === 'S' || hemi === 'W' ? -1 : 1);
}

const SIG_AREA_RE = /(\d{2,3})(\d{2})([NS])\s+(\d{2,3})(\d{2})([EW])/g;

function parseAreaString(s) {
  const out = [];
  for (const m of String(s).matchAll(SIG_AREA_RE)) {
    const lat = ddmToDecimal(m[1], m[2], m[3]);
    const lon = ddmToDecimal(m[4], m[5], m[6]);
    if (lat !== null && lon !== null) out.push({ lat, lon });
  }
  return out;
}

function parseLonLatPairs(arr) {
  const out = [];
  for (const pt of arr) {
    if (Array.isArray(pt) && pt.length >= 2) {
      const lon = Number(pt[0]);
      const lat = Number(pt[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) out.push({ lat, lon });
    } else if (pt && typeof pt === 'object') {
      const lat = Number(pt.lat ?? pt.latitude);
      const lon = Number(pt.lon ?? pt.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) out.push({ lat, lon });
    }
  }
  return out;
}

function extractPolygon(geometry, coords, area) {
  if (geometry && geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    const ring = geometry.coordinates[0];
    if (Array.isArray(ring)) return parseLonLatPairs(ring);
  }
  if (Array.isArray(coords)) return parseLonLatPairs(coords);
  if (typeof area === 'string') return parseAreaString(area);
  return [];
}

const SIG_FL_RANGE_RE = /FL\s*(\d{2,3})\s*[-/]\s*FL?\s*(\d{2,3})/i;

function extractAltitude(low, hi, text) {
  const lo = Number(low);
  const high = Number(hi);
  if (Number.isFinite(lo) && Number.isFinite(high)) return { min: lo, max: high };
  const m = text.match(SIG_FL_RANGE_RE);
  if (m) return { min: Number.parseInt(m[1], 10) * 100, max: Number.parseInt(m[2], 10) * 100 };
  return undefined;
}

function normalizeSigmet(item, idx, isAirmet) {
  if (!item || typeof item !== 'object') return null;
  const props = item.properties ?? item;
  const text = pickString(props.rawSigmet, props.rawAirmet, props.text, props.rawAir, props.rawSig);
  if (!text) return null;
  const altitudeFt = extractAltitude(props.altitudeLow1, props.altitudeHi1, text);
  return {
    id: pickString(props.id, props.airSigmetId) ?? `sigmet-${idx}`,
    hazard: inferHazard(props.hazard, text),
    severity: inferSeverity(props.severity, text),
    ...(altitudeFt ? { altitudeFt } : {}),
    polygon: extractPolygon(item.geometry, props.coords, props.area),
    text: text.trim(),
    validFrom: parseTimestamp(props.validTimeFrom, props.validFrom) ?? Date.now(),
    validTo: parseTimestamp(props.validTimeTo, props.validTo) ?? Date.now() + 6 * 3_600_000,
    isAirmet,
  };
}

async function readSettled(settled, keys, isAirmet) {
  if (settled.status !== 'fulfilled' || !settled.value.ok) return null;
  const payload = await settled.value.json();
  const items = extractItems(payload, keys);
  const out = [];
  for (const [idx, item] of items.entries()) {
    const norm = normalizeSigmet(item, idx, isAirmet);
    if (norm) out.push(norm);
  }
  return out;
}

async function fetchSigmets() {
  const [sigResp, airResp] = await Promise.allSettled([
    fetchUpstream('https://aviationweather.gov/cgi-bin/json/SigmetJSON.php'),
    fetchUpstream('https://aviationweather.gov/cgi-bin/json/AirmetJSON.php'),
  ]);
  const sigmets = await readSettled(sigResp, ['data', 'features', 'sigmets'], false);
  const airmets = await readSettled(airResp, ['data', 'features', 'airmets'], true);
  const out = [...(sigmets ?? []), ...(airmets ?? [])];
  const reasons = [];
  if (sigmets === null) reasons.push('SIGMET upstream failed');
  if (airmets === null) reasons.push('AIRMET upstream failed');
  if (out.length === 0 && reasons.length > 0) {
    return degraded(reasons.join('; '), SOURCE);
  }
  const env = envelope(out, SOURCE);
  if (reasons.length > 0) {
    return { ...env, degraded: true, reason: reasons.join('; ') };
  }
  return env;
}

export default async function handler(req) {
  const { cors, response } = preflight(req, 'GET, OPTIONS');
  if (response) return response;
  const result = await withCache(CACHE_KEY, SOURCE, fetchSigmets);
  return jsonResponse(result, 200, cors);
}
