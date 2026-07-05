import type { GridAlert } from '../power-grid.ts';
import type { DcLevel, PowerPosture } from './datacenter-types.ts';
import { dcLevelRank } from './datacenter-types.ts';

export const POWER_UTIL_WARNING_PCT = 92;
export const POWER_UTIL_ADVISORY_PCT = 85;
export const NEARBY_OUTAGE_CRITICAL = 5000;
export const NEARBY_OUTAGE_WARNING = 1000;

export interface PowerPostureInput {
  gridUtilizationPct: number | null;
  gridAlerts: GridAlert[];
  nearbyOutageCount: number | null;
}

export function levelForAlert(severity: GridAlert['severity']): DcLevel {
  switch (severity) {
    case 'emergency': { return 'critical';
    }
    case 'warning': { return 'warning';
    }
    case 'watch': { return 'watch';
    }
    default: { return 'normal';
    }
  }
}

export function levelForUtil(pct: number | null): DcLevel {
  if (pct === null) return 'normal';
  if (pct >= POWER_UTIL_WARNING_PCT) return 'warning';
  if (pct >= POWER_UTIL_ADVISORY_PCT) return 'advisory';
  return 'normal';
}

export function levelForOutage(count: number | null): DcLevel {
  if (count === null) return 'normal';
  if (count >= NEARBY_OUTAGE_CRITICAL) return 'critical';
  if (count >= NEARBY_OUTAGE_WARNING) return 'warning';
  return 'normal';
}

export function computePowerPosture(input: PowerPostureInput): PowerPosture {
  const candidates: DcLevel[] = [
    levelForUtil(input.gridUtilizationPct),
    levelForOutage(input.nearbyOutageCount),
    ...input.gridAlerts.map((a) => levelForAlert(a.severity)),
  ];
  const level = candidates.reduce<DcLevel>(
    (acc, c) => (dcLevelRank(c) > dcLevelRank(acc) ? c : acc),
    'normal',
  );

  const drivers: string[] = [];
  if (input.gridUtilizationPct !== null && input.gridUtilizationPct >= POWER_UTIL_ADVISORY_PCT) {
    drivers.push(`Grid at ${input.gridUtilizationPct}% of capacity`);
  }
  if (input.nearbyOutageCount !== null && input.nearbyOutageCount >= NEARBY_OUTAGE_WARNING) {
    drivers.push(`${(input.nearbyOutageCount / 1000).toFixed(1)}k customers out nearby`);
  }
  for (const a of input.gridAlerts) {
    if (levelForAlert(a.severity) !== 'normal') drivers.push(`${a.severity} grid alert: ${a.title}`);
  }

  return {
    level,
    gridUtilizationPct: input.gridUtilizationPct,
    gridAlerts: input.gridAlerts,
    nearbyOutageCount: input.nearbyOutageCount,
    drivers,
  };
}
