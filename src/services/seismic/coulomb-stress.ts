/**
 * Coulomb stress transfer — Layer-7 stub (descoped to strike-slip).
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 * Computes the static Coulomb stress change on receiver faults parallel
 * to the source rupture, using a 2D point-source simplification of the
 * Okada (1992) elastic dislocation model. The stub is intentionally
 * limited to vertical strike-slip ruptures — the cleanest case where
 * the closed form has a known butterfly pattern. Full oblique / dip-
 * slip Okada is a future PR.
 *
 * Plan invariants:
 *   - Stub is honest about scope: input rejects non-strike-slip rake
 *     (|rake| > 30° and |rake| < 150°) with `null` output rather than
 *     pretending to handle reverse / normal mechanisms. Callers should
 *     fall back to "no Coulomb estimate available" for those events.
 *   - Sign convention: positive ΔCFS = receiver fault advanced toward
 *     failure (loaded). Threshold for "triggering-significant" lobes
 *     follows the literature: |ΔCFS| > 0.1 bar (10 kPa).
 *   - Output is a regular lat/lon grid at fixed resolution. Callers
 *     can rasterise the grid for display; the service does not draw.
 *   - Closed form (in fault-aligned coords r, α from strike):
 *       ΔCFS(r, α) = K × (cos(2α) + μ' × sin(2α)) / r³
 *     where K = (G × U × A) / (4π), A is the rupture area (penny-
 *     shaped, π(L/2)²), U is slip, G is shear modulus (default 30 GPa),
 *     and μ' is the effective friction coefficient (default 0.4). The
 *     1/r³ falloff is the static 3D point-source approximation; below
 *     the rupture half-length the formula is undefined and we report 0.
 *
 * Future work: replace with full 3D Okada (1992) rectangular dislocation
 *               model — adds dip-slip components, depth integration,
 *               receiver-fault rake parameterisation, and the USGS
 *               Quaternary Fault database lookup for known nearby
 *               segments. The CoulombStressResult shape stays compatible.
 */

// ── Public types ────────────────────────────────────────────────────────

export interface CoulombSource {
  /** Stable identifier for the rupture event. */
  eventId: string;
  /** Hypocentre / rupture centre, decimal degrees. */
  lat: number;
  lon: number;
  /** Compass azimuth of the fault strike (0 = north, increases east),
   *  degrees. */
  strikeDeg: number;
  /** Rake angle on the source plane, Aki-Richards convention. The stub
   *  rejects non-strike-slip values (|rake|>30 and |rake|<150). */
  rakeDeg: number;
  /** Rupture length along strike, km. */
  lengthKm: number;
  /** Average slip, metres. Defaults via Wells & Coppersmith (1994) when
   *  the caller doesn't have a moment-tensor estimate; the helper
   *  `wellsCoppersmithSlip` provides that estimate. */
  slipMeters: number;
}

export interface CoulombGridOptions {
  /** Output grid resolution, decimal degrees. Default 0.1°. */
  resolutionDeg?: number;
  /** Output grid radius, km. Default 200. */
  radiusKm?: number;
  /** Effective friction coefficient (μ') in the Coulomb formula.
   *  Default 0.4 (Stein, 1999 review value for strike-slip). */
  effectiveFriction?: number;
  /** Shear modulus (G), Pa. Default 30 GPa. */
  shearModulusPa?: number;
  /** Triggering threshold (bar). Cells with |ΔCFS| > threshold count
   *  toward `positiveLobeArea_km2` / `negativeLobeArea_km2`. Default
   *  0.1 bar (10 kPa). */
  triggerThresholdBar?: number;
}

export interface CoulombGridCell {
  lat: number;
  lon: number;
  /** Coulomb stress change at the cell, in bars (positive = loaded). */
  deltaCfsBar: number;
}

