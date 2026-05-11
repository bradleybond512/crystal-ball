#!/usr/bin/env node
/**
 * FAA TFR (Temporary Flight Restriction) parser.
 *
 * Two-phase fetch:
 * 1. GET https://tfr.faa.gov/tfr2/list.html — scrape NOTAM IDs from the HTML
 * 2. GET https://tfr.faa.gov/save_pages/detail_{id}.xml — parse each polygon XML
 *
 * Exported for direct unit testing; the sidecar imports and wraps this.
 */

/** @typedef {{ id: string, notamNumber: string, type: 'VIP'|'Security'|'Fire'|'Other', altFloor: number|null, altCeiling: number|null, effectiveStart: string|null, effectiveEnd: string|null, polygon: Array<[number,number]>, center: [number,number]|null }} FaaTfr */

const TFR_LIST_URL = 'https://tfr.faa.gov/tfr2/list.html';
const TFR_DETAIL_BASE = 'https://tfr.faa.gov/save_pages/detail_';
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36';

function parseAlt(s) {
  if (!s) return null;
  const n = Number.parseInt(s.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function classifyTfrType(rawType, xml) {
  if (/vip|presidential|p-\d+/.test(rawType) || /[\s>]POTUS[\s<]/.test(xml)) return 'VIP';
  if (/security|national security/.test(rawType)) return 'Security';
  if (/fire|wildfire|forest/.test(rawType)) return 'Fire';
  return 'Other';
}

function extractPolygonPoints(xml) {
  const polygon = [];
  for (const pm of xml.matchAll(/<Point[^>]*>([\s\S]*?)<\/Point>/gi)) {
    const block = pm[1];
    const latM = /<Lat[^>]*>([^<]+)<\/Lat>/i.exec(block);
    const lonM = /<Lon[^>]*>([^<]+)<\/Lon>/i.exec(block);
    if (latM && lonM) {
      const lat = Number.parseFloat(latM[1]);
      const lon = Number.parseFloat(lonM[1]);
      if (Number.isFinite(lat) && Number.isFinite(lon)) polygon.push([lon, lat]);
    }
  }
  if (polygon.length === 0) {
    const lats = [...xml.matchAll(/<latitude[^>]*>([^<]+)<\/latitude>/gi)].map((mm) => Number.parseFloat(mm[1]));
    const lons = [...xml.matchAll(/<longitude[^>]*>([^<]+)<\/longitude>/gi)].map((mm) => Number.parseFloat(mm[1]));
    for (let i = 0; i < Math.min(lats.length, lons.length); i++) {
      if (Number.isFinite(lats[i]) && Number.isFinite(lons[i])) polygon.push([lons[i], lats[i]]);
    }
  }
  return polygon;
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
  return null;
}

/**
 * Extract NOTAM IDs from the FAA TFR list HTML.
 * The page embeds href links like /save_pages/detail_1_0_1234567.xml.
 * @param {string} html
 * @returns {string[]}
 */
export function extractNotamIds(html) {
  const ids = new Set();
  for (const m of html.matchAll(/href="\/save_pages\/detail_([^"]+)\.(?:xml|html)"/gi)) {
    const id = m[1].trim();
    if (id) ids.add(id);
  }
  for (const m of html.matchAll(/detail_(\d+_\d+_\d+)/g)) {
    ids.add(m[1].trim());
  }
  return [...ids];
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

  const notamMatch = /<Notam_Number[^>]*>([^<]+)<\/Notam_Number>/i.exec(xml)
    ?? /<notamNumber[^>]*>([^<]+)<\/notamNumber>/i.exec(xml)
    ?? /<facility[^>]*type="NOTAM_NUMBER"[^>]*>([^<]+)<\/facility>/i.exec(xml);
  const notamNumber = notamMatch?.[1]?.trim() ?? id;

  const typeMatch = /<Txt_type[^>]*>([^<]+)<\/Txt_type>/i.exec(xml)
    ?? /<type[^>]*>([^<]+)<\/type>/i.exec(xml)
    ?? /<reason[^>]*>([^<]+)<\/reason>/i.exec(xml);
  const type = classifyTfrType((typeMatch?.[1] ?? '').toLowerCase(), xml);

  const floorMatch = /<Altitude_floor[^>]*>([^<]+)<\/Altitude_floor>/i.exec(xml)
    ?? /<lower[^>]*>([^<]+)<\/lower>/i.exec(xml);
  const ceilMatch = /<Altitude_ceiling[^>]*>([^<]+)<\/Altitude_ceiling>/i.exec(xml)
    ?? /<upper[^>]*>([^<]+)<\/upper>/i.exec(xml);
  const altFloor = parseAlt(floorMatch?.[1]);
  const altCeiling = parseAlt(ceilMatch?.[1]);

  const startMatch = /<Effective_Date[^>]*>([^<]+)<\/Effective_Date>/i.exec(xml)
    ?? /<effectiveDate[^>]*>([^<]+)<\/effectiveDate>/i.exec(xml)
    ?? /<startDate[^>]*>([^<]+)<\/startDate>/i.exec(xml);
  const endMatch = /<Expire_Date[^>]*>([^<]+)<\/Expire_Date>/i.exec(xml)
    ?? /<expireDate[^>]*>([^<]+)<\/expireDate>/i.exec(xml)
    ?? /<endDate[^>]*>([^<]+)<\/endDate>/i.exec(xml);
  const effectiveStart = startMatch?.[1]?.trim() ?? null;
  const effectiveEnd = endMatch?.[1]?.trim() ?? null;

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
 * Fetch the FAA TFR list HTML and extract NOTAM IDs.
 * @param {(url: string, opts: object, timeoutMs: number) => Promise<Response>} fetcher
 * @returns {Promise<string[]>}
 */
export async function fetchTfrIds(fetcher) {
  const resp = await fetcher(
    TFR_LIST_URL,
    { headers: { 'User-Agent': CHROME_UA, Accept: 'text/html' } },
    15_000,
  );
  if (!resp.ok) throw new Error(`TFR list HTTP ${resp.status}`);
  const html = await resp.text();
  return extractNotamIds(html);
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
    const url = `${TFR_DETAIL_BASE}${id}.xml`;
    const resp = await fetcher(url, { headers: { 'User-Agent': CHROME_UA, Accept: 'application/xml, text/xml' } }, 10_000);
    if (!resp.ok) return null;
    const xml = await resp.text();
    return parseTfrXml(id, xml);
  } catch {
    return null;
  }
}

/**
 * Full TFR fetch pipeline: list HTML → concurrent detail XML fetches.
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
