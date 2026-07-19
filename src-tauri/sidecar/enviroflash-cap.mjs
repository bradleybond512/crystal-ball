/**
 * EnviroFlash CAP parser — keyless AirNow fallback.
 *
 * EnviroFlash (the EPA/AirNow subscription front-end) publishes a national
 * Common Alerting Protocol (CAP 1.2) aggregate of air-quality alerts and
 * Action Day declarations at https://feeds.enviroflash.info/cap/aggregate.xml
 * — no API key required. When AIRNOW_API_KEY is absent or the AirNow API is
 * down, the sidecar falls back to this feed so Action Day declarations still
 * surface (the non-overlapping signal the keyed forecast provides).
 *
 * Hand-rolled regex parsing (the sidecar has no XML dependency), mirroring
 * gdacs-rss.mjs. Pure + deterministic — no fetch except the injected fetcher.
 *
 * @typedef {Object} EnviroflashAlert
 * @property {string} id           CAP identifier.
 * @property {string} event        e.g. "Air Quality Action Day", "Air Quality Alert".
 * @property {string} headline
 * @property {string} severity     CAP severity (Extreme|Severe|Moderate|Minor|Unknown).
 * @property {string} areaDesc     Human-readable area, e.g. "Northwest Indiana".
 * @property {string[]} geocodes   FIPS / area codes from <geocode><value>.
 * @property {number|null} aqi     AQI from a <parameter> if present.
 * @property {boolean} actionDay   True when this is an Action Day declaration.
 * @property {number|null} effective  epoch ms.
 * @property {number|null} expires    epoch ms.
 * @property {string} senderName
 */

/** Decode the XML entities CAP text can contain. `&amp;` is decoded LAST so
 *  `&amp;lt;` yields `&lt;` rather than `<`. */
export function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** CDATA-aware first-match text of a tag within a chunk of CAP XML. */
export function capTagText(xml, tag) {
  const escaped = tag.replace(/[-/\\^$*+?.()|[\]{}]/g, String.raw`\$&`);
  // The `(?:\s[^>]*)?>` boundary ensures the tag name ends here — so `value`
  // does not also match `valueName`, `area` does not match `areaDesc`, etc.
  const re = new RegExp(String.raw`<${escaped}(?:\s[^>]*)?>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/${escaped}>`, 'i');
  const m = xml.match(re);
  const raw = (m?.[1] ?? m?.[2] ?? '').trim();
  // CDATA (group 1) is literal; only escape-decode plain-text (group 2) content.
  return m?.[1] == null ? decodeXmlEntities(raw) : raw;
}

/** Split the aggregate into individual <alert> blocks. */
export function splitCapAlerts(xml) {
  return [...xml.matchAll(/<alert[^>]*>[\s\S]*?<\/alert>/gi)].map((m) => m[0]);
}

/** Split an <alert> into its <info> blocks (CAP allows several, e.g. per-language). */
export function splitCapInfos(alertXml) {
  const infos = [...alertXml.matchAll(/<info[^>]*>[\s\S]*?<\/info>/gi)].map((m) => m[0]);
  return infos.length > 0 ? infos : [alertXml];
}

/** Find CAP <parameter>/<geocode> values by their <valueName>. Returns all matches. */
function namedValues(xml, blockTag, valueName) {
  const out = [];
  const re = new RegExp(String.raw`<${blockTag}[^>]*>([\s\S]*?)<\/${blockTag}>`, 'gi');
  for (const m of xml.matchAll(re)) {
    const block = m[1];
    const name = capTagText(block, 'valueName');
    if (name.toLowerCase() === valueName.toLowerCase()) {
      const v = capTagText(block, 'value');
      if (v) out.push(v);
    }
  }
  return out;
}

function toEpochMs(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Parse one <alert> (using its first <info>) into a normalized EnviroflashAlert. */
export function parseCapAlert(alertXml) {
  const id = capTagText(alertXml, 'identifier') || capTagText(alertXml, 'cap:identifier');
  const info = splitCapInfos(alertXml)[0] ?? alertXml;
  const event = capTagText(info, 'event');
  const headline = capTagText(info, 'headline');
  const severity = capTagText(info, 'severity') || 'Unknown';
  const areaDesc = capTagText(info, 'areaDesc');
  const senderName = capTagText(info, 'senderName');
  // Action Day: EnviroFlash encodes it either as the event text or an AirNow
  // ActionDay parameter. Accept either signal.
  const paramActionDay = namedValues(info, 'parameter', 'ActionDay')[0] ?? '';
  const actionDay = /action day/i.test(event) || /action day/i.test(headline)
    || /^(yes|true|1)$/i.test(paramActionDay.trim());
  const aqiRaw = namedValues(info, 'parameter', 'AQI')[0]
    ?? namedValues(info, 'parameter', 'AirNowAQI')[0] ?? '';
  const aqi = aqiRaw && Number.isFinite(Number.parseInt(aqiRaw, 10))
    ? Number.parseInt(aqiRaw, 10) : null;
  const geocodes = [
    ...namedValues(info, 'geocode', 'FIPS'),
    ...namedValues(info, 'geocode', 'AirNowReportingArea'),
  ];

  if (!id && !headline && !event) return null;
  return {
    id: id || headline.slice(0, 120),
    event,
    headline,
    severity,
    areaDesc,
    geocodes,
    aqi,
    actionDay,
    effective: toEpochMs(capTagText(info, 'effective') || capTagText(alertXml, 'sent')),
    expires: toEpochMs(capTagText(info, 'expires')),
    senderName,
  };
}

/** Parse the full CAP aggregate into normalized alerts, deduped by id. */
export function parseEnviroflashCap(xml) {
  const seen = new Set();
  const out = [];
  for (const block of splitCapAlerts(xml)) {
    const alert = parseCapAlert(block);
    if (!alert) continue;
    if (seen.has(alert.id)) continue;
    seen.add(alert.id);
    out.push(alert);
  }
  return out;
}

/** Case-insensitive substring match of `area` (e.g. a state or region) against
 *  an alert's areaDesc or geocodes. Empty `area` matches everything. */
export function alertMatchesArea(alert, area) {
  if (!area) return true;
  const needle = area.trim().toLowerCase();
  if (!needle) return true;
  if (alert.areaDesc && alert.areaDesc.toLowerCase().includes(needle)) return true;
  return alert.geocodes.some((g) => g.toLowerCase() === needle);
}

/** Fetch + parse the EnviroFlash CAP aggregate. `fetcher` is fetchWithTimeout. */
export async function fetchEnviroflashCap(fetcher, timeoutMs = 12_000) {
  const url = 'https://feeds.enviroflash.info/cap/aggregate.xml';
  const resp = await fetcher(url, {
    headers: { Accept: 'application/cap+xml, application/xml, text/xml', 'User-Agent': 'CrystalBall/1.0' },
  }, timeoutMs);
  if (!resp.ok) throw new Error(`enviroflash cap upstream ${resp.status}`);
  const xml = await resp.text();
  // A 200 that isn't a CAP feed (HTML error page, WAF challenge, empty string)
  // must be treated as a failure — not cached as "no alerts". A genuinely empty
  // CAP feed still carries the CAP namespace, so this only rejects non-CAP bodies.
  if (!/<alert[\s>]/i.test(xml) && !/emergency:cap/i.test(xml)) {
    throw new Error('enviroflash cap: response is not a CAP feed');
  }
  return parseEnviroflashCap(xml);
}
