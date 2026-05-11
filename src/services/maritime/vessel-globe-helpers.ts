/**
 * Pure helpers for the Cesium maritime-vessels globe layer.
 *
 * Keeps colour mapping, heading normalisation, tooltip formatting, and
 * MMSI-dedup logic out of the Cesium-bound `loadMaritimeVessels` so it
 * can be exercised by node:test fixtures without spinning up a viewer.
 */

/** Wire shape returned by `/api/maritime/vessels` (see
 *  `src-tauri/sidecar/local-api-server.mjs:filterVesselsInRiskZonesSidecar`). */
export interface MaritimeVesselWire {
  mmsi: string;
  name: string;
  lat: number;
  lon: number;
  speedKnots: number | null;
  headingDeg: number | null;
  shipType: number | null;
  category: VesselCategory;
  flag: string;
  zoneId: string;
  zoneName: string;
  observedAt: number | null;
}

export type VesselCategory = 'tanker' | 'bulk_carrier' | 'container' | 'military' | 'other';

const CATEGORY_COLOR: Record<VesselCategory, string> = {
  tanker: '#ff8c00',         // orange
  bulk_carrier: '#1e90ff',   // blue (cargo)
  container: '#1e90ff',      // blue (cargo)
  military: '#dc143c',       // red
  other: '#9e9e9e',          // gray
};

export function vesselColorCss(category: VesselCategory): string {
  return CATEGORY_COLOR[category] ?? CATEGORY_COLOR.other;
}

/** Normalise a heading to [0, 360) degrees. Returns 0 for null /
 *  non-finite (the triangle billboard then points at the default
 *  azimuth — better than crashing the entity collection). */
export function vesselRotationDeg(headingDeg: number | null): number {
  if (headingDeg === null || !Number.isFinite(headingDeg)) return 0;
  const wrapped = ((headingDeg % 360) + 360) % 360;
  return wrapped;
}

/** Multi-line tooltip rendered into the Cesium entity description. */
export function vesselTooltip(v: MaritimeVesselWire): string {
  const label = v.name?.trim() ? v.name : v.mmsi;
  const speed = v.speedKnots === null ? '—' : `${v.speedKnots.toFixed(1)} kts`;
  const heading = v.headingDeg === null ? '—' : `${Math.round(v.headingDeg)}°`;
  const flag = v.flag ? ` (${v.flag})` : '';
  return `${label}${flag} — ${v.category}\n` +
    `MMSI: ${v.mmsi}\n` +
    `Speed: ${speed} | Hdg: ${heading}\n` +
    `Zone: ${v.zoneName}`;
}

/** Keep the newest observation per MMSI. `null` observedAt is treated
 *  as the oldest (any timestamped row beats it). Stable wrt input order
 *  for ties. */
export function dedupeVesselsByMmsi(rows: readonly MaritimeVesselWire[]): MaritimeVesselWire[] {
  const byMmsi = new Map<string, MaritimeVesselWire>();
  for (const r of rows) {
    const existing = byMmsi.get(r.mmsi);
    if (!existing) {
      byMmsi.set(r.mmsi, r);
      continue;
    }
    const existingTs = existing.observedAt ?? Number.NEGATIVE_INFINITY;
    const incomingTs = r.observedAt ?? Number.NEGATIVE_INFINITY;
    if (incomingTs >= existingTs) byMmsi.set(r.mmsi, r);
  }
  return [...byMmsi.values()];
}

export interface CategoryCounts {
  tanker: number;
  bulk_carrier: number;
  container: number;
  military: number;
  other: number;
}

export function classifyVesselsByCategory(rows: readonly MaritimeVesselWire[]): CategoryCounts {
  const counts: CategoryCounts = { tanker: 0, bulk_carrier: 0, container: 0, military: 0, other: 0 };
  for (const r of rows) {
    if (r.category in counts) counts[r.category] += 1;
    else counts.other += 1;
  }
  return counts;
}
