/**
 * Entity heat projection — extrapolates entity heat trends forward
 * to predict which entities are likely to become hot in the next N hours.
 *
 * Samples entity heat at multiple time windows and uses linear
 * regression to project forward.
 */

import { computeEntityHeat } from './entity-heat';

const PROJECTION_HOURS = 4;
const SAMPLE_WINDOWS_MS = [1, 2, 3, 4, 5, 6].map(h => h * 60 * 60_000);

export interface HeatProjection {
  name: string;
  currentHeat: number;
  projectedHeat: number;
  trend: 'rising' | 'falling' | 'stable';
  confidence: number;
}

function linearRegression(ys: number[]): { slope: number; r2: number } {
  const n = ys.length;
  if (n < 2) return { slope: 0, r2: 0 };
  const xs = ys.map((_, i) => i);
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let ssXY = 0; let ssXX = 0; let ssYY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    ssXY += dx * dy;
    ssXX += dx * dx;
    ssYY += dy * dy;
  }
  const slope = ssXX > 0 ? ssXY / ssXX : 0;
  const r2 = ssXX > 0 && ssYY > 0 ? (ssXY * ssXY) / (ssXX * ssYY) : 0;
  return { slope, r2 };
}

export function projectEntityHeat(): HeatProjection[] {
  const heatByWindow = SAMPLE_WINDOWS_MS.map(w => {
    const entries = computeEntityHeat(w);
    const map = new Map<string, number>();
    for (const e of entries) map.set(e.name, e.weighted);
    return map;
  });

  const entityNames = new Set<string>();
  for (const m of heatByWindow) for (const k of m.keys()) entityNames.add(k);

  const projections: HeatProjection[] = [];
  for (const name of entityNames) {
    const samples = heatByWindow.map(m => m.get(name) ?? 0);
    const current = samples[samples.length - 1] ?? 0;

    const { slope, r2 } = linearRegression(samples);
    const projected = Math.max(0, current + slope * PROJECTION_HOURS);

    let trend: 'rising' | 'falling' | 'stable' = 'stable';
    if (slope > 0.3) trend = 'rising';
    else if (slope < -0.3) trend = 'falling';

    projections.push({
      name,
      currentHeat: Math.round(current * 10) / 10,
      projectedHeat: Math.round(projected * 10) / 10,
      trend,
      confidence: Math.round(r2 * 100),
    });
  }

  return projections
    .filter(p => p.projectedHeat > 0 || p.currentHeat > 0)
    .sort((a, b) => b.projectedHeat - a.projectedHeat);
}
