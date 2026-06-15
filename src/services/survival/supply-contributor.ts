// src/services/survival/supply-contributor.ts
import type { ShortageSummaryEntry } from '../shortage/shortage-fullset.ts';
import type { ShortageConfidence } from '../shortage/shortage-types.ts';
import type { ThreatLevel } from '../weather/weather-threat-types.ts';
import type { PostureThreat } from './survival-types.ts';
import type { PostureContributor } from './posture-contributor.ts';

function threatLevelForRisk(level: ShortageSummaryEntry['riskLevel']): ThreatLevel {
  switch (level) {
    case 'CRITICAL': { return 'emergency';
    }
    case 'HIGH': { return 'warning';
    }
    case 'MODERATE': { return 'advisory';
    }
    case 'LOW': { return 'none';
    }
  }
}

function confidenceLabel(confidence: ShortageConfidence): 'low' | 'medium' | 'high' {
  return confidence;
}

function titleCaseCommodity(commodity: string): string {
  const words = commodity.replace(/-/g, ' ').split(' ');
  const titled = words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
  return titled;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** Wraps shortage forecasts as a posture contributor (supply axis). Each
 *  non-LOW commodity becomes a PostureThreat. Pure: no fetch/DOM. */
export function makeSupplyContributor(entries: readonly ShortageSummaryEntry[]): PostureContributor {
  return {
    id: 'supply',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    contribute(_now: number): PostureThreat[] {
      return entries
        .filter((e) => e.riskLevel !== 'LOW')
        .map((e) => ({
          sourceEventId: `shortage-${e.commodity}`,
          axis: 'supply' as const,
          severity: clamp(e.riskScore),
          threatLevel: threatLevelForRisk(e.riskLevel),
          hazardKind: 'other' as const,
          hazardLabel: `${titleCaseCommodity(e.commodity)} shortage`,
          timeToImpactMins: null,
          arrivalLabel: e.timeToImpact || null,
          why: e.primaryDrivers[0] ?? 'supply risk elevated',
          confidenceLabel: confidenceLabel(e.forecast.confidence),
        }));
    },
  };
}
