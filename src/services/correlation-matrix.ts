/**
 * Correlation Matrix — Region × Domain global threat overview
 *
 * Provides a two-dimensional matrix where rows are geographic macro-regions
 * and columns are threat domains. Each cell holds a score (0–100), event
 * count, and trend direction. The matrix gives analysts one-glance global
 * awareness of where multiple threat types are converging.
 *
 * Key capabilities:
 *  - updateCell(): direct score injection from any data service
 *  - ingestEvent(): auto-classify an event's region from lat/lon, then update
 *  - getMatrix(): full MatrixSnapshot with hotspot list
 *  - getTrends(): per-region trend based on score change over the last hour
 *  - getHotspots(): cells above a configurable score threshold
 *
 * Trend detection uses a ring buffer of (timestamp, score) pairs per cell.
 * A cell is "rising" when its current score exceeds the score 1 hour ago by
 * ≥10 points, "falling" when it is ≤−10 points, otherwise "stable".
 *
 * Pure TypeScript, no external imports, in-memory state only.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type MatrixRegion =
  | 'North America'
  | 'Europe'
  | 'Middle East'
  | 'Sub-Saharan Africa'
  | 'Central Asia'
  | 'East Asia'
  | 'South Asia'
  | 'Southeast Asia'
  | 'Latin America'
  | 'Oceania'
  | 'Arctic';

export type MatrixDomain =
  | 'cyber'
  | 'military'
  | 'weather'
  | 'infrastructure'
  | 'financial'
  | 'health'
  | 'conflict'
  | 'nuclear';

export interface MatrixCell {
  region: MatrixRegion;
  domain: MatrixDomain;
  /** Threat score 0–100 */
  score: number;
  /** Cumulative event count contributing to this score */
  eventCount: number;
  trend: 'rising' | 'stable' | 'falling';
  lastUpdated: number;
}

export interface MatrixRow {
  region: MatrixRegion;
  cells: MatrixCell[];
  /** Average score across all domains in this region */
  overallScore: number;
  /** Domain with the highest score in this region */
  dominantDomain: MatrixDomain;
}

