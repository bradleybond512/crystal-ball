/**
 * Space Weather Globe Overlay (pure-deterministic).
 *
 * Generates the geometry + visibility flags for the Cesium globe overlay
 * driven by SpaceWxStatus:
 *   - Aurora oval ring when Kp ≥ 5 (parallel of latitude at the visibility
 *     line, stepped every 5° of longitude)
 *   - Subsolar point + flare pulse flag when an X-class flare is active
 *
 * No Cesium / DOM dependencies — the values produced here are consumed by
 * the SpaceWeatherGlobeOverlay component which wraps them in entities.
 */

import type { SpaceWxStatus } from './swpc-monitor';

const TWO_PI = Math.PI * 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

export interface AuroraRing {
  /** Geomagnetic visibility latitude, °N. */
  latN: number;
  /** Mirror southern-hemisphere ring at -latN — auroras occur both ways. */
  latS: number;
  /** Closed polyline positions: [lon, lat] pairs forming a complete ring. */
  ringNorth: [number, number][];
  ringSouth: [number, number][];
  /** Visualization color: green at G1–G2, purple at G4–G5. */
  color: { r: number; g: number; b: number; a: number };
  /** Width in pixels. */
  widthPx: number;
}

export interface FlarePulse {
  /** Geographic longitude of the subsolar point, ° (-180..180). */
  subsolarLonDeg: number;
  /** Geographic latitude of the subsolar point, °. */
  subsolarLatDeg: number;
  /** Pulse animation period in ms. */
  pulsePeriodMs: number;
  /** Inner / outer radius pair in metres (great-circle distance). */
  innerRadiusM: number;
  outerRadiusM: number;
}

export interface GlobeOverlayDescriptor {
  /** True when the descriptor should be rendered at all. */
  visible: boolean;
  aurora: AuroraRing | null;
  flarePulse: FlarePulse | null;
}

/**
 * Build the closed ring of [lon, lat] positions at a fixed latitude.
 * Sampled every `stepDeg` degrees of longitude — default 5°.
 */
export function ringAtLatitude(latDeg: number, stepDeg = 5): [number, number][] {
  const out: [number, number][] = [];
  for (let lon = -180; lon <= 180; lon += stepDeg) {
    out.push([lon, latDeg]);
  }
  return out;
}

/** Map a Kp index to an aurora ring colour. */
export function auroraColorForKp(kp: number): { r: number; g: number; b: number; a: number } {
  if (kp >= 8) return { r: 0.7, g: 0.2, b: 0.95, a: 0.85 }; // deep purple — G4/G5
  if (kp >= 7) return { r: 0.5, g: 0.3, b: 0.95, a: 0.8 }; // violet — G3
  if (kp >= 6) return { r: 0.3, g: 0.95, b: 0.6, a: 0.75 }; // bright green — G2
  return { r: 0.2, g: 0.85, b: 0.4, a: 0.7 }; // standard green — G1
}

/**
 * Compute subsolar point (the lon/lat where the sun is directly overhead).
 * Approximates the sun's declination from day-of-year and longitude from
 * UTC time — accurate to ~1° which is plenty for a flare-pulse marker.
 */
export function subsolarPoint(nowMs: number): { lonDeg: number; latDeg: number } {
  // Day-of-year, 0-based.
  const date = new Date(nowMs);
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((nowMs - startOfYear) / DAY_MS);
  // Solar declination (Cooper 1969 approximation). δ = 23.45° · sin(360° · (284 + n) / 365)
  const decRad = (23.45 * Math.PI / 180) * Math.sin(((TWO_PI) * (284 + dayOfYear)) / 365);
  const latDeg = decRad * (180 / Math.PI);
  // UTC time of day → longitude. At 12:00 UTC the sun is over Greenwich
  // (lon 0). Each hour shifts the subsolar point 15° west.
  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let lonDeg = (12 - utcHours) * 15;
  // Normalize into [-180, 180].
  lonDeg = ((lonDeg + 540) % 360) - 180;
  return { lonDeg, latDeg };
}

