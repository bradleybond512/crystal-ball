/**
 * ENSO Monitor — per Batch 3 of the climate/economic plan.
 *
 * NOAA ONI (Oceanic Niño Index) parser + phase classification + the
 * ENSO→shortage impact table. Wires into the existing shortage radar
 * by emitting per-commodity probability adjustments based on the
 * current phase.
 *
 * Pure deterministic. No DOM, no fetch, no globals. The sidecar pulls
 * the ASCII table from cpc.ncep.noaa.gov; this module turns the text
 * into typed observations and applies the adjustment table.
 */

// ── Public types ───────────────────────────────────────────────────────

export type EnsoPhase = 'el_nino' | 'la_nina' | 'neutral';

export interface EnsoObservation {
  /** Calendar year. */
  year: number;
  /** 3-month overlapping season label NOAA uses ("DJF", "JFM", "FMA",
   *  …). The most recent season anchors the snapshot. */
  season: string;
  /** Oceanic Niño Index value (°C anomaly in ERSSTv5 Niño 3.4). */
  oni: number;
}

export interface EnsoSnapshot {
  /** Most recent observation. */
  current: EnsoObservation;
  /** Most recent run of consecutive observations meeting the
   *  threshold. NOAA's official rule is 5 consecutive seasons of
   *  ONI ≥ 0.5 (El Niño) / ≤ -0.5 (La Niña). */
  phase: EnsoPhase;
  /** Length of the current phase run, in seasons. */
  phaseRunLength: number;
  /** Plain-English description of the 6-month outlook, derived from
   *  the deterministic state-machine in `outlookFor`. */
  forecast6m: string;
}

export type EnsoCommodityKey =
  | 'wheat_australia'
  | 'rice_southeast_asia'
  | 'soy_south_america'
  | 'corn_north_america'
  | 'wheat_north_america'
  | 'coffee_east_africa';

export interface EnsoShortageAdjustment {
  commodity: EnsoCommodityKey;
  /** Multiplier applied to the existing shortage probability when this
   *  phase is active. >1 raises risk, <1 lowers it. Always > 0. */
  multiplier: number;
  /** Free-text rationale that goes onto the shortage card. */
  rationale: string;
}

// ── ASCII parser ───────────────────────────────────────────────────────

/**
 * Parse the NOAA CPC `oni.ascii.txt` file. Format (whitespace-separated):
 *
 *   SEAS  YR  TOTAL  ANOM
 *   DJF  1950  24.72  -1.54
 *   ...
 *
 * Returns observations chronologically (oldest first). Tolerates
 * blank lines, comment lines starting with `#`, and varying internal
 * whitespace. Drops rows where ANOM is missing/non-numeric.
 */
export function parseOniAscii(text: string): EnsoObservation[] {
  if (!text) return [];
  const out: EnsoObservation[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    const season = parts[0]!;
    if (!/^[A-Z]{3}$/.test(season)) continue;            // skip header line
    const year = Number.parseInt(parts[1]!, 10);
    const anom = Number.parseFloat(parts[3]!);
    if (!Number.isFinite(year) || !Number.isFinite(anom)) continue;
    out.push({ year, season, oni: anom });
  }
  return out;
}

// ── Phase classification ───────────────────────────────────────────────

const PHASE_THRESHOLD = 0.5;
/** Per NOAA, the official El Niño / La Niña declaration needs 5
 *  consecutive overlapping seasons meeting the threshold. The
 *  `currentPhaseRun` helper reports the actual run length so callers
 *  can decide whether to render "developing" vs "established"; this
 *  module does not enforce a minimum. */

function describeDrift(drift: number): 'strengthening' | 'weakening' | 'holding' {
  if (drift > 0.1) return 'strengthening';
  if (drift < -0.1) return 'weakening';
  return 'holding';
}

function phaseOfValue(oni: number): EnsoPhase {
  if (oni >= PHASE_THRESHOLD) return 'el_nino';
  if (oni <= -PHASE_THRESHOLD) return 'la_nina';
  return 'neutral';
}

/** Walk the trailing observations to find the longest run that
 *  matches the most recent phase. Returns 0 when the latest reading
 *  is neutral (no run). */
export function currentPhaseRun(observations: readonly EnsoObservation[]): {
  phase: EnsoPhase;
  runLength: number;
} {
  if (observations.length === 0) return { phase: 'neutral', runLength: 0 };
  const latest = observations[observations.length - 1]!;
  const phase = phaseOfValue(latest.oni);
  if (phase === 'neutral') return { phase: 'neutral', runLength: 0 };
  let run = 0;
  for (let i = observations.length - 1; i >= 0; i -= 1) {
    if (phaseOfValue(observations[i]!.oni) !== phase) break;
    run += 1;
  }
  return { phase, runLength: run };
}

