/**
 * Configurable alert thresholds.
 *
 * Single source of truth for the cutoffs that decide whether a raw
 * geophysical / hazard / market event becomes a push or voice
 * notification. The pure helpers in this module are deterministic so
 * they can be unit-tested without DOM/storage; persistence is layered
 * on top via load/save which, on desktop, write to the Tauri runtime
 * config store under the `ALERT_THRESHOLDS` key, and on web, fall back
 * to localStorage at `crystalball-alert-thresholds-v1`.
 */
/* eslint-disable sonarjs/cognitive-complexity -- normalize merges six independent threshold buckets in one pass; splitting hurts readability more than it helps */

export interface SeismicThresholds {
  /** Minimum magnitude for a push notification. */
  pushMinMagnitude: number;
  /** Minimum magnitude for a voice (TTS) alert. */
  voiceMinMagnitude: number;
}

export interface GeomagneticThresholds {
  /** Minimum Kp index for a push notification (0–9). */
  pushMinKp: number;
  /** Minimum Kp index for a voice alert (0–9). */
  voiceMinKp: number;
}

export interface WildfireThresholds {
  /** Minimum Fire Radiative Power (MW) for a push. 0 = off. */
  pushMinFRP: number;
  /** Distance from saved place within which wildfires raise the alert. */
  radiusKm: number;
}

export interface AirQualityThresholds {
  /** Minimum US AQI for a push notification (0–500). */
  pushMinAQI: number;
}

export interface EconomicThresholds {
  /** Minimum VIX value for a push notification. */
  pushMinVIX: number;
  /** OFR Financial Stress Index z-score that triggers a push. */
  ofrFsiSigmas: number;
}

export interface HurricaneThresholds {
  /** Minimum Saffir-Simpson category (1–5) for a push. */
  pushMinCategory: number;
}

export interface ThresholdConfig {
  seismic: SeismicThresholds;
  geomagnetic: GeomagneticThresholds;
  wildfire: WildfireThresholds;
  airQuality: AirQualityThresholds;
  economic: EconomicThresholds;
  hurricane: HurricaneThresholds;
}

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  seismic: { pushMinMagnitude: 5, voiceMinMagnitude: 7 },
  geomagnetic: { pushMinKp: 7, voiceMinKp: 8 },
  wildfire: { pushMinFRP: 100, radiusKm: 50 },
  airQuality: { pushMinAQI: 150 },
  economic: { pushMinVIX: 30, ofrFsiSigmas: 2 },
  hurricane: { pushMinCategory: 3 },
};

export const STORAGE_KEY = 'crystalball-alert-thresholds-v1';
export const TAURI_CONFIG_KEY = 'ALERT_THRESHOLDS';
export const SCHEMA_VERSION = 1;

// ── Domain ranges (used by the settings UI to clamp inputs) ────────────────

export const RANGES = {
  seismic: {
    pushMinMagnitude: { min: 2.5, max: 9.5, step: 0.1 },
    voiceMinMagnitude: { min: 2.5, max: 9.5, step: 0.1 },
  },
  geomagnetic: {
    pushMinKp: { min: 0, max: 9, step: 1 },
    voiceMinKp: { min: 0, max: 9, step: 1 },
  },
  wildfire: {
    pushMinFRP: { min: 0, max: 5000, step: 10 },
    radiusKm: { min: 5, max: 500, step: 5 },
  },
  airQuality: {
    pushMinAQI: { min: 50, max: 500, step: 10 },
  },
  economic: {
    pushMinVIX: { min: 10, max: 80, step: 1 },
    ofrFsiSigmas: { min: 0, max: 5, step: 0.1 },
  },
  hurricane: {
    pushMinCategory: { min: 1, max: 5, step: 1 },
  },
} as const;

// ── Pure helpers ────────────────────────────────────────────────────────────

function clampToRange(value: number, range: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return range.min;
  if (value < range.min) return range.min;
  if (value > range.max) return range.max;
  return value;
}

/**
 * Normalize a partial / untrusted config into a complete ThresholdConfig.
 * Missing fields fall back to defaults, out-of-range values clamp to their
 * declared range. The output always has every field — callers can rely on
 * this without optional-chaining.
 */
