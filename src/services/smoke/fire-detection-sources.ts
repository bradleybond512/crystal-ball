/**
 * FIRMS fire-detection transport sources — pure clustering of NASA FIRMS
 * satellite hotspot pixels into upwind smoke sources the arrival estimator can
 * advect toward home. Complements the HMS plume + NIFC perimeter feeds with
 * near-real-time thermal detections (VIIRS/MODIS), which routinely lead the
 * slower perimeter/plume products by hours.
 *
 * Fail-closed honesty: non-finite, weak (low FRP), stale, or far-away pixels
 * are dropped, and an empty or all-rejected input yields [] — nothing
 * downstream ever reads absent detections as a fresh "all clear".
 *
 * No @/ imports — fixture-tests under tsx like the other pure smoke modules.
 */
import type { SmokeTransportSource } from './smoke-types';
import { haversineMi } from './arrival-eta';

/** A single FIRMS hotspot pixel, normalized from the wildfires client. */
export interface FirePixel {
  lat: number;
  lon: number;
  /** Fire radiative power, megawatts. */
  frpMw: number;
  /** Detection time, epoch ms. */
  detectedAtMs: number;
}

export interface FirmsTransportOptions {
  /** Reference "now" for age filtering (epoch ms). Injected for determinism. */
  nowMs?: number;
  /** Drop pixels weaker than this FRP (MW). */
  minFrpMw?: number;
  /** Drop pixels older than this many hours. */
  maxAgeHours?: number;
  /** Drop pixels farther than this from home (miles). */
  maxRadiusMi?: number;
  /** Cell size for the spatial-clustering grid (degrees). */
  cellDeg?: number;
  /** Cap on emitted sources (strongest total-FRP cells first). */
  maxSources?: number;
}

const DEFAULTS = {
  minFrpMw: 5,
  maxAgeHours: 24,
  maxRadiusMi: 450,
  cellDeg: 0.2,
  maxSources: 12,
} as const;

const HOUR_MS = 3_600_000;

/** Cell total FRP → the plume-density wording the arrival estimator ranks on. */
function intensityForFrp(totalFrpMw: number): SmokeTransportSource['intensity'] {
  if (totalFrpMw >= 500) return 'heavy';
  if (totalFrpMw >= 100) return 'medium';
  return 'light';
}

interface Cell {
  latKey: number;
  lonKey: number;
  totalFrp: number;
  sumLatFrp: number;
  sumLonFrp: number;
  count: number;
}

/**
 * Fail-closed per-pixel gate. Rejects non-finite fields, out-of-range
 * coordinates (lat 400 ≈ lat 40 under haversine periodicity — a phantom
 * source), sub-threshold FRP, future timestamps (negative age from clock
 * skew / a bad parse must not read as "fresh"), stale pixels, and far-away
 * pixels. Extracted so the clustering loop stays flat.
 */
function isUsablePixel(
  d: FirePixel,
  nowMs: number,
  minFrpMw: number,
  maxAgeHours: number,
  home: { lat: number; lon: number },
  maxRadiusMi: number,
): boolean {
  if (
    !Number.isFinite(d.lat) ||
    !Number.isFinite(d.lon) ||
    !Number.isFinite(d.frpMw) ||
    !Number.isFinite(d.detectedAtMs)
  ) return false;
  if (Math.abs(d.lat) > 90 || Math.abs(d.lon) > 180) return false;
  if (d.frpMw < minFrpMw) return false;
  const ageMs = nowMs - d.detectedAtMs;
  if (ageMs < 0 || ageMs / HOUR_MS > maxAgeHours) return false;
  return haversineMi(home.lat, home.lon, d.lat, d.lon) <= maxRadiusMi;
}

/**
 * Cluster FIRMS hotspots into ranked SmokeTransportSource fires. Survivors are
 * binned onto a `cellDeg` grid; each cell reports its summed FRP and its
 * FRP-weighted centroid (so a cell's coordinate leans toward its hottest
 * pixels). Cells are ranked by total FRP and capped at `maxSources`.
 */
export function firmsToTransportSources(
  detections: readonly FirePixel[],
  home: { lat: number; lon: number },
  options: FirmsTransportOptions = {},
): SmokeTransportSource[] {
  const nowMs = options.nowMs ?? Date.now();
  const minFrpMw = options.minFrpMw ?? DEFAULTS.minFrpMw;
  const maxAgeHours = options.maxAgeHours ?? DEFAULTS.maxAgeHours;
  const maxRadiusMi = options.maxRadiusMi ?? DEFAULTS.maxRadiusMi;
  const cellDeg = options.cellDeg ?? DEFAULTS.cellDeg;
  const maxSources = options.maxSources ?? DEFAULTS.maxSources;

  // A non-positive/non-finite grid or home would make binning meaningless — fail closed.
  if (!Number.isFinite(cellDeg) || cellDeg <= 0) return [];
  if (!Number.isFinite(home.lat) || !Number.isFinite(home.lon)) return [];

  const cells = new Map<string, Cell>();
  for (const d of detections) {
    if (!isUsablePixel(d, nowMs, minFrpMw, maxAgeHours, home, maxRadiusMi)) continue;

    const latKey = Math.floor(d.lat / cellDeg);
    const lonKey = Math.floor(d.lon / cellDeg);
    const key = `${latKey}:${lonKey}`;
    const cell = cells.get(key);
    if (cell) {
      cell.totalFrp += d.frpMw;
      cell.sumLatFrp += d.lat * d.frpMw;
      cell.sumLonFrp += d.lon * d.frpMw;
      cell.count += 1;
    } else {
      cells.set(key, {
        latKey,
        lonKey,
        totalFrp: d.frpMw,
        sumLatFrp: d.lat * d.frpMw,
        sumLonFrp: d.lon * d.frpMw,
        count: 1,
      });
    }
  }

  return [...cells.values()]
    .sort((a, b) => b.totalFrp - a.totalFrp)
    .slice(0, maxSources)
    .map((cell): SmokeTransportSource => {
      const hotspots = cell.count === 1 ? '1 hotspot' : `${cell.count} hotspots`;
      return {
        id: `firms:${cell.latKey}:${cell.lonKey}`,
        kind: 'fire',
        label: `Satellite fire detection (${hotspots})`,
        lat: cell.sumLatFrp / cell.totalFrp,
        lon: cell.sumLonFrp / cell.totalFrp,
        intensity: intensityForFrp(cell.totalFrp),
      };
    });
}
