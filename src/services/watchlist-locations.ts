/**
 * Watchlist Locations — Multi-location watchlist with per-location alert radii
 *
 * Manages a set of user-defined watched locations, each with a custom
 * alert radius in miles. Supports migration from the legacy
 * `crystalball-user-location` localStorage key.
 */

import { safeSetItem } from '../utils/safe-storage';

const STORAGE_KEY = 'wm-watched-locations-v1';
const LEGACY_LOCATION_KEY = 'crystalball-user-location';
const LEGACY_SAVED_PLACES_KEY = 'crystalball-saved-places';
const MILES_TO_KM = 1.609_34;

export interface WatchedLocation {
  id: string;
  label: string;
  lat: number;
  lon: number;
  radiusMi: number;
  enabled: boolean;
  icon: string;
  createdAt: number;
}

type WatchedLocationInput = Omit<WatchedLocation, 'id' | 'createdAt'>;

type WatchlistListener = () => void;

interface LegacyLocation {
  lat?: unknown;
  lon?: unknown;
}

interface LegacySavedPlace {
  name?: unknown;
  label?: unknown;
  lat?: unknown;
  lon?: unknown;
}

function generateId(): string {
  // NOSONAR — this is not security-sensitive; used for UI element IDs only
  return `wl-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`; // NOSONAR
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
 Math.sin(dLat / 2) ** 2 +
 Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isWatchedLocationArray(value: unknown): value is WatchedLocation[] {
  return Array.isArray(value) && value.every(
 (item: unknown) =>
 typeof item === 'object' && item !== null &&
 'id' in item && typeof (item as WatchedLocation).id === 'string',
  );
}

class WatchlistLocations {
  private locations: WatchedLocation[] = [];
  private listeners = new Set<WatchlistListener>();

  constructor() {
 this.load();
 this.migrateFromLegacy();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  getWatchedLocations(): WatchedLocation[] {
 return [...this.locations];
  }

  addLocation(input: WatchedLocationInput): WatchedLocation {
 const loc: WatchedLocation = {
 ...input,
 id: generateId(),
 createdAt: Date.now(),
 };
 this.locations.push(loc);
 this.save();
 this.notify();
 return loc;
  }

  removeLocation(id: string): void {
 this.locations = this.locations.filter(l => l.id !== id);
 this.save();
 this.notify();
  }

  updateLocation(id: string, updates: Partial<WatchedLocation>): void {
 const idx = this.locations.findIndex(l => l.id === id);
 if (idx === -1) return;
 const existing = this.locations[idx];
 if (!existing) return;
 this.locations[idx] = { ...existing, ...updates, id: existing.id, createdAt: existing.createdAt };
 this.save();
 this.notify();
  }

  /**
 * Returns watched locations whose configured radius contains the given point.
 */
  findNearbyLocations(lat: number, lon: number): WatchedLocation[] {
 return this.locations.filter(loc => {
 if (!loc.enabled) return false;
 const distKm = haversineKm(loc.lat, loc.lon, lat, lon);
 const radiusKm = loc.radiusMi * MILES_TO_KM;
 return distKm <= radiusKm;
 });
  }

  /**
 * On first load, if the legacy user location exists but no watched
 * locations have been saved yet, create a "Home" entry from the
 * legacy location.
 */
  migrateFromLegacy(): void {
 if (this.locations.length > 0) return;
 try {
 const raw = localStorage.getItem(LEGACY_LOCATION_KEY);
 if (!raw) return;
 const loc: LegacyLocation = JSON.parse(raw) as LegacyLocation;
 if (typeof loc.lat !== 'number' || typeof loc.lon !== 'number') return;
 this.addLocation({
 label: 'Home',
 lat: loc.lat,
 lon: loc.lon,
 radiusMi: 100,
 enabled: true,
 icon: '\u{1F3E0}',
 });
 } catch { /* ignore parse errors */ }
  }

  /**
 * Import places from the legacy saved-places localStorage key.
 * Skips duplicates based on coordinate proximity. Returns count imported.
 */
  importFromSavedPlaces(): number {
 let count = 0;
 try {
 const raw = localStorage.getItem(LEGACY_SAVED_PLACES_KEY);
 if (!raw) return 0;
 const parsed: unknown = JSON.parse(raw);
 if (!Array.isArray(parsed)) return 0;
 const places = parsed as LegacySavedPlace[];

 const existingCoords = new Set(
 this.locations.map(l => `${l.lat.toFixed(4)},${l.lon.toFixed(4)}`),
 );

 for (const p of places) {
 if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
 const lat: number = p.lat;
 const lon: number = p.lon;
 const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
 if (existingCoords.has(key)) continue;

 const name = typeof p.name === 'string' ? p.name : undefined;
 const label = typeof p.label === 'string' ? p.label : undefined;
 this.addLocation({
 label: name ?? label ?? 'Imported Place',
 lat,
 lon,
 radiusMi: 100,
 enabled: true,
 icon: '\u{1F4CD}',
 });
 existingCoords.add(key);
 count++;
 }
 } catch { /* ignore */ }
 return count;
  }

  // ── Subscription ────────────────────────────────────────────────────────────

  subscribe(listener: WatchlistListener): () => void {
 this.listeners.add(listener);
 return () => { this.listeners.delete(listener); };
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private load(): void {
 try {
 const raw = localStorage.getItem(STORAGE_KEY);
 if (raw) {
 const parsed: unknown = JSON.parse(raw);
 if (isWatchedLocationArray(parsed)) {
 this.locations = parsed;
 }
 }
 } catch { /* ignore */ }
  }

  private save(): void {
 safeSetItem(STORAGE_KEY, JSON.stringify(this.locations));
  }

  private notify(): void {
 for (const fn of this.listeners) {
 try { fn(); } catch { /* listener error */ }
 }
  }
}

export const watchlistLocations = new WatchlistLocations();
