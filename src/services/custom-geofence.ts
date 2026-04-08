/**
 * Custom Geofence Service
 *
 * Lets users define named geographic boundaries (circles or polygons) and
 * receive alerts when world-events fall within those boundaries.
 *
 * - Circle fences use the haversine formula for accurate great-circle distance.
 * - Polygon fences use a ray-casting point-in-polygon algorithm.
 * - Fences are persisted to localStorage; alert history is held in memory
 * (capped at 500 entries).
 *
 * Persistence key: `crystalball-geofences`
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GeofenceShape = 'circle' | 'polygon';

/** Fired when an incoming event falls inside a geofence boundary. */
export interface GeofenceAlert {
  id: string;
  fenceId: string;
  fenceName: string;
  eventType: string;
  eventDescription: string;
  timestamp: number;
}

export interface Geofence {
  id: string;
  name: string;
  shape: GeofenceShape;
  /** Required when shape === 'circle'. */
  center?: { lat: number; lon: number };
  /** Required when shape === 'circle'. */
  radiusKm?: number;
  /** Required when shape === 'polygon'. Minimum 3 vertices. */
  polygon?: Array<{ lat: number; lon: number }>;
  /**
 * Event-type tags that should trigger an alert when they occur inside this
 * fence. Supported values: 'earthquake', 'conflict', 'cyber', 'weather',
 * 'nuclear', 'fire', 'protest', 'military'.
 */
  alertOnTypes: string[];
  enabled: boolean;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'crystalball-geofences';
const MAX_ALERT_HISTORY = 500;

function loadFencesFromStorage(): Geofence[] {
  try {
 const raw = localStorage.getItem(STORAGE_KEY);
 if (!raw) return [];
 const parsed: unknown = JSON.parse(raw);
 if (!Array.isArray(parsed)) return [];
 return parsed as Geofence[];
  } catch {
 return [];
  }
}

function saveFencesToStorage(fences: Geofence[]): void {
  try {
 localStorage.setItem(STORAGE_KEY, JSON.stringify(fences));
  } catch {
 // Quota or unavailable — silently skip persistence
  }
}

// ---------------------------------------------------------------------------
// In-memory state (loaded at module init)
// ---------------------------------------------------------------------------

let _fences: Geofence[] = loadFencesFromStorage();
let _alerts: GeofenceAlert[] = [];

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let _idCounter = 0;

function generateId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${_idCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Haversine distance between two lat/lon pairs, in kilometres.
 */
function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
 Math.sin(dLat / 2) ** 2 +
 Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Ray-casting point-in-polygon test.
 * Returns true if the point (lat, lon) lies inside the polygon.
 */
function pointInPolygon(
  lat: number,
  lon: number,
  polygon: Array<{ lat: number; lon: number }>,
): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
 const vi = polygon[i];
 const vj = polygon[j];
 if (!vi || !vj) continue;

 const intersects =
 vi.lon > lon !== vj.lon > lon &&
 lat < ((vj.lat - vi.lat) * (lon - vi.lon)) / (vj.lon - vi.lon) + vi.lat;

 if (intersects) inside = !inside;
  }

  return inside;
}

/**
 * Test whether a point falls inside a single fence.
 */
function pointInFence(lat: number, lon: number, fence: Geofence): boolean {
  if (fence.shape === 'circle') {
 if (!fence.center || fence.radiusKm == null) return false;
 return haversineKm(lat, lon, fence.center.lat, fence.center.lon) <= fence.radiusKm;
  }

  if (fence.shape === 'polygon') {
 if (!fence.polygon || fence.polygon.length < 3) return false;
 return pointInPolygon(lat, lon, fence.polygon);
  }

  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new geofence. Returns the generated id.
 *
 * @param name Human-readable label.
 * @param shape 'circle' or 'polygon'.
 * @param config Shape-specific geometry plus alertOnTypes.
 */
export function createGeofence(
  name: string,
  shape: GeofenceShape,
  config: {
 center?: { lat: number; lon: number };
 radiusKm?: number;
 polygon?: Array<{ lat: number; lon: number }>;
 alertOnTypes: string[];
  },
): string {
  const fence: Geofence = {
 id: generateId('fence'),
 name: name.trim(),
 shape,
 center: config.center ? { ...config.center } : undefined,
 radiusKm: config.radiusKm,
 polygon: config.polygon ? config.polygon.map(v => ({ ...v })) : undefined,
 alertOnTypes: [...config.alertOnTypes],
 enabled: true,
 createdAt: Date.now(),
  };

  _fences = [..._fences, fence];
  saveFencesToStorage(_fences);
  return fence.id;
}

/**
 * Remove a geofence by id. No-ops if not found.
 */
export function removeGeofence(id: string): void {
  const before = _fences.length;
  _fences = _fences.filter(f => f.id !== id);
  if (_fences.length !== before) {
 saveFencesToStorage(_fences);
  }
}

/**
 * Enable or disable a geofence. No-ops if not found.
 */
export function toggleGeofence(id: string, enabled: boolean): void {
  const idx = _fences.findIndex(f => f.id === id);
  if (idx === -1) return;

  const fence = _fences[idx];
  if (!fence) return;

  _fences = _fences.map(f => f.id === id ? { ...f, enabled } : f);
  saveFencesToStorage(_fences);
}

/**
 * Return a snapshot of all defined geofences (enabled and disabled).
 */
export function getGeofences(): Geofence[] {
  return _fences.map(cloneFence);
}

/**
 * Test an event at a given location against all enabled geofences.
 * Returns one GeofenceAlert per matching fence.
 *
 * @param lat Event latitude.
 * @param lon Event longitude.
 * @param eventType One of the alertOnTypes values (e.g. 'earthquake').
 * @param description Human-readable event description.
 */
export function checkEvent(
  lat: number,
  lon: number,
  eventType: string,
  description: string,
): GeofenceAlert[] {
  const fired: GeofenceAlert[] = [];

  for (const fence of _fences) {
 if (!fence.enabled) continue;
 if (!fence.alertOnTypes.includes(eventType)) continue;
 if (!pointInFence(lat, lon, fence)) continue;

 const alert: GeofenceAlert = {
 id: generateId('gfalert'),
 fenceId: fence.id,
 fenceName: fence.name,
 eventType,
 eventDescription: description,
 timestamp: Date.now(),
 };

 fired.push(alert);
 _alerts = [alert, ..._alerts].slice(0, MAX_ALERT_HISTORY);
  }

  return fired;
}

/**
 * Return the most recent fence alerts, newest first.
 *
 * @param limit Maximum entries to return (default: 50).
 */
export function getRecentAlerts(limit = 50): GeofenceAlert[] {
  return _alerts.slice(0, limit).map(a => ({ ...a }));
}

/**
 * Count how many fence alerts fired in the last 24 hours.
 */
export function getAlertCount(): number {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return _alerts.filter(a => a.timestamp >= cutoff).length;
}

/**
 * Purge all in-memory alert history.
 */
export function clearAlerts(): void {
  _alerts = [];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function cloneFence(fence: Geofence): Geofence {
  return {
 ...fence,
 center: fence.center ? { ...fence.center } : undefined,
 radiusKm: fence.radiusKm,
 polygon: fence.polygon ? fence.polygon.map(v => ({ ...v })) : undefined,
 alertOnTypes: [...fence.alertOnTypes],
  };
}
