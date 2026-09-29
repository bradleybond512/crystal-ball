/**
 * Cloud fallback policy for the desktop fetch patch (R4-BUG-004).
 *
 * Bradley's decision (September 29, 2026): keep the cloud fallback on, but
 * - fall back only on a local connection failure or an HTTP 5xx, never on 4xx;
 * - coarsen coordinates sent to the cloud to 2 decimals (about 1 km);
 * - never send saved-place names, watchlist terms or other personal text.
 *
 * Fail-closed by construction: a request is eligible only when every query
 * parameter is a reviewed coordinate (rounded) or a reviewed neutral
 * parameter. Unknown means "stay local", never "send it". Pure: no I/O.
 * `tests/api-param-classification.test.mjs` fails when renderer code adds an
 * `/api/` query parameter that is not classified here.
 */

export type LocalOutcome =
  /** Network error, no confirmed sidecar port, or our own request timeout. */
  | { kind: 'connection' }
  /** The caller aborted: never retry anywhere. */
  | { kind: 'caller-abort' }
  | { kind: 'http'; status: number };

export function mayFallBack(outcome: LocalOutcome): boolean {
  if (outcome.kind === 'connection') return true;
  if (outcome.kind === 'http') {
    return Number.isInteger(outcome.status) && outcome.status >= 500 && outcome.status <= 599;
  }
  return false;
}

/** Rounded to 2 decimals before leaving the machine. Case-insensitive. */
export const COORDINATE_PARAMS: ReadonlySet<string> = new Set([
  'lat', 'lon', 'lng', 'latitude', 'longitude',
  'sw_lat', 'sw_lon', 'ne_lat', 'ne_lon',
  'minlat', 'maxlat', 'minlon', 'maxlon',
  'lamin', 'lamax', 'lomin', 'lomax',
  'nwlat', 'nwlng', 'selat', 'selng',
]);

/** Comma-separated coordinate lists; every element is rounded. */
export const COORDINATE_LIST_PARAMS: ReadonlySet<string> = new Set(['bbox']);

/**
 * Free text, identities, routes and lookups: the request stays local.
 * Blocked rather than stripped, because stripping changes the answer.
 * Case-insensitive.
 */
export const PERSONAL_PARAMS: ReadonlySet<string> = new Set([
  'q', 'query', 'search', 'term', 'terms', 'keyword', 'keywords', 'text', 'prompt', 'message', 'context',
  'name', 'place', 'places', 'city', 'address', 'location', 'zip', 'zipcode', 'postal',
  'origin', 'destination', 'coords', 'route', 'waypoints',
  'watchlist', 'ip', 'domain', 'email', 'phone', 'user', 'username', 'account', 'value',
  'key', 'token', 'apikey', 'api_key',
]);

/**
 * Reviewed as non-personal: pagination, formats, public identifiers
 * (symbols, ICAO hex, station ids, country/state/county codes) and the
 * built-in feed URL list. Case-sensitive, exactly as the renderer sends them.
 */
export const NEUTRAL_PARAMS: ReadonlySet<string> = new Set([
  '_format', 'age', 'aircraft_type', 'area', 'asn', 'autoplay', 'base', 'begin_date',
  'c', 'campaignId', 'categories', 'category', 'category_limit', 'channel', 'channelId',
  'coins', 'commodities', 'count', 'countries', 'country', 'country_code', 'country_limit',
  'cursor', 'datum', 'days', 'dist', 'distance', 'end', 'end_date', 'energy_sources',
  'eventId', 'eventtype', 'feed_type', 'fields', 'fips', 'flow_limit', 'force_refresh',
  'format', 'from', 'icao24', 'ids', 'include_gdelt', 'includeCountries', 'indicator',
  'indicator_code', 'interval', 'kind', 'l', 'lang', 'language', 'layers', 'limit',
  'mappable', 'max_records', 'maxdepth', 'maxmagnitude', 'maxSecurity', 'measure_type',
  'min_magnitude', 'min_severity', 'minmagnitude', 'minScore', 'mode', 'mute', 'operator',
  'orderby', 'output', 'page', 'page_size', 'pageSize', 'partner_country', 'per_page',
  'period', 'platform', 'platform_limit', 'product', 'product_sector', 'radius', 'range',
  'region', 'reporting_country', 'risk', 's', 'series_id', 'severity', 'since', 'size',
  'sort', 'sort_by', 'sort_order', 'source', 'start', 'state', 'station', 'status',
  'subreddits', 'symbol', 'symbols', 't', 'theater', 'timeRange', 'time_zone', 'timespan',
  'tone_filter', 'topics', 'type', 'units', 'until', 'url', 'variant', 'videoId', 'view',
  'vq', 'year', 'years', 'zoom', 'refresh', 'cameraId', 'withMetar',
  'addressdetails', 'limitPerCategory', 'parentOrigin', 'radiusKm', 'ts',
]);

export type CloudTargetDecision =
  | { ok: true; target: string }
  | { ok: false; reason: string };

const COORDINATE_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
/** A decimal with 3+ fractional digits inside a path looks like a coordinate. */
const PATH_COORDINATE = /-?\d{1,3}\.\d{3,}/;

/** Round one coordinate to 2 decimals, or null when it is not a plain number. */
export function roundCoordinate(value: string): string | null {
  const text = value.trim();
  if (!COORDINATE_TEXT.test(text)) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || Math.abs(n) > 180) return null;
  const rounded = Math.round(n * 100) / 100;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(2);
}

function blocked(reason: string): CloudTargetDecision {
  return { ok: false, reason };
}

function splitTarget(target: string): { path: string; query: string } {
  const hashAt = target.indexOf('#');
  const withoutHash = hashAt === -1 ? target : target.slice(0, hashAt);
  const queryAt = withoutHash.indexOf('?');
  if (queryAt === -1) return { path: withoutHash, query: '' };
  return { path: withoutHash.slice(0, queryAt), query: withoutHash.slice(queryAt + 1) };
}

/** The value to send for one parameter, or a block reason. */
function sanitizeParam(key: string, value: string): { value: string } | { reason: string } {
  const lower = key.toLowerCase();
  if (PERSONAL_PARAMS.has(lower)) return { reason: `personal:${key}` };
  if (COORDINATE_PARAMS.has(lower)) {
    const rounded = roundCoordinate(value);
    return rounded === null ? { reason: `coordinate:${key}` } : { value: rounded };
  }
  if (COORDINATE_LIST_PARAMS.has(lower)) {
    const parts = value.split(',').map((part) => roundCoordinate(part));
    return parts.includes(null) ? { reason: `coordinate:${key}` } : { value: parts.join(',') };
  }
  if (NEUTRAL_PARAMS.has(key)) return { value };
  return { reason: `unclassified:${key}` };
}

/**
 * Decide whether `target` (path + query, already known not to be local-only)
 * may be sent to the cloud, and in what form.
 */
export function prepareCloudTarget(target: string, method = 'GET', hasBody = false): CloudTargetDecision {
  const verb = method.toUpperCase();
  if ((verb !== 'GET' && verb !== 'HEAD') || hasBody) return blocked('request-body');
  const { path, query } = splitTarget(target);
  if (!path.startsWith('/api/')) return blocked('not-an-api-path');
  if (PATH_COORDINATE.test(decodeURIComponentSafe(path))) return blocked('path-coordinates');

  const out = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(query)) {
    const result = sanitizeParam(key, value);
    if ('reason' in result) return blocked(result.reason);
    out.append(key, result.value);
  }
  const search = out.toString();
  return { ok: true, target: search ? `${path}?${search}` : path };
}

function decodeURIComponentSafe(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
