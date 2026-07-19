// src/services/survival/chokepoint-mobility-adapter.ts
/**
 * Adapts the live sidecar chokepoint feed (`supply-chain` `ChokepointInfo`, a
 * throughput-disruption model) into the richer `ChokepointStatus` shape the
 * mobility posture contributor consumes.
 *
 * The two chokepoint models diverge: the mobility contributor was built around
 * `monitorChokepoints`' incident + military-density closure-risk model, but the
 * only chokepoint data actually fetched live is the sidecar's throughput view
 * (`disruptionScore = 100 - throughput_pct`). Low throughput IS a closure risk —
 * a strait running at 30% throughput is effectively 70% closed — so mapping
 * `disruptionScore → closureRisk` is a faithful mobility signal. Fields the
 * throughput source can't supply (incident/military counts) are set to 0, which
 * lands the contributor's confidence at 'medium' (no incident corroboration) —
 * honest, not fabricated.
 *
 * Pure: no fetch/DOM/state.
 */
import type { ChokepointInfo } from '../supply-chain';
import type { ChokepointStatus, ChokepointId, ThreatLevel } from '../maritime/chokepoint-monitor.ts';

// Same bands as chokepoint-monitor.ts `thresholdLevel` (green <16, yellow 16–40,
// orange 41–70, red ≥71) so the disruption→threat mapping stays consistent with
// the incident-driven path the contributor was designed against.
function bandForScore(score: number): ThreatLevel {
  if (score >= 71) return 'red';
  if (score >= 41) return 'orange';
  if (score >= 16) return 'yellow';
  return 'green';
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function adaptOne(info: ChokepointInfo): ChokepointStatus {
  const closureRisk = clampScore(info.disruptionScore);
  const drivers = [info.status, info.congestionLevel].filter((s): s is string => Boolean(s?.trim()));
  return {
    // `id` is a generic index string from the throughput feed; it only needs to be
    // stable/unique for the contributor's `chokepoint-<id>` sourceEventId.
    id: (info.id || info.name) as ChokepointId,
    name: info.name,
    lat: info.lat,
    lon: info.lon,
    vesselCount24h: 0,
    militaryVesselCount: 0,
    // The throughput source carries no incident history → 0 keeps the contributor
    // at 'medium' confidence (it only claims 'high' when incidentCount7d > 0).
    incidentCount7d: 0,
    closureRisk,
    primaryCommodities: [...info.affectedRoutes],
    globalTradePctNote: info.description || info.name,
    lastIncident: null,
    threatLevel: bandForScore(closureRisk),
    drivers: drivers.length > 0 ? drivers : ['Reduced throughput'],
  };
}

/** Map the live throughput chokepoint feed to the mobility contributor's input. */
export function adaptChokepointInfoToStatus(infos: readonly ChokepointInfo[]): ChokepointStatus[] {
  return infos.map((info) => adaptOne(info));
}
