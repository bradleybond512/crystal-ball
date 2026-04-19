/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Blackout signature detector — synthesizes a high-severity correlation
 * alert when ≥2 infrastructure-degradation signals coincide:
 *
 *   • power-grid (high+) at a region
 *   • comms-health (high+) globally
 *   • breaking-news mentioning blackout/outage near same region
 *   • silence on local-ids in the same region
 *
 * Two of these = "blackout signature": likely real outage, not noise.
 * Re-fires at most once per 2 hours per region.
 */

import { unifiedAlertStore, type UnifiedAlert, computeDistanceKm } from './unified-alerts';

const SCAN_INTERVAL_MS = 2 * 60_000;
const WINDOW_MS = 6 * 60 * 60_000;
const REFIRE_MS = 2 * 60 * 60_000;
const NEARBY_KM = 800;

const BLACKOUT_TERMS = /\b(blackout|outage|power(\s|-)cut|grid\s+down|no\s+power|loss\s+of\s+power|widespread\s+outages?)\b/i;

const lastFired = new Map<string, number>();

function regionKey(lat: number, lon: number): string {
  return `${Math.round(lat / 5)}:${Math.round(lon / 5)}`;
}

function scan(): void {
  const now = Date.now();
  const all = unifiedAlertStore.getAll().filter(a => !a.acknowledged && now - a.timestamp < WINDOW_MS);

  const powerHigh = all.filter(a => a.source === 'power-grid' && (a.severity === 'critical' || a.severity === 'high') && a.location);
  const commsBad = all.find(a => a.source === 'comms-health' && (a.severity === 'critical' || a.severity === 'high'));
  const newsBlackout = all.filter(a => a.source === 'breaking-news' && BLACKOUT_TERMS.test(`${a.title} ${a.body}`) && a.location);

  if (powerHigh.length === 0 && newsBlackout.length === 0) return;

  // Anchor each scan on a power-grid event (most authoritative).
  for (const seed of powerHigh) {
    const loc = seed.location!;
    const key = regionKey(loc.lat, loc.lon);
    const last = lastFired.get(key);
    if (last && now - last < REFIRE_MS) continue;

    const signals: UnifiedAlert[] = [seed];
    if (commsBad) signals.push(commsBad);
    for (const n of newsBlackout) {
      if (!n.location) continue;
      const d = computeDistanceKm(loc.lat, loc.lon, n.location.lat, n.location.lon);
      if (d <= NEARBY_KM) signals.push(n);
    }
    if (signals.length < 2) continue;

    lastFired.set(key, now);
    const sources = [...new Set(signals.map(s => s.source))];
    unifiedAlertStore.ingest([{
      id: `blackout-${key}-${Math.floor(now / REFIRE_MS)}`,
      source: 'correlation',
      severity: 'critical',
      title: `Blackout signature detected (${sources.join(' + ')})`,
      body: `Multiple infrastructure-degradation signals coincide near this region:\n`
        + signals.slice(0, 5).map(s => `• [${s.source}] ${s.title}`).join('\n'),
      timestamp: now,
      location: loc,
      relevanceScore: 100,
      acknowledged: false,
      pinned: false,
      correlationMembers: signals.map(s => s.id),
      correlationPair: ['power-grid', 'comms-health'],
    }]);
  }

  // Prune lastFired entries older than refire window.
  for (const [k, t] of lastFired) {
    if (now - t > REFIRE_MS * 2) lastFired.delete(k);
  }
}

let started = false;
export function startBlackoutSignature(): void {
  if (started) return;
  started = true;
  window.setTimeout(scan, 10_000);
  window.setInterval(scan, SCAN_INTERVAL_MS);
}
