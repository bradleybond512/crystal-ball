/**
 * Seismic mission bridges (ObservationEvent flavour).
 *
 * Adapters that normalize raw seismic feeds into `ObservationEvent`
 * records via the abstract `MissionBridgeBase` contract in
 * `src/services/intelligence/mission-bridge-core.ts`.
 *
 * Three bridges:
 *   - SeismicMissionBridge  — USGS earthquakes, M5+ only
 *                             (feedId 'usgs-earthquake')
 *   - TsunamiMissionBridge  — PTWC / NWS tsunami alerts
 *                             (feedId 'tsunami-alert')
 *   - AfterShockMissionBridge — ShakeAlert EEW intensities
 *                             (feedId 'shakealert-eew')
 *
 * Separate file from the legacy `./seismic-bridges.ts` (which targets
 * the older `NormalizedFeedEvent` core and stays the source of truth
 * for that contract). Both designs coexist — pick by import path.
 *
 * Pure normalize() logic. Fetchers are injected so tests can pin
 * behavior without DOM/network.
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';
import {
  MissionBridgeBase,
  type MissionBridgeConfig,
  type MissionBridgeOptions,
} from '../mission-bridge-core';

// ── Shared severity scale ────────────────────────────────────────────────

/** 1 = LOW, 2 = MEDIUM, 3 = HIGH, 4 = CRITICAL. */
export type SeismicSeverityRank = 1 | 2 | 3 | 4;

export function rankToSeverity(rank: SeismicSeverityRank): ObservationSeverity {
  switch (rank) {
    case 4: { return 'CRITICAL'; }
    case 3: { return 'HIGH'; }
    case 2: { return 'MEDIUM'; }
    case 1: { return 'LOW'; }
  }
}

// ── Pure helpers (exported for tests) ────────────────────────────────────

/**
 * USGS earthquake rank ladder.
 *   M ≥ 7    → 4 (CRITICAL)
 *   M ≥ 6    → 3 (HIGH)
 *   M ≥ 5    → 2 (MEDIUM)
 *   else     → 1 (LOW)
 */
export function magnitudeRank(magnitude: number): SeismicSeverityRank {
  if (!Number.isFinite(magnitude)) return 1;
  if (magnitude >= 7) return 4;
  if (magnitude >= 6) return 3;
  if (magnitude >= 5) return 2;
  return 1;
}

/**
 * PTWC/NWS tsunami-alert rank ladder. Inputs are matched case-insensitively
 * and tolerant of leading/trailing whitespace.
 *   warning → 4 (CRITICAL)
 *   watch   → 3 (HIGH)
 *   advisory → 2 (MEDIUM)
 *   information → 1 (LOW)
 *   other / empty → 1 (LOW, defensive)
 */
export function tsunamiLevelRank(level: string | null | undefined): SeismicSeverityRank {
  if (typeof level !== 'string') return 1;
  const normalised = level.trim().toLowerCase();
  if (normalised === 'warning') return 4;
  if (normalised === 'watch') return 3;
  if (normalised === 'advisory') return 2;
  if (normalised === 'information') return 1;
  return 1;
}

/**
 * ShakeAlert Modified-Mercalli intensity rank.
 *   MMI VII+   → 4 (CRITICAL)
 *   MMI V–VI   → 3 (HIGH)
 *   MMI III–IV → 2 (MEDIUM)
 *   else       → 1 (LOW)
 *
 * Accepts Roman-numeral strings ('III', 'IX') OR plain integers (3, 9).
 */
export function mmiRank(mmi: number | string | null | undefined): SeismicSeverityRank {
  const value = mmiToInteger(mmi);
  if (value === null) return 1;
  if (value >= 7) return 4;
  if (value >= 5) return 3;
  if (value >= 3) return 2;
  return 1;
}

const ROMAN_MMI: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
  XI: 11, XII: 12,
};

