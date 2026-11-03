export const MAX_NWS_SNAPSHOT_ALERTS = 2000;
const MAX_FEATURE_POLYGONS = 256;
const MAX_FEATURE_RINGS = 1024;
const MAX_FEATURE_VERTICES = 50_000;
const MAX_RESPONSE_POLYGONS = 512;
const MAX_RESPONSE_RINGS = 2048;
const MAX_RESPONSE_VERTICES = 250_000;
const SEVERITIES = new Set(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']);
const URGENCIES = new Set(['Immediate', 'Expected', 'Future', 'Past', 'Unknown']);
const STATUSES = new Set(['Actual']);
const MESSAGE_TYPES = new Set(['Alert', 'Update']);
function isTimestamp(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function isCentroid(value) {
    if (value === null)
        return true;
    if (!Array.isArray(value) || value.length !== 2)
        return false;
    const lon = value[0];
    const lat = value[1];
    return typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180
        && typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}
function isPosition(value) {
    if (!Array.isArray(value) || value.length < 2)
        return false;
    const lon = value[0];
    const lat = value[1];
    return typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180
        && typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}
function isClosedNonzeroRing(value) {
    if (!Array.isArray(value) || value.length < 4)
        return false;
    if (!value.every((position) => isPosition(position)))
        return false;
    const first = value[0];
    const last = value[value.length - 1];
    if (!first || first[0] !== last?.[0] || first[1] !== last[1])
        return false;
    let doubledArea = 0;
    for (let index = 0; index < value.length - 1; index += 1) {
        const current = value[index];
        const next = value[index + 1];
        doubledArea += current[0] * next[1] - next[0] * current[1];
    }
    return Number.isFinite(doubledArea) && Math.abs(doubledArea) > Number.EPSILON;
}
function isPolygonCoordinates(value, budget, responseBudget) {
    if (!Array.isArray(value) || value.length === 0)
        return false;
    budget.rings += value.length;
    if (budget.rings > MAX_FEATURE_RINGS || responseBudget.rings + budget.rings > MAX_RESPONSE_RINGS)
        return false;
    for (const ring of value) {
        if (!Array.isArray(ring))
            return false;
        budget.vertices += ring.length;
        if (budget.vertices > MAX_FEATURE_VERTICES || responseBudget.vertices + budget.vertices > MAX_RESPONSE_VERTICES)
            return false;
        if (!isClosedNonzeroRing(ring))
            return false;
    }
    return true;
}
function isGeometry(value, responseBudget) {
    if (value === undefined || value === null)
        return true;
    if (typeof value !== 'object' || Array.isArray(value))
        return false;
    const geometry = value;
    const featureBudget = { polygons: 0, rings: 0, vertices: 0 };
    let polygons;
    if (geometry.type === 'Polygon') {
        polygons = [geometry.coordinates];
    }
    else if (geometry.type === 'MultiPolygon') {
        if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0)
            return false;
        polygons = geometry.coordinates;
    }
    else {
        return false;
    }
    featureBudget.polygons = polygons.length;
    if (featureBudget.polygons > MAX_FEATURE_POLYGONS
        || responseBudget.polygons + featureBudget.polygons > MAX_RESPONSE_POLYGONS)
        return false;
    for (const polygon of polygons) {
        if (!isPolygonCoordinates(polygon, featureBudget, responseBudget))
            return false;
    }
    responseBudget.polygons += featureBudget.polygons;
    responseBudget.rings += featureBudget.rings;
    responseBudget.vertices += featureBudget.vertices;
    return true;
}
function normalizeNwsAlert(value, responseBudget) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const alert = value;
    const onset = typeof alert.onset === 'string' ? alert.onset.trim() : '';
    const valid = typeof alert.id === 'string' && alert.id.length > 0 && alert.id.length <= 1024
        && typeof alert.event === 'string'
        && typeof alert.headline === 'string'
        && typeof alert.description === 'string'
        && SEVERITIES.has(alert.severity)
        && URGENCIES.has(alert.urgency)
        && typeof alert.areaDesc === 'string'
        && isTimestamp(alert.sent)
        && (alert.onset === undefined || alert.onset === null
            || (typeof alert.onset === 'string' && (onset.length === 0 || isTimestamp(onset))))
        && isTimestamp(alert.expires)
        && STATUSES.has(alert.status)
        && MESSAGE_TYPES.has(alert.messageType)
        && isCentroid(alert.centroid)
        && isGeometry(alert.geometry, responseBudget);
    if (!valid)
        return null;
    const normalized = {
        id: alert.id, event: alert.event,
        headline: alert.headline, description: alert.description,
        severity: alert.severity, urgency: alert.urgency,
        areaDesc: alert.areaDesc, sent: alert.sent, expires: alert.expires,
        status: 'Actual', messageType: alert.messageType,
        centroid: alert.centroid, geometry: alert.geometry,
    };
    if (onset.length > 0)
        normalized.onset = onset;
    else
        delete normalized.onset;
    return normalized;
}
export function validateNWSAlertSnapshot(value, now = Date.now()) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const snapshot = value;
    if (snapshot.schemaVersion !== 1 || snapshot.scope !== 'national-active'
        || snapshot.completeness !== 'complete' || typeof snapshot.observedAt !== 'number'
        || !Number.isSafeInteger(snapshot.observedAt) || snapshot.observedAt <= 0
        || snapshot.observedAt > 8_640_000_000_000_000 || snapshot.observedAt > now || !Array.isArray(snapshot.alerts)
        || snapshot.alerts.length > MAX_NWS_SNAPSHOT_ALERTS)
        return null;
    const responseBudget = { polygons: 0, rings: 0, vertices: 0 };
    const alerts = [];
    const ids = new Set();
    for (const row of snapshot.alerts) {
        const alert = normalizeNwsAlert(row, responseBudget);
        if (!alert || ids.has(alert.id))
            return null;
        const sent = Date.parse(alert.sent);
        if (sent < 0 || sent > snapshot.observedAt || Date.parse(alert.expires) <= sent) return null;
        ids.add(alert.id);
        alerts.push({ ...alert, retrievedAt: snapshot.observedAt });
    }
    const metadata = {
        version: 1, observedAt: snapshot.observedAt,
        members: alerts.map(alert => ({ id: `nws-${alert.id}`, issuedAt: Date.parse(alert.sent), expiresAt: Date.parse(alert.expires) })),
    };
    if (new TextEncoder().encode(JSON.stringify(metadata)).byteLength > 2 * 1024 * 1024) return null;
    return {
        schemaVersion: 1, scope: 'national-active', completeness: 'complete',
        observedAt: snapshot.observedAt, alerts,
    };
}

