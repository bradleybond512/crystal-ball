/**
 * Satellite Change Detection Service — pure TypeScript, fully offline
 *
 * Tracks user-defined locations of interest and records change detection
 * results. Actual Sentinel-2 / Planet / Maxar integration would require
 * API keys; this service provides the canonical data model, persistence,
 * and filtering layer so panels and pipeline stages can ingest real detections
 * as they become available.
 *
 * Watch locations are persisted to localStorage under the key
 * `crystalball-satellite-watch`. Detections are held in memory (max 500).
 * No external imports, no network calls.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type ChangeType =
  | 'construction'
  | 'destruction'
  | 'vegetation_loss'
  | 'flooding'
  | 'fire_damage'
  | 'troop_buildup'
  | 'vehicle_movement'
  | 'infrastructure_change'
  | 'unknown';

export interface WatchedLocation {
  /** Unique stable identifier */
  id: string;
  /** Human-readable display name */
  name: string;
  lat: number;
  lon: number;
  /** Radius around the point to watch, in kilometres */
  radiusKm: number;
  /** Which change types to flag for this location */
  watchFor: ChangeType[];
  enabled: boolean;
  /** Unix timestamp (ms) of last check, or null if never checked */
  lastChecked: number | null;
  /** How often to request a new detection pass */
  checkIntervalHours: number;
}

