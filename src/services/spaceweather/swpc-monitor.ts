/**
 * Space Weather Monitor (pure-deterministic).
 *
 * Classifies NOAA SWPC + NASA DONKI feed snapshots into derived state:
 *   - X-ray flare class A/B/C/M/X from peak flux (W/m²)
 *   - Geomagnetic storm level G0–G5 from planetary Kp
 *   - Aurora visibility latitude from Kp (60°N at Kp5 → 45°N at Kp9)
 *   - GPS disruption risk (high / moderate / low / none)
 *   - HF radio blackout flag (X-ray peak ≥ 1e-4 W/m²)
 *   - Earthward CME filter (heliographic longitude ≤ 30° from disk center)
 *
 * Inputs are caller-provided typed bags from sidecar fetches. No DOM, no
 * fetch, no globals — deterministic for fixture-based tests.
 */

// space-weather-parse is import-free, so pulling the shared alert helpers in
// keeps this module fixture-testable while removing a third copy of the SWPC
// message-shape logic. The sidecar's JS twin is duplicated by necessity and is
// held in lockstep by __tests__/spaceweather-parity.test.mjs.
import { classifyAlert, toUtcIsoTag, FUTURE_SKEW_TOLERANCE_MS } from '../space-weather-parse';

export type XrayClass = 'A' | 'B' | 'C' | 'M' | 'X';

export type GeomagStormLevel = 'G0' | 'G1' | 'G2' | 'G3' | 'G4' | 'G5';

export type RiskBand = 'none' | 'low' | 'moderate' | 'high';

export type SwpcAlertSeverity = 'summary' | 'watch' | 'warning' | 'alert';

// ── Raw inputs from SWPC / DONKI ────────────────────────────────────────────

/** A point from the GOES X-ray flux feed (`xrays-6-hour.json`). */
export interface XrayFluxPoint {
  /** ISO timestamp. */
  time_tag: string;
  /** Watts per square metre, integrated 1–8 Å channel. */
  flux: number;
  /** GOES energy band, typically `'0.1-0.8nm'`. */
  energy?: string;
  /** Optional satellite tag — left unused but preserved for callers. */
  satellite?: number | string;
}

/** A row from the SWPC planetary-K-index product. */
export interface KpIndexPoint {
  time_tag: string;
  kp: number;
}

/** A row from the SWPC alerts product. */
export interface SwpcAlertRaw {
  product_id?: string;
  message: string;
  /** ISO timestamp; SWPC uses naïve UTC strings — caller pre-normalizes. */
  issue_datetime: string;
}

/** A subset of NASA DONKI CME analysis fields used to classify earth-directed events. */
export interface DonkiCmeRaw {
  activityID?: string;
  startTime?: string | null;
  cmeAnalyses?: {
    /** Heliographic latitude of CME source, degrees. */
    latitude?: number | null;
    /** Heliographic longitude, degrees. Earth lies near 0°. */
    longitude?: number | null;
    /** Half-angle of cone, degrees. */
    halfAngle?: number | null;
    /** Speed in km/s. */
    speed?: number | null;
    /** ISO timestamp the CME crosses 21.5 Rsun shock front. */
    time21_5?: string | null;
    isMostAccurate?: boolean;
    note?: string | null;
  }[] | null;
  link?: string | null;
}

// ── Derived shapes ─────────────────────────────────────────────────────────

export interface XrayFluxState {
  /** Peak observed flux in window, W/m². */
  peakFlux: number;
  /** Most recent observation flux, W/m². */
  currentFlux: number;
  /** Flare class label of `peakFlux`. */
  peakClass: XrayClass;
  /** Numeric label, e.g. peak `4.2e-5` → `'M4.2'`. */
  peakLabel: string;
  /** ISO timestamp of `peakFlux`. */
  peakAt: string;
  /** Did peak cross the X-class threshold (≥1e-4)? */
  xClassActive: boolean;
  /** Sample count used. */
  sampleCount: number;
}

export interface GeomagState {
  kp: number;
  level: GeomagStormLevel;
  /** Lowest geomagnetic latitude (°N) at which aurora is visible overhead.
   * 90 = invisible. */
  auroraVisibilityLatN: number;
  observedAt: string;
  /** Recent rolling max within the window (e.g. last 24h). */
  kpMax24h: number;
}