export const NWS_ACTIVE_URL = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert,update';
export const NWS_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const COLLECTION_KEYS = new Set(['@context', 'type', 'features', 'title', 'updated']);
const CACHE_TTL_MS = 60_000;

function centroid(geometry) {
  if (!geometry) return null;
  const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0];
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const point of ring) {
    west = Math.min(west, point[0]); east = Math.max(east, point[0]);
    south = Math.min(south, point[1]); north = Math.max(north, point[1]);
  }
  return [(west + east) / 2, (south + north) / 2];
}

export function normalizeNwsActiveCollection(value, observedAt) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.type !== 'FeatureCollection' || !Array.isArray(value.features)
    || value.features.length > MAX_NWS_SNAPSHOT_ALERTS
    || !Object.keys(value).every((key) => COLLECTION_KEYS.has(key))) return null;
  const alerts = [];
  for (const feature of value.features) {
    if (!feature || feature.type !== 'Feature' || !('geometry' in feature)) return null;
    const p = feature.properties;
    if (!p || typeof p !== 'object' || Array.isArray(p)
      || !(p.headline === null || typeof p.headline === 'string')
      || !(p.description === null || typeof p.description === 'string')) return null;
    alerts.push({
      id: p.id, event: p.event, headline: p.headline ?? '', description: p.description ?? '',
      severity: p.severity, urgency: p.urgency, areaDesc: p.areaDesc,
      sent: p.sent, onset: p.onset, expires: p.expires, status: p.status,
      messageType: p.messageType, centroid: null, geometry: feature.geometry,
    });
  }
  const snapshot = validateNWSAlertSnapshot({
    schemaVersion: 1, scope: 'national-active', completeness: 'complete', observedAt, alerts,
  }, observedAt);
  if (!snapshot) return null;
  for (const alert of snapshot.alerts) alert.centroid = centroid(alert.geometry);
  return snapshot;
}

function retryDelay(response, now) {
  const value = response.headers.get('retry-after');
  const milliseconds = /^\d+$/.test(value ?? '') ? Number(value) * 1000 : Date.parse(value ?? '') - now;
  return Number.isFinite(milliseconds) ? Math.min(300_000, Math.max(1000, milliseconds)) : 5000;
}

export function createNwsSnapshotProvider({ fetchFn, readJson, clock = Date.now }) {
  let cached = null;
  let inflight = null;
  let retryAt = 0;
  async function acquire() {
    const response = await fetchFn(NWS_ACTIVE_URL, {
      headers: { Accept: 'application/geo+json', 'User-Agent': 'CrystalBall-NWS/1.0 (https://github.com/bradleybond512/crystal-ball)' },
      signal: AbortSignal.timeout(12_000), maxResponseBytes: NWS_MAX_RESPONSE_BYTES,
    }, 12_000);
    if (response.status === 429) retryAt = clock() + retryDelay(response, clock());
    if (!response.ok) throw new Error('NWS source unavailable');
    const raw = await readJson(response, NWS_MAX_RESPONSE_BYTES);
    const snapshot = normalizeNwsActiveCollection(raw, clock());
    if (!snapshot) throw new Error('NWS response incomplete or malformed');
    cached = snapshot;
    return snapshot;
  }
  return {
    get() {
      if (cached && clock() - cached.observedAt < CACHE_TTL_MS) return Promise.resolve(cached);
      if (clock() < retryAt) return Promise.reject(new Error('NWS source rate limited'));
      if (!inflight) inflight = acquire().finally(() => { inflight = null; });
      return inflight;
    },
    reset() { cached = null; inflight = null; retryAt = 0; },
  };
}
