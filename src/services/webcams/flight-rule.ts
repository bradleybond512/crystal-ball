import type { FlightRule, MetarCloudLayer } from './metar-types';

const CEILING_COVERS = new Set(['BKN', 'OVC', 'VV']);

export function ceilingFromClouds(clouds: MetarCloudLayer[]): number | null {
  if (!Array.isArray(clouds) || clouds.length === 0) return null;
  let lowest: number | null = null;
  for (const layer of clouds) {
    if (!CEILING_COVERS.has(layer.cover)) continue;
    if (typeof layer.baseFt !== 'number' || !Number.isFinite(layer.baseFt)) continue;
    if (lowest === null || layer.baseFt < lowest) lowest = layer.baseFt;
  }
  return lowest;
}

export function deriveFlightRule(
  visibilityMi: number | null,
  ceilingFt: number | null,
): FlightRule | null {
  const visUnknown = visibilityMi === null || !Number.isFinite(visibilityMi);
  const ceilUnknown = ceilingFt === null || !Number.isFinite(ceilingFt);
  if (visUnknown && ceilUnknown) return null;

  if ((!visUnknown && (visibilityMi as number) < 1) || (!ceilUnknown && (ceilingFt as number) < 500)) {
    return 'LIFR';
  }
  if (
    (!visUnknown && (visibilityMi as number) < 3) ||
    (!ceilUnknown && (ceilingFt as number) < 1000)
  ) {
    return 'IFR';
  }
  if (
    (!visUnknown && (visibilityMi as number) <= 5) ||
    (!ceilUnknown && (ceilingFt as number) <= 3000)
  ) {
    return 'MVFR';
  }
  return 'VFR';
}

export function flightRuleColor(rule: FlightRule | null): string {
  switch (rule) {
    case 'VFR': {
      return '#3fb950';
    }
    case 'MVFR': {
      return '#58a6ff';
    }
    case 'IFR': {
      return '#f85149';
    }
    case 'LIFR': {
      return '#bc8cff';
    }
    default: {
      return '#8b949e';
    }
  }
}
