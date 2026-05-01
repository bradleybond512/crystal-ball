/**
 * Forecast engine — aggregates prediction shapes from existing data sources.
 *
 * Used by GlobePredictions (Task 10, Tier 2 hover/click cones) and
 * GlobeBranching (Task 11, click-only scenario forks). Pure functions; no
 * Cesium imports here so they're trivially unit-testable.
 *
 * The aftershock and conflict-branch math is simplified by design — the
 * spec calls for production-grade ETAS / NHC track ensemble in a follow-up.
 * The current models are good enough to render plausible Tier 2 overlays
 * and to plug into the existing EMA forecast service.
 *
 * Plan: docs/superpowers/plans/2026-04-13-gods-eye-4d.md (Task 9)
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const EARTH_RADIUS_KM = 6371;

export interface ForecastPoint {
  lat: number;
  lon: number;
  timeMs: number;
  confidence: number;
}

export interface ForecastCone {
  entityId: string;
  type: 'cyclone' | 'flight' | 'fire' | 'vessel';
  probablePath: ForecastPoint[];
  /** Outer boundary as a closed polygon (caller closes the loop). */
  conePolygon: { lat: number; lon: number }[];
}

export interface TrackPoint {
  lat: number;
  lon: number;
  timeMs: number;
}

export interface AftershockRing {
  radiusKm: number;
  probability: number;
  magnitudeThreshold: number;
}

export interface AftershockForecast {
  entityId: string;
  epicenterLat: number;
  epicenterLon: number;
  mainshockMagnitude: number;
  rings: AftershockRing[];
}

export interface ScenarioBranch {
  label: string;
  probability: number;
  outcome: 'escalation' | 'stalemate' | 'deescalation';
  path: ForecastPoint[];
  conditions: string;
}

export interface BranchingForecast {
  entityId: string;
  type: 'conflict' | 'cyclone';
  branches: ScenarioBranch[];
}

/**
 * Modified Omori-Utsu / Reasenberg-Jones aftershock probability over a 30-day
 * window. The temporal rate of aftershocks of magnitude ≥ M' follows
 *
 *   λ(t) = K / (t + c)^p,
 *
 * where t is days since mainshock, p ≈ 1.1, c ≈ 0.1, and K scales with the
 * difference between the mainshock magnitude and M' via Gutenberg-Richter:
 *
 *   K(M') = 10^(a + b*(Mmax - M' - 1)),    a ≈ -1.67, b ≈ 1.
 *
 * Cumulative count over [0, T] for p ≠ 1:
 *
 *   N(0..T; M') = K * (c^(1-p) - (T + c)^(1-p)) / (p - 1).
 *
 * Probability of at least one aftershock = 1 - exp(-N). Spatial confinement
 * to a ring of radius R is approximated by a normalized r²/Rmax² area term,
 * which avoids the brittle 1/(1 + R/50) heuristic the previous model used.
 */
const AFTERSHOCK_P = 1.1;
const AFTERSHOCK_C = 0.1;
const AFTERSHOCK_A = -1.67;
const AFTERSHOCK_B = 1;
const AFTERSHOCK_WINDOW_DAYS = 30;
const AFTERSHOCK_RMAX_KM = 100;

function aftershockExpectedCount(
  mainshockMag: number,
  thresholdMag: number,
  windowDays: number,
): number {
  if (thresholdMag >= mainshockMag) return 0;
  const k = Math.pow(10, AFTERSHOCK_A + AFTERSHOCK_B * (mainshockMag - thresholdMag - 1));
  const exponent = 1 - AFTERSHOCK_P;
  const integrated = (Math.pow(AFTERSHOCK_C, exponent) - Math.pow(windowDays + AFTERSHOCK_C, exponent))
    / (AFTERSHOCK_P - 1);
  return Math.max(0, k * integrated);
}