export interface ChangeDetection {
  /** Unique stable identifier */
  id: string;
  locationId: string;
  locationName: string;
  changeType: ChangeType;
  /** 0–100 confidence score from the detection algorithm */
  confidence: number;
  /** Centroid of the detected change area */
  lat: number;
  lon: number;
  /** Unix timestamp (ms) when this detection was recorded */
  detectedAt: number;
  /** ISO-8601 date string of the "before" imagery */
  beforeDate: string;
  /** ISO-8601 date string of the "after" imagery */
  afterDate: string;
  description: string;
  /** Approximate area of the detected change in square kilometres */
  areaSqKm: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface SatelliteStats {
  watchedLocations: number;
  enabledLocations: number;
  totalDetections: number;
  recentDetections24h: number;
  byChangeType: Record<ChangeType, number>;
}

// ── Constants ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-satellite-watch';
const MAX_DETECTIONS = 500;
const DEFAULT_CHECK_INTERVAL_HOURS = 24;

// ── State ──────────────────────────────────────────────────────────────────

/** In-memory location registry, hydrated from localStorage on first access */
let locations: Map<string, WatchedLocation> | null = null;

/** In-memory detection log */
const detections: ChangeDetection[] = [];

/** Monotonically increasing counter for location IDs */
let locationCounter = 0;

/** Monotonically increasing counter for detection IDs */
let detectionCounter = 0;

// ── Persistence helpers ────────────────────────────────────────────────────

function storageAvailable(): boolean {
  try {
 return (
 typeof localStorage !== 'undefined'
 && typeof localStorage.getItem === 'function'
 && typeof localStorage.setItem === 'function'
 );
  } catch {
 return false;
  }
}

function loadLocations(): Map<string, WatchedLocation> {
  const map = new Map<string, WatchedLocation>();
  if (!storageAvailable()) return map;
  try {
 const raw = localStorage.getItem(STORAGE_KEY);
 if (!raw) return map;
 const parsed = JSON.parse(raw) as WatchedLocation[];
 if (!Array.isArray(parsed)) return map;
 for (const loc of parsed) {
 if (loc?.id) {
 map.set(loc.id, loc);
 // Keep counter ahead of any persisted ids
 const n = parseInt(loc.id.replace('sw-', ''), 10);
 if (!isNaN(n) && n >= locationCounter) locationCounter = n + 1;
 }
 }
  } catch {
 // silently ignore parse errors
  }
  return map;
}

function saveLocations(map: Map<string, WatchedLocation>): void {
  if (!storageAvailable()) return;
  try {
 localStorage.setItem(STORAGE_KEY, JSON.stringify([...map.values()]));
  } catch {
 // silently ignore storage quota errors
  }
}

/** Lazy-initialise the location store. */
function getLocations(): Map<string, WatchedLocation> {
  if (!locations) locations = loadLocations();
  return locations;
}

// ── Location management ────────────────────────────────────────────────────

/**
 * Add a new watch location.
 * Returns the generated id.
 */
export function addWatchLocation(
  name: string,
  lat: number,
  lon: number,
  radiusKm: number,
  watchFor: ChangeType[],
  checkIntervalHours = DEFAULT_CHECK_INTERVAL_HOURS,
): string {
  locationCounter += 1;
  const id = `sw-${locationCounter}`;
  const loc: WatchedLocation = {
 id,
 name,
 lat,
 lon,
 radiusKm: Math.max(0.1, radiusKm),
 watchFor: [...watchFor],
 enabled: true,
 lastChecked: null,
 checkIntervalHours: Math.max(1, checkIntervalHours),
  };
  const map = getLocations();
  map.set(id, loc);
  saveLocations(map);
  return id;
}

/**
 * Remove a watch location by id.
 * Detections from this location remain in the log.
 */
export function removeWatchLocation(id: string): void {
  const map = getLocations();
  map.delete(id);
  saveLocations(map);
}

/**
 * Enable or disable a watch location without deleting it.
 */
export function toggleWatchLocation(id: string, enabled: boolean): void {
  const map = getLocations();
  const loc = map.get(id);
  if (!loc) return;
  map.set(id, { ...loc, enabled });
  saveLocations(map);
}

/**
 * Return all registered watch locations as an array.
 */
export function getWatchLocations(): WatchedLocation[] {
  return [...getLocations().values()];
}

// ── Detection ingestion ────────────────────────────────────────────────────

/**
 * Determine severity from confidence and change type.
 */
function deriveSeverity(
  changeType: ChangeType,
  confidence: number,
  areaSqKm: number,
): ChangeDetection['severity'] {
  // High-stakes types are promoted
  const highStakeTypes = new Set<ChangeType>([
 'destruction', 'troop_buildup', 'flooding', 'fire_damage',
  ]);
  const isHighStake = highStakeTypes.has(changeType);

  if (confidence >= 85 && (isHighStake || areaSqKm >= 10)) return 'critical';
  if (confidence >= 70 || areaSqKm >= 5) return 'high';
  if (confidence >= 50 || areaSqKm >= 1) return 'medium';
  return 'low';
}

/**
 * Record a new change detection against a watch location.
 * Uses the location's lat/lon as the detection centroid unless overridden.
 * Returns the generated detection id.
 */
export function ingestChangeDetection(
  locationId: string,
  changeType: ChangeType,
  confidence: number,
  description: string,
  areaSqKm: number,
  beforeDate: string,
  afterDate: string,
  opts: { lat?: number; lon?: number } = {},
): string {
  const map = getLocations();
  const loc = map.get(locationId);
  const locationName = loc?.name ?? locationId;

  // Update lastChecked timestamp on the location
  if (loc) {
 map.set(locationId, { ...loc, lastChecked: Date.now() });
 saveLocations(map);
  }

  detectionCounter += 1;
  const id = `sd-${detectionCounter}`;

  const detection: ChangeDetection = {
 id,
 locationId,
 locationName,
 changeType,
 confidence: Math.max(0, Math.min(100, confidence)),
 lat: opts.lat ?? loc?.lat ?? 0,
 lon: opts.lon ?? loc?.lon ?? 0,
 detectedAt: Date.now(),
 beforeDate,
 afterDate,
 description,
 areaSqKm: Math.max(0, areaSqKm),
 severity: deriveSeverity(changeType, confidence, areaSqKm),
  };

  detections.push(detection);

  // Enforce cap: drop oldest entries first
  if (detections.length > MAX_DETECTIONS) {
 detections.splice(0, detections.length - MAX_DETECTIONS);
  }

  return id;
}

// ── Detection queries ──────────────────────────────────────────────────────

/**
 * Return detections, optionally filtered.
 * Results are sorted newest first.
 */
export function getDetections(opts: {
  locationId?: string;
  changeType?: ChangeType;
  minConfidence?: number;
  limit?: number;
} = {}): ChangeDetection[] {
  let results = [...detections];

  if (opts.locationId !== undefined) {
 results = results.filter(d => d.locationId === opts.locationId);
  }
  if (opts.changeType !== undefined) {
 results = results.filter(d => d.changeType === opts.changeType);
  }
  if (opts.minConfidence !== undefined) {
 results = results.filter(d => d.confidence >= opts.minConfidence!);
  }

  results.sort((a, b) => b.detectedAt - a.detectedAt);

  if (opts.limit !== undefined && opts.limit > 0) {
 results = results.slice(0, opts.limit);
  }

  return results;
}

/**
 * Return detections from the last N hours (default 24).
 * Results are sorted newest first.
 */
export function getRecentDetections(hours = 24): ChangeDetection[] {
  const since = Date.now() - hours * 60 * 60 * 1000;
  return [...detections]
 .filter(d => d.detectedAt >= since)
 .sort((a, b) => b.detectedAt - a.detectedAt);
}

/**
 * Return aggregate statistics over all locations and detections.
 */
export function getSatelliteStats(): SatelliteStats {
  const map = getLocations();
  const enabledLocations = [...map.values()].filter(l => l.enabled).length;

  const byChangeType = {} as Record<ChangeType, number>;
  for (const d of detections) {
 byChangeType[d.changeType] = (byChangeType[d.changeType] ?? 0) + 1;
  }

  const since24h = Date.now() - 24 * 60 * 60 * 1000;
  const recentDetections24h = detections.filter(d => d.detectedAt >= since24h).length;

  return {
 watchedLocations: map.size,
 enabledLocations,
 totalDetections: detections.length,
 recentDetections24h,
 byChangeType,
  };
}

/**
 * Return the total number of detections in memory.
 */
export function getDetectionCount(): number {
  return detections.length;
}