export interface EarthwardCme {
  id: string;
  startTime: string | null;
  speedKmS: number | null;
  /** ISO timestamp; null when DONKI analysis lacks an arrival. */
  estimatedArrival: string | null;
  longitudeDeg: number | null;
  latitudeDeg: number | null;
  halfAngleDeg: number | null;
  isMostAccurate: boolean;
  link: string | null;
}

export interface SpaceWxAlert {
  id: string;
  severity: SwpcAlertSeverity;
  /** First non-empty line of the SWPC message. */
  headline: string;
  issuedAt: string;
}

export interface SpaceWxStatus {
  xray: XrayFluxState | null;
  geomag: GeomagState | null;
  /** "high" if X-class flare active, "moderate" for M, "low" for C, else "none". */
  gpsDisruption: RiskBand;
  /** True iff peak X-ray flux ≥ 1e-4 W/m² in the window. */
  hfRadioBlackout: boolean;
  earthwardCmes: EarthwardCme[];
  /**
   * False when the CME feed did not answer. An empty `earthwardCmes` is
   * otherwise ambiguous: "DONKI reports nothing Earthward" and "DONKI never
   * replied" render identically, and the reassuring reading is the one the
   * outage produces.
   *
   * Optional because older cached envelopes and the parity-only `buildStatus`
   * do not set it — but absent is NOT healthy. Only an explicit `true` is
   * evidence the feed answered; consumers must render anything else as
   * unknown, or a cache written before this flag existed silently restores the
   * fail-open for as long as it lives.
   */
  cmeFeedOk?: boolean;
  asOf: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const XRAY_THRESHOLDS: { cls: XrayClass; min: number }[] = [
  { cls: 'X', min: 1e-4 },
  { cls: 'M', min: 1e-5 },
  { cls: 'C', min: 1e-6 },
  { cls: 'B', min: 1e-7 },
  { cls: 'A', min: 0 },
];

const KP_TO_LEVEL: { kp: number; level: GeomagStormLevel }[] = [
  { kp: 9, level: 'G5' },
  { kp: 8, level: 'G4' },
  { kp: 7, level: 'G3' },
  { kp: 6, level: 'G2' },
  { kp: 5, level: 'G1' },
];

/** Spec-mandated aurora visibility anchors. Kp values between are linearly
 * interpolated; below Kp5, aurora is not realistically visible from
 * mid-latitudes so we report 90° as a sentinel. */
const AURORA_ANCHORS: { kp: number; latN: number }[] = [
  { kp: 5, latN: 60 },
  { kp: 6, latN: 57.5 },
  { kp: 7, latN: 55 },
  { kp: 8, latN: 50 },
  { kp: 9, latN: 45 },
];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// ── Helpers ────────────────────────────────────────────────────────────────

export function classifyXrayFlux(fluxWPerM2: number): XrayClass {
  if (!Number.isFinite(fluxWPerM2) || fluxWPerM2 <= 0) return 'A';
  for (const tier of XRAY_THRESHOLDS) {
    if (fluxWPerM2 >= tier.min) return tier.cls;
  }
  return 'A';
}

export function xrayLabel(fluxWPerM2: number): string {
  const cls = classifyXrayFlux(fluxWPerM2);
  if (cls === 'A') {
    // A-class displays as the integer mantissa of flux × 1e8 (e.g. 5e-8 → A5).
    const m = Math.max(1, Math.round(fluxWPerM2 / 1e-8));
    return `A${Math.min(9, m)}`;
  }
  const baseByCls: Record<Exclude<XrayClass, 'A'>, number> = {
    B: 1e-7,
    C: 1e-6,
    M: 1e-5,
    X: 1e-4,
  };
  const base = baseByCls[cls];
  const mantissa = fluxWPerM2 / base;
  // X-class mantissa can exceed 9 (e.g. X28); clamp at 99 for label width.
  const clamped = Math.min(99, mantissa);
  return `${cls}${clamped.toFixed(1)}`;
}

export function kpToStormLevel(kp: number): GeomagStormLevel {
  if (!Number.isFinite(kp) || kp < 5) return 'G0';
  for (const tier of KP_TO_LEVEL) {
    if (kp >= tier.kp) return tier.level;
  }
  return 'G0';
}

export function auroraVisibilityLatitude(kp: number): number {
  if (!Number.isFinite(kp) || kp < 5) return 90;
  if (kp >= 9) return 45;
  // Linear interpolate between anchor pairs.
  for (let i = 0; i < AURORA_ANCHORS.length - 1; i += 1) {
    const a = AURORA_ANCHORS[i];
    const b = AURORA_ANCHORS[i + 1];
    if (a && b && kp >= a.kp && kp <= b.kp) {
      const t = (kp - a.kp) / (b.kp - a.kp);
      return roundTo(a.latN + (b.latN - a.latN) * t, 0.5);
    }
  }
  return 90;
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function classifyGpsDisruption(xrayPeakClass: XrayClass | null): RiskBand {
  if (xrayPeakClass === 'X') return 'high';
  if (xrayPeakClass === 'M') return 'moderate';
  if (xrayPeakClass === 'C') return 'low';
  return 'none';
}

// ── Core computation ───────────────────────────────────────────────────────

export interface MonitorInput {
  xrayFlux: XrayFluxPoint[];
  kpIndex: KpIndexPoint[];
  alerts: SwpcAlertRaw[];
  cmes: DonkiCmeRaw[];
  /** Now-ish, ms since epoch. Defaults to Date.now() at call time. */
  now?: number;
  /** Window for "currently active" classification. Defaults to 6h. */
  xrayWindowMs?: number;
  /** Window for `kpMax24h` — defaults to 24h. */
  kpWindowMs?: number;
  /** Earthward longitude tolerance in degrees from disk center (0°).
   * Default 30° follows the SWPC convention for earth-directed CMEs. */
  earthwardLongitudeDeg?: number;
}

function summarizeXray(
  points: XrayFluxPoint[],
  now: number,
  windowMs: number,
): XrayFluxState | null {
  const cutoff = now - windowMs;
  let peak = -Infinity;
  let peakAt = '';
  let current = -Infinity;
  let currentAt = -Infinity;
  let count = 0;
  for (const p of points) {
    if (!Number.isFinite(p.flux)) continue;
    const t = Date.parse(p.time_tag);
    if (!Number.isFinite(t) || t < cutoff || t > now) continue;
    count += 1;
    if (p.flux > peak) {
      peak = p.flux;
      peakAt = p.time_tag;
    }
    if (t > currentAt) {
      currentAt = t;
      current = p.flux;
    }
  }
  if (count === 0 || !Number.isFinite(peak)) return null;
  const peakClass = classifyXrayFlux(peak);
  return {
    peakFlux: peak,
    currentFlux: Number.isFinite(current) ? current : peak,
    peakClass,
    peakLabel: xrayLabel(peak),
    peakAt,
    xClassActive: peakClass === 'X',
    sampleCount: count,
  };
}

function summarizeKp(
  points: KpIndexPoint[],
  now: number,
  windowMs: number,
): GeomagState | null {
  const cutoff = now - windowMs;
  let latest: KpIndexPoint | null = null;
  let latestT = -Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.kp)) continue;
    const t = Date.parse(p.time_tag);
    if (!Number.isFinite(t) || t < cutoff || t > now) continue;
    if (t > latestT) {
      latestT = t;
      latest = p;
    }
    if (p.kp > max) max = p.kp;
  }
  if (!latest) return null;
  const kp = latest.kp;
  const level = kpToStormLevel(kp);
  return {
    kp,
    level,
    auroraVisibilityLatN: auroraVisibilityLatitude(kp),
    observedAt: latest.time_tag,
    kpMax24h: Number.isFinite(max) ? max : kp,
  };
}