export function computeAftershockForecast(
  entityId: string,
  lat: number,
  lon: number,
  magnitude: number,
): AftershockForecast {
  const rings: AftershockRing[] = [];

  for (const radiusKm of [25, 50, 100]) {
    const areaFraction = Math.min(1, (radiusKm / AFTERSHOCK_RMAX_KM) ** 2);
    for (const magThreshold of [4, 5, 6]) {
      const expected = aftershockExpectedCount(magnitude, magThreshold, AFTERSHOCK_WINDOW_DAYS);
      const prob = 1 - Math.exp(-expected * areaFraction);
      rings.push({
        radiusKm,
        probability: Math.min(0.95, Math.max(0.01, prob)),
        magnitudeThreshold: magThreshold,
      });
    }
  }

  return {
    entityId,
    epicenterLat: lat,
    epicenterLon: lon,
    mainshockMagnitude: magnitude,
    rings,
  };
}

export interface ConflictBranchOptions {
  /** Front-line / theater bearing in degrees (0=N, 90=E). If omitted, a
   *  deterministic per-entity bearing is used so branches still differ. */
  headingDeg?: number;
  /** Optional advance speed (km/day). Caps at 25 km/day; defaults to 5. */
  speedKmPerDay?: number;
}

const DEG_TO_RAD = Math.PI / 180;

function deterministicBearing(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.trunc((h << 5) - h + (seed.codePointAt(i) ?? 0));
  }
  return ((Math.abs(h) % 360) - 180) * DEG_TO_RAD;
}

/**
 * Conflict escalation branches from an EMA trend signal.
 *  emaTrend ∈ [-1, 1]   negative = de-escalating, positive = escalating.
 * Branch bearings are derived from the supplied front-line heading (or a
 * deterministic per-entity bearing fallback): stalemate keeps the heading,
 * escalation forks ±60° (new fronts), de-escalation backs along heading + 180°.
 * Returns three branches whose probabilities sum to 1 (within rounding).
 */
export function computeConflictBranches(
  entityId: string,
  lat: number,
  lon: number,
  emaTrend: number,
  opts: ConflictBranchOptions = {},
): BranchingForecast {
  const escalateP = Math.max(0.05, Math.min(0.8, 0.3 + emaTrend * 0.4));
  const deescalateP = Math.max(0.05, Math.min(0.8, 0.3 - emaTrend * 0.4));
  const stalemateP = Math.max(0.05, 1 - escalateP - deescalateP);

  const headingRad = opts.headingDeg === undefined
    ? deterministicBearing(entityId)
    : opts.headingDeg * DEG_TO_RAD;
  const speedKmDay = Math.max(0.5, Math.min(25, opts.speedKmPerDay ?? 5));
  // Rough km → degree conversion at the entity's latitude.
  const kmPerDeg = 111;
  const lonScale = Math.max(0.1, Math.cos(lat * DEG_TO_RAD));

  const makePath = (bearingRad: number, speedFactor: number): ForecastPoint[] => {
    const points: ForecastPoint[] = [];
    const stepDeg = (speedKmDay * speedFactor) / kmPerDeg;
    for (let i = 0; i <= 7; i++) {
      const confidence = Math.max(0.1, 1 - i / 7);
      points.push({
        lat: lat + Math.cos(bearingRad) * stepDeg * i,
        lon: lon + (Math.sin(bearingRad) * stepDeg * i) / lonScale,
        timeMs: Date.now() + i * DAY_MS,
        confidence,
      });
    }
    return points;
  };

  return {
    entityId,
    type: 'conflict',
    branches: [
      {
        label: 'De-escalation',
        probability: deescalateP,
        outcome: 'deescalation',
        path: makePath(headingRad + Math.PI, 0.5),
        conditions: 'Ceasefire negotiations progress, external pressure increases',
      },
      {
        label: 'Stalemate',
        probability: stalemateP,
        outcome: 'stalemate',
        path: makePath(headingRad, 0.3),
        conditions: 'Current tempo maintained, no significant territorial changes',
      },
      {
        label: 'Escalation',
        probability: escalateP,
        outcome: 'escalation',
        path: makePath(headingRad + (Math.PI / 3), 1),
        conditions: 'New fronts open, external actors intervene, weapons escalation',
      },
    ],
  };
}

