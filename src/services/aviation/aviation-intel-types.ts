/**
 * Aviation intelligence — public types.
 *
 * Five upstream feeds normalized to typed structures the panel + globe
 * can consume without re-parsing. Pure data; no I/O.
 */

export type AviationFeedKind =
  | 'notams'
  | 'sigmets'
  | 'pireps'
  | 'military'
  | 'delays';

export interface AviationFetchEnvelope<T> {
  data: T[];
  fetchedAt: number;
  /** True when the upstream returned an error or auth failure and the
   *  envelope is empty by design. UI should show a degraded indicator,
   *  not an error toast. */
  degraded: boolean;
  reason?: string;
  source: string;
}

// NOTAM (FAA)

export type NotamClassification = 'TFR' | 'FDC' | 'DOM' | 'INTL' | 'OTHER';

export interface AviationNotam {
  id: string;
  notamNumber: string;
  classification: NotamClassification;
  affectedFir: string | null;
  featureName: string | null;
  icaoId: string | null;
  text: string;
  effectiveStart: number | null;
  effectiveEnd: number | null;
  /** Decoded location when the NOTAM contains a center+radius (TFRs do). */
  center?: { lat: number; lon: number; radiusNm: number };
  /** Decoded altitude band in feet AGL when present. */
  altitudeFt?: { min: number | null; max: number | null };
  /** True when the NOTAM text mentions presidential / VIP movement. */
  presidential: boolean;
}

// SIGMET / AIRMET (NWS Aviation Weather Center)

export type SigmetHazard =
  | 'volcanic_ash'
  | 'turbulence'
  | 'icing'
  | 'thunderstorm'
  | 'mountain_obscuration'
  | 'ifr'
  | 'other';

export interface AviationSigmet {
  id: string;
  hazard: SigmetHazard;
  severity: 'light' | 'moderate' | 'severe' | 'extreme';
  /** Parsed from the SIGMET text (e.g. "FL250-450"). */
  altitudeFt?: { min: number; max: number };
  /** Polygon ring (lat, lon pairs) when the upstream provided coords. */
  polygon: { lat: number; lon: number }[];
  text: string;
  validFrom: number;
  validTo: number;
  /** AIRMET vs SIGMET — both share the same shape. */
  isAirmet: boolean;
}

// PIREP (pilot reports)

export type PirepHazard = 'turbulence' | 'icing' | 'wind_shear' | 'other';

export interface AviationPirep {
  id: string;
  hazard: PirepHazard;
  intensity: 'trace' | 'light' | 'moderate' | 'severe' | 'extreme';
  altitudeFt: number | null;
  lat: number | null;
  lon: number | null;
  reportedAt: number;
  aircraftType: string | null;
  rawText: string;
}

// Military aircraft

export interface MilitaryAircraft {
  icao24: string;
  callsign: string | null;
  /** Coarse classification from the callsign prefix or known ICAO24 list. */
  type: 'transport' | 'tanker' | 'recon' | 'fighter' | 'bomber' | 'helo' | 'unknown';
  country: string | null;
  lat: number | null;
  lon: number | null;
  altitudeFt: number | null;
  velocityKts: number | null;
  heading: number | null;
  squawk: string | null;
  lastSeen: number;
  /** True when emergency squawk is set. */
  emergency: boolean;
}

// Airport ground delay programs

export interface AirportGroundDelay {
  airport: string;
  reason: string;
  /** Average delay in minutes; null when not yet computed by upstream. */
  avgDelayMinutes: number | null;
  /** Maximum delay in minutes; null when not provided. */
  maxDelayMinutes: number | null;
  programType: 'ground_stop' | 'ground_delay' | 'arrival_delay' | 'other';
  startedAt: number | null;
  endsAt: number | null;
}

// VAAC volcanic ash advisories — included in the SIGMET feed when active

export interface VolcanicAshAdvisory {
  id: string;
  volcano: string;
  /** Polygon of the active ash cloud. */
  polygon: { lat: number; lon: number }[];
  altitudeFt: { min: number; max: number };
  validFrom: number;
  validTo: number;
  source: 'VAAC' | 'NOAA';
  text: string;
}