export function normalizeThresholds(input: unknown): ThresholdConfig {
  const out: ThresholdConfig = cloneDefaults();
  if (!input || typeof input !== 'object') return out;
  const o = input as Record<string, unknown>;

  // Reject explicit non-current schema versions; ignore missing schema (treat
  // as raw). Forward-compat: do NOT throw — older builds won't crash on a
  // newer-schema blob, they just discard it.
  if ('schema' in o && typeof o.schema === 'number' && o.schema !== SCHEMA_VERSION) {
    return out;
  }

  const seismic = o.seismic as Partial<SeismicThresholds> | undefined;
  if (seismic) {
    if (typeof seismic.pushMinMagnitude === 'number') {
      out.seismic.pushMinMagnitude = clampToRange(
        seismic.pushMinMagnitude,
        RANGES.seismic.pushMinMagnitude,
      );
    }
    if (typeof seismic.voiceMinMagnitude === 'number') {
      out.seismic.voiceMinMagnitude = clampToRange(
        seismic.voiceMinMagnitude,
        RANGES.seismic.voiceMinMagnitude,
      );
    }
  }

  const geo = o.geomagnetic as Partial<GeomagneticThresholds> | undefined;
  if (geo) {
    if (typeof geo.pushMinKp === 'number') {
      out.geomagnetic.pushMinKp = clampToRange(geo.pushMinKp, RANGES.geomagnetic.pushMinKp);
    }
    if (typeof geo.voiceMinKp === 'number') {
      out.geomagnetic.voiceMinKp = clampToRange(geo.voiceMinKp, RANGES.geomagnetic.voiceMinKp);
    }
  }

  const fire = o.wildfire as Partial<WildfireThresholds> | undefined;
  if (fire) {
    if (typeof fire.pushMinFRP === 'number') {
      out.wildfire.pushMinFRP = clampToRange(fire.pushMinFRP, RANGES.wildfire.pushMinFRP);
    }
    if (typeof fire.radiusKm === 'number') {
      out.wildfire.radiusKm = clampToRange(fire.radiusKm, RANGES.wildfire.radiusKm);
    }
  }

  const aq = o.airQuality as Partial<AirQualityThresholds> | undefined;
  if (aq && typeof aq.pushMinAQI === 'number') {
    out.airQuality.pushMinAQI = clampToRange(aq.pushMinAQI, RANGES.airQuality.pushMinAQI);
  }

  const econ = o.economic as Partial<EconomicThresholds> | undefined;
  if (econ) {
    if (typeof econ.pushMinVIX === 'number') {
      out.economic.pushMinVIX = clampToRange(econ.pushMinVIX, RANGES.economic.pushMinVIX);
    }
    if (typeof econ.ofrFsiSigmas === 'number') {
      out.economic.ofrFsiSigmas = clampToRange(econ.ofrFsiSigmas, RANGES.economic.ofrFsiSigmas);
    }
  }

  const hurricane = o.hurricane as Partial<HurricaneThresholds> | undefined;
  if (hurricane && typeof hurricane.pushMinCategory === 'number') {
    out.hurricane.pushMinCategory = clampToRange(
      hurricane.pushMinCategory,
      RANGES.hurricane.pushMinCategory,
    );
  }

  return out;
}

function cloneDefaults(): ThresholdConfig {
  return {
    seismic: { ...DEFAULT_THRESHOLDS.seismic },
    geomagnetic: { ...DEFAULT_THRESHOLDS.geomagnetic },
    wildfire: { ...DEFAULT_THRESHOLDS.wildfire },
    airQuality: { ...DEFAULT_THRESHOLDS.airQuality },
    economic: { ...DEFAULT_THRESHOLDS.economic },
    hurricane: { ...DEFAULT_THRESHOLDS.hurricane },
  };
}

/** Validate that voice thresholds aren't lower than push thresholds — a
 *  voice alert without a push doesn't make sense. Returns the list of
 *  violations the UI should surface. */
export function validateOrdering(config: ThresholdConfig): string[] {
  const out: string[] = [];
  if (config.seismic.voiceMinMagnitude < config.seismic.pushMinMagnitude) {
    out.push('Seismic voice threshold must be ≥ push threshold');
  }
  if (config.geomagnetic.voiceMinKp < config.geomagnetic.pushMinKp) {
    out.push('Geomagnetic voice Kp must be ≥ push Kp');
  }
  return out;
}

// ── Persistence ─────────────────────────────────────────────────────────────

interface StorageHost {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Module-level cache so repeated reads don't hit storage. */
let cached: ThresholdConfig | null = null;

function getDefaultStorage(): StorageHost | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageHost }).localStorage;
  return ls ?? null;
}

/** Read thresholds from storage, returning defaults on first run / error. */
export function loadThresholds(storage?: StorageHost | null): ThresholdConfig {
  if (cached) return cached;
  const host = storage === undefined ? getDefaultStorage() : storage;
  if (!host) {
    cached = cloneDefaults();
    return cached;
  }
  try {
    const raw = host.getItem(STORAGE_KEY);
    if (!raw) {
      cached = cloneDefaults();
      return cached;
    }
    const parsed: unknown = JSON.parse(raw);
    cached = normalizeThresholds(parsed);
    return cached;
  } catch {
    cached = cloneDefaults();
    return cached;
  }
}

/** Save thresholds to storage. Returns the normalized config that was saved. */
export function saveThresholds(
  config: ThresholdConfig,
  storage?: StorageHost | null,
): ThresholdConfig {
  const normalized = normalizeThresholds(config);
  const host = storage === undefined ? getDefaultStorage() : storage;
  cached = normalized;
  if (host) {
    try {
      host.setItem(STORAGE_KEY, JSON.stringify({ ...normalized, schema: SCHEMA_VERSION }));
    } catch {
      // Storage full / quota — keep in-memory cache so the session still
      // honours the new values.
    }
  }
  return normalized;
}

/** Reset thresholds to defaults; clears storage too. */
export function resetThresholds(storage?: StorageHost | null): ThresholdConfig {
  const host = storage === undefined ? getDefaultStorage() : storage;
  cached = cloneDefaults();
  if (host) {
    try {
      host.removeItem(STORAGE_KEY);
    } catch {
      // Ignore — defaults are still served from cache.
    }
  }
  return cached;
}

/** Test seam — drops the in-memory cache so the next loadThresholds()
 *  re-reads from storage. */
export function __resetCache(): void {
  cached = null;
}