/**
 * NHC-style cone of uncertainty for a tropical cyclone. Track-relative
 * cross-track and along-track positional errors grow as σ = a · t^b with
 * a_ct≈35 km, a_at≈55 km, b≈0.6 (t in days; matches NHC 24-h increment
 * statistics). The cone polygon is built from the cross-track 1-σ envelope
 * around 5 forecast hops at +24 h, +48 h, +72 h, +96 h, +120 h.
 *
 * `track` is the entity's historical positions (chronologically oldest →
 * newest, latest is current). At least two points are required to derive
 * a heading and translation speed; with only one point a deterministic
 * fallback heading from the entity id is used and translation speed
 * defaults to 12 kt (~22 km/h).
 */
const CYCLONE_SIGMA_CT_A = 35;
const CYCLONE_SIGMA_AT_A = 55;
const CYCLONE_SIGMA_B = 0.6;
const CYCLONE_FORECAST_DAYS = [1, 2, 3, 4, 5];
const CYCLONE_DEFAULT_SPEED_KMH = 22;

export function computeCycloneCone(
  entityId: string,
  track: TrackPoint[],
): ForecastCone | null {
  const tail = track[track.length - 1];
  if (!tail) return null;

  const { lat: lat0, lon: lon0, timeMs: t0 } = tail;
  const heading = deriveHeading(track, entityId);
  const speedKmh = deriveSpeed(track) ?? CYCLONE_DEFAULT_SPEED_KMH;

  const probablePath: ForecastPoint[] = [
    { lat: lat0, lon: lon0, timeMs: t0, confidence: 1 },
  ];
  const rightEnvelope: { lat: number; lon: number }[] = [];
  const leftEnvelope: { lat: number; lon: number }[] = [];

  const lonScale = Math.max(0.1, Math.cos(lat0 * DEG_TO_RAD));

  for (const days of CYCLONE_FORECAST_DAYS) {
    const distKm = speedKmh * 24 * days;
    const dLat = (distKm / EARTH_RADIUS_KM) * Math.cos(heading) * (180 / Math.PI);
    const dLon = (distKm / EARTH_RADIUS_KM) * Math.sin(heading) * (180 / Math.PI) / lonScale;
    const fLat = lat0 + dLat;
    const fLon = lon0 + dLon;
    const sigmaCt = CYCLONE_SIGMA_CT_A * Math.pow(days, CYCLONE_SIGMA_B);
    const sigmaAt = CYCLONE_SIGMA_AT_A * Math.pow(days, CYCLONE_SIGMA_B);

    probablePath.push({
      lat: fLat,
      lon: fLon,
      timeMs: t0 + days * DAY_MS,
      confidence: Math.max(0.1, 1 - days / 6),
    });

    const perpRight = heading + Math.PI / 2;
    rightEnvelope.push({
      lat: fLat + (sigmaCt / EARTH_RADIUS_KM) * Math.cos(perpRight) * (180 / Math.PI),
      lon: fLon + (sigmaCt / EARTH_RADIUS_KM) * Math.sin(perpRight) * (180 / Math.PI) / lonScale,
    });
    const perpLeft = heading - Math.PI / 2;
    leftEnvelope.push({
      lat: fLat + (sigmaCt / EARTH_RADIUS_KM) * Math.cos(perpLeft) * (180 / Math.PI),
      lon: fLon + (sigmaCt / EARTH_RADIUS_KM) * Math.sin(perpLeft) * (180 / Math.PI) / lonScale,
    });

    // Tail-extension along-track at the outermost point (Day 5) to produce
    // an endcap, scaled by sigmaAt so the cone bulges outward at the tip.
    if (days === CYCLONE_FORECAST_DAYS[CYCLONE_FORECAST_DAYS.length - 1]) {
      rightEnvelope.push({
        lat: fLat + (sigmaAt / EARTH_RADIUS_KM) * Math.cos(heading) * (180 / Math.PI),
        lon: fLon + (sigmaAt / EARTH_RADIUS_KM) * Math.sin(heading) * (180 / Math.PI) / lonScale,
      });
    }
  }

  const reversedLeft: { lat: number; lon: number }[] = [];
  for (let i = leftEnvelope.length - 1; i >= 0; i--) {
    const v = leftEnvelope[i];
    if (v) reversedLeft.push(v);
  }
  const conePolygon: { lat: number; lon: number }[] = [
    { lat: lat0, lon: lon0 },
    ...rightEnvelope,
    ...reversedLeft,
  ];

  return { entityId, type: 'cyclone', probablePath, conePolygon };
}