export interface MatrixSnapshot {
  generatedAt: number;
  rows: MatrixRow[];
  /** Weighted average of all cell scores */
  globalScore: number;
  /** Cells above the hotspot threshold, sorted by score descending */
  hotspots: Array<{ region: MatrixRegion; domain: MatrixDomain; score: number }>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_REGIONS: MatrixRegion[] = [
  'North America',
  'Europe',
  'Middle East',
  'Sub-Saharan Africa',
  'Central Asia',
  'East Asia',
  'South Asia',
  'Southeast Asia',
  'Latin America',
  'Oceania',
  'Arctic',
];

const ALL_DOMAINS: MatrixDomain[] = [
  'cyber',
  'military',
  'weather',
  'infrastructure',
  'financial',
  'health',
  'conflict',
  'nuclear',
];

const DEFAULT_HOTSPOT_THRESHOLD = 60;

/** Score step sizes for severity levels used by ingestEvent() */
const SEVERITY_SCORE: Record<'low' | 'medium' | 'high' | 'critical', number> = {
  low: 10,
  medium: 30,
  high: 60,
  critical: 90,
};

/**
 * Trend change threshold in score points.
 * A delta >= +TREND_DELTA over the last hour → 'rising', <= -TREND_DELTA → 'falling'.
 */
const TREND_DELTA = 10;

/** One hour in milliseconds */
const HOUR_MS = 60 * 60 * 1000;

/** Maximum ring-buffer entries per cell for trend tracking */
const MAX_HISTORY_PER_CELL = 60; // one per minute if updated that often

// ── Module state ──────────────────────────────────────────────────────────────

/** Keyed by `${region}|${domain}` */
const cells = new Map<string, MatrixCell>();

/** Ring buffer for trend detection: keyed same as cells */
const scoreHistory = new Map<string, Array<{ timestamp: number; score: number }>>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function cellKey(region: MatrixRegion, domain: MatrixDomain): string {
  return `${region}|${domain}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function getOrCreateCell(region: MatrixRegion, domain: MatrixDomain): MatrixCell {
  const key = cellKey(region, domain);
  if (!cells.has(key)) {
 cells.set(key, {
 region,
 domain,
 score: 0,
 eventCount: 0,
 trend: 'stable',
 lastUpdated: Date.now(),
 });
  }
  return cells.get(key)!;
}

function recordHistory(region: MatrixRegion, domain: MatrixDomain, score: number): void {
  const key = cellKey(region, domain);
  const hist = scoreHistory.get(key) ?? [];
  hist.push({ timestamp: Date.now(), score });
  if (hist.length > MAX_HISTORY_PER_CELL) hist.shift();
  scoreHistory.set(key, hist);
}

function computeTrend(region: MatrixRegion, domain: MatrixDomain, currentScore: number): 'rising' | 'stable' | 'falling' {
  const key = cellKey(region, domain);
  const hist = scoreHistory.get(key);
  if (!hist || hist.length === 0) return 'stable';

  const cutoff = Date.now() - HOUR_MS;
  // Find the oldest entry that is still within the last hour (or the oldest overall)
  const hourOld = hist.find(h => h.timestamp >= cutoff) ?? hist[0]!;
  const delta = currentScore - hourOld.score;
  if (delta >= TREND_DELTA) return 'rising';
  if (delta <= -TREND_DELTA) return 'falling';
  return 'stable';
}

/**
 * Classify a lat/lon coordinate into a MatrixRegion.
 * Returns null when the coordinate does not fit any defined region.
 */
export function classifyRegion(lat: number, lon: number): MatrixRegion | null {
  // Arctic — check first since it overrides other lat ranges
  if (lat > 66) return 'Arctic';

  // North America
  if (lat >= 15 && lat <= 72 && lon >= -170 && lon <= -50) return 'North America';

  // Europe
  if (lat >= 35 && lat <= 72 && lon >= -10 && lon <= 40) return 'Europe';

  // Middle East
  if (lat >= 12 && lat <= 42 && lon >= 25 && lon <= 63) return 'Middle East';

  // Sub-Saharan Africa
  if (lat >= -35 && lat <= 15 && lon >= -18 && lon <= 52) return 'Sub-Saharan Africa';

  // Central Asia
  if (lat >= 35 && lat <= 55 && lon >= 50 && lon <= 90) return 'Central Asia';

  // South Asia — check before East Asia to handle the overlap zone correctly
  if (lat >= 5 && lat <= 38 && lon >= 60 && lon <= 100) return 'South Asia';

  // East Asia
  if (lat >= 20 && lat <= 55 && lon >= 100 && lon <= 150) return 'East Asia';

  // Southeast Asia
  if (lat >= -10 && lat <= 25 && lon >= 95 && lon <= 140) return 'Southeast Asia';

  // Latin America
  if (lat >= -55 && lat <= 15 && lon >= -120 && lon <= -34) return 'Latin America';

  // Oceania
  if (lat >= -50 && lat <= -10 && lon >= 110 && lon <= 180) return 'Oceania';

  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Directly set (or raise) the score for a region×domain cell.
 * If the new score is lower than the existing score, it still replaces it
 * (callers are responsible for decay / time-windowed scores).
 *
 * @param region - Target macro-region
 * @param domain - Threat domain
 * @param score - New score value 0–100
 * @param eventCount - Total event count to record for this cell
 */
export function updateCell(
  region: MatrixRegion,
  domain: MatrixDomain,
  score: number,
  eventCount: number,
): void {
  const clamped = clamp(Math.round(score), 0, 100);
  const cell = getOrCreateCell(region, domain);
  cell.score = clamped;
  cell.eventCount = Math.max(0, eventCount);
  cell.lastUpdated = Date.now();
  recordHistory(region, domain, clamped);
  cell.trend = computeTrend(region, domain, clamped);
}

/**
 * Ingest a geo-tagged event, auto-classify its region from lat/lon, and
 * update the appropriate cell. The incoming severity is mapped to a score
 * (low=10, medium=30, high=60, critical=90). If the derived score exceeds
 * the cell's current score, the cell is raised to the new value.
 *
 * @param lat - Event latitude
 * @param lon - Event longitude
 * @param domain - Threat domain of the event
 * @param severity - Event severity level
 */
export function ingestEvent(
  lat: number,
  lon: number,
  domain: MatrixDomain,
  severity: 'low' | 'medium' | 'high' | 'critical',
): void {
  const region = classifyRegion(lat, lon);
  if (!region) return;

  const incomingScore = SEVERITY_SCORE[severity];
  const cell = getOrCreateCell(region, domain);
  const newScore = Math.max(cell.score, incomingScore);
  updateCell(region, domain, newScore, cell.eventCount + 1);
}

/**
 * Build and return a full MatrixSnapshot containing all regions, their cells,
 * a global score, and hotspots above the default threshold (60).
 */
export function getMatrix(): MatrixSnapshot {
  const now = Date.now();
  const rows: MatrixRow[] = ALL_REGIONS.map(region => {
 const rowCells: MatrixCell[] = ALL_DOMAINS.map(domain => {
 const key = cellKey(region, domain);
 return cells.get(key) ?? {
 region,
 domain,
 score: 0,
 eventCount: 0,
 trend: 'stable' as const,
 lastUpdated: now,
 };
 });

 const overallScore = rowCells.length > 0
 ? Math.round(rowCells.reduce((s, c) => s + c.score, 0) / rowCells.length)
 : 0;

 const dominantCell = rowCells.reduce(
 (best, c) => (c.score > best.score ? c : best),
 rowCells[0]!,
 );

 return {
 region,
 cells: rowCells,
 overallScore,
 dominantDomain: dominantCell.domain,
 };
  });

  const allCellScores = rows.flatMap(r => r.cells.map(c => c.score));
  const globalScore = allCellScores.length > 0
 ? Math.round(allCellScores.reduce((s, v) => s + v, 0) / allCellScores.length)
 : 0;

  const hotspots = rows
 .flatMap(r =>
 r.cells
 .filter(c => c.score >= DEFAULT_HOTSPOT_THRESHOLD)
 .map(c => ({ region: c.region, domain: c.domain, score: c.score })),
 )
 .sort((a, b) => b.score - a.score);

  return { generatedAt: now, rows, globalScore, hotspots };
}

/**
 * Returns all cells for a single region as a MatrixRow.
 * Zero-score placeholder cells are included for domains with no data.
 */
export function getRegionRow(region: MatrixRegion): MatrixRow {
  const now = Date.now();
  const rowCells: MatrixCell[] = ALL_DOMAINS.map(domain => {
 const key = cellKey(region, domain);
 return cells.get(key) ?? {
 region,
 domain,
 score: 0,
 eventCount: 0,
 trend: 'stable' as const,
 lastUpdated: now,
 };
  });

  const overallScore = Math.round(
 rowCells.reduce((s, c) => s + c.score, 0) / rowCells.length,
  );
  const dominantCell = rowCells.reduce(
 (best, c) => (c.score > best.score ? c : best),
 rowCells[0]!,
  );

  return { region, cells: rowCells, overallScore, dominantDomain: dominantCell.domain };
}

/**
 * Returns cells whose score meets or exceeds `minScore`, sorted by score desc.
 *
 * @param minScore - Minimum score threshold (default: 60)
 */
export function getHotspots(
  minScore = DEFAULT_HOTSPOT_THRESHOLD,
): Array<{ region: MatrixRegion; domain: MatrixDomain; score: number }> {
  const results: Array<{ region: MatrixRegion; domain: MatrixDomain; score: number }> = [];
  for (const cell of cells.values()) {
 if (cell.score >= minScore) {
 results.push({ region: cell.region, domain: cell.domain, score: cell.score });
 }
  }
  return results.sort((a, b) => b.score - a.score);
}

/**
 * Returns the weighted average score of all tracked cells (0–100).
 * Cells with no data contribute 0 to the average.
 */
export function getGlobalScore(): number {
  const total = ALL_REGIONS.length * ALL_DOMAINS.length;
  if (total === 0) return 0;
  let sum = 0;
  for (const cell of cells.values()) sum += cell.score;
  return clamp(Math.round(sum / total), 0, 100);
}

/**
 * Compute per-region trend by comparing the current overall region score
 * against the region's score approximately 1 hour ago.
 *
 * @returns Map from MatrixRegion to trend direction
 */
export function getTrends(): Map<MatrixRegion, 'rising' | 'stable' | 'falling'> {
  const result = new Map<MatrixRegion, 'rising' | 'stable' | 'falling'>();

  for (const region of ALL_REGIONS) {
 // Sum current scores for the region
 const currentScores = ALL_DOMAINS.map(domain => {
 const key = cellKey(region, domain);
 return cells.get(key)?.score ?? 0;
 });
 const currentAvg = currentScores.reduce((s, v) => s + v, 0) / ALL_DOMAINS.length;

 // Look up hourly-old scores from history buffers
 const cutoff = Date.now() - HOUR_MS;
 const oldScores = ALL_DOMAINS.map(domain => {
 const key = cellKey(region, domain);
 const hist = scoreHistory.get(key);
 if (!hist || hist.length === 0) return 0;
 const hourOld = hist.find(h => h.timestamp >= cutoff) ?? hist[0]!;
 return hourOld.score;
 });
 const oldAvg = oldScores.reduce((s, v) => s + v, 0) / ALL_DOMAINS.length;

 const delta = currentAvg - oldAvg;
 if (delta >= TREND_DELTA) result.set(region, 'rising');
 else if (delta <= -TREND_DELTA) result.set(region, 'falling');
 else result.set(region, 'stable');
  }

  return result;
}

/**
 * Clear all cell scores, event counts, and history buffers.
 * Useful for testing or session resets.
 */
export function resetMatrix(): void {
  cells.clear();
  scoreHistory.clear();
}
