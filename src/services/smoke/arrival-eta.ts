/**
 * Smoke arrival ETA — pure wind-advection estimator. Answers the prediction
 * gap the Smoke & Air program left open: "smoke is 140 mi NW — when does it
 * get HERE?"
 *
 * Given upwind smoke sources (HMS plume centroids, NIFC fire centroids), an
 * hourly 10 m wind forecast, and the home coordinate, it integrates
 * hour-by-hour downwind progress to estimate an arrival window. Deliberately
 * first-order: straight-line transport with a cosine alignment penalty — an
 * honest "possible arrival window", not a dispersion model. The fetch layer
 * can upgrade the wind/plume source (e.g. NOAA HRRR-Smoke) without touching
 * this math.
 *
 * Fail-closed honesty: with no usable winds, only geometric 'overhead'
 * detections are emitted — no transport claims are invented.
 * No @/ imports — fixture-tests under tsx like the other pure smoke modules.
 */
import type {
  CompassDirection,
  HourlyWind,
  SmokeArrivalEstimate,
  SmokeTransportSource,
} from './smoke-types';

const EARTH_RADIUS_MI = 3958.8;
const HOUR_MS = 3_600_000;
/** Transport counts only when the wind blows within this many degrees of the
 *  source→home bearing; cos(60°) already halves the effective speed there. */
const ALIGNMENT_TOLERANCE_DEG = 60;
/** Below this the airmass is effectively stalled for transport purposes. */
const MIN_TRANSPORT_MPH = 2;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

export function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial great-circle bearing from → to, degrees clockwise from north. */
export function initialBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const COMPASS_8: CompassDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function toCompassDirection(bearing: number): CompassDirection {
  const idx = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return COMPASS_8[idx]!;
}