/**
 * Heading from the most recent two track points (great-circle initial bearing).
 * Falls back to a deterministic-by-id bearing if there's only one sample.
 */
function deriveHeading(track: TrackPoint[], entityId: string): number {
  if (track.length < 2) return deterministicBearing(entityId);
  const a = track[track.length - 2];
  const b = track[track.length - 1];
  if (!a || !b) return deterministicBearing(entityId);
  const φ1 = a.lat * DEG_TO_RAD;
  const φ2 = b.lat * DEG_TO_RAD;
  const Δλ = (b.lon - a.lon) * DEG_TO_RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return Math.atan2(y, x);
}

/**
 * Translation speed (km/h) from the most recent two samples. Returns null
 * when the samples are coincident in time so callers can fall back to a
 * climatological default.
 */
function deriveSpeed(track: TrackPoint[]): number | null {
  if (track.length < 2) return null;
  const a = track[track.length - 2];
  const b = track[track.length - 1];
  if (!a || !b) return null;
  const dtH = (b.timeMs - a.timeMs) / HOUR_MS;
  if (!Number.isFinite(dtH) || dtH <= 0) return null;
  const distKm = haversineKm(a.lat, a.lon, b.lat, b.lon);
  return distKm / dtH;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dφ = (lat2 - lat1) * DEG_TO_RAD;
  const dλ = (lon2 - lon1) * DEG_TO_RAD;
  const a = Math.sin(dφ / 2) ** 2
    + Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Extrapolate a flight along its current heading using a great-circle
 * approximation. Returns 9 forecast points (every 15 min for 2 h) plus a
 * cone polygon that widens linearly with time.
 */
export function computeFlightCone(
  entityId: string,
  lat: number,
  lon: number,
  headingDeg: number,
  speedKnots: number,
): ForecastCone {
  const headingRad = (headingDeg * Math.PI) / 180;
  const speedKmH = speedKnots * 1.852;
  const points: ForecastPoint[] = [];

  for (let hours = 0; hours <= 2; hours += 0.25) {
    const distKm = speedKmH * hours;
    const dLat = (distKm / EARTH_RADIUS_KM) * Math.cos(headingRad) * (180 / Math.PI);
    const dLon = (distKm / EARTH_RADIUS_KM) * Math.sin(headingRad) * (180 / Math.PI) / Math.cos((lat * Math.PI) / 180);
    const confidence = Math.max(0.1, 1 - hours / 2);
    points.push({
      lat: lat + dLat,
      lon: lon + dLon,
      timeMs: Date.now() + hours * HOUR_MS,
      confidence,
    });
  }

  const spreadRate = 0.002; // ° per hour, lateral
  const conePolygon: { lat: number; lon: number }[] = [];
  for (const p of points) {
    const hours = (p.timeMs - Date.now()) / HOUR_MS;
    const spread = spreadRate * hours;
    const perpRad = headingRad + Math.PI / 2;
    conePolygon.push({
      lat: p.lat + Math.cos(perpRad) * spread,
      lon: p.lon + Math.sin(perpRad) * spread,
    });
  }
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (!p) continue;
    const hours = (p.timeMs - Date.now()) / HOUR_MS;
    const spread = spreadRate * hours;
    const perpRad = headingRad - Math.PI / 2;
    conePolygon.push({
      lat: p.lat + Math.cos(perpRad) * spread,
      lon: p.lon + Math.sin(perpRad) * spread,
    });
  }

  return { entityId, type: 'flight', probablePath: points, conePolygon };
}