export function summarizeAlerts(
  raw: SwpcAlertRaw[],
  now: number,
  windowMs: number = DAY_MS,
): SpaceWxAlert[] {
  const cutoff = now - windowMs;
  // Same tolerance as parseAlerts, imported rather than repeated: this path and
  // that one feed the same panel, so an alert must not exist in one and not the
  // other.
  const horizon = now + FUTURE_SKEW_TOLERANCE_MS;
  const out: SpaceWxAlert[] = [];
  for (const r of raw) {
    if (!r?.message) continue;
    // issue_datetime is space-separated naïve UTC ("2026-07-30 19:03:19.350").
    // Un-stamped, Date.parse reads it as host-LOCAL, which on a UTC-4 host puts
    // every alert from the last 4 hours past `now` — and the guard below then
    // drops exactly the alerts that matter most.
    const issuedAt = toUtcIsoTag(r.issue_datetime);
    const t = Date.parse(issuedAt);
    if (!Number.isFinite(t) || t < cutoff || t > horizon) continue;
    // The headline is the severity line, NOT line 0: every SWPC message opens
    // with "Space Weather Message Code: XXXXX".
    const { headline, severity } = classifyAlert(r.message);
    if (headline.length === 0) continue;
    out.push({
      id: `${r.product_id ?? 'swpc'}-${r.issue_datetime}`,
      severity,
      headline,
      issuedAt,
    });
  }
  out.sort((a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt));
  return out;
}

