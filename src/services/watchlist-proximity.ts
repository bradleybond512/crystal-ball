/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Watchlist proximity alerting — fires synthetic convergence alerts when
 * two watchlist entities co-occur in alerts within the same geo-convergence
 * radius or temporal window.
 *
 * E.g., if you watch "Taiwan" and "China military", co-occurrence in alerts
 * within 6h triggers a convergence alert.
 */

import { unifiedAlertStore, type UnifiedAlert, computeDistanceKm } from './unified-alerts';
import { getWatchlist, type WatchlistEntry } from './watchlist';

const SCAN_MS = 2 * 60_000;
const TIME_WINDOW_MS = 6 * 60 * 60_000;
const GEO_RADIUS_KM = 1000;

const emitted = new Set<string>();

function matchEntry(entry: WatchlistEntry, alert: UnifiedAlert): boolean {
  const text = `${alert.title} ${alert.body}`.toLowerCase();
  if (entry.keywords.some(k => k && text.includes(k.toLowerCase()))) return true;
  if (typeof entry.lat === 'number' && typeof entry.lon === 'number' && alert.location) {
    const r = entry.radiusKm ?? 100;
    if (computeDistanceKm(entry.lat, entry.lon, alert.location.lat, alert.location.lon) <= r) return true;
  }
  return false;
}

function scan(): void {
  const watchlist = getWatchlist();
  if (watchlist.length < 2) return;

  const now = Date.now();
  const recent = unifiedAlertStore.getAll().filter(a =>
    !a.acknowledged && a.source !== 'correlation' && now - a.timestamp < TIME_WINDOW_MS,
  );

  // Map each watchlist entry to its matching alerts.
  const entryAlerts = new Map<string, UnifiedAlert[]>();
  for (const entry of watchlist) {
    const matches = recent.filter(a => matchEntry(entry, a));
    if (matches.length > 0) entryAlerts.set(entry.id, matches);
  }

  // Check pairs of watchlist entries for convergence.
  const synthetic: UnifiedAlert[] = [];
  const entries = [...entryAlerts.entries()];

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [idA, alertsA] = entries[i]!;
      const [idB, alertsB] = entries[j]!;
      const entryA = watchlist.find(e => e.id === idA);
      const entryB = watchlist.find(e => e.id === idB);
      if (!entryA || !entryB) continue;

      // Check temporal co-occurrence.
      let converged = false;
      let bestA: UnifiedAlert | null = null;
      let bestB: UnifiedAlert | null = null;

      for (const a of alertsA) {
        for (const b of alertsB) {
          const dt = Math.abs(a.timestamp - b.timestamp);
          if (dt > TIME_WINDOW_MS) continue;

          // Check geo proximity if both have locations.
          if (a.location && b.location) {
            const dist = computeDistanceKm(a.location.lat, a.location.lon, b.location.lat, b.location.lon);
            if (dist <= GEO_RADIUS_KM) {
              converged = true;
              bestA = a;
              bestB = b;
              break;
            }
          } else {
            // No geo — temporal co-occurrence alone is enough.
            converged = true;
            bestA = a;
            bestB = b;
            break;
          }
        }
        if (converged) break;
      }

      if (!converged || !bestA || !bestB) continue;

      const pairKey = [idA, idB].sort((a, b) => a.localeCompare(b)).join('|');
      const bucket = Math.floor(now / (30 * 60_000));
      const emitKey = `${pairKey}-${bucket}`;
      if (emitted.has(emitKey)) continue;
      emitted.add(emitKey);

      synthetic.push({
        id: `wl-prox-${pairKey}-${bucket}`,
        source: 'correlation',
        severity: 'medium',
        title: `Watchlist convergence: ${entryA.label} + ${entryB.label}`,
        body: `Two watched entities co-occurring in recent alerts.\n• ${bestA.title}\n• ${bestB.title}`,
        timestamp: now,
        location: bestA.location ?? bestB.location,
        relevanceScore: 85,
        acknowledged: false,
        pinned: false,
        correlationMembers: [bestA.id, bestB.id],
      });
    }
  }

  if (synthetic.length > 0) {
    unifiedAlertStore.ingest(synthetic);
  }

  // Prune old emit keys.
  if (emitted.size > 500) emitted.clear();
}

let started = false;
export function startWatchlistProximity(): void {
  if (started) return;
  started = true;
  window.setTimeout(scan, 15_000);
  window.setInterval(scan, SCAN_MS);
}
