/**
 * Adapter helpers that translate existing data shapes (GDACS / ACLED / AIS
 * disruptions / AIS positions) into the chokepoint-monitor input bag.
 *
 * Pure-deterministic — no fetch, no globals. Consumers (panels, sidebar
 * dashboards) call these to feed monitorChokepoints().
 */

import type { GDACSEvent } from '@/services/gdacs';
import type { AisDisruptionEvent } from '@/types';
import type { AisPositionData } from './index';
import {
  monitorChokepoints,
  monitorSingleChokepoint,
} from './chokepoint-monitor';
import type {
  ChokepointId,
  ChokepointIncident,
  ChokepointStatus,
  ChokepointVesselReport,
  IncidentSeverity,
  MonitorInput,
} from './chokepoint-monitor';

// ── ACLED row shape ──────────────────────────────────────────────────────────

export interface AcledRow {
  event_id_cnty?: string;
  event_date?: string;
  event_type?: string;
  sub_event_type?: string;
  latitude?: number | string;
  longitude?: number | string;
  fatalities?: number | string;
  notes?: string;
}

// ── Severity mappers ─────────────────────────────────────────────────────────

function gdacsSeverity(level: GDACSEvent['alertLevel']): IncidentSeverity {
  switch (level) {
    case 'Red': { return 'critical';
    }
    case 'Orange': { return 'high';
    }
    default: { return 'low';
    }
  }
}

function acledSeverity(row: AcledRow): IncidentSeverity {
  const fatalities = Number(row.fatalities ?? 0);
  if (fatalities >= 20) return 'critical';
  if (fatalities >= 5) return 'high';
  if (fatalities >= 1) return 'medium';
  const evt = (row.event_type ?? '').toLowerCase();
  if (evt.includes('explosion') || evt.includes('strategic')) return 'high';
  if (evt.includes('battle')) return 'medium';
  return 'low';
}

function aisDisruptionSeverity(d: AisDisruptionEvent): IncidentSeverity {
  switch (d.severity) {
    case 'high': { return 'high';
    }
    case 'elevated': { return 'medium';
    }
    default: { return 'low';
    }
  }
}

// ── Adapters ─────────────────────────────────────────────────────────────────

export function gdacsToIncidents(events: readonly GDACSEvent[]): ChokepointIncident[] {
  const out: ChokepointIncident[] = [];
  for (const e of events) {
    const lon = Number(e.coordinates?.[0]);
    const lat = Number(e.coordinates?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const occurredAt = e.fromDate instanceof Date
      ? e.fromDate.getTime()
      : new Date(e.fromDate as unknown as string).getTime();
    if (!Number.isFinite(occurredAt)) continue;
    out.push({
      id: `gdacs-${e.id}`,
      source: 'gdacs',
      lat,
      lon,
      occurredAt,
      severity: gdacsSeverity(e.alertLevel),
      description: e.description ?? e.name,
    });
  }
  return out;
}

export function acledToIncidents(rows: readonly AcledRow[]): ChokepointIncident[] {
  const out: ChokepointIncident[] = [];
  for (const r of rows) {
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const occurredAt = r.event_date ? Date.parse(r.event_date) : Number.NaN;
    if (!Number.isFinite(occurredAt)) continue;
    const fallbackKey = `${lat}-${lon}-${occurredAt}`;
    out.push({
      id: `acled-${r.event_id_cnty ?? fallbackKey}`,
      source: 'acled',
      lat,
      lon,
      occurredAt,
      severity: acledSeverity(r),
      description: r.notes ?? r.event_type,
    });
  }
  return out;
}

export function aisDisruptionsToIncidents(
  disruptions: readonly AisDisruptionEvent[],
  observedAt: number = Date.now(),
): ChokepointIncident[] {
  return disruptions.map((d) => ({
    id: `ais-${d.id}`,
    source: 'ais_disruption',
    lat: d.lat,
    lon: d.lon,
    occurredAt: observedAt,
    severity: aisDisruptionSeverity(d),
    description: d.description,
  }));
}

export function aisPositionsToVesselReports(
  positions: readonly AisPositionData[],
  observedAt: number = Date.now(),
): ChokepointVesselReport[] {
  return positions.map((p) => ({
    mmsi: p.mmsi,
    lat: p.lat,
    lon: p.lon,
    observedAt,
    isMilitary: isMilitaryShipType(p.shipType),
  }));
}

/** AIS ship-type codes 35 = Military Ops, 50 = Pilot, 51 = Search & Rescue,
 * 53 = Port Tender, 55 = Law Enforcement. We only flag 35 + 55 as "military"
 * for chokepoint scoring — the rest are state vessels but not combatant. */
export function isMilitaryShipType(shipType: number | undefined): boolean {
  if (shipType === undefined) return false;
  return shipType === 35 || shipType === 55;
}

// ── Composer ─────────────────────────────────────────────────────────────────

export interface AggregateInput {
  gdacs?: readonly GDACSEvent[];
  acled?: readonly AcledRow[];
  aisDisruptions?: readonly AisDisruptionEvent[];
  aisPositions?: readonly AisPositionData[];
  now?: number;
}

export function buildMonitorInput(input: AggregateInput): MonitorInput {
  const now = input.now ?? Date.now();
  const incidents: ChokepointIncident[] = [
    ...gdacsToIncidents(input.gdacs ?? []),
    ...acledToIncidents(input.acled ?? []),
    ...aisDisruptionsToIncidents(input.aisDisruptions ?? [], now),
  ];
  const vessels = aisPositionsToVesselReports(input.aisPositions ?? [], now);
  return { vessels, incidents, now };
}

export function aggregateChokepointStatus(input: AggregateInput): ChokepointStatus[] {
  return monitorChokepoints(buildMonitorInput(input));
}

export function aggregateSingleChokepointStatus(
  id: ChokepointId,
  input: AggregateInput,
): ChokepointStatus {
  return monitorSingleChokepoint(id, buildMonitorInput(input));
}
