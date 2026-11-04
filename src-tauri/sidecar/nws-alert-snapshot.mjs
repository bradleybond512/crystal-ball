import { normalizeNwsAlert } from './nws-alert-row.mjs';
export const MAX_NWS_SNAPSHOT_ALERTS = 2000;
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