export function mmiToInteger(mmi: number | string | null | undefined): number | null {
  if (typeof mmi === 'number') {
    return Number.isFinite(mmi) ? Math.floor(mmi) : null;
  }
  if (typeof mmi !== 'string') return null;
  const trimmed = mmi.trim().toUpperCase();
  if (trimmed.length === 0) return null;
  if (ROMAN_MMI[trimmed] !== undefined) return ROMAN_MMI[trimmed];
  // Allow numeric-string fallback like "5" or "7.2".
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

// ── Raw payload shapes ───────────────────────────────────────────────────

export interface RawUsgsQuake {
  id: string;
  magnitude: number;
  place: string;
  /** Unix epoch ms. */
  timestamp: number;
  lat: number;
  lon: number;
  /** Optional depth in km. */
  depthKm?: number;
}

/** Official PTWC/NTWC level strings. Stored as plain `string` on the
 *  raw payload so unknown / future values flow through normalize and
 *  fall back to LOW; see `tsunamiLevelRank`. */
export type TsunamiLevel = 'Warning' | 'Watch' | 'Advisory' | 'Information';

export interface RawTsunamiAlert {
  id: string;
  /** Stored as plain `string` so unknown levels flow through and fall
   *  back to LOW via `tsunamiLevelRank`. Construct against `TsunamiLevel`
   *  for the canonical PTWC/NTWC vocabulary. */
  level: string;
  /** Human-readable headline / region name. */
  region: string;
  /** Unix epoch ms when the alert was issued. */
  issuedAt: number;
  lat?: number;
  lon?: number;
  /** Optional reference earthquake / source-event id. */
  sourceEventId?: string;
}

export interface RawShakeAlertEEW {
  id: string;
  /** Predicted peak MMI as a Roman-numeral string or integer. */
  mmi: number | string;
  /** Unix epoch ms when the alert was issued. */
  issuedAt: number;
  /** Estimated magnitude of the trigger event. */
  magnitude?: number;
  lat: number;
  lon: number;
  /** Seconds of warning before S-wave arrival at the user's location. */
  warningSeconds?: number;
}

// ── Bridge configs ───────────────────────────────────────────────────────

const SEISMIC_DEFAULT_CONFIG: MissionBridgeConfig = {
  domain: 'seismic',
  feedId: 'usgs-earthquake',
  refreshIntervalMs: 60_000,
  maxObservationsPerCycle: 100,
  enabled: true,
};

const TSUNAMI_DEFAULT_CONFIG: MissionBridgeConfig = {
  domain: 'seismic',
  feedId: 'tsunami-alert',
  refreshIntervalMs: 120_000,
  maxObservationsPerCycle: 50,
  enabled: true,
};

const SHAKEALERT_DEFAULT_CONFIG: MissionBridgeConfig = {
  domain: 'seismic',
  feedId: 'shakealert-eew',
  refreshIntervalMs: 5000,
  maxObservationsPerCycle: 50,
  enabled: true,
};

// ── Bridge options ───────────────────────────────────────────────────────

export interface SeismicMissionBridgeOptions extends MissionBridgeOptions {
  fetcher?: () => Promise<RawUsgsQuake[]>;
  config?: Partial<MissionBridgeConfig>;
}

export interface TsunamiMissionBridgeOptions extends MissionBridgeOptions {
  fetcher?: () => Promise<RawTsunamiAlert[]>;
  config?: Partial<MissionBridgeConfig>;
}

export interface AfterShockMissionBridgeOptions extends MissionBridgeOptions {
  fetcher?: () => Promise<RawShakeAlertEEW[]>;
  config?: Partial<MissionBridgeConfig>;
}

function emptyFetcher<T>(): Promise<T[]> {
  return Promise.resolve([]);
}

// ── SeismicMissionBridge — USGS earthquakes ──────────────────────────────

/**
 * USGS earthquake bridge. Filters to M5+ events; sub-M5 events are
 * dropped (normalize returns null) so the truth-score pipeline isn't
 * spammed with micro events the spec considers below-floor.
 */
export class SeismicMissionBridge extends MissionBridgeBase {
  private readonly fetcher: () => Promise<RawUsgsQuake[]>;

  constructor(options: SeismicMissionBridgeOptions = {}) {
    super({ ...SEISMIC_DEFAULT_CONFIG, ...options.config }, options);
    this.fetcher = options.fetcher ?? emptyFetcher;
  }

  override fetchRaw(): Promise<unknown[]> {
    return this.fetcher() as Promise<unknown[]>;
  }

  override normalize(raw: unknown): ObservationEvent | null {
    if (!isRawUsgsQuake(raw)) return null;
    if (raw.magnitude < 5) return null; // M5+ only per spec
    const rank = magnitudeRank(raw.magnitude);
    const severity = rankToSeverity(rank);
    const depthTag = typeof raw.depthKm === 'number' && Number.isFinite(raw.depthKm)
      ? `depth-${Math.round(raw.depthKm)}km` : 'depth-unknown';
    return {
      id: `usgs-earthquake:${raw.id}`,
      sourceId: this.config.feedId,
      domain: this.config.domain,
      timestamp: raw.timestamp,
      location: { lat: raw.lat, lon: raw.lon, radiusKm: ruptureRadiusKm(raw.magnitude) },
      severity,
      title: `M${raw.magnitude.toFixed(1)} earthquake near ${raw.place}`,
      raw,
      entityIds: [],
      tags: ['earthquake', `rank-${rank}`, `severity-${severity.toLowerCase()}`, depthTag],
    };
  }
}

// ── TsunamiMissionBridge — PTWC / NWS alerts ─────────────────────────────

export class TsunamiMissionBridge extends MissionBridgeBase {
  private readonly fetcher: () => Promise<RawTsunamiAlert[]>;

  constructor(options: TsunamiMissionBridgeOptions = {}) {
    super({ ...TSUNAMI_DEFAULT_CONFIG, ...options.config }, options);
    this.fetcher = options.fetcher ?? emptyFetcher;
  }

  override fetchRaw(): Promise<unknown[]> {
    return this.fetcher() as Promise<unknown[]>;
  }

  override normalize(raw: unknown): ObservationEvent | null {
    if (!isRawTsunamiAlert(raw)) return null;
    const rank = tsunamiLevelRank(raw.level);
    const severity = rankToSeverity(rank);
    const levelTag = `level-${(raw.level || 'unknown').toLowerCase()}`;
    const location = typeof raw.lat === 'number' && typeof raw.lon === 'number'
      && Number.isFinite(raw.lat) && Number.isFinite(raw.lon)
      ? { lat: raw.lat, lon: raw.lon, radiusKm: 250 }
      : undefined;
    return {
      id: `tsunami-alert:${raw.id}`,
      sourceId: this.config.feedId,
      domain: this.config.domain,
      timestamp: raw.issuedAt,
      location,
      severity,
      title: `Tsunami ${raw.level} — ${raw.region}`,
      raw,
      entityIds: typeof raw.sourceEventId === 'string' && raw.sourceEventId.length > 0
        ? [raw.sourceEventId] : [],
      tags: ['tsunami', levelTag, `rank-${rank}`, `severity-${severity.toLowerCase()}`],
    };
  }
}

// ── AfterShockMissionBridge — ShakeAlert EEW ─────────────────────────────

/**
 * ShakeAlert Early-Earthquake-Warning bridge. The name "AfterShock" is
 * the host-mandated identifier; the underlying feed is the USGS /
 * UC Berkeley ShakeAlert system, which estimates a peak MMI ahead of
 * S-wave arrival. We rank by that predicted intensity, not the
 * underlying source magnitude.
 */
export class AfterShockMissionBridge extends MissionBridgeBase {
  private readonly fetcher: () => Promise<RawShakeAlertEEW[]>;

  constructor(options: AfterShockMissionBridgeOptions = {}) {
    super({ ...SHAKEALERT_DEFAULT_CONFIG, ...options.config }, options);
    this.fetcher = options.fetcher ?? emptyFetcher;
  }

  override fetchRaw(): Promise<unknown[]> {
    return this.fetcher() as Promise<unknown[]>;
  }

  override normalize(raw: unknown): ObservationEvent | null {
    if (!isRawShakeAlertEEW(raw)) return null;
    const rank = mmiRank(raw.mmi);
    const severity = rankToSeverity(rank);
    const mmiInt = mmiToInteger(raw.mmi) ?? 0;
    const magnitudeText = typeof raw.magnitude === 'number' && Number.isFinite(raw.magnitude)
      ? `M${raw.magnitude.toFixed(1)} ` : '';
    const warningTag = typeof raw.warningSeconds === 'number' && raw.warningSeconds > 0
      ? `warning-${Math.round(raw.warningSeconds)}s` : 'warning-immediate';
    return {
      id: `shakealert-eew:${raw.id}`,
      sourceId: this.config.feedId,
      domain: this.config.domain,
      timestamp: raw.issuedAt,
      location: { lat: raw.lat, lon: raw.lon, radiusKm: 50 },
      severity,
      title: `${magnitudeText}ShakeAlert — predicted MMI ${integerToRoman(mmiInt)}`,
      raw,
      entityIds: [],
      tags: ['eew', 'shakealert', `mmi-${mmiInt}`, `rank-${rank}`,
        `severity-${severity.toLowerCase()}`, warningTag],
    };
  }
}

// ── Type guards ──────────────────────────────────────────────────────────

function isRawUsgsQuake(value: unknown): value is RawUsgsQuake {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && v.id.length > 0
    && typeof v.magnitude === 'number' && Number.isFinite(v.magnitude)
    && typeof v.place === 'string'
    && typeof v.timestamp === 'number' && Number.isFinite(v.timestamp)
    && typeof v.lat === 'number' && Number.isFinite(v.lat)
    && typeof v.lon === 'number' && Number.isFinite(v.lon);
}

function isRawTsunamiAlert(value: unknown): value is RawTsunamiAlert {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && v.id.length > 0
    && typeof v.level === 'string'
    && typeof v.region === 'string'
    && typeof v.issuedAt === 'number' && Number.isFinite(v.issuedAt);
}

function isRawShakeAlertEEW(value: unknown): value is RawShakeAlertEEW {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.issuedAt !== 'number' || !Number.isFinite(v.issuedAt)) return false;
  if (typeof v.lat !== 'number' || !Number.isFinite(v.lat)) return false;
  if (typeof v.lon !== 'number' || !Number.isFinite(v.lon)) return false;
  // mmi may be string or number
  if (v.mmi === undefined || v.mmi === null) return false;
  if (typeof v.mmi !== 'string' && typeof v.mmi !== 'number') return false;
  return true;
}

// ── Small numeric / display helpers ──────────────────────────────────────

const INT_TO_ROMAN: Record<number, string> = {
  0: '-', 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII',
  9: 'IX', 10: 'X', 11: 'XI', 12: 'XII',
};

export function integerToRoman(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '-';
  return INT_TO_ROMAN[Math.min(12, Math.floor(n))] ?? String(n);
}

/** Rough rupture-radius estimate in km. Doubles per magnitude unit. */
export function ruptureRadiusKm(magnitude: number): number {
  if (!Number.isFinite(magnitude) || magnitude < 0) return 0;
  return Math.round(Math.max(1, 2 ** (magnitude - 2)));
}