export interface CoulombStressResult {
  eventId: string;
  source: CoulombSource;
  stressGrid: CoulombGridCell[];
  positiveLobeArea_km2: number;
  negativeLobeArea_km2: number;
  /** Empty until USGS Quaternary Fault DB lookup is wired up — declared
   *  in the type so the future PR can add data without breaking shape. */
  faultSegmentsLoaded: readonly string[];
  /** Honest scope statement for downstream UI. */
  notes: string;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Compute the Coulomb stress change grid for a strike-slip rupture.
 * Returns null when the rupture is not a clean strike-slip mechanism;
 * callers should treat that as "no estimate available".
 */
export function computeCoulombStressStrikeSlip(
  source: CoulombSource,
  options: CoulombGridOptions = {},
): CoulombStressResult | null {
  if (!validateCoulombSource(source)) return null;

  const opts = withDefaults(options);
  const halfLengthKm = source.lengthKm / 2;
  const K = computeCoulombK(source, opts.shearModulusPa);
  const cellAreaKm2 = computeCellAreaKm2(source.lat, opts.resolutionDeg);

  const grid: CoulombGridCell[] = [];
  let positiveLobeArea_km2 = 0;
  let negativeLobeArea_km2 = 0;

  const radiusDeg = opts.radiusKm / KM_PER_DEG_LAT;
  for (let dLat = -radiusDeg; dLat <= radiusDeg + 1e-9; dLat += opts.resolutionDeg) {
    for (let dLon = -radiusDeg; dLon <= radiusDeg + 1e-9; dLon += opts.resolutionDeg) {
      const cell = evaluateGridCell({
        sourceLat: source.lat,
        sourceLon: source.lon,
        sourceStrikeDeg: source.strikeDeg,
        dLat,
        dLon,
        radiusKm: opts.radiusKm,
        halfLengthKm,
        K,
        friction: opts.effectiveFriction,
      });
      if (!cell) continue;
      grid.push(cell);
      if (cell.deltaCfsBar > opts.triggerThresholdBar) positiveLobeArea_km2 += cellAreaKm2;
      else if (cell.deltaCfsBar < -opts.triggerThresholdBar) negativeLobeArea_km2 += cellAreaKm2;
    }
  }

  return {
    eventId: source.eventId,
    source,
    stressGrid: grid,
    positiveLobeArea_km2,
    negativeLobeArea_km2,
    faultSegmentsLoaded: [],
    notes:
      'Simplified strike-slip Okada stub: 3D point-source approximation. '
      + 'Full 3D rectangular dislocation (Okada 1992) with dip-slip support is a future PR.',
  };
}

/**
 * Wells & Coppersmith (1994) magnitude→slip scaling for strike-slip
 * faults: log10(slip_m) = -6.32 + 0.90 * Mw. Useful when the caller
 * lacks a moment-tensor slip estimate. Returns metres.
 */
export function wellsCoppersmithSlip(magnitudeMw: number): number {
  if (!Number.isFinite(magnitudeMw)) return 0;
  return 10 ** (-6.32 + 0.9 * magnitudeMw);
}

/** Right-lateral / left-lateral / dipping classifier — strict version
 *  used for stub scope-gating. |rake| < 30 OR |rake| > 150. */
export function isStrikeSlipRake(rakeDeg: number): boolean {
  if (!Number.isFinite(rakeDeg)) return false;
  let r = rakeDeg % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  const abs = Math.abs(r);
  return abs < 30 || abs > 150;
}

// ── Internal helpers ───────────────────────────────────────────────────

interface ResolvedOptions {
  resolutionDeg: number;
  radiusKm: number;
  effectiveFriction: number;
  shearModulusPa: number;
  triggerThresholdBar: number;
}

function withDefaults(options: CoulombGridOptions): ResolvedOptions {
  return {
    resolutionDeg: options.resolutionDeg ?? 0.1,
    radiusKm: options.radiusKm ?? 200,
    effectiveFriction: options.effectiveFriction ?? 0.4,
    shearModulusPa: options.shearModulusPa ?? 30e9,
    triggerThresholdBar: options.triggerThresholdBar ?? 0.1,
  };
}

function validateCoulombSource(source: CoulombSource): boolean {
  if (!isStrikeSlipRake(source.rakeDeg)) return false;
  if (!Number.isFinite(source.lat) || source.lat < -90 || source.lat > 90) return false;
  if (!Number.isFinite(source.lon) || source.lon < -180 || source.lon > 180) return false;
  if (!Number.isFinite(source.lengthKm) || source.lengthKm <= 0) return false;
  if (!Number.isFinite(source.slipMeters) || source.slipMeters <= 0) return false;
  return true;
}

/** K in N·m (= Pa × m³); divides by r³ (m³) → Pa. Penny-shaped area
 *  A = π × (L/2)² gives a self-consistent 3D-point-source area from
 *  the rupture half-length. */
function computeCoulombK(source: CoulombSource, shearModulusPa: number): number {
  const halfLengthM = (source.lengthKm * 1000) / 2;
  const areaM2 = Math.PI * halfLengthM * halfLengthM;
  return (shearModulusPa * source.slipMeters * areaM2) / (4 * Math.PI);
}

function computeCellAreaKm2(latDeg: number, resolutionDeg: number): number {
  const cellLatKm = resolutionDeg * KM_PER_DEG_LAT;
  const cellLonKm = resolutionDeg * KM_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180);
  return Math.abs(cellLatKm * cellLonKm);
}

interface CellInputs {
  sourceLat: number;
  sourceLon: number;
  sourceStrikeDeg: number;
  dLat: number;
  dLon: number;
  radiusKm: number;
  halfLengthKm: number;
  K: number;
  friction: number;
}

function evaluateGridCell(input: CellInputs): CoulombGridCell | null {
  const lat = input.sourceLat + input.dLat;
  const lon = input.sourceLon + input.dLon;
  if (lat < -90 || lat > 90) return null;

  const distKm = haversineKm(input.sourceLat, input.sourceLon, lat, lon);
  if (distKm > input.radiusKm) return null;

  // Inside the rupture half-length: the closed form is undefined.
  // Report zero so the lobe area integrals stay sane.
  if (distKm < input.halfLengthKm) {
    return { lat, lon, deltaCfsBar: 0 };
  }

  const azimuthDeg = bearingDeg(input.sourceLat, input.sourceLon, lat, lon);
  const alphaRad = ((azimuthDeg - input.sourceStrikeDeg) * Math.PI) / 180;

  const rMeters = distKm * 1000;
  const factor = Math.cos(2 * alphaRad) + input.friction * Math.sin(2 * alphaRad);
  const deltaCfsPa = (input.K * factor) / (rMeters * rMeters * rMeters);
  const deltaCfsBar = deltaCfsPa / 1e5;
  return { lat, lon, deltaCfsBar };
}

const KM_PER_DEG_LAT = 111.32;
const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/** Initial bearing (forward azimuth) from point 1 to point 2. Returns
 *  degrees in [0, 360). */
function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const theta = Math.atan2(y, x);
  return ((theta * 180) / Math.PI + 360) % 360;
}