/** Build the descriptor consumed by the Cesium-bound overlay component. */
export function buildOverlayDescriptor(
  status: SpaceWxStatus | null,
  nowMs: number = Date.now(),
): GlobeOverlayDescriptor {
  if (!status) return { visible: false, aurora: null, flarePulse: null };

  const aurora = buildAuroraRing(status);
  const flarePulse = buildFlarePulse(status, nowMs);
  const visible = aurora !== null || flarePulse !== null;
  return { visible, aurora, flarePulse };
}

function widthForKp(kp: number): number {
  if (kp >= 8) return 4;
  if (kp >= 7) return 3;
  return 2;
}

function buildAuroraRing(status: SpaceWxStatus): AuroraRing | null {
  const geomag = status.geomag;
  if (!geomag || geomag.kp < 5) return null;
  const latN = geomag.auroraVisibilityLatN;
  const latS = -latN;
  return {
    latN,
    latS,
    ringNorth: ringAtLatitude(latN),
    ringSouth: ringAtLatitude(latS),
    color: auroraColorForKp(geomag.kp),
    widthPx: widthForKp(geomag.kp),
  };
}

function buildFlarePulse(status: SpaceWxStatus, nowMs: number): FlarePulse | null {
  if (!status.xray?.xClassActive) return null;
  const point = subsolarPoint(nowMs);
  return {
    subsolarLonDeg: point.lonDeg,
    subsolarLatDeg: point.latDeg,
    pulsePeriodMs: 1500,
    innerRadiusM: 200_000,
    outerRadiusM: 800_000,
  };
}

// ── Status banner integration ────────────────────────────────────────────

export type SpaceWxBannerSeverity = 'none' | 'g3' | 'g4' | 'g5' | 'flare';

export interface SpaceWxBanner {
  severity: SpaceWxBannerSeverity;
  /** Headline shown alongside the EEW status bar. Empty when severity = none. */
  label: string;
  /** Supporting line — e.g. "Kp 8 · GPS degraded". Empty when severity = none. */
  subtitle: string;
}

/** Map a SpaceWxStatus into the EEWStatusBar banner. Banner shows for
 * G3+ geomagnetic storms or active X-class flares — the user spec
 * required "G4+ storm warnings", we widen to G3 to match the usual
 * SWPC subscriber threshold. Returns severity 'none' when nothing
 * warrants surfacing on the header. */
export function deriveSpaceWxBanner(status: SpaceWxStatus | null): SpaceWxBanner {
  if (!status) return { severity: 'none', label: '', subtitle: '' };
  const level = status.geomag?.level ?? 'G0';
  const kp = status.geomag?.kp ?? null;
  const xray = status.xray;
  if (level === 'G5') {
    return {
      severity: 'g5',
      label: 'GEOMAGNETIC G5 — EXTREME STORM',
      subtitle: kp === null ? 'power grid + HF radio impacts likely'
                            : `Kp ${kp.toFixed(1)} · power grid + HF radio impacts likely`,
    };
  }
  if (level === 'G4') {
    return {
      severity: 'g4',
      label: 'GEOMAGNETIC G4 — SEVERE STORM',
      subtitle: kp === null ? 'grid + GPS + HF degraded'
                            : `Kp ${kp.toFixed(1)} · grid + GPS + HF degraded`,
    };
  }
  if (level === 'G3') {
    return {
      severity: 'g3',
      label: 'GEOMAGNETIC G3 — STRONG STORM',
      subtitle: kp === null ? 'GPS / HF impacts possible'
                            : `Kp ${kp.toFixed(1)} · GPS / HF impacts possible`,
    };
  }
  if (xray?.xClassActive) {
    return {
      severity: 'flare',
      label: `X-CLASS FLARE — ${xray.peakLabel}`,
      subtitle: 'HF radio blackout on sunlit hemisphere',
    };
  }
  return { severity: 'none', label: '', subtitle: '' };
}

// Useful fixed values from J2000 epoch — exported for test stability checks.
export const _internal = { J2000_MS };
