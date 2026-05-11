/**
 * FAA NOTAM proxy — TFRs and FDC NOTAMs.
 *
 * Upstream: https://external-api.faa.gov/notamapi/v1/notams
 * Note: FAA's NOTAM API requires `client_id` + `client_secret` query
 * params (developer signup at developer.faa.gov is free). When the
 * env vars are missing the route returns a degraded envelope instead
 * of a 5xx, so the panel renders gracefully on first install.
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

const SOURCE = 'faa.gov/notamapi';
const CACHE_KEY = 'aviation:notams';

function normalizeClassification(rawClassification, text) {
  const upper = (rawClassification ?? '').toUpperCase();
  if (upper === 'FDC' || /TFR/i.test(text)) return /TFR/i.test(text) ? 'TFR' : 'FDC';
  if (upper === 'DOM' || upper === 'INTL') return upper;
  return 'OTHER';
}

function ddmToDecimal(deg, min, hemi) {
  const d = Number.parseInt(deg, 10);
  const m = Number.parseInt(min, 10);
  if (!Number.isFinite(d) || !Number.isFinite(m)) return null;
  const sign = hemi === 'S' || hemi === 'W' ? -1 : 1;
  return (d + m / 60) * sign;
}

const NOTAM_LAT_RE = /(\d{1,2})(\d{2})([NS])/;
const NOTAM_LON_RE = /(\d{1,3})(\d{2})([EW])/;
const NOTAM_RAD_RE = /(\d{1,3})\s*NM/i;

function parseCenterRadius(text) {
  const lat = text.match(NOTAM_LAT_RE);
  const lon = text.match(NOTAM_LON_RE);
  const r = text.match(NOTAM_RAD_RE);
  if (!lat || !lon || !r) return undefined;
  const latDec = ddmToDecimal(lat[1], lat[2], lat[3]);
  const lonDec = ddmToDecimal(lon[1], lon[2], lon[3]);
  const radiusNm = Number.parseInt(r[1], 10);
  if (latDec === null || lonDec === null || !Number.isFinite(radiusNm)) return undefined;
  return { lat: latDec, lon: lonDec, radiusNm };
}

const NOTAM_FL_RE = /(?:SFC|GND).*?FL\s?(\d{2,3})/i;
const NOTAM_FT_RE = /(\d{3,5})\s*FT?\s*MSL/i;

function parseAltitudeBand(text) {
  const fl = text.match(NOTAM_FL_RE);
  if (fl) return { min: 0, max: Number.parseInt(fl[1], 10) * 100 };
  const ft = text.match(NOTAM_FT_RE);
  if (ft) return { min: 0, max: Number.parseInt(ft[1], 10) };
  return undefined;
}

function normalizeNotamItem(item, idx) {
  if (!item || typeof item !== 'object') return null;
  const props = item.properties ?? item;
  const core = props.coreNOTAMData ?? props.notamTranslation ?? props;
  const notam = core.notam ?? core;
  const text = pickString(notam.text, notam.message, notam.simpleText, notam.notamText, props.notamText);
  if (!text) return null;
  const notamNumber = pickString(notam.number, notam.notamNumber, notam.id) ?? '';
  const classifierRaw = pickString(notam.classification, notam.notamType, props.classification);
  const classification = normalizeClassification(classifierRaw, text);
  const center = parseCenterRadius(text);
  const altitudeFt = parseAltitudeBand(text);
  return {
    id: notamNumber || `notam-${idx}`,
    notamNumber,
    classification,
    affectedFir: pickString(notam.affectedFIR, notam.fir),
    featureName: pickString(notam.featureName, notam.feature),
    icaoId: pickString(notam.icaoLocation, notam.location, notam.icaoId),
    text: text.trim(),
    effectiveStart: parseTimestamp(notam.effectiveStart, notam.startDate),
    effectiveEnd: parseTimestamp(notam.effectiveEnd, notam.endDate),
    ...(center ? { center } : {}),
    ...(altitudeFt ? { altitudeFt } : {}),
    presidential: /\bpresidential|VIP movement|VIP\b/i.test(text),
  };
}

async function fetchNotams() {
  const clientId = process.env.FAA_NOTAM_CLIENT_ID;
  const clientSecret = process.env.FAA_NOTAM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return degraded(
      'FAA NOTAM credentials not configured — set FAA_NOTAM_CLIENT_ID/SECRET env vars',
      SOURCE,
    );
  }
  const params = new URLSearchParams({
    pageSize: '100',
    pageNum: '0',
    notamType: 'NOTAM',
    classification: 'FDC,DOM',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const url = `https://external-api.faa.gov/notamapi/v1/notams?${params}`;
  const response = await fetchUpstream(url);
  if (!response.ok) {
    return degraded(`FAA upstream HTTP ${response.status}`, SOURCE);
  }
  const payload = await response.json();
  const items = extractItems(payload, ['items', 'data', 'notams']);
  const data = items
    .map((item, idx) => normalizeNotamItem(item, idx))
    .filter(Boolean);
  return envelope(data, SOURCE);
}

export default async function handler(req) {
  const { cors, response } = preflight(req, 'GET, OPTIONS');
  if (response) return response;
  const result = await withCache(CACHE_KEY, SOURCE, fetchNotams);
  return jsonResponse(result, 200, cors);
}
