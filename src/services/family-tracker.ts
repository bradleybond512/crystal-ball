/**
 * Family Location Tracker — local-first, no cloud.
 *
 * Share codes are compact strings designed for SMS / radio:
 * WM:37.7749,-122.4194,SAFE,85%
 *
 * All data persists in localStorage under `wm-family-members-v1`.
 */

import { locationService } from '@/services/location';
import { safeSetItem } from '@/utils/safe-storage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FamilyStatus = 'safe' | 'moving' | 'stuck' | 'need_pickup' | 'need_meds' | 'unknown';

export interface FamilyMember {
  id: string;
  name: string;
  icon: string; // emoji: 👨 👩 👧 👦 🐕
  lastLocation?: { lat: number; lon: number; accuracy: number };
  lastUpdate?: number; // epoch ms
  status?: FamilyStatus;
  battery?: number; // 0-100 if available
}

export interface ParsedShareCode {
  lat: number;
  lon: number;
  status: FamilyStatus;
  battery?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'wm-family-members-v1';

const VALID_STATUSES: ReadonlySet<string> = new Set<FamilyStatus>([
  'safe', 'moving', 'stuck', 'need_pickup', 'need_meds', 'unknown',
]);

// ---------------------------------------------------------------------------
// Subscriber pattern
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) {
 try { fn(); } catch { /* subscriber errors must not break the tracker */ }
  }
}

export function subscribeFamilyTracker(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function load(): FamilyMember[] {
  try {
 const raw = localStorage.getItem(STORAGE_KEY);
 return raw ? (JSON.parse(raw) as FamilyMember[]) : [];
  } catch {
 return [];
  }
}

function save(members: FamilyMember[]): void {
  safeSetItem(STORAGE_KEY, JSON.stringify(members));
  notify();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getMembers(): FamilyMember[] {
  return load();
}

export function addMember(name: string, icon: string): FamilyMember {
  const members = load();
  const member: FamilyMember = {
 id: crypto.randomUUID(),
 name,
 icon,
 status: 'unknown',
  };
  members.push(member);
  save(members);
  return member;
}

export function removeMember(id: string): void {
  const members = load().filter((m) => m.id !== id);
  save(members);
}

export function updateLocation(id: string, lat: number, lon: number, accuracy = 0): void {
  const members = load();
  const member = members.find((m) => m.id === id);
  if (!member) return;
  member.lastLocation = { lat, lon, accuracy };
  member.lastUpdate = Date.now();
  save(members);
}

export function updateStatus(id: string, status: string): void {
  const members = load();
  const member = members.find((m) => m.id === id);
  if (!member) return;
  member.status = VALID_STATUSES.has(status) ? (status as FamilyStatus) : 'unknown';
  member.lastUpdate = Date.now();
  save(members);
}

/**
 * Gets the current device position via {@link locationService}.
 * User-triggered share — pass `force: true` so the cached fix doesn't pin
 * the family share to a hour-old position when the user explicitly taps
 * "Share my location".
 */
export async function shareMyLocation(): Promise<{ lat: number; lon: number; accuracy: number }> {
  const fix = await locationService.getLocation({ force: true, timeoutMs: 15_000 });
  return {
 lat: fix.lat,
 lon: fix.lon,
 accuracy: fix.accuracy ?? 0,
  };
}

/**
 * Creates a compact location+status string for SMS/radio.
 * Format: WM:lat,lon,STATUS,BATT%
 */
export function generateShareCode(
  lat: number,
  lon: number,
  status: FamilyStatus = 'safe',
  battery?: number,
): string {
  const latStr = lat.toFixed(4);
  const lonStr = lon.toFixed(4);
  const statusStr = status.toUpperCase();
  const parts = [`WM:${latStr}`, lonStr, statusStr];
  if (battery != null && Number.isFinite(battery)) {
 parts.push(`${Math.round(battery)}%`);
  }
  return parts.join(',');
}

/**
 * Parses an incoming share code.
 * Accepts: WM:37.7749,-122.4194,SAFE,85%
 */
export function parseShareCode(code: string): ParsedShareCode | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith('WM:')) return null;

  // Remove the WM: prefix and split
  const body = trimmed.slice(3);
  const parts = body.split(',');
  if (parts.length < 3) return null;

  const lat = Number.parseFloat(parts[0]!);
  const lon = Number.parseFloat(parts[1]!);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const rawStatus = (parts[2] ?? '').toLowerCase();
  const status: FamilyStatus = VALID_STATUSES.has(rawStatus)
 ? (rawStatus as FamilyStatus)
 : 'unknown';

  let battery: number | undefined;
  if (parts.length >= 4) {
 const battStr = (parts[3] ?? '').replace('%', '');
 const battNum = Number.parseInt(battStr, 10);
 if (Number.isFinite(battNum) && battNum >= 0 && battNum <= 100) {
 battery = battNum;
 }
  }

  return { lat, lon, status, battery };
}

/**
 * Compute distance in km between two lat/lon points (Haversine formula).
 */
export function distanceKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
 Math.sin(dLat / 2) ** 2 +
 Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
 Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
