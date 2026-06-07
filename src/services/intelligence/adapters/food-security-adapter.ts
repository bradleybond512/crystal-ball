/**
 * Food Security Observation Adapter
 *
 * Converts FEWS NET IPC packages and HDX HAPI food-security rows into
 * ObservationEvent items. These feed the shortage models AND compound-risk
 * with genuine early-warning data:
 *
 *   FEWS NET IPC   → sourceId: 'fews-net'   (country-level IPC 1–5 phases)
 *   HDX HAPI       → sourceId: 'hdx-hapi'   (IPC-coded rows per location)
 *
 * Multi-source: when FEWS NET and HAPI both flag the same country at
 * IPC 3+, truth-score corroboration lifts the compound food-risk signal.
 *
 * IPC phase scale:
 *   1 = Minimal/None, 2 = Stressed, 3 = Crisis, 4 = Emergency, 5 = Famine
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

// IPC phase → observation severity
function ipcSeverity(phase: number): ObservationSeverity | null {
  if (phase >= 5) return 'CRITICAL'; // Famine
  if (phase >= 4) return 'HIGH';     // Emergency
  if (phase >= 3) return 'MEDIUM';   // Crisis
  return null; // IPC 1–2 not worth an alert
}

// ── FEWS NET ─────────────────────────────────────────────────────────────

export interface FEWSNETPackage {
  country?: string;
  country_name?: string;
  current_phase?: number;
  projected_phase?: number;
  period_date?: string;
  condition?: string;
}

export interface FEWSNETResponse {
  results?: FEWSNETPackage[];
  count?: number;
  fetchedAt?: number;
}

export function fewsNetToObservations(response: FEWSNETResponse): ObservationEvent[] {
  if (!response?.results || !Array.isArray(response.results)) return [];
  const fetchedAt = response.fetchedAt ?? Date.now();
  const observations: ObservationEvent[] = [];

  for (const pkg of response.results) {
    const phase = Math.max(Number(pkg.current_phase ?? 0), Number(pkg.projected_phase ?? 0));
    const sev = ipcSeverity(phase);
    if (!sev) continue;

    const countryCode = (pkg.country ?? 'XX').toUpperCase();
    const countryName = pkg.country_name ?? countryCode;
    const timestamp = pkg.period_date
      ? new Date(pkg.period_date).getTime()
      : fetchedAt;

    observations.push({
      id: `fews-net-${countryCode}-${Math.floor(fetchedAt / (6 * 60 * 60 * 1000))}`,
      sourceId: 'fews-net',
      domain: 'humanitarian',
      timestamp: Number.isFinite(timestamp) ? timestamp : fetchedAt,
      severity: sev,
      title: `IPC Phase ${phase} food insecurity — ${countryName}`,
      raw: pkg,
      entityIds: [countryCode],
      tags: ['food-security', 'ipc', `ipc-phase-${phase}`, 'fews-net'],
    });
  }

  return observations;
}

// ── HDX HAPI ─────────────────────────────────────────────────────────────

export interface HDXHAPIRow {
  location_code?: string;
  location_name?: string;
  ipc_phase?: number;
  ipc_type?: string;
  population_in_phase?: number;
  reference_period_start?: string;
}

export interface HDXHAPIResponse {
  data?: HDXHAPIRow[];
  fetchedAt?: number;
}

export function hdxHapiToObservations(response: HDXHAPIResponse): ObservationEvent[] {
  if (!response?.data || !Array.isArray(response.data)) return [];
  const fetchedAt = response.fetchedAt ?? Date.now();
  const observations: ObservationEvent[] = [];

  // Group by location to avoid one observation per row (HAPI has many rows per location)
  const byLocation = new Map<string, { phase: number; pop: number; name: string; start: string }>();
  for (const row of response.data) {
    const code = (row.location_code ?? 'XX').toUpperCase();
    const phase = Number(row.ipc_phase ?? 0);
    const pop = Number(row.population_in_phase ?? 0);
    const existing = byLocation.get(code);
    if (!existing || phase > existing.phase) {
      byLocation.set(code, {
        phase, pop,
        name: row.location_name ?? code,
        start: row.reference_period_start ?? '',
      });
    }
  }

  for (const [code, data] of byLocation) {
    const sev = ipcSeverity(data.phase);
    if (!sev) continue;

    const timestamp = data.start ? new Date(data.start).getTime() : fetchedAt;
    const popStr = data.pop > 0 ? ` (${(data.pop / 1_000_000).toFixed(1)}M people)` : '';

    observations.push({
      id: `hdx-hapi-${code}-${Math.floor(fetchedAt / (6 * 60 * 60 * 1000))}`,
      sourceId: 'hdx-hapi',
      domain: 'humanitarian',
      timestamp: Number.isFinite(timestamp) ? timestamp : fetchedAt,
      severity: sev,
      title: `IPC Phase ${data.phase} food insecurity${popStr} — ${data.name}`,
      raw: { code, ...data },
      entityIds: [code],
      tags: ['food-security', 'ipc', `ipc-phase-${data.phase}`, 'hdx-hapi'],
    });
  }

  return observations;
}
