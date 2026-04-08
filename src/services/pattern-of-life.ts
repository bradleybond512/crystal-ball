/**
 * Pattern-of-Life Baseline Service
 *
 * Tracks per-region hourly event counts over a rolling 30-day window
 * to build a statistical baseline ("normal" activity level for each
 * hour-of-week). Surfaces anomalies when:
 * - Activity spikes above mean + 2σ  (surge)
 * - Activity drops below mean − 2σ (going dark / silence)
 *
 * This is Activity-Based Intelligence (ABI) — the core of Palantir Gotham's
 * pattern-of-life analysis.
 */

export type AnomalyDirection = 'surge' | 'silence';

export interface RegionBaseline {
  regionId: string;
  regionName: string;
  /** 168 bins (7 days × 24 hours): mean event count per hour-of-week */
  hourlyMean: number[];
  /** 168 bins: standard deviation */
  hourlyStdDev: number[];
  /** Total events in the 30-day window */
  totalEvents: number;
  /** Last updated timestamp */
  lastUpdated: number;
}

export interface PatternAnomaly {
  regionId: string;
  regionName: string;
  direction: AnomalyDirection;
  /** Z-score magnitude (how many σ from baseline) */
  zScore: number;
  /** Current count for this hour */
  currentCount: number;
  /** Expected count (baseline mean) */
  expectedCount: number;
  /** Timestamp when anomaly was detected */
  detectedAt: number;
  /** Hour-of-week bin (0-167) */
  hourBin: number;
}

// ── Hourly Count Storage ─────────────────────────────────────────────────────

/** regionId → hourBin → array of counts (one per week, max 4 entries) */
const historicalCounts = new Map<string, Map<number, number[]>>();
/** regionId → hourBin → current period count */
const currentCounts = new Map<string, Map<number, number>>();

const regionNames = new Map<string, string>();

const MAX_WEEKS = 4; // 4 weeks = ~30 days of baseline

function getHourBin(date = new Date()): number {
  return date.getUTCDay() * 24 + date.getUTCHours();
}

// ── Ingest ───────────────────────────────────────────────────────────────────

export function ingestRegionEvent(
  regionId: string,
  regionName: string,
  timestamp = Date.now(),
): void {
  regionNames.set(regionId, regionName);

  const bin = getHourBin(new Date(timestamp));

  let regionCurrent = currentCounts.get(regionId);
  if (!regionCurrent) {
 regionCurrent = new Map();
 currentCounts.set(regionId, regionCurrent);
  }
  regionCurrent.set(bin, (regionCurrent.get(bin) ?? 0) + 1);
}

/**
 * Roll the current hour's counts into the historical baseline.
 * Call once per hour (e.g. from data-loader's hourly tick).
 */
export function rollHourlyBaseline(): void {
  const bin = getHourBin();

  for (const [regionId, regionCurrent] of currentCounts) {
 const count = regionCurrent.get(bin) ?? 0;

 let regionHistory = historicalCounts.get(regionId);
 if (!regionHistory) {
 regionHistory = new Map();
 historicalCounts.set(regionId, regionHistory);
 }

 let binHistory = regionHistory.get(bin);
 if (!binHistory) {
 binHistory = [];
 regionHistory.set(bin, binHistory);
 }

 binHistory.push(count);
 if (binHistory.length > MAX_WEEKS) {
 binHistory.shift(); // Keep only last 4 weeks
 }

 // Reset current bin for next hour
 regionCurrent.set(bin, 0);
  }
}

// ── Baseline Computation ─────────────────────────────────────────────────────

function computeMeanStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

export function getRegionBaseline(regionId: string): RegionBaseline | null {
  const regionHistory = historicalCounts.get(regionId);
  if (!regionHistory) return null;

  const hourlyMean: number[] = Array.from<number>({ length: 168 }).fill(0);
  const hourlyStdDev: number[] = Array.from<number>({ length: 168 }).fill(0);
  let totalEvents = 0;

  for (let bin = 0; bin < 168; bin++) {
 const values = regionHistory.get(bin) ?? [];
 const { mean, std } = computeMeanStd(values);
 hourlyMean[bin] = mean;
 hourlyStdDev[bin] = std;
 totalEvents += values.reduce((s, v) => s + v, 0);
  }

  return {
 regionId,
 regionName: regionNames.get(regionId) ?? regionId,
 hourlyMean,
 hourlyStdDev,
 totalEvents,
 lastUpdated: Date.now(),
  };
}

// ── Anomaly Detection ────────────────────────────────────────────────────────

const Z_THRESHOLD = 2;
const MIN_BASELINE_WEEKS = 2; // Need at least 2 weeks of history

export function detectAnomalies(): PatternAnomaly[] {
  const bin = getHourBin();
  const anomalies: PatternAnomaly[] = [];

  for (const [regionId, regionHistory] of historicalCounts) {
 const binHistory = regionHistory.get(bin);
 if (!binHistory || binHistory.length < MIN_BASELINE_WEEKS) continue;

 const { mean, std } = computeMeanStd(binHistory);
 if (std === 0) continue; // No variance = no baseline

 const currentRegion = currentCounts.get(regionId);
 const currentCount = currentRegion?.get(bin) ?? 0;

 const zScore = (currentCount - mean) / std;

 if (Math.abs(zScore) >= Z_THRESHOLD) {
 anomalies.push({
 regionId,
 regionName: regionNames.get(regionId) ?? regionId,
 direction: zScore > 0 ? 'surge' : 'silence',
 zScore: Math.round(zScore * 10) / 10,
 currentCount,
 expectedCount: Math.round(mean * 10) / 10,
 detectedAt: Date.now(),
 hourBin: bin,
 });
 }
  }

  anomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
  return anomalies;
}

/** Get all monitored region IDs */
export function getMonitoredRegions(): string[] {
  return [...historicalCounts.keys()];
}
