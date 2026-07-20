#!/usr/bin/env node
/**
 * FAA TFR (Temporary Flight Restriction) parser.
 *
 * Two-phase fetch (migrated 2026-06 to the FAA "tfr3" site — the old
 * tfr2/list.html + save_pages/detail_*.xml endpoints now 302-redirect to
 * /tfr3/, and the sidecar fetcher does not follow redirects):
 * 1. GET https://tfr.faa.gov/tfrapi/exportTfrList — JSON list of NOTAM ids
 * 2. GET https://tfr.faa.gov/download/detail_{id}.xml — XNOTAM polygon XML
 *    (the NOTAM id's "/" becomes "_": "6/1748" → detail_6_1748.xml)
 *
 * The XML/HTML parsers still accept the legacy schemas (<Point>/<Lat>/<Lon>,
 * save_pages href links) so older fixtures and any cached responses keep
 * working; new TFR3 responses use the XNOTAM <Avx><geoLat>/<geoLong> schema.
 *
 * Exported for direct unit testing; the sidecar imports and wraps this.
 */

/** @typedef {{ id: string, notamNumber: string, type: 'VIP'|'Security'|'Fire'|'Other', altFloor: number|null, altCeiling: number|null, effectiveStart: string|null, effectiveEnd: string|null, polygon: Array<[number,number]>, center: [number,number]|null }} FaaTfr */

const TFR_LIST_URL = 'https://tfr.faa.gov/tfrapi/exportTfrList';
const TFR_DETAIL_BASE = 'https://tfr.faa.gov/download/detail_';
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36';

