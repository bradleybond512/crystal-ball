/**
 * Smoke & Air program — shared contracts.
 * Spec: docs/superpowers/specs/2026-07-16-smoke-air-program-design.md
 * Pure types; no imports from DOM/fetch modules.
 */

export type AqiCategory =
  | 'good'            // 0–50
  | 'moderate'        // 51–100
  | 'usg'             // 101–150 Unhealthy for Sensitive Groups
  | 'unhealthy'       // 151–200
  | 'very_unhealthy'  // 201–300
  | 'hazardous'       // 301+
  | 'unknown';

export interface AqiSample {
  /** ISO timestamp (Open-Meteo hourly time, local to the place). */
  time: string;
  usAqi: number | null;
  pm25: number | null;
}

export interface SafeWindow {
  startIso: string;
  endIso: string;
  /** Worst AQI inside the window. */
  peakAqi: number;
  /** e.g. "7 AM–9 AM" — renderer-friendly, computed from local hours. */
  label: string;
}

export interface DaySummary {
  dateIso: string;         // YYYY-MM-DD
  maxAqi: number;
  category: AqiCategory;
  /** e.g. "Friday: unhealthy (peak 172)" */
  headline: string;
}

export type CompassDirection = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export interface CompassPoint {
  direction: CompassDirection;
  bearingDeg: number;
  radiusMi: number;
  lat: number;
  lon: number;
}

export interface CompassSample extends CompassPoint {
  /** Mean us_aqi over the next 6 hours at this point; null = no data. */
  avgAqi6h: number | null;
  /** Negative = cleaner than home (improvement). Null when either side missing. */
  deltaPctVsHome: number | null;
  /** Reverse-geocoded locality; optional — renders as bare distance if null. */
  placeName: string | null;
}

export type ActivityId =
  | 'exercise_outdoors'
  | 'kids_outdoors'
  | 'windows_open'
  | 'commute'
  | 'outdoor_work'
  | 'pets_outdoors';

export interface ActivityAdvice {
  activity: ActivityId;
  label: string;
  verdict: 'ok' | 'caution' | 'avoid';
  reason: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  rationale: string;
  /** Relative contribution to the clean-room score. */
  weight: number;
  done: boolean;
}

export interface CleanRoomScore {
  score0to100: number;
  tier: 'unprepared' | 'partial' | 'ready';
}

export interface SmokeSourceStatus {
  id: 'smoke_forecast' | 'airnow' | 'purpleair';
  label: string;
  ok: boolean;
  /** Explanation when not ok — e.g. "AIRNOW_API_KEY not loaded". */
  detail: string | null;
  updatedAt: number | null;
}

export interface HourlyWind {
  /** ISO timestamp (Open-Meteo hourly time, local to the place). */
  time: string;
  speedMph: number | null;
  /** Meteorological convention: degrees the wind blows FROM. */
  directionDeg: number | null;
}

export type SmokeSourceKind = 'plume' | 'fire';

/** An upwind smoke source the arrival estimator can advect toward home —
 *  an HMS plume centroid or a NIFC active-fire centroid. */
export interface SmokeTransportSource {
  id: string;
  kind: SmokeSourceKind;
  /** e.g. "Heavy smoke plume" / "Camp fire". */
  label: string;
  lat: number;
  lon: number;
  /** Plume density or fire-size class — wording + ranking only. */
  intensity: 'light' | 'medium' | 'heavy';
  /** Plume outer rings ([lon, lat]) — enables the overhead test. */
  rings?: [number, number][][];
}

export interface SmokeArrivalEstimate {
  sourceId: string;
  kind: SmokeSourceKind;
  label: string;
  distanceMi: number;
  /** Compass direction from home TOWARD the source (where to look). */
  direction: CompassDirection;
  status: 'overhead' | 'incoming' | 'not_expected';
  etaStartIso: string | null;
  etaEndIso: string | null;
  /** e.g. "9 PM–1 AM" or "tomorrow 9 AM–1 PM" — set when incoming. */
  etaLabel: string | null;
  confidence: 'low' | 'medium' | 'high';
  /** One-line human statement for panel rows / headline reuse. */
  summary: string;
}

export interface SmokeSnapshot {
  placeId: string;
  placeName: string;
  lat: number;
  lon: number;
  current: { usAqi: number | null; pm25: number | null; category: AqiCategory };
  hourly48: AqiSample[];
  safeWindows: SafeWindow[];
  worstWindow: SafeWindow | null;
  days: DaySummary[];
  compass: CompassSample[];
  activities: ActivityAdvice[];
  checklist: ChecklistItem[];
  cleanRoomScore: CleanRoomScore;
  sources: SmokeSourceStatus[];
  /** Wind-advection arrival estimates for upwind plumes/fires (absent on
   *  snapshots built before the estimator ran or when winds are unknown). */
  arrivals?: SmokeArrivalEstimate[];
  generatedAt: number;
}
