/**
 * Geofence alerts — define geographic zones and get notified when
 * alerts fire within them. Zones are circles defined by center + radius.
 */

import { unifiedAlertStore } from './unified-alerts';
import { logDebug } from './reasoning-debug';

const STORAGE_KEY = 'crystalball-geofences-v1';
const SCAN_INTERVAL = 60_000;

export interface Geofence {
  id: string;
  label: string;
  lat: number;
  lon: number;
  radiusKm: number;
  enabled: boolean;
}

let fences: Geofence[] = [];
const notifiedPairs = new Set<string>();

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    fences = JSON.parse(raw) as Geofence[];
  } catch { /* noop */ }
}

function save(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(fences)); } catch { /* noop */ }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scan(): void {
  try {
    const alerts = unifiedAlertStore.getAll().filter(a => !a.acknowledged && a.location);
    for (const fence of fences) {
      if (!fence.enabled) continue;
      for (const alert of alerts) {
        const key = `${fence.id}:${alert.id}`;
        if (notifiedPairs.has(key)) continue;
        const dist = haversineKm(fence.lat, fence.lon, alert.location!.lat, alert.location!.lon);
        if (dist <= fence.radiusKm) {
          notifiedPairs.add(key);
          document.dispatchEvent(new CustomEvent('cb:geofence-hit', {
            detail: {
              fenceId: fence.id,
              fenceLabel: fence.label,
              alertId: alert.id,
              alertTitle: alert.title,
              distanceKm: Math.round(dist),
            },
          }));
        }
      }
    }
  } catch (error) { logDebug({ level: 'warn', category: 'other', source: 'geofence-alerts', message: 'scan error', data: { error: error instanceof Error ? error.message : String(error) } }); }
}

export function getGeofences(): Geofence[] {
  return [...fences];
}

export function addGeofence(label: string, lat: number, lon: number, radiusKm: number): Geofence {
  const fence: Geofence = { id: `gf-${Date.now()}`, label, lat, lon, radiusKm, enabled: true };
  fences.push(fence);
  save();
  return fence;
}

export function removeGeofence(id: string): void {
  fences = fences.filter(f => f.id !== id);
  save();
}

export function toggleGeofence(id: string): void {
  const f = fences.find(x => x.id === id);
  if (f) { f.enabled = !f.enabled; save(); }
}

let started = false;
export function startGeofenceAlerts(): void {
  if (started) return;
  started = true;
  load();
  window.setInterval(scan, SCAN_INTERVAL);
  window.setTimeout(scan, 5000);
}