type CmeAnalysis = NonNullable<DonkiCmeRaw['cmeAnalyses']>[number];

function pickPrimaryAnalysis(analyses: CmeAnalysis[]): CmeAnalysis | null {
  return analyses.find((a) => a?.isMostAccurate) ?? analyses[analyses.length - 1] ?? null;
}

function toEarthwardCme(
  cme: DonkiCmeRaw,
  analysis: CmeAnalysis,
  fallbackId: string,
): EarthwardCme {
  return {
    id: cme.activityID ?? fallbackId,
    startTime: cme.startTime ?? null,
    speedKmS: typeof analysis.speed === 'number' ? analysis.speed : null,
    estimatedArrival: analysis.time21_5 ?? null,
    longitudeDeg: typeof analysis.longitude === 'number' ? analysis.longitude : null,
    latitudeDeg: typeof analysis.latitude === 'number' ? analysis.latitude : null,
    halfAngleDeg: typeof analysis.halfAngle === 'number' ? analysis.halfAngle : null,
    isMostAccurate: analysis.isMostAccurate === true,
    link: cme.link ?? null,
  };
}

function isEarthwardAnalysis(analysis: CmeAnalysis, now: number, lonTolDeg: number): boolean {
  const lon = typeof analysis.longitude === 'number' ? analysis.longitude : null;
  if (lon === null || Math.abs(lon) > lonTolDeg) return false;
  const arrivalT = analysis.time21_5 ? Date.parse(analysis.time21_5) : Number.NaN;
  if (Number.isFinite(arrivalT) && arrivalT < now - 12 * HOUR_MS) return false;
  return true;
}

export function filterEarthwardCmes(
  raw: DonkiCmeRaw[],
  now: number,
  earthwardLongitudeDeg = 30,
): EarthwardCme[] {
  const out: EarthwardCme[] = [];
  for (const cme of raw) {
    if (!Array.isArray(cme.cmeAnalyses) || cme.cmeAnalyses.length === 0) continue;
    const analysis = pickPrimaryAnalysis(cme.cmeAnalyses);
    if (!analysis) continue;
    if (!isEarthwardAnalysis(analysis, now, earthwardLongitudeDeg)) continue;
    out.push(toEarthwardCme(cme, analysis, `cme-${out.length}`));
  }
  out.sort((a, b) => {
    const ta = a.estimatedArrival ? Date.parse(a.estimatedArrival) : Infinity;
    const tb = b.estimatedArrival ? Date.parse(b.estimatedArrival) : Infinity;
    return ta - tb;
  });
  return out;
}

export function buildStatus(input: MonitorInput): SpaceWxStatus {
  const now = input.now ?? Date.now();
  const xrayWindow = input.xrayWindowMs ?? 6 * HOUR_MS;
  const kpWindow = input.kpWindowMs ?? DAY_MS;
  const xray = summarizeXray(input.xrayFlux, now, xrayWindow);
  const geomag = summarizeKp(input.kpIndex, now, kpWindow);
  const earthwardCmes = filterEarthwardCmes(
    input.cmes,
    now,
    input.earthwardLongitudeDeg ?? 30,
  );
  const gpsDisruption = classifyGpsDisruption(xray?.peakClass ?? null);
  const hfRadioBlackout = !!xray && xray.peakFlux >= 1e-4;
  return {
    xray,
    geomag,
    gpsDisruption,
    hfRadioBlackout,
    earthwardCmes,
    asOf: new Date(now).toISOString(),
  };
}