function parseAlt(s) {
  if (!s) return null;
  const n = Number.parseInt(s.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse an XNOTAM geo coordinate like "46.11666667N" / "118.95833333W" into a
 * signed decimal degree (N/E positive, S/W negative). Plain signed decimals
 * (no hemisphere letter) pass through unchanged.
 * @param {string} raw
 * @returns {number|null}
 */
function parseGeoCoord(raw) {
  if (raw === undefined || raw === null) return null;
  const m = String(raw).trim().match(/^(-?\d+(?:\.\d+)?)([NSEW])?$/i);
  if (!m) return null;
  let v = Number.parseFloat(m[1]);
  if (!Number.isFinite(v)) return null;
  const hemi = (m[2] || '').toUpperCase();
  if (hemi === 'S' || hemi === 'W') v = -Math.abs(v);
  return v;
}

/**
 * Return the first capture group from the first regex that matches, else
 * undefined. Keeps the multi-schema field extractors flat and readable.
 * @param {string} xml
 * @param {RegExp[]} patterns
 * @returns {string|undefined}
 */
function firstGroup(xml, patterns) {
  for (const re of patterns) {
    const m = xml.match(re);
    if (m) return m[1];
  }
  return undefined;
}

function classifyTfrType(rawType, xml) {
  if (/vip|presidential|p-\d+/.test(rawType) || /[\s>]POTUS[\s<]/.test(xml)) return 'VIP';
  if (/security|national security/.test(rawType)) return 'Security';
  if (/fire|wildfire|forest/.test(rawType)) return 'Fire';
  return 'Other';
}

// Legacy <Point><Lat>..</Lat><Lon>..</Lon></Point> vertices.
function pointsFromPointEls(xml) {
  const polygon = [];
  for (const pm of xml.matchAll(/<Point[^>]*>([\s\S]*?)<\/Point>/gi)) {
    const block = pm[1];
    const latM = block.match(/<Lat[^>]*>([^<]+)<\/Lat>/i);
    const lonM = block.match(/<Lon[^>]*>([^<]+)<\/Lon>/i);
    const lat = latM ? Number.parseFloat(latM[1]) : Number.NaN;
    const lon = lonM ? Number.parseFloat(lonM[1]) : Number.NaN;
    if (Number.isFinite(lat) && Number.isFinite(lon)) polygon.push([lon, lat]);
  }
  return polygon;
}

// TFR3 XNOTAM schema: <Avx><geoLat>46.11N</geoLat><geoLong>118.95W</geoLong></Avx>
function pointsFromAvx(xml) {
  const polygon = [];
  for (const am of xml.matchAll(/<Avx\b[^>]*>([\s\S]*?)<\/Avx>/gi)) {
    const block = am[1];
    const latM = block.match(/<geoLat[^>]*>([^<]+)<\/geoLat>/i);
    const lonM = block.match(/<geoLong[^>]*>([^<]+)<\/geoLong>/i);
    const lat = latM ? parseGeoCoord(latM[1]) : null;
    const lon = lonM ? parseGeoCoord(lonM[1]) : null;
    if (lat !== null && lon !== null) polygon.push([lon, lat]);
  }
  return polygon;
}

// Flat <latitude>/<longitude> pair fallback.
function pointsFromFlatLatLon(xml) {
  const polygon = [];
  const lats = [...xml.matchAll(/<latitude[^>]*>([^<]+)<\/latitude>/gi)].map((mm) => Number.parseFloat(mm[1]));
  const lons = [...xml.matchAll(/<longitude[^>]*>([^<]+)<\/longitude>/gi)].map((mm) => Number.parseFloat(mm[1]));
  for (let i = 0; i < Math.min(lats.length, lons.length); i++) {
    if (Number.isFinite(lats[i]) && Number.isFinite(lons[i])) polygon.push([lons[i], lats[i]]);
  }
  return polygon;
}

function extractPolygonPoints(xml) {
  const fromPoint = pointsFromPointEls(xml);
  if (fromPoint.length > 0) return fromPoint;
  const fromAvx = pointsFromAvx(xml);
  if (fromAvx.length > 0) return fromAvx;
  return pointsFromFlatLatLon(xml);
}

function computeCenter(polygon, xml) {
  if (polygon.length > 0) {
    const avgLon = polygon.reduce((s, p) => s + p[0], 0) / polygon.length;
    const avgLat = polygon.reduce((s, p) => s + p[1], 0) / polygon.length;
    return [avgLon, avgLat];
  }
  const latM = /<Lat[^>]*>([^<]+)<\/Lat>/i.exec(xml);
  const lonM = /<Lon[^>]*>([^<]+)<\/Lon>/i.exec(xml);
  if (latM && lonM) {
    const lat = Number.parseFloat(latM[1]);
    const lon = Number.parseFloat(lonM[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return [lon, lat];
  }
  // TFR3 XNOTAM center fallback (circle/point-only restrictions).
  const gLatM = xml.match(/<geoLat[^>]*>([^<]+)<\/geoLat>/i);
  const gLonM = xml.match(/<geoLong[^>]*>([^<]+)<\/geoLong>/i);
  if (gLatM && gLonM) {
    const lat = parseGeoCoord(gLatM[1]);
    const lon = parseGeoCoord(gLonM[1]);
    if (lat !== null && lon !== null) return [lon, lat];
  }
  return null;
}

/**
 * Extract NOTAM IDs from the FAA TFR list payload.
 *
 * Primary: the TFR3 JSON list (`[{ "notam_id": "6/1748", ... }, ...]`).
 * Fallback: the legacy list HTML, which embeds href links like
 * /save_pages/detail_1_0_1234567.xml.
 * @param {string} payload
 * @returns {string[]}
 */
function notamIdsFromJson(trimmed) {
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null;
  let data;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return null; // Not JSON after all — caller falls back to HTML scraping.
  }
  let rows = [];
  if (Array.isArray(data)) rows = data;
  else if (Array.isArray(data?.tfrList)) rows = data.tfrList;
  const ids = [];
  for (const row of rows) {
    const id = String(row?.notam_id ?? row?.notamId ?? '').trim();
    // Guard the charset before it becomes part of a fetch URL (the id is only
    // ever digits / "/" / "_" / "-" in practice — no dots or traversal).
    if (id && /^[\w/-]+$/.test(id)) ids.push(id);
  }
  return ids;
}

function notamIdsFromHtml(trimmed) {
  const ids = new Set();
  for (const m of trimmed.matchAll(/href="\/save_pages\/detail_([^"]+)\.(?:xml|html)"/gi)) {
    const id = m[1].trim();
    if (id) ids.add(id);
  }
  for (const m of trimmed.matchAll(/detail_(\d+_\d+_\d+)/g)) {
    ids.add(m[1].trim());
  }
  return [...ids];
}

export function extractNotamIds(payload) {
  if (typeof payload !== 'string') return [];
  const trimmed = payload.trim();
  const fromJson = notamIdsFromJson(trimmed);
  if (fromJson && fromJson.length > 0) return [...new Set(fromJson)];
  return notamIdsFromHtml(trimmed);
}

/**
 * Parse a single TFR detail XML into a structured object.
 * Returns null if the XML cannot be parsed meaningfully.
 *
 * @param {string} id - NOTAM ID (e.g. "1_0_1234567")
 * @param {string} xml - raw XML text
 * @returns {FaaTfr|null}
 */
export function parseTfrXml(id, xml) {
  if (!xml || typeof xml !== 'string') return null;

  const notamNumber = firstGroup(xml, [
    /<Notam_Number[^>]*>([^<]+)<\/Notam_Number>/i,
    /<notamNumber[^>]*>([^<]+)<\/notamNumber>/i,
    /<facility[^>]*type="NOTAM_NUMBER"[^>]*>([^<]+)<\/facility>/i,
    /<txtLocalName[^>]*>([^<]+)<\/txtLocalName>/i, // TFR3
  ])?.trim() ?? id;

  // Type hint: legacy fields first, then the TFR3 purpose text / reg-code.
  const typeHint = firstGroup(xml, [
    /<Txt_type[^>]*>([^<]+)<\/Txt_type>/i,
    /<type[^>]*>([^<]+)<\/type>/i,
    /<reason[^>]*>([^<]+)<\/reason>/i,
    /<txtDescrPurpose[^>]*>([^<]+)<\/txtDescrPurpose>/i, // TFR3
    /<codeType[^>]*>([^<]+)<\/codeType>/i, // TFR3
  ]) ?? '';
  const type = classifyTfrType(typeHint.toLowerCase(), xml);

  const altFloor = parseAlt(firstGroup(xml, [
    /<Altitude_floor[^>]*>([^<]+)<\/Altitude_floor>/i,
    /<lower[^>]*>([^<]+)<\/lower>/i,
    /<valDistVerLower[^>]*>([^<]+)<\/valDistVerLower>/i, // TFR3
  ]));
  const altCeiling = parseAlt(firstGroup(xml, [
    /<Altitude_ceiling[^>]*>([^<]+)<\/Altitude_ceiling>/i,
    /<upper[^>]*>([^<]+)<\/upper>/i,
    /<valDistVerUpper[^>]*>([^<]+)<\/valDistVerUpper>/i, // TFR3
  ]));

  const effectiveStart = firstGroup(xml, [
    /<Effective_Date[^>]*>([^<]+)<\/Effective_Date>/i,
    /<effectiveDate[^>]*>([^<]+)<\/effectiveDate>/i,
    /<startDate[^>]*>([^<]+)<\/startDate>/i,
    /<dateEffective[^>]*>([^<]+)<\/dateEffective>/i, // TFR3
  ])?.trim() ?? null;
  const effectiveEnd = firstGroup(xml, [
    /<Expire_Date[^>]*>([^<]+)<\/Expire_Date>/i,
    /<expireDate[^>]*>([^<]+)<\/expireDate>/i,
    /<endDate[^>]*>([^<]+)<\/endDate>/i,
    /<dateExpire[^>]*>([^<]+)<\/dateExpire>/i, // TFR3
  ])?.trim() ?? null;

  const polygon = extractPolygonPoints(xml);
  const center = computeCenter(polygon, xml);

  return { id, notamNumber, type, altFloor, altCeiling, effectiveStart, effectiveEnd, polygon, center };
}

/**
 * Map TFR type to RGBA color for globe rendering.
 * @param {'VIP'|'Security'|'Fire'|'Other'} type
 * @returns {[number,number,number,number]}
 */
export function tfrColor(type) {
  switch (type) {
    case 'VIP':
    case 'Security': { return [220, 53, 69, 200];
    }
    case 'Fire': { return [255, 140, 0, 180];
    }
    default: { return [74, 158, 255, 160];
    }
  }
}

/**
 * Build the detail-XML URL for a NOTAM id. TFR3 ids carry a "/" (e.g.
 * "6/1748") which maps to "_" in the download path (detail_6_1748.xml).
 * Legacy underscore ids ("1_0_1234567") pass through unchanged.
 * @param {string} id
 * @returns {string}
 */
export function detailUrlForId(id) {
  return `${TFR_DETAIL_BASE}${String(id).replace(/\//g, '_')}.xml`;
}

/**
 * Fetch the FAA TFR list and extract NOTAM IDs. Primary source is the TFR3
 * JSON list endpoint; {@link extractNotamIds} also accepts legacy list HTML.
 * @param {(url: string, opts: object, timeoutMs: number) => Promise<Response>} fetcher
 * @returns {Promise<string[]>}
 */
export async function fetchTfrIds(fetcher) {
  const resp = await fetcher(
    TFR_LIST_URL,
    { headers: { 'User-Agent': CHROME_UA, Accept: 'application/json, text/html' } },
    15_000,
  );
  if (!resp.ok) throw new Error(`TFR list HTTP ${resp.status}`);
  const text = await resp.text();
  assertParsableTfrList(text);
  return extractNotamIds(text);
}

/**
 * The tfr3 list endpoint returns a JSON array. A JSON-shaped body that fails to
 * parse — or parses to an unexpected shape — is an upstream schema/API break:
 * throw so `/api/aviation/tfrs` degrades instead of reporting a "healthy" empty
 * feed. A valid empty array is a legitimate "no active TFRs" response and is
 * left to {@link extractNotamIds}. Non-JSON bodies use the legacy HTML path.
 * @param {string} text
 */
function assertParsableTfrList(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return;
  let data;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new Error('TFR list JSON parse error');
  }
  if (!Array.isArray(data) && !Array.isArray(data?.tfrList)) {
    throw new TypeError('TFR list JSON shape unexpected');
  }
}

/**
 * Fetch and parse one TFR detail XML.
 * Returns null on any failure — partial list is acceptable.
 * @param {string} id
 * @param {(url: string, opts: object, timeoutMs: number) => Promise<Response>} fetcher
 * @returns {Promise<FaaTfr|null>}
 */
export async function fetchTfrDetail(id, fetcher) {
  try {
    const url = detailUrlForId(id);
    const resp = await fetcher(url, { headers: { 'User-Agent': CHROME_UA, Accept: 'application/xml, text/xml' } }, 10_000);
    if (!resp.ok) return null;
    const xml = await resp.text();
    return parseTfrXml(id, xml);
  } catch {
    return null;
  }
}

/**
 * Full TFR fetch pipeline: JSON list → concurrent detail XML fetches.
 * Batches to 20 concurrent requests to stay polite to FAA servers.
 * @param {(url: string, opts: object, timeoutMs: number) => Promise<Response>} fetcher
 * @returns {Promise<FaaTfr[]>}
 */
export async function fetchAllTfrs(fetcher) {
  const ids = await fetchTfrIds(fetcher);
  const CONCURRENCY = 20;
  const results = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((id) => fetchTfrDetail(id, fetcher)));
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value) results.push(s.value);
    }
  }
  return results;
}