function angularDiffDeg(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** Ray-casting point-in-polygon over [lon, lat] rings (outer ring test). */
export function pointInRings(lat: number, lon: number, rings: [number, number][][]): boolean {
  const ring = rings[0];
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function hourLabel(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const ampm = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${ampm}`;
}

/** Place-UTC offset recovered from one wind row (wall-as-UTC − epoch);
 *  null when the row carries no epoch. */
function placeOffsetMs(w: HourlyWind | undefined): number | null {
  if (w?.timeMs === null || w?.timeMs === undefined) return null;
  const wallAsUtc = Date.parse(`${w.time}Z`);
  return Number.isFinite(wallAsUtc) ? wallAsUtc - w.timeMs : null;
}

/** '' today, 'tomorrow ' next day, weekday name beyond that. Day boundaries
 *  are the PLACE's when its UTC offset is known (offsetMs non-null);
 *  otherwise device-local — the legacy fallback. */
function dayQualifier(iso: string, now: number, offsetMs: number | null): string {
  if (offsetMs !== null) {
    const targetDate = iso.slice(0, 10);
    const nowPlaceDate = new Date(now + offsetMs).toISOString().slice(0, 10);
    const dayDiff = Math.round((Date.parse(targetDate) - Date.parse(nowPlaceDate)) / (24 * HOUR_MS));
    if (dayDiff <= 0) return '';
    if (dayDiff === 1) return 'tomorrow ';
    const noon = new Date(`${targetDate}T12:00:00Z`);
    return `${noon.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })} `;
  }
  const target = new Date(iso);
  const today = new Date(now);
  const dayDiff = Math.round(
    (new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / (24 * HOUR_MS),
  );
  if (dayDiff <= 0) return '';
  if (dayDiff === 1) return 'tomorrow ';
  return `${target.toLocaleDateString('en-US', { weekday: 'long' })} `;
}

export interface ArrivalInputs {
  home: { lat: number; lon: number };
  sources: SmokeTransportSource[];
  /** Hourly wind forecast at/near home — the regional-flow approximation. */
  winds: HourlyWind[];
  now: number;
  /** Sources farther than this are ignored entirely. */
  maxDistanceMi?: number;
  horizonHours?: number;
  maxResults?: number;
}

interface Advection {
  arrivalIdx: number | null;
  hoursOut: number;
  alignedFrac: number;
}

function advect(
  distanceMi: number,
  bearingSourceToHome: number,
  winds: HourlyWind[],
  startIdx: number,
  horizonHours: number,
): Advection {
  let progress = 0;
  let aligned = 0;
  let used = 0;
  const end = Math.min(winds.length, startIdx + horizonHours);
  for (let i = startIdx; i < end; i++) {
    const w = winds[i]!;
    used++;
    if (w.speedMph === null || w.directionDeg === null || w.speedMph < MIN_TRANSPORT_MPH) continue;
    const transportDir = (w.directionDeg + 180) % 360;
    const misalign = angularDiffDeg(transportDir, bearingSourceToHome);
    if (misalign > ALIGNMENT_TOLERANCE_DEG) continue;
    aligned++;
    progress += w.speedMph * Math.cos(toRad(misalign));
    if (progress >= distanceMi) {
      return { arrivalIdx: i, hoursOut: used, alignedFrac: aligned / used };
    }
  }
  return { arrivalIdx: null, hoursOut: used, alignedFrac: used > 0 ? aligned / used : 0 };
}

/**
 * Winds are usable only when a sample covers "now" (`windsCurrent`) AND the
 * projection window — the same slice `advect` walks — holds at least one row
 * with both speed and direction. Stale or out-of-horizon rows never license a
 * transport claim.
 */
function hasUsableWinds(
  winds: HourlyWind[],
  startIdx: number,
  windsCurrent: boolean,
  horizonHours: number,
): boolean {
  if (!windsCurrent) return false;
  return winds
    .slice(startIdx, startIdx + horizonHours)
    .some((w) => w.speedMph !== null && w.directionDeg !== null);
}

function confidenceOf(alignedFrac: number, hoursOut: number): SmokeArrivalEstimate['confidence'] {
  if (alignedFrac >= 0.75 && hoursOut <= 18) return 'high';
  if (alignedFrac >= 0.5) return 'medium';
  return 'low';
}

const STATUS_ORDER: Record<SmokeArrivalEstimate['status'], number> = {
  overhead: 0,
  incoming: 1,
  not_expected: 2,
};

/**
 * Estimate arrival windows for every in-range source. Output is sorted
 * overhead → incoming (soonest first) → not-expected (nearest first) and
 * capped at maxResults.
 */
export function estimateArrivals(inputs: ArrivalInputs): SmokeArrivalEstimate[] {
  const {
    home,
    sources,
    winds,
    now,
    maxDistanceMi = 500,
    horizonHours = 48,
    maxResults = 5,
  } = inputs;

  // First wind sample covering "now". Compare true epochs (timeMs) — the
  // wall-time strings are place-local and MUST NOT be parsed against the
  // device clock (a saved place two timezones away would shift every ETA).
  // Rows without an epoch fall back to device parsing, the legacy behavior.
  let startIdx = winds.findIndex((w) => (w.timeMs ?? new Date(w.time).getTime()) >= now - HOUR_MS);
  // No sample covers "now" ⇒ every wind is stale. Fail closed: reprojecting
  // smoke from winds that ended in the past would fabricate arrival ETAs.
  const windsCurrent = startIdx >= 0;
  if (startIdx < 0) startIdx = 0;
  const offsetMs = placeOffsetMs(winds[startIdx]);
  const haveWinds = hasUsableWinds(winds, startIdx, windsCurrent, horizonHours);

  const out: SmokeArrivalEstimate[] = [];
  for (const src of sources) {
    const distanceMi = haversineMi(home.lat, home.lon, src.lat, src.lon);
    if (distanceMi > maxDistanceMi) continue;

    const bearingHomeToSource = initialBearingDeg(home.lat, home.lon, src.lat, src.lon);
    const direction = toCompassDirection(bearingHomeToSource);
    const base = {
      sourceId: src.id,
      kind: src.kind,
      label: src.label,
      distanceMi: Math.round(distanceMi),
      direction,
    };

    if (src.kind === 'plume' && src.rings && pointInRings(home.lat, home.lon, src.rings)) {
      out.push({
        ...base,
        status: 'overhead',
        etaStartIso: null,
        etaEndIso: null,
        etaLabel: null,
        confidence: 'high',
        summary: `${src.label} overhead now (satellite analysis)`,
      });
      continue;
    }

    // No usable winds → no transport claims (fail-closed).
    if (!haveWinds) continue;

    const bearingSourceToHome = initialBearingDeg(src.lat, src.lon, home.lat, home.lon);
    const { arrivalIdx, hoursOut, alignedFrac } = advect(
      distanceMi, bearingSourceToHome, winds, startIdx, horizonHours,
    );

    if (arrivalIdx === null) {
      out.push({
        ...base,
        status: 'not_expected',
        etaStartIso: null,
        etaEndIso: null,
        etaLabel: null,
        confidence: alignedFrac < 0.25 ? 'medium' : 'low',
        summary: `${src.label} ${Math.round(distanceMi)} mi ${direction} — winds not carrying it here in the next ${horizonHours} h`,
      });
    } else {
      const etaStartIso = winds[arrivalIdx]!.time;
      const halfWidthH = Math.max(1, Math.round(hoursOut * 0.3));
      // Same wall-clock arithmetic convention as safe-windows' toWindow():
      // naive-parse + width round-trips through the same runtime, so the
      // label pair always reads as place wall-clock + width.
      const etaEndIso = new Date(new Date(etaStartIso).getTime() + halfWidthH * HOUR_MS).toISOString();
      const etaLabel = `${dayQualifier(etaStartIso, now, offsetMs)}${hourLabel(etaStartIso)}–${hourLabel(etaEndIso)}`;
      out.push({
        ...base,
        status: 'incoming',
        etaStartIso,
        etaEndIso,
        etaLabel,
        confidence: confidenceOf(alignedFrac, hoursOut),
        summary: `${src.label} ${Math.round(distanceMi)} mi ${direction} — winds could bring smoke ${etaLabel}`,
      });
    }
  }

  out.sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    if (a.status === 'incoming' && b.status === 'incoming') {
      return new Date(a.etaStartIso!).getTime() - new Date(b.etaStartIso!).getTime();
    }
    return a.distanceMi - b.distanceMi;
  });
  return out.slice(0, maxResults);
}

/** Earliest actionable statement (overhead or incoming) — headline fodder. */
export function summarizeArrivals(arrivals: SmokeArrivalEstimate[] | undefined): string | null {
  const first = arrivals?.find((a) => a.status === 'overhead' || a.status === 'incoming');
  return first ? first.summary : null;
}