// ── 6-month outlook ────────────────────────────────────────────────────

/** Deterministic outlook derived from the most recent slope of the
 *  3-month moving average. Not an actual forecast — anchored language
 *  the panel can show without lying about predictive power. */
export function outlookFor(observations: readonly EnsoObservation[]): string {
  if (observations.length < 4) return 'Insufficient history for an outlook.';
  const tail = observations.slice(-4).map((o) => o.oni);
  const earlyAvg = (tail[0]! + tail[1]!) / 2;
  const lateAvg = (tail[2]! + tail[3]!) / 2;
  const drift = lateAvg - earlyAvg;
  const phase = phaseOfValue(tail[3]!);
  const direction = describeDrift(drift);
  switch (phase) {
    case 'el_nino': {
      return `El Niño ${direction}; sustained warm anomaly likely through next 6 months.`;
    }
    case 'la_nina': {
      return `La Niña ${direction}; cool anomaly likely through next 6 months.`;
    }
    default: {
      if (drift > 0.2) return 'Trending toward El Niño territory; watch for ONI ≥ 0.5 in upcoming seasons.';
      if (drift < -0.2) return 'Trending toward La Niña territory; watch for ONI ≤ -0.5 in upcoming seasons.';
      return 'Neutral conditions persisting; no strong directional signal.';
    }
  }
}

// ── Snapshot ───────────────────────────────────────────────────────────

export function buildSnapshot(observations: readonly EnsoObservation[]): EnsoSnapshot | null {
  if (observations.length === 0) return null;
  const { phase, runLength } = currentPhaseRun(observations);
  return {
    current: observations[observations.length - 1]!,
    phase,
    phaseRunLength: runLength,
    forecast6m: outlookFor(observations),
  };
}

// ── ENSO → shortage impact table ───────────────────────────────────────

/** Static impact table — per the spec. Multipliers apply on top of the
 *  shortage radar's existing per-commodity probability. Reviewed
 *  2026-05-05; future climate-economic literature updates land via PR. */
const EL_NINO_IMPACTS: readonly EnsoShortageAdjustment[] = [
  { commodity: 'wheat_australia', multiplier: 1.45, rationale: 'El Niño dries Australian winter wheat belt; -20 % yield typical.' },
  { commodity: 'rice_southeast_asia', multiplier: 1.3, rationale: 'El Niño suppresses SE Asian monsoon; rice paddies under-watered.' },
  { commodity: 'soy_south_america', multiplier: 1.25, rationale: 'El Niño shortens South American summer rains; -15 % soy yield.' },
  { commodity: 'corn_north_america', multiplier: 1.15, rationale: 'El Niño raises drought risk in CA / Midwest +40 %.' },
];

const LA_NINA_IMPACTS: readonly EnsoShortageAdjustment[] = [
  { commodity: 'wheat_north_america', multiplier: 1.3, rationale: 'La Niña drought in US southern plains; -15 % wheat yield typical.' },
  { commodity: 'wheat_australia', multiplier: 1.2, rationale: 'La Niña floods Australian wheat belt; quality + harvest losses.' },
  { commodity: 'coffee_east_africa', multiplier: 1.25, rationale: 'La Niña drought in East African coffee belt.' },
  { commodity: 'corn_north_america', multiplier: 0.95, rationale: 'La Niña usually wetter for US Midwest corn — slight downside.' },
];

/** Adjustments to apply when the phase is active. Returns an empty
 *  array for neutral. */
export function adjustmentsFor(phase: EnsoPhase): readonly EnsoShortageAdjustment[] {
  switch (phase) {
    case 'el_nino':  { return EL_NINO_IMPACTS; }
    case 'la_nina':  { return LA_NINA_IMPACTS; }
    default:         { return []; }
  }
}

/** Apply the active phase's adjustment to a base shortage probability,
 *  clamped to [0, 1]. Returns the original value when neutral. */
export function applyAdjustment(
  baseProbability: number,
  commodity: EnsoCommodityKey,
  phase: EnsoPhase,
): number {
  const adj = adjustmentsFor(phase).find((a) => a.commodity === commodity);
  if (!adj) return baseProbability;
  const next = baseProbability * adj.multiplier;
  return Math.max(0, Math.min(1, next));
}
