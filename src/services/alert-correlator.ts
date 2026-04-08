/**
 * Alert correlator — synthesize a `correlation` alert when ≥2 alerts from
 * different sources fall in the same coarse geo cell within a short window.
 *
 * This catches the "earthquake + tsunami warning + GDACS red" cluster, or
 * "cyber threat + IDS hit on the same indicator" — patterns that are obvious
 * to a human looking at all panels but invisible if you only see one source.
 */

import { unifiedAlertStore, type UnifiedAlert } from './unified-alerts';

const CELL_DEG = 1.0; // ~110km cells
const WINDOW_MS = 10 * 60_000;
const SCAN_INTERVAL_MS = 60_000;
const MIN_SOURCES = 2;

function cellKey(lat: number, lon: number): string {
  return `${Math.round(lat / CELL_DEG)}:${Math.round(lon / CELL_DEG)}`;
}

const synthesized = new Set<string>();

function scan(): void {
  const now = Date.now();
  const recent = unifiedAlertStore.getAll().filter(a =>
    !a.acknowledged
    && a.source !== 'correlation'
    && a.location
    && now - a.timestamp < WINDOW_MS,
  );

  // Group by cell
  const cells = new Map<string, UnifiedAlert[]>();
  for (const a of recent) {
    if (!a.location) continue;
    const key = cellKey(a.location.lat, a.location.lon);
    const arr = cells.get(key) ?? [];
    arr.push(a);
    cells.set(key, arr);
  }

  const synthetic: UnifiedAlert[] = [];
  for (const [key, members] of cells) {
    const sources = new Set(members.map(m => m.source));
    if (sources.size < MIN_SOURCES) continue;
    const id = `corr-${key}-${Math.floor(now / WINDOW_MS)}`;
    if (synthesized.has(id)) continue;
    synthesized.add(id);

    // Use the highest severity present.
    const sevRank: Record<UnifiedAlert['severity'], number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
    const top = members.reduce((a, b) => sevRank[b.severity] > sevRank[a.severity] ? b : a);
    const center = members[0]?.location;
    if (!center) continue;

    synthetic.push({
      id,
      source: 'correlation',
      severity: top.severity,
      title: `${members.length} alerts clustered (${[...sources].join(' + ')})`,
      body: members.slice(0, 4).map(m => `• ${m.title}`).join('\n'),
      timestamp: now,
      location: center,
      relevanceScore: 100,
      acknowledged: false,
      pinned: false,
    });
  }

  if (synthetic.length > 0) unifiedAlertStore.ingest(synthetic);
}

let started = false;
export function startAlertCorrelator(): void {
  if (started) return;
  started = true;
  window.setInterval(scan, SCAN_INTERVAL_MS);
  // Run once after a short delay so initial loads have a chance to populate.
  window.setTimeout(scan, 5_000);
}
